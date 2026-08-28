"""Iteration 9: BoothIQ v1.6 CRM layer — auth/RBAC, users, Medicare Search,
leads lifecycle, opportunities, tasks, meetings, accounts/physicians, reports."""
import os
import uuid
import datetime as dt
import pytest
import requests
from pathlib import Path

def _load_env():
    env_path = Path("/app/frontend/.env")
    for line in env_path.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("REACT_APP_BACKEND_URL not found in frontend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or _load_env()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("admin@boothiq.com", "482913"),
    "lead_manager": ("leadmanager@boothiq.com", "639201"),
    "account_manager": ("accountmanager@boothiq.com", "528174"),
    "staff": ("staff@boothiq.com", "715264"),
}


def _login(role):
    email, pin = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"login {role} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def tokens():
    return {role: _login(role) for role in CREDS}


def _h(tokens, role):
    return {"Authorization": f"Bearer {tokens[role]['token']}"}


# ==================== 1. AUTH + RBAC ====================
class TestAuthRBAC:
    def test_login_each_role_returns_token_and_user_role(self, tokens):
        for role, blob in tokens.items():
            assert blob.get("token")
            assert blob["user"]["role"] == role

    def test_auth_me(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=_h(tokens, "admin"), timeout=10)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_non_admin_cannot_create_user(self, tokens):
        payload = {"email": f"TEST_reject_{uuid.uuid4().hex[:6]}@x.com",
                   "pin": "111222", "name": "X", "role": "staff"}
        for role in ("lead_manager", "account_manager", "staff"):
            r = requests.post(f"{API}/users", json=payload, headers=_h(tokens, role), timeout=10)
            assert r.status_code == 403, f"{role} should not create user, got {r.status_code}"

    def test_account_manager_cannot_assign_lead(self, tokens):
        # Assign requires MANAGER (lead_manager). AM must get 403 whether or not the lead exists.
        r = requests.post(f"{API}/crm/leads/nonexistent/assign",
                          json={"account_manager_id": "x"},
                          headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 403

    def test_account_manager_cannot_bulk_assign(self, tokens):
        r = requests.post(f"{API}/crm/leads/bulk-assign",
                          json={"lead_ids": ["x"], "account_manager_id": "y"},
                          headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 403


# ==================== 2. ADMIN USER MANAGEMENT ====================
class TestUserMgmt:
    @pytest.fixture(scope="class")
    def created_user(self, tokens):
        email = f"test_newuser_{uuid.uuid4().hex[:8]}@boothiq.com"
        r = requests.post(f"{API}/users",
                          json={"email": email, "pin": "334455", "name": "TEST NewUser",
                                "role": "account_manager", "title": "AM"},
                          headers=_h(tokens, "admin"), timeout=10)
        assert r.status_code == 200, r.text
        user = r.json()
        assert user["email"] == email
        assert user["role"] == "account_manager"
        assert "pin_hash" not in user
        return {"email": email, "pin": "334455", "id": user["id"]}

    def test_list_users(self, tokens):
        r = requests.get(f"{API}/users", headers=_h(tokens, "admin"), timeout=10)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert "admin@boothiq.com" in emails

    def test_created_user_can_login(self, created_user):
        r = requests.post(f"{API}/auth/login",
                          json={"email": created_user["email"], "pin": created_user["pin"]}, timeout=10)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "account_manager"

    def test_patch_role_and_active(self, tokens, created_user):
        r = requests.patch(f"{API}/users/{created_user['id']}",
                           json={"role": "lead_manager", "active": False},
                           headers=_h(tokens, "admin"), timeout=10)
        assert r.status_code == 200
        assert r.json()["role"] == "lead_manager"
        assert r.json()["active"] is False

    def test_reset_pin_then_login_with_new_pin(self, tokens, created_user):
        new_pin = "998877"
        r = requests.post(f"{API}/users/{created_user['id']}/reset-pin",
                          json={"pin": new_pin}, headers=_h(tokens, "admin"), timeout=10)
        assert r.status_code == 200
        r = requests.post(f"{API}/auth/login",
                          json={"email": created_user["email"], "pin": new_pin}, timeout=10)
        assert r.status_code == 200


# ==================== 3. MEDICARE SEARCH ====================
class TestMedicare:
    def test_years(self, tokens):
        r = requests.get(f"{API}/medicare/years", headers=_h(tokens, "lead_manager"), timeout=15)
        assert r.status_code == 200
        assert 2024 in r.json()["years"]

    def test_filter_schema(self, tokens):
        r = requests.get(f"{API}/medicare/filter-schema", headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        fields = {f["field"] for f in r.json()["fields"]}
        assert {"specialty", "state", "tier_340b", "tier_rpm"} <= fields

    def test_simple_search_with_tier(self, tokens):
        r = requests.post(f"{API}/medicare/search",
                          json={"dataset_year": 2024, "tier_340b": "GREEN", "page_size": 5},
                          headers=_h(tokens, "lead_manager"), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "total" in body and "results" in body
        # Store one NPI for later tests
        if body["results"]:
            row = body["results"][0]
            assert row["tier_340b"] == "GREEN"
            assert "npi" in row
            pytest.first_green_npi = row["npi"]

    def test_advanced_search_and(self, tokens):
        r = requests.post(f"{API}/medicare/advanced-search",
                          json={"dataset_year": 2024, "connector": "AND", "page_size": 3,
                                "conditions": [{"field": "tier_340b", "op": "eq", "value": "GREEN"},
                                               {"field": "tot_cost", "op": "gte", "value": 1000}]},
                          headers=_h(tokens, "lead_manager"), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json()["results"], list)

    def test_advanced_search_or(self, tokens):
        r = requests.post(f"{API}/medicare/advanced-search",
                          json={"dataset_year": 2024, "connector": "OR", "page_size": 3,
                                "conditions": [{"field": "tier_340b", "op": "eq", "value": "GREEN"},
                                               {"field": "tier_rpm", "op": "eq", "value": "GREEN"}]},
                          headers=_h(tokens, "lead_manager"), timeout=30)
        assert r.status_code == 200

    def test_physician_detail(self, tokens):
        npi = getattr(pytest, "first_green_npi", None)
        if not npi:
            pytest.skip("no seed NPI")
        r = requests.get(f"{API}/medicare/physicians/{npi}?dataset_year=2024",
                         headers=_h(tokens, "lead_manager"), timeout=15)
        assert r.status_code == 200
        assert r.json()["npi"] == npi

    def test_year_comparison(self, tokens):
        npi = getattr(pytest, "first_green_npi", None)
        if not npi:
            pytest.skip("no seed NPI")
        r = requests.get(f"{API}/medicare/physicians/{npi}/year-comparison",
                         headers=_h(tokens, "lead_manager"), timeout=15)
        assert r.status_code == 200
        assert r.json()["npi"] == npi


# ==================== 4. CRM LEADS ====================
class TestCrmLeads:
    @pytest.fixture(scope="class")
    def manual_lead(self, tokens):
        r = requests.post(f"{API}/crm/leads",
                          json={"org_name": "TEST_Org_Manual", "contact_first": "Jane",
                                "contact_last": f"TEST_{uuid.uuid4().hex[:6]}",
                                "email": "jane@test.com", "phone": "5551234",
                                "source": "Manual Entry", "priority": "High"},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead["status"] == "New"
        assert lead["lead_number"].startswith("L-")
        assert lead["medicare_match_status"] == "unmatched"
        assert len(lead["status_history"]) == 1
        return lead

    @pytest.fixture(scope="class")
    def medicare_lead(self, tokens):
        # Use a real matched NPI from live dataset
        s = requests.post(f"{API}/medicare/search",
                          json={"dataset_year": 2024, "tier_340b": "GREEN", "page_size": 1},
                          headers=_h(tokens, "lead_manager"), timeout=30)
        results = s.json()["results"]
        if not results:
            pytest.skip("no medicare seed")
        npi = results[0]["npi"]
        r = requests.post(f"{API}/crm/leads",
                          json={"org_name": "TEST_FromMedicare",
                                "contact_first": results[0]["first_name"],
                                "contact_last": results[0]["last_name"],
                                "source": "Medicare Search",
                                "matched_npi": npi, "dataset_year": 2024},
                          headers=_h(tokens, "lead_manager"), timeout=15)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead["medicare_match_status"] == "matched"
        assert lead["matched_npi"] == npi
        assert lead["medicare_snapshot"] is not None
        assert lead["medicare_snapshot"]["tier_340b"] == "GREEN"
        return lead

    def test_get_lead(self, tokens, manual_lead):
        r = requests.get(f"{API}/crm/leads/{manual_lead['id']}",
                         headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == manual_lead["id"]

    def test_list_with_filters_and_q(self, tokens, manual_lead):
        r = requests.get(f"{API}/crm/leads?q=TEST_",
                         headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert any(l["id"] == manual_lead["id"] for l in r.json())

    def test_am_scoping_returns_only_assigned(self, tokens):
        r = requests.get(f"{API}/crm/leads",
                         headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        am_id = tokens["account_manager"]["user"]["id"]
        for l in r.json():
            assert l.get("account_manager_id") == am_id or l.get("created_by") == am_id

    def test_patch_lead(self, tokens, manual_lead):
        r = requests.patch(f"{API}/crm/leads/{manual_lead['id']}",
                           json={"priority": "Low", "phone": "5559999"},
                           headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["priority"] == "Low"
        assert r.json()["phone"] == "5559999"

    def test_status_change_adds_history(self, tokens, manual_lead):
        r = requests.post(f"{API}/crm/leads/{manual_lead['id']}/status",
                          json={"status": "Qualified", "reason": "test"},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        g = requests.get(f"{API}/crm/leads/{manual_lead['id']}",
                         headers=_h(tokens, "lead_manager"), timeout=10)
        lead = g.json()
        assert lead["status"] == "Qualified"
        assert len(lead["status_history"]) >= 2

    def test_invalid_status_rejected(self, tokens, manual_lead):
        r = requests.post(f"{API}/crm/leads/{manual_lead['id']}/status",
                          json={"status": "NotARealStatus"},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 400

    def test_match_medicare_on_manual_lead(self, tokens, manual_lead):
        s = requests.post(f"{API}/medicare/search",
                          json={"dataset_year": 2024, "page_size": 1},
                          headers=_h(tokens, "lead_manager"), timeout=15)
        results = s.json()["results"]
        if not results:
            pytest.skip("no medicare")
        npi = results[0]["npi"]
        r = requests.post(f"{API}/crm/leads/{manual_lead['id']}/match-medicare",
                          json={"matched_npi": npi, "dataset_year": 2024},
                          headers=_h(tokens, "lead_manager"), timeout=15)
        assert r.status_code == 200
        assert r.json()["snapshot"]["npi"] == npi

    def test_assign_by_manager(self, tokens, manual_lead):
        am_id = tokens["account_manager"]["user"]["id"]
        r = requests.post(f"{API}/crm/leads/{manual_lead['id']}/assign",
                          json={"account_manager_id": am_id},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200

    def test_bulk_assign_by_manager(self, tokens, medicare_lead):
        am_id = tokens["account_manager"]["user"]["id"]
        r = requests.post(f"{API}/crm/leads/bulk-assign",
                          json={"lead_ids": [medicare_lead["id"]], "account_manager_id": am_id},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["updated"] >= 1

    def test_convert_to_opportunity(self, tokens, medicare_lead):
        r = requests.post(f"{API}/crm/leads/{medicare_lead['id']}/convert",
                          json={"name": "TEST_Opp", "value": 5000, "stage": "Discovery"},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        opp = r.json()
        assert opp["stage"] == "Discovery"
        assert opp["opp_number"].startswith("O-")
        pytest.test_opp_id = opp["id"]

    def test_add_note(self, tokens, manual_lead):
        r = requests.post(f"{API}/crm/leads/{manual_lead['id']}/notes",
                          json={"text": "TEST note", "visibility": "team"},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["text"] == "TEST note"


# ==================== 5. OPPORTUNITIES ====================
class TestOpportunities:
    def test_list_opps(self, tokens):
        r = requests.get(f"{API}/crm/opportunities",
                         headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_stage_change_creates_history_and_won(self, tokens):
        opp_id = getattr(pytest, "test_opp_id", None)
        if not opp_id:
            pytest.skip("no opp")
        r = requests.patch(f"{API}/crm/opportunities/{opp_id}",
                           json={"stage": "Closed Won"},
                           headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        opp = r.json()
        assert opp["stage"] == "Closed Won"
        assert opp["status"] == "won"
        assert len(opp["stage_history"]) >= 2


# ==================== 6. TASKS ====================
class TestTasks:
    @pytest.fixture(scope="class")
    def a_task(self, tokens):
        # overdue task
        past = (dt.datetime.utcnow() - dt.timedelta(days=1)).isoformat() + "Z"
        r = requests.post(f"{API}/crm/tasks",
                          json={"title": "TEST_task_overdue", "due_at": past,
                                "priority": "High"},
                          headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        return r.json()

    def test_scope_my(self, tokens, a_task):
        r = requests.get(f"{API}/crm/tasks?scope=my",
                         headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        assert any(t["id"] == a_task["id"] for t in r.json())

    def test_scope_overdue(self, tokens, a_task):
        r = requests.get(f"{API}/crm/tasks?scope=overdue",
                         headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        assert any(t["id"] == a_task["id"] for t in r.json())

    def test_scope_upcoming(self, tokens):
        future = (dt.datetime.utcnow() + dt.timedelta(days=2)).isoformat() + "Z"
        c = requests.post(f"{API}/crm/tasks",
                         json={"title": "TEST_task_upcoming", "due_at": future},
                         headers=_h(tokens, "account_manager"), timeout=10)
        assert c.status_code == 200
        r = requests.get(f"{API}/crm/tasks?scope=upcoming",
                         headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        assert any(t["id"] == c.json()["id"] for t in r.json())

    def test_complete_task(self, tokens, a_task):
        r = requests.patch(f"{API}/crm/tasks/{a_task['id']}",
                           json={"status": "Completed", "completion_notes": "done"},
                           headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "Completed"


# ==================== 7. MEETINGS ====================
class TestMeetings:
    @pytest.fixture(scope="class")
    def a_meeting(self, tokens):
        start = (dt.datetime.utcnow() + dt.timedelta(days=1)).isoformat() + "Z"
        end = (dt.datetime.utcnow() + dt.timedelta(days=1, hours=1)).isoformat() + "Z"
        r = requests.post(f"{API}/crm/meetings",
                          json={"title": "TEST_meeting", "start_at": start, "end_at": end,
                                "type": "Video Call",
                                "external_attendee": {"name": "Ext", "email": "e@x.com",
                                                       "mobile": "+15555550100"}},
                          headers=_h(tokens, "account_manager"), timeout=15)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["meeting_number"].startswith("M-")
        assert "notifications" in m
        notif = m["notifications"]
        assert isinstance(notif, list)
        by_channel = {n["channel"]: n["status"] for n in notif}
        # Email + gcal must be not_configured per spec
        assert by_channel.get("email") == "not_configured"
        assert by_channel.get("google_calendar") == "not_configured"
        # sms should be present (queued or error is acceptable — twilio account)
        assert "sms" in by_channel
        return m

    def test_reschedule(self, tokens, a_meeting):
        new_start = (dt.datetime.utcnow() + dt.timedelta(days=3)).isoformat() + "Z"
        r = requests.post(f"{API}/crm/meetings/{a_meeting['id']}/reschedule",
                          json={"start_at": new_start},
                          headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200

    def test_ics_download(self, tokens, a_meeting):
        r = requests.get(f"{API}/crm/meetings/{a_meeting['id']}/ics",
                         headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        assert "text/calendar" in r.headers.get("content-type", "")
        assert b"BEGIN:VCALENDAR" in r.content

    def test_complete_creates_task(self, tokens, a_meeting):
        due = (dt.datetime.utcnow() + dt.timedelta(days=5)).isoformat() + "Z"
        r = requests.post(f"{API}/crm/meetings/{a_meeting['id']}/complete",
                          json={"outcome": "positive", "next_step_title": "Follow up",
                                "next_step_due_at": due},
                          headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["next_step_task_id"]

    def test_cancel_meeting(self, tokens):
        start = (dt.datetime.utcnow() + dt.timedelta(days=2)).isoformat() + "Z"
        c = requests.post(f"{API}/crm/meetings",
                         json={"title": "TEST_cancel_me", "start_at": start, "type": "Video Call"},
                         headers=_h(tokens, "account_manager"), timeout=10)
        mid = c.json()["id"]
        r = requests.post(f"{API}/crm/meetings/{mid}/cancel", headers=_h(tokens, "account_manager"), timeout=10)
        assert r.status_code == 200


# ==================== 8. ACCOUNTS + CONTACTS ====================
class TestAccountsContacts:
    def test_create_and_list_account(self, tokens):
        r = requests.post(f"{API}/crm/accounts",
                          json={"name": f"TEST_Acct_{uuid.uuid4().hex[:6]}",
                                "type": "Hospital", "state": "tx"},
                          headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert r.json()["state"] == "TX"
        r = requests.get(f"{API}/crm/accounts", headers=_h(tokens, "lead_manager"), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_physician_duplicate_detection(self, tokens):
        payload = {"first_name": "TESTFirst", "last_name": f"TESTLast_{uuid.uuid4().hex[:6]}",
                   "state": "TX", "npi": f"999{uuid.uuid4().hex[:7]}"}
        r1 = requests.post(f"{API}/crm/physicians", json=payload,
                           headers=_h(tokens, "lead_manager"), timeout=10)
        assert r1.status_code == 200
        assert r1.json()["duplicate"] is False
        r2 = requests.post(f"{API}/crm/physicians", json=payload,
                           headers=_h(tokens, "lead_manager"), timeout=10)
        assert r2.status_code == 200
        assert r2.json()["duplicate"] is True


# ==================== 9. REPORTS ====================
class TestReports:
    def test_lead_manager_report(self, tokens):
        r = requests.get(f"{API}/crm/reports?type=lead_manager",
                         headers=_h(tokens, "lead_manager"), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "total_leads" in body
        assert "by_status" in body
        assert "conversion_rate" in body

    def test_account_manager_report(self, tokens):
        r = requests.get(f"{API}/crm/reports?type=account_manager",
                         headers=_h(tokens, "account_manager"), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "my_leads" in body
        assert "pipeline_value_by_stage" in body


# ==================== 10. KIOSK PRIVACY REGRESSION ====================
class TestKioskPrivacyRegression:
    def test_kiosk_lead_response_no_scores(self):
        r = requests.post(f"{API}/kiosk/leads",
                          json={"first_name": "TEST", "last_name": f"KioskPriv_{uuid.uuid4().hex[:6]}",
                                "state": "TX", "phone": "5551112222"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Kiosk MUST only expose id + spin_available (never tier/score/medicare)
        for forbidden in ("tier_340b", "tier_rpm", "medicare_snapshot", "matched_npi",
                          "shade_340b", "score", "avg_per_claim"):
            assert forbidden not in body, f"kiosk leaked {forbidden}: {body}"
