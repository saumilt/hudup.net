"""Resend transactional email wrapper (server-side)."""
import os
import asyncio
import resend


class EmailError(Exception):
    pass


def _configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY"))


async def send_email(to: str, subject: str, html: str, text: str | None = None,
                     cc=None, bcc=None, reply_to: str | None = None,
                     scheduled_at: str | None = None) -> dict:
    if not _configured():
        raise EmailError("Email provider not configured")
    resend.api_key = os.environ["RESEND_API_KEY"]
    params = {
        "from": os.environ.get("RESEND_FROM", "BoothIQ <onboarding@resend.dev>"),
        "to": [to] if isinstance(to, str) else to,
        "subject": subject,
        "html": html,
    }
    if text:
        params["text"] = text
    if cc:
        params["cc"] = cc if isinstance(cc, list) else [cc]
    if bcc:
        params["bcc"] = bcc if isinstance(bcc, list) else [bcc]
    if reply_to:
        params["reply_to"] = reply_to
    if scheduled_at:
        params["scheduled_at"] = scheduled_at
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
    except Exception as e:  # noqa: BLE001
        raise EmailError(str(e))
    return {"id": res.get("id"), "status": "sent"}
