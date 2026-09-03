"""Bulk enrichment — enrich many leads in a background job (fill-missing-only)."""
import uuid
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event, provenance
from enrichment import enrich_person, EnrichmentError
from providers import record_usage

router = APIRouter(prefix="/api/crm/enrichment")
MANAGER = require_roles("lead_manager")


def _person_args(lead):
    snap = lead.get("medicare_snapshot") or {}
    name = f"{lead.get('contact_first') or ''} {lead.get('contact_last') or ''}".strip() or snap.get("name")
    return {"name": name, "company": lead.get("org_name"),
            "city": lead.get("city") or snap.get("city"),
            "region": lead.get("state") or snap.get("state"),
            "email": lead.get("email")}


async def _run_job(job_id, lead_ids):
    done = 0
    results = []
    counts = {"enriched": 0, "no_match": 0, "error": 0}
    for lid in lead_ids:
        lead = await db.crm_leads.find_one({"id": lid}, {"_id": 0})
        if not lead:
            done += 1
            continue
        try:
            r = await enrich_person(**_person_args(lead))
            await record_usage("enrichment", 1)
        except EnrichmentError as e:
            if e.status == 402:  # out of credits — stop the whole run safely
                await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {
                    "status": "stopped_credit_limit", "done": done, "counts": counts,
                    "results": results[-200:], "finished_at": now_iso()}})
                return
            key = "no_match" if e.status == 404 else "error"
            counts[key] += 1
            results.append({"lead_id": lid, "status": key,
                            "detail": None if e.status == 404 else e.message[:120]})
            done += 1
            await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"done": done, "counts": counts, "results": results[-200:]}})
            await asyncio.sleep(0.4)
            continue
        except Exception as e:  # noqa: BLE001
            counts["error"] += 1
            results.append({"lead_id": lid, "status": "error", "detail": str(e)[:120]})
            done += 1
            await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"done": done, "counts": counts, "results": results[-200:]}})
            await asyncio.sleep(0.4)
            continue
        if r.get("matched") and r.get("confidence") == "HIGH":
            enr = lead.get("enrichment") or {}
            applied, top = [], {}
            for k, v in (r.get("fields") or {}).items():
                if v and k not in enr:
                    enr[k] = provenance(v, "People Data Labs", "HIGH")
                    applied.append(k)
                    if k == "phone" and not lead.get("phone"):
                        top["phone"] = v
                    if k == "work_email" and not lead.get("email"):
                        top["email"] = v
            await db.crm_leads.update_one({"id": lid}, {"$set": {"enrichment": enr, **top}})
            await log_event("lead", lid, "enrichment", None,
                            f"Bulk enriched ({len(applied)} fields)", meta={"fields": applied})
            counts["enriched"] += 1
            results.append({"lead_id": lid, "status": "enriched", "fields": applied})
        else:
            counts["no_match"] += 1
            results.append({"lead_id": lid, "status": "no_match", "confidence": r.get("confidence")})
        done += 1
        await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"done": done, "counts": counts, "results": results[-200:]}})
        await asyncio.sleep(0.4)
    await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"status": "completed", "counts": counts, "finished_at": now_iso()}})


async def enrich_one_lead(lead_id: str):
    """Best-effort single-lead enrichment (used on capture). Silent on failure."""
    try:
        lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
        if not lead or not (lead.get("email") or lead.get("org_name")):
            return
        r = await enrich_person(**_person_args(lead))
        await record_usage("enrichment", 1)
        if r.get("matched") and r.get("confidence") == "HIGH":
            enr = lead.get("enrichment") or {}
            top = {}
            for k, v in (r.get("fields") or {}).items():
                if v and k not in enr:
                    enr[k] = provenance(v, "People Data Labs", "HIGH")
                    if k == "phone" and not lead.get("phone"):
                        top["phone"] = v
                    if k == "work_email" and not lead.get("email"):
                        top["email"] = v
            await db.crm_leads.update_one({"id": lead_id}, {"$set": {"enrichment": enr, **top}})
            await log_event("lead", lead_id, "enrichment", None, "Auto-enriched on capture")
    except Exception:
        pass


class BulkInput(BaseModel):
    lead_ids: list[str] | None = None
    source: str | None = None
    mine: bool = False
    missing_phone: bool = True
    limit: int | None = None


@router.post("/bulk")
async def bulk_enrich(data: BulkInput, user=Depends(MANAGER)):
    ids = data.lead_ids or []
    if not ids:
        q = {}
        if data.source:
            q["source"] = data.source
        if data.mine:
            q["account_manager_id"] = user["id"]
        if data.missing_phone:
            q["$or"] = [{"phone": None}, {"phone": ""}, {"phone": {"$exists": False}}]
        rows = await db.crm_leads.find(q, {"_id": 0, "id": 1}).to_list(5000)
        ids = [r["id"] for r in rows]
    if data.limit:
        ids = ids[:data.limit]
    if not ids:
        raise HTTPException(400, "No leads to enrich")
    job_id = str(uuid.uuid4())
    await db.enrichment_jobs.insert_one({
        "id": job_id, "total": len(ids), "done": 0, "status": "running",
        "counts": {"enriched": 0, "no_match": 0, "error": 0}, "results": [],
        "created_by": user["id"], "created_at": now_iso()})
    asyncio.create_task(_run_job(job_id, ids))
    return {"job_id": job_id, "total": len(ids)}


@router.get("/{job_id}")
async def get_job(job_id: str, user=Depends(MANAGER)):
    job = await db.enrichment_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    job["results"] = (job.get("results") or [])[-200:]
    return job
