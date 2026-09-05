"""Admin user management: create/list/update users and assign CRM roles."""
import os
import uuid
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from deps import db, require_admin, hash_pin, get_current_user, credential_ok
from crm_common import ALL_ROLES, ROLE_LABELS, now_iso
from emailer import send_email, EmailError

router = APIRouter(prefix="/api/users")


def _public(u: dict) -> dict:
    return {
        "id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"],
        "title": u.get("title"), "phone": u.get("phone"), "active": u.get("active", True),
        "must_change_pin": u.get("must_change_pin", False),
        "created_at": u.get("created_at"),
    }


async def _audit(actor: dict, action: str, target: dict, details: dict | None = None):
    """Record an admin action on a user account for the audit trail."""
    entry = {
        "id": str(uuid.uuid4()), "at": now_iso(),
        "actor_id": (actor or {}).get("id"), "actor_name": (actor or {}).get("name"),
        "action": action, "target_id": target.get("id"),
        "target_email": target.get("email"), "target_name": target.get("name"),
        "details": details or {},
    }
    await db.user_audit.insert_one(dict(entry))


def _gen_temp_pin() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def _login_url() -> str:
    return (os.environ.get("APP_URL", "").rstrip("/") or "") + "/login"


async def _send_invite(name: str, email: str, pin: str, role: str) -> bool:
    """Email a temporary PIN to a new team member. Returns True if sent."""
    role_label = ROLE_LABELS.get(role, role)
    url = _login_url()
    html = f"""
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0F172A">
      <div style="background:#047857;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
        <h2 style="margin:0;font-size:20px">Welcome to BoothIQ</h2>
      </div>
      <div style="border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        <p>Hi {name or 'there'},</p>
        <p>An account has been created for you on <b>BoothIQ</b> as a <b>{role_label}</b>.</p>
        <p>Sign in with your email and this temporary PIN:</p>
        <div style="text-align:center;margin:20px 0">
          <span style="display:inline-block;background:#ECFDF5;color:#065F46;font-size:28px;
            letter-spacing:6px;font-weight:800;padding:14px 28px;border-radius:12px">{pin}</span>
        </div>
        <p style="font-size:14px;color:#334155">Email: <b>{email}</b><br/>
        You'll be asked to choose a new PIN the first time you sign in.</p>
        <p style="text-align:center;margin:24px 0">
          <a href="{url}" style="background:#047857;color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:999px;font-weight:700">Sign in to BoothIQ</a>
        </p>
        <p style="font-size:12px;color:#94A3B8">If you weren't expecting this, you can ignore this email.</p>
      </div>
    </div>"""
    try:
        await send_email(email, "Your BoothIQ account — temporary PIN", html)
        return True
    except EmailError:
        return False


async def _send_reset(name: str, email: str, pin: str) -> bool:
    """Email a temporary PIN for a self-service password/PIN reset."""
    url = _login_url()
    html = f"""
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0F172A">
      <div style="background:#047857;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
        <h2 style="margin:0;font-size:20px">Reset your BoothIQ PIN</h2>
      </div>
      <div style="border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        <p>Hi {name or 'there'},</p>
        <p>We received a request to reset the PIN for <b>{email}</b>. Use this temporary PIN to sign in:</p>
        <div style="text-align:center;margin:20px 0">
          <span style="display:inline-block;background:#ECFDF5;color:#065F46;font-size:28px;
            letter-spacing:6px;font-weight:800;padding:14px 28px;border-radius:12px">{pin}</span>
        </div>
        <p style="font-size:14px;color:#334155">You'll be asked to choose a new PIN right after you sign in.</p>
        <p style="text-align:center;margin:24px 0">
          <a href="{url}" style="background:#047857;color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:999px;font-weight:700">Sign in to BoothIQ</a>
        </p>
        <p style="font-size:12px;color:#94A3B8">If you didn't request this, you can safely ignore this email — your current PIN still works until you use the temporary one.</p>
      </div>
    </div>"""
    try:
        await send_email(email, "Reset your BoothIQ PIN", html)
        return True
    except EmailError:
        return False


