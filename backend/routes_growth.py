"""Wave 6/7 — automation rules, smart call lists, data explorer."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event
from automation import EVENTS, CONDITION_FIELDS, ACTION_TYPES

router = APIRouter(prefix="/api/crm")
MANAGER = require_roles("lead_manager")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")


# ==================== AUTOMATION RULES ====================
class RuleInput(BaseModel):
    name: str
    event: str
    conditions: list[dict] = []
    actions: list[dict] = []
    active: bool = True


@router.get("/automation/meta")
async def automation_meta(user=Depends(MANAGER)):
    seqs = await db.sequences.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    return {"events": EVENTS, "fields": CONDITION_FIELDS, "actions": ACTION_TYPES, "sequences": seqs}


@router.get("/automation")
async def list_rules(user=Depends(MANAGER)):
    return await db.automation_rules.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/automation")
async def create_rule(data: RuleInput, user=Depends(MANAGER)):
    if data.event not in EVENTS:
        raise HTTPException(400, "Unknown event")
    doc = {"id": str(uuid.uuid4()), **data.dict(), "created_by": user["id"], "created_at": now_iso()}
    await db.automation_rules.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.patch("/automation/{rule_id}")
async def update_rule(rule_id: str, data: dict, user=Depends(MANAGER)):
    data.pop("id", None)
    await db.automation_rules.update_one({"id": rule_id}, {"$set": data})
    return {"ok": True}


@router.delete("/automation/{rule_id}")
async def delete_rule(rule_id: str, user=Depends(MANAGER)):
    await db.automation_rules.delete_one({"id": rule_id})
    return {"ok": True}


# ==================== SMART CALL LISTS ====================
class CallListInput(BaseModel):
    name: str
    lead_ids: list[str] = []
    filter: dict | None = None


@router.get("/call-lists")
async def list_call_lists(user=Depends(ANY_CRM)):
    q = {} if user["role"] in ("admin", "lead_manager") else {"owner_id": user["id"]}
    lists = await db.call_lists.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    for cl in lists:
        cl["remaining"] = max(0, len(cl.get("lead_ids", [])) - cl.get("cursor", 0))
    return lists


@router.post("/call-lists")
async def create_call_list(data: CallListInput, user=Depends(ANY_CRM)):
    lead_ids = data.lead_ids
    if data.filter and not lead_ids:
        q = {}
        if data.filter.get("status"):
            q["status"] = data.filter["status"]
        if data.filter.get("tier_340b"):
            q["medicare_snapshot.tier_340b"] = data.filter["tier_340b"]
        if data.filter.get("state"):
            q["state"] = data.filter["state"].upper()
        rows = await db.crm_leads.find(q, {"_id": 0, "id": 1}).to_list(500)
        lead_ids = [r["id"] for r in rows]
    doc = {"id": str(uuid.uuid4()), "name": data.name, "lead_ids": lead_ids, "cursor": 0,
           "owner_id": user["id"], "created_at": now_iso()}
    await db.call_lists.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/call-lists/{list_id}/current")
async def call_list_current(list_id: str, user=Depends(ANY_CRM)):
    cl = await db.call_lists.find_one({"id": list_id}, {"_id": 0})
    if not cl:
        raise HTTPException(404, "Not found")
    ids = cl.get("lead_ids", [])
    cur = cl.get("cursor", 0)
    if cur >= len(ids):
        return {"done": True, "position": cur, "total": len(ids)}
    lead = await db.crm_leads.find_one({"id": ids[cur]}, {"_id": 0})
    return {"done": False, "position": cur + 1, "total": len(ids), "lead": lead}


@router.post("/call-lists/{list_id}/advance")
async def call_list_advance(list_id: str, user=Depends(ANY_CRM)):
    await db.call_lists.update_one({"id": list_id}, {"$inc": {"cursor": 1}})
    return {"ok": True}


# ==================== DATA EXPLORER ====================
@router.get("/explorer")
async def explorer(state: str = "", specialty: str = "", min_avg: float = 0,
                   tier_340b: str = "", dataset_year: int = 2024, user=Depends(MANAGER)):
    q = {"dataset_year": dataset_year}
    if state:
        q["state"] = state.upper()
    if specialty:
        q["specialty"] = {"$regex": specialty, "$options": "i"}
    if min_avg:
        q["avg_per_claim"] = {"$gte": min_avg}
    if tier_340b:
        q["tier_340b"] = tier_340b
    physicians = await db.physicians.count_documents(q)
    states = await db.physicians.aggregate([
        {"$match": {"dataset_year": dataset_year}}, {"$group": {"_id": "$state", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 12}]).to_list(12)
    specialties = await db.physicians.aggregate([
        {"$match": q}, {"$group": {"_id": "$specialty", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 12}]).to_list(12)
    npis = await db.physicians.find(q, {"_id": 0, "npi": 1}).limit(2000).to_list(2000)
    npi_set = [n["npi"] for n in npis]
    in_crm = await db.crm_leads.count_documents({"matched_npi": {"$in": npi_set}}) if npi_set else 0
    return {
        "physicians": physicians, "in_crm": in_crm, "not_in_crm": max(0, physicians - in_crm),
        "states": [{"value": s["_id"], "count": s["n"]} for s in states if s["_id"]],
        "specialties": [{"value": s["_id"], "count": s["n"]} for s in specialties if s["_id"]],
    }
