"""AI Copilot endpoints — draft email/SMS, prep call, research, next action."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF, log_event
from ai import generate, parse_json, lead_context

router = APIRouter(prefix="/api/crm")
ANY_CRM = require_roles(ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF)

COMPANY = "BoothIQ Healthcare Services (340B specialty pharmacy, RPM, hospital pharmacy & MSO support)"


async def _lead(lead_id):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


class DraftInput(BaseModel):
    goal: str | None = None
    tone: str = "professional, warm, concise"


@router.post("/leads/{lead_id}/ai/draft-email")
async def draft_email(lead_id: str, data: DraftInput, user=Depends(ANY_CRM)):
    lead = await _lead(lead_id)
    sys = (f"You are a physician sales rep at {COMPANY}. Write a short, compliant B2B outreach "
           "email to a physician/practice. No patient data. Return STRICT JSON: "
           '{"subject": "...", "body": "..."} with body as 2-3 short paragraphs, no markdown.')
    prompt = f"Context:\n{lead_context(lead)}\n\nGoal: {data.goal or 'Introduce our services and request a brief meeting'}\nTone: {data.tone}"
    try:
        out = parse_json(await generate(sys, prompt, want_json=True)) or {}
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")
    await log_event("lead", lead_id, "ai", user, "AI drafted an email")
    return {"subject": out.get("subject", ""), "body": out.get("body", "")}


@router.post("/leads/{lead_id}/ai/draft-text")
async def draft_text(lead_id: str, data: DraftInput, user=Depends(ANY_CRM)):
    lead = await _lead(lead_id)
    sys = (f"You are a physician sales rep at {COMPANY}. Write ONE compliant SMS (<=320 chars), "
           "friendly and professional, no patient data, include a soft call to action. Return only the message text.")
    prompt = f"Context:\n{lead_context(lead)}\n\nGoal: {data.goal or 'Follow up and offer a quick call'}"
    try:
        body = (await generate(sys, prompt)).strip().strip('"')
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")
    await log_event("lead", lead_id, "ai", user, "AI drafted an SMS")
    return {"body": body[:320]}


@router.post("/leads/{lead_id}/ai/prep-call")
async def prep_call(lead_id: str, user=Depends(ANY_CRM)):
    lead = await _lead(lead_id)
    sys = (f"You are a sales coach at {COMPANY}. Prepare a rep for a physician call. Return STRICT JSON: "
           '{"overview":"...","why_calling":"...","talking_points":["..."],"questions":["..."],'
           '"objections":["..."],"desired_outcome":"..."}. Be concise and specific to the context.')
    try:
        out = parse_json(await generate(sys, f"Context:\n{lead_context(lead)}", want_json=True)) or {}
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")
    await log_event("lead", lead_id, "ai", user, "AI generated call preparation")
    return out


@router.post("/leads/{lead_id}/ai/research")
async def research(lead_id: str, user=Depends(ANY_CRM)):
    lead = await _lead(lead_id)
    sys = (f"You are a healthcare market analyst at {COMPANY}. Produce a concise practice/physician "
           "intelligence brief for a sales rep. Clearly separate what is KNOWN (from the given data) "
           "vs AI INTERPRETATION. Use short sections with headers. No patient data, no fabricated facts.")
    try:
        brief = await generate(sys, f"Context:\n{lead_context(lead)}\n\nWrite the brief.")
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")
    await log_event("lead", lead_id, "ai", user, "AI generated a practice research brief")
    return {"brief": brief}


@router.post("/leads/{lead_id}/ai/next-action")
async def next_action(lead_id: str, user=Depends(ANY_CRM)):
    lead = await _lead(lead_id)
    sys = (f"You are a sales strategist at {COMPANY}. Given the lead context, suggest the single best "
           "next action and a one-line reason. Return STRICT JSON: {\"action\":\"...\",\"reason\":\"...\"}.")
    try:
        out = parse_json(await generate(sys, f"Context:\n{lead_context(lead)}", want_json=True)) or {}
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")
    return out
