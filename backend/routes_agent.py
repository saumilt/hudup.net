"""Wave 8 — Autonomous AI Agent. Proposes a human-in-the-loop action plan,
then executes only the actions the user approves. Always AI-labeled."""
import uuid
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import db, require_roles
from crm_common import now_iso, log_event, DEFAULT_COMM
from ai import generate, parse_json, lead_context

router = APIRouter(prefix="/api/crm")
ANY_CRM = require_roles("lead_manager", "account_manager", "staff")

PLAN_SYS = (
    "You are BoothIQ's autonomous sales agent for a healthcare services company selling "
    "340B specialty pharmacy, RPM, hospital pharmacy and MSO services to physicians. "
    "Given internal CRM context, produce a concise, compliant action plan. "
    "Never invent patient data. Return STRICT JSON only."
)
PLAN_FMT = (
    'Return JSON: {"summary": str, "reasoning": str, '
    '"next_actions": [{"type": "task"|"status"|"email"|"sms", "label": str, '
    '"value": str}], "draft_email": {"subject": str, "body": str}, "draft_sms": str}. '
    "For a status action, value must be one of: Attempting Contact, Contacted, Qualified, "
    "Nurture. Keep next_actions to the 3-4 highest-impact steps. SMS under 160 chars."
)


async def _get_lead(lead_id):
    lead = await db.crm_leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


@router.post("/leads/{lead_id}/agent/plan")
async def agent_plan(lead_id: str, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    try:
        out = parse_json(await generate(PLAN_SYS,
            f"{lead_context(lead)}\n\n{PLAN_FMT}", want_json=True)) or {}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"AI error: {e}")
    await log_event("lead", lead_id, "agent", user, "AI Agent generated an action plan")
    out["generated_at"] = now_iso()
    return out


class AgentAction(BaseModel):
    type: str
    value: str | None = None
    label: str | None = None


class AgentExecuteInput(BaseModel):
    actions: list[AgentAction] = []
    email: dict | None = None   # {subject, body} if an email action is approved
    sms: str | None = None      # sms body if an sms action is approved


@router.post("/leads/{lead_id}/agent/execute")
async def agent_execute(lead_id: str, data: AgentExecuteInput, user=Depends(ANY_CRM)):
    lead = await _get_lead(lead_id)
    comm = lead.get("comm") or DEFAULT_COMM
    done = []
    for a in data.actions:
        if a.type == "task":
            await db.crm_tasks.insert_one({
                "id": str(uuid.uuid4()), "title": a.value or a.label or "AI Agent task",
                "type": "task", "related_type": "lead", "related_id": lead_id,
                "assigned_to": lead.get("account_manager_id") or user["id"],
                "status": "open", "due_at": now_iso(), "created_at": now_iso(),
                "source": "ai_agent"})
            await log_event("lead", lead_id, "agent", user, f"AI Agent created task: {a.value or a.label}")
            done.append("task")
        elif a.type == "status" and a.value:
            await db.crm_leads.update_one({"id": lead_id}, {"$set": {"status": a.value}})
            await log_event("lead", lead_id, "agent", user, f"AI Agent set status → {a.value}")
            done.append("status")
        elif a.type == "email" and data.email and lead.get("email") and not comm.get("email_suppressed"):
            try:
                from emailer import send_email
                await send_email(to=lead["email"], subject=data.email.get("subject") or "Following up",
                                 html=f"<p>{(data.email.get('body') or '').replace(chr(10), '<br/>')}</p>")
                await log_event("lead", lead_id, "email", user, f"AI Agent sent email: {data.email.get('subject')}")
                done.append("email")
            except Exception:  # noqa: BLE001
                pass
        elif a.type == "sms" and data.sms and lead.get("phone") and not comm.get("do_not_text") and not comm.get("opt_out_at"):
            try:
                from deps import send_sms
                await asyncio.to_thread(send_sms, lead["phone"], data.sms)
                await log_event("lead", lead_id, "sms", user, f"AI Agent sent SMS: {data.sms[:50]}")
                done.append("sms")
            except Exception:  # noqa: BLE001
                pass
    return {"ok": True, "executed": done}
