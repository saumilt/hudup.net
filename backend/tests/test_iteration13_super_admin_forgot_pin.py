"""Iteration 13 tests: super_admin role, forgot-pin self-service, credential_ok
policy (code-or-password), and role-gating regression."""
import os
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@boothiq.com"
ADMIN_PIN = "482913"
LM_EMAIL = "leadmanager@boothiq.com"
LM_PIN = "639201"
AM_EMAIL = "accountmanager@boothiq.com"
AM_PIN = "528174"


# ------------- fixtures -------------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _login(s, email, pin):
    r = s.post(f"{API}/auth/login", json={"email": email, "pin": pin})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def admin_hdr(s):
    tok, _ = _login(s, ADMIN_EMAIL, ADMIN_PIN)
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def am_hdr(s):
    tok, _ = _login(s, AM_EMAIL, AM_PIN)
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def lm_hdr(s):
    tok, _ = _login(s, LM_EMAIL, LM_PIN)
    return {"Authorization": f"Bearer {tok}"}


def _mk_user(s, admin_hdr, role, pin=None, prefix="TEST_iter13"):
    uniq = str(int(time.time() * 1000))
    email = f"{prefix.lower()}_{uniq}_{role}@boothiq.test"
    body = {"email": email, "name": f"{prefix} {role} {uniq}", "role": role, "send_invite": False}
    if pin is not None:
        body["pin"] = pin
    r = s.post(f"{API}/users", json=body, headers=admin_hdr)
    return r, email


_created_user_ids = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(s, admin_hdr):
    yield
    # best-effort delete via PATCH deactivate (no hard delete endpoint) — we
    # deactivate the throwaway accounts we created.
    for uid in _created_user_ids:
        try:
            s.patch(f"{API}/users/{uid}", json={"active": False}, headers=admin_hdr)
        except Exception:
            pass


# ---------- super_admin role ----------
class TestSuperAdmin:
    def test_roles_includes_super_admin(self, s):
        r = s.get(f"{API}/users/roles")
        assert r.status_code == 200
        data = r.json()
        labels = {row["value"]: row["label"] for row in data}
        assert "super_admin" in labels
        assert labels["super_admin"] == "Super Admin"

    def test_create_super_admin_and_access_admin_routes(self, s, admin_hdr):
        r, email = _mk_user(s, admin_hdr, "super_admin", pin="Health2026")
        assert r.status_code == 200, r.text
        u = r.json()
        _created_user_ids.append(u["id"])
        assert u["role"] == "super_admin"
        assert u["must_change_pin"] is False

        # login as super_admin
        lr = s.post(f"{API}/auth/login", json={"email": email, "pin": "Health2026"})
        assert lr.status_code == 200
        sa_token = lr.json()["token"]
        sa_hdr = {"Authorization": f"Bearer {sa_token}"}

        # admin-only route: GET /api/admin/sessions -> 200
        r2 = s.get(f"{API}/admin/sessions", headers=sa_hdr)
        assert r2.status_code == 200, f"super_admin cannot access admin/sessions: {r2.status_code} {r2.text}"

        # admin-gated POST /api/users
        uniq = str(int(time.time() * 1000))
        cr = s.post(
            f"{API}/users",
            json={"email": f"test_iter13_by_sa_{uniq}@boothiq.test", "name": "By-SA", "role": "staff",
                  "pin": "778899", "send_invite": False},
            headers=sa_hdr,
        )
        assert cr.status_code == 200, cr.text
        _created_user_ids.append(cr.json()["id"])


