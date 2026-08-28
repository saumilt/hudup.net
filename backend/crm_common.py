"""Shared CRM constants, sequence counters, and small helpers."""
from datetime import datetime, timezone
from pymongo import ReturnDocument

from deps import db

# ---------------- Roles ----------------
ROLE_ADMIN = "admin"
ROLE_LEAD_MANAGER = "lead_manager"
ROLE_ACCOUNT_MANAGER = "account_manager"
ROLE_STAFF = "staff"
ALL_ROLES = [ROLE_ADMIN, ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF]
ROLE_LABELS = {
    ROLE_ADMIN: "Admin",
    ROLE_LEAD_MANAGER: "Lead Manager",
    ROLE_ACCOUNT_MANAGER: "Account Manager",
    ROLE_STAFF: "Booth Staff",
}

# ---------------- Lead lifecycle ----------------
LEAD_STATUSES = [
    "New", "Attempting Contact", "Contacted", "Qualified", "Meeting Scheduled",
    "Opportunity", "Nurture", "Won", "Lost", "Disqualified",
]
LEAD_SOURCES = [
    "Booth / Event", "Manual Entry", "Medicare Search", "CSV Import",
    "Referral", "Website", "Other",
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
