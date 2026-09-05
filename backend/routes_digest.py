"""Daily assignment digest: one summary email per rep of leads assigned to them
in the last 24h (replaces per-import assignment emails)."""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends

from deps import db, require_roles
from crm_common import now_iso

logger = logging.getLogger("boothiq")
router = APIRouter(prefix="/api/crm/notifications")
MANAGER = require_roles("lead_manager")

DIGEST_KEY = "assignment_digest"


async def run_assignment_digest(window_hours: int = 24) -> dict:
    """Email each rep a summary of leads assigned to them within the window."""
    since = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).isoformat()
    leads = await db.crm_leads.find(
        {"routed_at": {"$gte": since}, "account_manager_id": {"$ne": None}},
        {"_id": 0, "id": 1, "lead_number": 1, "org_name": 1, "contact_first": 1,
         "contact_last": 1, "account_manager_id": 1, "medicare_snapshot": 1}).to_list(10000)
    by_rep: dict = {}
    for l in leads:
        by_rep.setdefault(l["account_manager_id"], []).append(l)
    sent = 0
    from emailer import send_email
    for rep_id, items in by_rep.items():
        user = await db.users.find_one({"id": rep_id}, {"_id": 0, "email": 1, "name": 1})
        if not user or not user.get("email"):
            continue
        rows = ""
        for l in items[:25]:
            name = (l.get("org_name")
                    or f"{l.get('contact_first', '')} {l.get('contact_last', '')}".strip()
                    or l.get("lead_number"))
            tier = (l.get("medicare_snapshot") or {}).get("tier_340b") or "—"
            rows += f"<li><b>{l.get('lead_number')}</b> — {name} <span style='color:#888'>({tier} 340B)</span></li>"
        more = f"<p>…and {len(items) - 25} more.</p>" if len(items) > 25 else ""
        html = (f"<p>Hi {user.get('name') or 'there'},</p>"
                f"<p>You had <b>{len(items)}</b> new lead(s) assigned to you in the last {window_hours} hours:</p>"
                f"<ul>{rows}</ul>{more}"
                f"<p>Sign in to BoothIQ to start working them.</p>")
        try:
            await send_email(to=user["email"],
                             subject=f"BoothIQ — {len(items)} new lead(s) assigned to you",
                             html=html)
            sent += 1
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Digest email failed for {rep_id} (non-blocking): {e}")
    return {"reps_notified": sent, "total_leads": len(leads)}


@router.post("/digest/run")
async def trigger_digest(window_hours: int = 24, user=Depends(MANAGER)):
    """Manual trigger (managers) — useful for testing the digest on demand."""
    return await run_assignment_digest(window_hours)


async def digest_worker():
    """Run the assignment digest once per day. First encounter only records the
    baseline (no send) so a restart never blasts a digest."""
    while True:
        await asyncio.sleep(3600)  # hourly check
        try:
            setting = await db.app_settings.find_one({"_id": DIGEST_KEY})
            now = datetime.now(timezone.utc)
            last = setting.get("last_run") if setting else None
            if last is None:
                await db.app_settings.update_one(
                    {"_id": DIGEST_KEY}, {"$set": {"last_run": now.isoformat()}}, upsert=True)
                continue
            if (now - datetime.fromisoformat(last)) >= timedelta(hours=24):
                await run_assignment_digest(24)
                await db.app_settings.update_one(
                    {"_id": DIGEST_KEY}, {"$set": {"last_run": now.isoformat()}}, upsert=True)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Digest worker error (non-blocking): {e}")
