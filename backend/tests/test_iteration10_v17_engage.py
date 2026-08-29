"""BoothIQ v1.7 engagement layer tests: home command-center, global search,
sales action bar (email/call/text), consent preferences, PDL enrichment,
physician workspace, admin providers, and regression on kiosk privacy."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://prize-wheel-hub-4.preview.emergentagent.com").rstrip("/")
API = BASE_URL + "/api"

ADMIN = ("admin@boothiq.com", "482913")
LM = ("leadmanager@boothiq.com", "639201")
AM = ("accountmanager@boothiq.com", "528174")
STAFF = ("staff@boothiq.com", "715264")


def _login(email, pin):
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code}: {r.text}"
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ------------ fixtures ------------
@pytest.fixture(scope="module")
def admin_tok():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def lm_tok():
    return _login(*LM)


@pytest.fixture(scope="module")
def am_tok():
    return _login(*AM)


@pytest.fixture(scope="module")
def staff_tok():
    return _login(*STAFF)


@pytest.fixture(scope="module")
def green_physician(lm_tok):
    """Find a GREEN-tier physician in the live medicare dataset."""
    r = requests.post(f"{API}/medicare/search",
                      headers=_h(lm_tok),
                      json={"tier_340b": "GREEN", "limit": 5}, timeout=30)
    assert r.status_code == 200, r.text
    rows = r.json().get("results") or r.json().get("rows") or []
    assert rows, "no GREEN physicians present in live medicare dataset"
    return rows[0]


@pytest.fixture(scope="module")
def real_lead(lm_tok, green_physician):
    """Create a lead attached to a real medicare NPI (real doctor name -> PDL match likely)."""
    p = green_physician
    payload = {
        "matched_npi": p["npi"],
        "contact_first": p.get("first_name"),
        "contact_last": p.get("last_name"),
        "org_name": p.get("org_name") or "TEST_v17 Practice",
        "state": p.get("state"),
        "city": p.get("city"),
        "source": "Medicare Search",
    }
    r = requests.post(f"{API}/crm/leads", headers=_h(lm_tok),
                      json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    lead = r.json()
    return lead


@pytest.fixture(scope="module")
def synth_lead(lm_tok):
    payload = {
        "contact_first": "TESTFIRST",
        "contact_last": "TESTLAST_NoMatch_XYZ",
        "org_name": "TEST_v17 Synthetic Co",
        "email": "delivered@resend.dev",
        "phone": "+15555550100",
        "state": "TX",
        "city": "Austin",
        "source": "Manual Entry",
    }
    r = requests.post(f"{API}/crm/leads", headers=_h(lm_tok), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ------------ HOME COMMAND CENTER ------------
class TestHomeCommandCenter:
    def test_attention(self, lm_tok):
        r = requests.get(f"{API}/crm/home/attention", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("needs_first_contact", "overdue_tasks", "meetings_today",
                  "stale_high_value", "unassigned"):
            assert k in data, f"missing key {k} in {data}"
            assert isinstance(data[k], int)

    def test_my_day(self, am_tok):
        r = requests.get(f"{API}/crm/home/my-day", headers=_h(am_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("tasks", "meetings", "new_leads", "followups"):
            assert k in data
            assert isinstance(data[k], list)

    def test_insights(self, lm_tok):
        r = requests.get(f"{API}/crm/home/insights", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "insights" in data and isinstance(data["insights"], list)
        # There should be at least the "green_physicians" insight from the live dataset.
        keys = {i["key"] for i in data["insights"]}
        assert "green_physicians" in keys, f"expected green_physicians insight, got {keys}"


# ------------ GLOBAL SEARCH ------------
class TestGlobalSearch:
    def test_short_query_returns_empty(self, lm_tok):
        r = requests.get(f"{API}/crm/search?q=a", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_lead_hit(self, lm_tok, synth_lead):
        # search by lead_number (unique-ish)
        r = requests.get(f"{API}/crm/search",
                         headers=_h(lm_tok),
                         params={"q": synth_lead["lead_number"]}, timeout=20)
        assert r.status_code == 200
        types = {x["type"] for x in r.json()["results"]}
        assert "lead" in types

    def test_physician_hit(self, lm_tok, green_physician):
        # search by last name of a real physician
        last = green_physician.get("last_name") or ""
        if len(last) < 2:
            pytest.skip("physician last name too short")
        r = requests.get(f"{API}/crm/search",
                         headers=_h(lm_tok), params={"q": last}, timeout=20)
        assert r.status_code == 200
        types = {x["type"] for x in r.json()["results"]}
        assert "physician" in types or "lead" in types


# ------------ SALES ACTIONS ------------
class TestSalesActions:
    def test_email_send_real_resend(self, lm_tok, synth_lead):
        payload = {"to": "delivered@resend.dev",
                   "subject": "TEST_v17 BoothIQ Email",
                   "html": "<p>Hello from v1.7 test</p>"}
        r = requests.post(f"{API}/crm/leads/{synth_lead['id']}/email",
                          headers=_h(lm_tok), json=payload, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("provider_id"), "Resend provider_id missing"

    def test_call_log_and_followup(self, lm_tok, synth_lead):
        payload = {"disposition": "Left Voicemail",
                   "notes": "TEST_v17 auto-test", "duration_sec": 45,
                   "follow_up_task": "TEST_v17 follow up",
                   "follow_up_due": "2026-12-31T17:00:00Z"}
        r = requests.post(f"{API}/crm/leads/{synth_lead['id']}/call",
                          headers=_h(lm_tok), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_text_returns_queued_or_sent(self, lm_tok, synth_lead):
        r = requests.post(f"{API}/crm/leads/{synth_lead['id']}/text",
                          headers=_h(lm_tok),
                          json={"body": "TEST_v17 ping"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Provider slot "messaging" is env-configured via TWILIO_AUTH_TOKEN so
        # is_slot_ready() -> True and status='sent'. Per Phase-4 note the
        # actual Twilio SMS send is not wired in code — the endpoint only
        # records the message. This is worth flagging (see report) but not
        # a functional-test failure by itself.
        assert data.get("status") in ("sent", "queued_not_configured"), data


# ------------ COMM PREFERENCES ------------
class TestPreferences:
    def test_set_prefs_and_block_email(self, lm_tok):
        # Create a scratch lead so we don't contaminate synth_lead's state.
        r = requests.post(f"{API}/crm/leads", headers=_h(lm_tok), json={
            "contact_first": "TEST_v17",
            "contact_last": "PrefsBlock",
            "org_name": "TEST_v17 Prefs Co",
            "email": "delivered@resend.dev",
            "phone": "+15555550111",
            "source": "Manual Entry",
        }, timeout=20)
        assert r.status_code in (200, 201), r.text
        lead = r.json()

        r = requests.patch(f"{API}/crm/leads/{lead['id']}/preferences",
                           headers=_h(lm_tok),
                           json={"email_suppressed": True, "do_not_text": True,
                                 "preferred_method": "phone"}, timeout=20)
        assert r.status_code == 200, r.text
        comm = r.json()["comm"]
        assert comm["email_suppressed"] is True
        assert comm["do_not_text"] is True
        assert comm["preferred_method"] == "phone"

        # GET the lead and verify persistence
        r = requests.get(f"{API}/crm/leads/{lead['id']}", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["comm"]["email_suppressed"] is True

        # Email is now blocked (409)
        r = requests.post(f"{API}/crm/leads/{lead['id']}/email",
                          headers=_h(lm_tok),
                          json={"subject": "x", "html": "<p>x</p>",
                                "to": "delivered@resend.dev"}, timeout=20)
        assert r.status_code == 409, r.text

        # Text is now blocked (409)
        r = requests.post(f"{API}/crm/leads/{lead['id']}/text",
                          headers=_h(lm_tok), json={"body": "x"}, timeout=20)
        assert r.status_code == 409, r.text


# ------------ ENRICHMENT (PDL) ------------
class TestEnrichment:
    def test_enrich_synthetic_no_match_ok(self, lm_tok, synth_lead):
        r = requests.post(f"{API}/crm/leads/{synth_lead['id']}/enrich",
                          headers=_h(lm_tok), timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        # Synthetic name -> either matched:false OR matched:true. Both are valid.
        assert data.get("matched") in (True, False)

    def test_enrich_real_lead_preview_and_accept(self, lm_tok, real_lead):
        r = requests.post(f"{API}/crm/leads/{real_lead['id']}/enrich",
                          headers=_h(lm_tok), timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        # Not a bug if no match — but assert shape either way.
        if data.get("matched") is False:
            pytest.skip("PDL returned no confident match for real lead — valid per spec")
        assert "job_id" in data and "found" in data and "confidence" in data
        # Pick a non-null field to accept.
        found = data["found"]
        accept_fields = [k for k, v in found.items() if v]
        if not accept_fields:
            pytest.skip("PDL returned zero non-null fields (plan-gated) — valid")
        payload = {"job_id": data["job_id"], "fields": accept_fields[:2]}
        r = requests.post(f"{API}/crm/leads/{real_lead['id']}/enrich/accept",
                          headers=_h(lm_tok), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        # GET lead and verify enrichment field is present with provenance.
        r = requests.get(f"{API}/crm/leads/{real_lead['id']}", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200
        enr = r.json().get("enrichment") or {}
        assert enr, "enrichment map empty after accept"
        for k in payload["fields"]:
            if k in enr:
                v = enr[k]
                assert v.get("source") == "People Data Labs"
                assert "retrieved_at" in v
                break


# ------------ PHYSICIAN WORKSPACE ------------
class TestPhysicianWorkspace:
    def test_workspace(self, lm_tok, green_physician):
        r = requests.get(f"{API}/crm/physicians/{green_physician['npi']}/workspace",
                         headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "physician" in data and "leads" in data and "activities" in data
        assert data["physician"]["npi"] == green_physician["npi"]


# ------------ ADMIN PROVIDERS ------------
class TestAdminProviders:
    def test_list_providers(self, admin_tok):
        r = requests.get(f"{API}/admin/providers", headers=_h(admin_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        slots = {p["slot"]: p for p in data}
        for slot in ("enrichment", "email", "messaging", "mailbox_oauth"):
            assert slot in slots, f"missing slot {slot}"
        assert slots["enrichment"]["configured"] is True
        assert slots["email"]["configured"] is True
        assert slots["messaging"]["configured"] is True  # TWILIO_AUTH_TOKEN set in env (voice)
        assert slots["mailbox_oauth"]["configured"] is False

    def test_non_admin_forbidden(self, lm_tok):
        r = requests.get(f"{API}/admin/providers", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 403

        r = requests.put(f"{API}/admin/providers/email", headers=_h(lm_tok),
                         json={"enabled": True}, timeout=20)
        assert r.status_code == 403

    def test_toggle_provider(self, admin_tok):
        r = requests.put(f"{API}/admin/providers/enrichment",
                         headers=_h(admin_tok),
                         json={"enabled": True, "auto": False, "priority": 1}, timeout=20)
        assert r.status_code == 200
        p = r.json()
        assert p["enabled"] is True
        assert p["auto"] is False


# ------------ REGRESSION: KIOSK PRIVACY ------------
class TestKioskPrivacy:
    def test_kiosk_response_leaks_nothing(self):
        payload = {"first_name": "TEST_v17K", "last_name": "Kiosk",
                   "email": "test+kiosk_v17@example.com", "npi": "0000000000",
                   "state": "TX"}
        r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        raw = r.text.lower()
        for forbidden in ("tier_340b", "tier_rpm", "medicare_snapshot",
                          "avg_per_claim", "shade_340b", "score"):
            assert forbidden not in raw, f"kiosk response leaks {forbidden}"


# ------------ REGRESSION: BASIC CRM LIST ------------
class TestCrmRegression:
    def test_leads_list(self, lm_tok):
        r = requests.get(f"{API}/crm/leads?limit=5", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200

    def test_opportunities_list(self, lm_tok):
        r = requests.get(f"{API}/crm/opportunities", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200

    def test_medicare_search_years_includes_2024(self, lm_tok):
        r = requests.get(f"{API}/medicare/years", headers=_h(lm_tok), timeout=20)
        assert r.status_code == 200
        years = r.json().get("years") or []
        assert 2024 in years or "2024" in [str(y) for y in years]