# ---------- forgot-pin ----------
class TestForgotPin:
    def test_forgot_nonexistent_email_generic(self, s):
        r = s.post(f"{API}/auth/forgot-pin", json={"email": f"nope_{int(time.time())}@boothiq.test"})
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        assert "temporary PIN" in (j.get("message") or "").lower() or "if an account" in (j.get("message") or "").lower()

    def test_forgot_existing_rotates_pin_and_sets_must_change(self, s, admin_hdr):
        # create a throwaway user with known pin, then forgot -> old pin no longer works, must_change_pin=true
        r, email = _mk_user(s, admin_hdr, "account_manager", pin="246810")
        assert r.status_code == 200
        uid = r.json()["id"]
        _created_user_ids.append(uid)
        # sanity: old pin works
        assert s.post(f"{API}/auth/login", json={"email": email, "pin": "246810"}).status_code == 200

        # trigger forgot-pin
        r2 = s.post(f"{API}/auth/forgot-pin", json={"email": email})
        assert r2.status_code == 200
        assert r2.json().get("ok") is True

        # old pin should NOT work anymore (it was rotated)
        old = s.post(f"{API}/auth/login", json={"email": email, "pin": "246810"})
        assert old.status_code == 401, f"expected old pin invalid, got {old.status_code}"

        # verify must_change_pin flipped via admin lookup
        users = s.get(f"{API}/users", headers=admin_hdr).json()
        me = next((u for u in users if u["id"] == uid), None)
        assert me is not None
        assert me.get("must_change_pin") is True

    def test_forgot_rate_limit_blocks_further_rotations(self, s, admin_hdr):
        # create fresh user
        r, email = _mk_user(s, admin_hdr, "account_manager", pin="135797")
        assert r.status_code == 200
        uid = r.json()["id"]
        _created_user_ids.append(uid)

        # burn 3 forgot-pin calls
        for i in range(3):
            rr = s.post(f"{API}/auth/forgot-pin", json={"email": email})
            assert rr.status_code == 200
            assert rr.json().get("ok") is True

        # After 3 rotations, pin has changed 3x. Reset to a known one via admin so
        # we can detect whether the 4th call rotates it further.
        rp = s.post(f"{API}/users/{uid}/reset-pin", json={"pin": "864297"}, headers=admin_hdr)
        assert rp.status_code == 200

        # 4th call -> generic response, but MUST NOT rotate (rate-limited)
        r4 = s.post(f"{API}/auth/forgot-pin", json={"email": email})
        assert r4.status_code == 200
        assert r4.json().get("ok") is True

        # verify pin was NOT rotated: login with 864297 still works
        lg = s.post(f"{API}/auth/login", json={"email": email, "pin": "864297"})
        assert lg.status_code == 200, f"rate limit should have prevented rotation; got {lg.status_code} {lg.text}"


# ---------- credential policy ----------
class TestCredentialPolicy:
    @pytest.fixture(scope="class")
    def temp_user(self, s, admin_hdr):
        r, email = _mk_user(s, admin_hdr, "staff", pin="112233")
        assert r.status_code == 200
        uid = r.json()["id"]
        _created_user_ids.append(uid)
        # login
        lr = s.post(f"{API}/auth/login", json={"email": email, "pin": "112233"})
        tok = lr.json()["token"]
        return {"email": email, "uid": uid, "pin": "112233", "token": tok}

    def _hdr(self, tu):
        return {"Authorization": f"Bearer {tu['token']}"}

    def test_change_pin_accept_numeric_code(self, s, temp_user):
        r = s.post(f"{API}/auth/change-pin",
                   json={"new_pin": "2468", "current_pin": temp_user["pin"]},
                   headers=self._hdr(temp_user))
        assert r.status_code == 200, r.text
        # update stored pin
        temp_user["pin"] = "2468"
        # must_change_pin cleared
        me = s.get(f"{API}/auth/me", headers=self._hdr(temp_user)).json()
        assert me.get("must_change_pin") is False

    def test_change_pin_accept_password(self, s, temp_user):
        r = s.post(f"{API}/auth/change-pin",
                   json={"new_pin": "Health2026", "current_pin": temp_user["pin"]},
                   headers=self._hdr(temp_user))
        assert r.status_code == 200, r.text
        temp_user["pin"] = "Health2026"

    def test_change_pin_reject_too_short(self, s, temp_user):
        r = s.post(f"{API}/auth/change-pin",
                   json={"new_pin": "abc", "current_pin": temp_user["pin"]},
                   headers=self._hdr(temp_user))
        assert r.status_code == 400

    def test_change_pin_reject_short_numeric(self, s, temp_user):
        r = s.post(f"{API}/auth/change-pin",
                   json={"new_pin": "123", "current_pin": temp_user["pin"]},
                   headers=self._hdr(temp_user))
        assert r.status_code == 400

    def test_change_pin_reject_password_no_number(self, s, temp_user):
        r = s.post(f"{API}/auth/change-pin",
                   json={"new_pin": "password", "current_pin": temp_user["pin"]},
                   headers=self._hdr(temp_user))
        assert r.status_code == 400

    def test_create_user_reject_weak_pin(self, s, admin_hdr):
        r, _ = _mk_user(s, admin_hdr, "staff", pin="abc")
        assert r.status_code == 400
        assert "digit" in r.text.lower() or "character" in r.text.lower() or "number" in r.text.lower()


# ---------- role gating regression ----------
class TestRoleGating:
    def test_account_manager_forbidden_on_admin_route(self, s, am_hdr):
        r = s.get(f"{API}/admin/sessions", headers=am_hdr)
        assert r.status_code == 403

    def test_lead_manager_allowed_on_users_list(self, s, lm_hdr):
        # /api/users list requires any authenticated user; lead_manager should pass
        r = s.get(f"{API}/users", headers=lm_hdr)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_lead_manager_forbidden_on_admin_route(self, s, lm_hdr):
        r = s.get(f"{API}/admin/sessions", headers=lm_hdr)
        # admin route should be admin-only (lead_manager is NOT admin)
        assert r.status_code == 403
