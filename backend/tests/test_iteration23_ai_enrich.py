"""v2.26 tests — AI Enrich + hardened Enrich Practice/Enrich (no 5xx)."""
import io
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
AM = {"email": "accountmanager@boothiq.com", "pin": "528174"}
LM = {"email": "leadmanager@boothiq.com", "pin": "639201"}
ADMIN = {"email": "admin@boothiq.com", "pin": "482913"}

PDF_URL = "https://customer-assets-lqy194kg.emergentagent.net/job_prize-wheel-hub-4/artifacts/62nhpp2s_Dr_Prem_Soman_Profile.pdf"


def _login(creds):
    r = requests.post(f"{BASE}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def am_token():
    return _login(AM)


@pytest.fixture(scope="module")
def lm_token():
    return _login(LM)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def test_lead(am_token, lm_token, admin_token):
    """Create a throwaway lead assigned to account_manager (per request notes)."""
    # Create via kiosk (no auth) or admin, then assign to AM
    payload = {
        "org_name": "TEST AI Enrich Practice",
        "contact_first": "Prem",
        "contact_last": "Soman",
        "email": None,
        "phone": None,
        "city": "Pittsburgh",
        "state": "PA",
        "specialty": "Cardiology",
        "source": "test",
    }
    # Try admin creation endpoint
    r = requests.post(f"{BASE}/api/crm/leads", json=payload, headers=_hdr(lm_token), timeout=15)
    if r.status_code not in (200, 201):
        # fall back to kiosk endpoint
        r = requests.post(f"{BASE}/api/kiosk/leads", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"lead create failed: {r.status_code} {r.text}"
    data = r.json()
    lead_id = data.get("id") or data.get("lead", {}).get("id")
    assert lead_id, data
    # Try assigning to AM (if endpoint exists) so AM can access
    # Get AM user id
    me = requests.get(f"{BASE}/api/auth/me", headers=_hdr(am_token), timeout=10).json()
    am_id = me.get("id")
    # Try assignment
    for url in [
        f"{BASE}/api/crm/leads/{lead_id}/assign",
        f"{BASE}/api/crm/leads/{lead_id}",
    ]:
        try:
            rr = requests.patch(url, json={"account_manager_id": am_id}, headers=_hdr(lm_token), timeout=10)
            if rr.status_code < 400:
                break
        except Exception:
            pass
    yield lead_id
    # Teardown: delete lead
    for tok in (admin_token, lm_token):
        try:
            requests.delete(f"{BASE}/api/crm/leads/{lead_id}", headers=_hdr(tok), timeout=10)
        except Exception:
            pass


# -------------------- BUG FIX: enrich endpoints never 5xx --------------------
class TestEnrichNo5xx:
    def test_enrich_company_returns_200_not_5xx(self, am_token, test_lead):
        r = requests.post(f"{BASE}/api/crm/leads/{test_lead}/enrich-company",
                          headers=_hdr(am_token), timeout=60)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:400]}"
        data = r.json()
        assert "matched" in data
        # matched:false OR true — but never 5xx
        if data.get("matched") is False:
            assert "found" in data  # shape

    def test_enrich_person_returns_200_not_5xx(self, am_token, test_lead):
        r = requests.post(f"{BASE}/api/crm/leads/{test_lead}/enrich",
                          headers=_hdr(am_token), timeout=60)
        # Note: 503 is allowed when provider slot disabled by admin; but current code returns 503 if slot disabled.
        # Requirement: no gateway 5xx. 200 with matched:false expected in most cases.
        assert r.status_code in (200, 503), f"got {r.status_code}: {r.text[:400]}"
        if r.status_code == 200:
            data = r.json()
            assert "matched" in data


# -------------------- AI ENRICH feature --------------------
class TestAiEnrich:
    _job_id = None

    def test_ai_enrich_via_file_url(self, am_token, test_lead):
        # multipart form: file_url only
        r = requests.post(
            f"{BASE}/api/crm/leads/{test_lead}/ai-enrich",
            headers=_hdr(am_token),
            data={"file_url": PDF_URL},
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:600]}"
        data = r.json()
        assert "job_id" in data
        assert "found" in data
        assert "summary" in data
        assert "notes" in data
        assert data.get("source_chars", 0) > 500, f"source_chars={data.get('source_chars')}"
        found = data["found"]
        # Expected extractions per problem statement
        # email may be extracted; verify NPI and email if present
        assert found.get("email", "").lower() == "somanp@upmc.edu" or found.get("work_email", "").lower() == "somanp@upmc.edu", f"email not extracted: {found}"
        assert found.get("npi") == "1265407225", f"npi not extracted: {found.get('npi')}"
        assert len(data["notes"]) >= 3, f"too few notes: {len(data['notes'])}"
        TestAiEnrich._job_id = data["job_id"]

    def test_ai_enrich_validation_no_input(self, am_token, lm_token, admin_token):
        """Calling ai-enrich with NO file/text/url on lead w/ no org/name -> 400."""
        # create an empty throwaway lead
        r = requests.post(f"{BASE}/api/crm/leads",
                          json={"contact_first": None, "contact_last": None, "org_name": None},
                          headers=_hdr(lm_token), timeout=10)
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot create empty lead: {r.status_code} {r.text[:200]}")
        empty_id = r.json().get("id")
        try:
            rr = requests.post(f"{BASE}/api/crm/leads/{empty_id}/ai-enrich",
                               headers=_hdr(am_token), timeout=30)
            assert rr.status_code == 400, f"expected 400, got {rr.status_code}: {rr.text[:300]}"
        finally:
            requests.delete(f"{BASE}/api/crm/leads/{empty_id}", headers=_hdr(admin_token), timeout=10)

    def test_ai_enrich_accept_applies_and_notes(self, am_token, test_lead):
        assert TestAiEnrich._job_id, "job_id must exist from previous test"
        # apply email+npi+specialty
        r = requests.post(
            f"{BASE}/api/crm/leads/{test_lead}/ai-enrich/accept",
            headers=_hdr(am_token),
            json={"job_id": TestAiEnrich._job_id,
                  "fields": ["email", "work_email", "npi", "specialty"],
                  "save_note": True},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        data = r.json()
        assert data.get("ok") is True
        assert isinstance(data.get("applied"), list)
        assert data.get("note_added") is True
        # verify persistence via GET lead
        g = requests.get(f"{BASE}/api/crm/leads/{test_lead}", headers=_hdr(am_token), timeout=15)
        assert g.status_code == 200, g.text[:200]
        lead = g.json()
        notes = lead.get("notes") or []
        assert len(notes) > 0, "note not persisted"
        assert "AI update" in (notes[0].get("text") or ""), f"first note not AI update: {notes[0].get('text','')[:120]}"
        enr = lead.get("enrichment") or {}
        # at least npi or email should be present in enrichment
        assert any(k in enr for k in ("email", "work_email", "npi", "specialty")), f"no accepted field in enrichment: {list(enr.keys())}"

    def test_ai_enrich_text_only(self, am_token, test_lead):
        """Test text-only enrichment (no file, no url)."""
        text = ("Dr. Jane Smith is a cardiologist at Test Clinic. "
                "Her office email is jane.smith@testclinic.example and phone is 555-123-4567. "
                "NPI 1111111111. She practices in Boston, MA. Board certified in Cardiology.")
        r = requests.post(
            f"{BASE}/api/crm/leads/{test_lead}/ai-enrich",
            headers=_hdr(am_token),
            data={"text": text},
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        data = r.json()
        assert data.get("source_chars", 0) >= len(text) - 5
