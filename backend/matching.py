"""Identity matching. Name-only matching is dangerous (56 John Lees), so this
module prefers direct NPI capture (with a real checksum) and records a collision
count so the dashboard can distinguish confirmed / probable / unresolved."""


def npi_is_valid(npi: str) -> bool:
    """Standard NPI checksum: Luhn over '80840' + first 9 digits, compare 10th."""
    if not npi or len(npi) != 10 or not npi.isdigit():
        return False
    base = "80840" + npi[:9]
    total = 0
    for i, ch in enumerate(reversed(base)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    check = (10 - (total % 10)) % 10
    return check == int(npi[9])


def match_status_from_collisions(count: int) -> str:
    if count <= 0:
        return "unresolved"
    if count == 1:
        return "confirmed"
    if 2 <= count <= 4:
        return "probable"
    return "unresolved"


def is_matched(status: str) -> bool:
    """confirmed/probable count as matched for scoring. unresolved => GREY."""
    return status in ("confirmed", "probable")
