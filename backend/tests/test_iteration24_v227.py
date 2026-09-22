"""v2.27 tests — See All Leads, Closer on Lead, Medicare multi-filter, Admin archive."""
import os
import pytest
import requests
from pathlib import Path


def _load_env():
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


_load_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@boothiq.com", "pin": "482913"}
AM = {"email": "accountmanager@boothiq.com", "pin": "528174"}
LM = {"email": "leadmanager@boothiq.com", "pin": "639201"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)["token"]


@pytest.fixture(scope="module")
def am_token():
    return _login(AM)["token"]


@pytest.fixture(scope="module")
def lm_data():
    return _login(LM)


@pytest.fixture(scope="module")
def am_data():
    return _login(AM)


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- P1: SEE ALL LEADS ----------
class TestSeeAllLeads:
    def test_am_sees_all_leads_default_excludes_archived(self, am_token):
        r = requests.get(f"{API}/crm/leads?limit=500", headers=H(am_token), timeout=60)
        assert r.status_code == 200, r.text[:200]
        leads = r.json()
        assert isinstance(leads, list)
        assert len(leads) > 50, f"AM should see all leads (got {len(leads)})"
        # None should be archived by default
        assert not any(l.get("archived") is True for l in leads)

    def test_city_filter(self, am_token):
        # Pick a city that exists
        r = requests.get(f"{API}/crm/leads?limit=500", headers=H(am_token), timeout=60)
        leads = [l for l in r.json() if l.get("city")]
        assert leads, "no leads have city"
        city = leads[0]["city"]
        r2 = requests.get(f"{API}/crm/leads?city={city}", headers=H(am_token), timeout=60)
        assert r2.status_code == 200
        got = r2.json()
        assert got, "city filter returned zero"
        assert all(city.lower() in (l.get("city") or "").lower() for l in got)

    def test_assigned_rep_filter(self, am_token):
        r = requests.get(f"{API}/crm/leads?limit=500", headers=H(am_token), timeout=60)
        leads = [l for l in r.json() if l.get("account_manager_id")]
        assert leads
        am_id = leads[0]["account_manager_id"]
        r2 = requests.get(f"{API}/crm/leads?account_manager_id={am_id}", headers=H(am_token), timeout=60)
        assert r2.status_code == 200
        got = r2.json()
        assert got
        assert all(l.get("account_manager_id") == am_id for l in got)

    def test_archived_only_query(self, am_token):
        r = requests.get(f"{API}/crm/leads?archived=true&limit=500", headers=H(am_token), timeout=60)
        assert r.status_code == 200
        # every returned lead must be archived
        assert all(l.get("archived") is True for l in r.json())


