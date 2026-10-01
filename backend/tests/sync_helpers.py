"""Helpers for the sync tests (test_sync_*.py); fixtures live in conftest.py."""


class FakeClock:
    """Stands in for the sync router's clock; tests move time by hand."""

    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


DEFAULT_STATE = {"schema": 1, "lessons": ["intro"], "avatar": "comet"}


async def new_player(client, state=None, headers=None):
    """Create a record; returns (response body, auth headers)."""
    state = DEFAULT_STATE if state is None else state
    r = await client.post("/api/sync/players", json={"state": state}, headers=headers or {})
    assert r.status_code == 201, r.text
    body = r.json()
    return body, bearer(body["device_token"])


def replay(sgf: str = "(;GM[1]SZ[9];B[ee])", **extra) -> dict:
    return {"sgf": sgf, "result": "Black wins by 5.5", **extra}


def iso(n: int) -> str:
    """A distinct, sortable ISO 8601 date per n (n minutes after a base time)."""
    day, minute = divmod(n, 24 * 60)
    hour, minute = divmod(minute, 60)
    return f"2026-{1 + day // 28:02d}-{1 + day % 28:02d}T{hour:02d}:{minute:02d}:00.000Z"
