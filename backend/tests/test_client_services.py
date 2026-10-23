"""Isolated API tests: no production database, credentials or external services."""
import asyncio
import copy
import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ValidationError

ROOT = Path(__file__).resolve().parents[1]


def values(doc, dotted):
    parts = dotted.split(".")
    found = [doc]
    for part in parts:
        expanded = []
        for node in found:
            nodes = node if isinstance(node, list) else [node]
            expanded += [n.get(part) for n in nodes if isinstance(n, dict) and part in n]
        found = expanded
    return found


def matches(doc, query):
    for key, wanted in query.items():
        if key == "$and":
            if not all(matches(doc, q) for q in wanted):
                return False
        elif key == "$or":
            if not any(matches(doc, q) for q in wanted):
                return False
        else:
            candidates = values(doc, key)
            if isinstance(wanted, dict):
                if "$ne" in wanted and wanted["$ne"] in candidates:
                    return False
                if "$exists" in wanted and bool(candidates) != wanted["$exists"]:
                    return False
                if "$gte" in wanted and not any(v >= wanted["$gte"] for v in candidates):
                    return False
            elif wanted not in candidates:
                return False
    return True


class Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *args):
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.docs[:length])


class Collection:
    def __init__(self):
        self.docs = []
        self.pipeline = None

    def find(self, query, projection=None):
        return Cursor([d for d in self.docs if matches(d, query)])

    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(d) for d in self.docs if matches(d, query)), None)

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, query, update, upsert=False):
        doc = next((d for d in self.docs if matches(d, query)), None)
        inserted = doc is None and upsert
        if inserted:
            doc = dict(query)
            self.docs.append(doc)
        if doc is None:
            return types.SimpleNamespace(matched_count=0)
        if inserted:
            doc.update(update.get("$setOnInsert", {}))
        doc.update(copy.deepcopy(update.get("$set", {})))
        for k, value in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + value
        for k, value in update.get("$push", {}).items():
            doc.setdefault(k, []).append(copy.deepcopy(value))
        return types.SimpleNamespace(matched_count=1)

    async def find_one_and_update(self, query, update, **kwargs):
        await self.update_one(query, update, upsert=True)
        return await self.find_one(query)

    def aggregate(self, pipeline):
        self.pipeline = pipeline
        return Cursor([])


