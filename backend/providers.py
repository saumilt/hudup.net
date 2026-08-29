"""Provider abstraction + admin-configurable settings.

Vendor-specific logic lives behind these provider slots so BoothIQ is not
coupled to any single vendor. Credentials come from env (never the browser).
Phase 1 wires: enrichment=People Data Labs, email=Resend. SMS/voice/calendar
are declared here as slots for later phases.
"""
import os

from deps import db
from crm_common import now_iso

# Static catalog of provider slots and which vendor + env key powers each.
PROVIDER_CATALOG = [
    {"slot": "enrichment", "label": "Contact & Company Enrichment",
     "vendor": "People Data Labs", "env_key": "PDL_API_KEY",
     "kind": "manual_or_auto", "cost_per_call": "1 credit"},
    {"slot": "professional_profile", "label": "Professional / LinkedIn Discovery",
     "vendor": "People Data Labs", "env_key": "PDL_API_KEY",
     "kind": "manual_or_auto", "cost_per_call": "1 credit"},
    {"slot": "email", "label": "Transactional Email",
     "vendor": "Resend", "env_key": "RESEND_API_KEY",
     "kind": "send", "cost_per_call": None},
    {"slot": "mailbox_oauth", "label": "Mailbox Connect (Gmail / Outlook)",
     "vendor": "OAuth", "env_key": None, "kind": "send_receive", "cost_per_call": None},
    {"slot": "messaging", "label": "Two-Way SMS",
     "vendor": "Twilio", "env_key": "TWILIO_ACCOUNT_SID", "kind": "send_receive",
     "cost_per_call": None},
    {"slot": "voice", "label": "Browser Calling & Conference",
     "vendor": "Twilio Voice", "env_key": "TWILIO_TWIML_APP_SID", "kind": "call",
     "cost_per_call": None},
]

_DEFAULT_SETTINGS = {
    "enabled": True, "auto": False, "priority": 1,
    "monthly_budget": None, "usage_count": 0, "usage_month": None,
}


def _env_configured(env_key: str | None) -> bool:
    return bool(env_key and os.environ.get(env_key))


async def get_provider_settings() -> list[dict]:
    """Merge the static catalog with any admin overrides + live 'configured' flag."""
    overrides = {d["slot"]: d async for d in db.provider_settings.find({}, {"_id": 0})}
    out = []
    for p in PROVIDER_CATALOG:
        s = dict(_DEFAULT_SETTINGS)
        s.update(overrides.get(p["slot"], {}))
        out.append({**p, **s, "configured": _env_configured(p["env_key"])})
    return out


async def get_slot(slot: str) -> dict | None:
    for p in await get_provider_settings():
        if p["slot"] == slot:
            return p
    return None


async def is_slot_ready(slot: str) -> bool:
    p = await get_slot(slot)
    return bool(p and p["enabled"] and p["configured"])


async def set_provider_setting(slot: str, patch: dict):
    allowed = {k: v for k, v in patch.items()
               if k in ("enabled", "auto", "priority", "monthly_budget")}
    await db.provider_settings.update_one(
        {"slot": slot}, {"$set": {**allowed, "slot": slot, "updated_at": now_iso()}}, upsert=True)
    return await get_slot(slot)


async def record_usage(slot: str, n: int = 1):
    import datetime
    month = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m")
    cur = await db.provider_settings.find_one({"slot": slot}, {"_id": 0, "usage_month": 1})
    if not cur or cur.get("usage_month") != month:
        await db.provider_settings.update_one(
            {"slot": slot}, {"$set": {"slot": slot, "usage_month": month, "usage_count": n}}, upsert=True)
    else:
        await db.provider_settings.update_one({"slot": slot}, {"$inc": {"usage_count": n}})
