"""Wave 15 — Marketing Campaigns: event campaigns, public capture forms,
and source attribution into the CRM pipeline."""
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from deps import db, require_roles, get_current_user
from crm_common import now_iso, next_seq, log_event, DEFAULT_COMM

router = APIRouter(prefix="/api/crm")
public_router = APIRouter(prefix="/api/public")
MANAGER = require_roles("lead_manager")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")

CAMPAIGN_CHANNELS = ["Event / Booth", "Email", "Social", "Referral", "Website", "Paid Ads", "Other"]
CAMPAIGN_STATUSES = ["Draft", "Active", "Paused", "Completed"]
CAPTURE_FIELDS = ["contact_first", "contact_last", "org_name", "email", "phone", "specialty", "city", "state"]


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "campaign").lower()).strip("-")[:40] or "campaign"
    return f"{base}-{uuid.uuid4().hex[:6]}"


def _default_capture(name: str) -> dict:
    return {
        "enabled": True,
        "slug": _slugify(name),
        "headline": f"Connect with us — {name}",
        "subhead": "Share your details and our team will reach out shortly.",
        "fields": ["contact_first", "contact_last", "org_name", "email", "phone"],
        "interests": [],
        "thank_you": "Thanks! We've received your details and will be in touch soon.",
        "require_email": True,
    }


class CaptureConfig(BaseModel):
    enabled: bool | None = None
    headline: str | None = None
    subhead: str | None = None
    fields: list[str] | None = None
    interests: list[str] | None = None
    thank_you: str | None = None
    require_email: bool | None = None


class CampaignInput(BaseModel):
    name: str
    description: str | None = None
    channel: str = "Event / Booth"
    status: str = "Draft"
    event_id: str | None = None
    budget: float | None = None
    goal_leads: int | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    capture: CaptureConfig | None = None


@router.get("/campaigns/meta")
async def campaign_meta(user=Depends(ANY_CRM)):
    return {"channels": CAMPAIGN_CHANNELS, "statuses": CAMPAIGN_STATUSES,
            "capture_fields": CAPTURE_FIELDS}


async def _perf(campaign_id: str) -> dict:
    leads = await db.crm_leads.find(
        {"campaign_id": campaign_id}, {"_id": 0, "id": 1, "status": 1, "opportunity_id": 1}).to_list(5000)
    captured = len(leads)
    by_status: dict = {}
    for l in leads:
        by_status[l.get("status")] = by_status.get(l.get("status"), 0) + 1
    opp_ids = [l["opportunity_id"] for l in leads if l.get("opportunity_id")]
    converted = len(opp_ids)
    won = by_status.get("Won", 0)
    pipeline_value = won_value = 0.0
    if opp_ids:
        for o in await db.crm_opportunities.find(
                {"id": {"$in": opp_ids}}, {"_id": 0, "value": 1, "status": 1}).to_list(5000):
            val = o.get("value") or 0
            if o.get("status") == "won":
                won_value += val
            elif o.get("status") == "open":
                pipeline_value += val
    return {
        "captured": captured, "by_status": by_status,
        "converted": converted, "won": won,
        "conversion_rate": round(converted / captured * 100, 1) if captured else 0,
        "pipeline_value": round(pipeline_value, 2), "won_value": round(won_value, 2),
    }


@router.get("/campaigns")
async def list_campaigns(user=Depends(MANAGER)):
    campaigns = await db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for c in campaigns:
        c["stats"] = await _perf(c["id"])
    return campaigns


@router.post("/campaigns")
async def create_campaign(data: CampaignInput, user=Depends(MANAGER)):
    if data.channel not in CAMPAIGN_CHANNELS:
        raise HTTPException(400, "Invalid channel")
    if data.status not in CAMPAIGN_STATUSES:
        raise HTTPException(400, "Invalid status")
    num = await next_seq("crm_campaign")
    capture = _default_capture(data.name)
    if data.capture:
        patch = {k: v for k, v in data.capture.dict().items() if v is not None}
        capture.update(patch)
    doc = {
        "id": str(uuid.uuid4()), "campaign_number": f"C-{num:05d}",
        "name": data.name.strip(), "description": data.description,
        "channel": data.channel, "status": data.status, "event_id": data.event_id,
        "budget": data.budget, "goal_leads": data.goal_leads,
        "utm_source": data.utm_source, "utm_medium": data.utm_medium,
        "utm_campaign": data.utm_campaign or _slugify(data.name).rsplit("-", 1)[0],
        "capture": capture,
        "created_by": user["id"], "created_by_name": user.get("name"), "created_at": now_iso(),
    }
    await db.campaigns.insert_one(dict(doc))
    doc.pop("_id", None)
    doc["stats"] = await _perf(doc["id"])
    return doc


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user=Depends(MANAGER)):
    c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Campaign not found")
    c["stats"] = await _perf(campaign_id)
    c["recent_leads"] = await db.crm_leads.find(
        {"campaign_id": campaign_id}, {"_id": 0, "activity": 0}).sort("created_at", -1).to_list(50)
    return c


class CampaignPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    channel: str | None = None
    status: str | None = None
    event_id: str | None = None
    budget: float | None = None
    goal_leads: int | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    capture: CaptureConfig | None = None


@router.patch("/campaigns/{campaign_id}")
async def patch_campaign(campaign_id: str, data: CampaignPatch, user=Depends(MANAGER)):
    c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Campaign not found")
    patch = {k: v for k, v in data.dict().items() if v is not None and k != "capture"}
    if data.capture is not None:
        capture = dict(c.get("capture") or _default_capture(c["name"]))
        capture.update({k: v for k, v in data.capture.dict().items() if v is not None})
        patch["capture"] = capture
    if patch:
        await db.campaigns.update_one({"id": campaign_id}, {"$set": patch})
    out = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    out["stats"] = await _perf(campaign_id)
    return out


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, user=Depends(MANAGER)):
    await db.campaigns.delete_one({"id": campaign_id})
    return {"ok": True}


# ==================== PUBLIC CAPTURE FORM (no auth) ====================
def _public_view(c: dict) -> dict:
    cap = c.get("capture") or {}
    return {
        "name": c.get("name"), "channel": c.get("channel"), "status": c.get("status"),
        "headline": cap.get("headline"), "subhead": cap.get("subhead"),
        "fields": cap.get("fields") or [], "interests": cap.get("interests") or [],
        "require_email": cap.get("require_email", True), "thank_you": cap.get("thank_you"),
        "enabled": cap.get("enabled", False),
    }


@public_router.get("/campaigns/{slug}")
async def public_get_form(slug: str):
    c = await db.campaigns.find_one({"capture.slug": slug}, {"_id": 0})
    if not c or not (c.get("capture") or {}).get("enabled"):
        raise HTTPException(404, "Form not found")
    return _public_view(c)


class CaptureSubmit(BaseModel):
    contact_first: str | None = None
    contact_last: str | None = None
    org_name: str | None = None
    email: str | None = None
    phone: str | None = None
    specialty: str | None = None
    city: str | None = None
    state: str | None = None
    interests: list[str] = []


@public_router.post("/campaigns/{slug}/submit")
async def public_submit(slug: str, data: CaptureSubmit):
    c = await db.campaigns.find_one({"capture.slug": slug}, {"_id": 0})
    cap = (c or {}).get("capture") or {}
    if not c or not cap.get("enabled"):
        raise HTTPException(404, "Form not found")
    if c.get("status") in ("Paused", "Completed"):
        raise HTTPException(409, "This form is no longer accepting submissions")
    if cap.get("require_email", True) and not (data.email and data.email.strip()):
        raise HTTPException(400, "Email is required")
    if not any([data.contact_first, data.contact_last, data.org_name, data.email, data.phone]):
        raise HTTPException(400, "Please provide at least a name or contact detail")

    num = await next_seq("crm_lead")
    lead_id = str(uuid.uuid4())
    doc = {
        "id": lead_id, "lead_number": f"L-{num:05d}",
        "org_name": data.org_name, "contact_first": data.contact_first,
        "contact_last": data.contact_last, "phone": data.phone, "email": data.email,
        "source": "Campaign", "source_details": c.get("name"),
        "campaign_id": c["id"], "campaign_name": c.get("name"),
        "utm_source": c.get("utm_source"), "utm_campaign": c.get("utm_campaign"),
        "status": "New", "priority": "Medium", "tags": list(data.interests or []),
        "lead_manager_id": None, "account_manager_id": None,
        "est_value": None, "qualification_notes": None, "lost_reason": None,
        "specialty": data.specialty, "city": data.city,
        "state": (data.state or "").upper() or None,
        "medicare_match_status": "unmatched", "matched_npi": None,
        "dataset_year": None, "medicare_snapshot": None,
        "created_by": None, "created_by_name": f"Capture: {c.get('name')}",
        "created_at": now_iso(), "last_activity_at": now_iso(), "next_activity_at": None,
        "comm": dict(DEFAULT_COMM),
        "notes": [], "activity": [],
        "status_history": [{"from": None, "to": "New", "by_id": None,
                            "by_name": "Capture form", "reason": None, "at": now_iso()}],
    }
    await db.crm_leads.insert_one(dict(doc))
    doc.pop("_id", None)
    await log_event("lead", lead_id, "created", None,
                    f"Lead captured via campaign '{c.get('name')}'",
                    meta={"campaign_id": c["id"], "channel": c.get("channel")}, lead_id=lead_id)

    # Auto-route to a rep if territories/teams are configured (best-effort).
    try:
        from routes_teams import auto_route_lead
        await auto_route_lead(doc, None)
    except Exception:
        pass
    # Fire automation rules (best-effort).
    try:
        from automation import fire_event
        await fire_event("lead_created", doc, None)
    except Exception:
        pass

    return {"ok": True, "lead_number": doc["lead_number"], "thank_you": cap.get("thank_you")}
