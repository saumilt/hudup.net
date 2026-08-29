"""Iteration 15 — Routing UX/observability (three UI-oriented additions):

1) Import Review preview: POST /api/imports/{id}/validate now returns
   notes_columns (list) and preview rows include an integer notes count.
2) Routing Trace: every routed lead has a routing_reason string:
   - manual create + no territory → mentions creator/creator-name
   - manual create matching territory → names the team and/or territory
   - bulk import & route-unassigned → mentions round-robin
   - POST /api/crm/leads/{id}/assign → 'Manually assigned by <name>'
3) Round-Robin Balance: GET /api/crm/routing/balance returns
   {month_total, unassigned, reps:[{user_id,name,role,leads}], spread, max}.

Regression: quotas/attainment still returns list of rep rows.
"""
import io
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers ----------------------------------------------------------

def _login(email: str, pin: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def lm_token():
    return _login("leadmanager@boothiq.com", "639201")


@pytest.fixture(scope="module")
def lm_user(lm_token):
    r = requests.get(f"{API}/auth/me", headers=_hdr(lm_token), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def am_ids(lm_token):
    r = requests.get(f"{API}/users", headers=_hdr(lm_token), timeout=20)
    assert r.status_code == 200
    ids = [u["id"] for u in r.json() if u.get("role") == "account_manager"]
    assert len(ids) >= 1, "Need at least 1 account_manager for tests"
    return ids


# ---------- 1) Notes preview in /validate -----------------------------------

class TestImportNotesPreview:
    """POST /api/imports/{id}/validate → notes_columns + per-row notes count."""

    @pytest.fixture(scope="class")
    def csv_bytes(self):
        return (
            "Org,First,Last,NPI,DoctorNotes,Referral,Extra\n"
            f"TESTi15 Alpha Practice,Alice,{'A'+uuid.uuid4().hex[:6]},{uuid.uuid4().int % 10**10:010d},"
            "prefers-morning,office-lead,\n"
            f"TESTi15 Beta Clinic,Bob,{'B'+uuid.uuid4().hex[:6]},{uuid.uuid4().int % 10**10:010d},"
            ",web-form,vip\n"
        ).encode()

    def test_validate_returns_notes_columns_and_counts(self, lm_token, csv_bytes):
        # upload
        r = requests.post(
            f"{API}/imports",
            files={"file": (f"t15_{uuid.uuid4().hex[:6]}.csv", csv_bytes, "text/csv")},
            data={"dataset_type": "lead"},
            headers={"Authorization": f"Bearer {lm_token}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        import_id = r.json()["import_id"]
        headers = r.json()["headers"]
        assert "DoctorNotes" in headers and "Referral" in headers

        # analyze (baseline mapping — may miss DoctorNotes/Referral, that's fine)
        r = requests.post(f"{API}/imports/{import_id}/analyze",
                          headers=_hdr(lm_token), timeout=45)
        assert r.status_code == 200, r.text
        mapping = r.json()["mapping"]
        # target_fields must include 'notes'
        assert "notes" in r.json()["target_fields"]

        # Force map two columns → notes (Extra column has empty values on both rows)
        mapping["Org"] = "org_name"
        mapping["First"] = "contact_first"
        mapping["Last"] = "contact_last"
        mapping["NPI"] = "npi"
        mapping["DoctorNotes"] = "notes"
        mapping["Referral"] = "notes"
        mapping["Extra"] = "notes"  # empty on row 0, populated on row 1

        r = requests.post(f"{API}/imports/{import_id}/mapping",
                          json={"mapping": mapping, "rule": "safe"},
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200, r.text

        # validate
        r = requests.post(f"{API}/imports/{import_id}/validate",
                          headers=_hdr(lm_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()

        # ---- notes_columns ----
        assert "notes_columns" in data, "response missing notes_columns"
        assert isinstance(data["notes_columns"], list)
        assert set(data["notes_columns"]) == {"DoctorNotes", "Referral", "Extra"}, \
            f"notes_columns={data['notes_columns']}"

        # ---- preview per-row notes count (integer) ----
        assert len(data["preview"]) >= 2
        for row in data["preview"]:
            assert "notes" in row and isinstance(row["notes"], int), \
                f"row missing notes int: {row}"

        # row 0: DoctorNotes+Referral filled, Extra empty  → 2
        # row 1: Referral+Extra filled, DoctorNotes empty  → 2
        # (blank cells are dropped by _project before pushing to notes)
        assert data["preview"][0]["notes"] == 2, data["preview"][0]
        assert data["preview"][1]["notes"] == 2, data["preview"][1]


# ---------- 2) Routing trace / routing_reason -------------------------------

class TestRoutingReason:

    def test_manual_no_territory_reason_mentions_creator(self, lm_token, lm_user):
        # Use a rare state/specialty combination unlikely to hit any territory.
        payload = {
            "org_name": f"TESTi15 NoTerr {uuid.uuid4().hex[:6]}",
            "contact_first": "Nora", "contact_last": "NoMatch",
            "source": "manual",
            "state": "ZZ", "specialty": "XyzUnmatched",
        }
        r = requests.post(f"{API}/crm/leads", json=payload,
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200, r.text
        lead_id = r.json()["id"]
        # Re-fetch (create endpoint returns doc before routing patch is applied)
        r = requests.get(f"{API}/crm/leads/{lead_id}",
                         headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200
        lead = r.json()
        reason = lead.get("routing_reason") or ""
        assert reason, f"routing_reason missing: {lead}"
        assert "creator" in reason.lower(), f"expected creator fallback, got: {reason}"
        assert lead.get("routed_at"), "routed_at should be set"

    def test_manual_assign_reason_uses_manually_assigned_by(self, lm_token, lm_user, am_ids):
        # Create an unassigned-ish lead first
        r = requests.post(f"{API}/crm/leads",
                          json={"org_name": f"TESTi15 Assign {uuid.uuid4().hex[:6]}",
                                "contact_first": "A", "contact_last": "B",
                                "source": "manual", "state": "ZZ", "specialty": "XyzUnmatched"},
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200
        lead_id = r.json()["id"]

        # Manual assign
        r = requests.post(f"{API}/crm/leads/{lead_id}/assign",
                          json={"account_manager_id": am_ids[0]},
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/crm/leads/{lead_id}",
                         headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200
        lead = r.json()
        reason = lead.get("routing_reason") or ""
        assert reason.startswith("Manually assigned by"), f"got: {reason}"
        # actor name should be in reason
        assert (lm_user.get("name") or "") in reason, \
            f"expected actor name '{lm_user.get('name')}' in reason: {reason}"

    def test_route_unassigned_reason_mentions_round_robin(self, lm_token):
        # Create an explicitly unassigned lead (skip auto-route by pre-assigning None
        # is not possible; the create endpoint always auto-routes. Instead, use
        # POST /crm/leads (unmatched) then null-out account_manager_id via /assign is
        # not allowed. Use POST route-unassigned after creating an unmatched lead
        # and then clearing its assignment via direct patch is not exposed. So we
        # rely on manual /route which uses bulk semantics.
        r = requests.post(f"{API}/crm/leads",
                          json={"org_name": f"TESTi15 RR {uuid.uuid4().hex[:6]}",
                                "contact_first": "R", "contact_last": "R",
                                "source": "manual", "state": "ZZ", "specialty": "XyzUnmatched"},
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200
        lead_id = r.json()["id"]

        # Force re-route through the manager-triggered path → bulk semantics → RR
        r = requests.post(f"{API}/crm/leads/{lead_id}/route",
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/crm/leads/{lead_id}",
                         headers=_hdr(lm_token), timeout=20)
        lead = r.json()
        reason = lead.get("routing_reason") or ""
        assert "round-robin" in reason.lower(), f"expected round-robin, got: {reason}"


# ---------- 3) GET /api/crm/routing/balance ---------------------------------

class TestRoutingBalance:

    def test_balance_shape_and_types(self, lm_token):
        r = requests.get(f"{API}/crm/routing/balance",
                         headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("month_total", "unassigned", "reps", "spread", "max"):
            assert k in d, f"missing key {k}: {d.keys()}"
        assert isinstance(d["month_total"], int)
        assert isinstance(d["unassigned"], int)
        assert isinstance(d["spread"], int)
        assert isinstance(d["max"], int)
        assert isinstance(d["reps"], list)
        assert len(d["reps"]) >= 1, "expected at least one rep in balance"
        # each rep row
        for rep in d["reps"]:
            for k in ("user_id", "name", "role", "leads"):
                assert k in rep, f"rep missing {k}: {rep}"
            assert isinstance(rep["leads"], int)
            assert rep["role"] in ("account_manager", "lead_manager")
        # reps are sorted desc by leads
        counts = [r["leads"] for r in d["reps"]]
        assert counts == sorted(counts, reverse=True), f"reps not sorted desc: {counts}"
        # spread = max - min
        assert d["spread"] == (max(counts) - min(counts)) if counts else 0
        assert d["max"] == max(counts, default=0)

    def test_balance_reflects_new_lead(self, lm_token, am_ids):
        before = requests.get(f"{API}/crm/routing/balance",
                              headers=_hdr(lm_token), timeout=20).json()
        before_map = {r["user_id"]: r["leads"] for r in before["reps"]}
        before_total = before["month_total"]

        # Create + assign to a specific AM to guarantee the counter moves.
        r = requests.post(f"{API}/crm/leads",
                          json={"org_name": f"TESTi15 Bal {uuid.uuid4().hex[:6]}",
                                "contact_first": "X", "contact_last": "Y",
                                "source": "manual", "state": "ZZ", "specialty": "XyzUnmatched"},
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200
        lead_id = r.json()["id"]
        r = requests.post(f"{API}/crm/leads/{lead_id}/assign",
                          json={"account_manager_id": am_ids[0]},
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200

        after = requests.get(f"{API}/crm/routing/balance",
                             headers=_hdr(lm_token), timeout=20).json()
        after_map = {r["user_id"]: r["leads"] for r in after["reps"]}
        assert after["month_total"] >= before_total  # may be equal if lead was already counted
        # target rep's count went up by at least 1 vs baseline
        assert after_map.get(am_ids[0], 0) >= before_map.get(am_ids[0], 0) + 1


# ---------- Regression ------------------------------------------------------

class TestRegression:

    def test_quotas_attainment_still_returns_rows(self, lm_token):
        r = requests.get(f"{API}/crm/quotas/attainment",
                         headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        for row in rows:
            for k in ("user_id", "name", "leads", "meetings", "opps",
                      "revenue", "leads_target", "revenue_target"):
                assert k in row, f"missing {k}: {row}"

    def test_bulk_import_execute_still_works_end_to_end(self, lm_token):
        csv = (
            "Org,First,Last,NPI,DoctorNotes\n"
            f"TESTi15 Reg {uuid.uuid4().hex[:6]},Reg,Row,{uuid.uuid4().int % 10**10:010d},reg-note\n"
        ).encode()
        r = requests.post(f"{API}/imports",
                          files={"file": ("reg.csv", csv, "text/csv")},
                          data={"dataset_type": "lead"},
                          headers={"Authorization": f"Bearer {lm_token}"}, timeout=30)
        assert r.status_code == 200
        job_id = r.json()["import_id"]

        r = requests.post(f"{API}/imports/{job_id}/analyze",
                          headers=_hdr(lm_token), timeout=45)
        assert r.status_code == 200
        mapping = r.json()["mapping"]
        mapping.update({"Org": "org_name", "First": "contact_first",
                        "Last": "contact_last", "NPI": "npi",
                        "DoctorNotes": "notes"})
        requests.post(f"{API}/imports/{job_id}/mapping",
                      json={"mapping": mapping, "rule": "safe"},
                      headers=_hdr(lm_token), timeout=20).raise_for_status()
        requests.post(f"{API}/imports/{job_id}/validate",
                      headers=_hdr(lm_token), timeout=30).raise_for_status()

        r = requests.post(f"{API}/imports/{job_id}/execute",
                          headers=_hdr(lm_token), timeout=45)
        assert r.status_code == 200, r.text
        assert r.json()["created"] >= 1

        # Rollback to avoid polluting the dataset.
        r = requests.post(f"{API}/imports/{job_id}/rollback",
                          headers=_hdr(lm_token), timeout=20)
        assert r.status_code == 200
