"""AI-powered lead enrichment from a document (PDF/text) or research paste.
Extracts contact/practice fields with the Emergent LLM key; everything else
becomes an 'AI update' note. Never invents data — extracts only what's present."""
import io

import httpx
from pypdf import PdfReader

from ai import generate, parse_json, lead_context

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
