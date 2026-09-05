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
               "specialty", "city", "state", "source", "tags", "notes"]
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
        ws = wb.worksheets[0]
        all_rows = list(ws.iter_rows(values_only=True))
        # Find the real header row: first row (within the first 20) with >= 3 non-empty cells.
        hidx = 0
        for i, r in enumerate(all_rows[:20]):
            if sum(1 for c in r if c not in (None, "")) >= 3:
                hidx = i
                break
        header_row = all_rows[hidx] if all_rows else []
        headers = [str(h).strip() if h is not None else f"col{j}" for j, h in enumerate(header_row)]
        out = []
        for r in all_rows[hidx + 1:]:
            if all(c in (None, "") for c in r):
                continue
            out.append({headers[j]: ("" if v is None else str(v)) for j, v in enumerate(r) if j < len(headers)})
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
           f"Valid target fields: {', '.join(f for f in LEAD_FIELDS if f != 'notes')}. Return STRICT JSON mapping each source "
           'header to one target field or null, e.g. {"Provider NPI":"npi","Org":"org_name"}. '
           "Only map confident matches; use null otherwise.")
    prompt = f"Headers: {headers}\nSample rows: {json.dumps(sample)[:1500]}"
    mapping = {}
    try:
        ai_map = parse_json(await generate(sys, prompt, want_json=True)) or {}
        for h in headers:
            f = ai_map.get(h)
            mapping[h] = f if (f in LEAD_FIELDS and f != "notes") else None
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
    source: str | None = None
    data_year: int | None = None
    distribute: str = "route"  # route (territory + rr fallback) | equal (all reps) | person (one assignee)
    assignee_id: str | None = None


@router.post("/{import_id}/mapping")
async def save_mapping(import_id: str, data: MappingInput, user=Depends(IMPORTER)):
    await _get_job(import_id)
    await db.import_jobs.update_one({"id": import_id}, {"$set": {
        "mapping": data.mapping, "rule": data.rule, "import_source": data.source,
        "data_year": data.data_year, "distribute": data.distribute,
        "assignee_id": data.assignee_id, "status": "mapped"}})
    return {"ok": True}


class PresetInput(BaseModel):
    name: str
    mapping: dict
    source: str | None = None
    data_year: int | None = None
    distribute: str = "route"
    assignee_id: str | None = None
    rule: str = "safe"


@router.get("/presets")
async def list_presets(user=Depends(IMPORTER)):
    return await db.import_presets.find({}, {"_id": 0}).sort("name", 1).to_list(100)


@router.post("/presets")
async def save_preset(data: PresetInput, user=Depends(IMPORTER)):
    doc = {"id": str(uuid.uuid4()), "name": data.name.strip(), "mapping": data.mapping,
           "source": data.source, "data_year": data.data_year, "distribute": data.distribute,
           "assignee_id": data.assignee_id, "rule": data.rule,
           "created_by": user["id"], "created_at": now_iso()}
    await db.import_presets.update_one({"name": doc["name"]}, {"$set": doc}, upsert=True)
    return {"ok": True, "name": doc["name"]}


def _project(row: dict, mapping: dict) -> dict:
    out = {}
    notes = []
    for src, field in mapping.items():
        if not field:
            continue
        val = row.get(src)
        if val in (None, ""):
            continue
        val = str(val).strip()
        if not val:
            continue
        if field == "notes":
            notes.append({"label": src, "value": val})
        else:
            out[field] = val
    if notes:
        out["_notes"] = notes
    return out


import re as _re


def _to_num(s):
    try:
        cleaned = _re.sub(r"[^0-9.\-]", "", str(s))
        return float(cleaned) if cleaned not in ("", ".", "-") else None
    except Exception:
        return None


def _reconcile_claim_notes(import_notes: list, snap: dict | None):
    """Medicare is authoritative for the total claim count: if a matched Medicare
    record exists, override any imported 'total claims' note whose value disagrees.
    Returns a mismatch detail dict (or None) so the lead can be flagged."""
    if not snap:
        return None
    med = snap.get("tot_clms")
    med_num = _to_num(med)
    if med_num is None:
        return None
    med_disp = str(int(med_num)) if med_num.is_integer() else str(med_num)
    for n in import_notes:
        text = n.get("text") or ""
        label, _, value = text.partition(":")
        low = label.lower()
        is_claim_count = ("claim" in low
                          and not any(x in low for x in ("cost", "avg", "average", "per ", "rate", "amount", "$")))
        if not is_claim_count:
            continue
        imp_num = _to_num(value)
        if imp_num is None or abs(imp_num - med_num) <= 0.5:
            continue
        imp_disp = str(int(imp_num)) if imp_num.is_integer() else str(imp_num)
        n["text"] = f"{label.strip()}: {med_disp} (from Medicare)"
        return {"label": label.strip(), "imported": imp_disp, "medicare": med_disp}
    return None


