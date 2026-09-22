"""Daily assignment digest: one summary email per rep of leads assigned to them
in the last 24h (replaces per-import assignment emails). Admins pick the send time."""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from deps import db, require_roles, require_admin

logger = logging.getLogger("boothiq")
router = APIRouter(prefix="/api/crm/notifications")
MANAGER = require_roles("lead_manager")

DIGEST_KEY = "assignment_digest"
DEFAULT_DIGEST = {"enabled": True, "hour": 8, "minute": 0, "tz": "America/New_York"}


async def _digest_settings() -> dict:
    s = await db.app_settings.find_one({"_id": DIGEST_KEY}) or {}
    return {
        "enabled": s.get("enabled", DEFAULT_DIGEST["enabled"]),
        "hour": int(s.get("hour", DEFAULT_DIGEST["hour"])),
        "minute": int(s.get("minute", DEFAULT_DIGEST["minute"])),
        "tz": s.get("tz") or DEFAULT_DIGEST["tz"],
        "last_run_date": s.get("last_run_date"),
    }


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


@router.get("/digest/settings")
async def get_digest_settings(user=Depends(MANAGER)):
    return await _digest_settings()


class DigestSettings(BaseModel):
    enabled: bool = True
    hour: int = 8
    minute: int = 0
    tz: str = "America/New_York"


@router.put("/digest/settings")
async def put_digest_settings(data: DigestSettings, request: Request):
    """Admin-only: set whether/when the daily assignment digest goes out."""
    await require_admin(request)
    hour = max(0, min(23, int(data.hour)))
    minute = max(0, min(59, int(data.minute)))
    try:
        ZoneInfo(data.tz)
        tz = data.tz
    except Exception:  # noqa: BLE001
        tz = DEFAULT_DIGEST["tz"]
    await db.app_settings.update_one(
        {"_id": DIGEST_KEY},
        {"$set": {"enabled": bool(data.enabled), "hour": hour, "minute": minute, "tz": tz}},
        upsert=True)
    return await _digest_settings()


async def digest_worker():
    """Send the assignment digest once per day at the admin-configured local time.
    The first encounter records a baseline date (no send) so restarts never blast."""
    while True:
        await asyncio.sleep(300)  # check every 5 minutes
        try:
            s = await _digest_settings()
            if not s.get("enabled"):
                continue
            try:
                tz = ZoneInfo(s["tz"])
            except Exception:  # noqa: BLE001
                tz = ZoneInfo(DEFAULT_DIGEST["tz"])
            now_local = datetime.now(tz)
            today = now_local.date().isoformat()
            last = s.get("last_run_date")
            if last is None:
                await db.app_settings.update_one(
                    {"_id": DIGEST_KEY}, {"$set": {"last_run_date": today}}, upsert=True)
                continue
            if last == today:
                continue
            if (now_local.hour, now_local.minute) >= (s["hour"], s["minute"]):
                await run_assignment_digest(24)
                await db.app_settings.update_one(
                    {"_id": DIGEST_KEY}, {"$set": {"last_run_date": today}}, upsert=True)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Digest worker error (non-blocking): {e}")
