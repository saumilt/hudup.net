"""Phase 1 engagement layer: home command-center, global search, sales actions
(email/call/text), one-click enrichment, consent preferences, provider admin."""
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from deps import db, require_roles, require_admin, get_current_user
from crm_common import (
    ROLE_ADMIN, ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF,
    now_iso, log_event, provenance, DEFAULT_COMM,
)
from providers import get_provider_settings, set_provider_setting, is_slot_ready, record_usage
from enrichment import enrich_person, EnrichmentError
from emailer import send_email, EmailError

router = APIRouter(prefix="/api/crm")
ANY_CRM = require_roles(ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF)


def _day_bounds():
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=1)).isoformat(), now.isoformat()


def _scope(user):
    role = user.get("role")
    if role in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
        return {}
    if role == ROLE_ACCOUNT_MANAGER:
        return {"account_manager_id": user["id"]}
    return {"$or": [{"created_by": user["id"]}, {"account_manager_id": user["id"]}]}


# ==================== HOME: MY DAY ====================
@router.get("/home/my-day")
async def my_day(request: Request):
    user = await get_current_user(request)
    me = user["id"]
    start, end, _ = _day_bounds()
    tasks = await db.crm_tasks.find(
        {"assigned_to": me, "status": {"$nin": ["Completed", "Cancelled"]},
         "due_at": {"$lt": end}}, {"_id": 0}).sort("due_at", 1).to_list(50)
    meetings = await db.crm_meetings.find(
        {"owner_id": me, "status": {"$in": ["Scheduled", "Rescheduled"]},
         "start_at": {"$gte": start, "$lt": end}}, {"_id": 0}).sort("start_at", 1).to_list(50)
    new_leads = await db.crm_leads.find(
        {"account_manager_id": me, "status": "New"}, {"_id": 0, "activity": 0}
    ).sort("created_at", -1).to_list(20)
    followups = await db.crm_leads.find(
        {"account_manager_id": me, "next_activity_at": {"$ne": None, "$lt": end},
         "status": {"$nin": ["Won", "Lost", "Disqualified"]}}, {"_id": 0, "activity": 0}
    ).sort("next_activity_at", 1).to_list(20)
    return {"tasks": tasks, "meetings": meetings, "new_leads": new_leads, "followups": followups}


@router.get("/home/attention")
async def attention(request: Request):
    user = await get_current_user(request)
    scope = _scope(user)
    start, end, now = _day_bounds()
    stale = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    me = user["id"]
    needs_contact = await db.crm_leads.count_documents({**scope, "status": "New"})
    overdue_tasks = await db.crm_tasks.count_documents(
        {"assigned_to": me, "status": {"$nin": ["Completed", "Cancelled"]}, "due_at": {"$lt": now}})
    meetings_today = await db.crm_meetings.count_documents(
        {"owner_id": me, "status": {"$in": ["Scheduled", "Rescheduled"]},
         "start_at": {"$gte": start, "$lt": end}})
    stale_high = await db.crm_leads.count_documents(
        {**scope, "medicare_snapshot.tier_340b": "GREEN", "last_activity_at": {"$lt": stale},
         "status": {"$nin": ["Won", "Lost", "Disqualified"]}})
    unassigned = await db.crm_leads.count_documents({"account_manager_id": None}) \
        if user.get("role") in (ROLE_ADMIN, ROLE_LEAD_MANAGER) else 0
    return {"needs_first_contact": needs_contact, "overdue_tasks": overdue_tasks,
            "meetings_today": meetings_today, "stale_high_value": stale_high,
            "unassigned": unassigned}


