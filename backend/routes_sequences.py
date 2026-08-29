"""Multichannel sales sequences with auto-pause on physician reply."""
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event, DEFAULT_COMM

router = APIRouter(prefix="/api/crm/sequences")
MANAGER = require_roles("lead_manager")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")


def _now():
    return datetime.now(timezone.utc)


class Step(BaseModel):
    day: int = 0
    channel: str  # email | sms | call_task | task | wait
    subject: str | None = None
    body: str | None = None
    note: str | None = None


class SequenceInput(BaseModel):
    name: str
    steps: list[Step]
    active: bool = True


@router.get("")
async def list_sequences(user=Depends(ANY_CRM)):
    return await db.sequences.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("")
async def create_sequence(data: SequenceInput, user=Depends(MANAGER)):
    doc = {"id": str(uuid.uuid4()), "name": data.name,
           "steps": [s.dict() for s in data.steps], "active": data.active,
           "created_by": user["id"], "created_at": now_iso()}
    await db.sequences.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/{seq_id}")
async def get_sequence(seq_id: str, user=Depends(ANY_CRM)):
    s = await db.sequences.find_one({"id": seq_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Not found")
    s["enrollments"] = await db.sequence_enrollments.count_documents({"sequence_id": seq_id})
    return s


class EnrollInput(BaseModel):
    lead_ids: list[str]


@router.post("/{seq_id}/enroll")
async def enroll(seq_id: str, data: EnrollInput, user=Depends(ANY_CRM)):
    seq = await db.sequences.find_one({"id": seq_id}, {"_id": 0})
    if not seq:
        raise HTTPException(404, "Sequence not found")
    n = 0
    for lid in data.lead_ids:
        exists = await db.sequence_enrollments.find_one({"sequence_id": seq_id, "lead_id": lid, "status": "active"})
        if exists:
            continue
        await db.sequence_enrollments.insert_one({
            "id": str(uuid.uuid4()), "sequence_id": seq_id, "lead_id": lid,
            "status": "active", "current_step": 0, "next_run_at": now_iso(),
            "enrolled_by": user["id"], "started_at": now_iso()})
        await log_event("lead", lid, "sequence", user, f"Enrolled in sequence '{seq['name']}'")
        n += 1
    return {"enrolled": n}


@router.post("/enrollments/{eid}/{action}")
async def enrollment_action(eid: str, action: str, user=Depends(ANY_CRM)):
    if action not in ("pause", "resume", "cancel"):
        raise HTTPException(400, "Invalid action")
    status = {"pause": "paused", "resume": "active", "cancel": "cancelled"}[action]
    await db.sequence_enrollments.update_one({"id": eid}, {"$set": {"status": status}})
    return {"ok": True, "status": status}


@router.get("/{seq_id}/enrollments")
async def list_enrollments(seq_id: str, user=Depends(ANY_CRM)):
    return await db.sequence_enrollments.find({"sequence_id": seq_id}, {"_id": 0}).to_list(500)



# ==================== PROCESSOR ====================
async def _execute_step(enr, step):
    lid = enr["lead_id"]
    lead = await db.crm_leads.find_one({"id": lid}, {"_id": 0})
    if not lead:
        return
    comm = lead.get("comm") or DEFAULT_COMM
    ch = step.get("channel")
    if ch == "email" and lead.get("email") and not comm.get("email_suppressed"):
        try:
            from emailer import send_email
            await send_email(to=lead["email"], subject=step.get("subject") or "Following up",
                             html=f"<p>{(step.get('body') or '').replace(chr(10), '<br/>')}</p>")
            await log_event("lead", lid, "email", None, f"Sequence email: {step.get('subject') or ''}")
        except Exception:  # noqa: BLE001
            pass
    elif ch == "sms" and lead.get("phone") and not comm.get("do_not_text") and not comm.get("opt_out_at"):
        try:
            from deps import send_sms
            await asyncio.to_thread(send_sms, lead["phone"], step.get("body") or "")
            await log_event("lead", lid, "sms", None, f"Sequence SMS: {(step.get('body') or '')[:60]}")
        except Exception:  # noqa: BLE001
            pass
    elif ch in ("call_task", "task"):
        await db.crm_tasks.insert_one({
            "id": str(uuid.uuid4()), "title": step.get("note") or ("Call physician" if ch == "call_task" else "Sequence task"),
            "type": "call" if ch == "call_task" else "task", "related_type": "lead", "related_id": lid,
            "assigned_to": lead.get("account_manager_id") or enr.get("enrolled_by"),
            "status": "open", "due_at": now_iso(), "created_at": now_iso()})
        await log_event("lead", lid, "task", None, "Sequence created a task")


async def process_due_enrollments():
    now = now_iso()
    due = await db.sequence_enrollments.find(
        {"status": "active", "next_run_at": {"$lte": now}}, {"_id": 0}).to_list(200)
    for enr in due:
        seq = await db.sequences.find_one({"id": enr["sequence_id"]}, {"_id": 0})
        if not seq or not seq.get("active"):
            continue
        steps = seq.get("steps") or []
        idx = enr["current_step"]
        if idx >= len(steps):
            await db.sequence_enrollments.update_one({"id": enr["id"]}, {"$set": {"status": "completed"}})
            continue
        step = steps[idx]
        if step.get("channel") != "wait":
            await _execute_step(enr, step)
        nxt = idx + 1
        if nxt >= len(steps):
            await db.sequence_enrollments.update_one({"id": enr["id"]},
                {"$set": {"status": "completed", "current_step": nxt}})
        else:
            base_day = step.get("day", 0)
            next_day = steps[nxt].get("day", base_day)
            delay = max(0, next_day - base_day)
            run_at = (_now() + timedelta(days=delay)).isoformat()
            await db.sequence_enrollments.update_one({"id": enr["id"]},
                {"$set": {"current_step": nxt, "next_run_at": run_at}})


@router.post("/process/run")
async def run_processor(user=Depends(MANAGER)):
    await process_due_enrollments()
    return {"ok": True}


async def sequence_worker():
    while True:
        await asyncio.sleep(60)
        try:
            await process_due_enrollments()
        except Exception:  # noqa: BLE001
            pass
