"""Admin user management: create/list/update users and assign CRM roles."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from deps import db, require_admin, hash_pin, get_current_user
from crm_common import ALL_ROLES, ROLE_LABELS, now_iso

router = APIRouter(prefix="/api/users")


def _public(u: dict) -> dict:
    return {
        "id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"],
        "title": u.get("title"), "active": u.get("active", True),
        "created_at": u.get("created_at"),
    }


@router.get("")
async def list_users(request: Request, role: str | None = None):
    """Any authenticated user can list users (needed for assignment pickers)."""
    await get_current_user(request)
    q = {}
    if role:
        q["role"] = role
    users = await db.users.find(q, {"_id": 0, "pin_hash": 0}).sort("name", 1).to_list(500)
    for u in users:
        u.setdefault("active", True)
    return users


@router.get("/roles")
async def roles():
    return [{"value": r, "label": ROLE_LABELS[r]} for r in ALL_ROLES]


class CreateUserInput(BaseModel):
    email: str
    pin: str
    name: str
    role: str
    title: str | None = None


@router.post("")
async def create_user(data: CreateUserInput, admin=Depends(require_admin)):
    if data.role not in ALL_ROLES:
        raise HTTPException(400, "Invalid role")
    if not (data.pin and data.pin.isdigit() and 4 <= len(data.pin) <= 8):
        raise HTTPException(400, "PIN must be 4-8 digits")
    email = data.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "A user with that email already exists")
    doc = {
        "id": str(uuid.uuid4()), "email": email, "pin_hash": hash_pin(data.pin),
        "name": data.name.strip(), "role": data.role, "title": data.title,
        "active": True, "created_at": now_iso(),
    }
    await db.users.insert_one(dict(doc))
    return _public(doc)


class UpdateUserInput(BaseModel):
    name: str | None = None
    role: str | None = None
    title: str | None = None
    active: bool | None = None


@router.patch("/{user_id}")
async def update_user(user_id: str, data: UpdateUserInput, admin=Depends(require_admin)):
    patch = {k: v for k, v in data.dict().items() if v is not None}
    if "role" in patch and patch["role"] not in ALL_ROLES:
        raise HTTPException(400, "Invalid role")
    if not patch:
        return {"ok": True}
    r = await db.users.update_one({"id": user_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "User not found")
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "pin_hash": 0})
    return _public(u)


class ResetPinInput(BaseModel):
    pin: str


@router.post("/{user_id}/reset-pin")
async def reset_pin(user_id: str, data: ResetPinInput, admin=Depends(require_admin)):
    if not (data.pin and data.pin.isdigit() and 4 <= len(data.pin) <= 8):
        raise HTTPException(400, "PIN must be 4-8 digits")
    r = await db.users.update_one({"id": user_id}, {"$set": {"pin_hash": hash_pin(data.pin)}})
    if r.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}
