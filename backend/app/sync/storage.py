"""
SQLite storage for synced player records (feature plan 32).

A record has no account behind it: a player row (a revision counter plus an
opaque state document), one hashed token per linked device, the player's
replay library, and short-lived pairing codes that let a second device join.

Every table is prefixed `sync_` and none references the legacy `players` /
`games` tables in app.game.storage, so the record can move to its own file
by pointing GOFORKIDS_SYNC_DB elsewhere.

Functions take `now` (epoch seconds) from the caller instead of reading the
clock, so the router's injectable clock governs code expiry too.
"""

from __future__ import annotations

import hashlib
import os
import secrets
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
_ADDED_COLUMNS = (
    ("sync_players", "create_key_hash", "TEXT"),
    ("sync_devices", "create_key_hash", "TEXT"),
)


async def init_sync_db() -> None:
    """Create the four sync_ tables and bring an older file up to date.
    Called from the app lifespan."""
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


# ── Players and devices ──────────────────────────────────────────────


async def _add_device(
    db: aiosqlite.Connection, player_id: str, now: float, key_hash: Optional[str] = None
) -> str:
    token = new_device_token()
    await db.execute(
        """INSERT INTO sync_devices (token_hash, player_id, created_at, create_key_hash)
           VALUES (?, ?, ?, ?)""",
        (hash_token(token), player_id, iso_utc(now), key_hash),
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


async def player_for_token(token: str) -> Optional[str]:
    async with _connect() as db:
        async with db.execute(
            "SELECT player_id FROM sync_devices WHERE token_hash = ?", (hash_token(token),)
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row else None


async def revoke_device(token: str) -> None:
    async with _connect() as db:
        await db.execute("DELETE FROM sync_devices WHERE token_hash = ?", (hash_token(token),))


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


async def mint_pairing_code(player_id: str, now: float) -> tuple[str, float]:
    """Issue a fresh code for the player and cancel their earlier unused ones.
    Returns (code, expires_at)."""
    expires_at = now + PAIRING_CODE_TTL_S
    async with _write_txn() as db:
        # Expired rows are dead weight; clearing them also frees their codes.
        await db.execute("DELETE FROM sync_pairing_codes WHERE expires_at <= ?", (now,))
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