@router.get("/home/insights")
async def insights(request: Request):
    user = await get_current_user(request)
    scope = _scope(user)
    out = []
    live = await db.sessions.find_one({"is_live": True}, {"_id": 0, "id": 1})
    if live:
        green = await db.physicians.count_documents({"session_id": live["id"], "tier_340b": "GREEN"})
        if green:
            out.append({"key": "green_physicians", "count": green, "action": "medicare",
                        "text": f"{green:,} high-value (GREEN 340B) physicians in Medicare data to prospect"})
    stale = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    stale_high = await db.crm_leads.count_documents(
        {**scope, "medicare_snapshot.tier_340b": "GREEN", "last_activity_at": {"$lt": stale},
         "status": {"$nin": ["Won", "Lost", "Disqualified"]}})
    if stale_high:
        out.append({"key": "stale_high", "count": stale_high, "action": "leads",
                    "text": f"{stale_high} high-value leads have no activity in 14 days"})
    incomplete = await db.crm_leads.count_documents(
        {**scope, "status": "Qualified", "enrichment": {"$exists": False}})
    if incomplete:
        out.append({"key": "incomplete", "count": incomplete, "action": "enrich",
                    "text": f"{incomplete} qualified leads have incomplete practice info — enrich them"})
    return {"insights": out}


# ==================== GLOBAL SEARCH ====================
@router.get("/search")
async def global_search(request: Request, q: str):
    await get_current_user(request)
    q = (q or "").strip()
    if len(q) < 2:
        return {"results": []}
    import re
    rx = {"$regex": re.escape(q), "$options": "i"}
    results = []
    leads = await db.crm_leads.find(
        {"$or": [{"org_name": rx}, {"contact_last": rx}, {"lead_number": rx},
                 {"email": rx}, {"matched_npi": rx}]}, {"_id": 0, "activity": 0}).limit(6).to_list(6)
    for ld in leads:
        results.append({"type": "lead", "id": ld["id"], "title":
                        ld.get("org_name") or f"{ld.get('contact_first','')} {ld.get('contact_last','')}".strip() or ld["lead_number"],
                        "sub": f"{ld['lead_number']} · {ld.get('status')}"})
    opps = await db.crm_opportunities.find(
        {"$or": [{"name": rx}, {"opp_number": rx}]}, {"_id": 0}).limit(4).to_list(4)
    for o in opps:
        results.append({"type": "opportunity", "id": o["id"], "title": o.get("name"),
                        "sub": f"{o['opp_number']} · {o.get('stage')}"})
    live = await db.sessions.find_one({"is_live": True}, {"_id": 0, "id": 1})
    if live:
        pq = {"session_id": live["id"]}
        if q.isdigit():
            pq["npi"] = {"$regex": "^" + q}
        else:
            pq["last_upper"] = {"$regex": "^" + re.escape(q.upper())}
        phys = await db.physicians.find(pq, {"_id": 0}).limit(6).to_list(6)
        for p in phys:
            results.append({"type": "physician", "id": p.get("npi"),
                            "title": f"Dr. {p.get('first_name','')} {p.get('last_name','')}".strip(),
                            "sub": f"NPI {p.get('npi')} · {p.get('specialty') or ''} · {p.get('city','')}, {p.get('state','')}"})
    return {"results": results}


