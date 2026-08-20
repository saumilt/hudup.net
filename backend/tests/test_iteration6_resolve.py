"""Iteration 6 — kiosk name-resolution picker + regression on kiosk leads privacy."""
import os
import time
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://prize-wheel-hub-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# --- resolve endpoint ---

def test_resolve_returns_candidates_adams_ga_m():
    r = requests.post(f"{API}/kiosk/resolve", json={"last_name": "Adams", "state": "GA", "first_initial": "M"})
    assert r.status_code == 200
    d = r.json()
    assert d["too_many"] is False
    assert isinstance(d["candidates"], list)
    assert 2 <= len(d["candidates"]) <= 12
    # Every candidate must expose the picker card fields.
    for c in d["candidates"]:
        for k in ("npi", "first_name", "last_name", "city", "specialty"):
            assert k in c, f"missing {k} in candidate"
    # Sanity: Michael Adams (Savannah) is in this list.
    npis = [c["npi"] for c in d["candidates"]]
    assert "1932157880" in npis


def test_resolve_returns_candidates_adams_fl_m():
    r = requests.post(f"{API}/kiosk/resolve", json={"last_name": "Adams", "state": "FL", "first_initial": "M"})
    assert r.status_code == 200
    d = r.json()
    assert d["too_many"] is False
    assert 2 <= len(d["candidates"]) <= 12


def test_resolve_too_many_when_common():
    r = requests.post(f"{API}/kiosk/resolve", json={"last_name": "Smith", "state": "CA", "first_initial": "J"})
    assert r.status_code == 200
    d = r.json()
    assert d["too_many"] is True
    assert d["candidates"] == []
    assert d.get("count", 0) > 12


def test_resolve_case_insensitive():
    r = requests.post(f"{API}/kiosk/resolve", json={"last_name": "adams", "state": "ga", "first_initial": "m"})
    assert r.status_code == 200
    assert len(r.json()["candidates"]) > 0


# --- privacy regression on kiosk leads ---

def test_kiosk_leads_response_privacy_shape():
    payload = {
        "first_name": "TEST_Michael",
        "last_name": "Adams",
        "phone": "9519565431",
        "email": "",
        "npi": "1932157880",
        "practice": "TEST Practice",
        "practice_type": "Private Practice",
        "city": "Savannah",
        "state": "GA",
        "specialty": "General Surgery",
        "interests": ["340B Program"],
        "contact_consent": True,
        "sms_consent": True,
        "consent_text": "TEST",
        "device_id": None,
        "event_id": "default",
        "client_created_at": None,
    }
    r = requests.post(f"{API}/kiosk/leads", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    # ONLY id and spin_available may be present. No score/tier/dollar/medicare leak.
    assert set(body.keys()) == {"id", "spin_available"}, f"kiosk response leaks fields: {body.keys()}"
    assert body["spin_available"] is True
    assert isinstance(body["id"], str) and len(body["id"]) > 10
    forbidden = ("tier", "score", "avg_per_claim", "medicare", "tot_cost", "tot_clms", "color", "shade")
    dumped = str(body).lower()
    for f in forbidden:
        assert f not in dumped, f"forbidden field '{f}' leaked: {body}"


def test_end_to_end_matched_lead_via_npi_selected_from_picker():
    # 1) Resolve picker for Adams/GA/M
    r = requests.post(f"{API}/kiosk/resolve", json={"last_name": "Adams", "state": "GA", "first_initial": "M"})
    assert r.status_code == 200
    cands = r.json()["candidates"]
    assert cands, "expected candidates"
    chosen = next((c for c in cands if c["first_name"].lower().startswith("michael")), cands[0])
    # 2) Create lead using selected candidate's NPI (simulates picker selection)
    payload = {
        "first_name": "TEST_Michael",
        "last_name": "Adams",
        "phone": "9519565431",
        "email": "",
        "npi": chosen["npi"],
        "practice": "TEST_Practice",
        "practice_type": "Private Practice",
        "city": chosen["city"],
        "state": "GA",
        "specialty": chosen["specialty"],
        "interests": ["340B Program"],
        "contact_consent": True,
        "sms_consent": True,
        "consent_text": "TEST",
        "device_id": None,
        "event_id": "default",
        "client_created_at": None,
    }
    lr = requests.post(f"{API}/kiosk/leads", json=payload)
    assert lr.status_code == 200
    lead_id = lr.json()["id"]
    # 3) Login as admin to look up the lead
    auth = requests.post(f"{API}/auth/login", json={"email": "admin@boothiq.com", "pin": "482913"})
    assert auth.status_code == 200, auth.text
    token = auth.json()["token"]
    time.sleep(0.5)
    dr = requests.get(f"{API}/dashboard/leads", headers={"Authorization": f"Bearer {token}"})
    assert dr.status_code == 200
    leads = dr.json() if isinstance(dr.json(), list) else dr.json().get("leads", [])
    ours = next((x for x in leads if x.get("id") == lead_id), None)
    assert ours is not None, "created lead not found in dashboard feed"
    # match_status confirmed/probable and tiers not GREY
    assert ours["match_status"] in ("confirmed", "probable"), ours.get("match_status")
    assert ours["npi"] == chosen["npi"]
    assert ours["tier_340b"] != "GREY" or ours["tier_rpm"] != "GREY"


def test_kiosk_spin_one_spin_enforcement():
    # create a fresh lead
    payload = {
        "first_name": "TEST_Spinner",
        "last_name": "Adams",
        "phone": "9519565431",
        "email": "",
        "state": "GA",
        "specialty": "Family Practice",
        "practice_type": "Private Practice",
        "interests": [],
        "contact_consent": True,
        "sms_consent": True,
        "consent_text": "TEST",
        "event_id": "default",
    }
    r = requests.post(f"{API}/kiosk/leads", json=payload)
    assert r.status_code == 200
    lead_id = r.json()["id"]
    s1 = requests.post(f"{API}/kiosk/leads/{lead_id}/spin")
    assert s1.status_code == 200
    j1 = s1.json()
    assert "prize" in j1
    s2 = requests.post(f"{API}/kiosk/leads/{lead_id}/spin")
    j2 = s2.json()
    assert j2.get("error") == "already_spun"
