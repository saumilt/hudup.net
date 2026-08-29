"""Auth: email + PIN login, role-based. Kiosk device registration."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from deps import db, verify_pin, create_token, get_current_user, hash_pin

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
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    token = create_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                 "role": user["role"], "must_change_pin": user.get("must_change_pin", False)},
    }


class ChangePinInput(BaseModel):
    new_pin: str
    current_pin: str | None = None


@router.post("/change-pin")
async def change_pin(data: ChangePinInput, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not full:
        raise HTTPException(404, "User not found")
    # First-login temp PIN change skips current-PIN verification; otherwise verify.
    if not full.get("must_change_pin"):
        if not (data.current_pin and verify_pin(data.current_pin, full["pin_hash"])):
            raise HTTPException(400, "Current PIN is incorrect")
    if not (data.new_pin and data.new_pin.isdigit() and 4 <= len(data.new_pin) <= 8):
        raise HTTPException(400, "New PIN must be 4-8 digits")
    if verify_pin(data.new_pin, full["pin_hash"]):
        raise HTTPException(400, "New PIN must be different from the current PIN")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "pin_hash": hash_pin(data.new_pin), "must_change_pin": False}})
    return {"ok": True}


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
