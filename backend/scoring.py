"""Scoring logic for the two independent programs: 340B and RPM.

The doctor-facing kiosk NEVER sees any of this. Scores live server-side only.
"""

# All six 340B numbers are admin-editable (stored in settings, defaults here).
DEFAULT_THRESHOLDS = {
    "b340_green_apc": 4000,
    "b340_green_cost": 2000000,
    "b340_yellow_apc": 1000,
    "b340_yellow_cost": 1000000,
    "b340_red_apc": 1000,
    "b340_red_cost": 1000000,
}

# Chronic-care specialties get a 1.25x multiplier on claim volume for RPM.
CHRONIC_CARE_SPECIALTIES = [
    "internal medicine",
    "family practice",
    "general practice",
    "cardiology",
    "endocrinology",
    "nephrology",
    "geriatric medicine",
    "pulmonary disease",
    "nurse practitioner",
    "physician assistant",
]

RPM_MULTIPLIER = 1.25

# Base tier colors (hex) used on the dashboard bands and in SMS text.
TIER_HEX = {
    "GREEN": "#10B981",
    "YELLOW": "#F59E0B",
    "BLUE": "#3B82F6",
    "RED": "#EF4444",
    "GREY": "#CBD5E1",
}


def green_shade(avg_per_claim: float):
    """Within 340B GREEN, shade by avg per claim: $4k light -> $7k darker -> $10k+ darkest."""
    if avg_per_claim >= 10000:
        return ("GREEN++", "#047857")   # darkest green
    if avg_per_claim >= 7000:
        return ("GREEN+", "#10B981")    # darker green
    return ("GREEN", "#34D399")         # light green


def tier_color_340b(tier: str, avg_per_claim: float):
    """Return (shade_label, hex) for a 340B tier, applying green shading."""
    if tier == "GREEN":
        return green_shade(avg_per_claim or 0)
    return (tier, TIER_HEX.get(tier, "#CBD5E1"))



def is_chronic_care(specialty: str) -> bool:
    if not specialty:
        return False
    s = specialty.strip().lower()
    return any(c in s for c in CHRONIC_CARE_SPECIALTIES)


def score_340b(matched: bool, avg_per_claim: float, total_cost: float, t: dict) -> str:
    """Top-down evaluation, no fallthrough. GREY when the physician is unmatched."""
    if not matched:
        return "GREY"
    if avg_per_claim >= t["b340_green_apc"] and total_cost > t["b340_green_cost"]:
        return "GREEN"
    if avg_per_claim >= t["b340_yellow_apc"] and total_cost > t["b340_yellow_cost"]:
        return "YELLOW"
    if avg_per_claim < t["b340_red_apc"] and total_cost < t["b340_red_cost"]:
        return "RED"
    return "BLUE"


def score_rpm(matched: bool, total_claims: float, specialty: str) -> str:
    if not matched:
        return "GREY"
    adjusted = total_claims * (RPM_MULTIPLIER if is_chronic_care(specialty) else 1.0)
    if adjusted >= 8000:
        return "GREEN"
    if adjusted >= 3000:
        return "YELLOW"
    if adjusted >= 1000:
        return "BLUE"
    return "RED"


def tier_counts_for_thresholds(physicians: list, t: dict) -> dict:
    """Count how many live physicians fall into each 340B tier for calibration."""
    counts = {"GREEN": 0, "YELLOW": 0, "RED": 0, "BLUE": 0, "GREY": 0}
    for p in physicians:
        tier = score_340b(True, p.get("avg_per_claim", 0), p.get("tot_cost", 0), t)
        counts[tier] += 1
    return counts