@router.get("")
async def list_users(request: Request, role: str | None = None, roles: str | None = None):
    """Any authenticated user can list users (needed for assignment pickers).
    `roles` accepts a comma-separated list (e.g. account_manager,lead_manager,admin)."""
    await get_current_user(request)
    q = {}
    if roles:
        wanted = [r.strip() for r in roles.split(",") if r.strip()]
        if wanted:
            q["role"] = {"$in": wanted}
    elif role:
        q["role"] = role
    users = await db.users.find(q, {"_id": 0, "pin_hash": 0}).sort("name", 1).to_list(500)
    for u in users:
        u.setdefault("active", True)
        u.setdefault("must_change_pin", False)
    return users


@router.get("/roles")
async def roles():
    return [{"value": r, "label": ROLE_LABELS[r]} for r in ALL_ROLES]


@router.get("/audit")
async def user_audit(admin=Depends(require_admin)):
    return await db.user_audit.find({}, {"_id": 0}).sort("at", -1).to_list(100)


@router.get("/{user_id}/workload")
async def user_workload(user_id: str, admin=Depends(require_admin)):
    leads = await db.crm_leads.count_documents({"account_manager_id": user_id})
    open_opps = await db.crm_opportunities.count_documents({"owner_id": user_id, "status": "open"})
    return {"leads": leads, "open_opps": open_opps}


class CreateUserInput(BaseModel):
    email: str
    pin: str | None = None
    name: str
    role: str
    title: str | None = None
    phone: str | None = None
    send_invite: bool = True


@router.post("")
async def create_user(data: CreateUserInput, admin=Depends(require_admin)):
    if data.role not in ALL_ROLES:
        raise HTTPException(400, "Invalid role")
    email = data.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "A user with that email already exists")
    # A supplied PIN is used as-is; otherwise generate a secure temporary PIN
    # and force a change on first login.
    temp = data.pin is None or data.pin == ""
    pin = data.pin if not temp else _gen_temp_pin()
    if not temp:
        ok, msg = credential_ok(pin)
        if not ok:
            raise HTTPException(400, msg)
    doc = {
        "id": str(uuid.uuid4()), "email": email, "pin_hash": hash_pin(pin),
        "name": data.name.strip(), "role": data.role, "title": data.title,
        "phone": data.phone, "active": True, "must_change_pin": temp,
        "created_at": now_iso(),
    }
    await db.users.insert_one(dict(doc))
    await _audit(admin, "created", doc, {"role": doc["role"]})
    invite_sent = False
    if temp and data.send_invite:
        invite_sent = await _send_invite(doc["name"], email, pin, data.role)
    out = _public(doc)
    # Surface the temp PIN to the admin so they can share it if email is off.
    if temp:
        out["temp_pin"] = pin
        out["invite_sent"] = invite_sent
    return out


