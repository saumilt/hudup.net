"""Iteration 11 — Wave 15 Marketing Campaigns backend tests.

Covers:
- CRM campaigns CRUD + role gating (lead_manager only, account_manager 403)
- Public capture form GET + POST (no auth), require_email + status gating
- Lead source attribution (source=Campaign, campaign_id/name propagated)
- Captured count increments in campaign stats
- Captured lead visible in /api/crm/leads
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN = ("admin@boothiq.com", "482913")
LM = ("leadmanager@boothiq.com", "639201")
AM = ("accountmanager@boothiq.com", "528174")


def _login(email, pin):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def lm_token():
    return _login(*LM)


@pytest.fixture(scope="module")
def am_token():
    return _login(*AM)


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- META + ROLE GATING ----------
class TestCampaignMeta:
    def test_meta_ok_for_lead_manager(self, lm_token):
        r = requests.get(f"{BASE_URL}/api/crm/campaigns/meta", headers=_h(lm_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j.get("channels"), list) and "Event / Booth" in j["channels"]
        assert isinstance(j.get("statuses"), list) and "Draft" in j["statuses"]
        assert isinstance(j.get("capture_fields"), list)

    def test_list_campaigns_forbidden_for_account_manager(self, am_token):
        r = requests.get(f"{BASE_URL}/api/crm/campaigns", headers=_h(am_token), timeout=15)
        assert r.status_code == 403

    def test_create_campaign_forbidden_for_account_manager(self, am_token):
        r = requests.post(
            f"{BASE_URL}/api/crm/campaigns",
            headers=_h(am_token),
            json={"name": "TEST_am_forbidden"},
            timeout=15,
        )
        assert r.status_code == 403


# ---------- CRUD + LIFECYCLE ----------
class TestCampaignsCrud:
    campaign_id = None
    slug = None
    campaign_name = None

    def test_create_campaign(self, lm_token):
        name = f"TEST_iter11_{uuid.uuid4().hex[:6]}"
        TestCampaignsCrud.campaign_name = name
        payload = {
            "name": name,
            "channel": "Event / Booth",
            "status": "Active",
            "budget": 2500,
            "goal_leads": 40,
            "capture": {
                "enabled": True,
                "headline": "Meet BoothIQ",
                "subhead": "Enter to win",
                "interests": ["Cardiology", "Oncology", "Primary Care"],
                "thank_you": "Thanks!",
                "require_email": True,
            },
        }
        r = requests.post(
            f"{BASE_URL}/api/crm/campaigns", headers=_h(lm_token), json=payload, timeout=15
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["name"] == name
        assert j["channel"] == "Event / Booth"
        assert j["status"] == "Active"
        assert j["capture"]["enabled"] is True
        assert j["capture"]["require_email"] is True
        assert j["capture"]["slug"].startswith("test_iter11_") or j["capture"]["slug"]
        assert "campaign_number" in j and j["campaign_number"].startswith("C-")
        assert j["stats"]["captured"] == 0
        TestCampaignsCrud.campaign_id = j["id"]
        TestCampaignsCrud.slug = j["capture"]["slug"]

    def test_list_campaigns_includes_new(self, lm_token):
        r = requests.get(f"{BASE_URL}/api/crm/campaigns", headers=_h(lm_token), timeout=15)
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()]
        assert TestCampaignsCrud.campaign_id in ids

    def test_get_campaign_detail(self, lm_token):
        r = requests.get(
            f"{BASE_URL}/api/crm/campaigns/{TestCampaignsCrud.campaign_id}",
            headers=_h(lm_token),
            timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["id"] == TestCampaignsCrud.campaign_id
        assert "recent_leads" in j and isinstance(j["recent_leads"], list)
        assert "stats" in j

    def test_patch_campaign_status_paused(self, lm_token):
        r = requests.patch(
            f"{BASE_URL}/api/crm/campaigns/{TestCampaignsCrud.campaign_id}",
            headers=_h(lm_token),
            json={"status": "Paused"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "Paused"


# ---------- PUBLIC CAPTURE FORM ----------
class TestPublicCaptureForm:
    active_campaign_id = None
    active_slug = None
    active_name = None
    captured_lead_number = None

    def test_setup_fresh_active_campaign(self, lm_token):
        name = f"TEST_pub_{uuid.uuid4().hex[:6]}"
        TestPublicCaptureForm.active_name = name
        r = requests.post(
            f"{BASE_URL}/api/crm/campaigns",
            headers=_h(lm_token),
            json={
                "name": name,
                "channel": "Event / Booth",
                "status": "Active",
                "capture": {
                    "enabled": True,
                    "headline": "Free swag",
                    "interests": ["Devices"],
                    "require_email": True,
                },
            },
            timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        TestPublicCaptureForm.active_campaign_id = j["id"]
        TestPublicCaptureForm.active_slug = j["capture"]["slug"]

    def test_public_get_form_no_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/public/campaigns/{TestPublicCaptureForm.active_slug}", timeout=15
        )
        assert r.status_code == 200
        j = r.json()
        assert j["headline"] == "Free swag"
        assert j["enabled"] is True
        assert j["require_email"] is True
        assert "Devices" in j["interests"]
        # Auth-only fields should not be present
        assert "created_by" not in j

    def test_public_get_form_unknown_slug_404(self):
        r = requests.get(
            f"{BASE_URL}/api/public/campaigns/does-not-exist-xyz", timeout=15
        )
        assert r.status_code == 404

    def test_public_submit_missing_email_400(self):
        r = requests.post(
            f"{BASE_URL}/api/public/campaigns/{TestPublicCaptureForm.active_slug}/submit",
            json={"contact_first": "Jane", "contact_last": "Doe"},
            timeout=15,
        )
        assert r.status_code == 400
        assert "email" in r.text.lower()

    def test_public_submit_success_creates_lead(self):
        r = requests.post(
            f"{BASE_URL}/api/public/campaigns/{TestPublicCaptureForm.active_slug}/submit",
            json={
                "contact_first": "TESTF",
                "contact_last": "TESTL_iter11",
                "org_name": "TEST Cardiology iter11",
                "email": f"iter11_{uuid.uuid4().hex[:6]}@example.com",
                "phone": "+15551239876",
                "specialty": "Cardiology",
                "state": "ca",
                "interests": ["Devices", "Follow-up"],
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j["lead_number"].startswith("L-")
        TestPublicCaptureForm.captured_lead_number = j["lead_number"]

    def test_lead_attribution_and_visible_in_crm(self, lm_token):
        # find the lead via /api/crm/leads
        r = requests.get(
            f"{BASE_URL}/api/crm/leads",
            headers=_h(lm_token),
            params={"q": TestPublicCaptureForm.captured_lead_number, "limit": 20},
            timeout=15,
        )
        # tolerate either 'q' or fetch all and filter
        assert r.status_code == 200, r.text
        rows = r.json() if isinstance(r.json(), list) else r.json().get("leads", [])
        match = None
        for l in rows:
            if l.get("lead_number") == TestPublicCaptureForm.captured_lead_number:
                match = l
                break
        if match is None:
            # fallback: fetch all and filter
            r2 = requests.get(
                f"{BASE_URL}/api/crm/leads", headers=_h(lm_token),
                params={"limit": 500}, timeout=20)
            rows2 = r2.json() if isinstance(r2.json(), list) else r2.json().get("leads", [])
            for l in rows2:
                if l.get("lead_number") == TestPublicCaptureForm.captured_lead_number:
                    match = l
                    break
        assert match is not None, "captured lead not found in /api/crm/leads"
        assert match.get("source") == "Campaign"
        assert match.get("campaign_id") == TestPublicCaptureForm.active_campaign_id
        assert match.get("campaign_name") == TestPublicCaptureForm.active_name
        assert match.get("source_details") == TestPublicCaptureForm.active_name
        tags = match.get("tags") or []
        assert "Devices" in tags

    def test_campaign_stats_captured_incremented(self, lm_token):
        r = requests.get(
            f"{BASE_URL}/api/crm/campaigns/{TestPublicCaptureForm.active_campaign_id}",
            headers=_h(lm_token),
            timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["stats"]["captured"] >= 1
        # recent_leads should include our capture
        nums = [l.get("lead_number") for l in j.get("recent_leads", [])]
        assert TestPublicCaptureForm.captured_lead_number in nums

    def test_public_submit_paused_returns_409(self, lm_token):
        # pause the campaign
        r = requests.patch(
            f"{BASE_URL}/api/crm/campaigns/{TestPublicCaptureForm.active_campaign_id}",
            headers=_h(lm_token),
            json={"status": "Paused"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "Paused"
        r2 = requests.post(
            f"{BASE_URL}/api/public/campaigns/{TestPublicCaptureForm.active_slug}/submit",
            json={"email": "paused@example.com", "contact_first": "P"},
            timeout=15,
        )
        assert r2.status_code == 409

    def test_public_submit_completed_returns_409(self, lm_token):
        r = requests.patch(
            f"{BASE_URL}/api/crm/campaigns/{TestPublicCaptureForm.active_campaign_id}",
            headers=_h(lm_token),
            json={"status": "Completed"},
            timeout=15,
        )
        assert r.status_code == 200
        r2 = requests.post(
            f"{BASE_URL}/api/public/campaigns/{TestPublicCaptureForm.active_slug}/submit",
            json={"email": "done@example.com"},
            timeout=15,
        )
        assert r2.status_code == 409

    def test_delete_campaign(self, lm_token):
        r = requests.delete(
            f"{BASE_URL}/api/crm/campaigns/{TestPublicCaptureForm.active_campaign_id}",
            headers=_h(lm_token),
            timeout=15,
        )
        assert r.status_code == 200
        # form now 404
        r2 = requests.get(
            f"{BASE_URL}/api/public/campaigns/{TestPublicCaptureForm.active_slug}", timeout=15
        )
        assert r2.status_code == 404
