"""Iteration 3 tests: 'capture all columns' behavior for CMS ingestion +
propagation to leads, export tail, and kiosk privacy rule."""
import os
import io
import csv
import time
import asyncio
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
CSV_PATH = "/tmp/sample1000.csv"

ADMIN_EMAIL = "admin@boothiq.com"
ADMIN_PIN = "482913"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "pin": ADMIN_PIN}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="session")
def ingested_session(admin_headers, mongo):
    """Create a session, upload /tmp/sample1000.csv in one chunk, finalize, go live."""
    assert os.path.exists(CSV_PATH), "sample CSV missing"
    # create
    r = requests.post(f"{BASE_URL}/api/admin/sessions",
                      json={"name": "iter3 capture-all"}, headers=admin_headers, timeout=30)
    assert r.status_code == 200
    sid = r.json()["id"]
    # init
    r = requests.post(f"{BASE_URL}/api/admin/sessions/{sid}/files/init",
                      data={"filename": "sample1000.csv"}, headers=admin_headers, timeout=30)
    assert r.status_code == 200
    fid = r.json()["file_id"]
    # chunk
    with open(CSV_PATH, "rb") as f:
        data = f.read()
    files = {"chunk": ("sample1000.csv", data, "text/csv")}
    r = requests.post(f"{BASE_URL}/api/admin/sessions/{sid}/files/{fid}/chunk",
                      data={"index": 0, "total": 1}, files=files,
                      headers=admin_headers, timeout=60)
    assert r.status_code == 200
    # complete (fire-and-forget)
    r = requests.post(f"{BASE_URL}/api/admin/sessions/{sid}/files/{fid}/complete",
                      headers=admin_headers, timeout=30)
    assert r.status_code == 200
    # wait for streaming to finish
    for _ in range(30):
        s = mongo.sessions.find_one({"id": sid})
        files_arr = s.get("files", [])
        if files_arr and files_arr[0].get("status") == "done":
            break
        time.sleep(1)
    # finalize
    r = requests.post(f"{BASE_URL}/api/admin/sessions/{sid}/finalize",
                      headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    coverage = r.json()
    # go live so kiosk uses this session
    r = requests.post(f"{BASE_URL}/api/admin/sessions/{sid}/golive",
                      headers=admin_headers, timeout=30)
    assert r.status_code == 200
    return {"sid": sid, "coverage": coverage}


# ---------------- Ingestion / aggregation ----------------
class TestIngestionAggregation:
    def test_coverage_numbers(self, ingested_session):
        c = ingested_session["coverage"]
        assert c["unique_npis"] == 45
        assert c["total_rows"] == 1000
        assert c["max_npi"] == 1003004201

    def test_physician_extra_and_raw(self, ingested_session, mongo):
        sid = ingested_session["sid"]
        p = mongo.physicians.find_one({"session_id": sid, "npi": "1003000126"})
        assert p is not None, "NPI not aggregated"
        # row_count from first two lines shown for this NPI must be >= 2
        assert p.get("row_count", 0) == 2, f"row_count expected 2, got {p.get('row_count')}"
        # top-level sums preserved
        assert round(p["tot_clms"]) == 32
        assert abs(p["tot_cost"] - 6642.27) < 0.05
        # extras summed
        ex = p.get("extra") or {}
        assert round(ex.get("Tot_30day_Fills", 0)) == 32
        assert round(ex.get("Tot_Day_Suply", 0)) == 32
        assert round(ex.get("Tot_Benes", 0)) == 32
        assert round(ex.get("GE65_Tot_Clms", 0)) == 32
        assert abs(ex.get("GE65_Tot_Drug_Cst", 0) - 6642.27) < 0.05
        # raw categoricals carried (first value)
        raw = p.get("raw") or {}
        assert "Brnd_Name" in raw
        assert "Gnrc_Name" in raw
        # FIPS is id-like → must go to raw, NOT sum
        assert raw.get("Prscrbr_State_FIPS") == "24"
        assert "Prscrbr_State_FIPS" not in ex
        assert raw.get("Prscrbr_Type_Src") == "Claim-Specialty"

    def test_id_like_columns_not_summed(self, ingested_session, mongo):
        """flag/sprsn/npi/fips/_src columns must never appear as summed extras."""
        sid = ingested_session["sid"]
        p = mongo.physicians.find_one({"session_id": sid, "npi": "1003000126"})
        ex = p.get("extra") or {}
        for bad in ("Prscrbr_NPI", "GE65_Sprsn_Flag", "GE65_Bene_Sprsn_Flag",
                    "Prscrbr_State_FIPS", "Prscrbr_Type_Src"):
            assert bad not in ex, f"id-like column {bad} should not be summed"


# ---------------- Lead matched → cms_extra propagation ----------------
class TestLeadCmsExtra:
    def test_matched_lead_carries_cms_extra(self, ingested_session, admin_headers):
        # Kiosk capture with NPI matches
        payload = {"first_name": "Ardalan", "last_name": "Enkeshafi", "state": "MD",
                   "npi": "1003000126", "event_id": "default",
                   "contact_consent": True, "sms_consent": False,
                   "consent_text": "test"}
        r = requests.post(f"{BASE_URL}/api/kiosk/leads", json=payload, timeout=30)
        assert r.status_code == 200
        kiosk_body = r.json()
        # Privacy: kiosk sees ONLY {id, spin_available}
        assert set(kiosk_body.keys()) == {"id", "spin_available"}, kiosk_body
        lead_id = kiosk_body["id"]

        # Dashboard fetch as admin
        r = requests.get(f"{BASE_URL}/api/dashboard/leads/{lead_id}",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200
        lead = r.json()
        assert lead.get("match_status") == "confirmed"
        ce = lead.get("cms_extra")
        assert ce is not None, "cms_extra missing on matched lead"
        assert ce.get("row_count") == 2
        assert "Tot_Benes" in (ce.get("extra") or {})
        assert "Brnd_Name" in (ce.get("raw") or {})
        return lead_id

    def test_unmatched_lead_has_null_cms_extra(self, ingested_session, admin_headers):
        payload = {"first_name": "Nobody", "last_name": "Zzzznobody", "state": "TX",
                   "npi": "9999999999", "event_id": "default",
                   "contact_consent": True, "sms_consent": False,
                   "consent_text": "test"}
        r = requests.post(f"{BASE_URL}/api/kiosk/leads", json=payload, timeout=30)
        assert r.status_code == 200
        assert set(r.json().keys()) == {"id", "spin_available"}
        lead_id = r.json()["id"]
        r = requests.get(f"{BASE_URL}/api/dashboard/leads/{lead_id}",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200
        lead = r.json()
        assert lead.get("tier_340b") == "GREY"
        assert lead.get("cms_extra") is None


@pytest.fixture(scope="session")
def matched_lead_created(ingested_session):
    """Ensure at least one matched lead with cms_extra exists before export tests."""
    payload = {"first_name": "Ardalan", "last_name": "Enkeshafi", "state": "MD",
               "npi": "1003000126", "event_id": "default",
               "contact_consent": True, "sms_consent": False, "consent_text": "test"}
    r = requests.post(f"{BASE_URL}/api/kiosk/leads", json=payload, timeout=30)
    assert r.status_code == 200
    return r.json()["id"]


# ---------------- Export dynamic tail ----------------
class TestExport:
    def test_csv_export_has_dynamic_tail(self, matched_lead_created, admin_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/export",
                         params={"fmt": "csv"}, headers=admin_headers, timeout=60)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        text = r.text
        reader = csv.reader(io.StringIO(text))
        headers = next(reader)
        assert "Drug Rows" in headers
        # at least one summed measure
        sum_cols = [h for h in headers if h.startswith("Sum ")]
        assert len(sum_cols) >= 1, headers
        assert "Sum Tot_Benes" in headers
        # raw carriers
        assert "Brnd_Name" in headers
        assert "Gnrc_Name" in headers
        # rows parse
        rows = list(reader)
        assert len(rows) >= 1

    def test_xlsx_export_streams(self, matched_lead_created, admin_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/export",
                         params={"fmt": "xlsx"}, headers=admin_headers, timeout=60)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheet" in ct
        # openpyxl parses
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        ws = wb.active
        headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        assert "Drug Rows" in headers
        assert any(h and str(h).startswith("Sum ") for h in headers)


# ---------------- Regression: prior flows ----------------
class TestRegression:
    def test_staff_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "staff@boothiq.com", "pin": "715264"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "staff"

    def test_counters_reachable(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/counters", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "by_340b" in body and "by_rpm" in body

    def test_events_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/events", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_one_spin_per_lead(self, ingested_session, admin_headers):
        payload = {"first_name": "Spin", "last_name": "Once", "state": "TX",
                   "event_id": "default", "contact_consent": True, "sms_consent": False}
        r = requests.post(f"{BASE_URL}/api/kiosk/leads", json=payload, timeout=30)
        lid = r.json()["id"]
        # Ensure a prize set exists — seed-sample doesn't create one; skip if none
        r1 = requests.post(f"{BASE_URL}/api/kiosk/leads/{lid}/spin", timeout=30)
        j1 = r1.json()
        if j1.get("error") in ("no_prizes", "no_inventory"):
            pytest.skip("No active prize set configured for spin regression")
        r2 = requests.post(f"{BASE_URL}/api/kiosk/leads/{lid}/spin", timeout=30)
        assert r2.json().get("error") == "already_spun"
