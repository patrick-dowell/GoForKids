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

Friends (plan 32, Revision 4): every profile holds a unique friend code, and
`sync_friendships` holds at most one row per ordered pair of profiles, with
a status of pending, accepted or declined. Accepting deletes the other row
between the two, so a friendship is exactly one accepted row.

Names (plan 32, Revision 6): a generated name is unique across profiles.
`sync_players.handle` mirrors the state's `handle` as "a,n" (null when the
state has none) under a unique index; every write of a state sets it, and a
write whose handle another profile holds raises HandleTaken, checked inside
the writing transaction.
"""

from __future__ import annotations

import hashlib
import json
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
FRIEND_CODE_LENGTH = 8
REPLAY_CAP = 100
# A profile with no device for this long is deleted by the cleanup.
RETENTION_S = 30 * 24 * 3600
# A device's last-seen time is written at most this often.
LAST_SEEN_EVERY_S = 60

# What a device may say it is (the `X-Device-Kind` header). Not personal: the
# admin list shows it so a parent or teacher can tell an iPad row from a
# browser row. Anything else is ignored.
DEVICE_KINDS = ("iPad", "iPhone", "web")


def valid_device_kind(value: object) -> Optional[str]:
    return value if isinstance(value, str) and value in DEVICE_KINDS else None


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


def new_friend_code() -> str:
    return "".join(secrets.choice(SHARE_ID_ALPHABET) for _ in range(FRIEND_CODE_LENGTH))


def new_device_id() -> str:
    return str(uuid.uuid4())


# A generated name: one position in each of two 64-word lists (Revision 2).
HANDLE_WORDS = 64


class HandleTaken(Exception):
    """The state's handle is another profile's name (Revision 6)."""


def handle_key(value: object) -> Optional[str]:
    """The column form of a state's `handle`, "a,n", or None when the value
    is not a handle: a list of two integers from 0 to HANDLE_WORDS - 1.
    type() rather than isinstance(): a bool is an int to Python, not to JSON."""
    if (
        isinstance(value, list)
        and len(value) == 2
        and all(type(v) is int and 0 <= v < HANDLE_WORDS for v in value)
    ):
        return f"{value[0]},{value[1]}"
    return None


def _handle_of(state_json: str) -> Optional[str]:
    """The column form of the handle in a state document, or None."""
    try:
        state = json.loads(state_json)
    except ValueError:
        return None
    return handle_key(state.get("handle")) if isinstance(state, dict) else None


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
# last-seen time (both epoch seconds; null until set). Revision 4 adds the
# player's friend code (unique; given to older rows at start-up). Revision 6
# adds the player's handle, "a,n" (unique; filled from older rows' states at
# start-up).
_ADDED_COLUMNS = (
    ("sync_players", "create_key_hash", "TEXT"),
    ("sync_devices", "create_key_hash", "TEXT"),
    ("sync_players", "no_device_since", "REAL"),
    ("sync_devices", "device_id", "TEXT"),
    ("sync_devices", "last_seen_at", "REAL"),
    ("sync_players", "friend_code", "TEXT"),
    ("sync_devices", "kind", "TEXT"),
    ("sync_players", "handle", "TEXT"),
)


async def init_sync_db(now: Optional[float] = None) -> None:
    """Create the five sync_ tables and bring an older file up to date.
    Called from the app lifespan with the start-up time.

    Device rows written before Revision 3 get a device id. A profile that
    already has no device and no `no_device_since` gets `now`, so it has the
    full retention period from this start-up. A profile written before
    Revision 4 gets a friend code. A profile written before Revision 6 gets
    its handle column filled from its state (`_index_handles`).
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
            CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        # When this server began recording `last_seen_at`: a device row with
        # no stamp and an earlier `created_at` was last used before then,
        # not never. Written once, at the first start-up that knows the key.
        await db.execute(
            "INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_seen_since', ?)",
            (iso_utc(now),),
        )
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
        # Times are epoch seconds. `created_at` is when the request was first
        # sent; `updated_at` when its status last changed, which for an
        # accepted row is when the two became friends.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sync_friendships (
                requester_id TEXT NOT NULL,
                addressee_id TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                PRIMARY KEY (requester_id, addressee_id)
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS sync_friendships_by_addressee
            ON sync_friendships (addressee_id, status)
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
        await db.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS sync_players_by_friend_code
            ON sync_players (friend_code)
        """)
        async with db.execute("SELECT id FROM sync_players WHERE friend_code IS NULL") as cur:
            codeless = [row[0] for row in await cur.fetchall()]
        for player_id in codeless:
            await db.execute(
                "UPDATE sync_players SET friend_code = ? WHERE id = ?",
                (await _free_friend_code(db), player_id),
            )
        await _index_handles(db, now)


async def _free_friend_code(db: aiosqlite.Connection) -> str:
    """A friend code no profile holds. Called inside a write transaction, so
    nothing takes the code before the caller writes it; a code already held
    is retried with a new one."""
    for _ in range(5):
        code = new_friend_code()
        async with db.execute("SELECT 1 FROM sync_players WHERE friend_code = ?", (code,)) as cur:
            if await cur.fetchone() is None:
                return code
    raise RuntimeError("could not allocate a unique friend code")


async def _index_handles(db: aiosqlite.Connection, now: float) -> None:
    """Fill the handle column of every profile whose state names it and
    whose column is still empty (every profile, on the first start-up after
    Revision 6), then put the unique index on it.

    Oldest profile first (by `created_at`, then insertion order): the first
    to hold a name keeps it. Each later holder gets a free name, written to
    the column and into its state, with its revision raised by one, so each
    of its devices finds the server ahead at its next pass and takes the
    new name like any other change made elsewhere.
    """
    async with db.execute("SELECT handle FROM sync_players WHERE handle IS NOT NULL") as cur:
        held = {row[0] for row in await cur.fetchall()}
    async with db.execute(
        "SELECT id, state FROM sync_players WHERE handle IS NULL ORDER BY created_at, rowid"
    ) as cur:
        rows = await cur.fetchall()
    for player_id, state_json in rows:
        try:
            state = json.loads(state_json)
        except ValueError:
            continue
        handle = handle_key(state.get("handle")) if isinstance(state, dict) else None
        if handle is None:
            continue
        if handle not in held:
            await db.execute(
                "UPDATE sync_players SET handle = ? WHERE id = ?", (handle, player_id)
            )
        else:
            state["handle"] = _free_handle(held)
            handle = handle_key(state["handle"])
            await db.execute(
                """UPDATE sync_players SET handle = ?, state = ?, rev = rev + 1, updated_at = ?
                   WHERE id = ?""",
                (handle, _state_json(state), iso_utc(now), player_id),
            )
        held.add(handle)
    await db.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS sync_players_by_handle
        ON sync_players (handle)
    """)


