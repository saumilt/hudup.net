"""Wave 3 — practice/company enrichment, unified communications inbox, analytics."""
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event, provenance
from enrichment import enrich_company, EnrichmentError
from providers import record_usage

router = APIRouter(prefix="/api/crm")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")
MANAGER = require_roles("lead_manager")


# ==================== PRACTICE / COMPANY ENRICH ====================
@router.post("/leads/{lead_id}/enrich-company")
async def enrich_lead_company(lead_id: str, user=Depends(ANY_CRM)):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    snap = lead.get("medicare_snapshot") or {}
    try:
        r = await enrich_company(name=lead.get("org_name"),
                                 city=lead.get("city") or snap.get("city"),
                                 region=lead.get("state") or snap.get("state"))
        await record_usage("enrichment", 1)
    except EnrichmentError as e:
        if e.status == 404:
            return {"matched": False, "found": {}}
        raise HTTPException(e.status if e.status < 500 else 502, e.message)
    job_id = str(uuid.uuid4())
    await db.enrichment_jobs.insert_one({
        "id": job_id, "lead_id": lead_id, "kind": "company", "total": 1, "done": 1,
        "status": "completed", "found": r.get("fields"), "confidence": r.get("confidence"),
        "created_by": user["id"], "created_at": now_iso()})
    return {"matched": True, "job_id": job_id, "confidence": r.get("confidence"),
            "found": {k: v for k, v in (r.get("fields") or {}).items() if v}}


class AcceptCompanyInput(BaseModel):
    job_id: str
    fields: list[str]


@router.post("/leads/{lead_id}/enrich-company/accept")
async def accept_company(lead_id: str, data: AcceptCompanyInput, user=Depends(ANY_CRM)):
    job = await db.enrichment_jobs.find_one({"id": data.job_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    enr = (lead or {}).get("practice") or {}
    found = job.get("found") or {}
    applied = []
    for f in data.fields:
        if found.get(f) is not None:
            enr[f] = provenance(found[f], "People Data Labs (company)", job.get("confidence", "MEDIUM"))
            enr[f]["accepted_by"] = user.get("name")
            applied.append(f)
    await db.crm_leads.update_one({"id": lead_id}, {"$set": {"practice": enr}})
    await log_event("lead", lead_id, "enrichment", user, f"Practice enriched ({len(applied)} fields)",
                    meta={"fields": applied})
    return {"ok": True, "applied": applied}


# ==================== UNIFIED COMMUNICATIONS INBOX ====================
@router.get("/communications")
async def communications(channel: str = "all", scope: str = "all", user=Depends(ANY_CRM)):
    items = []
    if channel in ("all", "email"):
        for m in await db.email_messages.find({}, {"_id": 0}).sort("at", -1).to_list(150):
            items.append({"channel": "email", "direction": m.get("direction", "outbound"),
                          "lead_id": m.get("lead_id"), "preview": m.get("subject") or "",
                          "at": m.get("at"), "status": m.get("status"), "who": m.get("to") or m.get("from")})
    if channel in ("all", "sms"):
        for m in await db.sms_messages.find({}, {"_id": 0}).sort("at", -1).to_list(150):
            items.append({"channel": "sms", "direction": m.get("direction", "outbound"),
                          "lead_id": m.get("lead_id"), "preview": m.get("body") or "",
                          "at": m.get("at"), "status": m.get("status"), "who": m.get("to") or m.get("from")})
    if channel in ("all", "calls"):
        for a in await db.crm_activities.find({"kind": "call"}, {"_id": 0}).sort("at", -1).to_list(150):
            items.append({"channel": "call", "direction": "outbound", "lead_id": a.get("lead_id"),
                          "preview": a.get("summary") or "", "at": a.get("at"),
                          "status": (a.get("meta") or {}).get("disposition"), "who": a.get("by_name")})
    # Attach lead context + role scoping.
    lead_ids = list({i["lead_id"] for i in items if i.get("lead_id")})
    leads = {}
    if lead_ids:
        for l in await db.crm_leads.find({"id": {"$in": lead_ids}},
                {"_id": 0, "id": 1, "org_name": 1, "contact_first": 1, "contact_last": 1,
                 "status": 1, "account_manager_id": 1}).to_list(1000):
            leads[l["id"]] = l
    if user["role"] == "account_manager":
        items = [i for i in items if leads.get(i.get("lead_id"), {}).get("account_manager_id") == user["id"]]
    if scope == "needs_response":
        items = [i for i in items if i["direction"] == "inbound"]
    for i in items:
        l = leads.get(i.get("lead_id"), {})
        i["contact"] = l.get("org_name") or f"{l.get('contact_first','')} {l.get('contact_last','')}".strip() or "Unknown"
        i["lead_status"] = l.get("status")
    items.sort(key=lambda x: x.get("at") or "", reverse=True)
    counts = {"email": sum(1 for i in items if i["channel"] == "email"),
              "sms": sum(1 for i in items if i["channel"] == "sms"),
              "calls": sum(1 for i in items if i["channel"] == "call"),
              "needs_response": sum(1 for i in items if i["direction"] == "inbound")}
    return {"items": items[:200], "counts": counts}


# ==================== COMMUNICATION ANALYTICS ====================
@router.get("/analytics/communications")
async def comm_analytics(days: int = 30, user=Depends(MANAGER)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    emails = await db.email_messages.count_documents({"at": {"$gte": since}})
    sms_out = await db.sms_messages.count_documents({"at": {"$gte": since}, "direction": "outbound"})
    sms_in = await db.sms_messages.count_documents({"at": {"$gte": since}, "direction": "inbound"})
    calls = await db.crm_activities.count_documents({"kind": "call", "at": {"$gte": since}})
    dispo = await db.crm_activities.aggregate([
        {"$match": {"kind": "call", "at": {"$gte": since}}},
        {"$group": {"_id": "$meta.disposition", "n": {"$sum": 1}}}]).to_list(50)
    connected = sum(d["n"] for d in dispo if d["_id"] in ("Connected", "Interested", "Meeting Scheduled"))
    meetings = await db.crm_meetings.count_documents({"created_at": {"$gte": since}})
    opps = await db.crm_opportunities.count_documents({"created_at": {"$gte": since}})
    won = await db.crm_opportunities.count_documents({"created_at": {"$gte": since}, "status": "won"})
    return {
        "days": days,
        "emails_sent": emails, "sms_sent": sms_out, "sms_received": sms_in,
        "calls": calls, "calls_connected": connected,
        "connection_rate": round(connected / calls * 100, 1) if calls else 0,
        "meetings_booked": meetings, "opportunities": opps, "won": won,
        "dispositions": {(d["_id"] or "Unknown"): d["n"] for d in dispo},
    }