@pytest.fixture
def api(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT))
    db = types.SimpleNamespace(**{name: Collection() for name in [
        "crm_leads", "crm_service_catalog", "crm_service_referrals", "website_rate_limits",
    ]})
    def require_roles(*roles):
        async def auth(request: Request):
            role = request.headers.get("x-test-role")
            if not role:
                raise HTTPException(401, "Not authenticated")
            if role not in set(roles) | {"admin", "super_admin"}:
                raise HTTPException(403, "Forbidden")
            return {"id": "rep-1", "name": "Test Rep", "role": role}
        return auth
    deps = types.ModuleType("deps")
    deps.db = db
    deps.JWT_SECRET = "test-only-secret"
    deps.require_roles = require_roles
    deps.require_admin = require_roles()
    common = types.ModuleType("crm_common")
    common.now_iso = lambda: "2026-10-23T12:00:00+00:00"
    common.log_event = AsyncMock()
    crm = types.ModuleType("routes_crm")
    crm._lead_scope = lambda user: {} if user["role"] != "staff" else {
        "$or": [{"created_by": user["id"]}, {"account_manager_id": user["id"]}]}
    class LeadInput(BaseModel):
        org_name: str
        contact_first: str
        contact_last: str
        email: str
        source: str
        source_details: str
        qualification_notes: str
        tags: list[str]
    crm.LeadInput = LeadInput
    async def create_lead(data, user):
        doc = {**data.model_dump(), "id": "web-" + str(len(db.crm_leads.docs)),
               "created_by": user["id"], "created_at": common.now_iso(), "status": "New"}
        await db.crm_leads.insert_one(doc)
        return doc
    crm.create_lead = create_lead
    for name, module in [("deps", deps), ("crm_common", common), ("routes_crm", crm)]:
        monkeypatch.setitem(sys.modules, name, module)
    spec = importlib.util.spec_from_file_location("tested_client_routes", ROOT / "routes_client_services.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router)
    app.include_router(module.public_router)
    db.crm_leads.docs = [
        {"id": "mine", "org_name": "Visible Practice", "created_by": "rep-1", "status": "Won"},
        {"id": "other", "org_name": "Other Practice", "created_by": "rep-2"},
        {"id": "archived", "created_by": "rep-1", "archived": True},
    ]
    def call(method, path, role="staff", **kwargs):
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                headers = {"x-test-role": role} if role else {}
                return await client.request(method, path, headers=headers, **kwargs)
        return asyncio.run(run())
    return call, db, common


def profile():
    return {"client_status": "DTCM Form Completed", "services": [
        {"service_id": "rpm", "status": "Started with Caregenix for RPM", "partner": "Caregenix"},
        {"service_id": "infusion", "status": "Client is sending Infusion", "partner": "Infusion partner"},
        {"service_id": "specialty-pharmacy-340b", "status": "Started writing prescription", "partner": "Pharmacy"},
    ]}


def test_meta_requires_crm_authentication(api):
    call, _, _ = api
    assert call("GET", "/api/crm/client-services/meta", role=None).status_code == 401
    assert call("GET", "/api/crm/client-services/meta", role="unknown").status_code == 403


def test_independent_services_preserve_sales_stage_and_log_change(api):
    call, db, common = api
    response = call("PUT", "/api/crm/leads/mine/client-profile", json=profile())
    assert response.status_code == 200
    assert len(response.json()["services"]) == 3
    assert db.crm_leads.docs[0]["status"] == "Won"
    assert db.crm_leads.docs[0]["client_profile"]["client_status"] == "DTCM Form Completed"
    common.log_event.assert_awaited_once()


@pytest.mark.parametrize("lead_id", ["other", "archived", "missing"])
def test_staff_cannot_update_hidden_client(api, lead_id):
    call, _, _ = api
    assert call("PUT", "/api/crm/leads/" + lead_id + "/client-profile", json=profile()).status_code == 404


def test_invalid_statuses_and_duplicate_services_rejected(api):
    call, _, _ = api
    p = profile()
    p["client_status"] = "not-real"
    assert call("PUT", "/api/crm/leads/mine/client-profile", json=p).status_code == 400
    p = profile()
    p["services"][0]["status"] = "Client is sending Infusion"
    assert call("PUT", "/api/crm/leads/mine/client-profile", json=p).status_code == 400
    p = profile()
    p["services"].append(p["services"][0])
    assert call("PUT", "/api/crm/leads/mine/client-profile", json=p).status_code == 422


def test_only_admins_can_add_custom_services_without_duplicates(api):
    call, db, _ = api
    assert call("POST", "/api/crm/client-services/catalog", json={"name": "CCM"}).status_code == 403
    first = call("POST", "/api/crm/client-services/catalog", role="admin", json={"name": "CCM"})
    again = call("POST", "/api/crm/client-services/catalog", role="admin", json={"name": " ccm "})
    assert first.status_code == again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert len(db.crm_service_catalog.docs) == 1


def test_referral_history_status_validation_and_ownership(api):
    call, db, _ = api
    data = {"service_id": "rpm", "destination": "Caregenix", "reference": "INTERNAL-100"}
    assert call("POST", "/api/crm/leads/other/service-referrals", json=data).status_code == 404
    response = call("POST", "/api/crm/leads/mine/service-referrals", json=data)
    assert response.status_code == 200
    rid = response.json()["id"]
    assert call("PATCH", "/api/crm/service-referrals/" + rid, json={"status": "bogus"}).status_code == 400
    response = call("PATCH", "/api/crm/service-referrals/" + rid, json={"status": "Completed"})
    assert response.status_code == 200
    assert [h["to"] for h in response.json()["history"]] == ["Submitted", "Completed"]
    db.crm_leads.docs[0]["created_by"] = "rep-2"
    assert call("PATCH", "/api/crm/service-referrals/" + rid, json={"status": "Accepted"}).status_code == 404


def test_referral_list_always_joins_visible_client_scope(api):
    call, db, _ = api
    assert call("GET", "/api/crm/service-referrals?lead_id=other").status_code == 200
    pipeline = db.crm_service_referrals.pipeline
    visibility = next(stage["$match"] for stage in pipeline if "$match" in stage and "client.archived" in stage["$match"])
    assert visibility["$or"] == [{"client.created_by": "rep-1"}, {"client.account_manager_id": "rep-1"}]


def demo():
    return {"organization": "Test MSO", "contact_name": "Test Person", "email": "test@example.com",
            "organization_type": "MSO", "services": ["rpm"], "consent": True, "website": ""}


def test_website_request_creates_unassigned_crm_lead_and_deduplicates(api):
    call, db, _ = api
    data = demo()
    response = call("POST", "/api/public/request-demo", role=None, json=data)
    assert response.status_code == 202 and response.json() == {"received": True}
    lead = db.crm_leads.docs[-1]
    assert lead["source"] == "Website" and lead["status"] == "New"
    assert lead["account_manager_id"] is None
    assert lead["client_profile"]["services"][0]["service_id"] == "rpm"
    assert lead["website_contact_consent"]["purpose"] == "Demo request"
    assert call("POST", "/api/public/request-demo", role=None, json=data).status_code == 202
    assert len(db.crm_leads.docs) == 4


@pytest.mark.parametrize("field,value,expected", [
    ("consent", False, 400), ("email", "bad email", 422),
    ("services", ["unknown"], 400), ("services", [], 422),
    ("organization_type", "unknown", 400),
])
def test_bad_website_inquiries_are_not_saved(api, field, value, expected):
    call, db, _ = api
    data = demo()
    data[field] = value
    assert call("POST", "/api/public/request-demo", role=None, json=data).status_code == expected
    assert len(db.crm_leads.docs) == 3


def test_honeypot_and_rate_limit(api):
    call, db, _ = api
    data = demo()
    data["website"] = "spam"
    assert call("POST", "/api/public/request-demo", role=None, json=data).status_code == 202
    assert len(db.crm_leads.docs) == 3
    data["website"] = ""
    for _ in range(10):
        assert call("POST", "/api/public/request-demo", role=None, json=data).status_code == 202
    assert call("POST", "/api/public/request-demo", role=None, json=data).status_code == 429


def test_business_email_validator_accepts_normal_and_rejects_whitespace():
    from client_services import DemoInput
    assert DemoInput(**demo()).email == "test@example.com"
    with pytest.raises(ValidationError):
        DemoInput(**{**demo(), "email": "a b@example.com"})
