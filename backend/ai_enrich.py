"""AI-powered lead enrichment from a document (PDF/text) or research paste.
Extracts contact/practice fields with the Emergent LLM key; everything else
becomes an 'AI update' note. Never invents data — extracts only what's present."""
import io

import httpx
from pypdf import PdfReader

from ai import generate, generate_web_research, parse_json, lead_context

CONTACT_FIELDS = [
    "email", "work_email", "phone", "office_phone", "mobile_phone", "website",
    "linkedin_url", "title", "practice_name", "address", "city", "state", "zip",
    "npi", "specialty",
]

_SYSTEM = (
    "You are a precise data-extraction assistant for a medical-sales CRM. "
    "Extract ONLY facts explicitly present in the provided document text or CRM context. "
    "Never invent or guess contact details. Return strict JSON only."
)

_RESEARCH_SYSTEM = (
    "You are a research assistant for a medical-sales CRM. Use web search to find CURRENT, "
    "real information about the given medical practice and physician. Prefer official/primary "
    "sources (the practice's own website, hospital directories, the NPI registry, LinkedIn, "
    "state medical boards, Healthgrades). Only report details you actually found via search; "
    "if you can't verify a field, use null. Never fabricate contact details. Return strict JSON only."
)


def extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    out = []
    for page in reader.pages:
        try:
            out.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            continue
    return "\n".join(out)


async def fetch_bytes(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0), follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.content


async def ai_enrich(lead: dict, document_text: str | None) -> dict:
    ctx = lead_context(lead)
    src = (document_text or "").strip()
    prompt = f"""CRM CONTEXT (existing record):
{ctx}

SOURCE MATERIAL (research document / paste — may be empty):
\"\"\"
{src[:14000]}
\"\"\"

Extract a JSON object with EXACTLY these keys:
- "contact": an object with keys {CONTACT_FIELDS}. Use null for anything not found. Prefer a professional/work email and a direct office phone. "practice_name" is the clinic/hospital/organization. Keep phone numbers in a clean readable format.
- "summary": a concise 2-4 sentence professional summary of this physician suitable for a sales rep.
- "notes": an array of short factual bullet strings for EVERY other useful detail (hospital affiliations, education, board certifications, leadership roles, research interests, languages, accepted insurance, referral/appointment contacts, taxonomy, etc.).

Rules: Use ONLY information found in the SOURCE MATERIAL or CRM CONTEXT. Do NOT fabricate. Return JSON only, no prose."""
    raw = await generate(_SYSTEM, prompt, want_json=True)
    data = parse_json(raw) or {}
    contact = data.get("contact") or {}
    contact = {k: (contact.get(k) or None) for k in CONTACT_FIELDS}
    notes = data.get("notes") or []
    if isinstance(notes, str):
        notes = [notes]
    return {
        "contact": contact,
        "summary": (data.get("summary") or "").strip(),
        "notes": [str(n).strip() for n in notes if str(n).strip()],
    }


async def ai_research(lead: dict) -> dict:
    """Actively research the practice + physician on the web (OpenAI web search) using
    what's already on the record, then return the same {contact, summary, notes} shape."""
    ctx = lead_context(lead)
    prompt = f"""Research this medical practice and physician using web search, then report what you find.

CRM CONTEXT (what we already know):
{ctx}

Search the web using the practice name, physician name, city/state, and NPI (if present).
Return a JSON object with EXACTLY these keys:
- "contact": an object with keys {CONTACT_FIELDS}. Use null for anything you cannot verify from a source. Prefer the practice's official website, a direct office phone, and a professional/work email. "practice_name" is the clinic/hospital/organization; "address" is the practice's street address.
- "summary": a concise 2-4 sentence professional summary of the practice and physician for a sales rep (what they do, size/scope, notable facts).
- "notes": an array of short factual bullet strings for every other useful detail found (services offered, hospital/health-system affiliations, group or network, education, board certifications, other locations, office hours, insurance accepted, leadership roles, etc.).
- "sources": an array of the source URLs you actually used.

Rules: Use ONLY information you find via web search or the CRM context. If you cannot confidently find this practice/physician, return null contact fields and say so in the summary. Return JSON only, no prose."""
    raw = await generate_web_research(_RESEARCH_SYSTEM, prompt)
    data = parse_json(raw) or {}
    contact = data.get("contact") or {}
    contact = {k: (contact.get(k) or None) for k in CONTACT_FIELDS}
    notes = data.get("notes") or []
    if isinstance(notes, str):
        notes = [notes]
    notes = [str(n).strip() for n in notes if str(n).strip()]
    sources = data.get("sources") or []
    if isinstance(sources, str):
        sources = [sources]
    src_notes = [f"Source: {str(s).strip()}" for s in sources if str(s).strip()]
    return {
        "contact": contact,
        "summary": (data.get("summary") or "").strip(),
        "notes": notes + src_notes,
    }
