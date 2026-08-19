"""Shared dependencies: DB, WebSocket manager, auth, Twilio, settings helpers."""
import os
import jwt
import bcrypt
from pathlib import Path
from datetime import datetime, timezone, timedelta
from fastapi import Request, HTTPException, WebSocket
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "boothiq-dev-secret")
JWT_ALGORITHM = "HS256"


# ---------- Password / PIN hashing ----------
def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "pin_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---------- WebSocket manager ----------
class WSManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, room: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(room, []).append(ws)

    def disconnect(self, room: str, ws: WebSocket):
        if room in self.rooms and ws in self.rooms[room]:
            self.rooms[room].remove(ws)

    async def broadcast(self, room: str, message: dict):
        dead = []
        for ws in self.rooms.get(room, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room, ws)


ws_manager = WSManager()


# ---------- Settings helpers ----------
async def get_setting(key: str, default=None):
    doc = await db.settings.find_one({"key": key}, {"_id": 0})
    return doc["value"] if doc else default


async def set_setting(key: str, value):
    await db.settings.update_one({"key": key}, {"$set": {"value": value}}, upsert=True)


async def get_thresholds() -> dict:
    from scoring import DEFAULT_THRESHOLDS
    val = await get_setting("thresholds")
    if not val:
        return dict(DEFAULT_THRESHOLDS)
    merged = dict(DEFAULT_THRESHOLDS)
    merged.update(val)
    return merged


async def get_live_session() -> dict | None:
    return await db.sessions.find_one({"is_live": True}, {"_id": 0})


# ---------- Twilio ----------
def send_sms(to: str, body: str) -> dict:
    """Send an SMS from the backend. Returns {sid, status, error}."""
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_FROM_NUMBER")
    if not (sid and token and from_number):
        return {"sid": None, "status": "unconfigured", "error": "Twilio not configured"}
    try:
        from twilio.rest import Client
        tw = Client(sid, token)
        msg = tw.messages.create(body=body, from_=from_number, to=to)
        return {"sid": msg.sid, "status": msg.status, "error": None}
    except Exception as e:
        return {"sid": None, "status": "failed", "error": str(e)}
