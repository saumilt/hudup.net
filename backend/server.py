import os
import uuid
import logging
from datetime import datetime, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Form
from starlette.middleware.cors import CORSMiddleware

from deps import db, ws_manager, hash_pin, verify_pin, set_setting, get_setting
from routes_auth import router as auth_router
from routes_admin import router as admin_router
from routes_kiosk import router as kiosk_router
from routes_dashboard import router as dashboard_router
from routes_users import router as users_router
from routes_medicare import router as medicare_router
from routes_crm import router as crm_router
from routes_crm_meetings import router as crm_meetings_router
from routes_crm_engage import router as crm_engage_router, admin_router as providers_admin_router
from routes_ai import router as ai_router
from routes_import import router as import_router
from routes_bulk import router as bulk_router
from routes_sequences import router as sequences_router, sequence_worker
from routes_comms import router as comms_router
from routes_growth import router as growth_router
from routes_agent import router as agent_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("boothiq")

app = FastAPI(title="BoothIQ API")


@app.get("/api/")
async def root():
    return {"message": "BoothIQ API", "status": "ok"}


@app.post("/api/twilio/status")
async def twilio_status(MessageSid: str = Form(None), MessageStatus: str = Form(None), ErrorCode: str = Form(None)):
    """Twilio delivery-status webhook — updates the alert log so failures are visible."""
    if MessageSid:
        patch = {"status": MessageStatus or "unknown"}
        if ErrorCode:
            patch["error"] = f"Twilio error {ErrorCode}"
        await db.alert_logs.update_one({"sid": MessageSid}, {"$set": patch})
        await ws_manager.broadcast("dashboard", {"type": "alert_update", "sid": MessageSid, **patch})
    return {"ok": True}


app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(kiosk_router)
app.include_router(dashboard_router)
app.include_router(users_router)
app.include_router(medicare_router)
app.include_router(crm_router)
app.include_router(crm_meetings_router)
app.include_router(crm_engage_router)
app.include_router(providers_admin_router)
app.include_router(ai_router)
app.include_router(import_router)
app.include_router(bulk_router)
app.include_router(sequences_router)
app.include_router(comms_router)
app.include_router(growth_router)
app.include_router(agent_router)


