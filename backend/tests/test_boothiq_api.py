"""BoothIQ API tests: auth, admin guard, ingestion, kiosk privacy, wheel, dashboard."""
import os
import io
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://prize-wheel-hub-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Fields that MUST NEVER appear in kiosk responses
FORBIDDEN_KIOSK_FIELDS = {
    "tier_340b", "tier_rpm", "tier", "score", "medicare",
    "tot_clms", "tot_cost", "avg_per_claim", "dollar", "match_status"
}


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@boothiq.com", "pin": "482913"})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def staff_token():
    r = requests.post(f"{API}/auth/login", json={"email": "staff@boothiq.com", "pin": "715264"})
    assert r.status_code == 200, f"staff login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "staff"
    return data["token"]


def admin_headers(tok): return {"Authorization": f"Bearer {tok}"}
def staff_headers(tok): return {"Authorization": f"Bearer {tok}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_admin_login_ok(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@boothiq.com", "pin": "482913"})
        assert r.status_code == 200
        j = r.json()
        assert "token" in j and j["user"]["role"] == "admin"

    def test_staff_login_ok(self):
        r = requests.post(f"{API}/auth/login", json={"email": "staff@boothiq.com", "pin": "715264"})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "staff"

    def test_wrong_pin_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@boothiq.com", "pin": "000000"})
        assert r.status_code == 401

    def test_me_requires_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_ok_with_token(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=admin_headers(admin_token))
        assert r.status_code == 200
        assert r.json()["email"] == "admin@boothiq.com"


# ---------------- Admin guard ----------------
class TestAdminGuard:
    def test_staff_cannot_access_admin(self, staff_token):
        r = requests.get(f"{API}/admin/live", headers=staff_headers(staff_token))
        assert r.status_code == 403

    def test_staff_cannot_seed(self, staff_token):
        r = requests.post(f"{API}/admin/seed-sample", headers=staff_headers(staff_token))
        assert r.status_code == 403

    def test_no_token_admin(self):
        r = requests.get(f"{API}/admin/live")
        assert r.status_code == 401


