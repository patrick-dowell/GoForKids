"""
SQLite storage for synced player records (feature plan 32).

A record has no account behind it: a player row (a revision counter plus an
opaque state document), one hashed token per linked device, the player's
replay library, and short-lived pairing codes that let a second device join.

Every table is prefixed `sync_` and none references the legacy `players` /
`games` tables in app.game.storage, so the record can move to its own file
by pointing GOFORKIDS_SYNC_DB elsewhere.

Functions take `now` (epoch seconds) from the caller instead of reading the
clock, so the router's injectable clock governs code expiry, last-seen times
and the retention cleanup too.

Retention (plan 32, Revision 3): nothing a device does deletes a profile. A
profile whose last device row goes gets `no_device_since`; a login clears
it; `delete_abandoned_players` removes a profile only once that timestamp is
RETENTION_S old and the profile still has no device.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import AsyncIterator, Mapping, Optional

import aiosqlite

from app.uploads.storage import SHARE_ID_ALPHABET

PAIRING_CODE_LENGTH = 8
PAIRING_CODE_TTL_S = 10 * 60
REPLAY_CAP = 100
# A profile with no device for this long is deleted by the cleanup.
RETENTION_S = 30 * 24 * 3600
# A device's last-seen time is written at most this often.
LAST_SEEN_EVERY_S = 60


def resolve_db_path(env: Mapping[str, str] = os.environ) -> str:
    """GOFORKIDS_SYNC_DB, else GOFORKIDS_DB, else goforkids.db."""
    return env.get("GOFORKIDS_SYNC_DB") or env.get("GOFORKIDS_DB") or "goforkids.db"


# Read at call time by every function below, so tests can monkeypatch it.
DB_PATH = resolve_db_path()


def hash_token(token: str) -> str:
    """The only form of a device token the database ever sees."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def new_pairing_code() -> str:
    return "".join(secrets.choice(SHARE_ID_ALPHABET) for _ in range(PAIRING_CODE_LENGTH))


def new_device_id() -> str:
    return str(uuid.uuid4())


def iso_utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect() -> aiosqlite.Connection:
    # Autocommit mode: the multi-statement writes open their own
    # BEGIN IMMEDIATE, so a check and the write it guards share one
    # transaction and a second writer waits on the lock instead of racing.
    return aiosqlite.connect(DB_PATH, isolation_level=None)


@asynccontextmanager
async def _write_txn() -> AsyncIterator[aiosqlite.Connection]:
    async with _connect() as db:
        await db.execute("BEGIN IMMEDIATE")
        try:
            yield db
        except BaseException:
            await db.execute("ROLLBACK")
            raise
        await db.execute("COMMIT")


# Columns added after the first schema. Startup adds any that are missing, so
# a file written by an earlier build keeps working; a fresh file gets them the
# same way. Each create key is stored only as its SHA-256: on the player it
# names (unique), and on every device token a create with that key issued.
# Revision 3 adds a player's `no_device_since` and a device's public id and
# last-seen time (both epoch seconds; null until set).
_ADDED_COLUMNS = (
    ("sync_players", "create_key_hash", "TEXT"),
    ("sync_devices", "create_key_hash", "TEXT"),
    ("sync_players", "no_device_since", "REAL"),
    ("sync_devices", "device_id", "TEXT"),
    ("sync_devices", "last_seen_at", "REAL"),
)


