"""Auth: email + PIN login, role-based. Kiosk device registration."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from deps import db, verify_pin, create_token, get_current_user, hash_pin, credential_ok

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
        ok, msg = credential_ok(data.new_pin)
        if not ok:
            raise HTTPException(400, msg)
    if verify_pin(data.new_pin, full["pin_hash"]):
        raise HTTPException(400, "New PIN must be different from the current PIN")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "pin_hash": hash_pin(data.new_pin), "must_change_pin": False}})
    return {"ok": True}


class ForgotPinInput(BaseModel):
    email: str


@router.post("/forgot-pin")
async def forgot_pin(data: ForgotPinInput):
    """Public self-service PIN reset. Always returns the same response so it
    never reveals whether an email exists. Rate-limited to 3 / 15 min / email."""
    from datetime import datetime, timezone, timedelta
    email = (data.email or "").strip().lower()
    generic = {"ok": True, "message": "If an account exists for that email, a temporary PIN has been sent."}
    if not email:
        return generic
    now = datetime.now(timezone.utc)
    window = (now - timedelta(minutes=15)).isoformat()
    recent = await db.pin_reset_attempts.count_documents({"email": email, "at": {"$gte": window}})
    await db.pin_reset_attempts.insert_one({"email": email, "at": now.isoformat()})
    if recent >= 3:
        return generic
    user = await db.users.find_one({"email": email})
    if user and user.get("active") is not False:
        from routes_users import _gen_temp_pin, _send_reset
        pin = _gen_temp_pin()
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "pin_hash": hash_pin(pin), "must_change_pin": True}})
        await _send_reset(user.get("name"), email, pin)
    return generic


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
