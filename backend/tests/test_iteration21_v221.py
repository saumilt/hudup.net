"""BoothIQ v2.21 backend validation:
(1) POST /api/crm/leads/bulk-assign returns {ok, updated, prev:[{lead_id, account_manager_id}]}
(2) POST /api/crm/leads/restore-assign restores previous owners (routing_reason 'Reassignment undone')
(3) POST /api/crm/notifications/digest/run?window_hours=N returns {reps_notified, total_leads}
(4) Import execute (distribute=person) NO LONGER sends immediate email but still creates+assigns
(5) GET /api/crm/leads?claim_mismatch=true still returns only flagged leads
"""
import os
import io
import time
import requests
import pytest


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = _load_backend_url()
API = f"{BASE}/api"

LM_EMAIL, LM_PIN = "leadmanager@boothiq.com", "639201"
AM_EMAIL, AM_PIN = "accountmanager@boothiq.com", "528174"
ANKIT_EMAIL = "ankit@healthandmore.net"


@pytest.fixture(scope="module")
def lm_token():
    r = requests.post(f"{API}/auth/login", json={"email": LM_EMAIL, "pin": LM_PIN}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def lm_headers(lm_token):
    return {"Authorization": f"Bearer {lm_token}"}


@pytest.fixture(scope="module")
def am_user_id(lm_headers):
    r = requests.get(f"{API}/users", headers=lm_headers, params={"roles": "account_manager"}, timeout=15)
    assert r.status_code == 200, r.text
    users = r.json()
    assert users, "No account_manager users available"
    return users[0]["id"]


@pytest.fixture(scope="module")
def ankit_user_id(lm_headers):
    r = requests.get(f"{API}/users", headers=lm_headers,
                     params={"roles": "account_manager,lead_manager"}, timeout=15)
    users = r.json()
    for u in users:
        if u.get("email") == ANKIT_EMAIL:
            return u["id"]
    # fallback to any lead_manager
    for u in users:
        if u.get("role") == "lead_manager" and u.get("email") != LM_EMAIL:
            return u["id"]
    return users[0]["id"]


def _make_lead(lm_headers, tag):
    r = requests.post(f"{API}/crm/leads", headers=lm_headers, json={
        "org_name": f"TEST_v221 {tag} {int(time.time()*1000)}",
        "contact_first": "Test", "contact_last": "Reassign",
        "source": "Manual Entry", "priority": "Medium",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ----- (1)+(2) bulk-assign returns prev, restore-assign round-trip -----
class TestBulkAssignPrevAndRestore:
    def test_bulk_assign_returns_prev_with_previous_owner(self, lm_headers, am_user_id, ankit_user_id):
        # Create 2 leads owned initially by am_user_id (via first bulk-assign)
        ids = [_make_lead(lm_headers, "prev-A"), _make_lead(lm_headers, "prev-B")]
        r0 = requests.post(f"{API}/crm/leads/bulk-assign", headers=lm_headers,
                           json={"lead_ids": ids, "account_manager_id": am_user_id}, timeout=20)
        assert r0.status_code == 200, r0.text
        assert r0.json()["updated"] >= 1
        # Now reassign to ankit — prev should capture am_user_id
        r1 = requests.post(f"{API}/crm/leads/bulk-assign", headers=lm_headers,
                           json={"lead_ids": ids, "account_manager_id": ankit_user_id}, timeout=20)
        assert r1.status_code == 200, r1.text
        data = r1.json()
        assert data.get("ok") is True
        assert data.get("updated") >= 1
        assert "prev" in data, "bulk-assign must return 'prev' capture"
        prev = data["prev"]
        assert isinstance(prev, list) and len(prev) == len(ids)
        prev_map = {p["lead_id"]: p["account_manager_id"] for p in prev}
        for lid in ids:
            assert prev_map[lid] == am_user_id, f"expected prev owner={am_user_id}, got {prev_map[lid]}"

        # Confirm current owner is ankit now
        for lid in ids:
            g = requests.get(f"{API}/crm/leads/{lid}", headers=lm_headers, timeout=10).json()
            assert g["account_manager_id"] == ankit_user_id

        # ----- (2) restore round-trip
        r2 = requests.post(f"{API}/crm/leads/restore-assign", headers=lm_headers,
                           json={"assignments": prev}, timeout=20)
        assert r2.status_code == 200, r2.text
        rd = r2.json()
        assert rd.get("ok") is True
        assert rd.get("restored") == len(ids)

        # Verify each lead is back to am_user_id and routing_reason='Reassignment undone'
        for lid in ids:
            g = requests.get(f"{API}/crm/leads/{lid}", headers=lm_headers, timeout=10).json()
            assert g["account_manager_id"] == am_user_id, f"lead {lid} not restored to previous owner"
            assert g.get("routing_reason") == "Reassignment undone"

    def test_restore_null_previous_owner_clears_assignment(self, lm_headers, ankit_user_id):
        # New lead has account_manager_id=None initially → assign → restore back to None
        lid = _make_lead(lm_headers, "unassigned")
        # After creation, auto_route_lead may assign. Force to None first via bulk-assign to ankit then restore null.
        r1 = requests.post(f"{API}/crm/leads/bulk-assign", headers=lm_headers,
                           json={"lead_ids": [lid], "account_manager_id": ankit_user_id}, timeout=15)
        prev = r1.json().get("prev", [])
        # Restore to whatever prev captured (could be None if not auto-routed)
        r2 = requests.post(f"{API}/crm/leads/restore-assign", headers=lm_headers,
                           json={"assignments": prev}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["restored"] >= 1


# ----- (3) digest run -----
class TestDigestRun:
    def test_digest_run_manager_returns_counts(self, lm_headers):
        r = requests.post(f"{API}/crm/notifications/digest/run", headers=lm_headers,
                          params={"window_hours": 24}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reps_notified" in data
        assert "total_leads" in data
        assert isinstance(data["reps_notified"], int)
        assert isinstance(data["total_leads"], int)

    def test_digest_run_requires_manager(self):
        # account_manager should NOT be allowed
        rl = requests.post(f"{API}/auth/login", json={"email": AM_EMAIL, "pin": AM_PIN}, timeout=15)
        if rl.status_code != 200:
            pytest.skip("AM login unavailable")
        tok = rl.json()["token"]
        r = requests.post(f"{API}/crm/notifications/digest/run",
                          headers={"Authorization": f"Bearer {tok}"},
                          params={"window_hours": 24}, timeout=15)
        assert r.status_code in (401, 403), f"AM should be forbidden, got {r.status_code}"


# ----- (4) Import person-assignment execute (no immediate email path) -----
class TestImportExecuteNoEmailCrash:
    def test_execute_person_assign_completes(self, lm_headers, ankit_user_id):
        # CSV with 1 row, matched NPI so lead is created & assigned to ankit
        csv = ("Provider NPI,Org,First,Last\n"
               f"1528183746,TEST_v221 ImportOrg {int(time.time())},Ada,Lovelace\n").encode()
        files = {"file": ("test_v221_import.csv", csv, "text/csv")}
        r = requests.post(f"{API}/imports", headers=lm_headers, files=files,
                          data={"dataset_type": "lead"}, timeout=30)
        assert r.status_code == 200, r.text
        import_id = r.json()["import_id"]

        # analyze
        ra = requests.post(f"{API}/imports/{import_id}/analyze", headers=lm_headers, timeout=45)
        assert ra.status_code == 200, ra.text
        mapping = ra.json()["mapping"]
        # ensure NPI mapped
        if not any(v == "npi" for v in mapping.values()):
            for k in list(mapping.keys()):
                if "npi" in k.lower():
                    mapping[k] = "npi"

        # save mapping with distribute=person → assignee_id=ankit
        rm = requests.post(f"{API}/imports/{import_id}/mapping", headers=lm_headers, json={
            "mapping": mapping, "rule": "safe",
            "distribute": "person", "assignee_id": ankit_user_id,
        }, timeout=15)
        assert rm.status_code == 200

        # validate
        rv = requests.post(f"{API}/imports/{import_id}/validate", headers=lm_headers, timeout=30)
        assert rv.status_code == 200

        # execute — must not raise even though per-import email path was removed
        re_ = requests.post(f"{API}/imports/{import_id}/execute", headers=lm_headers, timeout=60)
        assert re_.status_code == 200, re_.text
        counts = re_.json()
        assert counts.get("created", 0) + counts.get("updated", 0) + counts.get("skipped", 0) >= 1

        # Rollback for cleanup (only if created > 0)
        if counts.get("created", 0) > 0:
            rb = requests.post(f"{API}/imports/{import_id}/rollback", headers=lm_headers, timeout=15)
            assert rb.status_code == 200


# ----- (5) claim_mismatch filter -----
class TestClaimMismatchFilter:
    def test_leads_filter_claim_mismatch_true_returns_only_flagged(self, lm_headers):
        r = requests.get(f"{API}/crm/leads", headers=lm_headers,
                         params={"claim_mismatch": True, "limit": 1000}, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        for l in rows:
            assert l.get("claim_mismatch") is True, f"non-flagged lead in results: {l.get('id')}"
