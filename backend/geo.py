"""Geographic helpers for radius search.

Medicare provider rows are city-level (city + state only, no ZIP/lat-long), so a
radius search resolves to whole cities: we geocode the origin (address / city / ZIP),
precompute a centroid for every provider city once (``med_city_geo``), and return the
provider cities whose centroid falls within the requested radius.

Geocoding is free + keyless: pgeocode (offline GeoNames) for ZIP and city centroids,
and the US Census one-line geocoder for full street addresses.
"""
import asyncio
import json
import logging
import math
import urllib.parse
import urllib.request

import pandas as pd
import pgeocode

from deps import db

logger = logging.getLogger("geo")

_nomi = pgeocode.Nominatim("us")
_df = _nomi._data.dropna(subset=["latitude", "longitude"]).copy()
_df["city_upper"] = _df["place_name"].astype(str).str.upper().str.strip()
_grp = _df.groupby(["state_code", "city_upper"])[["latitude", "longitude"]].mean()
# (STATE, CITY_UPPER) -> (lat, lon) GeoNames centroid for every US city.
_CITY_CENTROID = {(str(s), str(c)): (float(r.latitude), float(r.longitude))
                  for (s, c), r in _grp.iterrows()}

# In-memory cache of provider-city centroids loaded from med_city_geo.
_CITY_CACHE: list | None = None


def haversine_mi(lat1, lon1, lat2, lon2) -> float:
    r = 3958.8  # earth radius in miles
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def zip_centroid(zipcode: str):
    z = str(zipcode).strip()[:5]
    r = _nomi.query_postal_code(z)
    if r is None or pd.isna(r.latitude):
        return None
    return float(r.latitude), float(r.longitude), f"{r.place_name}, {r.state_code} {z}"


def city_centroid(city: str, state: str):
    c = _CITY_CENTROID.get((str(state).strip().upper(), str(city).strip().upper()))
    if not c:
        return None
    return c[0], c[1], f"{str(city).strip().title()}, {str(state).strip().upper()}"


def _census_geocode(address: str):
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode(
        {"address": address, "benchmark": "4", "format": "json"})
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.load(resp)
    matches = data.get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    co = matches[0]["coordinates"]
    return float(co["y"]), float(co["x"]), matches[0].get("matchedAddress") or address


async def geocode_origin(address=None, city=None, state=None, zipcode=None):
    """Resolve an origin to {lat, lon, label, source}. Priority: address > zip > city+state."""
    if address and str(address).strip():
        try:
            res = await asyncio.to_thread(_census_geocode, str(address).strip())
            if res:
                return {"lat": res[0], "lon": res[1], "label": res[2], "source": "address"}
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Census geocode failed (non-blocking): {e}")
    if zipcode and str(zipcode).strip():
        res = zip_centroid(zipcode)
        if res:
            return {"lat": res[0], "lon": res[1], "label": res[2], "source": "zip"}
    if city and state:
        res = city_centroid(city, state)
        if res:
            return {"lat": res[0], "lon": res[1], "label": res[2], "source": "city"}
    if city and not state:
        cu = str(city).strip().upper()
        for (s, c), (lat, lon) in _CITY_CENTROID.items():
            if c == cu:
                return {"lat": lat, "lon": lon, "label": f"{str(city).strip().title()}, {s}", "source": "city"}
    return None


async def build_city_geo(force: bool = False) -> dict:
    """One-time: centroid for every distinct provider (state, city). Cached in med_city_geo."""
    existing = await db.med_city_geo.estimated_document_count()
    if existing and not force:
        return {"built": False, "cities": existing}
    states = [s for s in await db.physicians.distinct("state") if s]
    docs = []
    for st in states:
        cities = await db.physicians.distinct("city", {"state": st})
        su = str(st).strip().upper()
        for cty in cities:
            if not cty:
                continue
            cen = _CITY_CENTROID.get((su, str(cty).strip().upper()))
            if not cen:
                continue
            docs.append({"state": st, "city": cty, "lat": cen[0], "lon": cen[1]})
    if docs:
        await db.med_city_geo.delete_many({})
        for i in range(0, len(docs), 5000):
            await db.med_city_geo.insert_many(docs[i:i + 5000])
    global _CITY_CACHE
    _CITY_CACHE = docs
    return {"built": True, "cities": len(docs)}


async def _load_city_cache() -> list:
    global _CITY_CACHE
    if _CITY_CACHE is None:
        _CITY_CACHE = await db.med_city_geo.find({}, {"_id": 0}).to_list(200000)
    return _CITY_CACHE


async def provider_cities_in_radius(lat, lon, radius_mi) -> list:
    """Provider (state, city) rows whose centroid is within radius_mi, nearest first."""
    cache = await _load_city_cache()
    out = []
    for d in cache:
        dist = haversine_mi(lat, lon, d["lat"], d["lon"])
        if dist <= radius_mi:
            out.append({"state": d["state"], "city": d["city"], "lat": d["lat"],
                        "lon": d["lon"], "distance_mi": round(dist, 1)})
    out.sort(key=lambda x: x["distance_mi"])
    return out


def radius_city_filter(cities: list):
    """Mongo $or of {state, city:{$in}} for the given radius cities (provider casing)."""
    by_state: dict = {}
    for c in cities:
        by_state.setdefault(c["state"], []).append(c["city"])
    if not by_state:
        return None
    return {"$or": [{"state": s, "city": {"$in": cl}} for s, cl in by_state.items()]}
