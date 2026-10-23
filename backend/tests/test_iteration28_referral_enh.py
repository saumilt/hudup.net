"""
Iteration 28 — Referral enhancement backend tests.

Covers:
  - GET /api/medicare/physicians/lookup (name + NPI, capability payload)
  - GET /api/crm/referral-performance (per-source rows + totals)
  - PATCH /api/crm/leads/{id} with referral_generator_id (set + clear)
  - Saved-search persistence of source_type / profession / doctor_npi
"""
import os
import pytest
import requests
from pathlib import Path

def _read_env(key):
    envp = Path("/app/frontend/.env")
    if envp.exists():
        for ln in envp.read_text().splitlines():
            if ln.startswith(f"{key}="):
                return ln.split("=", 1)[1].strip().strip('"')
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_env("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"


def _login(session, email, pin):
    r = session.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    session.headers.update({"Authorization": f"Bearer {tok}"})
    return r.json()


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, "sam@healthandmore.net", "8677")
    return s


@pytest.fixture(scope="module")
def lead_manager():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, "leadmanager@boothiq.com", "639201")
    return s


# ---- physician lookup -------------------------------------------------------
class TestPhysicianLookup:
    def test_lookup_by_name(self, admin):
        r = admin.get(f"{API}/medicare/physicians/lookup", params={"q": "smith"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "results" in body and isinstance(body["results"], list)
        assert len(body["results"]) >= 1
        first = body["results"][0]
        for k in ("npi", "first_name", "last_name", "city", "state"):
            assert k in first
        assert "capability" in first
        cap = first["capability"]
        assert cap["level"] in ("High", "Medium", "Low")
        assert isinstance(cap["reasons"], list) and len(cap["reasons"]) >= 1

    def test_lookup_by_npi(self, admin):
        # Grab an NPI from a name search, then lookup directly
        r = admin.get(f"{API}/medicare/physicians/lookup", params={"q": "smith"}, timeout=30)
        npi = r.json()["results"][0]["npi"]
        r2 = admin.get(f"{API}/medicare/physicians/lookup", params={"q": npi}, timeout=30)
        assert r2.status_code == 200
        found = [row for row in r2.json()["results"] if row["npi"] == npi]
        assert found, f"NPI {npi} not returned in lookup by NPI"
        assert "capability" in found[0]

    def test_lookup_short_query(self, admin):
        r = admin.get(f"{API}/medicare/physicians/lookup", params={"q": "a"}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {"results": []}

    def test_lookup_as_lead_manager(self, lead_manager):
        r = lead_manager.get(f"{API}/medicare/physicians/lookup", params={"q": "smith"}, timeout=30)
        assert r.status_code == 200
        assert len(r.json()["results"]) >= 1


# ---- referral performance ---------------------------------------------------
class TestReferralPerformance:
    def test_performance_shape(self, admin):
        r = admin.get(f"{API}/crm/referral-performance", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body and "totals" in body
        for key in ("sources", "leads", "opportunities", "won", "accounts"):
            assert key in body["totals"]
            assert isinstance(body["totals"][key], int)
        for row in body["rows"]:
            for k in ("id", "name", "source_type", "leads", "opportunities", "won", "accounts", "conversion_rate"):
                assert k in row, f"missing {k} in row {row}"
            assert 0 <= row["conversion_rate"] <= 100


# ---- saved search persistence + lead patch ---------------------------------
class TestSavedSourceAndLeadPatch:
    created_source_id = None
    created_lead_id = None

    def test_create_doctor_source(self, admin):
        # Resolve a real physician first
        lookup = admin.get(f"{API}/medicare/physicians/lookup", params={"q": "smith"}, timeout=30).json()["results"]
        assert lookup
        doc = lookup[0]
        payload = {
            "name": "TEST_iter28_Doctor_Source",
            "entity": "referral",
            "query": {
                "source_type": "doctor",
                "doctor_npi": doc["npi"],
                "name": "TEST_iter28_Doctor_Source",
                "origin": f"{doc['city']}, {doc['state']}",
                "specialty": doc.get("specialty") or "",
                "radius": {"mode": "mi", "miles": 25, "driveMin": 0, "mph": 45},
                "tiers": [], "tier_rpm": "",
            },
        }
        r = admin.post(f"{API}/crm/saved-searches", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        sid = r.json().get("id")
        assert sid
        TestSavedSourceAndLeadPatch.created_source_id = sid

        # Confirm it comes back with the extra fields
        got = admin.get(f"{API}/crm/saved-searches", params={"entity": "referral"}, timeout=20).json()
        row = next((x for x in got if x["id"] == sid), None)
        assert row is not None
        q = row["query"]
        assert q["source_type"] == "doctor"
        assert q["doctor_npi"] == doc["npi"]

    def test_create_other_source(self, admin):
        payload = {
            "name": "TEST_iter28_Other_Source",
            "entity": "referral",
            "query": {
                "source_type": "other",
                "profession": "Office Manager",
                "source_note": "Front desk",
                "name": "TEST_iter28_Other_Source",
                "origin": "06510",
                "radius": {"mode": "mi", "miles": 15, "driveMin": 0, "mph": 45},
                "tiers": [], "tier_rpm": "",
            },
        }
        r = admin.post(f"{API}/crm/saved-searches", json=payload, timeout=20)
        assert r.status_code in (200, 201)
        got = admin.get(f"{API}/crm/saved-searches", params={"entity": "referral"}, timeout=20).json()
        row = next((x for x in got if x["id"] == r.json()["id"]), None)
        assert row and row["query"]["source_type"] == "other"
        assert row["query"]["profession"] == "Office Manager"
        # cleanup this one immediately
        admin.delete(f"{API}/crm/saved-searches/{r.json()['id']}", timeout=20)

    def test_create_lead_with_referral_generator(self, admin):
        sid = TestSavedSourceAndLeadPatch.created_source_id
        assert sid, "need created source"
        payload = {
            "contact_first": "TESTITER28",
            "contact_last": "Patient",
            "org_name": "TEST_iter28 Clinic",
            "source": "Referral Search",
            "priority": "Medium",
            "city": "NEW HAVEN", "state": "CT",
            "referral_generator_id": sid,
            "referral_generator_name": "TEST_iter28_Doctor_Source",
        }
        r = admin.post(f"{API}/crm/leads", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        lead = r.json()
        lid = lead.get("id")
        assert lid
        TestSavedSourceAndLeadPatch.created_lead_id = lid

        got = admin.get(f"{API}/crm/leads/{lid}", timeout=20).json()
        assert got["referral_generator_id"] == sid
        assert got["referral_generator_name"] == "TEST_iter28_Doctor_Source"

    def test_counts_includes_new_lead(self, admin):
        sid = TestSavedSourceAndLeadPatch.created_source_id
        counts = admin.get(f"{API}/crm/referral-generators/counts", timeout=20).json()
        assert counts.get(sid, 0) >= 1

    def test_performance_reflects_new_lead(self, admin):
        sid = TestSavedSourceAndLeadPatch.created_source_id
        perf = admin.get(f"{API}/crm/referral-performance", timeout=30).json()
        row = next((r for r in perf["rows"] if r["id"] == sid), None)
        assert row is not None, "new source missing from performance report"
        assert row["leads"] >= 1
        assert row["source_type"] == "doctor"

    def test_patch_lead_clear_referral(self, admin):
        lid = TestSavedSourceAndLeadPatch.created_lead_id
        r = admin.patch(f"{API}/crm/leads/{lid}", json={"referral_generator_id": "", "referral_generator_name": ""}, timeout=20)
        assert r.status_code == 200, r.text
        got = admin.get(f"{API}/crm/leads/{lid}", timeout=20).json()
        assert got.get("referral_generator_id") in (None, "")
        assert got.get("referral_generator_name") in (None, "")

    def test_patch_lead_set_referral(self, admin):
        lid = TestSavedSourceAndLeadPatch.created_lead_id
        sid = TestSavedSourceAndLeadPatch.created_source_id
        r = admin.patch(f"{API}/crm/leads/{lid}", json={"referral_generator_id": sid, "referral_generator_name": "TEST_iter28_Doctor_Source"}, timeout=20)
        assert r.status_code == 200, r.text
        got = admin.get(f"{API}/crm/leads/{lid}", timeout=20).json()
        assert got["referral_generator_id"] == sid
        assert got["referral_generator_name"] == "TEST_iter28_Doctor_Source"

    def test_zz_cleanup(self, admin):
        sid = TestSavedSourceAndLeadPatch.created_source_id
        lid = TestSavedSourceAndLeadPatch.created_lead_id
        if lid:
            # unlink then (best effort) hard delete — admin can delete leads
            admin.patch(f"{API}/crm/leads/{lid}", json={"referral_generator_id": "", "referral_generator_name": ""}, timeout=20)
            admin.delete(f"{API}/crm/leads/{lid}", timeout=20)
        if sid:
            admin.delete(f"{API}/crm/saved-searches/{sid}", timeout=20)
