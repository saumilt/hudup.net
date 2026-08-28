"""CRM meetings: schedule, reschedule, cancel, complete, and download ICS."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from deps import db, require_roles, get_current_user
from crm_common import (
    ROLE_ADMIN, ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF,
    MEETING_TYPES, now_iso, next_seq, activity, log_activity,
)
from notifications import build_ics, notify_meeting

router = APIRouter(prefix="/api/crm/meetings")
ANY_CRM = require_roles(ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF)


class ExternalAttendee(BaseModel):
    name: str | None = None
    email: str | None = None
    mobile: str | None = None


class MeetingInput(BaseModel):
    title: str
    lead_id: str | None = None
    account_id: str | None = None
    opportunity_id: str | None = None
    matched_npi: str | None = None
    internal_attendee_ids: list[str] = []
    external_attendee: ExternalAttendee | None = None
    start_at: str
    end_at: str | None = None
    timezone: str = "America/Chicago"
    type: str = "Video Call"
    location: str | None = None
    agenda: str | None = None
    reminder_minutes: int | None = 60


def _scope(user: dict) -> dict:
    if user.get("role") in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
        return {}
    return {"$or": [{"owner_id": user["id"]}, {"internal_attendee_ids": user["id"]}]}


@router.get("")
async def list_meetings(request: Request, upcoming: bool = False, lead_id: str | None = None, limit: int = 200):
    user = await get_current_user(request)
    q = dict(_scope(user))
    if lead_id:
        q["lead_id"] = lead_id
    if upcoming:
        q["start_at"] = {"$gte": now_iso()}
        q["status"] = {"$in": ["Scheduled", "Rescheduled"]}
    return await db.crm_meetings.find(q, {"_id": 0}).sort("start_at", 1).to_list(limit)


@router.post("")
async def create_meeting(data: MeetingInput, user=Depends(ANY_CRM)):
    if data.type not in MEETING_TYPES:
        raise HTTPException(400, "Invalid meeting type")
    num = await next_seq("crm_meeting")
    mid = str(uuid.uuid4())
    doc = {
        "id": mid, "meeting_number": f"M-{num:05d}", "title": data.title,
        "lead_id": data.lead_id, "account_id": data.account_id,
        "opportunity_id": data.opportunity_id, "matched_npi": data.matched_npi,
        "owner_id": user["id"], "owner_name": user.get("name"),
        "internal_attendee_ids": data.internal_attendee_ids,
        "external_attendee": data.external_attendee.dict() if data.external_attendee else None,
        "start_at": data.start_at, "end_at": data.end_at, "timezone": data.timezone,
        "type": data.type, "location": data.location, "agenda": data.agenda,
        "reminder_minutes": data.reminder_minutes, "status": "Scheduled",
        "outcome": None, "followup_notes": None, "next_step_task_id": None,
        "gcal_event_id": None, "created_at": now_iso(),
    }
    await db.crm_meetings.insert_one(dict(doc))
    doc.pop("_id", None)
    doc["notifications"] = notify_meeting(doc, "scheduled")
    if data.lead_id:
        await log_activity(data.lead_id, activity("meeting", user,
                           f"Meeting scheduled: {data.title} @ {data.start_at}"))
        await db.crm_leads.update_one({"id": data.lead_id, "status": {"$in": ["New", "Attempting Contact", "Contacted", "Qualified"]}},
                                      {"$set": {"status": "Meeting Scheduled"}})
    return doc


class RescheduleInput(BaseModel):
    start_at: str
    end_at: str | None = None


@router.post("/{mid}/reschedule")
async def reschedule(mid: str, data: RescheduleInput, user=Depends(ANY_CRM)):
    m = await db.crm_meetings.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Meeting not found")
    await db.crm_meetings.update_one({"id": mid}, {"$set": {
        "start_at": data.start_at, "end_at": data.end_at, "status": "Rescheduled"}})
    m.update({"start_at": data.start_at, "end_at": data.end_at, "status": "Rescheduled"})
    notify_meeting(m, "rescheduled")
    if m.get("lead_id"):
        await log_activity(m["lead_id"], activity("meeting", user, f"Meeting rescheduled to {data.start_at}"))
    return {"ok": True}


@router.post("/{mid}/cancel")
async def cancel(mid: str, user=Depends(ANY_CRM)):
    m = await db.crm_meetings.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Meeting not found")
    await db.crm_meetings.update_one({"id": mid}, {"$set": {"status": "Cancelled"}})
    m["status"] = "Cancelled"
    notify_meeting(m, "cancelled")
    if m.get("lead_id"):
        await log_activity(m["lead_id"], activity("meeting", user, "Meeting cancelled"))
    return {"ok": True}


class CompleteInput(BaseModel):
    outcome: str | None = None
    followup_notes: str | None = None
    next_step_title: str | None = None
    next_step_due_at: str | None = None


@router.post("/{mid}/complete")
async def complete(mid: str, data: CompleteInput, user=Depends(ANY_CRM)):
    m = await db.crm_meetings.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Meeting not found")
    patch = {"status": "Completed", "outcome": data.outcome, "followup_notes": data.followup_notes}
    task_id = None
    if data.next_step_title:
        task_id = str(uuid.uuid4())
        await db.crm_tasks.insert_one({
            "id": task_id, "title": data.next_step_title, "description": None,
            "related_type": "lead", "related_id": m.get("lead_id"),
            "assigned_to": m.get("owner_id"), "due_at": data.next_step_due_at,
            "priority": "Medium", "status": "Open", "reminder_at": None,
            "completion_notes": None, "created_by": user["id"], "created_at": now_iso()})
        patch["next_step_task_id"] = task_id
    await db.crm_meetings.update_one({"id": mid}, {"$set": patch})
    if m.get("lead_id"):
        await log_activity(m["lead_id"], activity("meeting", user,
                           f"Meeting completed — {data.outcome or 'no outcome noted'}"))
    return {"ok": True, "next_step_task_id": task_id}


@router.get("/{mid}/ics")
async def download_ics(mid: str, request: Request):
    await get_current_user(request)
    m = await db.crm_meetings.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Meeting not found")
    return Response(content=build_ics(m), media_type="text/calendar",
                    headers={"Content-Disposition": f"attachment; filename=meeting-{mid}.ics"})
