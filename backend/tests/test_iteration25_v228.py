"""BoothIQ v2.28 backend regression tests.

Covers:
  * Scope fix: super_admin sees ALL leads and opportunities
  * Closer Queue filters: closer_id and has_closer
  * Set closer flow (POST /crm/leads/{id}/closer)
  * Archive Bin: archive/restore for leads and opportunities (admin-only)
  * Save Medicare view (POST/GET/DELETE /crm/saved-searches)
  * Territory auto-assign: POST /crm/leads/{id}/route-to-territory (admin-only)
  * Daily digest settings: GET, PUT (admin-only), run
"""
import os
import uuid
import pytest
import requests
from pathlib import Path

# Load REACT_APP_BACKEND_URL from /app/frontend/.env if not in env
def _load_be_url():
    v = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if v:
        return v
    p = Path("/app/frontend/.env")
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

BASE_URL = _load_be_url().rstrip("/")
API = f"{BASE_URL}/api"

SUPER = ("sam@healthandmore.net", "8677")
ADMIN = ("admin@boothiq.com", "482913")
LM = ("leadmanager@boothiq.com", "639201")
AM = ("accountmanager@boothiq.com", "528174")


def _login(email, pin):
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def super_ctx():
    return _login(*SUPER)


@pytest.fixture(scope="module")
def admin_ctx():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def lm_ctx():
    return _login(*LM)


@pytest.fixture(scope="module")
def am_ctx():
    return _login(*AM)


