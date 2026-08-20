"""Iteration 7 backend tests for the tier-accurate wheel surround + name+location match.

Feature coverage:
- Glow endpoint returns tier-color hex only (no tier word/number leaked)
- Admin toggle `wheel_tier_glow` gates the surround
- Name + location (city) disambiguation on POST /api/kiosk/leads
- Kiosk privacy contract on POST /api/kiosk/leads (only {id, spin_available})
- One-spin enforcement
"""
import os
import time
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

# Known matched physicians in the live 1.14M dataset.
NPI_GREEN_340B = "1528194255"
NPI_RED_340B = "1003000126"  # Enkeshafi

GREEN_HEXES = {"#34D399", "#10B981", "#047857"}
RED_HEX = "#EF4444"
GREY_HEX = "#CBD5E1"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "pin": ADMIN_PIN}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


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


def _create_kiosk_lead(payload: dict) -> dict:
    r = requests.post(f"{API}/kiosk/leads", json=payload, timeout=20)
    assert r.status_code == 200, f"lead create failed: {r.status_code} {r.text}"
    return r.json()


# ---------------- Kiosk privacy contract ----------------

class TestKioskPrivacy:
    def test_kiosk_leads_response_is_exactly_id_and_spin_available(self):
        body = _create_kiosk_lead({
            "first_name": "TEST_Priv",
            "last_name": "Zzzunmatched_xyz",
            "state": "TX",
        })
        assert set(body.keys()) == {"id", "spin_available"}, f"leaked keys: {body}"
        assert body["spin_available"] is True
        assert isinstance(body["id"], str) and len(body["id"]) > 0

    def test_glow_response_shape_no_tier_or_numbers(self):
        body = _create_kiosk_lead({
            "first_name": "TEST_Sam", "last_name": "Thakkar_zz", "state": "TX"
        })
        r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r.status_code == 200
        j = r.json()
        # Response is ONLY {glow: <hex or null>}. No tier/score/dollar keys.
        assert set(j.keys()) == {"glow"}, f"glow leaked keys: {j}"


# ---------------- Tier-accurate glow ----------------

class TestGlowColors:
    def test_unmatched_lead_returns_grey(self):
        body = _create_kiosk_lead({
            "first_name": "TEST_Sam",
            "last_name": "Zzunmatchedname_qwerty",
            "state": "TX",
        })
        r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r.status_code == 200
        assert r.json()["glow"] == GREY_HEX

    def test_matched_green_340b_lead_returns_green_shade(self):
        body = _create_kiosk_lead({
            "first_name": "TEST_G",
            "last_name": "GreenTester",
            "state": "TX",
            "npi": NPI_GREEN_340B,
        })
        r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r.status_code == 200
        glow = r.json()["glow"]
        assert glow in GREEN_HEXES, f"expected green shade, got {glow}"

    def test_matched_red_340b_enkeshafi_returns_red(self):
        body = _create_kiosk_lead({
            "first_name": "TEST_R",
            "last_name": "RedTester",
            "state": "MD",
            "npi": NPI_RED_340B,
        })
        r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r.status_code == 200
        glow = r.json()["glow"]
        # The 340B tier for Enkeshafi is RED per problem statement; higher-priority tier's color surfaces.
        assert glow == RED_HEX, f"expected red, got {glow}"


# ---------------- Admin toggle ----------------

class TestGlowToggle:
    def test_toggle_off_returns_null(self, admin_headers):
        body = _create_kiosk_lead({
            "first_name": "TEST_Tog",
            "last_name": "Toggler",
            "state": "TX",
            "npi": NPI_GREEN_340B,
        })
        try:
            _set_glow(admin_headers, False)
            r = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
            assert r.status_code == 200
            assert r.json()["glow"] is None
        finally:
            _set_glow(admin_headers, True)

        # Turning back on returns a real color again.
        r2 = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10)
        assert r2.status_code == 200
        assert r2.json()["glow"] in GREEN_HEXES


# ---------------- Name + location matching ----------------

class TestNameLocationMatch:
    def test_resolve_returns_multi_candidates_adams_ga_m(self):
        r = requests.post(f"{API}/kiosk/resolve",
                          json={"last_name": "Adams", "state": "GA", "first_initial": "M"},
                          timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["too_many"] is False
        cands = j.get("candidates", [])
        assert len(cands) >= 2, f"expected multiple candidates, got {len(cands)}"
        # Cache cities that produce a single-city match.
        cities = [c.get("city") for c in cands if c.get("city")]
        # Look for a city that only appears ONCE in the list.
        singles = [c for c in cities if cities.count(c) == 1]
        assert singles, f"no unique-city candidate available in {cities}"
        chosen = next(c for c in cands if c.get("city") == singles[0])
        pytest.chosen_candidate = chosen  # type: ignore

    def test_confirmed_when_city_disambiguates_from_multi_candidates(self):
        chosen = getattr(pytest, "chosen_candidate", None)
        assert chosen, "prereq test did not set chosen_candidate"
        payload = {
            "first_name": chosen["first_name"],
            "last_name": chosen["last_name"],
            "state": "GA",
            "city": chosen["city"],
            # NO NPI — force name+location match.
        }
        body = _create_kiosk_lead(payload)
        # Fetch created lead from dashboard as admin to inspect matching result.
        tok = requests.post(f"{API}/auth/login",
                            json={"email": ADMIN_EMAIL, "pin": ADMIN_PIN}, timeout=15).json()["token"]
        r = requests.get(f"{API}/dashboard/leads/{body['id']}",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead.get("match_status") == "confirmed", (
            f"expected confirmed via name+city, got match_status={lead.get('match_status')} npi={lead.get('npi')}"
        )
        assert lead.get("npi") == chosen["npi"], f"npi mismatch: {lead.get('npi')} vs {chosen['npi']}"
        # NOT grey — a matched lead has a real tier color.
        assert lead.get("tier_340b") != "GREY"

    def test_omitting_city_stays_unresolved_for_multi_candidate_name(self):
        payload = {
            "first_name": "M",
            "last_name": "Adams",
            "state": "GA",
            # NO city, NO NPI.
        }
        body = _create_kiosk_lead(payload)
        tok = requests.post(f"{API}/auth/login",
                            json={"email": ADMIN_EMAIL, "pin": ADMIN_PIN}, timeout=15).json()["token"]
        r = requests.get(f"{API}/dashboard/leads/{body['id']}",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead.get("match_status") in ("unresolved", "ambiguous"), (
            f"expected unresolved/ambiguous, got {lead.get('match_status')}"
        )
        assert lead.get("tier_340b") == "GREY"

        # Glow endpoint must show grey too.
        g = requests.get(f"{API}/kiosk/leads/{body['id']}/glow", timeout=10).json()
        assert g["glow"] == GREY_HEX


# ---------------- One-spin regression ----------------

class TestOneSpin:
    def test_second_spin_returns_already_spun(self):
        body = _create_kiosk_lead({
            "first_name": "TEST_Spin", "last_name": "Once", "state": "TX",
        })
        r1 = requests.post(f"{API}/kiosk/leads/{body['id']}/spin", timeout=15)
        assert r1.status_code == 200
        j1 = r1.json()
        assert "prize" in j1 and j1["prize"] is not None, f"first spin no prize: {j1}"

        r2 = requests.post(f"{API}/kiosk/leads/{body['id']}/spin", timeout=15)
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2.get("error") == "already_spun"
