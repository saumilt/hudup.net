"""Backend regression for BoothIQ v2.29 (Closer alert + Digest preview + Territory Rebalance).
Validates:
 - POST /api/crm/leads/{id}/closer sets/clears closer, non-blocking push, returns {ok, closer_name}
 - GET  /api/crm/notifications/digest/preview: lead_manager 200, account_manager 403, shape
 - POST /api/crm/leads/route-by-territory: MANAGER; routes NY lead to East team, skips no-state
 - Regression: creating a lead still auto-routes (territory match OR creator fallback)
"""
import os
import uuid
import pytest
import requests

def _read_env_file():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    return None


BASE = os.environ.get("REACT_APP_BACKEND_URL") or _read_env_file()
assert BASE, "REACT_APP_BACKEND_URL not available"
BASE = BASE.rstrip("/")


def _login(email: str, pin: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "pin": pin}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def lm_headers():
    return {"Authorization": f"Bearer {_login('fatema@healthandmore.net', '125148')}"}


@pytest.fixture(scope="module")
def am_headers():
    return {"Authorization": f"Bearer {_login('accountmanager@boothiq.com', '528174')}"}


@pytest.fixture(scope="module")
def admin_headers():
    # super_admin so we can archive/cleanup ZZTEST leads
    return {"Authorization": f"Bearer {_login('sam@healthandmore.net', '8677')}"}


@pytest.fixture(scope="module")
def created_leads(admin_headers):
    ids = []
    yield ids
    for lid in ids:
        try:
            requests.post(f"{BASE}/api/crm/leads/{lid}/archive",
                          headers=admin_headers, json={"archived": True}, timeout=15)
        except Exception:
            pass


# ---- (1) Closer Handoff Alert ----
def test_closer_set_and_clear(lm_headers, admin_headers, created_leads):
    # Create ZZTEST lead as manager (admin) so we have something to set closer on
    payload = {"org_name": f"ZZTEST v229 closer {uuid.uuid4().hex[:6]}",
               "contact_first": "Zed", "contact_last": "Test",
               "state": "NY"}
    r = requests.post(f"{BASE}/api/crm/leads", headers=admin_headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    lead = r.json()
    lid = lead["id"]
    created_leads.append(lid)

    # Find a lead_manager id to be the closer (Fatema)
    me = requests.get(f"{BASE}/api/auth/me", headers=lm_headers, timeout=15).json()
    fatema_id = me["id"]

    # Set closer = Fatema
    r = requests.post(f"{BASE}/api/crm/leads/{lid}/closer",
                      headers=admin_headers, json={"closer_id": fatema_id}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("closer_name")  # should be Fatema's name

    # Verify persisted via list
    r = requests.get(f"{BASE}/api/crm/leads?has_closer=true&limit=500",
                     headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    ids = [x["id"] for x in (data if isinstance(data, list) else data.get("leads", []))]
    assert lid in ids

    # Clear closer
    r = requests.post(f"{BASE}/api/crm/leads/{lid}/closer",
                      headers=admin_headers, json={"closer_id": None}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("closer_name") in (None, "")


# ---- (2) Digest Preview ----
def test_digest_preview_lead_manager(lm_headers):
    r = requests.get(f"{BASE}/api/crm/notifications/digest/preview?window_hours=720",
                     headers=lm_headers, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(["window_hours", "total_leads", "reps"]).issubset(body.keys())
    assert body["window_hours"] == 720
    assert isinstance(body["reps"], list)
    if body["reps"]:
        rep = body["reps"][0]
        for k in ("rep_id", "rep_name", "email", "count", "leads"):
            assert k in rep, f"missing {k} in rep"


def test_digest_preview_account_manager_forbidden(am_headers):
    r = requests.get(f"{BASE}/api/crm/notifications/digest/preview",
                     headers=am_headers, timeout=20)
    assert r.status_code == 403, r.text


# ---- (3) Territory Rebalance Now ----
def test_route_by_territory(admin_headers, created_leads):
    # Create one UNASSIGNED lead in NY (East team territory per curl verification)
    ny_payload = {"org_name": f"ZZTEST v229 rebalance NY {uuid.uuid4().hex[:6]}",
                  "contact_first": "Ny", "contact_last": "Test",
                  "state": "NY",
                  "account_manager_id": None}  # ensure unassigned
    r = requests.post(f"{BASE}/api/crm/leads", headers=admin_headers, json=ny_payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    ny_lead = r.json()
    ny_id = ny_lead["id"]
    created_leads.append(ny_id)

    # And one with no state
    nostate_payload = {"org_name": f"ZZTEST v229 rebalance nostate {uuid.uuid4().hex[:6]}",
                       "contact_first": "No", "contact_last": "State",
                       "account_manager_id": None}
    r = requests.post(f"{BASE}/api/crm/leads", headers=admin_headers,
                      json=nostate_payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    ns_lead = r.json()
    ns_id = ns_lead["id"]
    created_leads.append(ns_id)

    # Since auto_route_lead already routed the NY lead to its territory team on create,
    # forcibly unassign both leads directly in mongo before the rebalance test.
    import motor.motor_asyncio
    import asyncio

    async def _unassign(ids):
        mc = motor.motor_asyncio.AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        d = mc[os.environ.get("DB_NAME", "test_database")]
        for lid in ids:
            await d.crm_leads.update_one({"id": lid},
                                         {"$set": {"account_manager_id": None,
                                                   "team_id": None,
                                                   "routing_reason": None}})
        mc.close()

    asyncio.get_event_loop().run_until_complete(_unassign([ny_id, ns_id]))

    # Fire rebalance
    r = requests.post(f"{BASE}/api/crm/leads/route-by-territory",
                      headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert "routed" in body and "skipped" in body and "by_team" in body
    assert isinstance(body["by_team"], dict)

    # Verify NY lead now has an AM
    r = requests.get(f"{BASE}/api/crm/leads/{ny_id}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    ny_after = r.json()
    assert ny_after.get("account_manager_id"), "NY lead should be routed to a territory team member"
    assert (ny_after.get("routing_reason") or "").lower().startswith("territory rebalance")

    # Verify no-state lead stays unassigned
    r = requests.get(f"{BASE}/api/crm/leads/{ns_id}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    ns_after = r.json()
    assert not ns_after.get("account_manager_id"), "no-state lead should stay unassigned"


def test_route_by_territory_forbidden_for_account_manager(am_headers):
    r = requests.post(f"{BASE}/api/crm/leads/route-by-territory",
                      headers=am_headers, timeout=15)
    assert r.status_code == 403, r.text


# ---- (4) Regression: creating a lead still auto-routes ----
def test_create_lead_auto_routes(admin_headers, created_leads):
    payload = {"org_name": f"ZZTEST v229 autoroute NY {uuid.uuid4().hex[:6]}",
               "contact_first": "Auto", "contact_last": "Route",
               "state": "NY"}
    r = requests.post(f"{BASE}/api/crm/leads", headers=admin_headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    lead = r.json()
    created_leads.append(lead["id"])
    # Should have either territory match OR manual→creator assignment
    r = requests.get(f"{BASE}/api/crm/leads/{lead['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    fetched = r.json()
    assert fetched.get("account_manager_id"), "creating a lead should auto-route"