def _free_handle(held: set[str]) -> list[int]:
    """A handle not in `held`, uniform over the free ones."""
    free = [
        [a, n]
        for a in range(HANDLE_WORDS)
        for n in range(HANDLE_WORDS)
        if f"{a},{n}" not in held
    ]
    if not free:
        raise RuntimeError("every generated name is taken")
    return secrets.choice(free)


def _state_json(state: dict) -> str:
    """A state document as the sync router writes it (compact, UTF-8)."""
    return json.dumps(state, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


async def _check_handle_free(
    db: aiosqlite.Connection, handle: Optional[str], player_id: Optional[str] = None
) -> None:
    """Raise HandleTaken when a profile other than `player_id` holds the
    handle. Called inside the transaction that then writes it, so no other
    write can take the name in between."""
    if handle is None:
        return
    async with db.execute(
        "SELECT 1 FROM sync_players WHERE handle = ? AND id IS NOT ?", (handle, player_id)
    ) as cur:
        if await cur.fetchone() is not None:
            raise HandleTaken(handle)


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
    db: aiosqlite.Connection,
    player_id: str,
    now: float,
    key_hash: Optional[str] = None,
    kind: Optional[str] = None,
) -> str:
    """Every login goes through here, so this is also where a profile's
    retention clock stops."""
    token = new_device_token()
    await db.execute(
        """INSERT INTO sync_devices
           (token_hash, player_id, created_at, create_key_hash, device_id, last_seen_at, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (hash_token(token), player_id, iso_utc(now), key_hash, new_device_id(), now,
         valid_device_kind(kind)),
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
    state_json: str,
    now: float,
    create_key: Optional[str] = None,
    kind: Optional[str] = None,
) -> CreatedPlayer:
    """Create a record at revision 1 with its first device.

    With a create key already used by an earlier create, make no record:
    revoke every token that creates with that key issued, issue a fresh one
    for the same player, and return the player's current revision and state
    (the given state is ignored). The lookup and the write share one
    transaction, so concurrent creates with one key make one player.

    Otherwise, raise HandleTaken when another profile holds the state's
    handle; the check and the insert share one transaction, so concurrent
    creates with one name make one player. A repeat is answered before the
    name is looked at: its state, name included, is ignored.
    """
    key_hash = hash_token(create_key) if create_key is not None else None
    handle = _handle_of(state_json)
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
                token = await _add_device(db, player_id, now, key_hash, kind)
                return CreatedPlayer(player_id, token, rev, current_json, created=False)
        await _check_handle_free(db, handle)
        player_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO sync_players
               (id, rev, state, created_at, updated_at, create_key_hash, friend_code, handle)
               VALUES (?, 1, ?, ?, ?, ?, ?, ?)""",
            (player_id, state_json, stamp, stamp, key_hash, await _free_friend_code(db), handle),
        )
        token = await _add_device(db, player_id, now, key_hash, kind)
    return CreatedPlayer(player_id, token, 1, state_json, created=True)


