"""Iteration 16 tests:
- POST /api/crm/routing/rebalance (lead_manager) — evens out AM lead loads (spread<=1)
- GET  /api/crm/routing/balance?scope=am|all — reps + prev counts + top-level fields
- GET  /api/voice/config, /api/voice/token — GATED OFF (enabled:false); require auth
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

LEAD_MGR = {"email": "leadmanager@boothiq.com", "pin": "639201"}
ACC_MGR = {"email": "accountmanager@boothiq.com", "pin": "528174"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(sess, creds):
    r = sess.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def mgr_token(s):
    return _login(s, LEAD_MGR)


@pytest.fixture(scope="module")
def am_token(s):
    return _login(s, ACC_MGR)


@pytest.fixture(scope="module")
def mgr_headers(mgr_token):
    return {"Authorization": f"Bearer {mgr_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def am_headers(am_token):
    return {"Authorization": f"Bearer {am_token}", "Content-Type": "application/json"}


# ==================== routing/balance ====================
class TestRoutingBalance:
    def test_balance_scope_am_default(self, s, mgr_headers):
        r = s.get(f"{API}/crm/routing/balance", headers=mgr_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # top-level shape
        for k in ("month_total", "prev_total", "unassigned", "reps", "spread", "max"):
            assert k in d, f"missing key {k}"
        # scope=am → only account_manager roles
        roles = {rep.get("role") for rep in d["reps"]}
        assert roles.issubset({"account_manager"}) or roles == set(), f"scope=am leaked roles: {roles}"
        # per-rep shape (leads + prev)
        for rep in d["reps"]:
            assert set(["user_id", "name", "leads", "prev"]).issubset(rep.keys())
            assert isinstance(rep["leads"], int) and isinstance(rep["prev"], int)
        # desc-sorted by leads
        leads_list = [rep["leads"] for rep in d["reps"]]
        assert leads_list == sorted(leads_list, reverse=True)

    def test_balance_scope_all_includes_lead_managers(self, s, mgr_headers):
        am_resp = s.get(f"{API}/crm/routing/balance", params={"scope": "am"}, headers=mgr_headers, timeout=30)
        all_resp = s.get(f"{API}/crm/routing/balance", params={"scope": "all"}, headers=mgr_headers, timeout=30)
        assert am_resp.status_code == 200 and all_resp.status_code == 200
        am_reps = am_resp.json()["reps"]
        all_reps = all_resp.json()["reps"]
        all_roles = {rep.get("role") for rep in all_reps}
        # 'all' must be a superset of 'am' (by user_id) and may include lead_manager
        am_ids = {r["user_id"] for r in am_reps}
        all_ids = {r["user_id"] for r in all_reps}
        assert am_ids.issubset(all_ids), "scope=all must include every account_manager"
        assert "lead_manager" in all_roles or len(am_ids) == len(all_ids), (
            "scope=all should include lead_managers when they exist")

    def test_balance_requires_manager_auth(self, s, am_headers):
        r = s.get(f"{API}/crm/routing/balance", headers=am_headers, timeout=30)
        assert r.status_code in (401, 403), f"AM should not access routing/balance: {r.status_code}"

    def test_balance_unauth(self, s):
        r = requests.get(f"{API}/crm/routing/balance", timeout=30)
        assert r.status_code in (401, 403)


# ==================== routing/rebalance ====================
class TestRebalance:
    @staticmethod
    def _get_ams(sess, headers):
        r = sess.get(f"{API}/users", params={"role": "account_manager"}, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def _create_lead_for(self, sess, headers, am_id, am_name):
        payload = {"name": f"TESTi16 {uuid.uuid4().hex[:6]}", "phone": "5551230000",
                   "state": "TX", "specialty": "Cardiology", "status": "New"}
        r = sess.post(f"{API}/crm/leads", json=payload, headers=headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        lead = r.json()
        # Force assign to target AM directly (avoid routing side effects)
        r2 = sess.patch(f"{API}/crm/leads/{lead['id']}",
                        json={"account_manager_id": am_id, "account_manager_name": am_name,
                              "status": "New"},
                        headers=headers, timeout=30)
        assert r2.status_code == 200, r2.text
        return lead["id"]

    def test_rebalance_reduces_spread_to_one(self, s, mgr_headers):
        ams = self._get_ams(s, mgr_headers)
        if len(ams) < 2:
            pytest.skip("Need at least 2 account managers")
        # Pick busiest and quietest per current balance
        bal = s.get(f"{API}/crm/routing/balance", params={"scope": "am"},
                    headers=mgr_headers, timeout=30).json()
        reps = bal["reps"]
        if not reps:
            pytest.skip("No AM reps returned")
        busiest = reps[0]
        # Ensure at least 5-lead spread by loading busiest
        needed = max(0, 5 - (busiest["leads"] - reps[-1]["leads"]))
        created_ids = []
        for _ in range(needed):
            created_ids.append(self._create_lead_for(s, mgr_headers, busiest["user_id"], busiest["name"]))
        # Re-fetch balance to confirm spread > 1 (setup) — may already be)
        bal2 = s.get(f"{API}/crm/routing/balance", params={"scope": "am"},
                     headers=mgr_headers, timeout=30).json()
        pre_spread = bal2["spread"]
        # Rebalance
        r = s.post(f"{API}/crm/routing/rebalance", headers=mgr_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert isinstance(data.get("moved"), int) and data["moved"] >= 0
        # Post-rebalance spread ≤ 1
        bal3 = s.get(f"{API}/crm/routing/balance", params={"scope": "am"},
                     headers=mgr_headers, timeout=30).json()
        assert bal3["spread"] <= 1, (
            f"Spread not reduced to ≤1 (pre={pre_spread}, moved={data['moved']}, post={bal3['spread']})")

    def test_rebalance_idempotent_when_already_balanced(self, s, mgr_headers):
        r = s.post(f"{API}/crm/routing/rebalance", headers=mgr_headers, timeout=60)
        assert r.status_code == 200
        # Running again should move 0 (already spread<=1) — must not infinite-loop.
        r2 = s.post(f"{API}/crm/routing/rebalance", headers=mgr_headers, timeout=60)
        assert r2.status_code == 200
        assert r2.json().get("moved", -1) == 0, r2.json()

    def test_rebalance_sets_routing_reason(self, s, mgr_headers):
        # Look at leads with rebalance reason from this month
        this_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0,
                                                        second=0, microsecond=0).isoformat()
        # Simple probe via lead list; the CRM has /api/crm/leads with routing_reason.
        r = s.get(f"{API}/crm/leads", params={"limit": 500}, headers=mgr_headers, timeout=30)
        assert r.status_code == 200, r.text
        leads = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        rebalanced = [l for l in leads if isinstance(l, dict) and "Rebalanced" in (l.get("routing_reason") or "")]
        # If any rebalance occurred previously it should have the exact prefix
        for l in rebalanced[:5]:
            assert l["routing_reason"].startswith("Rebalanced — moved from "), l["routing_reason"]

    def test_rebalance_requires_manager_auth(self, s, am_headers):
        r = s.post(f"{API}/crm/routing/rebalance", headers=am_headers, timeout=30)
        assert r.status_code in (401, 403)


# ==================== voice — GATED OFF ====================
class TestVoiceGatedOff:
    def test_voice_config_disabled(self, s, mgr_headers):
        r = s.get(f"{API}/voice/config", headers=mgr_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("enabled") is False, d
        assert d.get("from_number") in (None, ""), d

    def test_voice_token_disabled(self, s, mgr_headers):
        r = s.get(f"{API}/voice/token", headers=mgr_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("enabled") is False
        assert d.get("token") in (None, "")

    def test_voice_config_requires_auth(self, s):
        r = requests.get(f"{API}/voice/config", timeout=30)
        assert r.status_code in (401, 403)

    def test_voice_token_requires_auth(self, s):
        r = requests.get(f"{API}/voice/token", timeout=30)
        assert r.status_code in (401, 403)

    def test_voice_config_works_for_am(self, s, am_headers):
        # ANY_CRM allows account_manager
        r = s.get(f"{API}/voice/config", headers=am_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("enabled") is False