# ---------- P2: CLOSER ON LEAD ----------
class TestCloserAndCollaborators:
    @pytest.fixture(scope="class")
    def test_lead(self, am_token, am_data):
        payload = {"org_name": "TEST_v227 Closer Lead", "contact_first": "T", "contact_last": "Closer",
                   "source": "Manual Entry", "priority": "Medium", "state": "CA", "city": "TestCity"}
        r = requests.post(f"{API}/crm/leads", headers=H(am_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text[:200]
        return r.json()

    def test_am_can_set_closer(self, am_token, lm_data, test_lead):
        closer_id = lm_data["user"]["id"]
        r = requests.post(f"{API}/crm/leads/{test_lead['id']}/closer",
                          headers=H(am_token), json={"closer_id": closer_id}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("closer_name")
        # Verify persisted
        r2 = requests.get(f"{API}/crm/leads/{test_lead['id']}", headers=H(am_token), timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("closer_id") == closer_id
        assert r2.json().get("closer_name")

    def test_am_can_clear_closer(self, am_token, test_lead):
        r = requests.post(f"{API}/crm/leads/{test_lead['id']}/closer",
                          headers=H(am_token), json={"closer_id": None}, timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/crm/leads/{test_lead['id']}", headers=H(am_token), timeout=30)
        assert r2.json().get("closer_id") in (None, "")
        assert r2.json().get("closer_name") in (None, "")

    def test_am_cannot_use_manager_assign(self, am_token, test_lead):
        # Assign endpoint is MANAGER only — should 403 for AM
        r = requests.post(f"{API}/crm/leads/{test_lead['id']}/assign",
                          headers=H(am_token), json={"collaboration_mode": "both"}, timeout=30)
        assert r.status_code == 403, f"AM must not access manager-only assign: {r.status_code}"

    def test_manager_can_set_collaborators_mode_territory(self, admin_token, am_token, am_data, test_lead):
        # login as lead_manager (or admin) for MANAGER-scoped endpoint
        # Note: assign_lead requires ROLE_LEAD_MANAGER (admin is not in MANAGER)
        lm_token = _login(LM)["token"]
        # Ensure a territory exists — try fetching territories
        terr_id = None
        rt = requests.get(f"{API}/crm/territories", headers=H(lm_token), timeout=30)
        if rt.status_code == 200 and isinstance(rt.json(), list) and rt.json():
            terr_id = rt.json()[0].get("id")
        collab = am_data["user"]["id"]
        payload = {"collaborator_ids": [collab], "collaboration_mode": "both"}
        if terr_id:
            payload["territory_id"] = terr_id
        r = requests.post(f"{API}/crm/leads/{test_lead['id']}/assign",
                          headers=H(lm_token), json=payload, timeout=30)
        assert r.status_code == 200, f"manager assign failed: {r.status_code} {r.text[:200]}"
        r2 = requests.get(f"{API}/crm/leads/{test_lead['id']}", headers=H(lm_token), timeout=30)
        d = r2.json()
        assert d.get("collaboration_mode") == "both"
        assert collab in (d.get("collaborator_ids") or [])
        assert d.get("collaborator_names")
        if terr_id:
            assert d.get("territory_id") == terr_id
            assert d.get("territory_name")

    def test_note_add_still_works_for_am(self, am_token, test_lead):
        r = requests.post(f"{API}/crm/leads/{test_lead['id']}/notes",
                          headers=H(am_token), json={"text": "TEST_v227 note"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("id")


# ---------- P3: MEDICARE MULTI-FILTER ----------
class TestMedicareMultiFilter:
    def test_am_can_get_states(self, am_token):
        r = requests.get(f"{API}/medicare/states?dataset_year=2024", headers=H(am_token), timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("states"), list)
        assert len(d["states"]) > 10

    def test_cities_cascade(self, am_token):
        r = requests.get(f"{API}/medicare/cities?states=CA,TX&dataset_year=2024", headers=H(am_token), timeout=90)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("cities"), list)
        assert len(d["cities"]) > 5

    def test_multi_state_multi_tier_search(self, am_token):
        payload = {"dataset_year": 2024, "states": ["CA", "TX"],
                   "tiers": ["GREEN", "YELLOW"], "page": 1, "page_size": 5}
        r = requests.post(f"{API}/medicare/search", headers=H(am_token), json=payload, timeout=60)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d.get("total", 0) > 0
        for row in d["results"]:
            assert row["state"] in ("CA", "TX")
            assert row["tier_340b"] in ("GREEN", "YELLOW")

    def test_legacy_singular_fallback(self, am_token):
        # No states[] provided — fall back to state singular
        payload = {"dataset_year": 2024, "state": "CA", "tier_340b": "GREEN",
                   "page": 1, "page_size": 3}
        r = requests.post(f"{API}/medicare/search", headers=H(am_token), json=payload, timeout=60)
        assert r.status_code == 200
        for row in r.json()["results"]:
            assert row["state"] == "CA"
            assert row["tier_340b"] == "GREEN"


# ---------- ADMIN ARCHIVE ----------
class TestAdminArchive:
    @pytest.fixture(scope="class")
    def arch_lead(self, admin_token):
        payload = {"org_name": "TEST_v227 Archive Lead", "source": "Manual Entry", "state": "CA"}
        r = requests.post(f"{API}/crm/leads", headers=H(admin_token), json=payload, timeout=30)
        assert r.status_code == 200
        return r.json()

    def test_am_cannot_archive_lead(self, am_token, arch_lead):
        r = requests.post(f"{API}/crm/leads/{arch_lead['id']}/archive",
                          headers=H(am_token), json={"archived": True}, timeout=30)
        assert r.status_code == 403, f"AM must not archive: {r.status_code}"

    def test_admin_archive_lead_and_excluded_from_default(self, admin_token, arch_lead):
        r = requests.post(f"{API}/crm/leads/{arch_lead['id']}/archive",
                          headers=H(admin_token), json={"archived": True}, timeout=30)
        assert r.status_code == 200
        # default list must not include it
        r2 = requests.get(f"{API}/crm/leads?limit=1000", headers=H(admin_token), timeout=60)
        assert arch_lead["id"] not in [l["id"] for l in r2.json()]
        # archived=true must include it
        r3 = requests.get(f"{API}/crm/leads?archived=true&limit=1000", headers=H(admin_token), timeout=60)
        assert arch_lead["id"] in [l["id"] for l in r3.json()]

    def test_admin_unarchive_lead(self, admin_token, arch_lead):
        r = requests.post(f"{API}/crm/leads/{arch_lead['id']}/archive",
                          headers=H(admin_token), json={"archived": False}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("archived") is False

    def test_admin_archive_opportunity(self, admin_token, am_token):
        # Create a lead + convert to opp as admin
        lp = {"org_name": "TEST_v227 Opp Src", "source": "Manual Entry", "state": "CA"}
        rl = requests.post(f"{API}/crm/leads", headers=H(admin_token), json=lp, timeout=30)
        lead = rl.json()
        rc = requests.post(f"{API}/crm/leads/{lead['id']}/convert",
                           headers=H(admin_token), json={"name": "TEST_v227 Opp", "value": 1000}, timeout=30)
        assert rc.status_code == 200
        opp = rc.json()
        # AM cannot archive
        ra = requests.post(f"{API}/crm/opportunities/{opp['id']}/archive",
                           headers=H(am_token), json={"archived": True}, timeout=30)
        assert ra.status_code == 403
        # Admin archives
        rok = requests.post(f"{API}/crm/opportunities/{opp['id']}/archive",
                            headers=H(admin_token), json={"archived": True}, timeout=30)
        assert rok.status_code == 200
        # Default list must exclude
        rlst = requests.get(f"{API}/crm/opportunities?limit=500", headers=H(admin_token), timeout=60)
        assert opp["id"] not in [o["id"] for o in rlst.json()]
        # archived=true must include
        rlst2 = requests.get(f"{API}/crm/opportunities?archived=true&limit=500",
                             headers=H(admin_token), timeout=60)
        assert opp["id"] in [o["id"] for o in rlst2.json()]
        # PATCH name/value/stage/close_date
        rp = requests.patch(f"{API}/crm/opportunities/{opp['id']}",
                            headers=H(admin_token),
                            json={"name": "TEST_v227 Opp Renamed", "value": 2500,
                                  "stage": "Proposal", "close_date": "2026-08-01"}, timeout=30)
        assert rp.status_code == 200, rp.text[:200]
        d = rp.json()
        assert d.get("name") == "TEST_v227 Opp Renamed"
        assert d.get("value") == 2500
        assert d.get("stage") == "Proposal"
        assert d.get("close_date") == "2026-08-01"
        # Cleanup — unarchive so it's discoverable
        requests.post(f"{API}/crm/opportunities/{opp['id']}/archive",
                      headers=H(admin_token), json={"archived": False}, timeout=30)