async def authenticate(
    token: str, now: float, kind: Optional[str] = None
) -> Optional[tuple[str, str]]:
    """(player_id, device_id) for a live token, or None. Records the device
    as seen at `now`, writing at most once per LAST_SEEN_EVERY_S, and keeps
    the first valid kind a device reports (rows from before kinds existed
    pick theirs up on their next request)."""
    token_hash = hash_token(token)
    kind = valid_device_kind(kind)
    async with _connect() as db:
        async with db.execute(
            "SELECT player_id, device_id, last_seen_at, kind FROM sync_devices WHERE token_hash = ?",
            (token_hash,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        player_id, device_id, last_seen_at, stored_kind = row
        if last_seen_at is None or now - last_seen_at >= LAST_SEEN_EVERY_S:
            await db.execute(
                "UPDATE sync_devices SET last_seen_at = ? WHERE token_hash = ?",
                (now, token_hash),
            )
        if stored_kind is None and kind is not None:
            await db.execute(
                "UPDATE sync_devices SET kind = ? WHERE token_hash = ? AND kind IS NULL",
                (kind, token_hash),
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

    With base_rev current, raises HandleTaken (writing nothing) when another
    profile holds the state's handle; keeping the player's own name is fine,
    and a state without a handle frees the name. A stale base_rev is the
    conflict above whatever the name, since nothing would be written.
    """
    handle = _handle_of(state_json)
    async with _write_txn() as db:
        async with db.execute(
            "SELECT rev FROM sync_players WHERE id = ?", (player_id,)
        ) as sel:
            row = await sel.fetchone()
        if row is not None and row[0] == base_rev:
            await _check_handle_free(db, handle, player_id)
        cur = await db.execute(
            """UPDATE sync_players SET rev = rev + 1, state = ?, handle = ?, updated_at = ?
               WHERE id = ? AND rev = ?""",
            (state_json, handle, iso_utc(now), player_id, base_rev),
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


async def redeem_pairing_code(
    code: str, now: float, kind: Optional[str] = None
) -> Optional[tuple[str, str, int, str]]:
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
        token = await _add_device(db, player_id, now, kind=kind)
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
    Returns the new player id. Raises HandleTaken when another profile holds
    the state's handle, checked in the transaction that inserts."""
    player_id = str(uuid.uuid4())
    handle = _handle_of(state_json)
    stamp = iso_utc(now)
    async with _write_txn() as db:
        await _check_handle_free(db, handle)
        await db.execute(
            """INSERT INTO sync_players
               (id, rev, state, created_at, updated_at, no_device_since, friend_code, handle)
               VALUES (?, 1, ?, ?, ?, ?, ?, ?)""",
            (player_id, state_json, stamp, stamp, now, await _free_friend_code(db), handle),
        )
    return player_id


@dataclass
class DeviceSummary:
    device_id: str
    created_at: str
    last_seen_at: Optional[float]
    kind: Optional[str] = None


@dataclass
class PlayerSummary:
    player_id: str
    state_json: str
    created_at: str
    updated_at: str
    no_device_since: Optional[float]
    devices: list[DeviceSummary]
    replays: int


async def last_seen_since() -> Optional[str]:
    """When this server began recording `last_seen_at` (ISO UTC), or None on
    a database that never started up."""
    async with _connect() as db:
        async with db.execute(
            "SELECT value FROM sync_meta WHERE key = 'last_seen_since'"
        ) as cur:
            row = await cur.fetchone()
    return None if row is None else row[0]


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
            """SELECT player_id, device_id, created_at, last_seen_at, kind FROM sync_devices
               ORDER BY created_at, rowid"""
        ) as cur:
            device_rows = await cur.fetchall()
        async with db.execute(
            "SELECT player_id, COUNT(*) FROM sync_games GROUP BY player_id"
        ) as cur:
            replays = dict(await cur.fetchall())
    devices: dict[str, list[DeviceSummary]] = {}
    for player_id, device_id, created_at, last_seen_at, kind in device_rows:
        devices.setdefault(player_id, []).append(
            DeviceSummary(device_id, created_at, last_seen_at, kind)
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
    """Delete each abandoned profile with its replays, codes and friendship
    rows (in both directions). The deleting transaction re-checks both
    conditions per profile, so a login (or any new device row) that lands
    after the candidates were chosen keeps its profile. Returns the count
    deleted."""
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
            await db.execute(
                "DELETE FROM sync_friendships WHERE requester_id = ? OR addressee_id = ?",
                (player_id, player_id),
            )
            deleted += 1
    return deleted


# ── Friends ──────────────────────────────────────────────────────────

PENDING, ACCEPTED, DECLINED = "pending", "accepted", "declined"

# What send_friend_request found. The route answers the same 202 for every
# outcome but the two refusals, so the caller cannot tell the rest apart.
REQUEST_SENT = "sent"
NO_SUCH_CODE = "no-such-code"
OWN_CODE = "own-code"


async def get_friend_code(player_id: str) -> Optional[str]:
    """The player's friend code, or None when there is no such player."""
    async with _connect() as db:
        async with db.execute(
            "SELECT friend_code FROM sync_players WHERE id = ?", (player_id,)
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row else None


async def replace_friend_code(player_id: str) -> Optional[str]:
    """Give the player a new friend code; the old one stops finding it at
    once. Requests and friendships are untouched. None when there is no such
    player."""
    async with _write_txn() as db:
        code = await _free_friend_code(db)
        cur = await db.execute(
            "UPDATE sync_players SET friend_code = ? WHERE id = ?", (code, player_id)
        )
    return code if cur.rowcount == 1 else None


async def _statuses_between(
    db: aiosqlite.Connection, a: str, b: str
) -> dict[tuple[str, str], str]:
    """{(requester_id, addressee_id): status} for the rows between a and b."""
    async with db.execute(
        """SELECT requester_id, addressee_id, status FROM sync_friendships
           WHERE (requester_id = ? AND addressee_id = ?)
              OR (requester_id = ? AND addressee_id = ?)""",
        (a, b, b, a),
    ) as cur:
        return {(row[0], row[1]): row[2] for row in await cur.fetchall()}


async def _make_friends(
    db: aiosqlite.Connection, requester_id: str, addressee_id: str, now: float
) -> None:
    """Accept requester's pending request to addressee, and delete the other
    row between them, so the friendship is exactly one accepted row."""
    await db.execute(
        """UPDATE sync_friendships SET status = ?, updated_at = ?
           WHERE requester_id = ? AND addressee_id = ?""",
        (ACCEPTED, now, requester_id, addressee_id),
    )
    await db.execute(
        "DELETE FROM sync_friendships WHERE requester_id = ? AND addressee_id = ?",
        (addressee_id, requester_id),
    )


async def send_friend_request(requester_id: str, code: str, now: float) -> str:
    """Ask the profile holding `code` (already normalised) to be friends.

    Returns NO_SUCH_CODE, OWN_CODE, or REQUEST_SENT for every other case:
    a new request; a repeat of a pending one or of one the other side
    declined (both left as they are); two players already friends; or the
    other player's pending request to the requester, which makes the two
    friends at once.
    """
    async with _write_txn() as db:
        async with db.execute(
            "SELECT id FROM sync_players WHERE friend_code = ?", (code,)
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return NO_SUCH_CODE
        addressee_id = row[0]
        if addressee_id == requester_id:
            return OWN_CODE
        statuses = await _statuses_between(db, requester_id, addressee_id)
        if ACCEPTED in statuses.values():
            return REQUEST_SENT
        if statuses.get((addressee_id, requester_id)) == PENDING:
            await _make_friends(db, addressee_id, requester_id, now)
        elif (requester_id, addressee_id) not in statuses:
            await db.execute(
                """INSERT INTO sync_friendships
                   (requester_id, addressee_id, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (requester_id, addressee_id, PENDING, now, now),
            )
    return REQUEST_SENT


async def accept_friend_request(player_id: str, requester_id: str, now: float) -> bool:
    """Accept requester's pending request to the player. True also when the
    two are already friends; False when there is neither."""
    async with _write_txn() as db:
        statuses = await _statuses_between(db, player_id, requester_id)
        if ACCEPTED in statuses.values():
            return True
        if statuses.get((requester_id, player_id)) != PENDING:
            return False
        await _make_friends(db, requester_id, player_id, now)
    return True


async def decline_friend_request(player_id: str, requester_id: str, now: float) -> bool:
    """Mark requester's pending request to the player declined. True also
    when it is already declined; False when there is no such request."""
    async with _write_txn() as db:
        status = (await _statuses_between(db, player_id, requester_id)).get(
            (requester_id, player_id)
        )
        if status == PENDING:
            await db.execute(
                """UPDATE sync_friendships SET status = ?, updated_at = ?
                   WHERE requester_id = ? AND addressee_id = ?""",
                (DECLINED, now, requester_id, player_id),
            )
    return status in (PENDING, DECLINED)


async def remove_friend(player_id: str, other_id: str) -> None:
    """Delete the accepted friendship between the two, if any, and nothing
    else: a pending or declined request stays as it is."""
    async with _connect() as db:
        await db.execute(
            """DELETE FROM sync_friendships WHERE status = ? AND (
                   (requester_id = ? AND addressee_id = ?)
                OR (requester_id = ? AND addressee_id = ?))""",
            (ACCEPTED, player_id, other_id, other_id, player_id),
        )


@dataclass
class FriendRow:
    player_id: str
    state_json: str
    at: float  # since (a friend) or sent_at (an incoming request)


async def list_friends(player_id: str) -> tuple[list[FriendRow], list[FriendRow]]:
    """(friends, incoming): the player's accepted friends, newest friendship
    first, and the pending requests sent to the player, newest first. The
    requests the player sent are not listed."""
    async with _connect() as db:
        async with db.execute(
            """SELECT p.id, p.state, f.updated_at FROM sync_friendships f
               JOIN sync_players p ON p.id = CASE WHEN f.requester_id = ?
                   THEN f.addressee_id ELSE f.requester_id END
               WHERE f.status = ? AND (f.requester_id = ? OR f.addressee_id = ?)
               ORDER BY f.updated_at DESC""",
            (player_id, ACCEPTED, player_id, player_id),
        ) as cur:
            friends = [FriendRow(*row) for row in await cur.fetchall()]
        async with db.execute(
            """SELECT p.id, p.state, f.created_at FROM sync_friendships f
               JOIN sync_players p ON p.id = f.requester_id
               WHERE f.addressee_id = ? AND f.status = ?
               ORDER BY f.created_at DESC""",
            (player_id, PENDING),
        ) as cur:
            incoming = [FriendRow(*row) for row in await cur.fetchall()]
    return friends, incoming


async def friend_state(player_id: str, other_id: str) -> Optional[str]:
    """The other player's state JSON when the two are friends, else None
    (whatever else lies between them)."""
    async with _connect() as db:
        async with db.execute(
            """SELECT state FROM sync_players WHERE id = ? AND EXISTS (
                   SELECT 1 FROM sync_friendships WHERE status = ? AND (
                       (requester_id = ? AND addressee_id = ?)
                    OR (requester_id = ? AND addressee_id = ?)))""",
            (other_id, ACCEPTED, player_id, other_id, other_id, player_id),
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row else None


# ── Friends: the feed and a friend's replays (plan 32, Revision 5) ───
#
# Added for the friends feed; the functions above are unchanged. Every read
# here is scoped by the friendship itself, in the same query, so a player who
# is not an accepted friend reads nothing.

# True when the two players `?, ?, ?, ?` (a, b, b, a) are accepted friends.
_ARE_FRIENDS = f"""EXISTS (
    SELECT 1 FROM sync_friendships WHERE status = '{ACCEPTED}' AND (
        (requester_id = ? AND addressee_id = ?)
     OR (requester_id = ? AND addressee_id = ?)))"""


@dataclass
class FeedFriendRow:
    player_id: str
    state_json: str
    # The newest `last_seen_at` among the friend's devices (epoch seconds),
    # or None when it has no device or none has been seen.
    last_seen_at: Optional[float]


async def friends_for_feed(player_id: str) -> list[FeedFriendRow]:
    """The player's accepted friends, newest friendship first (the order of
    `list_friends`), each with its state and when one of its devices was
    last seen."""
    async with _connect() as db:
        async with db.execute(
            """SELECT p.id, p.state,
                      (SELECT MAX(d.last_seen_at) FROM sync_devices d WHERE d.player_id = p.id)
               FROM sync_friendships f
               JOIN sync_players p ON p.id = CASE WHEN f.requester_id = ?
                   THEN f.addressee_id ELSE f.requester_id END
               WHERE f.status = ? AND (f.requester_id = ? OR f.addressee_id = ?)
               ORDER BY f.updated_at DESC""",
            (player_id, ACCEPTED, player_id, player_id),
        ) as cur:
            return [FeedFriendRow(*row) for row in await cur.fetchall()]


async def friend_games(
    player_id: str, other_id: str, limit: int
) -> Optional[list[tuple[str, str, str]]]:
    """[(game_id, date, payload_json)] of the other player's replays, newest
    first, at most `limit`, when the two are friends; None when they are not
    (whatever else lies between them)."""
    async with _connect() as db:
        async with db.execute(
            f"SELECT 1 FROM sync_players WHERE id = ? AND {_ARE_FRIENDS}",
            (other_id, player_id, other_id, other_id, player_id),
        ) as cur:
            if await cur.fetchone() is None:
                return None
        async with db.execute(
            f"""SELECT game_id, date, payload FROM sync_games WHERE player_id = ?
                {_NEWEST_FIRST} LIMIT ?""",
            (other_id, limit),
        ) as cur:
            return [(r[0], r[1], r[2]) for r in await cur.fetchall()]


async def friend_game(
    player_id: str, other_id: str, game_id: str
) -> Optional[tuple[str, str]]:
    """(date, payload_json) of one of the other player's replays when the two
    are friends; None when they are not, or there is no such replay."""
    async with _connect() as db:
        async with db.execute(
            f"""SELECT date, payload FROM sync_games
                WHERE player_id = ? AND game_id = ? AND {_ARE_FRIENDS}""",
            (other_id, game_id, player_id, other_id, other_id, player_id),
        ) as cur:
            row = await cur.fetchone()
    return (row[0], row[1]) if row else None