@router.post("/{user_id}/invite")
async def resend_invite(user_id: str, admin=Depends(require_admin)):
    """Regenerate a temporary PIN, force a change on next login, and email it."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    pin = _gen_temp_pin()
    await db.users.update_one({"id": user_id}, {"$set": {
        "pin_hash": hash_pin(pin), "must_change_pin": True}})
    invite_sent = await _send_invite(user.get("name"), user["email"], pin, user.get("role"))
    await _audit(admin, "invited", user)
    return {"ok": True, "invite_sent": invite_sent, "temp_pin": pin}


class BulkUserInput(BaseModel):
    user_ids: list[str]
    action: str  # deactivate | activate | delete
    reassign_to: str | None = None


@router.post("/bulk")
async def bulk_users(data: BulkUserInput, admin=Depends(require_admin)):
    ids = [u for u in (data.user_ids or []) if u != admin["id"]]
    if not ids:
        raise HTTPException(400, "No users selected")
    if data.action in ("deactivate", "activate"):
        active = data.action == "activate"
        r = await db.users.update_many({"id": {"$in": ids}}, {"$set": {"active": active}})
        for uid in ids:
            tgt = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "email": 1, "name": 1})
            if tgt:
                await _audit(admin, "updated", tgt, {"changed": ["active"], "bulk": True})
        return {"ok": True, "count": r.modified_count, "action": data.action}
    if data.action == "delete":
        deleted, moved, skipped = 0, 0, 0
        target = None
        if data.reassign_to:
            target = await db.users.find_one({"id": data.reassign_to}, {"_id": 0, "id": 1, "name": 1})
        for uid in ids:
            user = await db.users.find_one({"id": uid}, {"_id": 0})
            if not user:
                continue
            if user.get("role") in ("admin", "super_admin"):
                admins = await db.users.count_documents({"role": {"$in": ["admin", "super_admin"]}})
                if admins <= 1:
                    skipped += 1
                    continue
            if target:
                rr = await db.crm_leads.update_many({"account_manager_id": uid}, {"$set": {
                    "account_manager_id": target["id"], "account_manager_name": target.get("name"),
                    "routing_reason": f"Reassigned from {user.get('name')} (bulk delete)", "routed_at": now_iso()}})
                moved += rr.modified_count
            await db.users.delete_one({"id": uid})
            await _audit(admin, "deleted", user, {"bulk": True, "reassigned_to": data.reassign_to})
            deleted += 1
        return {"ok": True, "deleted": deleted, "leads_moved": moved, "skipped": skipped}
    raise HTTPException(400, "Invalid action")


class UpdateUserInput(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    title: str | None = None
    active: bool | None = None


@router.patch("/{user_id}")
async def update_user(user_id: str, data: UpdateUserInput, admin=Depends(require_admin)):
    patch = {k: v for k, v in data.dict().items() if v is not None}
    if "role" in patch and patch["role"] not in ALL_ROLES:
        raise HTTPException(400, "Invalid role")
    if "email" in patch:
        email = patch["email"].strip().lower()
        if not email or "@" not in email:
            raise HTTPException(400, "Enter a valid email address")
        dup = await db.users.find_one({"email": email, "id": {"$ne": user_id}}, {"_id": 0, "id": 1})
        if dup:
            raise HTTPException(400, "A user with that email already exists")
        patch["email"] = email
    if not patch:
        return {"ok": True}
    r = await db.users.update_one({"id": user_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "User not found")
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "pin_hash": 0})
    await _audit(admin, "updated", u, {"changed": list(patch.keys())})
    return _public(u)


@router.delete("/{user_id}")
async def delete_user(user_id: str, reassign_to: str | None = None, admin=Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "You cannot delete your own account")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    if user.get("role") in ("admin", "super_admin"):
        admins = await db.users.count_documents({"role": {"$in": ["admin", "super_admin"]}})
        if admins <= 1:
            raise HTTPException(400, "Cannot delete the last admin account")
    leads_moved, opps_moved = 0, 0
    if reassign_to:
        target = await db.users.find_one({"id": reassign_to}, {"_id": 0, "id": 1, "name": 1})
        if not target:
            raise HTTPException(400, "Reassignment target not found")
        r1 = await db.crm_leads.update_many({"account_manager_id": user_id}, {"$set": {
            "account_manager_id": reassign_to, "account_manager_name": target.get("name"),
            "routing_reason": f"Reassigned from {user.get('name')} (account removed)",
            "routed_at": now_iso()}})
        leads_moved = r1.modified_count
        r2 = await db.crm_opportunities.update_many(
            {"owner_id": user_id, "status": "open"}, {"$set": {"owner_id": reassign_to}})
        opps_moved = r2.modified_count
    await db.users.delete_one({"id": user_id})
    await _audit(admin, "deleted", user,
                 {"reassigned_to": reassign_to, "leads_moved": leads_moved, "open_opps_moved": opps_moved})
    return {"ok": True, "deleted": user_id, "email": user.get("email"),
            "leads_moved": leads_moved, "open_opps_moved": opps_moved}


class ResetPinInput(BaseModel):
    pin: str


@router.post("/{user_id}/reset-pin")
async def reset_pin(user_id: str, data: ResetPinInput, admin=Depends(require_admin)):
    ok, msg = credential_ok(data.pin)
    if not ok:
        raise HTTPException(400, msg)
    r = await db.users.update_one({"id": user_id}, {"$set": {
        "pin_hash": hash_pin(data.pin), "must_change_pin": False}})
    if r.matched_count == 0:
        raise HTTPException(404, "User not found")
    tgt = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "name": 1})
    await _audit(admin, "pin_reset", tgt or {"id": user_id})
    return {"ok": True}
