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
    event_id: str | None = None,
    tier_340b: str | None = None,
    tier_rpm: str | None = None,
    specialty: str | None = None,
    state: str | None = None,
    interest: str | None = None,
    assigned_to: str | None = None,
    associate_id: str | None = None,
    match_status: str | None = None,
    sort: str = "created_at",
    limit: int = 200,
):
    await get_current_user(request)
    q = {}
    if event_id:
        q["event_id"] = event_id
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
    if associate_id:
        q["associate_id"] = associate_id
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


@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, request: Request):
    await get_current_user(request)
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        return {"error": "not_found"}
    return lead


@router.get("/counters")
async def counters(request: Request, event_id: str | None = None):
    await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    base = {"created_at": {"$gte": today}}
    if event_id:
        base["event_id"] = event_id
    pipeline = [
        {"$match": base},
        {"$group": {"_id": "$tier_340b", "count": {"$sum": 1}}},
    ]
    by_340b = {d["_id"]: d["count"] async for d in db.leads.aggregate(pipeline)}
    rpm_pipeline = [
        {"$match": base},
        {"$group": {"_id": "$tier_rpm", "count": {"$sum": 1}}},
    ]
    by_rpm = {d["_id"]: d["count"] async for d in db.leads.aggregate(rpm_pipeline)}
    spin_q = {"spun": True}
    if event_id:
        spin_q["event_id"] = event_id
    spins = await db.leads.count_documents(spin_q)
    total_today = await db.leads.count_documents(base)
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


class ScheduleInput(BaseModel):
    callback_date: str | None = None
    appointment_at: str | None = None


@router.post("/leads/{lead_id}/schedule")
async def schedule_lead(lead_id: str, data: ScheduleInput, request: Request):
    await get_current_user(request)
    patch = {}
    if data.callback_date is not None:
        patch["callback_date"] = data.callback_date
    if data.appointment_at is not None:
        patch["appointment_at"] = data.appointment_at
    await db.leads.update_one({"id": lead_id}, {"$set": patch})
    return {"ok": True, **patch}


@router.get("/alerts")
async def alert_logs(request: Request, limit: int = 100):
    await get_current_user(request)
    return await db.alert_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


EXPORT_COLUMNS = [
    ("npi", "NPI"), ("match_status", "Match Status"),
    ("tier_340b", "340B Tier"), ("shade_340b", "340B Shade"), ("tier_rpm", "RPM Tier"),
    ("first_name", "First Name"), ("last_name", "Last Name"),
    ("specialty", "Specialty"), ("city", "City"), ("state", "State"),
    ("phone", "Phone"), ("email", "Email"), ("practice", "Practice"),
    ("tot_clms", "Total Claims"), ("tot_cost", "Total Drug Cost"),
    ("avg_per_claim", "Avg Per Claim"), ("interests", "Interests"),
    ("event_id", "Event"), ("associate_name", "Associate"),
    ("assigned_to", "Assigned To"), ("callback_date", "Callback Date"),
    ("appointment_at", "Appointment"), ("created_at", "Captured At"),
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
async def export_leads(request: Request, event_id: str | None = None, fmt: str = "csv"):
    await get_current_user(request)
    q = {"event_id": event_id} if event_id else {}
    leads = await db.leads.find(q, {"_id": 0}).sort("created_at", -1).to_list(100000)

    # Dynamic tail: EVERY captured CMS column (summed extras + carried raw fields).
    extra_keys, raw_keys = set(), set()
    for l in leads:
        ce = l.get("cms_extra") or {}
        extra_keys |= set((ce.get("extra") or {}).keys())
        raw_keys |= set((ce.get("raw") or {}).keys())
    extra_keys = sorted(extra_keys)
    raw_keys = sorted(raw_keys)

    base_keys = [k for k, _ in EXPORT_COLUMNS]
    headers = ([label for _, label in EXPORT_COLUMNS] + ["Drug Rows"]
               + [f"Sum {k}" for k in extra_keys] + list(raw_keys))

    def full_row(l):
        r = _row(l)
        ce = l.get("cms_extra") or {}
        ex = ce.get("extra") or {}
        rw = ce.get("raw") or {}
        return ([r.get(k) for k in base_keys] + [ce.get("row_count")]
                + [ex.get(k) for k in extra_keys] + [rw.get(k) for k in raw_keys])

    rows = [full_row(l) for l in leads]

    if fmt == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Leads"
        ws.append(headers)
        for r in rows:
            ws.append(r)
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
        writer.writerow(r)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=boothiq_leads.csv"})


@router.get("/crm-mapping")
async def crm_mapping(request: Request):
    await get_current_user(request)
    return {"fields": [{"source": k, "label": label} for k, label in EXPORT_COLUMNS]}
