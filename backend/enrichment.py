"""People Data Labs enrichment (person + company). Key stays server-side."""
import os
import httpx

from crm_common import confidence_band

PDL_PERSON = "https://api.peopledatalabs.com/v5/person/enrich"
PDL_COMPANY = "https://api.peopledatalabs.com/v5/company/enrich"


def _key() -> str | None:
    return os.environ.get("PDL_API_KEY")


class EnrichmentError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


async def _call(url: str, params: dict) -> dict:
    key = _key()
    if not key:
        raise EnrichmentError(503, "Enrichment provider not configured")
    clean = {k: v for k, v in params.items() if v}
    clean.update(min_likelihood=6, include_if_matched="true", titlecase="true")
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0)) as client:
        try:
            r = await client.get(url, params=clean,
                                 headers={"X-Api-Key": key, "Accept": "application/json"})
        except httpx.RequestError as e:
            raise EnrichmentError(502, f"Enrichment network error: {e}")
    if r.status_code == 404:
        raise EnrichmentError(404, "No confident match found")
    if r.status_code == 401:
        raise EnrichmentError(500, "Enrichment authentication failed")
    if r.status_code == 402:
        raise EnrichmentError(402, "Enrichment credit limit reached")
    if r.status_code == 429:
        raise EnrichmentError(429, "Enrichment rate limit reached — try again shortly")
    if r.status_code >= 400:
        raise EnrichmentError(502, "Enrichment request failed")
    return r.json()


async def enrich_person(first_name=None, last_name=None, name=None, company=None,
                        city=None, region=None, email=None, phone=None) -> dict:
    """Returns {likelihood, confidence, data} where data holds professional fields."""
    params = {
        "name": name, "first_name": first_name, "last_name": last_name,
        "company": company, "locality": city, "region": region,
        "email": email, "phone": phone,
    }
    res = await _call(PDL_PERSON, params)
    data = res.get("data", {}) or {}
    likelihood = res.get("likelihood")
    phones = data.get("phone_numbers")
    phone = phones[0] if isinstance(phones, list) and phones else None
    edu = [e.get("school", {}).get("name") for e in (data.get("education") or [])
           if isinstance(e, dict) and e.get("school")]
    fields = {
        "full_name": data.get("full_name"),
        "job_title": data.get("job_title"),
        "job_company_name": data.get("job_company_name"),
        "work_email": data.get("work_email"),
        "linkedin_url": data.get("linkedin_url"),
        "phone": phone,
        "location": data.get("location_name"),
        "industry": data.get("industry"),
        "education": edu[:3],
    }
    # PDL returns `true` for plan-gated fields (value exists but not returned).
    fields = {k: (None if isinstance(v, bool) else v) for k, v in fields.items()}
    return {
        "likelihood": likelihood,
        "confidence": confidence_band(likelihood),
        "matched": res.get("matched"),
        "fields": fields,
    }


async def enrich_company(name=None, website=None, city=None, region=None) -> dict:
    res = await _call(PDL_COMPANY, {"name": name, "website": website,
                                    "locality": city, "region": region})
    likelihood = res.get("likelihood")
    return {
        "likelihood": likelihood,
        "confidence": confidence_band(likelihood),
        "fields": {
            "name": res.get("name"),
            "website": res.get("website"),
            "linkedin_url": res.get("linkedin_url"),
            "industry": res.get("industry"),
            "size": res.get("size"),
            "employee_count": res.get("employee_count"),
            "founded": res.get("founded"),
            "location": (res.get("location") or {}).get("name"),
        },
    }
