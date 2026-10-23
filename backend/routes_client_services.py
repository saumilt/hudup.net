"""Provider onboarding, service enrollment, operational referrals and website inquiries."""
import hashlib
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from deps import db, require_roles, require_admin, JWT_SECRET
from crm_common import now_iso, log_event
from routes_crm import _lead_scope, create_lead, LeadInput
from client_services import (
    CLIENT_STATUSES, DEFAULT_SERVICES, GENERIC_STATUSES, REFERRAL_STATUSES,
    ORGANIZATION_TYPES, ClientProfileInput, ServiceInput, ReferralInput,
    ReferralStatusInput, DemoInput,
)

router = APIRouter(prefix="/api/crm")
public_router = APIRouter(prefix="/api/public")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")


def scoped_query(user, **fields):
    # An $and preserves ownership restrictions when adding other filters.
    return {"$and": [_lead_scope(user), {"archived": {"$ne": True}, **fields}]}


async def visible_lead(lead_id, user):
    lead = await db.crm_leads.find_one(scoped_query(user, id=lead_id), {"_id": 0})
    if not lead:
        raise HTTPException(404, "Client not found")
    return lead


async def service_catalog():
    custom = await db.crm_service_catalog.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return DEFAULT_SERVICES + custom


@router.get("/client-services/meta")
async def service_meta(user=Depends(ANY_CRM)):
    return {"client_statuses": CLIENT_STATUSES, "services": await service_catalog(),
            "referral_statuses": REFERRAL_STATUSES}


@router.post("/client-services/catalog")
async def add_service(data: ServiceInput, user=Depends(require_admin)):
    existing = await service_catalog()
    key = data.name.casefold()
    match = next((s for s in existing if s["name"].casefold() == key), None)
    if match:
        return match
    # A deterministic id makes concurrent duplicate creates idempotent.
    sid = "custom-" + hashlib.sha256(key.encode()).hexdigest()[:20]
    doc = {"id": sid, "name": data.name, "statuses": GENERIC_STATUSES,
           "created_by": user["id"], "created_at": now_iso()}
    await db.crm_service_catalog.update_one({"_id": sid}, {"$setOnInsert": doc}, upsert=True)
    return await db.crm_service_catalog.find_one({"_id": sid}, {"_id": 0})


@router.get("/client-services/clients")
async def clients(q: str = "", client_status: str = "", service_id: str = "",
                  limit: int = 200, user=Depends(ANY_CRM)):
    import re
    fields = {"client_profile": {"$exists": True}}
    if client_status:
        if client_status not in CLIENT_STATUSES:
            raise HTTPException(400, "Invalid client status")
        fields["client_profile.client_status"] = client_status
    if service_id:
        fields["client_profile.services.service_id"] = service_id
    query = scoped_query(user, **fields)
    if q.strip():
        rx = {"$regex": re.escape(q.strip()[:160]), "$options": "i"}
        query["$and"].append({"$or": [{"org_name": rx}, {"contact_first": rx},
                                    {"contact_last": rx}, {"email": rx}]})
    return await db.crm_leads.find(query, {"_id": 0, "activity": 0, "notes": 0}).sort(
        "client_profile.updated_at", -1).to_list(max(1, min(limit, 500)))


@router.put("/leads/{lead_id}/client-profile")
async def save_profile(lead_id: str, data: ClientProfileInput, user=Depends(ANY_CRM)):
    lead = await visible_lead(lead_id, user)
    if data.client_status not in CLIENT_STATUSES:
        raise HTTPException(400, "Invalid client status")
    catalog = {s["id"]: s for s in await service_catalog()}
    previous = lead.get("client_profile") or {}
    old_services = {s["service_id"]: s for s in previous.get("services", [])}
    stamp = now_iso()
    enrollments = []
    for s in data.services:
        definition = catalog.get(s.service_id)
        if not definition or s.status not in definition["statuses"]:
            raise HTTPException(400, "Invalid service or service status")
        old = old_services.get(s.service_id, {})
        enrollment = s.model_dump()
        enrollment["name"] = definition["name"]
        enrollment["updated_at"] = old.get("updated_at", stamp) if (
            old.get("status") == s.status and old.get("partner", "") == s.partner
        ) else stamp
        enrollments.append(enrollment)
    profile = {"client_status": data.client_status, "services": enrollments,
               "updated_at": stamp, "updated_by": user["id"]}
    await db.crm_leads.update_one(scoped_query(user, id=lead_id), {"$set": {"client_profile": profile}})
    await log_event("lead", lead_id, "client_services", user,
                    "Client onboarding and services updated",
                    {"from": previous, "to": profile})
    return profile


@router.get("/service-referrals")
async def list_referrals(lead_id: str = "", service_id: str = "", status: str = "",
                         limit: int = 200, user=Depends(ANY_CRM)):
    # Join against visible leads in the database; never materialize an unscoped referral list.
    pipeline = [
        {"$match": {**({"lead_id": lead_id} if lead_id else {}),
                    **({"service_id": service_id} if service_id else {}),
                    **({"status": status} if status else {})}},
        {"$lookup": {"from": "crm_leads", "localField": "lead_id", "foreignField": "id", "as": "client"}},
        {"$unwind": "$client"},
    ]
    scope = _lead_scope(user)
    client_scope = {"$or": [{"client." + k: v for k, v in c.items()} for c in scope["$or"]]} if scope.get("$or") else {}
    pipeline += [
        {"$match": {"client.archived": {"$ne": True}, **client_scope}},
        {"$sort": {"created_at": -1}},
        {"$limit": max(1, min(limit, 500))},
        {"$project": {"_id": 0, "id": 1, "lead_id": 1, "service_id": 1, "service_name": 1,
                      "destination": 1, "reference": 1, "status": 1, "created_at": 1,
                      "updated_at": 1, "history": 1, "created_by_name": 1,
                      "client_name": {"$ifNull": ["$client.org_name", "$client.lead_number"]}}},
    ]
    return await db.crm_service_referrals.aggregate(pipeline).to_list(max(1, min(limit, 500)))


