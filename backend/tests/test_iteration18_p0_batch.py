"""Iteration 18 — BoothIQ v2.18 P0 batch backend tests.

Covers:
1. GET /api/crm/call-stats/today (account_manager)
2. GET /api/crm/call-lists returns called/total/remaining
3. GET /api/crm/leads with state + tier + source filters combined
4. Saved Filters CRUD via /api/crm/saved-searches (scoped per user)
5. Auto-enrich on capture: POST /api/public/campaigns/{slug}/submit creates lead (single submit only, no PDL assertion)
6. Import wizard phone/email mapping end-to-end
"""
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

LM_EMAIL = "leadmanager@boothiq.com"
LM_PIN = "639201"
AM_EMAIL = "accountmanager@boothiq.com"
AM_PIN = "528174"
ADMIN_EMAIL = "admin@boothiq.com"
ADMIN_PIN = "482913"


# ---------------- Fixtures ----------------
def _login(email, pin):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"Login failed {email}: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def lm():
    tok, user = _login(LM_EMAIL, LM_PIN)
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def am():
    tok, user = _login(AM_EMAIL, AM_PIN)
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def admin():
    tok, user = _login(ADMIN_EMAIL, ADMIN_PIN)
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


# ============ Feature 3: Call Stats Today ============
class TestCallStatsToday:
    def test_get_calls_today_for_am(self, am):
        r = requests.get(f"{BASE_URL}/api/crm/call-stats/today", headers=am["headers"], timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "calls_today" in data
        assert isinstance(data["calls_today"], int)
        assert data["calls_today"] >= 0

    def test_get_calls_today_for_lm(self, lm):
        r = requests.get(f"{BASE_URL}/api/crm/call-stats/today", headers=lm["headers"], timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json().get("calls_today"), int)

    def test_get_calls_today_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/crm/call-stats/today", timeout=10)
        assert r.status_code in (401, 403)


# ============ Feature 4: call-lists returns called/total/remaining ============
class TestCallListsProgress:
    def test_call_lists_have_progress_fields(self, am):
        r = requests.get(f"{BASE_URL}/api/crm/call-lists", headers=am["headers"], timeout=15)
        assert r.status_code == 200
        lists = r.json()
        assert isinstance(lists, list)
        for cl in lists:
            assert "called" in cl, f"missing called in {cl.keys()}"
            assert "total" in cl
            assert "remaining" in cl
            assert isinstance(cl["called"], int)
            assert isinstance(cl["total"], int)
            assert isinstance(cl["remaining"], int)
            # called is clamped to total
            assert cl["called"] <= cl["total"]
            # remaining = total - called (when clamped)
            assert cl["remaining"] == max(0, cl["total"] - cl["called"])

    def test_call_lists_lm_sees_all(self, lm):
        r = requests.get(f"{BASE_URL}/api/crm/call-lists", headers=lm["headers"], timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ============ Feature 5: Leads filters state/tier/source ============
class TestLeadsFilters:
    def test_filter_state_uppercases(self, lm):
        # Pass lowercase to verify uppercasing
        r = requests.get(f"{BASE_URL}/api/crm/leads?state=ca", headers=lm["headers"], timeout=15)
        assert r.status_code == 200
        leads = r.json()
        assert isinstance(leads, list)
        for l in leads:
            # state is stored uppercase or None; filter applies uppercased
            assert (l.get("state") or "").upper() == "CA" or l.get("state") is None or l.get("state") == "CA"
            # Stronger: any lead returned must have state == 'CA'
            assert l.get("state") == "CA"

    def test_filter_tier(self, lm):
        r = requests.get(f"{BASE_URL}/api/crm/leads?tier=GREEN", headers=lm["headers"], timeout=15)
        assert r.status_code == 200
        leads = r.json()
        for l in leads:
            snap = l.get("medicare_snapshot") or {}
            assert snap.get("tier_340b") == "GREEN"

    def test_filter_source(self, lm):
        # Grab sources
        r0 = requests.get(f"{BASE_URL}/api/crm/lead-sources", headers=lm["headers"], timeout=10)
        assert r0.status_code == 200
        sources = r0.json()
        if not sources:
            pytest.skip("No sources defined")
        src = sources[0].get("name") if isinstance(sources[0], dict) else sources[0]
        r = requests.get(f"{BASE_URL}/api/crm/leads", headers=lm["headers"], params={"source": src}, timeout=15)
        assert r.status_code == 200
        for l in r.json():
            assert l.get("source") == src

    def test_combined_state_tier_narrows(self, lm):
        # First get all leads with state=CA
        r_state = requests.get(f"{BASE_URL}/api/crm/leads?state=CA", headers=lm["headers"], timeout=15)
        assert r_state.status_code == 200
        state_count = len(r_state.json())
        # Now add tier=GREEN — should be <= state_count
        r_both = requests.get(f"{BASE_URL}/api/crm/leads?state=CA&tier=GREEN", headers=lm["headers"], timeout=15)
        assert r_both.status_code == 200
        both_count = len(r_both.json())
        assert both_count <= state_count, f"combined {both_count} > state-only {state_count}"


# ============ Feature 6: Saved Filters CRUD ============
class TestSavedFilters:
    def test_saved_search_lifecycle(self, lm):
        h = lm["headers"]
        # CREATE
        payload = {"name": "TEST_SF_state_ca_green",
                   "entity": "leads",
                   "query": {"state": "CA", "tier": "GREEN"}}
        rc = requests.post(f"{BASE_URL}/api/crm/saved-searches", json=payload, headers=h, timeout=10)
        assert rc.status_code == 200, rc.text
        created = rc.json()
        sid = created["id"]
        assert created["name"] == payload["name"]
        assert created["entity"] == "leads"
        assert created["query"] == payload["query"]

        # LIST scoped to leads
        rl = requests.get(f"{BASE_URL}/api/crm/saved-searches?entity=leads", headers=h, timeout=10)
        assert rl.status_code == 200
        items = rl.json()
        assert any(x["id"] == sid for x in items)
        for x in items:
            assert x["entity"] == "leads"

        # DELETE
        rd = requests.delete(f"{BASE_URL}/api/crm/saved-searches/{sid}", headers=h, timeout=10)
        assert rd.status_code == 200
        assert rd.json().get("ok") is True

        # Verify gone
        rl2 = requests.get(f"{BASE_URL}/api/crm/saved-searches?entity=leads", headers=h, timeout=10)
        assert not any(x["id"] == sid for x in rl2.json())

    def test_saved_search_scoped_per_user(self, lm, am):
        # LM creates a saved search
        payload = {"name": "TEST_SF_lm_only", "entity": "leads", "query": {"state": "TX"}}
        rc = requests.post(f"{BASE_URL}/api/crm/saved-searches", json=payload, headers=lm["headers"], timeout=10)
        assert rc.status_code == 200
        sid = rc.json()["id"]

        # AM must NOT see it
        r_am = requests.get(f"{BASE_URL}/api/crm/saved-searches?entity=leads", headers=am["headers"], timeout=10)
        assert r_am.status_code == 200
        assert not any(x["id"] == sid for x in r_am.json()), "saved search leaked across users"

        # cleanup
        requests.delete(f"{BASE_URL}/api/crm/saved-searches/{sid}", headers=lm["headers"], timeout=10)


# ============ Feature 1: Auto-enrich on capture (single submit, no PDL assertion) ============
class TestCaptureAutoEnrich:
    def test_capture_submit_creates_lead(self, lm):
        # Note: task says slug 'prize-wheel-hub-4' but that's the preview host slug, not a campaign.
        # Use any Active campaign with capture enabled.
        h = lm["headers"]
        r_list = requests.get(f"{BASE_URL}/api/crm/campaigns", headers=h, timeout=10)
        assert r_list.status_code == 200
        active = [c for c in r_list.json()
                  if (c.get("capture") or {}).get("enabled") and c.get("status") == "Active"]
        if not active:
            pytest.skip("No active capture campaigns in this env")
        slug = (active[0]["capture"] or {}).get("slug")
        assert slug
        rg = requests.get(f"{BASE_URL}/api/public/campaigns/{slug}", timeout=10)
        assert rg.status_code == 200, rg.text

        payload = {
            "contact_first": "TEST_Autoenrich",
            "contact_last": f"Iter18_{int(time.time())}",
            "org_name": "TEST_Autoenrich Org",
            "email": f"test_autoenrich_{int(time.time())}@example.com",
            "phone": "+15551234567",
            "state": "CA",
        }
        r = requests.post(f"{BASE_URL}/api/public/campaigns/{slug}/submit",
                          json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "lead_number" in data, f"missing lead_number: {data}"
        assert data["lead_number"].startswith("L-")
        # Do NOT assert on enrichment — best-effort background task


# ============ Feature 2: Import wizard phone/email mapping ============
class TestImportPhoneEmail:
    def test_full_import_flow_with_phone_email(self, lm):
        h = lm["headers"]
        # Small CSV with phone + email
        ts = int(time.time())
        csv_data = (
            "Organization,First,Last,Phone,Email,State\n"
            f"TEST_Import_Org_A_{ts},John,Doe,555-100-1001,test_import_a_{ts}@example.com,CA\n"
            f"TEST_Import_Org_B_{ts},Jane,Roe,555-100-1002,test_import_b_{ts}@example.com,TX\n"
        )
        files = {"file": (f"test_import_{ts}.csv", csv_data.encode(), "text/csv")}
        # 1) POST /api/imports — upload file, get import_id
        r_up = requests.post(f"{BASE_URL}/api/imports", headers=h,
                             files=files, data={"dataset_type": "lead"}, timeout=30)
        assert r_up.status_code == 200, r_up.text
        up = r_up.json()
        job_id = up["import_id"]
        assert "Phone" in up["headers"]
        assert "Email" in up["headers"]

        # 2) POST /analyze — AI mapping (returns suggested mapping)
        r_an = requests.post(f"{BASE_URL}/api/imports/{job_id}/analyze",
                             headers=h, timeout=60)
        assert r_an.status_code == 200, r_an.text
        an = r_an.json()
        # Verify phone/email columns detected via heuristic fallback
        assert an["mapping"].get("Phone") == "phone", f"Phone not mapped: {an['mapping']}"
        assert an["mapping"].get("Email") == "email", f"Email not mapped: {an['mapping']}"

        # 3) POST /mapping — confirm mapping
        mapping = {
            "Organization": "org_name",
            "First": "contact_first",
            "Last": "contact_last",
            "Phone": "phone",
            "Email": "email",
            "State": "state",
        }
        r_map = requests.post(f"{BASE_URL}/api/imports/{job_id}/mapping",
                              headers=h,
                              json={"mapping": mapping, "rule": "safe",
                                    "source": "Manual Entry", "data_year": 2024,
                                    "distribute": "route"},
                              timeout=15)
        assert r_map.status_code == 200, r_map.text

        # 4) POST /validate
        r_val = requests.post(f"{BASE_URL}/api/imports/{job_id}/validate",
                              headers=h, timeout=60)
        assert r_val.status_code == 200, r_val.text

        # 5) POST /execute
        r_exec = requests.post(f"{BASE_URL}/api/imports/{job_id}/execute",
                               headers=h, timeout=120)
        assert r_exec.status_code == 200, r_exec.text
        exec_res = r_exec.json()
        # Search leads by our unique org name
        r_leads = requests.get(f"{BASE_URL}/api/crm/leads",
                               headers=h, params={"q": f"TEST_Import_Org_A_{ts}"}, timeout=15)
        assert r_leads.status_code == 200
        found = r_leads.json()
        assert len(found) >= 1, f"no lead found after import; exec_res={exec_res}"
        lead = found[0]
        assert lead.get("email") == f"test_import_a_{ts}@example.com", f"email: {lead.get('email')}"
        # phone stored as-is or normalized; verify substring
        assert "1001" in (lead.get("phone") or ""), f"phone: {lead.get('phone')}"
