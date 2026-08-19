"""Staff dashboard: live feed, filters, counters, lead actions, alert logs, export."""
import io
import csv
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from deps import db, get_current_user

router = APIRouter(prefix="/api/dashboard")


@router.get("/leads")
async def list_leads(
    request: Request,
    event_id: str = "default",
    tier_340b: str | None = None,
    tier_rpm: str | None = None,
    specialty: str | None = None,
    state: str | None = None,
    interest: str | None = None,
    assigned_to: str | None = None,
    match_status: str | None = None,
    sort: str = "created_at",
    limit: int = 200,
):
    await get_current_user(request)
    q = {"event_id": event_id}
    if tier_340b:
        q["tier_340b"] = tier_340b
    if tier_rpm:
        q["tier_rpm"] = tier_rpm
    if specialty:
        q["specialty"] = specialty
    if state:
        q["state"] = state.upper()
    if interest:
        q["interests"] = interest
    if assigned_to:
        q["assigned_to"] = assigned_to
    if match_status:
        q["match_status"] = match_status
    sort_map = {
        "created_at": ("created_at", -1),
        "tot_cost": ("medicare.tot_cost", -1),
        "avg_per_claim": ("medicare.avg_per_claim", -1),
        "tot_clms": ("medicare.tot_clms", -1),
    }
    field, direction = sort_map.get(sort, ("created_at", -1))
    leads = await db.leads.find(q, {"_id": 0}).sort(field, direction).to_list(limit)
    return leads


@router.get("/counters")
async def counters(request: Request, event_id: str = "default"):
    await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pipeline = [
        {"$match": {"event_id": event_id, "created_at": {"$gte": today}}},
        {"$group": {"_id": "$tier_340b", "count": {"$sum": 1}}},
    ]
    by_340b = {d["_id"]: d["count"] async for d in db.leads.aggregate(pipeline)}
    rpm_pipeline = [
        {"$match": {"event_id": event_id, "created_at": {"$gte": today}}},
        {"$group": {"_id": "$tier_rpm", "count": {"$sum": 1}}},
    ]
    by_rpm = {d["_id"]: d["count"] async for d in db.leads.aggregate(rpm_pipeline)}
    spins = await db.leads.count_documents({"event_id": event_id, "spun": True})
    total_today = await db.leads.count_documents({"event_id": event_id, "created_at": {"$gte": today}})
    ps = await db.prize_sets.find_one({"active": True}, {"_id": 0})
    prizes_remaining = 0
    if ps:
        prizes_remaining = sum((s.get("inventory") or 0) for s in ps["segments"])
    return {"by_340b": by_340b, "by_rpm": by_rpm, "spins_today": spins,
            "total_today": total_today, "prizes_remaining": prizes_remaining}


class AssignInput(BaseModel):
    assigned_to: str


@router.post("/leads/{lead_id}/assign")
async def assign_lead(lead_id: str, data: AssignInput, request: Request):
    await get_current_user(request)
    await db.leads.update_one({"id": lead_id}, {"$set": {"assigned_to": data.assigned_to}})
    return {"ok": True}


class NoteInput(BaseModel):
    text: str


@router.post("/leads/{lead_id}/note")
async def add_note(lead_id: str, data: NoteInput, request: Request):
    user = await get_current_user(request)
    note = {"text": data.text, "by": user.get("name", "Staff"),
            "at": datetime.now(timezone.utc).isoformat()}
    await db.leads.update_one({"id": lead_id}, {"$push": {"notes": note}})
    return note


@router.get("/alerts")
async def alert_logs(request: Request, limit: int = 100):
    await get_current_user(request)
    return await db.alert_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


EXPORT_COLUMNS = [
    ("npi", "NPI"), ("match_status", "Match Status"),
    ("tier_340b", "340B Tier"), ("tier_rpm", "RPM Tier"),
    ("first_name", "First Name"), ("last_name", "Last Name"),
    ("specialty", "Specialty"), ("city", "City"), ("state", "State"),
    ("phone", "Phone"), ("email", "Email"), ("practice", "Practice"),
    ("tot_clms", "Total Claims"), ("tot_cost", "Total Drug Cost"),
    ("avg_per_claim", "Avg Per Claim"), ("interests", "Interests"),
    ("assigned_to", "Assigned To"), ("created_at", "Captured At"),
]


def _row(lead):
    med = lead.get("medicare", {})
    out = {}
    for key, _ in EXPORT_COLUMNS:
        if key in ("tot_clms", "tot_cost", "avg_per_claim"):
            out[key] = med.get(key)
        elif key == "interests":
            out[key] = ", ".join(lead.get("interests", []))
        else:
            out[key] = lead.get(key)
    return out


@router.get("/export")
async def export_leads(request: Request, event_id: str = "default", fmt: str = "csv"):
    await get_current_user(request)
    leads = await db.leads.find({"event_id": event_id}, {"_id": 0}).sort("created_at", -1).to_list(100000)
    rows = [_row(l) for l in leads]
    headers = [label for _, label in EXPORT_COLUMNS]
    keys = [k for k, _ in EXPORT_COLUMNS]

    if fmt == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Leads"
        ws.append(headers)
        for r in rows:
            ws.append([r.get(k) for k in keys])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=boothiq_leads.xlsx"})

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for r in rows:
        writer.writerow([r.get(k) for k in keys])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=boothiq_leads.csv"})


@router.get("/crm-mapping")
async def crm_mapping(request: Request):
    await get_current_user(request)
    return {"fields": [{"source": k, "label": label} for k, label in EXPORT_COLUMNS]}