@app.websocket("/api/ws/{room}")
async def websocket_endpoint(websocket: WebSocket, room: str):
    await ws_manager.connect(room, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(room, websocket)
    except Exception:
        ws_manager.disconnect(room, websocket)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _seed_user(email, pin, name, role):
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": email, "pin_hash": hash_pin(pin),
            "name": name, "role": role, "created_at": datetime.now(timezone.utc).isoformat()})
    elif not verify_pin(pin, existing["pin_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"pin_hash": hash_pin(pin)}})


DEFAULT_SEGMENTS = [
    {"id": "s1", "label": "$5 Coffee", "color": "#059669", "prize_name": "$5 Coffee Card", "weight": 40, "inventory": 500},
    {"id": "s2", "label": "Tote Bag", "color": "#0EA5E9", "prize_name": "BoothIQ Tote Bag", "weight": 25, "inventory": 200},
    {"id": "s3", "label": "Water Bottle", "color": "#6366F1", "prize_name": "Insulated Bottle", "weight": 20, "inventory": 150},
    {"id": "s4", "label": "Gift Card", "color": "#F59E0B", "prize_name": "$50 Gift Card", "weight": 10, "inventory": 50},
    {"id": "s5", "label": "AirPods", "color": "#EF4444", "prize_name": "Apple AirPods", "weight": 4, "inventory": 10},
    {"id": "s6", "label": "Grand Prize", "color": "#8B5CF6", "prize_name": "iPad Grand Prize", "weight": 1, "inventory": 2},
]


@app.on_event("startup")
async def startup():
    # Indexes for single-digit-ms NPI lookups at the counter.
    await db.physicians.create_index("npi")
    await db.physicians.create_index([("session_id", 1), ("npi", 1)])
    await db.physicians.create_index([("last_upper", 1), ("state", 1)])
    await db.physicians.create_index([("last_upper", 1), ("first_upper", 1)])
    await db.physicians.create_index("session_id")
    await db.leads.create_index("created_at")
    await db.leads.create_index("event_id")
    await db.users.create_index("email", unique=True)
    await db.alert_logs.create_index([("lead_id", 1), ("staff_id", 1)])

    # Seed accounts (email + PIN, role-based).
    await _seed_user(os.environ.get("ADMIN_EMAIL", "admin@boothiq.com"),
                     os.environ.get("ADMIN_PIN", "482913"), "Admin", "admin")
    await _seed_user(os.environ.get("STAFF_EMAIL", "staff@boothiq.com"),
                     os.environ.get("STAFF_PIN", "715264"), "Sales Rep", "staff")
    await _seed_user(os.environ.get("LEAD_MANAGER_EMAIL", "leadmanager@boothiq.com"),
                     os.environ.get("LEAD_MANAGER_PIN", "639201"), "Lead Manager", "lead_manager")
    await _seed_user(os.environ.get("ACCOUNT_MANAGER_EMAIL", "accountmanager@boothiq.com"),
                     os.environ.get("ACCOUNT_MANAGER_PIN", "528174"), "Account Manager", "account_manager")

    # CRM indexes.
    await db.crm_leads.create_index("id", unique=True)
    await db.crm_leads.create_index("account_manager_id")
    await db.crm_leads.create_index("status")
    await db.crm_leads.create_index("matched_npi")
    await db.crm_leads.create_index("last_activity_at")
    await db.crm_opportunities.create_index("owner_id")
    await db.crm_opportunities.create_index("stage")
    await db.crm_tasks.create_index([("assigned_to", 1), ("status", 1)])
    await db.crm_tasks.create_index("due_at")
    await db.crm_meetings.create_index("start_at")
    await db.crm_meetings.create_index("owner_id")
    await db.crm_activities.create_index("lead_id")
    await db.crm_activities.create_index([("entity_type", 1), ("entity_id", 1)])
    await db.crm_activities.create_index("at")
    await db.crm_tasks.create_index("assigned_to")
    await db.email_messages.create_index("lead_id")
    await db.enrichment_jobs.create_index("lead_id")
    await db.physicians.create_index("dataset_year")

    # One-time migration: tag existing datasets/physicians as dataset_year 2024
    # and denormalize 340B/RPM tiers so Medicare Search can filter by tier.
    if await db.sessions.count_documents({"dataset_year": {"$exists": False}}) > 0:
        await db.sessions.update_many({"dataset_year": {"$exists": False}},
                                      {"$set": {"dataset_year": 2024}})
    if await db.physicians.count_documents({"dataset_year": {"$exists": False}}) > 0:
        await db.physicians.update_many({"dataset_year": {"$exists": False}},
                                        {"$set": {"dataset_year": 2024}})
    live = await db.sessions.find_one({"is_live": True}, {"_id": 0, "id": 1})
    if live and await db.physicians.count_documents(
            {"session_id": live["id"], "tier_340b": {"$exists": False}}) > 0:
        from tiers import recompute_tiers
        n = await recompute_tiers(live["id"])
        logger.info(f"Tier denormalization complete for live dataset ({n} physicians)")

    # Seed default settings.
    if await get_setting("convention_state") is None:
        await set_setting("convention_state", "TX")
    if await get_setting("wheel_mute") is None:
        await set_setting("wheel_mute", False)

    # Seed a default prize set if none exists.
    if await db.prize_sets.count_documents({}) == 0:
        await db.prize_sets.insert_one({
            "id": str(uuid.uuid4()), "name": "Default Prize Set", "event_id": "default",
            "segments": DEFAULT_SEGMENTS, "active": True})

    # Seed default alert rules (text on GREEN, optional YELLOW manager-only).
    if await db.alert_rules.count_documents({}) == 0:
        await db.alert_rules.insert_one({
            "event_id": "default",
            "rules": {
                "340b": {"GREEN": {"send": True, "recipients": "all"},
                         "YELLOW": {"send": False, "recipients": "all"}},
                "rpm": {"GREEN": {"send": True, "recipients": "all"},
                        "YELLOW": {"send": False, "recipients": "all"}},
            },
            "ceiling_per_hour": 20})

    # Seed default event.
    if await db.events.count_documents({"id": "default"}) == 0:
        await db.events.insert_one({
            "id": "default", "name": "Default Event", "convention_state": "TX",
            "color_scheme": {"primary": "#047857", "accent": "#10B981"},
            "associate_ids": [], "prize_set_id": None,
            "created_at": datetime.now(timezone.utc).isoformat()})

    logger.info("BoothIQ startup complete")

    # Background worker: advance due sequence steps.
    import asyncio as _asyncio
    _asyncio.create_task(sequence_worker())

    # Initialize object storage for chunked CSV upload staging (best-effort).
    try:
        from storage import init_storage
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Object storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    from deps import client
    client.close()
