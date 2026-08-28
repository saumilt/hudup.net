"""Denormalize 340B/RPM tiers onto physician records so Medicare Search and the
CRM filter builder can query/sort by tier fast. Recomputed at finalize, at the
2024 migration, and (in the background) whenever scoring thresholds change."""
from pymongo import UpdateOne

from deps import db, get_thresholds
from scoring import score_340b, score_rpm, tier_color_340b


async def recompute_tiers(session_id: str, thresholds: dict | None = None) -> int:
    if thresholds is None:
        thresholds = await get_thresholds()
    cursor = db.physicians.find(
        {"session_id": session_id},
        {"avg_per_claim": 1, "tot_cost": 1, "tot_clms": 1, "specialty": 1},
    )
    batch, n = [], 0
    async for p in cursor:
        clms = p.get("tot_clms", 0) or 0
        cost = p.get("tot_cost", 0) or 0
        avg = p.get("avg_per_claim")
        if avg is None:
            avg = (cost / clms) if clms else 0
        t340 = score_340b(True, avg, cost, thresholds)
        shade, _hex = tier_color_340b(t340, avg)
        trpm = score_rpm(True, clms, p.get("specialty"))
        batch.append(UpdateOne(
            {"_id": p["_id"]},
            {"$set": {"tier_340b": t340, "shade_340b": shade, "tier_rpm": trpm,
                      "avg_per_claim": avg}},
        ))
        if len(batch) >= 2000:
            await db.physicians.bulk_write(batch, ordered=False)
            n += len(batch)
            batch = []
    if batch:
        await db.physicians.bulk_write(batch, ordered=False)
        n += len(batch)
    return n
