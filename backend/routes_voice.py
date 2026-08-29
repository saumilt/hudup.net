"""Twilio Programmable Voice — browser click-to-call softphone (web).
Gated OFF until TWILIO_API_KEY_SID/SECRET + TWILIO_TWIML_APP_SID + TWILIO_VOICE_FROM_NUMBER
are all set. Outbound only: the browser sends a lead_id; the TwiML webhook resolves the
lead's phone server-side and dials it. Calls auto-log to the lead timeline via the
<Dial action> status callback."""
import os
import uuid
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.twiml.voice_response import VoiceResponse, Dial

from deps import db, require_roles
from crm_common import (ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF,
                        now_iso, log_event)

router = APIRouter(prefix="/api/voice")
ANY_CRM = require_roles(ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF)

ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
API_KEY_SID = os.environ.get("TWILIO_API_KEY_SID", "")
API_KEY_SECRET = os.environ.get("TWILIO_API_KEY_SECRET", "")
TWIML_APP_SID = os.environ.get("TWILIO_TWIML_APP_SID", "")
VOICE_FROM = os.environ.get("TWILIO_VOICE_FROM_NUMBER", "")

_STATUS_DISPOSITION = {
    "completed": "Connected", "answered": "Connected", "busy": "Busy",
    "no-answer": "No Answer", "failed": "Failed", "canceled": "Canceled",
}


def _configured() -> bool:
    return all([ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET, TWIML_APP_SID, VOICE_FROM])


def _e164(phone: str | None) -> str | None:
    if not phone:
        return None
    phone = phone.strip()
    digits = "".join(c for c in phone if c.isdigit())
    if phone.startswith("+"):
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return "+" + digits if digits else None


@router.get("/config")
async def voice_config(user=Depends(ANY_CRM)):
    return {"enabled": _configured(), "from_number": VOICE_FROM or None}


@router.get("/token")
async def voice_token(user=Depends(ANY_CRM)):
    if not _configured():
        return {"enabled": False, "token": None}
    identity = "rep_" + "".join(c if c.isalnum() else "_" for c in user["id"])[:110]
    token = AccessToken(ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET, identity=identity, ttl=3600)
    token.add_grant(VoiceGrant(outgoing_application_sid=TWIML_APP_SID, incoming_allow=False))
    jwt = token.to_jwt()
    if isinstance(jwt, bytes):
        jwt = jwt.decode("utf-8")
    return {"enabled": True, "token": jwt, "identity": identity}


@router.post("/twiml", include_in_schema=False)
async def voice_twiml(request: Request):
    """Twilio Voice webhook. Reads the browser's connect params, resolves the lead's
    phone, and returns TwiML that dials it from the configured caller ID."""
    form = dict(await request.form())
    lead_id = form.get("lead_id")
    call_sid = form.get("CallSid")
    vr = VoiceResponse()
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0}) if lead_id else None
    to = _e164((lead or {}).get("phone"))
    if not (_configured() and lead and to):
        vr.say("Sorry, this call cannot be completed. The number is unavailable.")
        return Response(content=str(vr), media_type="application/xml")
    # Stage a pending call log keyed by the parent CallSid.
    await db.calls.update_one(
        {"call_sid": call_sid},
        {"$setOnInsert": {
            "id": str(uuid.uuid4()), "call_sid": call_sid, "lead_id": lead_id,
            "direction": "outbound", "source": "browser", "status": "initiated",
            "to": to, "by_id": form.get("by_id"), "by_name": form.get("by_name"),
            "at": now_iso()}},
        upsert=True)
    dial = Dial(caller_id=VOICE_FROM, timeout=30, answer_on_bridge=True,
                action=f"/api/voice/status?lead_id={lead_id}", method="POST")
    dial.number(to)
    vr.append(dial)
    return Response(content=str(vr), media_type="application/xml")


@router.post("/status", include_in_schema=False)
async def voice_status(request: Request, lead_id: str | None = None):
    """<Dial action> callback — final PSTN leg outcome. Updates the call log and
    writes a timeline entry (idempotent by parent CallSid)."""
    form = dict(await request.form())
    call_sid = form.get("CallSid")
    dial_status = (form.get("DialCallStatus") or "unknown").lower()
    dur = form.get("DialCallDuration")
    duration = int(dur) if dur and dur.isdigit() else 0
    disposition = _STATUS_DISPOSITION.get(dial_status, dial_status.title())
    call = await db.calls.find_one({"call_sid": call_sid}, {"_id": 0})
    lid = lead_id or (call or {}).get("lead_id")
    already_logged = bool(call and call.get("status") not in (None, "initiated"))
    await db.calls.update_one(
        {"call_sid": call_sid},
        {"$set": {"status": dial_status, "disposition": disposition,
                  "duration_sec": duration, "child_call_sid": form.get("DialCallSid"),
                  "ended_at": now_iso()},
         "$setOnInsert": {"id": str(uuid.uuid4()), "call_sid": call_sid, "lead_id": lid,
                          "direction": "outbound", "source": "browser", "at": now_iso()}},
        upsert=True)
    if lid and not already_logged:
        actor = None
        if call and call.get("by_id"):
            actor = {"id": call.get("by_id"), "name": call.get("by_name") or "Rep"}
        mins = f"{duration // 60}m {duration % 60}s" if duration else "no answer"
        await log_event("lead", lid, "call", actor,
                        f"Browser call — {disposition} ({mins})",
                        {"disposition": disposition, "duration_sec": duration, "source": "browser"})
    vr = VoiceResponse()
    return Response(content=str(vr), media_type="application/xml")