@pytest.fixture(scope="module")
def test_lead(admin_ctx):
    """Create a temp lead for tests. Cleanup by archiving at the end."""
    payload = {
        "org_name": f"ZZTEST v228 {uuid.uuid4().hex[:6]}",
        "contact_first": "Zz",
        "contact_last": "Test",
        "priority": "Medium",
        "source": "TEST",
    }
    r = requests.post(f"{API}/crm/leads", json=payload,
                      headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code in (200, 201), r.text
    lead = r.json()
    yield lead
    # Best-effort cleanup (archive so it doesn't clutter default list)
    try:
        requests.post(f"{API}/crm/leads/{lead['id']}/archive",
                      json={"archived": True}, headers=_hdr(admin_ctx["token"]), timeout=30)
    except Exception:
        pass


# ---------- Scope fix: super_admin sees ALL ----------

def test_super_admin_sees_all_leads(super_ctx, admin_ctx):
    total_admin = requests.get(f"{API}/crm/leads?limit=2000",
                               headers=_hdr(admin_ctx["token"]), timeout=60)
    total_super = requests.get(f"{API}/crm/leads?limit=2000",
                               headers=_hdr(super_ctx["token"]), timeout=60)
    assert total_admin.status_code == 200 and total_super.status_code == 200
    # super_admin must see at least as many as admin (same scope: full org)
    assert len(total_super.json()) == len(total_admin.json()), \
        f"super sees {len(total_super.json())}, admin sees {len(total_admin.json())}"
    assert len(total_super.json()) > 0


def test_super_admin_sees_all_opps(super_ctx, admin_ctx):
    a = requests.get(f"{API}/crm/opportunities?limit=2000",
                     headers=_hdr(admin_ctx["token"]), timeout=60)
    s = requests.get(f"{API}/crm/opportunities?limit=2000",
                     headers=_hdr(super_ctx["token"]), timeout=60)
    assert a.status_code == 200 and s.status_code == 200
    assert len(s.json()) == len(a.json())


# ---------- Closer Queue filters ----------

def test_set_closer_and_has_closer_filter(admin_ctx, lm_ctx, test_lead):
    lead_id = test_lead["id"]
    # who am I (lead_manager id)
    me = requests.get(f"{API}/auth/me", headers=_hdr(lm_ctx["token"]), timeout=15).json()
    lm_id = me["id"]

    # set closer to lead_manager
    r = requests.post(f"{API}/crm/leads/{lead_id}/closer",
                      json={"closer_id": lm_id}, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200, r.text

    # verify closer_name saved
    detail = requests.get(f"{API}/crm/leads/{lead_id}",
                          headers=_hdr(admin_ctx["token"]), timeout=15).json()
    assert detail.get("closer_id") == lm_id
    assert detail.get("closer_name")

    # has_closer=true filter should include this lead
    hc = requests.get(f"{API}/crm/leads?has_closer=true&limit=2000",
                      headers=_hdr(admin_ctx["token"]), timeout=60)
    assert hc.status_code == 200
    ids = {l["id"] for l in hc.json()}
    assert lead_id in ids
    # every returned lead must have a non-empty closer_id
    assert all((l.get("closer_id") or "") != "" for l in hc.json())

    # closer_id=<lm_id> filter — lm should be closer of at least this lead
    cf = requests.get(f"{API}/crm/leads?closer_id={lm_id}&limit=500",
                      headers=_hdr(lm_ctx["token"]), timeout=60)
    assert cf.status_code == 200
    ids2 = {l["id"] for l in cf.json()}
    assert lead_id in ids2
    assert all(l.get("closer_id") == lm_id for l in cf.json())


def test_clear_closer(admin_ctx, test_lead):
    lead_id = test_lead["id"]
    r = requests.post(f"{API}/crm/leads/{lead_id}/closer",
                      json={"closer_id": None}, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200
    detail = requests.get(f"{API}/crm/leads/{lead_id}",
                          headers=_hdr(admin_ctx["token"]), timeout=15).json()
    assert detail.get("closer_id") is None


# ---------- Archive Bin ----------

def test_archive_and_restore_lead(admin_ctx, test_lead):
    lead_id = test_lead["id"]
    # archive
    r = requests.post(f"{API}/crm/leads/{lead_id}/archive",
                      json={"archived": True}, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200
    # appears in archived=true list
    arch = requests.get(f"{API}/crm/leads?archived=true&limit=2000",
                        headers=_hdr(admin_ctx["token"]), timeout=60).json()
    assert lead_id in {l["id"] for l in arch}
    # not in default (non-archived) list
    live = requests.get(f"{API}/crm/leads?limit=2000",
                       headers=_hdr(admin_ctx["token"]), timeout=60).json()
    assert lead_id not in {l["id"] for l in live}
    # restore
    r2 = requests.post(f"{API}/crm/leads/{lead_id}/archive",
                       json={"archived": False}, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r2.status_code == 200
    live2 = requests.get(f"{API}/crm/leads?limit=2000",
                        headers=_hdr(admin_ctx["token"]), timeout=60).json()
    assert lead_id in {l["id"] for l in live2}


def test_am_cannot_archive_lead(am_ctx, test_lead):
    r = requests.post(f"{API}/crm/leads/{test_lead['id']}/archive",
                      json={"archived": True}, headers=_hdr(am_ctx["token"]), timeout=30)
    assert r.status_code == 403


def test_archive_opp(admin_ctx):
    # find any live opp
    opps = requests.get(f"{API}/crm/opportunities?limit=5",
                        headers=_hdr(admin_ctx["token"]), timeout=30).json()
    if not opps:
        pytest.skip("No opportunities available for archive test")
    opp_id = opps[0]["id"]
    # archive
    r = requests.post(f"{API}/crm/opportunities/{opp_id}/archive",
                      json={"archived": True}, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200
    arch = requests.get(f"{API}/crm/opportunities?archived=true&limit=500",
                        headers=_hdr(admin_ctx["token"]), timeout=30).json()
    assert opp_id in {o["id"] for o in arch}
    # restore
    r2 = requests.post(f"{API}/crm/opportunities/{opp_id}/archive",
                       json={"archived": False}, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r2.status_code == 200


# ---------- Save Medicare View ----------

def test_saved_search_crud_medicare(am_ctx):
    name = f"ZZTEST view {uuid.uuid4().hex[:6]}"
    query = {"mode": "simple", "states": ["CA"], "cities": ["LOS ANGELES"],
             "tiers": ["GREEN"], "dataset_year": 2024}
    r = requests.post(f"{API}/crm/saved-searches",
                      json={"name": name, "entity": "medicare", "query": query},
                      headers=_hdr(am_ctx["token"]), timeout=30)
    assert r.status_code in (200, 201), r.text
    sid = r.json()["id"]
    assert r.json()["name"] == name
    assert r.json()["entity"] == "medicare"

    # list
    lst = requests.get(f"{API}/crm/saved-searches?entity=medicare",
                       headers=_hdr(am_ctx["token"]), timeout=30).json()
    assert sid in {s["id"] for s in lst}
    got = next(s for s in lst if s["id"] == sid)
    assert got["query"]["states"] == ["CA"]

    # delete
    d = requests.delete(f"{API}/crm/saved-searches/{sid}",
                        headers=_hdr(am_ctx["token"]), timeout=30)
    assert d.status_code == 200
    lst2 = requests.get(f"{API}/crm/saved-searches?entity=medicare",
                        headers=_hdr(am_ctx["token"]), timeout=30).json()
    assert sid not in {s["id"] for s in lst2}


# ---------- Territory Auto-Assign ----------

def test_route_to_territory_400_when_no_territory(admin_ctx, test_lead):
    # test_lead has no territory
    r = requests.post(f"{API}/crm/leads/{test_lead['id']}/route-to-territory",
                      headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 400, r.text


def test_route_to_territory_admin_only(am_ctx, test_lead):
    r = requests.post(f"{API}/crm/leads/{test_lead['id']}/route-to-territory",
                      headers=_hdr(am_ctx["token"]), timeout=30)
    assert r.status_code == 403


def test_route_to_territory_happy_path(admin_ctx, test_lead):
    """If a territory exists and is linked to a team with members, admin can route."""
    terrs = requests.get(f"{API}/crm/territories",
                         headers=_hdr(admin_ctx["token"]), timeout=30)
    if terrs.status_code != 200 or not terrs.json():
        pytest.skip("No territories configured")
    # pick a territory linked to a team with members
    for t in terrs.json():
        if not t.get("team_id"):
            continue
        # set territory on the lead
        r = requests.post(f"{API}/crm/leads/{test_lead['id']}/assign",
                          json={"territory_id": t["id"]},
                          headers=_hdr(admin_ctx["token"]), timeout=30)
        if r.status_code != 200:
            continue
        # route
        rr = requests.post(f"{API}/crm/leads/{test_lead['id']}/route-to-territory",
                           headers=_hdr(admin_ctx["token"]), timeout=30)
        if rr.status_code == 200:
            data = rr.json()
            assert data.get("ok") is True
            assert data.get("account_manager_id")
            assert "team_name" in data
            return
    pytest.skip("No territory with a team+members found — non-blocking")


# ---------- Digest Settings ----------

def test_digest_settings_get(admin_ctx):
    r = requests.get(f"{API}/crm/notifications/digest/settings",
                     headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200
    d = r.json()
    for k in ("enabled", "hour", "minute", "tz"):
        assert k in d


def test_digest_settings_put_admin_only(admin_ctx, lm_ctx):
    payload = {"enabled": True, "hour": 9, "minute": 15, "tz": "America/New_York"}
    r = requests.put(f"{API}/crm/notifications/digest/settings",
                     json=payload, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["hour"] == 9 and got["minute"] == 15 and got["tz"] == "America/New_York"
    # verify persistence via GET
    g = requests.get(f"{API}/crm/notifications/digest/settings",
                     headers=_hdr(admin_ctx["token"]), timeout=30).json()
    assert g["hour"] == 9 and g["minute"] == 15

    # lead_manager PUT should 403
    r2 = requests.put(f"{API}/crm/notifications/digest/settings",
                      json=payload, headers=_hdr(lm_ctx["token"]), timeout=30)
    assert r2.status_code == 403

    # lead_manager GET should work
    r3 = requests.get(f"{API}/crm/notifications/digest/settings",
                      headers=_hdr(lm_ctx["token"]), timeout=30)
    assert r3.status_code == 200


def test_digest_settings_invalid_tz_falls_back(admin_ctx):
    payload = {"enabled": True, "hour": 10, "minute": 0, "tz": "Not/AZone"}
    r = requests.put(f"{API}/crm/notifications/digest/settings",
                     json=payload, headers=_hdr(admin_ctx["token"]), timeout=30)
    assert r.status_code == 200
    assert r.json()["tz"] != "Not/AZone"


def test_digest_send_now(admin_ctx):
    r = requests.post(f"{API}/crm/notifications/digest/run?window_hours=24",
                      headers=_hdr(admin_ctx["token"]), timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert "reps_notified" in d and "total_leads" in d