async def init_sync_db(now: Optional[float] = None) -> None:
    """Create the four sync_ tables and bring an older file up to date.
    Called from the app lifespan with the start-up time.

    Device rows written before Revision 3 get a device id. A profile that
    already has no device and no `no_device_since` gets `now`, so it has the
    full retention period from this start-up.
    """
    now = time.time() if now is None else now
    async with _write_txn() as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sync_players (
                id TEXT PRIMARY KEY,
                rev INTEGER NOT NULL,
                state TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sync_devices (
                token_hash TEXT PRIMARY KEY,
                player_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sync_games (
                player_id TEXT NOT NULL,
                game_id TEXT NOT NULL,
                date TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (player_id, game_id)
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS sync_games_by_date
            ON sync_games (player_id, date DESC, game_id DESC)
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sync_pairing_codes (
                code TEXT PRIMARY KEY,
                player_id TEXT NOT NULL,
                expires_at REAL NOT NULL,
                used INTEGER NOT NULL DEFAULT 0
            )
        """)
        for table, column, decl in _ADDED_COLUMNS:
            async with db.execute(f"PRAGMA table_info({table})") as cur:
                existing = {row[1] for row in await cur.fetchall()}
            if column not in existing:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        await db.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS sync_players_by_create_key
            ON sync_players (create_key_hash)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS sync_devices_by_create_key
            ON sync_devices (create_key_hash)
        """)
        async with db.execute(
            "SELECT token_hash FROM sync_devices WHERE device_id IS NULL"
        ) as cur:
            unnamed = [row[0] for row in await cur.fetchall()]
        for token_hash in unnamed:
            await db.execute(
                "UPDATE sync_devices SET device_id = ? WHERE token_hash = ?",
                (new_device_id(), token_hash),
            )
        await db.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS sync_devices_by_device_id
            ON sync_devices (device_id)
        """)
        await db.execute(
            f"""UPDATE sync_players SET no_device_since = ?
                WHERE no_device_since IS NULL AND {_HAS_NO_DEVICE}""",
            (now,),
        )


# True of a sync_players row with no device row left.
_HAS_NO_DEVICE = (
    "NOT EXISTS (SELECT 1 FROM sync_devices d WHERE d.player_id = sync_players.id)"
)
# True of a profile the cleanup may delete, given the cutoff: its last device
# went at or before it, and it has no device now.
_ABANDONED = f"no_device_since <= ? AND {_HAS_NO_DEVICE}"


async def _stamp_if_deviceless(db: aiosqlite.Connection, player_id: str, now: float) -> None:
    """After a device row goes: start the player's retention clock when that
    was its last device. A clock already running keeps its start."""
    await db.execute(
        f"""UPDATE sync_players SET no_device_since = ?
            WHERE id = ? AND no_device_since IS NULL AND {_HAS_NO_DEVICE}""",
        (now, player_id),
    )


# ── Players and devices ──────────────────────────────────────────────


async def _add_device(
    db: aiosqlite.Connection, player_id: str, now: float, key_hash: Optional[str] = None
) -> str:
    """Every login goes through here, so this is also where a profile's
    retention clock stops."""
    token = new_device_token()
    await db.execute(
        """INSERT INTO sync_devices
           (token_hash, player_id, created_at, create_key_hash, device_id, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (hash_token(token), player_id, iso_utc(now), key_hash, new_device_id(), now),
    )
    await db.execute(
        "UPDATE sync_players SET no_device_since = NULL WHERE id = ?", (player_id,)
    )
    return token


@dataclass
class CreatedPlayer:
    player_id: str
    device_token: str  # not recoverable afterwards
    rev: int
    state_json: str
    created: bool  # False when a create key matched an existing player


async def create_player(
    state_json: str, now: float, create_key: Optional[str] = None
) -> CreatedPlayer:
    """Create a record at revision 1 with its first device.

    With a create key already used by an earlier create, make no record:
    revoke every token that creates with that key issued, issue a fresh one
    for the same player, and return the player's current revision and state
    (the given state is ignored). The lookup and the write share one
    transaction, so concurrent creates with one key make one player.
    """
    key_hash = hash_token(create_key) if create_key is not None else None
    stamp = iso_utc(now)
    async with _write_txn() as db:
        if key_hash is not None:
            async with db.execute(
                "SELECT id, rev, state FROM sync_players WHERE create_key_hash = ?",
                (key_hash,),
            ) as cur:
                row = await cur.fetchone()
            if row is not None:
                player_id, rev, current_json = row
                await db.execute(
                    "DELETE FROM sync_devices WHERE player_id = ? AND create_key_hash = ?",
                    (player_id, key_hash),
                )
                token = await _add_device(db, player_id, now, key_hash)
                return CreatedPlayer(player_id, token, rev, current_json, created=False)
        player_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO sync_players (id, rev, state, created_at, updated_at, create_key_hash)
               VALUES (?, 1, ?, ?, ?, ?)""",
            (player_id, state_json, stamp, stamp, key_hash),
        )
        token = await _add_device(db, player_id, now, key_hash)
    return CreatedPlayer(player_id, token, 1, state_json, created=True)


async def authenticate(token: str, now: float) -> Optional[tuple[str, str]]:
    """(player_id, device_id) for a live token, or None. Records the device
    as seen at `now`, writing at most once per LAST_SEEN_EVERY_S."""
    token_hash = hash_token(token)
    async with _connect() as db:
        async with db.execute(
            "SELECT player_id, device_id, last_seen_at FROM sync_devices WHERE token_hash = ?",
            (token_hash,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        player_id, device_id, last_seen_at = row
        if last_seen_at is None or now - last_seen_at >= LAST_SEEN_EVERY_S:
            await db.execute(
                "UPDATE sync_devices SET last_seen_at = ? WHERE token_hash = ?",
                (now, token_hash),
            )
    return player_id, device_id


async def revoke_device(token: str, now: float) -> None:
    """Log out: the token stops working. The profile stays, even when this
    was its last device; then its retention clock starts."""
    token_hash = hash_token(token)
    async with _write_txn() as db:
        async with db.execute(
            "SELECT player_id FROM sync_devices WHERE token_hash = ?", (token_hash,)
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return
        await db.execute("DELETE FROM sync_devices WHERE token_hash = ?", (token_hash,))
        await _stamp_if_deviceless(db, row[0], now)


# ── State document ───────────────────────────────────────────────────


async def get_state(player_id: str) -> Optional[tuple[int, str]]:
    """(rev, state_json) for the player, or None."""
    async with _connect() as db:
        async with db.execute(
            "SELECT rev, state FROM sync_players WHERE id = ?", (player_id,)
        ) as cur:
            row = await cur.fetchone()
    return (row[0], row[1]) if row else None


async def put_state(
    player_id: str, base_rev: int, state_json: str, now: float
) -> tuple[bool, int, str]:
    """Compare-and-write. Writes only when base_rev is the stored revision.

    Returns (written, rev, state_json): on success the new revision and the
    written state, on conflict the server's current revision and state.
    """
    async with _write_txn() as db:
        cur = await db.execute(
            """UPDATE sync_players SET rev = rev + 1, state = ?, updated_at = ?
               WHERE id = ? AND rev = ?""",
            (state_json, iso_utc(now), player_id, base_rev),
        )
        written = cur.rowcount == 1
        async with db.execute(
            "SELECT rev, state FROM sync_players WHERE id = ?", (player_id,)
        ) as sel:
            row = await sel.fetchone()
    return written, row[0], row[1]


# ── Pairing codes ────────────────────────────────────────────────────


async def _mint_code(
    db: aiosqlite.Connection, player_id: str, now: float, expires_at: float
) -> tuple[str, float]:
    # Expired rows are dead weight; clearing them also frees their codes.
    await db.execute("DELETE FROM sync_pairing_codes WHERE expires_at <= ?", (now,))
    # Only the newest code is live, whoever minted the earlier ones.
    await db.execute(
        "UPDATE sync_pairing_codes SET used = 1 WHERE player_id = ? AND used = 0",
        (player_id,),
    )
    for _ in range(5):
        code = new_pairing_code()
        try:
            await db.execute(
                """INSERT INTO sync_pairing_codes (code, player_id, expires_at, used)
                   VALUES (?, ?, ?, 0)""",
                (code, player_id, expires_at),
            )
            return code, expires_at
        except aiosqlite.IntegrityError:
            continue
    raise RuntimeError("could not allocate a unique pairing code")


async def mint_pairing_code(player_id: str, now: float) -> tuple[str, float]:
    """A device's code for its own player: PAIRING_CODE_TTL_S long, and it
    cancels the player's earlier unused codes. Returns (code, expires_at)."""
    async with _write_txn() as db:
        return await _mint_code(db, player_id, now, now + PAIRING_CODE_TTL_S)


async def mint_admin_pairing_code(
    player_id: str, now: float, expires_at: float
) -> Optional[tuple[str, float]]:
    """An admin's code for any player, with the expiry the admin chose (the
    caller checks its bounds). None when the player does not exist."""
    async with _write_txn() as db:
        if not await _player_exists(db, player_id):
            return None
        return await _mint_code(db, player_id, now, expires_at)


async def redeem_pairing_code(code: str, now: float) -> Optional[tuple[str, str, int, str]]:
    """Spend a live code and link a new device to its player.

    Returns (player_id, device_token, rev, state_json), or None when the code
    is unknown, expired or already used (the caller does not distinguish).
    """
    async with _write_txn() as db:
        cur = await db.execute(
            """UPDATE sync_pairing_codes SET used = 1
               WHERE code = ? AND used = 0 AND expires_at > ?""",
            (code, now),
        )
        if cur.rowcount != 1:
            return None
        async with db.execute(
            """SELECT p.id, p.rev, p.state FROM sync_pairing_codes c
               JOIN sync_players p ON p.id = c.player_id WHERE c.code = ?""",
            (code,),
        ) as sel:
            row = await sel.fetchone()
        if row is None:
            return None
        player_id, rev, state_json = row
        token = await _add_device(db, player_id, now)
    return player_id, token, rev, state_json


# ── Replay library ───────────────────────────────────────────────────

# Newest first: ISO 8601 dates sort as strings; ties go to the larger id.
_NEWEST_FIRST = "ORDER BY date DESC, game_id DESC"


async def list_games(player_id: str) -> list[tuple[str, str]]:
    """[(game_id, date)] newest first."""
    async with _connect() as db:
        async with db.execute(
            f"SELECT game_id, date FROM sync_games WHERE player_id = ? {_NEWEST_FIRST}",
            (player_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [(r[0], r[1]) for r in rows]


async def get_game(player_id: str, game_id: str) -> Optional[tuple[str, str]]:
    """(date, payload_json) or None."""
    async with _connect() as db:
        async with db.execute(
            "SELECT date, payload FROM sync_games WHERE player_id = ? AND game_id = ?",
            (player_id, game_id),
        ) as cur:
            row = await cur.fetchone()
    return (row[0], row[1]) if row else None


async def put_game(
    player_id: str, game_id: str, date: str, payload_json: str, now: float
) -> bool:
    """Store (or replace) a replay, then trim the player's library to the
    newest REPLAY_CAP. Returns whether this game survived the trim."""
    async with _write_txn() as db:
        await db.execute(
            """INSERT OR REPLACE INTO sync_games
               (player_id, game_id, date, payload, updated_at) VALUES (?, ?, ?, ?, ?)""",
            (player_id, game_id, date, payload_json, iso_utc(now)),
        )
        await db.execute(
            f"""DELETE FROM sync_games WHERE player_id = ? AND game_id NOT IN (
                    SELECT game_id FROM sync_games WHERE player_id = ?
                    {_NEWEST_FIRST} LIMIT ?)""",
            (player_id, player_id, REPLAY_CAP),
        )
        async with db.execute(
            "SELECT 1 FROM sync_games WHERE player_id = ? AND game_id = ?",
            (player_id, game_id),
        ) as cur:
            kept = await cur.fetchone() is not None
    return kept


async def delete_game(player_id: str, game_id: str) -> None:
    async with _connect() as db:
        await db.execute(
            "DELETE FROM sync_games WHERE player_id = ? AND game_id = ?",
            (player_id, game_id),
        )


# ── Admin ────────────────────────────────────────────────────────────


async def _player_exists(db: aiosqlite.Connection, player_id: str) -> bool:
    async with db.execute("SELECT 1 FROM sync_players WHERE id = ?", (player_id,)) as cur:
        return await cur.fetchone() is not None


async def admin_create_player(state_json: str, now: float) -> str:
    """A profile with no device yet, so its retention clock starts now.
    Returns the new player id."""
    player_id = str(uuid.uuid4())
    stamp = iso_utc(now)
    async with _write_txn() as db:
        await db.execute(
            """INSERT INTO sync_players (id, rev, state, created_at, updated_at, no_device_since)
               VALUES (?, 1, ?, ?, ?, ?)""",
            (player_id, state_json, stamp, stamp, now),
        )
    return player_id


@dataclass
class DeviceSummary:
    device_id: str
    created_at: str
    last_seen_at: Optional[float]


@dataclass
class PlayerSummary:
    player_id: str
    state_json: str
    created_at: str
    updated_at: str
    no_device_since: Optional[float]
    devices: list[DeviceSummary]
    replays: int


async def list_players() -> list[PlayerSummary]:
    """Every profile, most recently updated first, with its devices (oldest
    first) and replay count. Never carries a token hash."""
    async with _connect() as db:
        async with db.execute(
            """SELECT id, state, created_at, updated_at, no_device_since FROM sync_players
               ORDER BY updated_at DESC, created_at DESC, id"""
        ) as cur:
            players = await cur.fetchall()
        async with db.execute(
            """SELECT player_id, device_id, created_at, last_seen_at FROM sync_devices
               ORDER BY created_at, rowid"""
        ) as cur:
            device_rows = await cur.fetchall()
        async with db.execute(
            "SELECT player_id, COUNT(*) FROM sync_games GROUP BY player_id"
        ) as cur:
            replays = dict(await cur.fetchall())
    devices: dict[str, list[DeviceSummary]] = {}
    for player_id, device_id, created_at, last_seen_at in device_rows:
        devices.setdefault(player_id, []).append(
            DeviceSummary(device_id, created_at, last_seen_at)
        )
    return [
        PlayerSummary(
            player_id=pid,
            state_json=state_json,
            created_at=created_at,
            updated_at=updated_at,
            no_device_since=no_device_since,
            devices=devices.get(pid, []),
            replays=replays.get(pid, 0),
        )
        for pid, state_json, created_at, updated_at, no_device_since in players
    ]


async def remove_device(device_id: str, now: float) -> bool:
    """Revoke one device by its public id, as a log out would. False when no
    such device exists."""
    async with _write_txn() as db:
        async with db.execute(
            "SELECT player_id FROM sync_devices WHERE device_id = ?", (device_id,)
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return False
        await db.execute("DELETE FROM sync_devices WHERE device_id = ?", (device_id,))
        await _stamp_if_deviceless(db, row[0], now)
    return True


async def remove_player_devices(player_id: str, now: float) -> bool:
    """Revoke every device of a player. False when no such player exists;
    True also when it had no device."""
    async with _write_txn() as db:
        if not await _player_exists(db, player_id):
            return False
        await db.execute("DELETE FROM sync_devices WHERE player_id = ?", (player_id,))
        await _stamp_if_deviceless(db, player_id, now)
    return True


# ── Retention ────────────────────────────────────────────────────────


async def abandoned_player_ids(now: float) -> list[str]:
    """The cleanup's candidates: profiles whose last device went RETENTION_S
    or more ago and that have no device. A read only; the deleting
    transaction checks each one again."""
    async with _connect() as db:
        async with db.execute(
            f"SELECT id FROM sync_players WHERE {_ABANDONED}", (now - RETENTION_S,)
        ) as cur:
            return [row[0] for row in await cur.fetchall()]


async def delete_abandoned_players(now: float) -> int:
    """Delete each abandoned profile with its replays and codes. The deleting
    transaction re-checks both conditions per profile, so a login (or any
    new device row) that lands after the candidates were chosen keeps its
    profile. Returns the count deleted."""
    cutoff = now - RETENTION_S
    candidates = await abandoned_player_ids(now)
    deleted = 0
    async with _write_txn() as db:
        for player_id in candidates:
            cur = await db.execute(
                f"DELETE FROM sync_players WHERE id = ? AND {_ABANDONED}",
                (player_id, cutoff),
            )
            if cur.rowcount != 1:
                continue
            await db.execute("DELETE FROM sync_games WHERE player_id = ?", (player_id,))
            await db.execute("DELETE FROM sync_pairing_codes WHERE player_id = ?", (player_id,))
            deleted += 1
    return deleted