# ==================== PHYSICIAN WORKSPACE (medicare-centric) ====================
@router.get("/physicians/{npi}/workspace")
async def physician_workspace(npi: str, request: Request):
    await get_current_user(request)
    live = await db.sessions.find_one({"is_live": True}, {"_id": 0, "id": 1})
    q = {"npi": npi}
    if live:
        q["session_id"] = live["id"]
    p = await db.physicians.find_one(q, {"_id": 0}) or await db.physicians.find_one({"npi": npi}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Physician not found in Medicare data")
    leads = await db.crm_leads.find({"matched_npi": npi}, {"_id": 0, "activity": 0}).to_list(20)
    acts = await db.crm_activities.find({"meta.npi": npi}, {"_id": 0}).sort("at", -1).to_list(50)
    return {"physician": p, "leads": leads, "activities": acts}


# ==================== SALES ACTIONS ====================
async def _get_lead(lead_id):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


class EmailInput(BaseModel):
    to: str | None = None
    subject: str
    html: str
    cc: str | None = None
    bcc: str | None = None
    scheduled_at: str | None = None


@router.post("/leads/{lead_id}/email")
async def send_lead_email(lead_id: str, data: EmailInput, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    comm = lead.get("comm") or DEFAULT_COMM
    if comm.get("email_suppressed"):
        raise HTTPException(409, "This contact's email is suppressed — sending is blocked")
    to = data.to or lead.get("email")
    if not to:
        raise HTTPException(400, "No email address for this lead")
    if not await is_slot_ready("email"):
        raise HTTPException(503, "Email provider is not configured or is disabled")
    try:
        res = await send_email(to, data.subject, data.html, cc=data.cc, bcc=data.bcc,
                               scheduled_at=data.scheduled_at)
    except EmailError as e:
        raise HTTPException(502, f"Email failed: {e}")
    await record_usage("email")
    msg = {"id": str(uuid.uuid4()), "lead_id": lead_id, "channel": "email",
           "direction": "outbound", "to": to, "subject": data.subject, "html": data.html,
           "provider_id": res.get("id"), "status": "sent", "at": now_iso(),
           "by_id": user["id"], "by_name": user.get("name")}
    await db.email_messages.insert_one(dict(msg))
    await log_event("lead", lead_id, "email", user,
                    f"Email sent to {to}: {data.subject}", {"provider_id": res.get("id")})
    return {"ok": True, "provider_id": res.get("id")}


class CallInput(BaseModel):
    disposition: str
    notes: str | None = None
    duration_sec: int | None = None
    follow_up_task: str | None = None
    follow_up_due: str | None = None


@router.post("/leads/{lead_id}/call")
async def log_call(lead_id: str, data: CallInput, user=Depends(ANY_CRM)):
    await _get_lead(lead_id)
    call = {"id": str(uuid.uuid4()), "lead_id": lead_id, "direction": "outbound",
            "disposition": data.disposition, "notes": data.notes,
            "duration_sec": data.duration_sec, "at": now_iso(),
            "by_id": user["id"], "by_name": user.get("name")}
    await db.calls.insert_one(dict(call))
    await log_event("lead", lead_id, "call", user,
                    f"Call — {data.disposition}" + (f": {data.notes}" if data.notes else ""),
                    {"disposition": data.disposition})
    if data.follow_up_task:
        t = {"id": str(uuid.uuid4()), "title": data.follow_up_task, "related_type": "lead",
             "related_id": lead_id, "assigned_to": user["id"], "due_at": data.follow_up_due,
             "priority": "High", "status": "Open", "created_by": user["id"], "created_at": now_iso()}
        await db.crm_tasks.insert_one(dict(t))
        await log_event("lead", lead_id, "task", user, f"Follow-up task: {data.follow_up_task}")
    return {"ok": True}


class TextInput(BaseModel):
    body: str


@router.post("/leads/{lead_id}/text")
async def send_text(lead_id: str, data: TextInput, user=Depends(ANY_CRM)):
    """SMS provider is a later phase. Records a planned/queued message so the
    conversation is captured; actual send activates when Twilio messaging is enabled."""
    lead = await _get_lead(lead_id)
    comm = lead.get("comm") or DEFAULT_COMM
    if comm.get("do_not_text"):
        raise HTTPException(409, "This contact is marked Do Not Text")
    ready = await is_slot_ready("messaging")
    status = "sent" if ready else "queued_not_configured"
    msg = {"id": str(uuid.uuid4()), "lead_id": lead_id, "channel": "sms",
           "direction": "outbound", "to": lead.get("phone"), "body": data.body,
           "status": status, "at": now_iso(), "by_id": user["id"], "by_name": user.get("name")}
    await db.sms_messages.insert_one(dict(msg))
    await log_event("lead", lead_id, "sms", user, f"SMS ({status}): {data.body[:60]}")
    return {"ok": True, "status": status,
            "note": None if ready else "SMS sending activates when Twilio messaging is enabled"}


# ==================== CONSENT / PREFERENCES ====================
class PrefInput(BaseModel):
    do_not_call: bool | None = None
    do_not_text: bool | None = None
    email_suppressed: bool | None = None
    sms_consent: bool | None = None
    preferred_method: str | None = None
    preferred_time: str | None = None


@router.patch("/leads/{lead_id}/preferences")
async def set_preferences(lead_id: str, data: PrefInput, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    comm = dict(lead.get("comm") or DEFAULT_COMM)
    patch = {k: v for k, v in data.dict().items() if v is not None}
    if patch.get("sms_consent") is True and not comm.get("sms_consent"):
        comm["sms_consent_source"] = "manual"
        comm["sms_consent_at"] = now_iso()
    if patch.get("sms_consent") is False:
        comm["opt_out_at"] = now_iso()
    comm.update(patch)
    await db.crm_leads.update_one({"id": lead_id}, {"$set": {"comm": comm}})
    await log_event("lead", lead_id, "preferences", user, "Updated communication preferences", patch)
    return {"ok": True, "comm": comm}


# ==================== ONE-CLICK ENRICHMENT ====================
@router.post("/leads/{lead_id}/enrich")
async def enrich_lead(lead_id: str, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    if not await is_slot_ready("enrichment"):
        raise HTTPException(503, "Enrichment provider is not configured or disabled")
    snap = lead.get("medicare_snapshot") or {}
    first = lead.get("contact_first") or snap.get("first_name")
    last = lead.get("contact_last") or snap.get("last_name")
    company = lead.get("org_name")
    city = lead.get("city") or snap.get("city")
    region = lead.get("state") or snap.get("state")
    try:
        res = await enrich_person(first_name=first, last_name=last, company=company,
                                  city=city, region=region, email=lead.get("email"),
                                  phone=lead.get("phone"))
    except EnrichmentError as e:
        if e.status == 404:
            await log_event("lead", lead_id, "enrichment", user, "Enrichment: no confident match")
            return {"matched": False, "message": e.message}
        raise HTTPException(e.status, e.message)
    await record_usage("enrichment")
    job = {"id": str(uuid.uuid4()), "lead_id": lead_id, "provider": "People Data Labs",
           "confidence": res["confidence"], "likelihood": res["likelihood"],
           "fields": res["fields"], "status": "preview", "at": now_iso(),
           "by_id": user["id"], "by_name": user.get("name")}
    await db.enrichment_jobs.insert_one(dict(job))
    job.pop("_id", None)
    await log_event("lead", lead_id, "enrichment", user,
                    f"Enrichment found data ({res['confidence']} confidence) — review to accept")
    # Side-by-side current vs found (never auto-apply).
    current = {"email": lead.get("email"), "phone": lead.get("phone"),
               "linkedin_url": (lead.get("enrichment") or {}).get("linkedin_url", {}).get("value"),
               "job_title": None}
    return {"matched": True, "job_id": job["id"], "confidence": res["confidence"],
            "found": res["fields"], "current": current}


class AcceptEnrichInput(BaseModel):
    job_id: str
    fields: list[str]


@router.post("/leads/{lead_id}/enrich/accept")
async def accept_enrich(lead_id: str, data: AcceptEnrichInput, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    job = await db.enrichment_jobs.find_one({"id": data.job_id, "lead_id": lead_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Enrichment job not found")
    found = job.get("fields") or {}
    enr = dict(lead.get("enrichment") or {})
    top_patch = {}
    for f in data.fields:
        val = found.get(f)
        if val in (None, "", []):
            continue
        prev = enr.get(f, {}).get("value") if isinstance(enr.get(f), dict) else None
        enr[f] = provenance(val, job.get("provider"), job.get("confidence"), previous=prev)
        enr[f]["accepted_by"] = user.get("name")
        # Mirror key contact fields onto the lead for convenience.
        if f == "work_email" and not lead.get("email"):
            top_patch["email"] = val
        if f == "phone" and not lead.get("phone"):
            top_patch["phone"] = val
    await db.crm_leads.update_one({"id": lead_id},
                                  {"$set": {"enrichment": enr, **top_patch}})
    await db.enrichment_jobs.update_one({"id": data.job_id}, {"$set": {"status": "accepted"}})
    await log_event("lead", lead_id, "enrichment", user,
                    f"Accepted enriched fields: {', '.join(data.fields)}")
    return {"ok": True, "enrichment": enr}


# ==================== ADMIN: PROVIDERS ====================
admin_router = APIRouter(prefix="/api/admin")


@admin_router.get("/providers")
async def list_providers(admin=Depends(require_admin)):
    return await get_provider_settings()


class ProviderPatch(BaseModel):
    enabled: bool | None = None
    auto: bool | None = None
    priority: int | None = None
    monthly_budget: float | None = None


@admin_router.put("/providers/{slot}")
async def update_provider(slot: str, data: ProviderPatch, admin=Depends(require_admin)):
    return await set_provider_setting(slot, data.dict(exclude_none=True))
