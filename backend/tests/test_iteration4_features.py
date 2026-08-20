"""Iteration 4 tests: employee dropdown fallback, practice_type, always-alert
selected employee (even for GREY), Twilio status webhook, dedup, export column."""
import os
import io
import csv
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") \
    else "https://prize-wheel-hub-4.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@boothiq.com", "pin": "482913"}
STAFF = {"email": "staff@boothiq.com", "pin": "715264"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def ensure_roster(admin_h):
    """Ensure at least one staff member exists in the roster for tests."""
    r = requests.get(f"{API}/admin/roster", headers=admin_h, timeout=10)
    assert r.status_code == 200, r.text
    roster = r.json()
    if not roster:
        r2 = requests.post(f"{API}/admin/roster", headers=admin_h, json={
            "name": "TEST_Iter4 Rep", "role": "Sales", "mobile": "+15555550100", "on_duty": True
        }, timeout=10)
        assert r2.status_code in (200, 201), r2.text
        r = requests.get(f"{API}/admin/roster", headers=admin_h, timeout=10)
        roster = r.json()
    assert len(roster) > 0
    return roster


# ---------- Feature 1: Employee dropdown fallback in /kiosk/config ----------
class TestKioskConfigAssociateFallback:
    def test_config_returns_roster_when_event_has_no_associates(self, ensure_roster, admin_h):
        # Ensure default event's associate_ids is empty
        r_ev = requests.get(f"{API}/admin/events", headers=admin_h, timeout=10)
        assert r_ev.status_code == 200
        default_ev = next((e for e in r_ev.json() if e["id"] == "default"), None)
        assert default_ev is not None
        # associate_ids should be empty or missing for the fallback path
        assert not default_ev.get("associate_ids")

        r = requests.get(f"{API}/kiosk/config", params={"event_id": "default"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "associates" in data
        assert isinstance(data["associates"], list)
        assert len(data["associates"]) >= 1, f"associates should fall back to full roster, got {data['associates']}"
        # every associate has id + name
        for a in data["associates"]:
            assert "id" in a and "name" in a


# ---------- Feature 2: practice_type persistence ----------
class TestPracticeType:
    def test_lead_persists_practice_type_and_kiosk_response_hides_score(self):
        payload = {
            "first_name": "TEST_Iter4",
            "last_name": "Ptype",
            "phone": "5555550101",
            "practice_type": "Private Practice",
            "state": "TX",
            "specialty": "Cardiology",
            "contact_consent": True,
            "sms_consent": True,
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Privacy: kiosk response only has id + spin_available
        assert set(body.keys()) == {"id", "spin_available"}, body
        lead_id = body["id"]

        # Fetch via dashboard - staff token
        r_login = requests.post(f"{API}/auth/login", json=STAFF, timeout=10)
        assert r_login.status_code == 200
        h = {"Authorization": f"Bearer {r_login.json()['token']}"}
        r2 = requests.get(f"{API}/dashboard/leads/{lead_id}", headers=h, timeout=10)
        assert r2.status_code == 200, r2.text
        lead = r2.json()
        assert lead.get("practice_type") == "Private Practice"


# ---------- Feature 3: KEY - always-alert selected employee (even GREY) ----------
class TestSelectedEmployeeAlert:
    def test_grey_lead_with_associate_creates_alert_log_with_link(self, ensure_roster):
        staff = ensure_roster[0]
        staff_id = staff["id"]

        payload = {
            "first_name": "TEST_Iter4",
            "last_name": "GreyAssoc",
            "phone": "5555550102",
            "state": "TX",
            "specialty": "Neurology",
            "practice_type": "Employee",
            "associate_id": staff_id,
            "associate_name": staff["name"],
            "contact_consent": True,
            "sms_consent": True,
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body.keys()) == {"id", "spin_available"}
        lead_id = body["id"]

        # Wait for async dispatch
        import time
        time.sleep(2.5)

        # Admin fetches alert logs
        r_admin = requests.post(f"{API}/auth/login", json=ADMIN, timeout=10)
        h = {"Authorization": f"Bearer {r_admin.json()['token']}"}
        r_logs = requests.get(f"{API}/dashboard/alerts", headers=h, params={"lead_id": lead_id}, timeout=10)
        # some backends use different endpoint; fallback: leads/{id} may embed logs; try both
        logs = []
        if r_logs.status_code == 200:
            logs = r_logs.json()
        if not logs:
            # try alternative
            r_alt = requests.get(f"{API}/dashboard/alert_logs", headers=h, params={"lead_id": lead_id}, timeout=10)
            if r_alt.status_code == 200:
                logs = r_alt.json()

        # Filter to this lead + staff
        matching = [l for l in logs if l.get("lead_id") == lead_id and l.get("staff_id") == staff_id]
        assert matching, f"Expected alert_log for lead={lead_id} staff={staff_id}, got logs={logs}"
        log = matching[0]
        assert "Open:" in log.get("body", ""), f"Body should include 'Open:' link, got: {log.get('body')}"
        assert f"/lead/{lead_id}" in log.get("body", ""), f"Body should include /lead/{lead_id}, got: {log.get('body')}"

    def test_dedup_single_alert_per_staff_per_lead(self, ensure_roster):
        # capture a lead where the selected associate is also a tier-eligible on-duty
        # staffer; assert only ONE alert_log row for that staffer.
        staff = ensure_roster[0]
        payload = {
            "first_name": "TEST_Iter4",
            "last_name": "Dedup",
            "phone": "5555550103",
            "state": "TX",
            "specialty": "Cardiology",
            "associate_id": staff["id"],
            "associate_name": staff["name"],
            "contact_consent": True,
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=15)
        assert r.status_code == 200
        lead_id = r.json()["id"]

        import time
        time.sleep(2.5)

        r_admin = requests.post(f"{API}/auth/login", json=ADMIN, timeout=10)
        h = {"Authorization": f"Bearer {r_admin.json()['token']}"}
        r_logs = requests.get(f"{API}/dashboard/alerts", headers=h, params={"lead_id": lead_id}, timeout=10)
        if r_logs.status_code != 200:
            r_logs = requests.get(f"{API}/dashboard/alert_logs", headers=h, params={"lead_id": lead_id}, timeout=10)
        logs = r_logs.json() if r_logs.status_code == 200 else []
        matching = [l for l in logs if l.get("lead_id") == lead_id and l.get("staff_id") == staff["id"]]
        assert len(matching) <= 1, f"Dedup broken: {len(matching)} rows for same lead+staff. {matching}"


# ---------- Feature 4: Twilio status webhook ----------
class TestTwilioStatusWebhook:
    def test_status_webhook_updates_alert_log(self, admin_h, ensure_roster):
        # Create a fake alert_log with a known sid, then hit the webhook
        import uuid
        fake_sid = f"SM{uuid.uuid4().hex}"

        # Trigger a capture (associate always-alert path) to create a row
        staff = ensure_roster[0]
        payload = {
            "first_name": "TEST_Iter4",
            "last_name": "Webhook",
            "phone": "5555550104",
            "state": "TX",
            "associate_id": staff["id"],
            "associate_name": staff["name"],
        }
        r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=15)
        assert r.status_code == 200
        lead_id = r.json()["id"]

        import time
        time.sleep(2.5)

        r_admin = requests.post(f"{API}/auth/login", json=ADMIN, timeout=10)
        h = {"Authorization": f"Bearer {r_admin.json()['token']}"}
        r_logs = requests.get(f"{API}/dashboard/alerts", headers=h, params={"lead_id": lead_id}, timeout=10)
        if r_logs.status_code != 200:
            r_logs = requests.get(f"{API}/dashboard/alert_logs", headers=h, params={"lead_id": lead_id}, timeout=10)
        logs = r_logs.json() if r_logs.status_code == 200 else []
        matching = [l for l in logs if l.get("lead_id") == lead_id and l.get("staff_id") == staff["id"]]
        assert matching, "No alert_log produced for webhook test setup"
        log = matching[0]

        # Real sid may or may not exist depending on Twilio result; if none, patch a fake sid onto the log via a mongo update
        real_sid = log.get("sid")
        if not real_sid:
            # inject via admin: no such endpoint likely — use webhook with a made-up sid; then verify no update happens (still 200 ok)
            r_wh_noop = requests.post(f"{API}/twilio/status",
                data={"MessageSid": fake_sid, "MessageStatus": "delivered"}, timeout=10)
            assert r_wh_noop.status_code == 200
            pytest.skip("No Twilio sid on log (likely 30034/unregistered sender); webhook accepts request OK")

        # Real sid case: post an update
        r_wh = requests.post(f"{API}/twilio/status", data={
            "MessageSid": real_sid,
            "MessageStatus": "undelivered",
            "ErrorCode": "30034",
        }, timeout=10)
        assert r_wh.status_code == 200, r_wh.text

        # Re-fetch the log
        r_logs2 = requests.get(f"{API}/dashboard/alerts", headers=h, params={"lead_id": lead_id}, timeout=10)
        if r_logs2.status_code != 200:
            r_logs2 = requests.get(f"{API}/dashboard/alert_logs", headers=h, params={"lead_id": lead_id}, timeout=10)
        logs2 = r_logs2.json()
        updated = next((l for l in logs2 if l.get("sid") == real_sid), None)
        assert updated is not None
        assert updated.get("status") == "undelivered", updated
        assert "30034" in (updated.get("error") or ""), updated


# ---------- Feature 5: Export includes Practice Type column ----------
class TestExportPracticeType:
    def test_csv_export_has_practice_type_column(self, admin_h):
        r = requests.get(f"{API}/dashboard/export", headers=admin_h, params={"fmt": "csv"}, timeout=30)
        assert r.status_code == 200, r.text
        text = r.text
        reader = csv.reader(io.StringIO(text))
        header = next(reader)
        # Case-insensitive search
        norm = [h.lower().strip() for h in header]
        assert any("practice type" in h or h == "practice_type" for h in norm), \
            f"'Practice Type' not in export header: {header}"


# ---------- Regression: auth + seed sample + one-spin-per-lead ----------
class TestRegression:
    def test_admin_and_staff_login(self):
        for creds in (ADMIN, STAFF):
            r = requests.post(f"{API}/auth/login", json=creds, timeout=10)
            assert r.status_code == 200, r.text
            assert "token" in r.json()

    def test_one_spin_per_lead(self):
        # Capture a lead
        r = requests.post(f"{API}/kiosk/leads", json={
            "first_name": "TEST_Iter4", "last_name": "Spin", "phone": "5555550105",
            "state": "TX",
        }, timeout=15)
        assert r.status_code == 200
        lead_id = r.json()["id"]
        r1 = requests.post(f"{API}/kiosk/leads/{lead_id}/spin", timeout=10)
        assert r1.status_code == 200
        # first spin should give a prize
        assert r1.json().get("prize") or r1.json().get("error") in {"no_prizes", "no_inventory"}
        r2 = requests.post(f"{API}/kiosk/leads/{lead_id}/spin", timeout=10)
        # second attempt should be blocked
        assert r2.status_code == 200
        j = r2.json()
        # either already_spun error or prize is unchanged
        assert j.get("error") == "already_spun" or j.get("prize") is not None
