"""
SQLite storage for games, player profiles, and ratings.
"""

from __future__ import annotations
import aiosqlite
import json
import os
from typing import Optional

DB_PATH = os.environ.get("GOFORKIDS_DB", "goforkids.db")


async def init_db():
    """Initialize the database schema."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT 'Player',
                rating_mu REAL NOT NULL DEFAULT 1500.0,
                rating_phi REAL NOT NULL DEFAULT 350.0,
                rating_sigma REAL NOT NULL DEFAULT 0.06,
                games_played INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY,
                player_id TEXT,
                target_rank TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'casual',
                komi REAL NOT NULL DEFAULT 7.5,
                player_color TEXT NOT NULL DEFAULT 'black',
                result_winner TEXT,
                result_score TEXT,
                sgf TEXT,
                move_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
        """)
        await db.commit()


async def get_or_create_player(player_id: str, name: str = "Player") -> dict:
    """Get or create a player profile."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM players WHERE id = ?", (player_id,)) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)

        await db.execute(
            "INSERT INTO players (id, name) VALUES (?, ?)",
            (player_id, name),
        )
        await db.commit()

        async with db.execute("SELECT * FROM players WHERE id = ?", (player_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row)


async def update_player_rating(player_id: str, mu: float, phi: float, sigma: float, games_played: int):
    """Update a player's rating."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE players SET rating_mu = ?, rating_phi = ?, rating_sigma = ?, games_played = ? WHERE id = ?",
            (mu, phi, sigma, games_played, player_id),
        )
        await db.commit()


async def save_game(
    game_id: str,
    player_id: Optional[str],
    target_rank: str,
    mode: str,
    komi: float,
    player_color: str,
    result_winner: Optional[str],
    result_score: Optional[str],
    sgf: Optional[str],
    move_count: int,
):
    """Save a completed game record."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT OR REPLACE INTO games
               (id, player_id, target_rank, mode, komi, player_color,
                result_winner, result_score, sgf, move_count, finished_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
            (game_id, player_id, target_rank, mode, komi, player_color,
             result_winner, result_score, sgf, move_count),
        )
        await db.commit()


async def get_player_games(player_id: str, limit: int = 50) -> list[dict]:
    """Get recent games for a player."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM games WHERE player_id = ? ORDER BY created_at DESC LIMIT ?",
            (player_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
