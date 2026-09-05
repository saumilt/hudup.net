"""Iteration 19 — v2.19 backend validation.
Covers: (1) PATCH /api/crm/leads/{id} extended fields, (2) GET /api/users?roles=csv,
(3) POST /api/imports/{id}/mapping distribute='person' + assignee_id (lead_manager Ankit),
(4) claim-count reconciliation from Medicare during import execute."""
import os
import io
import time
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

def _load_frontend_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()).rstrip("/")
API = BASE_URL + "/api"


def _login(email, pin):
    r = requests.post(f"{API}/auth/login", json={"email": email, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def lm_headers():
    return {"Authorization": f"Bearer {_login('leadmanager@boothiq.com', '639201')}"}


@pytest.fixture(scope="module")
def am_headers():
    return {"Authorization": f"Bearer {_login('accountmanager@boothiq.com', '528174')}"}


@pytest.fixture(scope="module")
def ad_headers():
    return {"Authorization": f"Bearer {_login('admin@boothiq.com', '482913')}"}


# ---------- (1) LeadPatch extended fields ----------
class TestLeadPatchExtended:
    def test_patch_new_fields_persist_and_state_uppercased(self, lm_headers):
        # Create a lead first
        create = requests.post(f"{API}/crm/leads", headers=lm_headers, json={
            "org_name": "TEST_v219 Patch Org",
            "contact_first": "Old", "contact_last": "Name",
            "specialty": "General", "city": "Old City", "state": "ny"
        }, timeout=15)
        assert create.status_code == 200, create.text
        lead = create.json()
        lid = lead["id"]
        # PATCH the new fields
        patch_body = {
            "contact_first": "TEST_First",
            "contact_last": "TEST_Last",
            "specialty": "Cardiology",
            "city": "San Diego",
            "state": "ca",  # must be uppercased
            "org_name": "TEST_v219 Patch Org Updated",
            "phone": "+15551239999",
            "email": "TEST_v219patch@example.com",
            "priority": "High",
        }
        r = requests.patch(f"{API}/crm/leads/{lid}", headers=lm_headers, json=patch_body, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["contact_first"] == "TEST_First"
        assert body["contact_last"] == "TEST_Last"
        assert body["specialty"] == "Cardiology"
        assert body["city"] == "San Diego"
        assert body["state"] == "CA", f"state not uppercased: {body.get('state')}"
        # GET verifies persistence
        g = requests.get(f"{API}/crm/leads/{lid}", headers=lm_headers, timeout=15)
        assert g.status_code == 200
        gb = g.json()
        assert gb["contact_first"] == "TEST_First"
        assert gb["contact_last"] == "TEST_Last"
        assert gb["specialty"] == "Cardiology"
        assert gb["city"] == "San Diego"
        assert gb["state"] == "CA"
        assert gb["org_name"] == "TEST_v219 Patch Org Updated"
        assert gb["phone"] == "+15551239999"
        assert gb["email"] == "TEST_v219patch@example.com"
        assert gb["priority"] == "High"
        # Cleanup
        pytest.LID_PATCH = lid  # store for later cleanup if needed


# ---------- (2) /users?roles= ----------
class TestUsersRolesFilter:
    def test_roles_csv_returns_multiple_roles(self, lm_headers):
        r = requests.get(f"{API}/users?roles=account_manager,lead_manager,admin,super_admin",
                         headers=lm_headers, timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()
        roles = {u["role"] for u in users}
        # Must include at least a lead_manager and account_manager and admin
        assert "lead_manager" in roles, f"lead_manager missing from {roles}"
        assert "account_manager" in roles, f"account_manager missing from {roles}"
        assert "admin" in roles or "super_admin" in roles, f"no admin/super_admin in {roles}"
        # Must NOT include unrelated roles like 'staff' only
        assert "staff" not in roles, "staff role leaked into roles=am,lm,admin,super_admin"

    def test_single_role_param_still_works(self, lm_headers):
        r = requests.get(f"{API}/users?role=lead_manager", headers=lm_headers, timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert all(u["role"] == "lead_manager" for u in users), f"non-LM leaked: {users}"
        assert len(users) >= 1

    def test_ankit_and_pratik_in_lm_admin_pool(self, lm_headers):
        r = requests.get(f"{API}/users?roles=account_manager,lead_manager,admin,super_admin",
                         headers=lm_headers, timeout=15)
        assert r.status_code == 200
        emails = {u["email"] for u in r.json()}
        # These are supposed to be selectable as assignees per v2.19
        # Ankit could be ankit@healthandmore.net (LM per problem statement) — check either domain
        ankit_present = any("ankit@" in e for e in emails)
        pratik_present = any("pratik@" in e for e in emails)
        assert ankit_present, f"No Ankit user found in pool. Emails: {sorted(emails)}"
        assert pratik_present, f"No Pratik user found in pool. Emails: {sorted(emails)}"


# ---------- Helpers to find an unused Medicare NPI ----------
async def _find_unused_medicare_npi():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    used = set(await db.crm_leads.distinct("matched_npi"))
    async for p in db.physicians.find({"tot_clms": {"$gt": 0}}, {"_id": 0, "npi": 1, "tot_clms": 1}).limit(200):
        npi = p.get("npi")
        if npi and npi not in used:
            client.close()
            return npi, int(p.get("tot_clms") or 0)
    client.close()
    return None, None


@pytest.fixture(scope="module")
def unused_medicare_npi():
    import asyncio
    npi, tot = asyncio.get_event_loop().run_until_complete(_find_unused_medicare_npi())
    if not npi:
        pytest.skip("No unused Medicare NPI available for import test")
    return npi, tot


# ---------- (3) & (4) Import: person-assign to lead_manager + claim reconciliation ----------
class TestImportPersonAssignAndReconcile:
    def _find_ankit_lead_manager(self, lm_headers):
        r = requests.get(f"{API}/users?role=lead_manager", headers=lm_headers, timeout=15)
        assert r.status_code == 200
        for u in r.json():
            if "ankit" in u["email"].lower():
                return u
        # Fallback to any lead_manager
        users = r.json()
        return users[0] if users else None

    def test_import_person_assigns_to_lead_manager_and_reconciles_claim(
            self, lm_headers, unused_medicare_npi):
        npi, medicare_tot = unused_medicare_npi
        # Choose a wrong "imported" total-claims number that differs from Medicare
        import_wrong_tot = medicare_tot + 100 if medicare_tot else 555
        assert import_wrong_tot != medicare_tot

        ankit = self._find_ankit_lead_manager(lm_headers)
        assert ankit, "No lead_manager available to assign to"

        # Build CSV
        csv_content = (
            "NPI,Organization,First,Last,Total Claims,Avg Per Claim\n"
            f"{npi},TEST_v219 Imported Practice,TEST_ImportFirst,TEST_ImportLast,"
            f"{import_wrong_tot},99.5\n"
        )
        files = {"file": ("test_v219_import.csv", csv_content.encode("utf-8"), "text/csv")}
        # 1. Upload
        r = requests.post(f"{API}/imports", headers=lm_headers,
                          files=files, data={"dataset_type": "lead"}, timeout=30)
        assert r.status_code == 200, r.text
        import_id = r.json()["import_id"]

        # 2. Analyze (get suggested mapping)
        r = requests.post(f"{API}/imports/{import_id}/analyze", headers=lm_headers, timeout=60)
        assert r.status_code == 200, r.text

        # 3. Set explicit mapping: NPI, Organization, First, Last as fields; Total Claims + Avg Per Claim as notes
        mapping = {
            "NPI": "npi",
            "Organization": "org_name",
            "First": "contact_first",
            "Last": "contact_last",
            "Total Claims": "notes",
            "Avg Per Claim": "notes",
        }
        r = requests.post(f"{API}/imports/{import_id}/mapping", headers=lm_headers, json={
            "mapping": mapping, "rule": "safe", "source": "TEST_v219 Import",
            "distribute": "person", "assignee_id": ankit["id"],
        }, timeout=15)
        assert r.status_code == 200, r.text

        # 4. Validate
        r = requests.post(f"{API}/imports/{import_id}/validate", headers=lm_headers, timeout=30)
        assert r.status_code == 200, r.text

        # 5. Execute
        r = requests.post(f"{API}/imports/{import_id}/execute", headers=lm_headers, timeout=60)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts.get("created", 0) >= 1, f"expected >=1 created, got {counts}"

        # 6. Verify assignment + reconciliation via GET on created lead
        # Find lead by matched_npi
        time.sleep(1)
        g = requests.get(f"{API}/crm/leads?q={npi}", headers=lm_headers, timeout=15)
        assert g.status_code == 200
        matches = [l for l in g.json() if l.get("matched_npi") == npi]
        assert matches, f"created lead with npi={npi} not found in list"
        lead_id = matches[0]["id"]
        det = requests.get(f"{API}/crm/leads/{lead_id}", headers=lm_headers, timeout=15).json()

        # ---- (3) Person-assign ----
        assert det.get("account_manager_id") == ankit["id"], (
            f"lead not assigned to Ankit: got {det.get('account_manager_id')} vs {ankit['id']}")
        assert det.get("routing_reason", "").startswith("Assigned on import to"), (
            f"routing_reason wrong: {det.get('routing_reason')}")

        # ---- (4) Claim reconciliation ----
        notes = det.get("notes") or []
        total_claims_note = next((n for n in notes if "total claims" in (n.get("text") or "").lower()), None)
        assert total_claims_note, f"total claims note missing; notes={notes}"
        text = total_claims_note["text"]
        assert str(medicare_tot) in text, (
            f"medicare_tot={medicare_tot} not in reconciled note text: {text!r}")
        assert "(from Medicare)" in text, f"Medicare marker missing in reconciled note: {text!r}"
        assert str(import_wrong_tot) not in text, (
            f"imported wrong total {import_wrong_tot} still present in note: {text!r}")

        # Avg per claim note should NOT be overridden
        avg_note = next((n for n in notes if "avg per claim" in (n.get("text") or "").lower()), None)
        assert avg_note, f"avg per claim note missing; notes={notes}"
        assert "from Medicare" not in avg_note["text"], (
            f"avg-per-claim note incorrectly overridden: {avg_note['text']!r}")

        # ---- Cleanup: rollback the import ----
        rr = requests.post(f"{API}/imports/{import_id}/rollback", headers=lm_headers, timeout=30)
        assert rr.status_code == 200, rr.text
