"""Meeting notifications: ICS invite generation, Twilio SMS reminders (live),
and email / Google Calendar hooks that activate once their keys are configured."""
import os
from datetime import datetime

from deps import send_sms


def _dt(v: str) -> str:
    """ISO string -> ICS UTC stamp (YYYYMMDDTHHMMSSZ)."""
    if not v:
        return ""
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        return d.strftime("%Y%m%dT%H%M%SZ")
    except Exception:
        return ""


def build_ics(m: dict) -> str:
    uid = m.get("id", "meeting") + "@boothiq"
    start = _dt(m.get("start_at"))
    end = _dt(m.get("end_at")) or start
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BoothIQ//CRM//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
        f"UID:{uid}", f"DTSTAMP:{_dt(datetime.utcnow().isoformat())}",
        f"DTSTART:{start}", f"DTEND:{end}",
        f"SUMMARY:{m.get('title', 'Meeting')}",
        f"DESCRIPTION:{(m.get('agenda') or '').replace(chr(10), ' ')}",
        f"LOCATION:{m.get('location') or m.get('type') or ''}",
        "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
    ]
    return "\r\n".join(lines)


def _email_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY") and os.environ.get("RESEND_FROM"))


def send_email_invite(to: str, subject: str, html: str, ics: str | None = None) -> dict:
    """Send an email invite via Resend if configured, else report skipped."""
    if not _email_configured():
        return {"channel": "email", "status": "not_configured"}
    try:
        import requests
        attachments = []
        if ics:
            import base64
            attachments = [{"filename": "invite.ics",
                            "content": base64.b64encode(ics.encode()).decode()}]
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
                     "Content-Type": "application/json"},
            json={"from": os.environ["RESEND_FROM"], "to": [to],
                  "subject": subject, "html": html, "attachments": attachments},
            timeout=20,
        )
        resp.raise_for_status()
        return {"channel": "email", "status": "sent", "id": resp.json().get("id")}
    except Exception as e:
        return {"channel": "email", "status": "failed", "error": str(e)}


def _gcal_configured() -> bool:
    return bool(os.environ.get("GOOGLE_CALENDAR_TOKEN"))


def sync_google_calendar(m: dict) -> dict:
    """Reserved: create/update a Google Calendar event. Activated when Google
    Calendar OAuth credentials are configured."""
    if not _gcal_configured():
        return {"channel": "google_calendar", "status": "not_configured"}
    return {"channel": "google_calendar", "status": "pending_integration"}


def notify_meeting(m: dict, kind: str) -> list[dict]:
    """Fire enabled channels for a meeting event (scheduled/rescheduled/cancelled)."""
    results = []
    verb = {"scheduled": "scheduled", "rescheduled": "rescheduled",
            "cancelled": "cancelled", "reminder": "reminder for"}.get(kind, "updated")
    when = m.get("start_at", "")
    body = f"BoothIQ: Meeting '{m.get('title')}' {verb} for {when}."
    ext = m.get("external_attendee") or {}
    if ext.get("mobile"):
        r = send_sms(ext["mobile"], body)
        results.append({"channel": "sms", "to": ext["mobile"], **r})
    # Email + Google Calendar (active only when configured).
    if ext.get("email"):
        html = f"<p>{body}</p><p>{(m.get('agenda') or '')}</p>"
        results.append(send_email_invite(ext["email"], f"Meeting {verb}: {m.get('title')}",
                                         html, build_ics(m) if kind != "cancelled" else None))
    results.append(sync_google_calendar(m))
    return results
