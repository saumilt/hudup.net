"""Doctor-facing kiosk + wheel. CRITICAL: responses to the kiosk NEVER contain a
score, tier, dollar figure, or Medicare data. Scoring happens server-side only."""
import os
import uuid
import random
import string
import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter
from pydantic import BaseModel

from deps import db, ws_manager, get_thresholds, get_live_session, get_setting, send_sms
from scoring import score_340b, score_rpm, tier_color_340b, TIER_HEX
from matching import npi_is_valid, match_status_from_collisions, is_matched

router = APIRouter(prefix="/api/kiosk")

COMMON_SPECIALTIES = [
    "Internal Medicine", "Family Practice", "Cardiology", "Hematology-Oncology",
    "Nephrology", "Endocrinology", "Pulmonary Disease", "Nurse Practitioner",
    "Physician Assistant", "General Practice", "Geriatric Medicine",
]
ALL_SPECIALTIES = COMMON_SPECIALTIES + [
    "Dermatology", "Rheumatology", "Neurology", "Psychiatry", "Gastroenterology",
    "Orthopedic Surgery", "Ophthalmology", "Urology", "Pediatrics", "Other",
]
US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
             "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
             "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
             "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
             "WI", "WY"]


@router.get("/events")
async def kiosk_events():
    """Public list of events for kiosk setup on the front page (no scoring data)."""
    events = await db.events.find({}, {"_id": 0, "id": 1, "name": 1, "color_scheme": 1, "convention_state": 1}).to_list(100)
    return events


