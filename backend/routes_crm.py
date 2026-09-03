"""CRM core: leads, accounts, physician contacts, opportunities, tasks,
saved searches, and role dashboards/reports."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from deps import db, require_roles, get_current_user, get_thresholds
from scoring import score_340b, score_rpm, tier_color_340b
from crm_common import (
    ROLE_ADMIN, ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF,
    LEAD_STATUSES, LEAD_SOURCES, PRIORITIES, DEFAULT_OPP_STAGES,
    now_iso, next_seq, activity, log_activity, log_event, DEFAULT_COMM,
)

router = APIRouter(prefix="/api/crm")

ANY_CRM = require_roles(ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF)
MANAGER = require_roles(ROLE_LEAD_MANAGER)


DEFAULT_LEAD_SOURCES = list(dict.fromkeys(list(LEAD_SOURCES) + ["Data Scraping", "Gujarati Physicians Event"]))


async def _all_sources() -> list[str]:
    docs = await db.lead_sources.find({}, {"_id": 0, "name": 1}).sort("name", 1).to_list(500)
    if not docs:
        await db.lead_sources.insert_many([{"id": str(uuid.uuid4()), "name": n} for n in DEFAULT_LEAD_SOURCES])
        return DEFAULT_LEAD_SOURCES
    return [d["name"] for d in docs]


@router.get("/meta")
async def meta(user=Depends(ANY_CRM)):
    return {"statuses": LEAD_STATUSES, "sources": await _all_sources(),
            "priorities": PRIORITIES, "opp_stages": DEFAULT_OPP_STAGES}


@router.get("/lead-sources")
async def list_sources(user=Depends(ANY_CRM)):
    return await _all_sources()


class SourceInput(BaseModel):
    name: str


@router.post("/lead-sources")
async def add_source(data: SourceInput, user=Depends(ANY_CRM)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Source name required")
    existing = await _all_sources()
    if not any(n.lower() == name.lower() for n in existing):
        await db.lead_sources.insert_one({"id": str(uuid.uuid4()), "name": name})
    return {"ok": True, "name": name, "sources": await _all_sources()}


def _lead_scope(user: dict) -> dict:
    role = user.get("role")
    if role in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
        return {}
    if role == ROLE_ACCOUNT_MANAGER:
        return {"account_manager_id": user["id"]}
    return {"$or": [{"created_by": user["id"]}, {"account_manager_id": user["id"]}]}


# ==================== LEADS ====================
class LeadInput(BaseModel):
    org_name: str | None = None
    contact_first: str | None = None
    contact_last: str | None = None
    phone: str | None = None
    email: str | None = None
    source: str = "Manual Entry"
    source_details: str | None = None
    collected_year: int | None = None
    priority: str = "Medium"
    tags: list[str] = []
    est_value: float | None = None
    qualification_notes: str | None = None
    matched_npi: str | None = None
    dataset_year: int | None = None
    specialty: str | None = None
    city: str | None = None
    state: str | None = None
    lead_manager_id: str | None = None
    account_manager_id: str | None = None


async def _medicare_snapshot(npi: str, dataset_year: int | None):
    q = {"npi": npi}
    if dataset_year:
        sids = await db.sessions.distinct("id", {"dataset_year": dataset_year})
        if sids:
            q["session_id"] = {"$in": sids}
    p = await db.physicians.find_one(q, {"_id": 0})
    if not p:
        return None
    t = await get_thresholds()
    clms = p.get("tot_clms", 0) or 0
    cost = p.get("tot_cost", 0) or 0
    avg = p.get("avg_per_claim") or ((cost / clms) if clms else 0)
    t340 = p.get("tier_340b") or score_340b(True, avg, cost, t)
    shade = p.get("shade_340b") or tier_color_340b(t340, avg)[0]
    trpm = p.get("tier_rpm") or score_rpm(True, clms, p.get("specialty"))
    return {
        "npi": npi, "first_name": p.get("first_name"), "last_name": p.get("last_name"),
        "specialty": p.get("specialty"), "city": p.get("city"), "state": p.get("state"),
        "tot_clms": clms, "tot_cost": cost, "avg_per_claim": round(avg, 2),
        "tier_340b": t340, "shade_340b": shade, "tier_rpm": trpm,
        "dataset_year": p.get("dataset_year"),
    }


@router.post("/leads")
async def create_lead(data: LeadInput, user=Depends(ANY_CRM)):
    num = await next_seq("crm_lead")
    lead_id = str(uuid.uuid4())
    snap, match_status, matched_npi = None, "unmatched", None
    if data.matched_npi:
        snap = await _medicare_snapshot(data.matched_npi, data.dataset_year)
        if snap:
            match_status, matched_npi = "matched", data.matched_npi
    doc = {
        "id": lead_id, "lead_number": f"L-{num:05d}",
        "org_name": data.org_name, "contact_first": data.contact_first,
        "contact_last": data.contact_last, "phone": data.phone, "email": data.email,
        "source": data.source, "source_details": data.source_details,
        "collected_year": data.collected_year,
        "status": "New", "priority": data.priority, "tags": data.tags,
        "lead_manager_id": data.lead_manager_id, "account_manager_id": data.account_manager_id,
        "est_value": data.est_value, "qualification_notes": data.qualification_notes,
        "lost_reason": None,
        "specialty": data.specialty or (snap or {}).get("specialty"),
        "city": data.city or (snap or {}).get("city"),
        "state": (data.state or (snap or {}).get("state") or "").upper() or None,
        "medicare_match_status": match_status, "matched_npi": matched_npi,
        "dataset_year": data.dataset_year, "medicare_snapshot": snap,
        "created_by": user["id"], "created_by_name": user.get("name"),
        "created_at": now_iso(), "last_activity_at": now_iso(), "next_activity_at": None,
        "comm": dict(DEFAULT_COMM),
        "notes": [], "activity": [],
        "status_history": [{"from": None, "to": "New", "by_id": user["id"],
                            "by_name": user.get("name"), "reason": None, "at": now_iso()}],
    }
    await db.crm_leads.insert_one(dict(doc))
    doc.pop("_id", None)
    await log_activity(lead_id, activity("created", user, f"Lead {doc['lead_number']} created via {data.source}"))
    from automation import fire_event
    await fire_event("lead_created", doc, user)
    if doc.get("medicare_match_status") == "matched":
        await fire_event("medicare_matched", doc, user)
    # Auto-route brand-new unassigned leads: territory match, else to the creator.
    if not data.account_manager_id:
        try:
            from routes_teams import auto_route_lead
            am_id = await auto_route_lead(doc, user, source_kind="manual")
            if am_id:
                doc["account_manager_id"] = am_id
        except Exception:
            pass
    return doc


@router.get("/leads")
async def list_leads(
    request: Request, status: str | None = None, priority: str | None = None,
    source: str | None = None, lead_manager_id: str | None = None,
    account_manager_id: str | None = None, tag: str | None = None,
    match: str | None = None, q: str | None = None, mine: bool = False,
    state: str | None = None, tier: str | None = None,
    sort: str = "last_activity_at", limit: int = 200,
):
    user = await get_current_user(request)
    query = dict(_lead_scope(user))
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    if source:
        query["source"] = source
    if state:
        query["state"] = state.upper()
    if tier:
        query["medicare_snapshot.tier_340b"] = tier
    if lead_manager_id:
        query["lead_manager_id"] = lead_manager_id
    if account_manager_id:
        query["account_manager_id"] = account_manager_id
    if tag:
        query["tags"] = tag
    if match:
        query["medicare_match_status"] = match
    if mine:
        query["account_manager_id"] = user["id"]
    if q:
        rx = {"$regex": q.strip(), "$options": "i"}
        query["$or"] = [{"org_name": rx}, {"contact_last": rx}, {"contact_first": rx},
                        {"lead_number": rx}, {"email": rx}, {"matched_npi": rx}]
    field = sort if sort in ("last_activity_at", "created_at", "priority", "status") else "last_activity_at"
    leads = await db.crm_leads.find(query, {"_id": 0, "activity": 0}).sort(field, -1).to_list(limit)
    return leads


@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, user=Depends(ANY_CRM)):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    # Merge embedded activity with the unified crm_activities timeline.
    events = await db.crm_activities.find({"lead_id": lead_id}, {"_id": 0}).to_list(500)
    combined = list(lead.get("activity") or []) + events
    combined.sort(key=lambda e: e.get("at") or "", reverse=True)
    lead["activity"] = combined
    if "comm" not in lead or lead["comm"] is None:
        from crm_common import DEFAULT_COMM as _DC
        lead["comm"] = dict(_DC)
    return lead


class LeadPatch(BaseModel):
    org_name: str | None = None
    phone: str | None = None
    email: str | None = None
    priority: str | None = None
    tags: list[str] | None = None
    est_value: float | None = None
    qualification_notes: str | None = None
    next_activity_at: str | None = None


@router.patch("/leads/{lead_id}")
async def patch_lead(lead_id: str, data: LeadPatch, user=Depends(ANY_CRM)):
    patch = {k: v for k, v in data.dict().items() if v is not None}
    if not patch:
        return {"ok": True}
    r = await db.crm_leads.update_one({"id": lead_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "Lead not found")
    await log_activity(lead_id, activity("updated", user, "Lead details updated", patch))
    return await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})


class StatusInput(BaseModel):
    status: str
    reason: str | None = None


@router.post("/leads/{lead_id}/status")
async def change_status(lead_id: str, data: StatusInput, user=Depends(ANY_CRM)):
    if data.status not in LEAD_STATUSES:
        raise HTTPException(400, "Invalid status")
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    old = lead.get("status")
    hist = {"from": old, "to": data.status, "by_id": user["id"], "by_name": user.get("name"),
            "reason": data.reason, "at": now_iso()}
    patch = {"status": data.status}
    if data.status in ("Lost", "Disqualified"):
        patch["lost_reason"] = data.reason
    await db.crm_leads.update_one({"id": lead_id}, {"$set": patch, "$push": {"status_history": hist}})
    await log_activity(lead_id, activity("status", user, f"Status {old} → {data.status}",
                                         {"reason": data.reason}))
    lead["status"] = data.status
    from automation import fire_event
    await fire_event("status_changed", lead, user)
    return {"ok": True, "status": data.status}


@router.post("/leads/{lead_id}/match-medicare")
async def match_medicare(lead_id: str, data: LeadInput, user=Depends(ANY_CRM)):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    npi = data.matched_npi
    if not npi:
        raise HTTPException(400, "matched_npi is required")
    snap = await _medicare_snapshot(npi, data.dataset_year or lead.get("dataset_year"))
    if not snap:
        raise HTTPException(404, "No Medicare record for that NPI/year")
    await db.crm_leads.update_one({"id": lead_id}, {"$set": {
        "matched_npi": npi, "medicare_match_status": "matched", "medicare_snapshot": snap,
        "dataset_year": data.dataset_year or lead.get("dataset_year"),
        "specialty": lead.get("specialty") or snap.get("specialty"),
        "city": lead.get("city") or snap.get("city"),
        "state": lead.get("state") or snap.get("state"),
    }})
    await log_activity(lead_id, activity("medicare_match", user,
                       f"Matched to NPI {npi} ({snap['tier_340b']} 340B / {snap['tier_rpm']} RPM)"))
    return {"ok": True, "snapshot": snap}


class AssignInput(BaseModel):
    lead_manager_id: str | None = None
    account_manager_id: str | None = None


@router.post("/leads/{lead_id}/assign")
async def assign_lead(lead_id: str, data: AssignInput, user=Depends(MANAGER)):
    patch = {k: v for k, v in data.dict().items() if v is not None}
    if not patch:
        return {"ok": True}
    if data.account_manager_id:
        patch["routing_reason"] = f"Manually assigned by {user.get('name')}"
        patch["routed_at"] = now_iso()
    r = await db.crm_leads.update_one({"id": lead_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "Lead not found")
    names = []
    for k, v in patch.items():
        u = await db.users.find_one({"id": v}, {"_id": 0, "name": 1})
        names.append(f"{'Account Manager' if 'account' in k else 'Lead Manager'}: {u['name'] if u else v}")
    await log_activity(lead_id, activity("assigned", user, "Assigned — " + ", ".join(names)))
    if data.account_manager_id:
        try:
            from routes_push import notify_lead_assigned
            lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0, "activity": 0})
            await notify_lead_assigned(data.account_manager_id, lead or {"id": lead_id})
        except Exception:
            pass
    return {"ok": True}


class BulkAssignInput(BaseModel):
    lead_ids: list[str]
    account_manager_id: str


@router.post("/leads/bulk-assign")
async def bulk_assign(data: BulkAssignInput, user=Depends(MANAGER)):
    u = await db.users.find_one({"id": data.account_manager_id}, {"_id": 0, "name": 1})
    if not u:
        raise HTTPException(404, "Account Manager not found")
    r = await db.crm_leads.update_many({"id": {"$in": data.lead_ids}},
                                       {"$set": {"account_manager_id": data.account_manager_id}})
    for lid in data.lead_ids:
        await log_activity(lid, activity("assigned", user, f"Assigned to Account Manager {u['name']}"))
    return {"ok": True, "updated": r.modified_count}


class ConvertInput(BaseModel):
    name: str | None = None
    value: float | None = None
    stage: str = "Discovery"


@router.post("/leads/{lead_id}/convert")
async def convert_lead(lead_id: str, data: ConvertInput, user=Depends(ANY_CRM)):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    if lead.get("opportunity_id"):
        raise HTTPException(400, "Lead already converted")
    num = await next_seq("crm_opp")
    opp_id = str(uuid.uuid4())
    snap = lead.get("medicare_snapshot") or {}
    name = data.name or (lead.get("org_name") or f"{lead.get('contact_first','')} {lead.get('contact_last','')}").strip() or lead["lead_number"]
    opp = {
        "id": opp_id, "opp_number": f"O-{num:05d}", "name": name,
        "lead_id": lead_id, "matched_npi": lead.get("matched_npi"),
        "account_id": lead.get("account_id"),
        "stage": data.stage, "status": "open",
        "value": data.value if data.value is not None else lead.get("est_value"),
        "owner_id": lead.get("account_manager_id") or user["id"],
        "created_by": user["id"], "created_at": now_iso(),
        "medicare_snapshot": snap,
        "stage_history": [{"from": None, "to": data.stage, "by_id": user["id"],
                           "by_name": user.get("name"), "at": now_iso()}],
    }
    await db.crm_opportunities.insert_one(dict(opp))
    opp.pop("_id", None)
    await db.crm_leads.update_one({"id": lead_id}, {"$set": {
        "status": "Opportunity", "opportunity_id": opp_id},
        "$push": {"status_history": {"from": lead.get("status"), "to": "Opportunity",
                  "by_id": user["id"], "by_name": user.get("name"),
                  "reason": "Converted to opportunity", "at": now_iso()}}})
    await log_activity(lead_id, activity("converted", user, f"Converted to opportunity {opp['opp_number']}"))
    return opp


class NoteInput(BaseModel):
    text: str
    visibility: str = "team"
    pinned: bool = False


@router.post("/leads/{lead_id}/notes")
async def add_note(lead_id: str, data: NoteInput, user=Depends(ANY_CRM)):
    note = {"id": str(uuid.uuid4()), "text": data.text, "author_id": user["id"],
            "author_name": user.get("name"), "visibility": data.visibility,
            "pinned": data.pinned, "created_at": now_iso(), "edited_at": None, "edits": []}
    r = await db.crm_leads.update_one({"id": lead_id}, {"$push": {"notes": note}})
    if r.matched_count == 0:
        raise HTTPException(404, "Lead not found")
    await log_activity(lead_id, activity("note", user, "Added a note", {"note_id": note["id"]}))
    return note


# ==================== ACCOUNTS & CONTACTS ====================
class AccountInput(BaseModel):
    name: str
    type: str | None = None
    city: str | None = None
    state: str | None = None


@router.get("/accounts")
async def list_accounts(user=Depends(ANY_CRM), q: str | None = None):
    query = {}
    if q:
        query["name"] = {"$regex": q.strip(), "$options": "i"}
    return await db.crm_accounts.find(query, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/accounts")
async def create_account(data: AccountInput, user=Depends(ANY_CRM)):
    doc = {"id": str(uuid.uuid4()), "name": data.name.strip(), "type": data.type,
           "city": data.city, "state": (data.state or "").upper() or None,
           "npis": [], "owner_id": user["id"], "created_at": now_iso()}
    await db.crm_accounts.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


class ContactInput(BaseModel):
    npi: str | None = None
    first_name: str
    last_name: str
    specialty: str | None = None
    city: str | None = None
    state: str | None = None
    phone: str | None = None
    email: str | None = None
    account_id: str | None = None


@router.get("/physicians")
async def list_contacts(user=Depends(ANY_CRM), q: str | None = None):
    query = {}
    if q:
        rx = {"$regex": q.strip(), "$options": "i"}
        query["$or"] = [{"last_name": rx}, {"first_name": rx}, {"npi": rx}]
    return await db.crm_physicians.find(query, {"_id": 0}).sort("last_name", 1).to_list(500)


@router.post("/physicians")
async def upsert_contact(data: ContactInput, user=Depends(ANY_CRM)):
    dup = None
    if data.npi:
        dup = await db.crm_physicians.find_one({"npi": data.npi}, {"_id": 0})
    if not dup:
        dup = await db.crm_physicians.find_one(
            {"first_name": {"$regex": f"^{data.first_name}$", "$options": "i"},
             "last_name": {"$regex": f"^{data.last_name}$", "$options": "i"},
             "state": (data.state or "").upper()}, {"_id": 0})
    if dup:
        return {"duplicate": True, "contact": dup}
    doc = {"id": str(uuid.uuid4()), "npi": data.npi, "first_name": data.first_name,
           "last_name": data.last_name, "specialty": data.specialty, "city": data.city,
           "state": (data.state or "").upper() or None, "phone": data.phone,
           "email": data.email, "account_id": data.account_id, "created_at": now_iso()}
    await db.crm_physicians.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"duplicate": False, "contact": doc}


# ==================== OPPORTUNITIES ====================
def _opp_scope(user: dict) -> dict:
    role = user.get("role")
    if role in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
        return {}
    return {"owner_id": user["id"]}


@router.get("/opportunities")
async def list_opps(request: Request, stage: str | None = None, status: str | None = None,
                    owner_id: str | None = None, limit: int = 200):
    user = await get_current_user(request)
    query = dict(_opp_scope(user))
    if stage:
        query["stage"] = stage
    if status:
        query["status"] = status
    if owner_id:
        query["owner_id"] = owner_id
    return await db.crm_opportunities.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)


class OppPatch(BaseModel):
    stage: str | None = None
    value: float | None = None
    status: str | None = None
    close_date: str | None = None


@router.patch("/opportunities/{opp_id}")
async def patch_opp(opp_id: str, data: OppPatch, user=Depends(ANY_CRM)):
    opp = await db.crm_opportunities.find_one({"id": opp_id}, {"_id": 0})
    if not opp:
        raise HTTPException(404, "Opportunity not found")
    patch = {k: v for k, v in data.dict().items() if v is not None}
    push = {}
    if "stage" in patch and patch["stage"] != opp.get("stage"):
        push["stage_history"] = {"from": opp.get("stage"), "to": patch["stage"],
                                 "by_id": user["id"], "by_name": user.get("name"), "at": now_iso()}
        if patch["stage"] == "Closed Won":
            patch["status"] = "won"
        elif patch["stage"] == "Closed Lost":
            patch["status"] = "lost"
    update = {"$set": patch}
    if push:
        update["$push"] = push
    await db.crm_opportunities.update_one({"id": opp_id}, update)
    if opp.get("lead_id"):
        await log_activity(opp["lead_id"], activity("opportunity", user,
                           f"Opportunity {opp['opp_number']} updated", patch))
    return await db.crm_opportunities.find_one({"id": opp_id}, {"_id": 0})


# ==================== TASKS ====================
class TaskInput(BaseModel):
    title: str
    description: str | None = None
    related_type: str | None = None
    related_id: str | None = None
    assigned_to: str | None = None
    due_at: str | None = None
    priority: str = "Medium"
    reminder_at: str | None = None


@router.post("/tasks")
async def create_task(data: TaskInput, user=Depends(ANY_CRM)):
    doc = {"id": str(uuid.uuid4()), "title": data.title, "description": data.description,
           "related_type": data.related_type, "related_id": data.related_id,
           "assigned_to": data.assigned_to or user["id"], "due_at": data.due_at,
           "priority": data.priority, "status": "Open", "reminder_at": data.reminder_at,
           "completion_notes": None, "created_by": user["id"], "created_at": now_iso()}
    await db.crm_tasks.insert_one(dict(doc))
    doc.pop("_id", None)
    if data.related_type == "lead" and data.related_id:
        await log_activity(data.related_id, activity("task", user, f"Task created: {data.title}"))
    return doc


@router.get("/tasks")
async def list_tasks(request: Request, scope: str = "my", status: str | None = None, limit: int = 200):
    user = await get_current_user(request)
    query = {}
    role = user.get("role")
    if scope == "my":
        query["assigned_to"] = user["id"]
    elif scope == "team" and role not in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
        query["assigned_to"] = user["id"]
    now = now_iso()
    if scope == "overdue":
        if role not in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
            query["assigned_to"] = user["id"]
        query["due_at"] = {"$lt": now}
        query["status"] = {"$nin": ["Completed", "Cancelled"]}
    elif scope == "upcoming":
        if role not in (ROLE_ADMIN, ROLE_LEAD_MANAGER):
            query["assigned_to"] = user["id"]
        query["due_at"] = {"$gte": now}
        query["status"] = {"$nin": ["Completed", "Cancelled"]}
    if status:
        query["status"] = status
    return await db.crm_tasks.find(query, {"_id": 0}).sort("due_at", 1).to_list(limit)


class TaskPatch(BaseModel):
    status: str | None = None
    completion_notes: str | None = None
    due_at: str | None = None
    assigned_to: str | None = None
    priority: str | None = None


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: str, data: TaskPatch, user=Depends(ANY_CRM)):
    patch = {k: v for k, v in data.dict().items() if v is not None}
    if patch.get("status") == "Completed":
        patch["completed_at"] = now_iso()
    r = await db.crm_tasks.update_one({"id": task_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "Task not found")
    return await db.crm_tasks.find_one({"id": task_id}, {"_id": 0})


# ==================== SAVED SEARCHES ====================
class SavedSearchInput(BaseModel):
    name: str
    entity: str = "medicare"
    query: dict


@router.get("/saved-searches")
async def list_saved(request: Request, entity: str | None = None):
    user = await get_current_user(request)
    q = {"user_id": user["id"]}
    if entity:
        q["entity"] = entity
    return await db.crm_saved_searches.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/saved-searches")
async def create_saved(data: SavedSearchInput, user=Depends(ANY_CRM)):
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "name": data.name,
           "entity": data.entity, "query": data.query, "created_at": now_iso()}
    await db.crm_saved_searches.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.delete("/saved-searches/{sid}")
async def delete_saved(sid: str, user=Depends(ANY_CRM)):
    await db.crm_saved_searches.delete_one({"id": sid, "user_id": user["id"]})
    return {"ok": True}


# ==================== REPORTS / DASHBOARDS ====================
@router.get("/reports")
async def reports(request: Request, type: str = "lead_manager"):
    user = await get_current_user(request)
    now = now_iso()
    if type == "account_manager" or user.get("role") == ROLE_ACCOUNT_MANAGER:
        me = user["id"]
        my_leads = await db.crm_leads.count_documents({"account_manager_id": me})
        my_opps = await db.crm_opportunities.find({"owner_id": me, "status": "open"}, {"_id": 0}).to_list(500)
        pipeline_value = {}
        for o in my_opps:
            pipeline_value[o.get("stage")] = pipeline_value.get(o.get("stage"), 0) + (o.get("value") or 0)
        tasks_due = await db.crm_tasks.count_documents(
            {"assigned_to": me, "status": {"$nin": ["Completed", "Cancelled"]}, "due_at": {"$lt": now}})
        meetings = await db.crm_meetings.count_documents(
            {"owner_id": me, "status": {"$in": ["Scheduled", "Rescheduled"]}, "start_at": {"$gte": now}})
        return {"my_leads": my_leads, "my_open_opps": len(my_opps),
                "pipeline_value_by_stage": pipeline_value, "tasks_overdue": tasks_due,
                "upcoming_meetings": meetings}
    # Lead manager / admin
    by_status = {d["_id"]: d["count"] async for d in db.crm_leads.aggregate(
        [{"$group": {"_id": "$status", "count": {"$sum": 1}}}])}
    by_source = {d["_id"]: d["count"] async for d in db.crm_leads.aggregate(
        [{"$group": {"_id": "$source", "count": {"$sum": 1}}}])}
    by_am = {d["_id"] or "Unassigned": d["count"] async for d in db.crm_leads.aggregate(
        [{"$group": {"_id": "$account_manager_id", "count": {"$sum": 1}}}])}
    unassigned = await db.crm_leads.count_documents({"account_manager_id": None})
    needs_match = await db.crm_leads.count_documents({"medicare_match_status": {"$ne": "matched"}})
    total = await db.crm_leads.count_documents({})
    opp_count = await db.crm_leads.count_documents({"opportunity_id": {"$exists": True}})
    conv = round((opp_count / total * 100), 1) if total else 0
    overdue = await db.crm_tasks.count_documents(
        {"status": {"$nin": ["Completed", "Cancelled"]}, "due_at": {"$lt": now}})
    meetings = await db.crm_meetings.count_documents(
        {"status": {"$in": ["Scheduled", "Rescheduled"]}, "start_at": {"$gte": now}})
    return {"total_leads": total, "by_status": by_status, "by_source": by_source,
            "by_account_manager": by_am, "unassigned": unassigned,
            "needs_medicare_match": needs_match, "conversion_rate": conv,
            "tasks_overdue": overdue, "upcoming_meetings": meetings}
