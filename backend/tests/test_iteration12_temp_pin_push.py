"""Iteration 12 — Team accounts + temp PIN + forced change-PIN + push route.
Covers:
  * POST /api/users with send_invite (auto temp_pin) and with explicit pin
  * POST /api/users/{id}/invite (regenerate temp PIN)
  * POST /api/auth/login returns must_change_pin
  * POST /api/auth/change-pin: forced (no current_pin) vs normal (needs current_pin)
    + validators (same as old, non-digit, wrong length)
  * POST /api/register-push exists and validates body
"""
import os
import time
import pytest
import requests

def _read_env(path, key):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except FileNotFoundError:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL"))
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@boothiq.com", "pin": "482913"}


def _login(email: str, pin: str):
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=15)
    return r


def _admin_token():
    r = _login(**ADMIN)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_admin_token()}"}


@pytest.fixture()
def temp_user_email():
    return f"testiter12_{int(time.time()*1000)}@boothiq.test"


# ------------- POST /api/users (create) -------------

class TestCreateUser:
    def test_create_user_with_send_invite_returns_temp_pin(self, admin_headers, temp_user_email):
        payload = {"name": "TEST Iter12 User", "email": temp_user_email,
                   "role": "account_manager", "send_invite": True}
        r = requests.post(f"{API}/users", json=payload, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == temp_user_email
        assert body["must_change_pin"] is True
        assert "temp_pin" in body and body["temp_pin"].isdigit() and len(body["temp_pin"]) == 6
        assert "invite_sent" in body  # bool; do not require True (SMTP may fail)

    def test_create_user_with_explicit_pin_returns_normal_user(self, admin_headers):
        email = f"testiter12_explicit_{int(time.time()*1000)}@boothiq.test"
        payload = {"name": "TEST Iter12 Explicit", "email": email,
                   "role": "account_manager", "pin": "4321", "send_invite": False}
        r = requests.post(f"{API}/users", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["must_change_pin"] is False
        assert "temp_pin" not in body

    def test_create_user_duplicate_email_400(self, admin_headers, temp_user_email):
        p = {"name": "A", "email": temp_user_email, "role": "account_manager", "send_invite": True}
        r1 = requests.post(f"{API}/users", json=p, headers=admin_headers, timeout=15)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/users", json=p, headers=admin_headers, timeout=15)
        assert r2.status_code == 400


# ------------- POST /api/users/{id}/invite -------------

class TestResendInvite:
    def test_resend_invite_regenerates_temp_pin(self, admin_headers):
        email = f"testiter12_resend_{int(time.time()*1000)}@boothiq.test"
        # first create a normal user (non-temp) via explicit PIN
        c = requests.post(f"{API}/users",
                          json={"name": "TEST Resend", "email": email, "role": "account_manager",
                                "pin": "9876", "send_invite": False},
                          headers=admin_headers, timeout=15)
        assert c.status_code == 200
        uid = c.json()["id"]
        # resend invite
        r = requests.post(f"{API}/users/{uid}/invite", headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("temp_pin", "").isdigit() and len(body["temp_pin"]) == 6
        assert "invite_sent" in body
        # verify user now must_change_pin
        lst = requests.get(f"{API}/users", headers=admin_headers, timeout=15).json()
        u = [x for x in lst if x["id"] == uid][0]
        assert u["must_change_pin"] is True


# ------------- Login + change-pin end-to-end -------------

class TestForcedChangePinFlow:
    def test_full_temp_pin_flow(self, admin_headers):
        email = f"testiter12_flow_{int(time.time()*1000)}@boothiq.test"
        create = requests.post(f"{API}/users",
                               json={"name": "TEST Flow", "email": email,
                                     "role": "account_manager", "send_invite": True},
                               headers=admin_headers, timeout=20)
        assert create.status_code == 200
        temp_pin = create.json()["temp_pin"]
        # 1) login with temp pin — must_change_pin should be True
        lr = _login(email, temp_pin)
        assert lr.status_code == 200, lr.text
        assert lr.json()["user"]["must_change_pin"] is True
        token = lr.json()["token"]
        h = {"Authorization": f"Bearer {token}"}
        # 2) change-pin WITHOUT current_pin should work
        cp = requests.post(f"{API}/auth/change-pin",
                           json={"new_pin": "192837"}, headers=h, timeout=15)
        assert cp.status_code == 200, cp.text
        # 3) re-login with new PIN should have must_change_pin=False
        lr2 = _login(email, "192837")
        assert lr2.status_code == 200
        assert lr2.json()["user"]["must_change_pin"] is False
        # 4) after flag cleared, change-pin without current_pin should be rejected
        h2 = {"Authorization": f"Bearer {lr2.json()['token']}"}
        bad = requests.post(f"{API}/auth/change-pin",
                            json={"new_pin": "111222"}, headers=h2, timeout=15)
        assert bad.status_code == 400
        # 5) same new_pin as old rejected
        same = requests.post(f"{API}/auth/change-pin",
                             json={"new_pin": "192837", "current_pin": "192837"},
                             headers=h2, timeout=15)
        assert same.status_code == 400
        # 6) non-digit / short new_pin rejected
        badfmt = requests.post(f"{API}/auth/change-pin",
                               json={"new_pin": "abc", "current_pin": "192837"},
                               headers=h2, timeout=15)
        assert badfmt.status_code == 400
        short = requests.post(f"{API}/auth/change-pin",
                              json={"new_pin": "12", "current_pin": "192837"},
                              headers=h2, timeout=15)
        assert short.status_code == 400
        # 7) valid change with correct current_pin
        good = requests.post(f"{API}/auth/change-pin",
                             json={"new_pin": "554433", "current_pin": "192837"},
                             headers=h2, timeout=15)
        assert good.status_code == 200
        # 8) wrong current_pin
        wrong = requests.post(f"{API}/auth/change-pin",
                              json={"new_pin": "998877", "current_pin": "000000"},
                              headers=h2, timeout=15)
        assert wrong.status_code == 400


# ------------- Standard seeded login has must_change_pin=False -------------

class TestSeededLoginFlag:
    @pytest.mark.parametrize("email,pin", [
        ("admin@boothiq.com", "482913"),
        ("leadmanager@boothiq.com", "639201"),
        ("accountmanager@boothiq.com", "528174"),
        ("staff@boothiq.com", "715264"),
    ])
    def test_seeded_users_flag_false(self, email, pin):
        r = _login(email, pin)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["must_change_pin"] is False


# ------------- Push route -------------

class TestPushRoute:
    def test_register_push_route_exists_and_validates(self):
        # Missing required fields -> 422 (FastAPI validation) BEFORE any provider call.
        r = requests.post(f"{API}/register-push", json={}, timeout=15)
        assert r.status_code == 422

    def test_register_push_placeholder_key_returns_500_expected(self):
        # With placeholder EMERGENT_PUSH_KEY the upstream returns 401 → we surface 500.
        # This is EXPECTED in preview per the review request. Also acceptable:
        # network/timeout resulting in 5xx. Just ensure the route accepts the payload.
        r = requests.post(f"{API}/register-push",
                          json={"user_id": "u1", "platform": "android", "device_token": "tok"},
                          timeout=20)
        # Any 5xx (placeholder key rejection) OR 201 if real key is set is acceptable.
        assert r.status_code in (201, 500, 502), r.text
