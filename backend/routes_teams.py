"""Wave 9 — Territories & Teams: hierarchy, round-robin routing, quotas."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event

router = APIRouter(prefix="/api/crm")
MANAGER = require_roles("lead_manager")


# ==================== TEAMS ====================
class TeamInput(BaseModel):
    name: str
    lead_manager_id: str | None = None
    member_ids: list[str] = []


@router.get("/teams")
async def list_teams(user=Depends(MANAGER)):
    teams = await db.teams.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    users = {u["id"]: u for u in await db.users.find({}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)}
    for t in teams:
        t["members"] = [{"id": m, "name": (users.get(m) or {}).get("name", "?")} for m in t.get("member_ids", [])]
        t["lead_manager_name"] = (users.get(t.get("lead_manager_id")) or {}).get("name")
    return teams


@router.post("/teams")
async def create_team(data: TeamInput, user=Depends(MANAGER)):
    doc = {"id": str(uuid.uuid4()), **data.dict(), "rr_cursor": 0,
           "created_by": user["id"], "created_at": now_iso()}
    await db.teams.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.patch("/teams/{team_id}")
async def update_team(team_id: str, data: dict, user=Depends(MANAGER)):
    data.pop("id", None)
    await db.teams.update_one({"id": team_id}, {"$set": data})
    return {"ok": True}


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, user=Depends(MANAGER)):
    await db.teams.delete_one({"id": team_id})
    await db.territories.delete_many({"team_id": team_id})
    return {"ok": True}


# ==================== TERRITORIES ====================
class TerritoryInput(BaseModel):
    name: str
    team_id: str
    states: list[str] = []
    specialties: list[str] = []


@router.get("/territories")
async def list_territories(user=Depends(MANAGER)):
    terrs = await db.territories.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    teams = {t["id"]: t.get("name") for t in await db.teams.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(100)}
    for t in terrs:
        t["team_name"] = teams.get(t.get("team_id"))
    return terrs


@router.post("/territories")
async def create_territory(data: TerritoryInput, user=Depends(MANAGER)):
    doc = {"id": str(uuid.uuid4()), "name": data.name, "team_id": data.team_id,
           "states": [s.upper() for s in data.states], "specialties": data.specialties,
           "created_at": now_iso()}
    await db.territories.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.delete("/territories/{terr_id}")
async def delete_territory(terr_id: str, user=Depends(MANAGER)):
    await db.territories.delete_one({"id": terr_id})
    return {"ok": True}



# ==================== ROUND-ROBIN ROUTING ====================
async def auto_route_lead(lead: dict, actor: dict | None = None) -> str | None:
    """Match a lead to a territory (by state/specialty), then round-robin across
    that team's members. Returns the assigned account_manager id, or None."""
    state = (lead.get("state") or (lead.get("medicare_snapshot") or {}).get("state") or "").upper()
    spec = (lead.get("specialty") or (lead.get("medicare_snapshot") or {}).get("specialty") or "").lower()
    terrs = await db.territories.find({}, {"_id": 0}).to_list(200)
    team_id = None
    for t in terrs:
        st_ok = (not t.get("states")) or state in t.get("states", [])
        sp_ok = (not t.get("specialties")) or any(s.lower() in spec for s in t.get("specialties", []))
        if st_ok and sp_ok and (t.get("states") or t.get("specialties")):
            team_id = t["team_id"]
            break
    team = await db.teams.find_one({"id": team_id}) if team_id else await db.teams.find_one({})
    if not team or not team.get("member_ids"):
        return None
    members = team["member_ids"]
    cur = team.get("rr_cursor", 0)
    am_id = members[cur % len(members)]
    await db.teams.update_one({"id": team["id"]}, {"$set": {"rr_cursor": cur + 1}})
    am = await db.users.find_one({"id": am_id}, {"_id": 0, "name": 1})
    await db.crm_leads.update_one({"id": lead["id"]}, {"$set": {
        "account_manager_id": am_id, "account_manager_name": (am or {}).get("name"),
        "team_id": team["id"]}})
    await log_event("lead", lead["id"], "routed", actor,
                    f"Auto-routed to {(am or {}).get('name', 'rep')} ({team['name']})")
    try:
        from routes_push import notify_lead_assigned
        await notify_lead_assigned(am_id, {**lead, "account_manager_id": am_id})
    except Exception:
        pass
    return am_id


@router.post("/leads/{lead_id}/route")
async def route_one(lead_id: str, user=Depends(MANAGER)):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    am = await auto_route_lead(lead, user)
    if not am:
        raise HTTPException(400, "No team/members available to route to")
    return {"ok": True, "account_manager_id": am}


@router.post("/leads/route-unassigned")
async def route_unassigned(user=Depends(MANAGER)):
    leads = await db.crm_leads.find(
        {"$or": [{"account_manager_id": None}, {"account_manager_id": {"$exists": False}}]},
        {"_id": 0}).to_list(1000)
    n = 0
    for lead in leads:
        if await auto_route_lead(lead, user):
            n += 1
    return {"ok": True, "routed": n}


# ==================== QUOTAS ====================
class QuotaInput(BaseModel):
    user_id: str
    leads_target: int = 0
    meetings_target: int = 0
    opps_target: int = 0
    revenue_target: float = 0


@router.put("/quotas")
async def set_quota(data: QuotaInput, user=Depends(MANAGER)):
    await db.quotas.update_one({"user_id": data.user_id}, {"$set": data.dict()}, upsert=True)
    return {"ok": True}


@router.get("/quotas/attainment")
async def quota_attainment(user=Depends(MANAGER)):
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    ams = await db.users.find({"role": {"$in": ["account_manager", "lead_manager"]}},
                              {"_id": 0, "id": 1, "name": 1, "role": 1}).sort("name", 1).to_list(200)
    quotas = {q["user_id"]: q for q in await db.quotas.find({}, {"_id": 0}).to_list(200)}
    out = []
    for am in ams:
        uid = am["id"]
        leads = await db.crm_leads.count_documents({"account_manager_id": uid, "created_at": {"$gte": month_start}})
        meetings = await db.crm_meetings.count_documents({"owner_id": uid, "start_at": {"$gte": month_start}})
        opps = await db.crm_opportunities.count_documents({"owner_id": uid, "created_at": {"$gte": month_start}})
        won = await db.crm_opportunities.aggregate([
            {"$match": {"owner_id": uid, "status": "won"}},
            {"$group": {"_id": None, "rev": {"$sum": "$value"}}}]).to_list(1)
        revenue = (won[0]["rev"] if won else 0) or 0
        q = quotas.get(uid, {})
        out.append({"user_id": uid, "name": am["name"], "role": am.get("role"),
                    "leads": leads, "meetings": meetings, "opps": opps, "revenue": revenue,
                    "leads_target": q.get("leads_target", 0), "meetings_target": q.get("meetings_target", 0),
                    "opps_target": q.get("opps_target", 0), "revenue_target": q.get("revenue_target", 0)})
    return out
