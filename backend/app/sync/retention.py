"""
The retention cleanup (feature plan 32, Revision 3).

The app lifespan runs `run_cleanup` once at start-up and then keeps
`cleanup_daily` running in the background: every CLEANUP_INTERVAL_S it
deletes the profiles that have had no device for the retention period (see
storage.delete_abandoned_players).

The clock is passed in, and the sleep is looked up on this module at call
time, so tests drive a day of waiting without waiting.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from app.sync import storage

CLEANUP_INTERVAL_S = 24 * 3600

_log = logging.getLogger(__name__)
_sleep = asyncio.sleep


async def run_cleanup(now: float) -> int:
    deleted = await storage.delete_abandoned_players(now)
    if deleted:
        _log.info("Sync cleanup deleted %d profile(s) left without a device", deleted)
    return deleted


async def cleanup_daily(clock: Callable[[], float]) -> None:
    """Sleep a day, clean up, repeat, until cancelled. A failed run is logged
    and the next one comes a day later."""
    while True:
        await _sleep(CLEANUP_INTERVAL_S)
        try:
            await run_cleanup(clock())
        except Exception:
            _log.exception("Sync cleanup failed; the next run is in 24 hours")
