"""Iteration 27 tests: geospatial (geo/resolve, geo/coverage) + Referral Network
(referral_generator_id on leads + /counts endpoint)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://prize-wheel-hub-4.preview.emergentagent.com").rstrip("/")

SUPER = {"email": "sam@healthandmore.net", "pin": "8677"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=SUPER, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---- GEO /resolve ----
class TestGeoResolve:
    def test_resolve_by_zip(self, auth):
        r = requests.post(f"{BASE_URL}/api/medicare/geo/resolve",
                          json={"zip": "06510", "radius_mi": 25}, headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["origin"]["source"] == "zip"
        assert "NEW HAVEN" in d["origin"]["label"].upper()
        assert d["radius_mi"] == 25
        assert d["city_count"] >= 10
        assert d["cities"] and all(c.get("lat") and c.get("lon") and "distance_mi" in c for c in d["cities"])

    def test_resolve_by_city_state(self, auth):
        r = requests.post(f"{BASE_URL}/api/medicare/geo/resolve",
                          json={"city": "New Haven", "state": "CT", "radius_mi": 10}, headers=auth, timeout=30)
        assert r.status_code == 200
        assert r.json()["origin"]["source"] == "city"

    def test_resolve_invalid(self, auth):
        r = requests.post(f"{BASE_URL}/api/medicare/geo/resolve",
                          json={"zip": "00000", "radius_mi": 25}, headers=auth, timeout=30)
        assert r.status_code == 400


# ---- GEO /coverage ----
class TestGeoCoverage:
    def test_coverage_zip(self, auth):
        r = requests.post(f"{BASE_URL}/api/medicare/geo/coverage",
                          json={"dataset_year": 2024, "origin_zip": "06510", "radius_mi": 25}, headers=auth, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["origin"] and d["origin"]["label"]
        assert d["total"] > 0
        assert d["cities"] and all({"state", "city", "count", "lat", "lon"} <= set(c) for c in d["cities"])
        assert d.get("radius_mi") == 25

    def test_coverage_respects_specialty_filter(self, auth):
        base = requests.post(f"{BASE_URL}/api/medicare/geo/coverage",
                             json={"dataset_year": 2024, "origin_zip": "06510", "radius_mi": 25}, headers=auth, timeout=60).json()
        filtered = requests.post(f"{BASE_URL}/api/medicare/geo/coverage",
                                 json={"dataset_year": 2024, "origin_zip": "06510", "radius_mi": 25,
                                       "specialty": "Cardiology"}, headers=auth, timeout=60).json()
        assert filtered["total"] <= base["total"]


# ---- Referral generator counts + lead linkage ----
class TestReferralNetwork:
    def test_create_generator_lead_filter_counts(self, auth):
        # Create saved referral generator
        gen_name = f"TEST_gen_{uuid.uuid4().hex[:6]}"
        s = requests.post(f"{BASE_URL}/api/crm/saved-searches",
                          json={"name": gen_name, "entity": "referral",
                                "query": {"origin": "06510", "radius": {"mode": "mi", "miles": 25}}},
                          headers=auth, timeout=20)
        assert s.status_code == 200
        gid = s.json()["id"]
        assert isinstance(gid, str) and gid

        # Baseline counts (gid should not appear yet)
        c0 = requests.get(f"{BASE_URL}/api/crm/referral-generators/counts", headers=auth, timeout=20).json()
        assert c0.get(gid, 0) == 0

        # Create a lead linked to that generator
        payload = {"org_name": f"TEST_Clinic_{uuid.uuid4().hex[:6]}",
                   "contact_first": "Jane", "contact_last": "Doe",
                   "source": "Referral Search", "referral_generator_id": gid,
                   "referral_generator_name": gen_name, "priority": "Medium"}
        lr = requests.post(f"{BASE_URL}/api/crm/leads", json=payload, headers=auth, timeout=30)
        assert lr.status_code == 200, lr.text
        lead = lr.json()
        assert lead["referral_generator_id"] == gid
        assert lead["referral_generator_name"] == gen_name
        lead_id = lead["id"]

        # Counts now reflects the new lead
        c1 = requests.get(f"{BASE_URL}/api/crm/referral-generators/counts", headers=auth, timeout=20).json()
        assert c1.get(gid, 0) >= 1

        # Filter leads by referral_generator_id
        gl = requests.get(f"{BASE_URL}/api/crm/leads",
                          params={"referral_generator_id": gid, "limit": 100}, headers=auth, timeout=20)
        assert gl.status_code == 200
        ids = [l["id"] for l in gl.json()]
        assert lead_id in ids
        assert all(l.get("referral_generator_id") == gid for l in gl.json())

        # Cleanup
        requests.delete(f"{BASE_URL}/api/crm/saved-searches/{gid}", headers=auth, timeout=20)