@router.post("/leads/{lead_id}/service-referrals")
async def create_referral(lead_id: str, data: ReferralInput, user=Depends(ANY_CRM)):
    await visible_lead(lead_id, user)
    definition = next((s for s in await service_catalog() if s["id"] == data.service_id), None)
    if not definition or data.status not in REFERRAL_STATUSES:
        raise HTTPException(400, "Invalid service or referral status")
    stamp = now_iso()
    doc = {"id": str(uuid.uuid4()), "lead_id": lead_id, **data.model_dump(),
           "service_name": definition["name"], "created_by": user["id"],
           "created_by_name": user.get("name"), "created_at": stamp, "updated_at": stamp,
           "history": [{"from": None, "to": data.status, "at": stamp, "by_id": user["id"]}]}
    await db.crm_service_referrals.insert_one(dict(doc))
    await log_event("lead", lead_id, "service_referral", user,
                    "Referral submitted: " + definition["name"],
                    {"referral_id": doc["id"], "destination": data.destination})
    return doc


@router.patch("/service-referrals/{referral_id}")
async def update_referral(referral_id: str, data: ReferralStatusInput, user=Depends(ANY_CRM)):
    if data.status not in REFERRAL_STATUSES:
        raise HTTPException(400, "Invalid referral status")
    referral = await db.crm_service_referrals.find_one({"id": referral_id}, {"_id": 0})
    if not referral:
        raise HTTPException(404, "Referral not found")
    await visible_lead(referral["lead_id"], user)
    if referral["status"] == data.status:
        return referral
    stamp = now_iso()
    entry = {"from": referral["status"], "to": data.status, "at": stamp, "by_id": user["id"]}
    result = await db.crm_service_referrals.update_one(
        {"id": referral_id, "updated_at": referral["updated_at"]},
        {"$set": {"status": data.status, "updated_at": stamp}, "$push": {"history": entry}})
    if not result.matched_count:
        raise HTTPException(409, "Referral changed. Refresh and try again.")
    await log_event("lead", referral["lead_id"], "service_referral", user,
                    "Referral status: " + data.status, {"referral_id": referral_id, **entry})
    return await db.crm_service_referrals.find_one({"id": referral_id}, {"_id": 0})


@public_router.post("/request-demo", status_code=202)
async def request_demo(data: DemoInput, request: Request):
    if data.website:
        return {"received": True}
    if not data.consent:
        raise HTTPException(400, "Please agree to be contacted about your request")
    if data.organization_type not in ORGANIZATION_TYPES:
        raise HTTPException(400, "Select an organization type")
    allowed = {s["id"] for s in DEFAULT_SERVICES}
    if any(s not in allowed for s in data.services):
        raise HTTPException(400, "Select a valid service")
    # Rate limit using the direct peer address; ignore untrusted forwarded headers.
    host = request.client.host if request.client else "unknown"
    digest = hashlib.sha256((JWT_SECRET + host).encode()).hexdigest()
    hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    from pymongo import ReturnDocument
    bucket = await db.website_rate_limits.find_one_and_update(
        {"_id": hour + ":" + digest}, {"$inc": {"count": 1},
        "$setOnInsert": {"expires_at": datetime.now(timezone.utc) + timedelta(hours=2)}},
        upsert=True, return_document=ReturnDocument.AFTER)
    if bucket["count"] > 10:
        raise HTTPException(429, "Too many requests. Please try again later.")
    # Identical retries within a day do not create duplicate CRM leads.
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    duplicate = await db.crm_leads.find_one({"source": "Website", "email": data.email,
        "org_name": data.organization, "created_at": {"$gte": since}})
    if not duplicate:
        first, _, last = data.contact_name.partition(" ")
        system = {"id": "website", "name": "Website inquiry", "role": "system"}
        lead = await create_lead(LeadInput(
            org_name=data.organization, contact_first=first, contact_last=last,
            email=data.email, source="Website", source_details=data.organization_type,
            qualification_notes="Requested a HudlUp demo. Permission to contact supplied.",
            tags=["Website demo", data.organization_type],
        ), user=system)
        profile = {"client_status": "Not Started", "services": [
            {"service_id": s["id"], "name": s["name"], "status": "Not Started", "partner": "",
             "updated_at": now_iso()} for s in DEFAULT_SERVICES if s["id"] in data.services
        ], "updated_at": now_iso(), "updated_by": "website"}
        # Public requests remain unassigned for manager review; never trust ownership from the form.
        await db.crm_leads.update_one({"id": lead["id"]}, {"$set": {
            "client_profile": profile, "account_manager_id": None,
            "website_contact_consent": {"granted": True, "at": now_iso(), "purpose": "Demo request"},
        }})
    return {"received": True}
