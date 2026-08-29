"""Universal Bulk Import — upload, AI-assisted mapping, match/dedupe, execute, rollback.
Phase B (MVP): targets CRM Leads (physician/practice rows). Rows are staged and never
written to production collections until execute; every execute is rollback-safe."""
import io
import csv
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import ROLE_LEAD_MANAGER, now_iso, next_seq, activity, log_activity, DEFAULT_COMM
from ai import generate, parse_json
from routes_crm import _medicare_snapshot

router = APIRouter(prefix="/api/imports")
IMPORTER = require_roles(ROLE_LEAD_MANAGER)

LEAD_FIELDS = ["org_name", "contact_first", "contact_last", "email", "phone", "npi",
               "specialty", "city", "state", "source", "tags"]
MAX_ROWS = 5000


def _parse(filename: str, raw: bytes) -> tuple[list[str], list[dict]]:
    name = (filename or "").lower()
    if name.endswith(".json"):
        data = json.loads(raw.decode("utf-8-sig", errors="replace"))
        if isinstance(data, dict):
            data = data.get("rows") or data.get("data") or [data]
        headers = list(data[0].keys()) if data else []
        return headers, [dict(r) for r in data[:MAX_ROWS]]
    if name.endswith((".xlsx", ".xls")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        rows = ws.iter_rows(values_only=True)
        headers = [str(h).strip() if h is not None else f"col{i}" for i, h in enumerate(next(rows, []))]
        out = []
        for r in rows:
            out.append({headers[i]: ("" if v is None else str(v)) for i, v in enumerate(r) if i < len(headers)})
            if len(out) >= MAX_ROWS:
                break
        return headers, out
    # csv / tsv
    delim = "\t" if name.endswith(".tsv") else ","
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    headers = reader.fieldnames or []
    out = []
    for row in reader:
        out.append(dict(row))
        if len(out) >= MAX_ROWS:
            break
    return [h for h in headers], out


@router.post("")
async def create_import(file: UploadFile = File(...), dataset_type: str = Form("lead"), user=Depends(IMPORTER)):
    raw = await file.read()
    try:
        headers, rows = _parse(file.filename, raw)
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")
    if not rows:
        raise HTTPException(400, "No data rows found")
    job = {"id": str(uuid.uuid4()), "filename": file.filename, "dataset_type": dataset_type,
           "headers": headers, "rows": rows, "row_count": len(rows), "mapping": {},
           "rule": "safe", "status": "uploaded", "counts": {}, "created_ids": [],
           "created_by": user["id"], "created_by_name": user.get("name"), "created_at": now_iso()}
    await db.import_jobs.insert_one(dict(job))
    return {"import_id": job["id"], "headers": headers, "row_count": len(rows),
            "sample": rows[:5], "dataset_type": dataset_type}


async def _get_job(import_id):
    job = await db.import_jobs.find_one({"id": import_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Import not found")
    return job


@router.post("/{import_id}/analyze")
async def analyze(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    headers = job["headers"]
    sample = job["rows"][:3]
    sys = ("You map spreadsheet columns to a fixed CRM schema for physician/practice leads. "
           f"Valid target fields: {', '.join(LEAD_FIELDS)}. Return STRICT JSON mapping each source "
           'header to one target field or null, e.g. {"Provider NPI":"npi","Org":"org_name"}. '
           "Only map confident matches; use null otherwise.")
    prompt = f"Headers: {headers}\nSample rows: {json.dumps(sample)[:1500]}"
    mapping = {}
    try:
        ai_map = parse_json(await generate(sys, prompt, want_json=True)) or {}
        for h in headers:
            f = ai_map.get(h)
            mapping[h] = f if f in LEAD_FIELDS else None
    except Exception:
        mapping = {h: None for h in headers}
    # Heuristic fallback for anything unmapped.
    HINTS = {"npi": ["npi"], "org_name": ["org", "practice", "company", "group"],
             "contact_first": ["first"], "contact_last": ["last", "surname"],
             "email": ["email", "e-mail"], "phone": ["phone", "mobile", "tel"],
             "specialty": ["special", "taxonomy"], "city": ["city"], "state": ["state", "st"]}
    for h in headers:
        if mapping.get(h):
            continue
        hl = h.lower()
        for field, keys in HINTS.items():
            if any(k in hl for k in keys):
                mapping[h] = field
                break
    await db.import_jobs.update_one({"id": import_id}, {"$set": {"mapping": mapping, "status": "mapping"}})
    categorized = {"auto": [h for h in headers if mapping.get(h)],
                   "unmapped": [h for h in headers if not mapping.get(h)]}
    return {"detected_type": "Physician + Practice", "mapping": mapping,
            "target_fields": LEAD_FIELDS, "categorized": categorized}


class MappingInput(BaseModel):
    mapping: dict
    rule: str = "safe"  # safe (create new, skip existing) | refresh (fill missing on existing)


@router.post("/{import_id}/mapping")
async def save_mapping(import_id: str, data: MappingInput, user=Depends(IMPORTER)):
    await _get_job(import_id)
    await db.import_jobs.update_one({"id": import_id},
                                    {"$set": {"mapping": data.mapping, "rule": data.rule, "status": "mapped"}})
    return {"ok": True}


def _project(row: dict, mapping: dict) -> dict:
    out = {}
    for src, field in mapping.items():
        if field and row.get(src) not in (None, ""):
            out[field] = str(row.get(src)).strip()
    return out


@router.post("/{import_id}/validate")
async def validate(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    mapping = job["mapping"]
    seen_npi, seen_email = set(), set()
    classes = {"new": 0, "existing": 0, "duplicate_in_file": 0, "review": 0}
    preview = []
    for row in job["rows"]:
        p = _project(row, mapping)
        npi, email = p.get("npi"), (p.get("email") or "").lower()
        cls = "new"
        if (npi and npi in seen_npi) or (email and email in seen_email):
            cls = "duplicate_in_file"
        else:
            q = None
            if npi:
                q = {"matched_npi": npi}
            elif email:
                q = {"email": {"$regex": f"^{email}$", "$options": "i"}}
            if q and await db.crm_leads.find_one(q, {"_id": 0, "id": 1}):
                cls = "existing"
            elif not (p.get("org_name") or (p.get("contact_first") and p.get("contact_last")) or npi):
                cls = "review"
        if npi:
            seen_npi.add(npi)
        if email:
            seen_email.add(email)
        classes[cls] += 1
        if len(preview) < 8:
            preview.append({"class": cls, "data": p})
    await db.import_jobs.update_one({"id": import_id}, {"$set": {"counts": classes, "status": "validated"}})
    return {"counts": classes, "preview": preview, "total": job["row_count"]}


@router.post("/{import_id}/execute")
async def execute(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    mapping, rule = job["mapping"], job.get("rule", "safe")
    seen_npi, seen_email = set(), set()
    created_ids, created, updated, skipped = [], 0, 0, 0
    for row in job["rows"]:
        p = _project(row, mapping)
        npi, email = p.get("npi"), (p.get("email") or "").lower()
        if (npi and npi in seen_npi) or (email and email in seen_email):
            skipped += 1
            continue
        if npi:
            seen_npi.add(npi)
        if email:
            seen_email.add(email)
        existing = None
        if npi:
            existing = await db.crm_leads.find_one({"matched_npi": npi}, {"_id": 0, "id": 1})
        elif email:
            existing = await db.crm_leads.find_one({"email": {"$regex": f"^{email}$", "$options": "i"}}, {"_id": 0, "id": 1})
        if existing:
            if rule == "refresh":
                fill = {k: v for k, v in p.items() if k in ("phone", "email", "specialty", "city", "state") and v}
                if fill:
                    await db.crm_leads.update_one({"id": existing["id"]}, {"$set": fill})
                    updated += 1
                else:
                    skipped += 1
            else:
                skipped += 1
            continue
        if not (p.get("org_name") or (p.get("contact_first") and p.get("contact_last")) or npi):
            skipped += 1
            continue
        num = await next_seq("crm_lead")
        lead_id = str(uuid.uuid4())
        snap, match_status, matched_npi = None, "unmatched", None
        if npi:
            snap = await _medicare_snapshot(npi, None)
            if snap:
                match_status, matched_npi = "matched", npi
        doc = {"id": lead_id, "lead_number": f"L-{num:05d}",
               "org_name": p.get("org_name"), "contact_first": p.get("contact_first"),
               "contact_last": p.get("contact_last"), "phone": p.get("phone"), "email": p.get("email"),
               "source": p.get("source") or "CSV Import", "source_details": job["filename"],
               "status": "New", "priority": "Medium", "tags": ["imported"],
               "lead_manager_id": user["id"], "account_manager_id": None,
               "specialty": p.get("specialty") or (snap or {}).get("specialty"),
               "city": p.get("city") or (snap or {}).get("city"),
               "state": (p.get("state") or (snap or {}).get("state") or "").upper() or None,
               "medicare_match_status": match_status, "matched_npi": matched_npi,
               "dataset_year": (snap or {}).get("dataset_year"), "medicare_snapshot": snap,
               "comm": dict(DEFAULT_COMM), "import_job_id": import_id,
               "created_by": user["id"], "created_by_name": user.get("name"),
               "created_at": now_iso(), "last_activity_at": now_iso(), "next_activity_at": None,
               "notes": [], "activity": [],
               "status_history": [{"from": None, "to": "New", "by_id": user["id"],
                                   "by_name": user.get("name"), "reason": "Imported", "at": now_iso()}]}
        await db.crm_leads.insert_one(dict(doc))
        await log_activity(lead_id, activity("import", user, f"Imported from {job['filename']}"))
        created_ids.append(lead_id)
        created += 1
    counts = {"created": created, "updated": updated, "skipped": skipped}
    await db.import_jobs.update_one({"id": import_id},
                                    {"$set": {"created_ids": created_ids, "counts": counts,
                                              "status": "completed", "executed_at": now_iso()}})
    return counts


@router.post("/{import_id}/rollback")
async def rollback(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    ids = job.get("created_ids", [])
    if job.get("status") != "completed" or not ids:
        raise HTTPException(400, "Nothing to roll back")
    r = await db.crm_leads.delete_many({"id": {"$in": ids}, "import_job_id": import_id})
    await db.crm_activities.delete_many({"lead_id": {"$in": ids}})
    await db.import_jobs.update_one({"id": import_id},
                                    {"$set": {"status": "rolled_back", "created_ids": []}})
    return {"ok": True, "removed": r.deleted_count}


@router.get("")
async def list_imports(user=Depends(IMPORTER)):
    return await db.import_jobs.find({}, {"_id": 0, "rows": 0}).sort("created_at", -1).to_list(100)


@router.get("/{import_id}")
async def get_import(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    job.pop("rows", None)
    return job
