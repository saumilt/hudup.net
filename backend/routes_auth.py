"""Auth: email + PIN login, role-based. Kiosk device registration."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from deps import db, verify_pin, create_token, get_current_user

router = APIRouter(prefix="/api/auth")


class LoginInput(BaseModel):
    email: str
    pin: str


@router.post("/login")
async def login(data: LoginInput):
    email = data.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_pin(data.pin, user["pin_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or PIN")
    token = create_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]},
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


class DeviceInput(BaseModel):
    device_id: str | None = None
    label: str | None = None
    booth: str | None = None


@router.post("/kiosk/register")
async def register_kiosk(data: DeviceInput):
    """Kiosk registers its device id. No login required, but leads are tagged."""
    device_id = data.device_id or str(uuid.uuid4())
    existing = await db.devices.find_one({"device_id": device_id}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "device_id": device_id,
        "label": data.label or "iPad Kiosk",
        "booth": data.booth or "Booth 1",
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.devices.insert_one(dict(doc))
    return doc


@router.get("/kiosk/devices")
async def list_devices(request: Request):
    await get_current_user(request)
    return await db.devices.find({}, {"_id": 0}).to_list(200)
