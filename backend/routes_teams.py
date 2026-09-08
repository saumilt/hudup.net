"""Wave 9 — Territories & Teams: hierarchy, round-robin routing, quotas."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo import ReturnDocument

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
    r = await db.teams.update_one({"id": team_id}, {"$set": data})
    if r.matched_count == 0:
        raise HTTPException(404, "Team not found")
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


@router.patch("/territories/{terr_id}")
async def update_territory(terr_id: str, data: dict, user=Depends(MANAGER)):
    data.pop("id", None)
    if isinstance(data.get("states"), list):
        data["states"] = [s.upper() for s in data["states"]]
    r = await db.territories.update_one({"id": terr_id}, {"$set": data})
    if r.matched_count == 0:
        raise HTTPException(404, "Territory not found")
    return {"ok": True}


@router.delete("/territories/{terr_id}")
async def delete_territory(terr_id: str, user=Depends(MANAGER)):
    await db.territories.delete_one({"id": terr_id})
    return {"ok": True}



# ==================== ROUTING ====================
async def _rr_team_pick(team: dict) -> str | None:
    """Round-robin the next member of a team, advancing that team's cursor."""
    members = team.get("member_ids") or []
    if not members:
        return None
    cur = team.get("rr_cursor", 0)
    am_id = members[cur % len(members)]
    await db.teams.update_one({"id": team["id"]}, {"$set": {"rr_cursor": cur + 1}})
    return am_id


async def _rr_pool_pick(pool_key: str, member_ids: list[str]) -> str | None:
    """Round-robin across an ad-hoc pool using a shared counter (bulk fallback)."""
    if not member_ids:
        return None
    doc = await db.counters.find_one_and_update(
        {"_id": pool_key}, {"$inc": {"seq": 1}},
        upsert=True, return_document=ReturnDocument.AFTER)
    return member_ids[(doc["seq"] - 1) % len(member_ids)]


async def _apply_assignment(lead: dict, am_id: str, team_id: str | None,
                            actor: dict | None, reason: str) -> str:
    am = await db.users.find_one({"id": am_id}, {"_id": 0, "name": 1})
    patch = {"account_manager_id": am_id, "account_manager_name": (am or {}).get("name"),
             "routing_reason": reason, "routed_at": now_iso()}
    if team_id:
        patch["team_id"] = team_id
    await db.crm_leads.update_one({"id": lead["id"]}, {"$set": patch})
    await log_event("lead", lead["id"], "routed", actor, reason)
    try:
        from routes_push import notify_lead_assigned
        await notify_lead_assigned(am_id, {**lead, "account_manager_id": am_id})
    except Exception:
        pass
    return am_id


async def auto_route_lead(lead: dict, actor: dict | None = None,
                          source_kind: str = "manual") -> str | None:
    """Route a lead. First match a territory by state and/or specialty and round-robin
    across that team. If nothing matches, fall back by origin: a manually-entered lead
    goes to its creator; a bulk-imported (or manager-triggered) lead round-robins across
    all account managers. Returns the assigned account_manager id, or None."""
    state = (lead.get("state") or (lead.get("medicare_snapshot") or {}).get("state") or "").upper()
    spec = (lead.get("specialty") or (lead.get("medicare_snapshot") or {}).get("specialty") or "").lower()

    # 1) Territory match (state and/or specialty).
    terrs = await db.territories.find({}, {"_id": 0}).to_list(200)
    matched_team_id, matched_terr = None, None
    for t in terrs:
        if not (t.get("states") or t.get("specialties")):
            continue
        st_ok = (not t.get("states")) or state in t.get("states", [])
        sp_ok = (not t.get("specialties")) or any(s and s.lower() in spec for s in t.get("specialties", []))
        if st_ok and sp_ok:
            matched_team_id, matched_terr = t["team_id"], t
            break

    if matched_team_id:
        team = await db.teams.find_one({"id": matched_team_id})
        am_id = await _rr_team_pick(team) if team else None
        if am_id:
            return await _apply_assignment(
                lead, am_id, team["id"], actor,
                f"Auto-routed to {team['name']} — territory “{matched_terr['name']}”")

    # 2) No territory match → fallback by origin.
    if source_kind == "manual":
        creator_id = (actor or {}).get("id") or lead.get("created_by")
        if creator_id:
            return await _apply_assignment(
                lead, creator_id, None, actor,
                "Assigned to lead creator (no matching territory)")
        return None

    # Bulk / manager-triggered fallback → round-robin across all account managers.
    ams = await db.users.find({"role": "account_manager"}, {"_id": 0, "id": 1}).sort("id", 1).to_list(500)
    member_ids = [u["id"] for u in ams]
    if not member_ids:
        team = await db.teams.find_one({})
        member_ids = (team or {}).get("member_ids") or []
    am_id = await _rr_pool_pick("rr_bulk_fallback", member_ids)
    if am_id:
        return await _apply_assignment(
            lead, am_id, None, actor,
            "Auto-routed via round-robin (no matching territory)")
    return None