@router.post("/{import_id}/validate")
async def validate(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    mapping = job["mapping"]
    notes_columns = [src for src, f in mapping.items() if f == "notes"]
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
            preview.append({"class": cls, "data": p, "notes": len(p.get("_notes", []))})
    await db.import_jobs.update_one({"id": import_id}, {"$set": {"counts": classes, "status": "validated"}})
    return {"counts": classes, "preview": preview, "total": job["row_count"],
            "notes_columns": notes_columns}


@router.post("/{import_id}/execute")
async def execute(import_id: str, user=Depends(IMPORTER)):
    job = await _get_job(import_id)
    mapping, rule = job["mapping"], job.get("rule", "safe")
    imp_source = job.get("import_source")
    data_year = job.get("data_year")
    distribute = job.get("distribute", "route")
    assignee_id = job.get("assignee_id")
    assignee_name = None
    if distribute == "person" and assignee_id:
        au = await db.users.find_one({"id": assignee_id}, {"_id": 0, "name": 1})
        assignee_name = au.get("name") if au else None
    # Build the equal-distribution pool (active account managers / reps) once.
    pool = []
    if distribute == "equal":
        pu = await db.users.find(
            {"role": "account_manager", "active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(500)
        pool = [(u["id"], u.get("name")) for u in pu]
    rr_idx = 0
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
        import_notes = []
        for n in p.get("_notes", []):
            import_notes.append({
                "id": str(uuid.uuid4()), "text": f"{n['label']}: {n['value']}",
                "author_id": user["id"], "author_name": user.get("name"),
                "visibility": "team", "pinned": False, "created_at": now_iso(),
                "edited_at": None, "edits": []})
        # Medicare is authoritative for the total claim count — correct any mismatching note.
        claim_mismatch = _reconcile_claim_notes(import_notes, snap)
        doc = {"id": lead_id, "lead_number": f"L-{num:05d}",
               "org_name": p.get("org_name"), "contact_first": p.get("contact_first"),
               "contact_last": p.get("contact_last"), "phone": p.get("phone"), "email": p.get("email"),
               "source": imp_source or p.get("source") or "CSV Import", "source_details": job["filename"],
               "collected_year": data_year,
               "status": "New", "priority": "Medium", "tags": ["imported"],
               "lead_manager_id": user["id"], "account_manager_id": None,
               "specialty": p.get("specialty") or (snap or {}).get("specialty"),
               "city": p.get("city") or (snap or {}).get("city"),
               "state": (p.get("state") or (snap or {}).get("state") or "").upper() or None,
               "medicare_match_status": match_status, "matched_npi": matched_npi,
               "claim_mismatch": bool(claim_mismatch), "claim_mismatch_detail": claim_mismatch,
               "dataset_year": (snap or {}).get("dataset_year"), "medicare_snapshot": snap,
               "comm": dict(DEFAULT_COMM), "import_job_id": import_id,
               "created_by": user["id"], "created_by_name": user.get("name"),
               "created_at": now_iso(), "last_activity_at": now_iso(), "next_activity_at": None,
               "notes": import_notes, "activity": [],
               "status_history": [{"from": None, "to": "New", "by_id": user["id"],
                                   "by_name": user.get("name"), "reason": "Imported", "at": now_iso()}]}
        await db.crm_leads.insert_one(dict(doc))
        await log_activity(lead_id, activity("import", user, f"Imported from {job['filename']}"))
        # Assign: to one person, equal round-robin, or territory routing with rr fallback.
        if distribute == "person" and assignee_id:
            await db.crm_leads.update_one({"id": lead_id}, {"$set": {
                "account_manager_id": assignee_id, "account_manager_name": assignee_name,
                "routing_reason": f"Assigned on import to {assignee_name or assignee_id}",
                "routed_at": now_iso()}})
        elif distribute == "equal" and pool:
            am_id, am_name = pool[rr_idx % len(pool)]
            rr_idx += 1
            await db.crm_leads.update_one({"id": lead_id}, {"$set": {
                "account_manager_id": am_id, "account_manager_name": am_name,
                "routing_reason": "Distributed equally on import", "routed_at": now_iso()}})
        else:
            try:
                from routes_teams import auto_route_lead
                await auto_route_lead(doc, user, source_kind="bulk")
            except Exception:
                pass
        created_ids.append(lead_id)
        created += 1
    counts = {"created": created, "updated": updated, "skipped": skipped}
    # Notify the assignee (email + push) when leads were handed to one person on import.
    if distribute == "person" and assignee_id and created > 0:
        try:
            from routes_push import notify_assignment_summary
            await notify_assignment_summary(assignee_id, created,
                                            f"from import \"{job.get('filename')}\"", user.get("name"))
        except Exception:
            pass
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
