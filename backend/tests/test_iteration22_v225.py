"""v2.25 tests — Teams/Territories edit+delete, and Import round-robin with rr_user_ids."""
import io
import os
import uuid
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # Fall back to reading frontend/.env
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = _load_backend_url()


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@boothiq.com", "pin": "482913"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def account_managers(admin_hdr):
    r = requests.get(f"{BASE}/api/users", params={"role": "account_manager"},
                     headers=admin_hdr, timeout=15)
    assert r.status_code == 200
    ams = r.json()
    assert len(ams) >= 2, "need >=2 account managers to test RR"
    return ams


@pytest.fixture(scope="module")
def lead_managers(admin_hdr):
    r = requests.get(f"{BASE}/api/users", params={"role": "lead_manager"},
                     headers=admin_hdr, timeout=15)
    assert r.status_code == 200
    lms = r.json()
    assert len(lms) >= 1, "need >=1 lead manager"
    return lms


# ==================== Teams edit/delete ====================
class TestTeamsCRUD:
    def test_create_edit_delete_team(self, admin_hdr, account_managers):
        # CREATE
        payload = {"name": f"TEST_v225_team_{uuid.uuid4().hex[:6]}",
                   "member_ids": [account_managers[0]["id"]]}
        r = requests.post(f"{BASE}/api/crm/teams", json=payload, headers=admin_hdr, timeout=15)
        assert r.status_code == 200, r.text
        team = r.json()
        assert team["name"] == payload["name"]
        tid = team["id"]

        # PATCH name + members
        new_name = payload["name"] + "_edited"
        new_members = [account_managers[0]["id"], account_managers[1]["id"]]
        r = requests.patch(f"{BASE}/api/crm/teams/{tid}",
                           json={"name": new_name, "member_ids": new_members},
                           headers=admin_hdr, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify persistence via GET list
        r = requests.get(f"{BASE}/api/crm/teams", headers=admin_hdr, timeout=15)
        assert r.status_code == 200
        found = next((t for t in r.json() if t["id"] == tid), None)
        assert found is not None
        assert found["name"] == new_name
        assert set(found.get("member_ids", [])) == set(new_members)

        # DELETE
        r = requests.delete(f"{BASE}/api/crm/teams/{tid}", headers=admin_hdr, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Verify deletion
        r = requests.get(f"{BASE}/api/crm/teams", headers=admin_hdr, timeout=15)
        assert not any(t["id"] == tid for t in r.json())


# ==================== Territories edit/delete ====================
class TestTerritoriesCRUD:
    def test_create_edit_delete_territory(self, admin_hdr, account_managers):
        # First need a team
        tpay = {"name": f"TEST_v225_tt_{uuid.uuid4().hex[:6]}",
                "member_ids": [account_managers[0]["id"]]}
        r = requests.post(f"{BASE}/api/crm/teams", json=tpay, headers=admin_hdr, timeout=15)
        assert r.status_code == 200
        team_id = r.json()["id"]

        try:
            # CREATE territory (lowercase states → should be upper-cased on create too)
            terr_pay = {"name": f"TEST_v225_terr_{uuid.uuid4().hex[:6]}",
                        "team_id": team_id,
                        "states": ["tx", "ok"],
                        "specialties": ["cardio"]}
            r = requests.post(f"{BASE}/api/crm/territories", json=terr_pay,
                              headers=admin_hdr, timeout=15)
            assert r.status_code == 200, r.text
            terr = r.json()
            assert terr["states"] == ["TX", "OK"]
            terr_id = terr["id"]

            # PATCH — change name, states (lowercase→upper), specialties
            r = requests.patch(f"{BASE}/api/crm/territories/{terr_id}",
                               json={"name": terr_pay["name"] + "_edited",
                                     "states": ["ca", "nv"],
                                     "specialties": ["derm"]},
                               headers=admin_hdr, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True

            # Verify persistence
            r = requests.get(f"{BASE}/api/crm/territories", headers=admin_hdr, timeout=15)
            assert r.status_code == 200
            found = next((t for t in r.json() if t["id"] == terr_id), None)
            assert found is not None
            assert found["name"].endswith("_edited")
            assert found["states"] == ["CA", "NV"]
            assert found["specialties"] == ["derm"]

            # PATCH non-existent → 404
            r = requests.patch(f"{BASE}/api/crm/territories/does-not-exist",
                               json={"name": "x"}, headers=admin_hdr, timeout=15)
            assert r.status_code == 404

            # DELETE
            r = requests.delete(f"{BASE}/api/crm/territories/{terr_id}",
                                headers=admin_hdr, timeout=15)
            assert r.status_code == 200
            assert r.json().get("ok") is True

            # Verify deletion
            r = requests.get(f"{BASE}/api/crm/territories", headers=admin_hdr, timeout=15)
            assert not any(t["id"] == terr_id for t in r.json())
        finally:
            requests.delete(f"{BASE}/api/crm/teams/{team_id}", headers=admin_hdr, timeout=15)


# ==================== Import round-robin with rr_user_ids ====================
def _pick_unused_npis(admin_hdr, n=3):
    """Pull physicians and filter out any already in crm_leads.matched_npi."""
    # Use search-npi endpoint via medicare (guess); fallback: skip if unavailable
    r = requests.get(f"{BASE}/api/physicians", params={"limit": 100},
                     headers=admin_hdr, timeout=20)
    if r.status_code != 200:
        return []
    phys = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    # Get existing matched npis
    r2 = requests.get(f"{BASE}/api/crm/leads", params={"limit": 2000},
                      headers=admin_hdr, timeout=30)
    used = set()
    if r2.status_code == 200:
        rows = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        used = {row.get("matched_npi") for row in rows if row.get("matched_npi")}
    picks = []
    for p in phys:
        npi = p.get("npi") or p.get("NPI")
        if npi and npi not in used:
            picks.append(str(npi))
        if len(picks) >= n:
            break
    return picks


class TestImportRRUserIds:
    def test_rr_user_ids_rotates_across_chosen_including_lead_manager(
            self, admin_hdr, account_managers, lead_managers):
        """RR should rotate leads across EXACTLY the chosen participants, in order.
        Lead managers must be valid participants."""
        npis = _pick_unused_npis(admin_hdr, n=3)
        if len(npis) < 3:
            # Fallback: use fake npis with unique-org rows (they won't match Medicare but will still be created)
            npis = [f"TEST9{uuid.uuid4().int % 10**8:08d}" for _ in range(3)]

        # 3-row CSV
        csv_body = "NPI,Organization\n"
        for i, npi in enumerate(npis):
            csv_body += f"{npi},TEST_v225_org_{i}_{uuid.uuid4().hex[:5]}\n"
        files = {"file": ("test_v225.csv", io.BytesIO(csv_body.encode()), "text/csv")}
        data = {"dataset_type": "lead"}
        r = requests.post(f"{BASE}/api/imports", files=files, data=data,
                          headers=admin_hdr, timeout=30)
        assert r.status_code == 200, r.text
        import_id = r.json()["import_id"]

        try:
            # Analyze
            r = requests.post(f"{BASE}/api/imports/{import_id}/analyze",
                              headers=admin_hdr, timeout=30)
            assert r.status_code == 200
            mapping = r.json()["mapping"]
            # Force mapping (case-insensitive already handled server-side, but be explicit)
            for k in list(mapping.keys()):
                lk = k.lower()
                if "npi" in lk:
                    mapping[k] = "npi"
                elif "org" in lk or "organization" in lk:
                    mapping[k] = "org_name"

            # Save mapping with rr_user_ids = [lead_manager, account_manager] (chosen order)
            lm = lead_managers[0]
            am = account_managers[0]
            rr_ids = [lm["id"], am["id"]]
            r = requests.post(f"{BASE}/api/imports/{import_id}/mapping",
                              json={"mapping": mapping, "rule": "safe",
                                    "distribute": "equal",
                                    "rr_user_ids": rr_ids},
                              headers=admin_hdr, timeout=15)
            assert r.status_code == 200, r.text

            # Validate then execute
            r = requests.post(f"{BASE}/api/imports/{import_id}/validate",
                              headers=admin_hdr, timeout=30)
            assert r.status_code == 200, r.text

            r = requests.post(f"{BASE}/api/imports/{import_id}/execute",
                              headers=admin_hdr, timeout=60)
            assert r.status_code == 200, r.text
            counts = r.json()
            assert counts["created"] == 3, f"expected 3 created, got {counts}"

            # Fetch job and inspect created leads assignment order
            r = requests.get(f"{BASE}/api/imports/{import_id}",
                             headers=admin_hdr, timeout=15)
            assert r.status_code == 200
            ids = r.json().get("created_ids", [])
            assert len(ids) == 3

            assignees_seen = []
            for lid in ids:
                lr = requests.get(f"{BASE}/api/crm/leads/{lid}",
                                  headers=admin_hdr, timeout=15)
                assert lr.status_code == 200, lr.text
                assignees_seen.append(lr.json().get("account_manager_id"))

            # Expected rotation: [lm, am, lm] (in order of rr_ids)
            expected = [lm["id"], am["id"], lm["id"]]
            assert assignees_seen == expected, \
                f"RR order mismatch. expected={expected} got={assignees_seen}"
        finally:
            # ROLLBACK the import
            requests.post(f"{BASE}/api/imports/{import_id}/rollback",
                          headers=admin_hdr, timeout=30)

    def test_rr_empty_user_ids_falls_back_to_all_account_managers(
            self, admin_hdr, account_managers):
        """Empty/None rr_user_ids → fallback pool = all active account managers (sorted by name)."""
        npis = [f"TEST9{uuid.uuid4().int % 10**8:08d}" for _ in range(2)]
        csv_body = "NPI,Organization\n" + "".join(
            f"{n},TEST_v225fb_{uuid.uuid4().hex[:4]}\n" for n in npis)
        files = {"file": ("fb.csv", io.BytesIO(csv_body.encode()), "text/csv")}
        r = requests.post(f"{BASE}/api/imports", files=files,
                          data={"dataset_type": "lead"},
                          headers=admin_hdr, timeout=30)
        assert r.status_code == 200
        import_id = r.json()["import_id"]

        try:
            r = requests.post(f"{BASE}/api/imports/{import_id}/analyze",
                              headers=admin_hdr, timeout=30)
            mapping = r.json()["mapping"]
            for k in list(mapping.keys()):
                lk = k.lower()
                if "npi" in lk:
                    mapping[k] = "npi"
                elif "org" in lk:
                    mapping[k] = "org_name"

            r = requests.post(f"{BASE}/api/imports/{import_id}/mapping",
                              json={"mapping": mapping, "rule": "safe",
                                    "distribute": "equal", "rr_user_ids": []},
                              headers=admin_hdr, timeout=15)
            assert r.status_code == 200
            r = requests.post(f"{BASE}/api/imports/{import_id}/validate",
                              headers=admin_hdr, timeout=30)
            assert r.status_code == 200
            r = requests.post(f"{BASE}/api/imports/{import_id}/execute",
                              headers=admin_hdr, timeout=60)
            assert r.status_code == 200

            r = requests.get(f"{BASE}/api/imports/{import_id}",
                             headers=admin_hdr, timeout=15)
            ids = r.json().get("created_ids", [])
            assert len(ids) >= 1
            am_ids = {a["id"] for a in account_managers}
            for lid in ids:
                lr = requests.get(f"{BASE}/api/crm/leads/{lid}",
                                  headers=admin_hdr, timeout=15).json()
                # fallback must assign to an account manager (not a lead manager)
                assert lr.get("account_manager_id") in am_ids, \
                    f"fallback assigned outside AM pool: {lr.get('account_manager_id')}"
        finally:
            requests.post(f"{BASE}/api/imports/{import_id}/rollback",
                          headers=admin_hdr, timeout=30)
