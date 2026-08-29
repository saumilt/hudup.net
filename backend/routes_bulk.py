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
    for lid in lead_ids:
        lead = await db.crm_leads.find_one({"id": lid}, {"_id": 0})
        if not lead:
            continue
        try:
            r = await enrich_person(**_person_args(lead))
            await record_usage("enrichment", 1)
        except EnrichmentError as e:
            if e.status == 404:
                results.append({"lead_id": lid, "status": "no_match"})
            else:
                results.append({"lead_id": lid, "status": "error", "detail": e.message[:120]})
            done += 1
            await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"done": done, "results": results}})
            continue
        except Exception as e:  # noqa: BLE001
            results.append({"lead_id": lid, "status": "error", "detail": str(e)[:120]})
            done += 1
            await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"done": done, "results": results}})
            continue
        if r.get("matched") and r.get("confidence") == "HIGH":
            enr = lead.get("enrichment") or {}
            applied = []
            for k, v in (r.get("fields") or {}).items():
                if v and k not in enr:
                    enr[k] = provenance(v, "People Data Labs", "HIGH")
                    applied.append(k)
            await db.crm_leads.update_one({"id": lid}, {"$set": {"enrichment": enr}})
            await log_event("lead", lid, "enrichment", None,
                            f"Bulk enriched ({len(applied)} fields)", meta={"fields": applied})
            results.append({"lead_id": lid, "status": "enriched", "fields": applied})
        else:
            results.append({"lead_id": lid, "status": "no_match", "confidence": r.get("confidence")})
        done += 1
        await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"done": done, "results": results}})
    await db.enrichment_jobs.update_one({"id": job_id}, {"$set": {"status": "completed", "finished_at": now_iso()}})


class BulkInput(BaseModel):
    lead_ids: list[str]


@router.post("/bulk")
async def bulk_enrich(data: BulkInput, user=Depends(MANAGER)):
    if not data.lead_ids:
        raise HTTPException(400, "No leads selected")
    job_id = str(uuid.uuid4())
    await db.enrichment_jobs.insert_one({
        "id": job_id, "total": len(data.lead_ids), "done": 0, "status": "running",
        "results": [], "created_by": user["id"], "created_at": now_iso()})
    asyncio.create_task(_run_job(job_id, data.lead_ids))
    return {"job_id": job_id, "total": len(data.lead_ids)}


@router.get("/{job_id}")
async def get_job(job_id: str, user=Depends(MANAGER)):
    job = await db.enrichment_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    job["results"] = (job.get("results") or [])[-200:]
    return job
