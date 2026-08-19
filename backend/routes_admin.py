"""Admin console: ingestion sessions, chunked resumable upload, streaming
aggregation, coverage report, scoring thresholds, prizes, alert rules, roster."""
import os
import csv
import uuid
import random
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel

from deps import db, require_admin, ws_manager, get_setting, set_setting, get_thresholds
from scoring import score_340b, tier_counts_for_thresholds, DEFAULT_THRESHOLDS

router = APIRouter(prefix="/api/admin")

UPLOAD_DIR = Path("/tmp/boothiq_uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# CMS Part D column detection by header name (case/space insensitive).
COLUMN_MAP = {
    "prscrbr_npi": "npi",
    "prscrbr_last_org_name": "last_name",
    "prscrbr_first_name": "first_name",
    "prscrbr_city": "city",
    "prscrbr_state_abrvtn": "state",
    "prscrbr_type": "specialty",
    "tot_clms": "tot_clms",
    "tot_drug_cst": "tot_cost",
}


def _norm(h: str) -> str:
    return h.replace("\ufeff", "").strip().lower().replace(" ", "_")


def _is_number(v: str) -> bool:
    try:
        float(v)
        return True
    except (ValueError, TypeError):
        return False


def _san_key(h: str) -> str:
    """Mongo field keys can't contain '.' or start with '$'."""
    return h.replace("\ufeff", "").strip().replace(".", "_").lstrip("$") or "col"


def detect_mapping(headers: list[str]) -> dict:
    mapping = {}
    for idx, h in enumerate(headers):
        key = COLUMN_MAP.get(_norm(h))
        if key:
            mapping[key] = idx
    return mapping


# ---------------- Sessions ----------------
class SessionInput(BaseModel):
    name: str


@router.post("/sessions")
async def create_session(data: SessionInput, admin=Depends(require_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "status": "draft",  # draft | processing | finalized
        "is_live": False,
        "files": [],
        "column_mapping": None,
        "progress": {"current_file": None, "rows_processed": 0, "eta_seconds": None},
        "coverage": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "finalized_at": None,
    }
    await db.sessions.insert_one(dict(doc))
    return doc


@router.get("/sessions")
async def list_sessions(admin=Depends(require_admin)):
    return await db.sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.get("/sessions/{sid}")
async def get_session(sid: str, admin=Depends(require_admin)):
    s = await db.sessions.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Session not found")
    return s


@router.delete("/sessions/{sid}")
async def delete_session(sid: str, admin=Depends(require_admin)):
    s = await db.sessions.find_one({"id": sid})
    if not s:
        raise HTTPException(404, "Session not found")
    if s.get("is_live"):
        raise HTTPException(400, "This dataset is live. Go live with another dataset first, then delete this one.")
    deleted = (await db.physicians.delete_many({"session_id": sid})).deleted_count
    await db.sessions.delete_one({"id": sid})
    # Clean up any uploaded chunk files.
    import shutil
    try:
        shutil.rmtree(UPLOAD_DIR / sid, ignore_errors=True)
    except Exception:
        pass
    return {"ok": True, "physicians_removed": deleted}


# ---------------- Chunked resumable upload ----------------
@router.post("/sessions/{sid}/files/init")
async def init_file(sid: str, filename: str = Form(...), admin=Depends(require_admin)):
    s = await db.sessions.find_one({"id": sid})
    if not s:
        raise HTTPException(404, "Session not found")
    fid = str(uuid.uuid4())
    fdir = UPLOAD_DIR / sid
    fdir.mkdir(parents=True, exist_ok=True)
    (fdir / f"{fid}.part").write_bytes(b"")
    file_entry = {"file_id": fid, "filename": filename, "rows": 0, "status": "uploading", "bytes": 0}
    await db.sessions.update_one({"id": sid}, {"$push": {"files": file_entry}})
    return {"file_id": fid}


@router.get("/sessions/{sid}/files/{fid}/status")
async def file_status(sid: str, fid: str, admin=Depends(require_admin)):
    p = UPLOAD_DIR / sid / f"{fid}.part"
    received = p.stat().st_size if p.exists() else 0
    return {"received": received}


@router.post("/sessions/{sid}/files/{fid}/chunk")
async def upload_chunk(
    sid: str, fid: str, index: int = Form(...), total: int = Form(...),
    chunk: UploadFile = File(...), admin=Depends(require_admin),
):
    p = UPLOAD_DIR / sid / f"{fid}.part"
    if not p.exists():
        raise HTTPException(404, "File not initialized")
    data = await chunk.read()
    with open(p, "ab") as f:
        f.write(data)
    await db.sessions.update_one(
        {"id": sid, "files.file_id": fid},
        {"$set": {"files.$.bytes": p.stat().st_size}},
    )
    return {"received": p.stat().st_size, "index": index, "total": total}


@router.get("/sessions/{sid}/files/{fid}/preview")
async def preview_file(sid: str, fid: str, admin=Depends(require_admin)):
    p = UPLOAD_DIR / sid / f"{fid}.part"
    if not p.exists():
        raise HTTPException(404, "File not found")
    with open(p, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        headers = next(reader, [])
        sample = next(reader, [])
    mapping = detect_mapping(headers)
    return {"headers": headers, "sample": sample, "detected_mapping": mapping}


class MappingInput(BaseModel):
    column_mapping: dict


@router.put("/sessions/{sid}/mapping")
async def set_mapping(sid: str, data: MappingInput, admin=Depends(require_admin)):
    await db.sessions.update_one({"id": sid}, {"$set": {"column_mapping": data.column_mapping}})
    return {"ok": True}


async def _process_file(sid: str, fid: str):
    """Stream a CSV row-by-row, aggregating by NPI with $inc. Never loads to memory."""
    p = UPLOAD_DIR / sid / f"{fid}.part"
    s = await db.sessions.find_one({"id": sid})
    if not s or not p.exists():
        return
    await db.sessions.update_one({"id": sid}, {"$set": {"status": "processing", "progress.current_file": fid}})
    started = datetime.now(timezone.utc)
    rows = 0
    batch = []
    from pymongo import UpdateOne

    with open(p, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        headers = next(reader, [])
        mapping = (s.get("column_mapping")) or detect_mapping(headers)
        # Capture EVERY column: sum numeric measures into `extra`, carry categoricals
        # into `raw`. The 8 scoring/identity columns stay top-level for indexing.
        skip_idx = set(mapping.values())
        idx_headers = list(enumerate(headers))
        col_type = {}  # idx -> "num" | "txt" (decided once from first non-empty value)
        for row in reader:
            try:
                npi = row[mapping["npi"]].strip()
                if not npi:
                    continue
                clms = float(row[mapping["tot_clms"]] or 0)
                cost = float(row[mapping["tot_cost"]] or 0)
                last = row[mapping["last_name"]].strip()
                first = row[mapping["first_name"]].strip()
                city = row[mapping["city"]].strip()
                state = row[mapping["state"]].strip()
                specialty = row[mapping["specialty"]].strip()
            except (KeyError, IndexError, ValueError):
                continue

            # Every other column.
            extra_inc = {}
            raw_set = {}
            for idx, h in idx_headers:
                if idx in skip_idx or idx >= len(row):
                    continue
                val = row[idx].strip()
                if val == "":
                    continue
                t = col_type.get(idx)
                if t is None:
                    hl = h.lower()
                    id_like = any(x in hl for x in ("fips", "npi", "flag", "sprsn", "_src"))
                    t = "num" if (not id_like and _is_number(val)) else "txt"
                    col_type[idx] = t
                key = _san_key(h)
                if t == "num":
                    extra_inc[f"extra.{key}"] = extra_inc.get(f"extra.{key}", 0.0) + float(val)
                else:
                    raw_set[f"raw.{key}"] = val

            inc = {"tot_clms": clms, "tot_cost": cost, "row_count": 1}
            inc.update(extra_inc)
            set_on_insert = {
                "npi_int": int(npi) if npi.isdigit() else 0,
                "last_name": last, "first_name": first,
                "last_upper": last.upper(), "first_upper": first.upper(),
                "first_initial": (first[:1].upper() if first else ""),
                "city": city, "state": state.upper(), "specialty": specialty,
            }
            set_on_insert.update(raw_set)
            batch.append(UpdateOne(
                {"session_id": sid, "npi": npi},
                {"$inc": inc, "$setOnInsert": set_on_insert},
                upsert=True,
            ))
            rows += 1
            if len(batch) >= 2000:
                await db.physicians.bulk_write(batch, ordered=False)
                batch = []
                elapsed = (datetime.now(timezone.utc) - started).total_seconds()
                rate = rows / elapsed if elapsed > 0 else 0
                await db.sessions.update_one({"id": sid}, {"$inc": {"progress.rows_processed": 2000}})
                await ws_manager.broadcast(f"admin:{sid}", {
                    "type": "progress", "file_id": fid, "rows": rows,
                    "rate": round(rate), "current_file": fid,
                })
                await asyncio.sleep(0)
    if batch:
        await db.physicians.bulk_write(batch, ordered=False)

    await db.sessions.update_one(
        {"id": sid, "files.file_id": fid},
        {"$set": {"files.$.rows": rows, "files.$.status": "done"}},
    )
    await db.sessions.update_one({"id": sid}, {"$set": {"status": "draft", "progress.current_file": None}})
    await ws_manager.broadcast(f"admin:{sid}", {"type": "file_done", "file_id": fid, "rows": rows})


@router.post("/sessions/{sid}/files/{fid}/complete")
async def complete_file(sid: str, fid: str, admin=Depends(require_admin)):
    asyncio.create_task(_process_file(sid, fid))
    return {"ok": True, "message": "Processing started"}


@router.post("/sessions/{sid}/finalize")
async def finalize_session(sid: str, admin=Depends(require_admin)):
    s = await db.sessions.find_one({"id": sid})
    if not s:
        raise HTTPException(404, "Session not found")
    # Compute avg per claim via pipeline update (no per-doc loop).
    await db.physicians.update_many(
        {"session_id": sid},
        [{"$set": {"avg_per_claim": {"$cond": [{"$gt": ["$tot_clms", 0]},
                                               {"$divide": ["$tot_cost", "$tot_clms"]}, 0]}}}],
    )
    # Coverage report.
    total_npis = await db.physicians.count_documents({"session_id": sid})
    total_rows = sum(f.get("rows", 0) for f in s.get("files", []))
    agg = await db.physicians.aggregate([
        {"$match": {"session_id": sid}},
        {"$group": {"_id": None, "min": {"$min": "$npi_int"}, "max": {"$max": "$npi_int"}}},
    ]).to_list(1)
    min_npi = agg[0]["min"] if agg else 0
    max_npi = agg[0]["max"] if agg else 0
    density = await db.physicians.aggregate([
        {"$match": {"session_id": sid}},
        {"$group": {"_id": {"$floor": {"$divide": ["$npi_int", 50000000]}}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]).to_list(100)
    blocks = [{"block": int(d["_id"]), "count": d["count"]} for d in density if d["_id"] is not None]

    warnings = []
    if max_npi < 1900000000:
        warnings.append(f"Highest NPI is {max_npi:,}, well below 1,999,999,999 — file may be truncated.")
    if len(blocks) >= 2:
        last, prev = blocks[-1]["count"], blocks[-2]["count"]
        if prev > 0 and last < prev * 0.2:
            warnings.append("Row density drops off sharply in the final NPI block — likely truncated upload.")
    est_share = round(min(max_npi / 1999999999, 1.0) * 100, 1) if max_npi else 0.0

    coverage = {
        "total_rows": total_rows, "unique_npis": total_npis,
        "min_npi": min_npi, "max_npi": max_npi,
        "density_blocks": blocks, "warnings": warnings,
        "estimated_share_pct": est_share,
    }
    await db.sessions.update_one({"id": sid}, {"$set": {
        "status": "finalized", "coverage": coverage,
        "finalized_at": datetime.now(timezone.utc).isoformat(),
    }})
    return coverage


@router.post("/sessions/{sid}/golive")
async def go_live(sid: str, admin=Depends(require_admin)):
    s = await db.sessions.find_one({"id": sid})
    if not s or s.get("status") != "finalized":
        raise HTTPException(400, "Session must be finalized before going live")
    await db.sessions.update_many({}, {"$set": {"is_live": False}})
    await db.sessions.update_one({"id": sid}, {"$set": {"is_live": True}})
    return {"ok": True}


@router.get("/live")
async def live_dataset(admin=Depends(require_admin)):
    s = await db.sessions.find_one({"is_live": True}, {"_id": 0})
    if not s:
        return {"live": None}
    count = await db.physicians.count_documents({"session_id": s["id"]})
    return {"live": s, "physician_count": count}


# ---------------- Thresholds / calibration ----------------
@router.get("/thresholds")
async def get_thresholds_ep(admin=Depends(require_admin)):
    return await get_thresholds()


class ThresholdInput(BaseModel):
    thresholds: dict
    preview: bool = False


@router.post("/thresholds/preview")
async def preview_thresholds(data: ThresholdInput, admin=Depends(require_admin)):
    """Show how many live physicians fall into each 340B tier for calibration."""
    merged = dict(DEFAULT_THRESHOLDS)
    merged.update(data.thresholds)
    live = await db.sessions.find_one({"is_live": True})
    if not live:
        return {"counts": {"GREEN": 0, "YELLOW": 0, "RED": 0, "BLUE": 0, "GREY": 0}, "total": 0}
    docs = await db.physicians.find(
        {"session_id": live["id"]}, {"_id": 0, "avg_per_claim": 1, "tot_cost": 1}
    ).to_list(100000)
    counts = tier_counts_for_thresholds(docs, merged)
    return {"counts": counts, "total": len(docs)}


@router.put("/thresholds")
async def save_thresholds(data: ThresholdInput, admin=Depends(require_admin)):
    merged = dict(DEFAULT_THRESHOLDS)
    merged.update(data.thresholds)
    await set_setting("thresholds", merged)
    return merged


# ---------------- Prizes ----------------
class PrizeSetInput(BaseModel):
    name: str
    event_id: str = "default"
    segments: list


@router.get("/prizes")
async def list_prize_sets(admin=Depends(require_admin)):
    return await db.prize_sets.find({}, {"_id": 0}).to_list(100)


@router.post("/prizes")
async def create_prize_set(data: PrizeSetInput, admin=Depends(require_admin)):
    doc = {"id": str(uuid.uuid4()), "name": data.name, "event_id": data.event_id,
           "segments": data.segments, "active": False}
    await db.prize_sets.insert_one(dict(doc))
    return doc


@router.put("/prizes/{pid}")
async def update_prize_set(pid: str, data: PrizeSetInput, admin=Depends(require_admin)):
    await db.prize_sets.update_one({"id": pid}, {"$set": {
        "name": data.name, "event_id": data.event_id, "segments": data.segments}})
    return await db.prize_sets.find_one({"id": pid}, {"_id": 0})


@router.post("/prizes/{pid}/activate")
async def activate_prize_set(pid: str, admin=Depends(require_admin)):
    await db.prize_sets.update_many({}, {"$set": {"active": False}})
    await db.prize_sets.update_one({"id": pid}, {"$set": {"active": True}})
    return {"ok": True}


@router.get("/prizes/analytics")
async def prize_analytics(admin=Depends(require_admin)):
    ps = await db.prize_sets.find_one({"active": True}, {"_id": 0})
    spins = await db.leads.count_documents({"spun": True})
    dist = await db.leads.aggregate([
        {"$match": {"spun": True}},
        {"$group": {"_id": "$prize.label", "count": {"$sum": 1}}},
    ]).to_list(100)
    return {"active_set": ps, "spins_completed": spins,
            "distribution": [{"label": d["_id"], "count": d["count"]} for d in dist]}


# ---------------- Alert rules ----------------
class AlertRulesInput(BaseModel):
    event_id: str = "default"
    rules: dict
    ceiling_per_hour: int = 20


@router.get("/alert-rules")
async def get_alert_rules(event_id: str = "default", admin=Depends(require_admin)):
    doc = await db.alert_rules.find_one({"event_id": event_id}, {"_id": 0})
    return doc or {"event_id": event_id, "rules": {}, "ceiling_per_hour": 20}


@router.put("/alert-rules")
async def save_alert_rules(data: AlertRulesInput, admin=Depends(require_admin)):
    await db.alert_rules.update_one(
        {"event_id": data.event_id},
        {"$set": {"rules": data.rules, "ceiling_per_hour": data.ceiling_per_hour}},
        upsert=True,
    )
    return {"ok": True}


# ---------------- Events ----------------
class EventInput(BaseModel):
    name: str
    convention_state: str = "TX"
    color_scheme: dict = {"primary": "#047857", "accent": "#10B981"}
    associate_ids: list = []
    prize_set_id: str | None = None


@router.get("/events")
async def list_events(admin=Depends(require_admin)):
    return await db.events.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/events")
async def create_event(data: EventInput, admin=Depends(require_admin)):
    doc = {"id": str(uuid.uuid4()), **data.model_dump(),
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.events.insert_one(dict(doc))
    return doc


@router.put("/events/{eid}")
async def update_event(eid: str, data: EventInput, admin=Depends(require_admin)):
    await db.events.update_one({"id": eid}, {"$set": data.model_dump()})
    return await db.events.find_one({"id": eid}, {"_id": 0})


@router.delete("/events/{eid}")
async def delete_event(eid: str, admin=Depends(require_admin)):
    if eid == "default":
        raise HTTPException(400, "Cannot delete the default event")
    await db.events.delete_one({"id": eid})
    return {"ok": True}


# ---------------- Staff roster ----------------
class StaffInput(BaseModel):
    name: str
    mobile: str
    role: str = "rep"
    on_duty: bool = True


@router.get("/roster")
async def list_roster(admin=Depends(require_admin)):
    return await db.staff_roster.find({}, {"_id": 0}).to_list(200)


@router.post("/roster")
async def add_staff(data: StaffInput, admin=Depends(require_admin)):
    doc = {"id": str(uuid.uuid4()), **data.model_dump()}
    await db.staff_roster.insert_one(dict(doc))
    return doc


@router.put("/roster/{rid}")
async def update_staff(rid: str, data: StaffInput, admin=Depends(require_admin)):
    await db.staff_roster.update_one({"id": rid}, {"$set": data.model_dump()})
    return await db.staff_roster.find_one({"id": rid}, {"_id": 0})


@router.delete("/roster/{rid}")
async def delete_staff(rid: str, admin=Depends(require_admin)):
    await db.staff_roster.delete_one({"id": rid})
    return {"ok": True}


# ---------------- Settings ----------------
@router.get("/settings")
async def get_settings(admin=Depends(require_admin)):
    return {
        "convention_state": await get_setting("convention_state", "TX"),
        "wheel_mute": await get_setting("wheel_mute", False),
    }


class GenericSetting(BaseModel):
    key: str
    value: object


@router.put("/settings")
async def put_setting(data: GenericSetting, admin=Depends(require_admin)):
    await set_setting(data.key, data.value)
    return {"ok": True}


# ---------------- Synthetic sample generator (demo) ----------------
@router.post("/seed-sample")
async def seed_sample(admin=Depends(require_admin)):
    """Generate a synthetic finalized+live dataset so the whole system is demoable
    without a real 2.5GB CMS upload. Includes deliberate name collisions."""
    sid = str(uuid.uuid4())
    await db.physicians.delete_many({"session_id": sid})
    specialties = ["Hematology-Oncology", "Internal Medicine", "Cardiology", "Family Practice",
                   "Nephrology", "Endocrinology", "Pulmonary Disease", "Nurse Practitioner",
                   "Physician Assistant", "Dermatology", "Rheumatology", "Neurology"]
    states = ["TX", "CA", "NY", "FL", "IL", "PA", "OH", "GA"]
    cities = {"TX": ["Denison", "Dallas", "Houston"], "CA": ["Los Angeles", "San Diego"],
              "NY": ["New York", "Buffalo"], "FL": ["Miami", "Tampa"], "IL": ["Chicago"],
              "PA": ["Philadelphia"], "OH": ["Columbus"], "GA": ["Atlanta"]}
    # Collision names
    collision = [("Lee", "John")] * 30 + [("Patel", "Amit")] * 25 + [("Ahmed", "Syed")] * 15
    last_names = ["Kable", "Smith", "Johnson", "Garcia", "Nguyen", "Williams", "Brown", "Jones",
                  "Miller", "Davis", "Rodriguez", "Martinez", "Chen", "Kim", "Singh"]
    first_names = ["Sanober", "Maria", "David", "Priya", "James", "Aisha", "Robert", "Wei",
                   "Sofia", "Ahmed", "Emily", "Carlos"]
    docs = []
    base_npi = 1003000000
    total_rows = 0
    for i in range(700):
        npi = str(base_npi + i * 2851 + random.randint(0, 100))[:10]
        if i < len(collision):
            last, first = collision[i]
        else:
            last, first = random.choice(last_names), random.choice(first_names)
        st = random.choice(states)
        spec = random.choice(specialties)
        # Skew some toward high-cost (340B) or high-volume (RPM)
        if spec == "Hematology-Oncology":
            clms = random.randint(400, 2000)
            cost = clms * random.randint(4000, 9000)
        elif spec in ("Internal Medicine", "Family Practice", "Cardiology"):
            clms = random.randint(3000, 12000)
            cost = clms * random.randint(80, 400)
        else:
            clms = random.randint(200, 5000)
            cost = clms * random.randint(100, 3000)
        rowcount = random.randint(20, 120)
        total_rows += rowcount
        docs.append({
            "session_id": sid, "npi": npi, "npi_int": int(npi),
            "last_name": last, "first_name": first,
            "last_upper": last.upper(), "first_upper": first.upper(),
            "first_initial": first[0].upper(),
            "city": random.choice(cities[st]), "state": st, "specialty": spec,
            "tot_clms": clms, "tot_cost": cost, "avg_per_claim": cost / clms,
        })
    await db.physicians.insert_many(docs)
    coverage = {
        "total_rows": total_rows, "unique_npis": len(docs),
        "min_npi": min(d["npi_int"] for d in docs), "max_npi": max(d["npi_int"] for d in docs),
        "density_blocks": [{"block": 0, "count": len(docs)}],
        "warnings": ["Synthetic sample dataset — max NPI is low by design (demo data)."],
        "estimated_share_pct": 0.1,
    }
    session_doc = {
        "id": sid, "name": "Synthetic Sample Dataset", "status": "finalized", "is_live": True,
        "files": [{"file_id": "synthetic", "filename": "synthetic_sample.csv", "rows": total_rows, "status": "done"}],
        "column_mapping": None, "progress": {"current_file": None, "rows_processed": total_rows, "eta_seconds": 0},
        "coverage": coverage, "created_at": datetime.now(timezone.utc).isoformat(),
        "finalized_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.sessions.update_many({}, {"$set": {"is_live": False}})
    await db.sessions.insert_one(dict(session_doc))
    return {"ok": True, "session_id": sid, "physicians": len(docs)}
