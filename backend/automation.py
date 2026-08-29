"""Automation engine: WHEN [event] IF [conditions] THEN [actions].
Default-safe: favors task/draft creation; external sends require explicit action type."""
import uuid
from datetime import datetime, timezone, timedelta

from deps import db
from crm_common import now_iso, log_event

EVENTS = ["lead_created", "lead_assigned", "status_changed", "medicare_matched",
          "opportunity_created", "meeting_completed"]
CONDITION_FIELDS = ["status", "priority", "source", "state", "specialty",
                    "tier_340b", "tier_rpm", "medicare_match_status"]
ACTION_TYPES = ["create_task", "notify_manager", "change_status", "add_tag",
                "start_sequence", "schedule_followup"]


def _resolve(field, lead):
    snap = lead.get("medicare_snapshot") or {}
    if field in ("tier_340b", "tier_rpm"):
        return snap.get(field)
    if field == "specialty":
        return lead.get("specialty") or snap.get("specialty")
    if field == "state":
        return lead.get("state") or snap.get("state")
    return lead.get(field)


def _cmp(actual, op, val):
    a = (str(actual) if actual is not None else "").lower()
    v = (str(val) if val is not None else "").lower()
    if op == "eq":
        return a == v
    if op == "ne":
        return a != v
    if op == "contains":
        return v in a
    if op == "in":
        return a in [x.strip().lower() for x in (val if isinstance(val, list) else str(val).split(","))]
    return False


def _match(conditions, lead):
    for c in conditions or []:
        if not _cmp(_resolve(c.get("field"), lead), c.get("op", "eq"), c.get("value")):
            return False
    return True


async def _run_actions(rule, lead, user):
    lid = lead["id"]
    for a in rule.get("actions") or []:
        t = a.get("type")
        try:
            if t == "create_task":
                await db.crm_tasks.insert_one({
                    "id": str(uuid.uuid4()), "title": a.get("value") or "Automation task",
                    "type": "task", "related_type": "lead", "related_id": lid,
                    "assigned_to": lead.get("account_manager_id") or lead.get("lead_manager_id"),
                    "status": "open", "due_at": now_iso(), "created_at": now_iso()})
            elif t == "schedule_followup":
                due = (datetime.now(timezone.utc) + timedelta(days=int(a.get("value") or 3))).isoformat()
                await db.crm_tasks.insert_one({
                    "id": str(uuid.uuid4()), "title": "Follow up", "type": "call",
                    "related_type": "lead", "related_id": lid,
                    "assigned_to": lead.get("account_manager_id"), "status": "open",
                    "due_at": due, "created_at": now_iso()})
                await db.crm_leads.update_one({"id": lid}, {"$set": {"next_activity_at": due}})
            elif t == "change_status" and a.get("value"):
                await db.crm_leads.update_one({"id": lid}, {"$set": {"status": a["value"]}})
            elif t == "add_tag" and a.get("value"):
                await db.crm_leads.update_one({"id": lid}, {"$addToSet": {"tags": a["value"]}})
            elif t == "start_sequence" and a.get("value"):
                exists = await db.sequence_enrollments.find_one(
                    {"sequence_id": a["value"], "lead_id": lid, "status": "active"})
                if not exists:
                    await db.sequence_enrollments.insert_one({
                        "id": str(uuid.uuid4()), "sequence_id": a["value"], "lead_id": lid,
                        "status": "active", "current_step": 0, "next_run_at": now_iso(),
                        "enrolled_by": "automation", "started_at": now_iso()})
            await log_event("lead", lid, "automation", user,
                            f"Automation '{rule.get('name')}' → {t}", meta={"rule_id": rule.get("id")})
        except Exception:  # noqa: BLE001
            pass


async def fire_event(event, lead, user=None):
    if not lead:
        return
    rules = await db.automation_rules.find({"event": event, "active": True}, {"_id": 0}).to_list(100)
    for rule in rules:
        if _match(rule.get("conditions"), lead):
            await _run_actions(rule, lead, user)