@router.post("/leads/{lead_id}/route")
async def route_one(lead_id: str, user=Depends(MANAGER)):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    am = await auto_route_lead(lead, user, source_kind="bulk")
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
        if await auto_route_lead(lead, user, source_kind="bulk"):
            n += 1
    return {"ok": True, "routed": n}


@router.get("/routing/balance")
async def routing_balance(scope: str = "am", user=Depends(MANAGER)):
    """How evenly new leads spread across reps — this month vs last month.
    scope=am → account managers only; scope=all → include lead managers too."""
    now = datetime.now(timezone.utc)
    this_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_start = (this_start.replace(year=this_start.year - 1, month=12) if this_start.month == 1
                  else this_start.replace(month=this_start.month - 1))
    ts, ls = this_start.isoformat(), last_start.isoformat()
    roles = ["account_manager"] if scope == "am" else ["account_manager", "lead_manager"]
    users = await db.users.find({"role": {"$in": roles}},
                                {"_id": 0, "id": 1, "name": 1, "role": 1}).sort("name", 1).to_list(200)
    reps, total, prev_total = [], 0, 0
    for u in users:
        uid = u["id"]
        c = await db.crm_leads.count_documents({"account_manager_id": uid, "created_at": {"$gte": ts}})
        p = await db.crm_leads.count_documents({"account_manager_id": uid, "created_at": {"$gte": ls, "$lt": ts}})
        reps.append({"user_id": uid, "name": u["name"], "role": u.get("role"), "leads": c, "prev": p})
        total += c
        prev_total += p
    unassigned = await db.crm_leads.count_documents(
        {"created_at": {"$gte": ts},
         "$or": [{"account_manager_id": None}, {"account_manager_id": {"$exists": False}}]})
    reps.sort(key=lambda r: r["leads"], reverse=True)
    counts = [r["leads"] for r in reps]
    spread = (max(counts) - min(counts)) if counts else 0
    return {"month_total": total, "prev_total": prev_total, "unassigned": unassigned,
            "reps": reps, "spread": spread,
            "max": max(counts + [r["prev"] for r in reps], default=0)}


@router.post("/routing/rebalance")
async def routing_rebalance(user=Depends(MANAGER)):
    """Even out this month's load: move surplus unworked (status New, not converted)
    leads from the busiest account manager to the quietest until the spread is ≤ 1."""
    this_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    ams = await db.users.find({"role": "account_manager"}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    if len(ams) < 2:
        return {"ok": True, "moved": 0}
    names = {u["id"]: u["name"] for u in ams}
    counts, unworked = {}, {}
    for u in ams:
        uid = u["id"]
        counts[uid] = await db.crm_leads.count_documents(
            {"account_manager_id": uid, "created_at": {"$gte": this_start}})
        lw = await db.crm_leads.find(
            {"account_manager_id": uid, "status": "New", "created_at": {"$gte": this_start},
             "opportunity_id": {"$exists": False}},
            {"_id": 0, "id": 1}).sort("created_at", -1).to_list(2000)
        unworked[uid] = [l["id"] for l in lw]
    moved = 0
    for _ in range(2000):
        donors = [k for k in counts if unworked.get(k)]
        if not donors:
            break
        busiest = max(donors, key=lambda k: counts[k])
        quietest = min(counts, key=lambda k: counts[k])
        if counts[busiest] - counts[quietest] <= 1:
            break
        lead_id = unworked[busiest].pop(0)
        await db.crm_leads.update_one({"id": lead_id}, {"$set": {
            "account_manager_id": quietest, "account_manager_name": names.get(quietest),
            "routing_reason": f"Rebalanced — moved from {names.get(busiest)} to even out load",
            "routed_at": now_iso()}})
        await log_event("lead", lead_id, "routed", user,
                        f"Rebalanced from {names.get(busiest)} to {names.get(quietest)}")
        try:
            from routes_push import notify_lead_assigned
            await notify_lead_assigned(quietest, {"id": lead_id})
        except Exception:
            pass
        counts[busiest] -= 1
        counts[quietest] += 1
        moved += 1
    return {"ok": True, "moved": moved}


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
