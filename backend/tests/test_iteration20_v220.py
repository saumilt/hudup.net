"""Iteration 20 — BoothIQ v2.20 backend tests.
Covers: (1) bulk-assign to lead_manager sets name/reason + activity;
        (2) PATCH lead logs 'updated' activity with meta.changes = from→to;
        (3) Import claim mismatch flag + list filter;
        (4) Import person-assignment triggers notify (non-blocking)."""
import os
import io
import uuid
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert v, "REACT_APP_BACKEND_URL not found"
    return v.rstrip("/")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"


# ---------- helpers ----------
def _login(email, pin):
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"login {email} → {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def lm_token():
    return _login("leadmanager@boothiq.com", "639201")


@pytest.fixture(scope="module")
def lm_headers(lm_token):
    return {"Authorization": f"Bearer {lm_token}"}


@pytest.fixture(scope="module")
def ankit_id(lm_headers):
    r = requests.get(f"{API}/users", headers=lm_headers,
                     params={"roles": "account_manager,lead_manager,admin,super_admin"}, timeout=15)
    assert r.status_code == 200, r.text
    ank = None
    for u in r.json():
        if (u.get("email") or "").lower() == "ankit@healthandmore.net":
            ank = u
            break
    if not ank:
        # fallback to any lead_manager with 'ankit' in name/email
        for u in r.json():
            if u.get("role") == "lead_manager" and "ankit" in (u.get("name") or u.get("email") or "").lower():
                ank = u
                break
    assert ank, "Ankit user not found"
    return ank["id"]


