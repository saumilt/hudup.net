"""Medicare Search: query the aggregated CMS physician table with simple fields
or an advanced AND/OR filter builder. Multi-year aware (dataset_year)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import re

from deps import db, require_roles, get_thresholds
from scoring import score_340b, score_rpm, tier_color_340b
from crm_common import ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF
import geo

router = APIRouter(prefix="/api/medicare")

CRM_VIEW = require_roles(ROLE_LEAD_MANAGER, ROLE_ACCOUNT_MANAGER, ROLE_STAFF)

# Friendly filter field -> (mongo field, type). Text fields query the *_upper twins.
FIELD_MAP = {
    "npi": ("npi", "text"),
    "first_name": ("first_upper", "text_upper"),
    "last_name": ("last_upper", "text_upper"),
    "city": ("city", "text"),
    "state": ("state", "enum_upper"),
    "specialty": ("specialty", "text"),
    "tot_clms": ("tot_clms", "number"),
    "tot_cost": ("tot_cost", "number"),
    "avg_per_claim": ("avg_per_claim", "number"),
    "tier_340b": ("tier_340b", "enum"),
    "tier_rpm": ("tier_rpm", "enum"),
    "row_count": ("row_count", "number"),
}
OP_MAP = {"gt": "$gt", "gte": "$gte", "lt": "$lt", "lte": "$lte", "eq": "$eq", "ne": "$ne"}


async def _years() -> list[int]:
    ys = await db.physicians.distinct("dataset_year")
    ys = sorted([y for y in ys if y is not None], reverse=True)
    return ys or [2024]


async def _session_ids_for_year(year: int) -> list[str]:
    sids = await db.sessions.distinct("id", {"dataset_year": year})
    return sids


def _score_row(p: dict, t: dict) -> dict:
    clms = p.get("tot_clms", 0) or 0
    cost = p.get("tot_cost", 0) or 0
    avg = p.get("avg_per_claim")
    if avg is None:
        avg = (cost / clms) if clms else 0
    t340 = p.get("tier_340b") or score_340b(True, avg, cost, t)
    shade = p.get("shade_340b") or tier_color_340b(t340, avg)[0]
    trpm = p.get("tier_rpm") or score_rpm(True, clms, p.get("specialty"))
    return {
        "npi": p.get("npi"),
        "first_name": p.get("first_name"), "last_name": p.get("last_name"),
        "specialty": p.get("specialty"), "city": p.get("city"), "state": p.get("state"),
        "tot_clms": clms, "tot_cost": cost, "avg_per_claim": round(avg, 2),
        "tier_340b": t340, "shade_340b": shade, "tier_rpm": trpm,
        "dataset_year": p.get("dataset_year"),
    }


@router.get("/years")
async def years(user=Depends(CRM_VIEW)):
    return {"years": await _years()}


@router.get("/filter-schema")
async def filter_schema(dataset_year: int = 2024, user=Depends(CRM_VIEW)):
    fields = [
        {"field": "specialty", "label": "Specialty", "type": "text", "ops": ["contains", "eq"]},
        {"field": "state", "label": "State", "type": "enum_upper", "ops": ["eq", "ne"]},
        {"field": "city", "label": "City", "type": "text", "ops": ["contains", "eq"]},
        {"field": "tot_clms", "label": "Total Claims", "type": "number", "ops": ["gte", "lte", "gt", "lt", "eq"]},
        {"field": "tot_cost", "label": "Total Drug Cost", "type": "number", "ops": ["gte", "lte", "gt", "lt", "eq"]},
        {"field": "avg_per_claim", "label": "Avg Cost / Claim", "type": "number", "ops": ["gte", "lte", "gt", "lt", "eq"]},
        {"field": "tier_340b", "label": "340B Tier", "type": "enum", "ops": ["eq", "ne"],
         "options": ["GREEN", "YELLOW", "BLUE", "RED"]},
        {"field": "tier_rpm", "label": "RPM Tier", "type": "enum", "ops": ["eq", "ne"],
         "options": ["GREEN", "YELLOW", "BLUE", "RED"]},
    ]
    return {"dataset_year": dataset_year, "fields": fields}


class SimpleSearch(BaseModel):
    dataset_year: int = 2024
    npi: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    full_name: str | None = None
    org_name: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    specialty: str | None = None
    tier_340b: str | None = None
    tier_rpm: str | None = None
    states: list[str] = []
    cities: list[str] = []
    tiers: list[str] = []
    radius_mi: float | None = None
    origin_address: str | None = None
    origin_city: str | None = None
    origin_state: str | None = None
    origin_zip: str | None = None
    sort: str = "tot_cost"
    page: int = 1
    page_size: int = 25


@router.post("/search")
async def search(data: SimpleSearch, user=Depends(CRM_VIEW)):
    sids = await _session_ids_for_year(data.dataset_year)
    if not sids:
        return {"total": 0, "results": [], "page": data.page, "page_size": data.page_size,
                "message": f"No dataset found for year {data.dataset_year}"}
    q: dict = {"session_id": {"$in": sids}}
    if data.npi:
        q["npi"] = data.npi.strip()
    if data.first_name:
        q["first_upper"] = {"$regex": "^" + re.escape(data.first_name.strip().upper())}
    if data.last_name:
        q["last_upper"] = {"$regex": "^" + re.escape(data.last_name.strip().upper())}
    if data.full_name:
        parts = data.full_name.strip().upper().split()
        if len(parts) >= 2:
            q["first_upper"] = {"$regex": "^" + re.escape(parts[0])}
            q["last_upper"] = {"$regex": "^" + re.escape(parts[-1])}
        elif parts:
            q["last_upper"] = {"$regex": "^" + re.escape(parts[0])}
    if data.cities:
        q["city"] = {"$in": data.cities}
    elif data.city:
        q["city"] = {"$regex": re.escape(data.city.strip()), "$options": "i"}
    if data.states:
        q["state"] = {"$in": [s.strip().upper() for s in data.states if s.strip()]}
    elif data.state:
        q["state"] = data.state.strip().upper()
    if data.specialty:
        q["specialty"] = {"$regex": re.escape(data.specialty.strip()), "$options": "i"}
    if data.tiers:
        q["tier_340b"] = {"$in": data.tiers}
    elif data.tier_340b:
        q["tier_340b"] = data.tier_340b
    if data.tier_rpm:
        q["tier_rpm"] = data.tier_rpm

    origin = None
    radius_cities = None
    if data.radius_mi and data.radius_mi > 0:
        origin = await geo.geocode_origin(data.origin_address, data.origin_city,
                                          data.origin_state, data.origin_zip)
        if not origin:
            return {"total": 0, "results": [], "page": data.page, "page_size": data.page_size,
                    "message": "Could not locate that address / city / ZIP"}
        await geo.build_city_geo()
        cities = await geo.provider_cities_in_radius(origin["lat"], origin["lon"], data.radius_mi)
        radius_cities = len(cities)
        geo_filter = geo.radius_city_filter(cities)
        if not geo_filter:
            return {"total": 0, "results": [], "page": data.page, "page_size": data.page_size,
                    "origin": origin, "radius_cities": 0,
                    "message": "No provider cities within that radius"}
        q.pop("city", None)
        q.pop("state", None)
        q = {"$and": [q, geo_filter]}

    sort_field = {"tot_cost": "tot_cost", "tot_clms": "tot_clms",
                  "avg_per_claim": "avg_per_claim", "last_name": "last_upper"}.get(data.sort, "tot_cost")
    total = await db.physicians.count_documents(q)
    skip = max(0, (data.page - 1) * data.page_size)
    docs = await db.physicians.find(q, {"_id": 0}).sort(sort_field, -1).skip(skip).limit(data.page_size).to_list(data.page_size)
    t = await get_thresholds()
    results = [_score_row(p, t) for p in docs]
    npis = [r["npi"] for r in results if r.get("npi")]
    existing = {}
    if npis:
        async for lead in db.crm_leads.find({"matched_npi": {"$in": npis}},
                                             {"_id": 0, "matched_npi": 1, "status": 1, "id": 1,
                                              "account_manager_id": 1, "lead_manager_id": 1}):
            existing[lead["matched_npi"]] = lead
    for r in results:
        r["crm"] = existing.get(r["npi"])
    resp = {"total": total, "results": results, "page": data.page, "page_size": data.page_size}
    if origin is not None:
        resp["origin"] = origin
        resp["radius_cities"] = radius_cities
    return resp


class GeoResolve(BaseModel):
    radius_mi: float = 25
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None


@router.post("/geo/resolve")
async def geo_resolve(data: GeoResolve, user=Depends(CRM_VIEW)):
    """Geocode an origin and list the provider cities within the radius (for the UI)."""
    origin = await geo.geocode_origin(data.address, data.city, data.state, data.zip)
    if not origin:
        raise HTTPException(400, "Could not locate that address / city / ZIP. Try a ZIP or 'City, ST'.")
    await geo.build_city_geo()
    cities = await geo.provider_cities_in_radius(origin["lat"], origin["lon"], data.radius_mi)
    return {"origin": origin, "radius_mi": data.radius_mi, "city_count": len(cities),
            "cities": cities[:500]}


@router.post("/geo/build")
async def geo_build(user=Depends(CRM_VIEW)):
    """Rebuild the provider-city centroid index (admin/maintenance)."""
    return await geo.build_city_geo(force=True)


@router.get("/states")
async def med_states(dataset_year: int = 2024, user=Depends(CRM_VIEW)):
    sids = await _session_ids_for_year(dataset_year)
    q = {"session_id": {"$in": sids}} if sids else {}
    states = await db.physicians.distinct("state", q)
    return {"states": sorted([s for s in states if s])}


@router.get("/cities")
async def med_cities(states: str = "", dataset_year: int = 2024, user=Depends(CRM_VIEW)):
    sids = await _session_ids_for_year(dataset_year)
    q: dict = {"session_id": {"$in": sids}} if sids else {}
    picked = [s.strip().upper() for s in states.split(",") if s.strip()]
    if picked:
        q["state"] = {"$in": picked}
    cities = await db.physicians.distinct("city", q)
    return {"cities": sorted([c for c in cities if c])[:3000]}


class Condition(BaseModel):
    field: str
    op: str
    value: object


class AdvancedSearch(BaseModel):
    dataset_year: int = 2024
    connector: str = "AND"
    conditions: list[Condition] = []
    sort: str = "tot_cost"
    page: int = 1
    page_size: int = 25


def _build_condition(c: Condition):
    spec = FIELD_MAP.get(c.field)
    if not spec:
        return None
    fld, ftype = spec
    v = c.value
    if c.op == "contains":
        return {fld: {"$regex": re.escape(str(v)), "$options": "i"}}
    if ftype in ("text_upper", "enum_upper") and isinstance(v, str):
        v = v.strip().upper()
    if ftype == "number":
        try:
            v = float(v)
        except (TypeError, ValueError):
            return None
    mop = OP_MAP.get(c.op)
    if not mop:
        return None
    return {fld: {mop: v}}


@router.post("/advanced-search")
async def advanced_search(data: AdvancedSearch, user=Depends(CRM_VIEW)):
    sids = await _session_ids_for_year(data.dataset_year)
    if not sids:
        return {"total": 0, "results": [], "page": data.page, "page_size": data.page_size}
    conds = [b for c in data.conditions if (b := _build_condition(c))]
    base = {"session_id": {"$in": sids}}
    if conds:
        base = {"$and": [base, {"$or" if data.connector == "OR" else "$and": conds}]}
    sort_field = {"tot_cost": "tot_cost", "tot_clms": "tot_clms",
                  "avg_per_claim": "avg_per_claim"}.get(data.sort, "tot_cost")
    total = await db.physicians.count_documents(base)
    skip = max(0, (data.page - 1) * data.page_size)
    docs = await db.physicians.find(base, {"_id": 0}).sort(sort_field, -1).skip(skip).limit(data.page_size).to_list(data.page_size)
    t = await get_thresholds()
    return {"total": total, "results": [_score_row(p, t) for p in docs],
            "page": data.page, "page_size": data.page_size}


@router.get("/physicians/{npi}")
async def physician_detail(npi: str, dataset_year: int = 2024, user=Depends(CRM_VIEW)):
    sids = await _session_ids_for_year(dataset_year)
    p = await db.physicians.find_one({"npi": npi, "session_id": {"$in": sids}}, {"_id": 0}) if sids else None
    if not p:
        raise HTTPException(404, "Physician not found for that year")
    t = await get_thresholds()
    row = _score_row(p, t)
    row["extra"] = p.get("extra", {})
    row["raw"] = p.get("raw", {})
    row["row_count"] = p.get("row_count")
    return row


@router.get("/physicians/{npi}/year-comparison")
async def year_comparison(npi: str, user=Depends(CRM_VIEW)):
    t = await get_thresholds()
    out = []
    async for p in db.physicians.find({"npi": npi}, {"_id": 0}):
        row = _score_row(p, t)
        out.append({"dataset_year": p.get("dataset_year"), **{k: row[k] for k in
                    ("tot_clms", "tot_cost", "avg_per_claim", "tier_340b", "tier_rpm")}})
    out.sort(key=lambda r: r.get("dataset_year") or 0)
    return {"npi": npi, "years": out}
