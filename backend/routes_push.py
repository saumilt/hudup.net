"""Emergent-managed push notifications (SuprSend relay).
Backend registers device tokens and triggers pushes; the mobile app calls
/api/register-push. EMERGENT_PUSH_KEY is injected by the deploy pipeline."""
import os
import logging
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("boothiq")

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)

router = APIRouter(prefix="/api")


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str  # "android" | "ios"
    device_token: str


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    resp = await _client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


async def send_push(recipients: list[str], data: dict, idempotency_key: str | None = None) -> None:
    """Fire a push to a list of user IDs. Never raises to the caller."""
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    for i in range(0, len(recipients), 100):
        chunk = recipients[i:i + 100]
        payload: dict = {"recipients": chunk, "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = idempotency_key
        resp = await _client.post("/api/v1/push/trigger", json=payload)
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()


async def notify_lead_assigned(am_id: str, lead: dict) -> None:
    """Non-blocking push when a lead is assigned/routed to a rep."""
    if not am_id:
        return
    name = (lead.get("org_name")
            or f"{lead.get('contact_first', '')} {lead.get('contact_last', '')}".strip()
            or lead.get("lead_number") or "A new lead")
    try:
        await send_push(
            recipients=[am_id],
            data={
                "title": "New lead assigned",
                "message": f"{name} was just assigned to you.",
                "action_url": f"/lead/{lead.get('id')}",
            },
            idempotency_key=f"assign-{lead.get('id')}-{am_id}",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Push failed (non-blocking): {e}")
