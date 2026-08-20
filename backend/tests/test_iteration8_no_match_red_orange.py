"""Iteration 8 backend tests.

Feature changes covered:
- lead_glow returns {glow, glow_340b, glow_rpm} (3 keys)
- No-match lead: glow_340b='#EF4444' RED, glow_rpm='#F59E0B' ORANGE, glow='#EF4444'
  (but stored tier_340b/tier_rpm remain 'GREY' — scoring unchanged)
- Matched green NPI 1528194255 -> glow_340b in green shades, glow_rpm='#EF4444'
- Matched Enkeshafi NPI 1003000126 -> non-grey colors
- Admin toggle wheel_tier_glow=false makes all three keys null
- Kiosk privacy contract still exactly {id, spin_available}
- One-spin regression
"""
import os
import pytest
import requests


def _read_base_url() -> str:
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _read_base_url()
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@boothiq.com"
ADMIN_PIN = "482913"

NPI_GREEN_340B = "1528194255"   # 340B GREEN, RPM RED per problem statement
NPI_RED_340B = "1003000126"     # Enkeshafi

GREEN_HEXES = {"#34D399", "#10B981", "#047857"}
RED_HEX = "#EF4444"
ORANGE_HEX = "#F59E0B"
GREY_HEX = "#CBD5E1"


@pytest.fixture(scope="session")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "pin": ADMIN_PIN}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _set_glow(admin_headers, value: bool):
    r = requests.put(f"{API}/admin/settings",
                     json={"key": "wheel_tier_glow", "value": value},
                     headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text


@pytest.fixture(autouse=True, scope="module")
def ensure_glow_on(admin_headers):
    _set_glow(admin_headers, True)
    yield
    _set_glow(admin_headers, True)


def _create_lead(payload: dict) -> dict:
    r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def _admin_get_lead(lid: str, admin_headers):
    r = requests.get(f"{API}/dashboard/leads/{lid}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- Kiosk privacy contract ----------------

class TestKioskPrivacy:
    def test_kiosk_leads_response_only_id_and_spin(self):
        body = _create_lead({
            "first_name": "TEST_Priv", "last_name": "NoMatchZZZ_privacy",
            "state": "TX", "city": "Nowhere",
        })
        assert set(body.keys()) == {"id", "spin_available"}, f"leaked keys: {body}"
        assert body["spin_available"] is True
        assert isinstance(body["id"], str) and len(body["id"]) > 0


# ---------------- Glow shape + no-match red/orange ----------------

class TestGlowNoMatch:
    def test_glow_shape_has_three_keys(self):
        body = _create_lead({
            "first_name": "TEST_Shape", "last_name": "NoMatchZZZ_shape",
            "state": "TX", "city": "Nowhere",
        })
        r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert set(j.keys()) == {"glow", "glow_340b", "glow_rpm"}, f"glow keys wrong: {j}"

    def test_no_match_returns_red_and_orange(self, admin_headers):
        body = _create_lead({
            "first_name": "Dhrumil", "last_name": "NoMatchZZZ_ro",
            "state": "TX", "city": "Nowhere",
        })
        r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["glow_340b"] == RED_HEX, f"expected {RED_HEX}, got {j['glow_340b']}"
        assert j["glow_rpm"] == ORANGE_HEX, f"expected {ORANGE_HEX}, got {j['glow_rpm']}"
        assert j["glow"] == RED_HEX, f"expected glow={RED_HEX}, got {j['glow']}"

        # Scoring must still record GREY on the underlying lead — this change
        # is UI-only, dashboard/tier bands unchanged.
        lead = _admin_get_lead(body["id"], admin_headers)
        assert lead["tier_340b"] == "GREY", f"tier_340b should stay GREY, got {lead['tier_340b']}"
        assert lead["tier_rpm"] == "GREY", f"tier_rpm should stay GREY, got {lead['tier_rpm']}"


# ---------------- Matched leads keep real tier colors ----------------

class TestGlowMatched:
    def test_green_npi_returns_green_outer_red_inner(self):
        body = _create_lead({
            "first_name": "TEST_G", "last_name": "GreenTester8",
            "state": "TX", "npi": NPI_GREEN_340B,
        })
        j = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10).json()
        assert j["glow_340b"] in GREEN_HEXES, f"expected green shade, got {j['glow_340b']}"
        assert j["glow_rpm"] == RED_HEX, f"expected RPM red, got {j['glow_rpm']}"
        # Priority ladder GREEN<RED, so higher-priority (outer) picks green.
        assert j["glow"] == j["glow_340b"]

    def test_enkeshafi_returns_non_grey_colors(self):
        body = _create_lead({
            "first_name": "TEST_R", "last_name": "RedTester8",
            "state": "MD", "npi": NPI_RED_340B,
        })
        j = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10).json()
        assert j["glow_340b"] != GREY_HEX, f"glow_340b should not be grey, got {j['glow_340b']}"
        assert j["glow_rpm"] != GREY_HEX, f"glow_rpm should not be grey, got {j['glow_rpm']}"
        # No-match sentinel red/orange must NOT be used for a matched lead as a pair.
        assert not (j["glow_340b"] == RED_HEX and j["glow_rpm"] == ORANGE_HEX), \
            "matched lead should not use no-match red+orange sentinel pair"


# ---------------- Admin toggle ----------------

class TestGlowToggle:
    def test_toggle_off_returns_all_null(self, admin_headers):
        body = _create_lead({
            "first_name": "TEST_Tog8", "last_name": "Toggler8",
            "state": "TX", "npi": NPI_GREEN_340B,
        })
        try:
            _set_glow(admin_headers, False)
            j = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10).json()
            # When disabled: response has {glow: null}. glow_340b/glow_rpm may be
            # absent or null; the frontend fallback (slate neutral) triggers when
            # glow is null.
            assert j.get("glow") is None, f"expected glow=None when disabled, got {j}"
            assert j.get("glow_340b") in (None, ""), f"glow_340b should be null when disabled, got {j.get('glow_340b')}"
            assert j.get("glow_rpm") in (None, ""), f"glow_rpm should be null when disabled, got {j.get('glow_rpm')}"
        finally:
            _set_glow(admin_headers, True)

        j2 = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10).json()
        assert j2["glow_340b"] in GREEN_HEXES
        assert j2["glow_rpm"] == RED_HEX


# ---------------- One-spin regression ----------------

class TestOneSpin:
    def test_second_spin_returns_already_spun(self):
        body = _create_lead({
            "first_name": "TEST_Spin8", "last_name": "Once8", "state": "TX",
        })
        r1 = requests.post(f"{API}/kiosk/leads/{body['id']}/spin", timeout=15).json()
        assert r1.get("prize") is not None, f"first spin no prize: {r1}"
        r2 = requests.post(f"{API}/kiosk/leads/{body['id']}/spin", timeout=15).json()
        assert r2.get("error") == "already_spun"


# ---------------- Dashboard feed regression ----------------

class TestDashboardFeed:
    def test_dashboard_feed_returns_leads(self, admin_headers):
        r = requests.get(f"{API}/dashboard/leads", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        leads = r.json()
        assert isinstance(leads, list)
        # Should include some of the leads we just created.
        assert len(leads) > 0