def _create_lead(headers, org):
    r = requests.post(f"{API}/crm/leads", headers=headers, json={"org_name": org, "source": "Manual Entry"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- Test 1: bulk-assign to lead_manager (Ankit) ----------
class TestBulkAssign:
    def test_bulk_assign_to_lead_manager_sets_name_and_reason(self, lm_headers, ankit_id):
        ids = [_create_lead(lm_headers, f"TEST_v220 Bulk {uuid.uuid4().hex[:6]}") for _ in range(2)]
        r = requests.post(f"{API}/crm/leads/bulk-assign", headers=lm_headers,
                          json={"lead_ids": ids, "account_manager_id": ankit_id}, timeout=20)
        # Endpoint MUST return {ok:true, updated:N} even if push errors out in preview.
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("updated") == len(ids)

        # Verify each lead was updated with name + routing_reason + activity.
        for lid in ids:
            g = requests.get(f"{API}/crm/leads/{lid}", headers=lm_headers, timeout=15)
            assert g.status_code == 200
            L = g.json()
            assert L.get("account_manager_id") == ankit_id, f"account_manager_id mismatch for {lid}"
            assert L.get("account_manager_name"), "account_manager_name not set by bulk-assign"
            reason = L.get("routing_reason") or ""
            assert reason.startswith("Reassigned to ") and " by " in reason, f"routing_reason not set correctly: {reason}"
            acts = L.get("activity") or []
            assigned = [a for a in acts if a.get("kind") == "assigned" or a.get("type") == "assigned"]
            assert assigned, "no 'assigned' activity logged"
            assert any("Reassigned to" in (a.get("summary") or "") for a in assigned)


# ---------- Test 2: PATCH logs 'updated' activity with meta.changes ----------
class TestPatchEditHistory:
    def test_patch_logs_field_diff(self, lm_headers):
        lid = _create_lead(lm_headers, "TEST_v220 Edit Original")
        # First patch a couple of fields.
        r = requests.patch(f"{API}/crm/leads/{lid}", headers=lm_headers,
                           json={"org_name": "TEST_v220 Edit Updated", "priority": "High", "city": "Austin", "state": "tx"},
                           timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # State auto-uppercased
        assert body.get("state") == "TX"
        assert body.get("org_name") == "TEST_v220 Edit Updated"
        assert body.get("priority") == "High"

        g = requests.get(f"{API}/crm/leads/{lid}", headers=lm_headers, timeout=15)
        assert g.status_code == 200
        acts = g.json().get("activity") or []
        updated = [a for a in acts if a.get("kind") == "updated" or a.get("type") == "updated"]
        assert updated, "no 'updated' activity present after PATCH"
        latest = updated[0]
        assert (latest.get("summary") or "").startswith("Edited "), f"bad summary: {latest.get('summary')}"
        changes = (latest.get("meta") or {}).get("changes") or []
        fields = {c["field"]: c for c in changes}
        assert "org_name" in fields
        assert fields["org_name"]["from"] == "TEST_v220 Edit Original"
        assert fields["org_name"]["to"] == "TEST_v220 Edit Updated"
        assert "priority" in fields
        assert fields["priority"]["from"] == "Medium"
        assert fields["priority"]["to"] == "High"
        assert "city" in fields and fields["city"]["to"] == "Austin"
        assert "state" in fields and fields["state"]["to"] == "TX"


# ---------- Tests 3 & 4: Import claim mismatch + notify on person-assignment ----------
def _find_unused_medicare_npi(headers):
    """Query physicians via /medicare/search then filter to those not yet a lead."""
    # Use a known-good NPI from the review (1528183746, 1943 claims). Confirm it's not already a lead.
    npi = "1528183746"
    r = requests.get(f"{API}/crm/leads", headers=headers, params={"q": npi, "limit": 5}, timeout=15)
    if r.status_code == 200 and any((L.get("matched_npi") == npi) for L in r.json()):
        return None, None
    return npi, 1943


class TestImportClaimMismatch:
    def _build_csv(self, npi, imported_claims, org="TEST_v220 Mismatch"):
        rows = [
            "NPI,Org,First,Last,Total Claims",
            f"{npi},{org},Test,Physician,{imported_claims}",
        ]
        return ("\n".join(rows)).encode()

    def _upload_and_map(self, headers, csv_bytes, filename, distribute="route", assignee_id=None):
        files = {"file": (filename, csv_bytes, "text/csv")}
        data = {"dataset_type": "lead"}
        r = requests.post(f"{API}/imports", headers=headers, files=files, data=data, timeout=30)
        assert r.status_code == 200, r.text
        job_id = r.json()["import_id"]
        # Force mapping (bypass AI variance):
        mapping = {"NPI": "npi", "Org": "org_name", "First": "contact_first",
                   "Last": "contact_last", "Total Claims": "notes"}
        payload = {"mapping": mapping, "rule": "safe", "source": "CSV Import",
                   "data_year": 2024, "distribute": distribute, "assignee_id": assignee_id}
        r2 = requests.post(f"{API}/imports/{job_id}/mapping", headers=headers, json=payload, timeout=20)
        assert r2.status_code == 200, r2.text
        r3 = requests.post(f"{API}/imports/{job_id}/validate", headers=headers, timeout=30)
        assert r3.status_code == 200, r3.text
        return job_id

    def test_mismatch_flags_lead_and_filter_returns_only_flagged(self, lm_headers):
        npi, medicare_claims = _find_unused_medicare_npi(lm_headers)
        if not npi:
            pytest.skip("Medicare NPI 1528183746 already a lead — clean up and retry")
        wrong_claims = 555 if medicare_claims != 555 else 111
        csv = self._build_csv(npi, wrong_claims)
        job_id = self._upload_and_map(lm_headers, csv, "test_v220_mismatch.csv")
        # Execute
        rex = requests.post(f"{API}/imports/{job_id}/execute", headers=lm_headers, timeout=60)
        assert rex.status_code == 200, rex.text
        counts = rex.json()
        assert counts.get("created") >= 1

        try:
            # The lead is fetched by matched_npi filter through list_leads
            g = requests.get(f"{API}/crm/leads", headers=lm_headers, params={"q": npi, "limit": 10}, timeout=15)
            assert g.status_code == 200
            matches = [L for L in g.json() if L.get("matched_npi") == npi]
            assert matches, "created lead not found via list"
            lead = matches[0]
            assert lead.get("claim_mismatch") is True, f"claim_mismatch not True: {lead.get('claim_mismatch')}"
            detail = lead.get("claim_mismatch_detail") or {}
            assert detail.get("label"), "claim_mismatch_detail.label missing"
            assert str(detail.get("imported")) == str(wrong_claims)
            assert str(detail.get("medicare")) == str(medicare_claims)

            # Filter endpoint
            f = requests.get(f"{API}/crm/leads", headers=lm_headers,
                             params={"claim_mismatch": "true", "limit": 200}, timeout=15)
            assert f.status_code == 200
            flist = f.json()
            assert any(L.get("id") == lead["id"] for L in flist), "flagged lead not returned by ?claim_mismatch=true"
            for L in flist:
                assert L.get("claim_mismatch") is True, "non-flagged lead returned by claim_mismatch filter"
        finally:
            # Roll back
            requests.post(f"{API}/imports/{job_id}/rollback", headers=lm_headers, timeout=30)

    def test_matching_claim_value_does_not_flag(self, lm_headers):
        npi, medicare_claims = _find_unused_medicare_npi(lm_headers)
        if not npi:
            pytest.skip("Medicare NPI already a lead")
        csv = self._build_csv(npi, medicare_claims, org="TEST_v220 Match")
        job_id = self._upload_and_map(lm_headers, csv, "test_v220_match.csv")
        rex = requests.post(f"{API}/imports/{job_id}/execute", headers=lm_headers, timeout=60)
        assert rex.status_code == 200, rex.text
        try:
            g = requests.get(f"{API}/crm/leads", headers=lm_headers, params={"q": npi, "limit": 10}, timeout=15)
            matches = [L for L in g.json() if L.get("matched_npi") == npi]
            assert matches
            lead = matches[0]
            # Should NOT be flagged since imported == Medicare
            assert not lead.get("claim_mismatch"), f"lead incorrectly flagged: {lead.get('claim_mismatch_detail')}"
        finally:
            requests.post(f"{API}/imports/{job_id}/rollback", headers=lm_headers, timeout=30)

    def test_import_person_assignment_does_not_break_execute(self, lm_headers, ankit_id):
        """Notify may push-fail (500 EMERGENT_PUSH_KEY placeholder) but MUST NOT break execute."""
        npi, medicare_claims = _find_unused_medicare_npi(lm_headers)
        if not npi:
            pytest.skip("Medicare NPI already a lead")
        csv = self._build_csv(npi, medicare_claims, org="TEST_v220 PersonAssign")
        job_id = self._upload_and_map(lm_headers, csv, "test_v220_person.csv",
                                      distribute="person", assignee_id=ankit_id)
        rex = requests.post(f"{API}/imports/{job_id}/execute", headers=lm_headers, timeout=60)
        assert rex.status_code == 200, f"execute broke on person-assign notify: {rex.text}"
        counts = rex.json()
        assert counts.get("created") >= 1
        try:
            g = requests.get(f"{API}/crm/leads", headers=lm_headers, params={"q": npi, "limit": 10}, timeout=15)
            matches = [L for L in g.json() if L.get("matched_npi") == npi]
            assert matches
            assert matches[0].get("account_manager_id") == ankit_id
        finally:
            requests.post(f"{API}/imports/{job_id}/rollback", headers=lm_headers, timeout=30)
