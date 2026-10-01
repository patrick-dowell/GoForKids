"""
In-memory sliding-window rate limit, keyed by client address.

The caller passes `now`, so the clock is whatever the caller injects; tests
advance a fake clock instead of sleeping. Counts live in one process: with
several workers, each keeps its own.
"""

from __future__ import annotations

from collections import deque
from typing import Deque, Dict, Optional

# Past this many tracked addresses, a hit also drops addresses whose
# window has fully elapsed, so one-off callers do not accumulate forever.
_SWEEP_THRESHOLD = 4096


class RateLimiter:
    def __init__(self, limit: int, window_s: float):
        self.limit = limit
        self.window_s = window_s
        self._hits: Dict[str, Deque[float]] = {}

    def hit(self, key: str, now: float) -> Optional[float]:
        """Count one request for `key` at time `now`.

        Returns None when the request is allowed (and counted), otherwise
        the seconds until the oldest counted request leaves the window. A
        refused request is not counted, so waiting out the window recovers.
        """
        cutoff = now - self.window_s
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return hits[0] + self.window_s - now
        hits.append(now)
        if len(self._hits) > _SWEEP_THRESHOLD:
            self._sweep(cutoff)
        return None

    def _sweep(self, cutoff: float) -> None:
        stale = [k for k, h in self._hits.items() if not h or h[-1] <= cutoff]
        for k in stale:
            del self._hits[k]

    def reset(self) -> None:
        self._hits.clear()
