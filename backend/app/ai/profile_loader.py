"""
Bot rank profile loader.

Profiles used to be hardcoded as Python dicts in `move_selector.py`. They now
live in `data/profiles/*.yaml` so the b20 → b28 model swap (feature 20) is a
YAML-edit + match-run loop instead of a Python-edit + restart loop.

Selection of which YAML to load:
  1. env `CALIBRATION_PROFILE_PATH` if set (absolute or relative to CWD)
  2. default to `<repo_root>/data/profiles/b20.yaml`

The structure is `profiles[board_size_str][rank] -> dict of knobs`, where
`board_size_str` is `"5x5" | "9x9" | "13x13" | "19x19"`. Lookup falls back to
the 19x19 profile for that rank when there's no size-specific override
(matches the previous Python behavior in `RANK_PROFILES_BY_SIZE`).
"""

from __future__ import annotations
import logging
import os
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

# Profile knobs that every rank profile must define. These are the ones
# `move_selector.py` reads without a `.get(..., default)` — missing them
# would crash the bot at runtime, so we want a clean error at load time.
REQUIRED_KEYS: tuple[str, ...] = (
    "max_point_loss",
    "mistake_freq",
    "policy_weight",
    "randomness",
    "random_move_chance",
    "local_bias",
    "first_line_chance",
    "visits",
    "min_candidates",
    "opening_moves",
)

# Knobs that are read with a default in move_selector.py — present in some
# profiles, absent in others. Listed here so the validator can type-check
# them when they ARE present without requiring them.
OPTIONAL_KEYS: dict[str, type] = {
    "pass_threshold": float,
    "clarity_prior": float,
    "clarity_score_gap": float,
    "local_bias_in_opening": bool,
    "save_atari_chance": float,
    "capture_chance": float,
    "use_katago": bool,
}

SUPPORTED_SIZES: tuple[int, ...] = (5, 9, 13, 19)
FALLBACK_RANK: str = "15k"


def _default_profile_path() -> Path:
    """Repo-root-anchored path to the default b20 YAML.

    This module sits at backend/app/ai/profile_loader.py, so parents[3] is
    the repo root regardless of CWD or how the backend is launched.
    """
    return Path(__file__).resolve().parents[3] / "data" / "profiles" / "b20.yaml"


def _resolve_path() -> Path:
    env = os.environ.get("CALIBRATION_PROFILE_PATH")
    if env:
        return Path(env).expanduser().resolve()
    return _default_profile_path()


def _validate_profile(size: int, rank: str, profile: dict) -> None:
    """Raise ValueError on missing required keys or obvious type errors.

    We deliberately don't bound-check ranges — calibration explores values
    aggressively, and a real out-of-bounds value will surface in match
    results, not at load time.
    """
    where = f"{size}x{size}/{rank}"
    if not isinstance(profile, dict):
        raise ValueError(f"profile {where} is not a mapping: {type(profile).__name__}")

    missing = [k for k in REQUIRED_KEYS if k not in profile]
    if missing:
        raise ValueError(f"profile {where} missing required keys: {missing}")

    for k, v in profile.items():
        if k in REQUIRED_KEYS:
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise ValueError(f"profile {where}.{k} must be a number, got {type(v).__name__}")
        elif k in OPTIONAL_KEYS:
            expected = OPTIONAL_KEYS[k]
            if expected is bool:
                if not isinstance(v, bool):
                    raise ValueError(f"profile {where}.{k} must be a bool, got {type(v).__name__}")
            else:
                if not isinstance(v, (int, float)) or isinstance(v, bool):
                    raise ValueError(f"profile {where}.{k} must be a number, got {type(v).__name__}")
        else:
            logger.warning(f"profile {where}: unknown knob '{k}' (will be ignored unless move_selector reads it)")


def _parse_size_key(key: str) -> int:
    """Parse '19x19' / '13x13' / '9x9' / '5x5' -> int."""
    if "x" not in key:
        raise ValueError(f"board-size key '{key}' must look like '19x19'")
    a, b = key.split("x", 1)
    if a != b:
        raise ValueError(f"board-size key '{key}' must be square (NxN)")
    return int(a)


def _load_from_path(path: Path) -> dict[int, dict[str, dict]]:
    if not path.exists():
        raise FileNotFoundError(f"profile YAML not found: {path}")

    with path.open("r") as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict) or "profiles" not in data:
        raise ValueError(f"{path}: top-level 'profiles' key missing")

    raw = data["profiles"]
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: 'profiles' must be a mapping")

    out: dict[int, dict[str, dict]] = {}
    for size_key, ranks in raw.items():
        size = _parse_size_key(str(size_key))
        if size not in SUPPORTED_SIZES:
            raise ValueError(f"{path}: unsupported board size {size}x{size} (allowed: {SUPPORTED_SIZES})")
        if not isinstance(ranks, dict):
            raise ValueError(f"{path}: profiles.{size_key} must be a mapping of rank -> profile")

        size_table: dict[str, dict] = {}
        for rank, profile in ranks.items():
            _validate_profile(size, str(rank), profile)
            size_table[str(rank)] = dict(profile)
        out[size] = size_table

    if 19 not in out or FALLBACK_RANK not in out[19]:
        raise ValueError(
            f"{path}: 19x19/{FALLBACK_RANK} profile is required as the universal fallback"
        )

    return out


# Cached on first access. `reload()` clears it for tests / hot-reload.
_cache: Optional[dict[int, dict[str, dict]]] = None
_cache_path: Optional[Path] = None


def _ensure_loaded() -> dict[int, dict[str, dict]]:
    global _cache, _cache_path
    if _cache is None:
        path = _resolve_path()
        logger.info(f"loading bot profiles from {path}")
        _cache = _load_from_path(path)
        _cache_path = path
    return _cache


def reload() -> Path:
    """Drop the cache and reload from disk. Returns the path that was loaded."""
    global _cache, _cache_path
    _cache = None
    _cache_path = None
    _ensure_loaded()
    assert _cache_path is not None
    return _cache_path


def loaded_path() -> Optional[Path]:
    """Path the current cache was loaded from (None if not loaded yet)."""
    return _cache_path


def all_profiles() -> dict[int, dict[str, dict]]:
    """Return the full {size: {rank: profile}} table. Read-only — copy if mutating."""
    return _ensure_loaded()


def profiles_for_size(size: int) -> dict[str, dict]:
    """Return the {rank: profile} table for a given board size, or {} if none."""
    return _ensure_loaded().get(size, {})


def get_profile(rank: str, size: int = 19) -> dict:
    """Look up the bot tuning profile for a rank and board size.

    Falls back to the 19x19 profile for the same rank if no size-specific
    override exists; falls back to 19x19/15k as a last resort. Matches the
    behavior of the old hardcoded `RANK_PROFILES_BY_SIZE` lookup.
    """
    table = _ensure_loaded()
    sized = table.get(size)
    if sized and rank in sized:
        return sized[rank]
    big = table.get(19, {})
    if rank in big:
        return big[rank]
    return big[FALLBACK_RANK]
