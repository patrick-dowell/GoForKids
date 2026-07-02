"""
SQLite storage for uploaded (shared) game replays.

Deliberately separate from app.game.storage: an uploaded game is a single
self-contained JSON payload with no foreign keys into players/games, so this
table can be lifted into its own database later (planned before App Store
release) by pointing GOFORKIDS_UPLOADS_DB somewhere else — no schema surgery.
"""

from __future__ import annotations
import aiosqlite
import os
import secrets
from typing import Optional

# Falls back to the main DB file so v1 needs no new Render config.
DB_PATH = os.environ.get("GOFORKIDS_UPLOADS_DB") or os.environ.get(
    "GOFORKIDS_DB", "goforkids.db"
)

# Share codes are read aloud / typed by kids and parents: uppercase, no
# ambiguous glyphs (0/O, 1/I/L). 8 chars over 31 symbols ≈ 8.5e11 codes.
SHARE_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
SHARE_ID_LENGTH = 8


def new_share_id() -> str:
    return "".join(secrets.choice(SHARE_ID_ALPHABET) for _ in range(SHARE_ID_LENGTH))


async def init_uploads_db():
    """Create the uploaded_games table. Called from the app lifespan."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_games (
                id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                player_name TEXT,
                board_size INTEGER,
                opponent_rank TEXT,
                result TEXT,
                payload TEXT NOT NULL
            )
        """)
        await db.commit()


async def save_upload(
    payload_json: str,
    player_name: Optional[str],
    board_size: Optional[int],
    opponent_rank: Optional[str],
    result: Optional[str],
) -> str:
    """Store an uploaded game and return its share id."""
    async with aiosqlite.connect(DB_PATH) as db:
        # Collisions are ~impossible at this scale but cost nothing to handle.
        for _ in range(5):
            share_id = new_share_id()
            try:
                await db.execute(
                    """INSERT INTO uploaded_games
                       (id, player_name, board_size, opponent_rank, result, payload)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (share_id, player_name, board_size, opponent_rank, result, payload_json),
                )
                await db.commit()
                return share_id
            except aiosqlite.IntegrityError:
                continue
        raise RuntimeError("could not allocate a unique share id")


async def get_upload(share_id: str) -> Optional[str]:
    """Fetch an uploaded game's payload JSON by share id, or None."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT payload FROM uploaded_games WHERE id = ?", (share_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None
