"""AI enrichment endpoints: extract contact/practice info from an uploaded PDF or
pasted research text, review, then apply (rest is saved as an 'AI update' note)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event, provenance
from ai_enrich import ai_enrich, extract_pdf_text, fetch_bytes, CONTACT_FIELDS

router = APIRouter(prefix="/api/crm")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")

# Contact fields mirrored onto the lead's top-level record when accepted.
_TOP = {
    "email": "email", "work_email": "email", "phone": "phone", "office_phone": "phone",
    "mobile_phone": "phone", "practice_name": "org_name", "city": "city",
    "state": "state", "specialty": "specialty",
}


async def _get_lead(lead_id: str) -> dict:
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


@router.post("/leads/{lead_id}/ai-enrich")
async def ai_enrich_lead(lead_id: str, file: UploadFile | None = File(None),
                         text: str | None = Form(None), file_url: str | None = Form(None),
                         user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    doc = ""
    try:
        if file is not None:
            raw = await file.read()
            name = (file.filename or "").lower()
            doc = extract_pdf_text(raw) if name.endswith(".pdf") else raw.decode("utf-8", "ignore")
        elif file_url:
            raw = await fetch_bytes(file_url)
            doc = extract_pdf_text(raw) if file_url.lower().split("?")[0].endswith(".pdf") else raw.decode("utf-8", "ignore")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Couldn't read the document: {e}")
    if text:
        doc = (doc + "\n\n" + text).strip()
    if not doc and not (lead.get("org_name") or lead.get("contact_last")):
        raise HTTPException(400, "Add a PDF or paste some research text to enrich from")
    try:
        result = await ai_enrich(lead, doc)
    except Exception as e:  # noqa: BLE001
        # Always fail cleanly (never surface a gateway 502 to the client).
        raise HTTPException(502, f"AI enrichment failed: {e}")
    job_id = str(uuid.uuid4())
    await db.enrichment_jobs.insert_one({
        "id": job_id, "lead_id": lead_id, "kind": "ai", "status": "preview",
        "contact": result["contact"], "summary": result["summary"], "notes": result["notes"],
        "created_by": user["id"], "created_at": now_iso()})
    found = {k: v for k, v in result["contact"].items() if v}
    return {"job_id": job_id, "found": found, "summary": result["summary"],
            "notes": result["notes"], "source_chars": len(doc)}


class AcceptAIInput(BaseModel):
    job_id: str
    fields: list[str] = []      # contact keys to apply
    save_note: bool = True      # save summary + other details as an 'AI update' note


@router.post("/leads/{lead_id}/ai-enrich/accept")
async def accept_ai_enrich(lead_id: str, data: AcceptAIInput, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    job = await db.enrichment_jobs.find_one({"id": data.job_id, "lead_id": lead_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "AI enrichment job not found")
    contact = job.get("contact") or {}
    enr = dict(lead.get("enrichment") or {})
    top_patch = {}
    applied = []
    for f in data.fields:
        val = contact.get(f)
        if not val or f not in CONTACT_FIELDS:
            continue
        enr[f] = provenance(val, "AI (document)", "MEDIUM")
        enr[f]["accepted_by"] = user.get("name")
        top = _TOP.get(f)
        if top and not lead.get(top):
            top_patch[top] = val
        applied.append(f)
    set_doc = {"enrichment": enr, **top_patch}

    note_added = False
    if data.save_note and (job.get("summary") or job.get("notes")):
        lines = []
        if job.get("summary"):
            lines.append(job["summary"])
        for b in (job.get("notes") or []):
            lines.append(f"• {b}")
        note = {"id": str(uuid.uuid4()),
                "text": "🤖 AI update:\n" + "\n".join(lines),
                "author_id": user["id"], "author_name": f"{user.get('name')} (AI)",
                "visibility": "team", "pinned": False, "created_at": now_iso(),
                "edited_at": None, "edits": []}
        notes = list(lead.get("notes") or [])
        notes.insert(0, note)
        set_doc["notes"] = notes
        note_added = True

    await db.crm_leads.update_one({"id": lead_id}, {"$set": set_doc})
    await db.enrichment_jobs.update_one({"id": data.job_id}, {"$set": {"status": "accepted"}})
    await log_event("lead", lead_id, "enrichment", user,
                    f"AI enrichment applied ({len(applied)} field(s))"
                    + (" + note" if note_added else ""), {"fields": applied})
    return {"ok": True, "applied": applied, "note_added": note_added}
