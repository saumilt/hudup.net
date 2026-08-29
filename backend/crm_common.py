"""Shared CRM constants, sequence counters, and small helpers."""
from datetime import datetime, timezone
from pymongo import ReturnDocument

from deps import db

# ---------------- Roles ----------------
ROLE_SUPER_ADMIN = "super_admin"
ROLE_ADMIN = "admin"
ROLE_LEAD_MANAGER = "lead_manager"
ROLE_ACCOUNT_MANAGER = "account_manager"
ROLE_STAFF = "staff"
ALL_ROLES = [ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF]
ROLE_LABELS = {
    ROLE_SUPER_ADMIN: "Super Admin",
    ROLE_ADMIN: "Admin",
    ROLE_LEAD_MANAGER: "Lead Manager",
    ROLE_ACCOUNT_MANAGER: "Account Manager",
    ROLE_STAFF: "Booth Staff",
}
ADMIN_ROLES = (ROLE_ADMIN, ROLE_SUPER_ADMIN)

# ---------------- Lead lifecycle ----------------
LEAD_STATUSES = [
    "New", "Attempting Contact", "Contacted", "Qualified", "Meeting Scheduled",
    "Opportunity", "Nurture", "Won", "Lost", "Disqualified",
]
LEAD_SOURCES = [
    "Booth / Event", "Manual Entry", "Medicare Search", "CSV Import",
    "Referral", "Website", "Campaign", "Other",
]
PRIORITIES = ["Low", "Medium", "High", "Urgent"]

# ---------------- Opportunity pipeline ----------------
DEFAULT_OPP_STAGES = [
    "Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost",
]

# ---------------- Tasks / Meetings ----------------
TASK_STATUSES = ["Open", "In Progress", "Completed", "Cancelled"]
MEETING_STATUSES = ["Scheduled", "Rescheduled", "Completed", "Cancelled", "No Show"]
MEETING_TYPES = ["In Person", "Video Call", "Phone Call"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def next_seq(name: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}},
        upsert=True, return_document=ReturnDocument.AFTER,
    )
    return doc["seq"]


def activity(kind: str, user: dict, summary: str, meta: dict | None = None) -> dict:
    return {
        "kind": kind,
        "by_id": user.get("id"),
        "by_name": user.get("name", "System"),
        "summary": summary,
        "meta": meta or {},
        "at": now_iso(),
    }


async def log_activity(lead_id: str, entry: dict):
    await db.crm_leads.update_one(
        {"id": lead_id},
        {"$push": {"activity": entry}, "$set": {"last_activity_at": entry["at"]}},
    )


# ---------------- Communication consent / preferences ----------------
DEFAULT_COMM = {
    "do_not_call": False,
    "do_not_text": False,
    "email_suppressed": False,
    "sms_consent": False,
    "sms_consent_source": None,
    "sms_consent_at": None,
    "opt_out_at": None,
    "preferred_method": None,   # email | phone | sms
    "preferred_time": None,
}

# ---------------- Unified activity timeline (crm_activities) ----------------
async def log_event(entity_type: str, entity_id: str, kind: str, user: dict | None,
                    summary: str, meta: dict | None = None, lead_id: str | None = None):
    """Central timeline entry. entity_type: lead|physician|account|opportunity."""
    entry = {
        "id": _uuid(),
        "entity_type": entity_type, "entity_id": entity_id,
        "lead_id": lead_id or (entity_id if entity_type == "lead" else None),
        "kind": kind,
        "by_id": (user or {}).get("id"), "by_name": (user or {}).get("name", "System"),
        "summary": summary, "meta": meta or {}, "at": now_iso(),
    }
    await db.crm_activities.insert_one(dict(entry))
    entry.pop("_id", None)
    if entry["lead_id"]:
        await db.crm_leads.update_one({"id": entry["lead_id"]},
                                      {"$set": {"last_activity_at": entry["at"]}})
    return entry


def confidence_band(likelihood: int | None) -> str:
    """PDL likelihood is 1-10. Map to confidence band."""
    if likelihood is None:
        return "LOW"
    if likelihood >= 8:
        return "HIGH"
    if likelihood >= 6:
        return "MEDIUM"
    return "LOW"


def provenance(value, source: str, confidence: str, url: str | None = None, previous=None) -> dict:
    return {
        "value": value, "source": source, "source_url": url,
        "confidence": confidence, "retrieved_at": now_iso(),
        "verified": False, "accepted_by": None, "previous_value": previous,
    }


def _uuid() -> str:
    import uuid
    return str(uuid.uuid4())
