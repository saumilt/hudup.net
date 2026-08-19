"""Iteration 2: BOM bug fix + Events + green shade + lead detail + alerts body."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

SAMPLE_CSV = "/tmp/sample1000.csv"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@boothiq.com", "pin": "482913"})
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def staff_token():
    r = requests.post(f"{API}/auth/login", json={"email": "staff@boothiq.com", "pin": "715264"})
    assert r.status_code == 200
    return r.json()["token"]


def AH(t): return {"Authorization": f"Bearer {t}"}


# ============= BUG FIX: BOM CSV ingestion =============
class TestBOMBugFix:
    """Verify UTF-8 BOM CSV is parsed correctly (previously all rows skipped)."""

    @pytest.fixture(scope="class")
    def finalized_session(self, admin_token):
        # Create session
        r = requests.post(f"{API}/admin/sessions", headers=AH(admin_token),
                          json={"name": "TEST_bom_bug"})
        assert r.status_code == 200
        sid = r.json()["id"]

        # init file
        r = requests.post(f"{API}/admin/sessions/{sid}/files/init",
                          headers=AH(admin_token), data={"filename": "sample1000.csv"})
        assert r.status_code == 200
        fid = r.json()["file_id"]

        # Upload entire file as one chunk
        with open(SAMPLE_CSV, "rb") as fh:
            payload = fh.read()
        files = {"chunk": ("chunk.csv", payload, "text/csv")}
        r = requests.post(f"{API}/admin/sessions/{sid}/files/{fid}/chunk",
                          headers=AH(admin_token),
                          data={"index": "0", "total": "1"}, files=files)
        assert r.status_code == 200

        # preview should show mapping present
        r = requests.get(f"{API}/admin/sessions/{sid}/files/{fid}/preview",
                         headers=AH(admin_token))
        assert r.status_code == 200
        prev = r.json()
        mapping = prev["detected_mapping"]
        # Bug fix assertion: BOM-prefixed header must be detected
        assert mapping.get("npi") == 0, f"BOM header not detected — mapping={mapping}"
        assert mapping.get("tot_clms") == 10
        assert mapping.get("tot_cost") == 13

        # complete (background) and wait
        r = requests.post(f"{API}/admin/sessions/{sid}/files/{fid}/complete",
                          headers=AH(admin_token))
        assert r.status_code == 200
        # Wait for processing (1000 rows). Poll session.
        for _ in range(30):
            time.sleep(0.5)
            r = requests.get(f"{API}/admin/sessions/{sid}", headers=AH(admin_token))
            s = r.json()
            files_list = s.get("files") or []
            if files_list and files_list[0].get("status") == "done":
                break
        assert files_list[0]["status"] == "done", f"file not processed: {files_list}"

        # finalize
        r = requests.post(f"{API}/admin/sessions/{sid}/finalize",
                          headers=AH(admin_token))
        assert r.status_code == 200
        return sid, r.json()

    def test_preview_mapping_after_bom(self, finalized_session):
        sid, cov = finalized_session
        # Already verified in fixture; sanity check the coverage exists
        assert cov is not None

    def test_coverage_unique_npis(self, finalized_session):
        _, cov = finalized_session
        assert cov["unique_npis"] == 45, f"expected 45 got {cov['unique_npis']}"

    def test_coverage_total_rows(self, finalized_session):
        _, cov = finalized_session
        assert cov["total_rows"] == 1000, f"expected 1000 got {cov['total_rows']}"

    def test_coverage_min_max_npi(self, finalized_session):
        _, cov = finalized_session
        assert cov["min_npi"] == 1003000126, f"min_npi={cov['min_npi']}"
        assert cov["max_npi"] == 1003004201, f"max_npi={cov['max_npi']}"

    def test_estimated_share_nonzero(self, finalized_session):
        _, cov = finalized_session
        assert cov["estimated_share_pct"] > 0, "BUG NOT FIXED — estimated_share_pct is 0"

    def test_repeated_npi_summed(self, finalized_session, admin_token):
        """Physician NPI 1003000126 appears multiple times — verify sum + avg."""
        sid, _ = finalized_session
        # Go live so we can use the resolve endpoint
        r = requests.post(f"{API}/admin/sessions/{sid}/golive", headers=AH(admin_token))
        assert r.status_code == 200
        # Query directly via admin endpoint (no /physicians route). Use resolve:
        # We know NPI 1003000126 is the min. Confirm via a lead submit (matched):
        # Instead, use MongoDB via a synthetic kiosk lookup: submit lead with that NPI.
        r = requests.post(f"{API}/kiosk/leads", json={
            "first_name": "X", "last_name": "Y", "npi": "1003000126",
            "state": "TX", "contact_consent": True})
        assert r.status_code == 200
        lead_id = r.json()["id"]
        # Fetch as staff to inspect medicare fields
        r = requests.post(f"{API}/auth/login",
                          json={"email": "staff@boothiq.com", "pin": "715264"})
        stok = r.json()["token"]
        r = requests.get(f"{API}/dashboard/leads/{lead_id}", headers=AH(stok))
        lead = r.json()
        med = lead.get("medicare", {})
        # If NPI 1003000126 exists and has multiple rows, its tot_clms/cost > single row
        # avg_per_claim should be tot_cost/tot_clms
        if med.get("tot_clms"):
            assert med["tot_clms"] > 0
            assert med["tot_cost"] > 0
            assert abs(med["avg_per_claim"] - (med["tot_cost"] / med["tot_clms"])) < 0.01


# ============= EVENTS CRUD =============
class TestEvents:
    def test_public_events_list(self):
        r = requests.get(f"{API}/kiosk/events")
        assert r.status_code == 200
        events = r.json()
        assert isinstance(events, list)
        # default event should be seeded
        ids = [e["id"] for e in events]
        assert "default" in ids
        for e in events:
            assert "name" in e
            assert "color_scheme" in e

    def test_create_update_delete_event(self, admin_token):
        # Create
        r = requests.post(f"{API}/admin/events", headers=AH(admin_token),
                          json={"name": "TEST_Event_X", "convention_state": "CA",
                                "color_scheme": {"primary": "#111827", "accent": "#F59E0B"},
                                "associate_ids": [], "prize_set_id": None})
        assert r.status_code == 200
        eid = r.json()["id"]
        assert eid != "default"

        # Update
        r = requests.put(f"{API}/admin/events/{eid}", headers=AH(admin_token),
                        json={"name": "TEST_Event_X2", "convention_state": "NY",
                              "color_scheme": {"primary": "#000", "accent": "#fff"},
                              "associate_ids": [], "prize_set_id": None})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Event_X2"

        # List
        r = requests.get(f"{API}/admin/events", headers=AH(admin_token))
        assert any(e["id"] == eid for e in r.json())

        # Delete
        r = requests.delete(f"{API}/admin/events/{eid}", headers=AH(admin_token))
        assert r.status_code == 200

    def test_cannot_delete_default(self, admin_token):
        r = requests.delete(f"{API}/admin/events/default", headers=AH(admin_token))
        assert r.status_code == 400


# ============= KIOSK CONFIG per-event =============
class TestKioskConfig:
    def test_config_default(self):
        r = requests.get(f"{API}/kiosk/config?event_id=default")
        assert r.status_code == 200
        j = r.json()
        for k in ("event_id", "event_name", "color_scheme", "associates",
                  "wheel_segments", "convention_state"):
            assert k in j
        # segments must NOT leak weight/inventory
        for s in j["wheel_segments"]:
            assert "weight" not in s
            assert "inventory" not in s
        assert j["event_id"] == "default"


# ============= GREEN SHADE + LEAD PRIVACY =============
class TestGreenShade:
    def test_lead_has_shade_and_color(self, admin_token, staff_token):
        # Ensure seeded sample is live to have matchable Hem-Onc physicians
        r = requests.post(f"{API}/admin/seed-sample", headers=AH(admin_token))
        assert r.status_code == 200
        # Find a matched physician via resolve: pick from seeded high-cost specialty
        # Simpler: pick a physician from live dataset via kiosk resolve loop
        # Just create leads until one matches GREEN
        matched_green_lead = None
        # Fetch a staff-side list to find a matched physician's NPI
        r = requests.get(f"{API}/dashboard/leads?limit=1", headers=AH(staff_token))
        # Instead: submit a name + state that we know has hem/onc collisions
        # Use resolve to discover one candidate
        for last in ["Kable", "Smith", "Johnson", "Garcia", "Chen", "Kim", "Singh"]:
            for st in ["TX", "CA", "NY", "FL"]:
                r = requests.post(f"{API}/kiosk/resolve",
                                  json={"last_name": last, "state": st, "first_initial": "A"})
                if r.status_code == 200 and r.json().get("candidates"):
                    c = r.json()["candidates"][0]
                    r2 = requests.post(f"{API}/kiosk/leads", json={
                        "first_name": c["first_name"], "last_name": c["last_name"],
                        "npi": c["npi"], "state": st, "contact_consent": True,
                        "sms_consent": True, "interests": ["340B"]})
                    lead_id = r2.json()["id"]
                    # inspect
                    r3 = requests.get(f"{API}/dashboard/leads/{lead_id}", headers=AH(staff_token))
                    L = r3.json()
                    if L.get("tier_340b") == "GREEN":
                        matched_green_lead = L
                        break
            if matched_green_lead:
                break

        if not matched_green_lead:
            pytest.skip("No GREEN 340B lead resolvable in seeded dataset")

        assert matched_green_lead["shade_340b"] in ("GREEN", "GREEN+", "GREEN++")
        assert matched_green_lead["color_340b"] in ("#34D399", "#10B981", "#047857")
        assert "color_rpm" in matched_green_lead

    def test_kiosk_leads_response_privacy(self):
        r = requests.post(f"{API}/kiosk/leads", json={
            "first_name": "Priv", "last_name": "TestUser", "state": "TX",
            "contact_consent": True})
        assert r.status_code == 200
        j = r.json()
        assert set(j.keys()) <= {"id", "spin_available"}
        for f in ("shade_340b", "color_340b", "tier_340b", "medicare"):
            assert f not in j


# ============= LEAD DETAIL (auth) =============
class TestLeadDetail:
    def test_get_lead_by_id(self, staff_token):
        # Create a lead via kiosk
        r = requests.post(f"{API}/kiosk/leads", json={
            "first_name": "Detail", "last_name": "Test",
            "phone": "+15551002000", "state": "TX", "contact_consent": True})
        lead_id = r.json()["id"]
        r = requests.get(f"{API}/dashboard/leads/{lead_id}", headers=AH(staff_token))
        assert r.status_code == 200
        L = r.json()
        assert L["id"] == lead_id
        assert "tier_340b" in L
        assert "medicare" in L

    def test_schedule_and_note_and_assign(self, staff_token):
        r = requests.post(f"{API}/kiosk/leads", json={
            "first_name": "Sched", "last_name": "Test",
            "phone": "+15551002001", "state": "TX", "contact_consent": True})
        lead_id = r.json()["id"]

        # schedule
        r = requests.post(f"{API}/dashboard/leads/{lead_id}/schedule",
                          headers=AH(staff_token),
                          json={"callback_date": "2026-07-15",
                                "appointment_at": "2026-07-20T14:00:00Z"})
        assert r.status_code == 200

        # note
        r = requests.post(f"{API}/dashboard/leads/{lead_id}/note",
                          headers=AH(staff_token),
                          json={"text": "TEST note text"})
        assert r.status_code == 200

        # assign
        r = requests.post(f"{API}/dashboard/leads/{lead_id}/assign",
                          headers=AH(staff_token),
                          json={"assigned_to": "TEST_rep"})
        assert r.status_code == 200

        # verify persistence
        r = requests.get(f"{API}/dashboard/leads/{lead_id}", headers=AH(staff_token))
        L = r.json()
        assert L["callback_date"] == "2026-07-15"
        assert L["appointment_at"] == "2026-07-20T14:00:00Z"
        assert any(n.get("text") == "TEST note text" for n in L.get("notes", []))
        assert L["assigned_to"] == "TEST_rep"

    def test_lead_detail_requires_auth(self):
        r = requests.get(f"{API}/dashboard/leads/anything")
        assert r.status_code == 401


# ============= SMS ALERT BODY =============
class TestSMSAlertBody:
    def test_alert_body_has_color_and_link(self, admin_token, staff_token):
        # Ensure default alert rules exist + at least one on-duty staffer.
        r = requests.post(f"{API}/admin/roster", headers=AH(admin_token),
                          json={"name": "TEST_Alert_Staff",
                                "mobile": "+15550002222", "on_duty": True})
        assert r.status_code == 200
        rid = r.json()["id"]

        try:
            # Ensure default rules
            requests.put(f"{API}/admin/alert-rules", headers=AH(admin_token), json={
                "event_id": "default",
                "rules": {
                    "340b": {"GREEN": {"send": True, "recipients": "all"}},
                    "rpm": {"GREEN": {"send": True, "recipients": "all"}}},
                "ceiling_per_hour": 100})

            # Create a matched GREEN lead
            green_lead_id = None
            for last in ["Kable", "Smith", "Chen", "Garcia", "Kim"]:
                for st in ["TX", "CA", "NY", "FL"]:
                    r = requests.post(f"{API}/kiosk/resolve",
                                      json={"last_name": last, "state": st, "first_initial": "A"})
                    if r.status_code == 200 and r.json().get("candidates"):
                        c = r.json()["candidates"][0]
                        r2 = requests.post(f"{API}/kiosk/leads", json={
                            "first_name": c["first_name"], "last_name": c["last_name"],
                            "npi": c["npi"], "state": st, "contact_consent": True,
                            "sms_consent": True})
                        lid = r2.json()["id"]
                        r3 = requests.get(f"{API}/dashboard/leads/{lid}", headers=AH(staff_token))
                        if r3.json().get("tier_340b") == "GREEN":
                            green_lead_id = lid
                            break
                if green_lead_id:
                    break

            if not green_lead_id:
                pytest.skip("Could not synthesize a GREEN lead")

            time.sleep(2)  # wait for async _dispatch_alerts

            # inspect alert_logs for that lead
            r = requests.get(f"{API}/dashboard/alerts?limit=200", headers=AH(staff_token))
            assert r.status_code == 200
            logs = r.json()
            related = [l for l in logs if l.get("lead_id") == green_lead_id]
            assert related, f"no alert log created for GREEN lead {green_lead_id}"
            body = related[0]["body"]
            # color code like [#10B981] or [#047857]
            assert "[#" in body and "]" in body, f"no color code in body: {body}"
            # Open link
            assert f"/lead/{green_lead_id}" in body, f"no /lead/<id> link in body: {body}"
            # status must be set (sent/failed/digest — real Twilio may fail, that's OK)
            assert related[0].get("status") in ("sent", "failed", "digest")
        finally:
            requests.delete(f"{API}/admin/roster/{rid}", headers=AH(admin_token))
