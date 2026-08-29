"""Wave 10 — Sales forecasting & pipeline dashboard."""
from fastapi import APIRouter, Depends
from deps import db, require_roles
from crm_common import DEFAULT_OPP_STAGES

router = APIRouter(prefix="/api/crm")
MANAGER = require_roles("lead_manager")

# Win-probability weighting per stage.
STAGE_PROB = {
    "Discovery": 0.10, "Qualification": 0.25, "Proposal": 0.50,
    "Negotiation": 0.75, "Closed Won": 1.0, "Closed Lost": 0.0,
}
OPEN_STAGES = [s for s in DEFAULT_OPP_STAGES if s not in ("Closed Won", "Closed Lost")]


@router.get("/forecast")
async def forecast(user=Depends(MANAGER)):
    opps = await db.crm_opportunities.find({}, {"_id": 0}).to_list(2000)
    by_stage = {s: {"count": 0, "value": 0.0} for s in OPEN_STAGES}
    weighted = 0.0
    open_value = 0.0
    won_count = won_value = lost_count = 0
    for o in opps:
        stage = o.get("stage")
        val = float(o.get("value") or 0)
        status = o.get("status")
        if status == "won":
            won_count += 1
            won_value += val
        elif status == "lost":
            lost_count += 1
        else:
            if stage in by_stage:
                by_stage[stage]["count"] += 1
                by_stage[stage]["value"] += val
            open_value += val
            weighted += val * STAGE_PROB.get(stage, 0.1)
    decided = won_count + lost_count
    win_rate = round(100 * won_count / decided, 1) if decided else 0
    avg_deal = round(won_value / won_count) if won_count else 0
    # Per-owner rollup.
    owners = {}
    users = {u["id"]: u.get("name") for u in await db.users.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    for o in opps:
        oid = o.get("owner_id")
        r = owners.setdefault(oid, {"owner_id": oid, "name": users.get(oid, "Unassigned"),
                                    "open": 0, "open_value": 0.0, "weighted": 0.0, "won_value": 0.0})
        val = float(o.get("value") or 0)
        if o.get("status") == "won":
            r["won_value"] += val
        elif o.get("status") != "lost":
            r["open"] += 1
            r["open_value"] += val
            r["weighted"] += val * STAGE_PROB.get(o.get("stage"), 0.1)
    return {
        "pipeline_value": round(open_value),
        "weighted_forecast": round(weighted),
        "won_value": round(won_value),
        "win_rate": win_rate,
        "avg_deal_size": avg_deal,
        "won_count": won_count,
        "lost_count": lost_count,
        "by_stage": [{"stage": s, "count": by_stage[s]["count"], "value": round(by_stage[s]["value"]),
                      "prob": int(STAGE_PROB.get(s, 0) * 100)} for s in OPEN_STAGES],
        "by_owner": sorted(owners.values(), key=lambda r: r["weighted"], reverse=True),
    }
