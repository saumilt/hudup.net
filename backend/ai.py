"""AI Copilot helper — one-shot generations via the Emergent universal key."""
import os
import json as _json
import uuid

from emergentintegrations.llm.chat import LlmChat, UserMessage

DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-5.4"


def _key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


async def generate(system: str, prompt: str, want_json: bool = False,
                   provider: str = DEFAULT_PROVIDER, model: str = DEFAULT_MODEL) -> str:
    if not _key():
        raise RuntimeError("AI key not configured")
    chat = LlmChat(api_key=_key(), session_id=str(uuid.uuid4()),
                   system_message=system).with_model(provider, model)
    resp = await chat.send_message(UserMessage(text=prompt))
    return resp if isinstance(resp, str) else str(resp)


def parse_json(text: str):
    """Best-effort JSON extraction from an LLM response."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:]
    a, b = t.find("{"), t.rfind("}")
    if a != -1 and b != -1:
        t = t[a:b + 1]
    try:
        return _json.loads(t)
    except Exception:
        return None


def lead_context(lead: dict) -> str:
    """Compact, privacy-safe (internal CRM) context block for prompts."""
    snap = lead.get("medicare_snapshot") or {}
    enr = lead.get("enrichment") or {}
    parts = [
        f"Practice/Org: {lead.get('org_name') or '—'}",
        f"Contact: {(lead.get('contact_first') or '')} {(lead.get('contact_last') or '')}".strip(),
        f"Specialty: {snap.get('specialty') or lead.get('specialty') or '—'}",
        f"Location: {lead.get('city') or snap.get('city') or ''}, {lead.get('state') or snap.get('state') or ''}",
        f"CRM status: {lead.get('status')}  Priority: {lead.get('priority')}",
    ]
    if lead.get("medicare_match_status") == "matched":
        parts.append(f"Medicare (CMS {snap.get('dataset_year')}): 340B tier {snap.get('tier_340b')}, "
                     f"RPM tier {snap.get('tier_rpm')}, total claims {snap.get('tot_clms')}, "
                     f"total drug cost ${snap.get('tot_cost')}, avg ${snap.get('avg_per_claim')}/claim")
    if enr:
        title = (enr.get("job_title") or {}).get("value")
        li = (enr.get("linkedin_url") or {}).get("value")
        if title:
            parts.append(f"Title: {title}")
        if li:
            parts.append(f"LinkedIn: {li}")
    acts = [a.get("summary") for a in (lead.get("activity") or [])[:5]]
    if acts:
        parts.append("Recent activity: " + "; ".join(acts))
    return "\n".join(parts)