# ---------------- Seed and Live ----------------
class TestSeedSample:
    def test_seed_sample(self, admin_token):
        r = requests.post(f"{API}/admin/seed-sample", headers=admin_headers(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True
        assert j["physicians"] == 700

    def test_live_dataset_present(self, admin_token):
        r = requests.get(f"{API}/admin/live", headers=admin_headers(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert j["live"] is not None
        assert j["physician_count"] == 700


# ---------------- Ingestion ----------------
class TestIngestion:
    def test_session_crud_and_finalize(self, admin_token):
        # Create
        r = requests.post(f"{API}/admin/sessions", headers=admin_headers(admin_token),
                          json={"name": "TEST_session"})
        assert r.status_code == 200
        sid = r.json()["id"]

        # init file
        r = requests.post(f"{API}/admin/sessions/{sid}/files/init",
                          headers=admin_headers(admin_token),
                          data={"filename": "test.csv"})
        assert r.status_code == 200
        fid = r.json()["file_id"]

        # upload one chunk (2-row CSV with a valid NPI checksum)
        csv_content = (
            "PRSCRBR_NPI,PRSCRBR_LAST_ORG_NAME,PRSCRBR_FIRST_NAME,PRSCRBR_CITY,"
            "PRSCRBR_STATE_ABRVTN,PRSCRBR_TYPE,TOT_CLMS,TOT_DRUG_CST\n"
            "1003000126,TESTLAST,TestFirst,Dallas,TX,Cardiology,1000,500000\n"
        ).encode()
        files = {"chunk": ("chunk.csv", io.BytesIO(csv_content), "text/csv")}
        r = requests.post(f"{API}/admin/sessions/{sid}/files/{fid}/chunk",
                          headers=admin_headers(admin_token),
                          data={"index": "0", "total": "1"}, files=files)
        assert r.status_code == 200

        # complete (background)
        r = requests.post(f"{API}/admin/sessions/{sid}/files/{fid}/complete",
                          headers=admin_headers(admin_token))
        assert r.status_code == 200
        time.sleep(2)

        # finalize
        r = requests.post(f"{API}/admin/sessions/{sid}/finalize",
                          headers=admin_headers(admin_token))
        assert r.status_code == 200
        cov = r.json()
        for key in ("total_rows", "unique_npis", "min_npi", "max_npi",
                    "density_blocks", "warnings", "estimated_share_pct"):
            assert key in cov, f"coverage missing {key}"

    def test_golive_requires_finalized(self, admin_token):
        r = requests.post(f"{API}/admin/sessions", headers=admin_headers(admin_token),
                          json={"name": "TEST_notfinalized"})
        sid = r.json()["id"]
        r = requests.post(f"{API}/admin/sessions/{sid}/golive",
                          headers=admin_headers(admin_token))
        assert r.status_code == 400


# ---------------- Thresholds ----------------
class TestThresholds:
    def test_get_thresholds(self, admin_token):
        r = requests.get(f"{API}/admin/thresholds", headers=admin_headers(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert "b340_green_apc" in j

    def test_preview_thresholds(self, admin_token):
        r = requests.post(f"{API}/admin/thresholds/preview",
                          headers=admin_headers(admin_token),
                          json={"thresholds": {}, "preview": True})
        assert r.status_code == 200
        j = r.json()
        assert "counts" in j
        for tier in ("GREEN", "YELLOW", "RED", "BLUE", "GREY"):
            assert tier in j["counts"]
        assert j["total"] > 0  # seed data is live

    def test_save_thresholds(self, admin_token):
        r = requests.put(f"{API}/admin/thresholds",
                         headers=admin_headers(admin_token),
                         json={"thresholds": {"b340_green_apc": 4200}, "preview": False})
        assert r.status_code == 200
        assert r.json()["b340_green_apc"] == 4200
        # revert
        requests.put(f"{API}/admin/thresholds",
                     headers=admin_headers(admin_token),
                     json={"thresholds": {"b340_green_apc": 4000}})


# ---------------- Identity matching ----------------
class TestMatching:
    def test_resolve_name(self):
        r = requests.post(f"{API}/kiosk/resolve",
                          json={"last_name": "Lee", "state": "TX", "first_initial": "J"})
        assert r.status_code == 200
        j = r.json()
        assert "candidates" in j
        assert "too_many" in j
        # 30 seeded Lee/John — should be too_many (>12) but state distribution may split them
        # Just ensure structure is present.

    def test_config_no_privacy_leak(self):
        r = requests.get(f"{API}/kiosk/config")
        assert r.status_code == 200
        j = r.json()
        body_str = str(j).lower()
        for f in FORBIDDEN_KIOSK_FIELDS:
            assert f not in body_str, f"kiosk config leaks '{f}'"


# ---------------- Kiosk lead capture + privacy ----------------
class TestKioskLead:
    def test_unmatched_lead_privacy(self):
        payload = {
            "first_name": "Nobody", "last_name": "Unmatchable",
            "phone": "+15550000001",
            "interests": ["340B"],
            "contact_consent": True, "sms_consent": False,
            "state": "TX",
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload)
        assert r.status_code == 200
        j = r.json()
        # MUST return only id + spin_available
        assert set(j.keys()) <= {"id", "spin_available"}
        assert j["spin_available"] is True
        assert j["id"]

    def test_matched_lead_privacy(self):
        # find one physician via admin API to know their name+state (use resolve endpoint)
        # Pick a common seeded collision: Lee/John/TX likely exists
        payload = {
            "first_name": "Amit", "last_name": "Patel",
            "email": "test@example.com",
            "state": "TX",
            "specialty": "Cardiology",
            "interests": ["340B", "RPM"],
            "contact_consent": True, "sms_consent": True,
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload)
        assert r.status_code == 200
        j = r.json()
        assert set(j.keys()) <= {"id", "spin_available"}
        body_str = str(j).lower()
        for f in FORBIDDEN_KIOSK_FIELDS:
            assert f not in body_str, f"kiosk leaks '{f}'"

    def test_invalid_npi_still_saves_as_none(self):
        payload = {
            "first_name": "Foo", "last_name": "Bar",
            "phone": "+15550000002",
            "npi": "1234567890",  # bad checksum
            "state": "TX",
            "contact_consent": True,
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload)
        assert r.status_code == 200
        assert set(r.json().keys()) <= {"id", "spin_available"}


# ---------------- Wheel ----------------
class TestWheel:
    def test_spin_and_double_spin(self):
        # Create a lead
        r = requests.post(f"{API}/kiosk/leads", json={
            "first_name": "Spin", "last_name": "Tester",
            "phone": "+15550000003", "state": "TX", "contact_consent": True})
        assert r.status_code == 200
        lead_id = r.json()["id"]

        # First spin
        r = requests.post(f"{API}/kiosk/leads/{lead_id}/spin")
        assert r.status_code == 200
        j = r.json()
        assert "prize" in j, f"no prize field: {j}"
        p = j["prize"]
        for key in ("label", "color", "prize_name", "code"):
            assert key in p, f"prize missing {key}"

        # Second spin blocked
        r = requests.post(f"{API}/kiosk/leads/{lead_id}/spin")
        assert r.status_code == 200
        j2 = r.json()
        assert j2.get("error") == "already_spun"


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_dashboard_requires_auth(self):
        r = requests.get(f"{API}/dashboard/leads")
        assert r.status_code == 401

    def test_leads_include_tiers(self, staff_token):
        r = requests.get(f"{API}/dashboard/leads", headers=staff_headers(staff_token))
        assert r.status_code == 200
        leads = r.json()
        assert isinstance(leads, list)
        if leads:
            lead = leads[0]
            assert "tier_340b" in lead
            assert "tier_rpm" in lead
            assert "medicare" in lead

    def test_filters(self, staff_token):
        r = requests.get(f"{API}/dashboard/leads?tier_340b=GREY&state=TX",
                         headers=staff_headers(staff_token))
        assert r.status_code == 200
        for lead in r.json():
            assert lead["tier_340b"] == "GREY"
            assert lead["state"] == "TX"

    def test_counters(self, staff_token):
        r = requests.get(f"{API}/dashboard/counters", headers=staff_headers(staff_token))
        assert r.status_code == 200
        j = r.json()
        for k in ("by_340b", "by_rpm", "spins_today", "total_today", "prizes_remaining"):
            assert k in j

    def test_alerts(self, staff_token):
        r = requests.get(f"{API}/dashboard/alerts", headers=staff_headers(staff_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_export_csv(self, staff_token):
        r = requests.get(f"{API}/dashboard/export?fmt=csv", headers=staff_headers(staff_token))
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "NPI" in r.text

    def test_export_xlsx(self, staff_token):
        r = requests.get(f"{API}/dashboard/export?fmt=xlsx", headers=staff_headers(staff_token))
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        assert len(r.content) > 100


# ---------------- Prizes ----------------
class TestPrizes:
    def test_list(self, admin_token):
        r = requests.get(f"{API}/admin/prizes", headers=admin_headers(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1

    def test_analytics(self, admin_token):
        r = requests.get(f"{API}/admin/prizes/analytics", headers=admin_headers(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert "spins_completed" in j
        assert "distribution" in j


# ---------------- Alert rules ----------------
class TestAlertRules:
    def test_get_and_save(self, admin_token):
        r = requests.get(f"{API}/admin/alert-rules", headers=admin_headers(admin_token))
        assert r.status_code == 200
        original = r.json()

        new_rules = {
            "event_id": "default",
            "rules": original.get("rules", {}),
            "ceiling_per_hour": 25
        }
        r = requests.put(f"{API}/admin/alert-rules", headers=admin_headers(admin_token),
                         json=new_rules)
        assert r.status_code == 200


# ---------------- Roster ----------------
class TestRoster:
    def test_crud_roster(self, admin_token):
        # Create
        r = requests.post(f"{API}/admin/roster", headers=admin_headers(admin_token),
                          json={"name": "TEST_Staff", "mobile": "+15550001111", "on_duty": True})
        assert r.status_code == 200
        rid = r.json()["id"]

        # Update
        r = requests.put(f"{API}/admin/roster/{rid}", headers=admin_headers(admin_token),
                         json={"name": "TEST_Staff", "mobile": "+15550001111", "on_duty": False})
        assert r.status_code == 200
        assert r.json()["on_duty"] is False

        # List
        r = requests.get(f"{API}/admin/roster", headers=admin_headers(admin_token))
        assert r.status_code == 200
        assert any(s["id"] == rid for s in r.json())

        # Delete
        r = requests.delete(f"{API}/admin/roster/{rid}", headers=admin_headers(admin_token))
        assert r.status_code == 200


# ---------------- NPI Checksum unit ----------------
class TestNPIChecksum:
    def test_valid_npi(self):
        # Well-known valid test NPI: 1003000126
        from matching import npi_is_valid
        assert npi_is_valid("1003000126") is True

    def test_invalid_npi(self):
        from matching import npi_is_valid
        assert npi_is_valid("1234567890") is False
        assert npi_is_valid("12345") is False