@router.get("/config")
async def kiosk_config(event_id: str = "default"):
    event = await db.events.find_one({"id": event_id}, {"_id": 0}) or {}
    # Prize set: event's set if configured, else the globally active set.
    ps = None
    if event.get("prize_set_id"):
        ps = await db.prize_sets.find_one({"id": event["prize_set_id"]}, {"_id": 0})
    if not ps:
        ps = await db.prize_sets.find_one({"active": True}, {"_id": 0})
    segments = []
    if ps:
        for s in ps["segments"]:
            inv = s.get("inventory")
            if inv is None or inv > 0:
                segments.append({"id": s["id"], "label": s["label"], "color": s["color"]})
    # Associates for the "who helped you" picker. Prefer this event's assigned
    # associates; if none are assigned, fall back to the full staff roster so the
    # dropdown always appears.
    associates = []
    if event.get("associate_ids"):
        associates = await db.staff_roster.find({"id": {"$in": event["associate_ids"]}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
    if not associates:
        associates = await db.staff_roster.find({}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
    convention_state = event.get("convention_state") or await get_setting("convention_state", "TX")
    return {
        "event_id": event.get("id", "default"),
        "event_name": event.get("name", "Default Event"),
        "color_scheme": event.get("color_scheme", {"primary": "#047857", "accent": "#10B981"}),
        "convention_state": convention_state,
        "associates": associates,
        "common_specialties": COMMON_SPECIALTIES,
        "all_specialties": ALL_SPECIALTIES,
        "states": US_STATES,
        "wheel_segments": segments,
        "wheel_mute": await get_setting("wheel_mute", False),
    }


class ResolveInput(BaseModel):
    last_name: str
    state: str
    first_initial: str


@router.post("/resolve")
async def resolve_name(data: ResolveInput):
    """Name-based autofill picker. Always requires first initial; returns a short
    list of practices or a too_many flag prompting for the NPI instead."""
    live = await get_live_session()
    if not live:
        return {"candidates": [], "too_many": False}
    q = {
        "session_id": live["id"],
        "last_upper": data.last_name.strip().upper(),
        "state": data.state.strip().upper(),
        "first_initial": data.first_initial.strip().upper(),
    }
    total = await db.physicians.count_documents(q)
    if total > 12:
        return {"candidates": [], "too_many": True, "count": total}
    docs = await db.physicians.find(q, {"_id": 0, "npi": 1, "city": 1, "specialty": 1, "first_name": 1, "last_name": 1}).to_list(12)
    return {"candidates": docs, "too_many": False, "count": total}


class LeadInput(BaseModel):
    first_name: str
    last_name: str
    phone: str | None = None
    email: str | None = None
    npi: str | None = None
    practice: str | None = None
    practice_type: str | None = None  # Employee | Private Practice | Group
    city: str | None = None
    state: str | None = None
    specialty: str | None = None
    interests: list[str] = []
    contact_consent: bool = False
    sms_consent: bool = False
    consent_text: str = ""
    device_id: str | None = None
    event_id: str = "default"
    associate_id: str | None = None
    associate_name: str | None = None
    client_created_at: str | None = None  # for offline delay detection


async def _match_physician(data: LeadInput, live: dict):
    """Returns (physician_doc_or_None, match_status, collision_count)."""
    if not live:
        return None, "unresolved", 0
    sid = live["id"]
    # Prefer direct NPI capture.
    if data.npi and npi_is_valid(data.npi):
        phys = await db.physicians.find_one({"session_id": sid, "npi": data.npi}, {"_id": 0})
        if phys:
            collisions = await db.physicians.count_documents(
                {"session_id": sid, "first_upper": phys["first_upper"], "last_upper": phys["last_upper"]})
            return phys, "confirmed", collisions
    # Fall back to name + location resolution.
    if data.last_name and data.state:
        q = {"session_id": sid, "last_upper": data.last_name.strip().upper(),
             "state": data.state.strip().upper()}
        if data.first_name:
            q["first_initial"] = data.first_name[:1].upper()
        candidates = await db.physicians.find(q, {"_id": 0}).to_list(200)
        # Narrow by location (city) when the name is ambiguous — search by name AND location.
        if len(candidates) > 1 and data.city:
            city_u = data.city.strip().upper()
            city_matches = [c for c in candidates if (c.get("city") or "").strip().upper() == city_u]
            if len(city_matches) == 1:
                phys = city_matches[0]
                collisions = await db.physicians.count_documents(
                    {"session_id": sid, "first_upper": phys["first_upper"], "last_upper": phys["last_upper"]})
                # Location disambiguated the physician -> treat as confirmed.
                return phys, "confirmed", collisions
        if len(candidates) == 1:
            phys = candidates[0]
            collisions = await db.physicians.count_documents(
                {"session_id": sid, "first_upper": phys["first_upper"], "last_upper": phys["last_upper"]})
            return phys, match_status_from_collisions(collisions), collisions
    return None, "unresolved", 0


@router.post("/leads")
async def create_lead(data: LeadInput):
    live = await get_live_session()
    thresholds = await get_thresholds()
    phys, status, collisions = await _match_physician(data, live)
    matched = is_matched(status) and phys is not None

    if matched:
        avg = phys.get("avg_per_claim", 0)
        cost = phys.get("tot_cost", 0)
        clms = phys.get("tot_clms", 0)
        specialty = data.specialty or phys.get("specialty", "")
        tier_340b = score_340b(True, avg, cost, thresholds)
        tier_rpm = score_rpm(True, clms, specialty)
        npi = phys.get("npi")
        med = {"tot_clms": clms, "tot_cost": cost, "avg_per_claim": avg}
        cms_extra = {"extra": phys.get("extra", {}), "raw": phys.get("raw", {}),
                     "row_count": phys.get("row_count")}
    else:
        tier_340b = "GREY"
        tier_rpm = "GREY"
        npi = data.npi if (data.npi and npi_is_valid(data.npi)) else None
        med = {"tot_clms": None, "tot_cost": None, "avg_per_claim": None}
        specialty = data.specialty or ""
        cms_extra = None

    device = None
    booth = "Booth 1"
    if data.device_id:
        device = await db.devices.find_one({"device_id": data.device_id}, {"_id": 0})
        if device:
            booth = device.get("booth", "Booth 1")

    lead_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    delayed = False
    if data.client_created_at:
        try:
            cca = datetime.fromisoformat(data.client_created_at.replace("Z", "+00:00"))
            delayed = (now - cca).total_seconds() > 60
        except Exception:
            pass

    # Green-shaded 340B color + base RPM color for the dashboard bands and SMS text.
    shade_340b, color_340b = tier_color_340b(tier_340b, (med.get("avg_per_claim") or 0))
    color_rpm = TIER_HEX.get(tier_rpm, "#CBD5E1")

    lead = {
        "id": lead_id,
        "first_name": data.first_name, "last_name": data.last_name,
        "phone": data.phone, "email": data.email, "npi": npi,
        "practice": data.practice, "practice_type": data.practice_type,
        "city": data.city or (phys.get("city") if phys else None),
        "state": data.state or (phys.get("state") if phys else None),
        "specialty": specialty or (phys.get("specialty") if phys else None),
        "interests": data.interests,
        "contact_consent": data.contact_consent, "sms_consent": data.sms_consent,
        "consent_text": data.consent_text,
        "consent_timestamp": now.isoformat(),
        "match_status": status, "collision_count": collisions,
        "tier_340b": tier_340b, "tier_rpm": tier_rpm,
        "shade_340b": shade_340b, "color_340b": color_340b, "color_rpm": color_rpm,
        "medicare": med,
        "cms_extra": cms_extra,
        "device_id": data.device_id, "booth": booth,
        "event_id": data.event_id,
        "associate_id": data.associate_id, "associate_name": data.associate_name,
        "spun": False, "prize": None,
        "assigned_to": None, "notes": [],
        "callback_date": None, "appointment_at": None,
        "captured_offline": bool(data.client_created_at),
        "created_at": now.isoformat(),
    }
    await db.leads.insert_one(dict(lead))

    # Push to staff dashboard (staff CAN see scores).
    dash = {k: v for k, v in lead.items()}
    await ws_manager.broadcast("dashboard", {"type": "new_lead", "lead": dash})

    # Fire SMS alerts (server-side only, never to the physician).
    asyncio.create_task(_dispatch_alerts(lead, delayed))

    # Kiosk response: ZERO score/dollar/medicare data.
    return {"id": lead_id, "spin_available": True}


def _fmt_money(v):
    if v is None:
        return "$0"
    if v >= 1_000_000:
        return f"${v/1_000_000:.1f}M"
    if v >= 1000:
        return f"${v/1000:.0f}K"
    return f"${v:.0f}"


async def _dispatch_alerts(lead: dict, delayed: bool):
    rules_doc = await db.alert_rules.find_one({"event_id": lead.get("event_id", "default")}) or {}
    rules = rules_doc.get("rules", {})
    ceiling = rules_doc.get("ceiling_per_hour", 20)
    app_url = os.environ.get("APP_URL", "")
    event = await db.events.find_one({"id": lead.get("event_id", "default")}, {"_id": 0}) or {}
    event_associates = event.get("associate_ids") or None

    priority = {"GREEN": 0, "YELLOW": 1, "BLUE": 2, "RED": 3, "GREY": 4}
    triggered = []  # (label, tier, recipients)
    for score_key, label in (("340b", "340B"), ("rpm", "RPM")):
        tier = lead["tier_340b"] if score_key == "340b" else lead["tier_rpm"]
        rule = rules.get(score_key, {}).get(tier)
        if rule and rule.get("send"):
            triggered.append((label, tier, rule.get("recipients", "all")))
    triggered.sort(key=lambda x: priority.get(x[1], 9))

    # Build target staff -> headline (label, tier). One text per staffer (deduped).
    targets = {}
    for label, tier, recipients in triggered:
        roster = await db.staff_roster.find({"on_duty": True}, {"_id": 0}).to_list(200)
        if event_associates:
            roster = [r for r in roster if r["id"] in event_associates]
        if recipients != "all" and isinstance(recipients, list):
            roster = [r for r in roster if r["id"] in recipients]
        for st in roster:
            targets.setdefault(st["id"], (st, label, tier))

    # ALWAYS notify the employee the doctor selected, regardless of tier, so they
    # get the lead + link to add notes.
    if lead.get("associate_id"):
        assoc = await db.staff_roster.find_one({"id": lead["associate_id"]}, {"_id": 0})
        if assoc and assoc["id"] not in targets:
            hl = (triggered[0][0], triggered[0][1]) if triggered else ("340B", lead.get("tier_340b", "GREY"))
            targets[assoc["id"]] = (assoc, hl[0], hl[1])

    if not targets:
        return

    med = lead.get("medicare", {})
    name = f"Dr. {lead['first_name']} {lead['last_name']}"
    loc = f"{lead.get('city') or ''} {lead.get('state') or ''}".strip()
    for _, (staff, label, tier) in targets.items():
        existing = await db.alert_logs.find_one({"lead_id": lead["id"], "staff_id": staff["id"]})
        if existing:
            continue
        color = lead.get("color_340b") if label == "340B" else lead.get("color_rpm")
        shade = lead.get("shade_340b") if label == "340B" else tier
        if med.get("tot_clms") is not None:
            figures = f"{int(med.get('tot_clms') or 0):,} claims, {_fmt_money(med.get('tot_cost'))}, ${int(med.get('avg_per_claim') or 0):,}/claim"
        else:
            figures = "unmatched lead"
        link = f"{app_url}/lead/{lead['id']}" if app_url else ""
        body = f"[{color}] {shade} {label} — {name}, {lead.get('specialty') or 'Unknown'}, {loc}. {figures}. {lead.get('booth', '')}. Open: {link}".strip()
        since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        recent = await db.alert_logs.count_documents(
            {"staff_id": staff["id"], "status": "sent", "created_at": {"$gte": since}})
        log = {
            "id": str(uuid.uuid4()), "lead_id": lead["id"], "staff_id": staff["id"],
            "staff_name": staff["name"], "to": staff["mobile"],
            "score_type": label, "tier": tier, "body": body,
            "delayed": delayed, "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if recent >= ceiling:
            log.update({"status": "digest", "sid": None, "error": "Hourly ceiling reached — digest fallback"})
            await db.alert_logs.insert_one(dict(log))
            continue
        result = await asyncio.to_thread(send_sms, staff["mobile"], body)
        log.update({"status": result["status"], "sid": result["sid"], "error": result["error"]})
        await db.alert_logs.insert_one(dict(log))
        await ws_manager.broadcast("dashboard", {"type": "alert", "log": {k: v for k, v in log.items()}})


@router.get("/leads/{lead_id}/glow")
async def lead_glow(lead_id: str):
    """Staff hack: return ONLY an ambient color hex for the wheel surround (no tier
    word, no numbers) so the booth employee can read the doctor's potential at a
    glance. Gated by the admin 'wheel_tier_glow' toggle; off => no color leaks."""
    enabled = await get_setting("wheel_tier_glow", True)
    if not enabled:
        return {"glow": None}
    lead = await db.leads.find_one(
        {"id": lead_id},
        {"_id": 0, "tier_340b": 1, "tier_rpm": 1, "color_340b": 1, "color_rpm": 1},
    )
    if not lead:
        return {"glow": None}
    priority = {"GREEN": 0, "YELLOW": 1, "BLUE": 2, "RED": 3, "GREY": 4}
    p340 = priority.get(lead.get("tier_340b"), 9)
    prpm = priority.get(lead.get("tier_rpm"), 9)
    color340 = lead.get("color_340b") or "#CBD5E1"
    color_rpm = lead.get("color_rpm") or "#CBD5E1"
    higher = color340 if p340 <= prpm else color_rpm
    # outer ring = 340B, inner ring = RPM
    return {"glow": higher, "glow_340b": color340, "glow_rpm": color_rpm}


@router.post("/leads/{lead_id}/spin")
async def spin_wheel(lead_id: str):
    # Atomic guard: one spin per lead, enforced server-side.
    lead = await db.leads.find_one({"id": lead_id})
    if not lead:
        return {"error": "Lead not found"}
    if lead.get("spun"):
        return {"error": "already_spun", "prize": lead.get("prize")}

    ps = await db.prize_sets.find_one({"active": True})
    if not ps:
        return {"error": "no_prizes"}
    eligible = [s for s in ps["segments"] if (s.get("inventory") is None or s.get("inventory", 0) > 0)]
    if not eligible:
        return {"error": "no_inventory"}

    # Resolve prize in code with weighted probability BEFORE any animation.
    weights = [max(s.get("weight", 1), 0) for s in eligible]
    total = sum(weights) or 1
    r = random.uniform(0, total)
    acc = 0
    chosen = eligible[-1]
    for s, w in zip(eligible, weights):
        acc += w
        if r <= acc:
            chosen = s
            break

    code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    prize = {"segment_id": chosen["id"], "label": chosen["label"], "color": chosen["color"],
             "prize_name": chosen.get("prize_name", chosen["label"]), "code": code}

    # Claim the spin atomically.
    res = await db.leads.update_one(
        {"id": lead_id, "spun": False},
        {"$set": {"spun": True, "prize": prize, "spun_at": datetime.now(timezone.utc).isoformat()}})
    if res.modified_count == 0:
        fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
        return {"error": "already_spun", "prize": fresh.get("prize")}

    # Decrement inventory; auto-remove at zero happens naturally via eligibility filter.
    if chosen.get("inventory") is not None:
        await db.prize_sets.update_one(
            {"id": ps["id"], "segments.id": chosen["id"]},
            {"$inc": {"segments.$.inventory": -1}})

    await ws_manager.broadcast("dashboard", {"type": "spin", "lead_id": lead_id, "prize": prize})
    return {"prize": prize}
