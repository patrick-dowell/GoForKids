"""
b28 ↔ b20 calibration harness.

Drives two backend instances head-to-head over an HTTP API and reports the
new bot's win rate, score-margin, and 95% Wilson CI. Used to retune each
(rank, board_size) profile in data/profiles/b28_candidate.yaml until it
plays at the same strength as the existing b20-calibrated bot.

Usage:
    python data/calibrate_b28.py \\
        --rank 15k --board 9 \\
        --old-url http://localhost:8000 \\
        --new-url http://localhost:8001 \\
        --games 100

Per-turn protocol (each game uses one fresh game on each backend):
  1. The new and old backends each create a game with the same
     (rank, board_size, komi, handicap).
  2. Per turn, whichever backend "owns" the current color is asked for an
     AI move via /ai-move; the chosen point is then mirrored to the other
     backend via /move (or /pass). Both backends keep an identical board
     state — only the bot decisions diverge.
  3. Color-ownership alternates per game so first-move advantage washes out
     across the match.
  4. When two consecutive passes happen on either backend (or max_moves is
     hit), we read the final result from one of them.

The harness does NOT know which model/profile each backend is running. That
is the operator's responsibility — see Makefile `calibrate-up`. For Phase 0
sanity, both backends run b20 + b20.yaml; the resulting win rate must land
in the binomial 95% CI for p=0.5 (~40-60% over 100 games). For real
calibration the new backend swaps to b28 + b28_candidate.yaml.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import httpx


# ---------- statistics ----------

def wilson_ci(wins: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a binomial proportion. Returns (lo, hi)."""
    if total == 0:
        return (0.0, 0.0)
    p = wins / total
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


# ---------- game record ----------

@dataclass
class GameResult:
    game_index: int
    new_color: str            # "black" or "white" — which color the new backend's bot played
    winner: Optional[str]     # "black" / "white" / None
    new_won: Optional[bool]
    margin: Optional[float]   # >0 if winner won by that many points; None for resign
    margin_for_new: Optional[float]  # signed margin from the new bot's perspective
    reason: Optional[str]     # "score" / "resignation" / "max_moves"
    moves: int
    elapsed_s: float


# ---------- backend client ----------

class Backend:
    """Thin wrapper over the GoForKids HTTP API for one backend instance."""

    def __init__(self, label: str, base_url: str, http: httpx.Client):
        self.label = label
        self.base = base_url.rstrip("/")
        self.http = http

    def health(self) -> bool:
        try:
            r = self.http.get(f"{self.base}/health", timeout=5.0)
            return r.status_code == 200
        except Exception:
            return False

    def create_game(self, *, rank: str, board_size: int, komi: float, handicap: int) -> str:
        r = self.http.post(
            f"{self.base}/api/games",
            json={
                "target_rank": rank,
                "mode": "casual",
                "komi": komi,
                "player_color": "black",
                "handicap": handicap,
                "board_size": board_size,
            },
            timeout=15.0,
        )
        r.raise_for_status()
        return r.json()["game_id"]

    def ai_move(self, gid: str) -> dict:
        """POST /ai-move and return the full AIMoveResponse body.

        Caller reads `point` for the chosen move and `final_state` for the
        game result if this move ended the game (second pass).
        """
        r = self.http.post(f"{self.base}/api/games/{gid}/ai-move", timeout=120.0)
        r.raise_for_status()
        return r.json()

    def play_move(self, gid: str, row: int, col: int) -> dict:
        """POST /move; returns GameStateResponse."""
        r = self.http.post(
            f"{self.base}/api/games/{gid}/move",
            json={"row": row, "col": col},
            timeout=30.0,
        )
        r.raise_for_status()
        return r.json()

    def pass_move(self, gid: str) -> dict:
        """POST /pass; returns GameStateResponse (with result populated on game end)."""
        r = self.http.post(f"{self.base}/api/games/{gid}/pass", timeout=15.0)
        r.raise_for_status()
        return r.json()


def _extract_result(resp: dict) -> Optional[dict]:
    """Pull a {winner, margin?, reason?} dict out of either response shape.

    /move and /pass return GameStateResponse with `result` at the top level.
    /ai-move returns AIMoveResponse, where the same dict is nested under
    `final_state.result` when the AI's pass ended the game. Returns None if
    the game isn't over yet.
    """
    if resp.get("result"):
        return resp["result"]
    fs = resp.get("final_state") or {}
    return fs.get("result")


# ---------- one game ----------

def play_one_game(
    *,
    new: Backend,
    old: Backend,
    rank: str,
    board_size: int,
    komi: float,
    handicap: int,
    new_plays_color: str,        # "black" or "white"
    max_moves: int,
    game_index: int,
    sgf_dir: Optional[Path] = None,
) -> GameResult:
    """Play a single game with mirrored state on both backends."""
    t0 = time.monotonic()
    effective_komi = 0.5 if handicap > 0 else komi

    new_gid = new.create_game(rank=rank, board_size=board_size, komi=effective_komi, handicap=handicap)
    old_gid = old.create_game(rank=rank, board_size=board_size, komi=effective_komi, handicap=handicap)

    # current_color advances on each backend after every move; both start at
    # BLACK on a fresh game with no handicap. With handicap >= 2, white moves
    # first — the backend handles that by setting current_color=WHITE after
    # placing the handicap stones, and we mirror via play_move which also
    # respects whatever side is to move.
    cur = "black"
    consecutive_passes = 0
    moves_played = 0
    last_played: list[tuple[str, int, int]] = []  # for SGF dump
    final_result: Optional[dict] = None

    while moves_played < max_moves and consecutive_passes < 2:
        owner = new if cur == new_plays_color else old
        mirror = old if owner is new else new
        owner_gid = new_gid if owner is new else old_gid
        mirror_gid = old_gid if owner is new else new_gid

        try:
            ai_resp = owner.ai_move(owner_gid)
        except httpx.HTTPError as e:
            # An HTTP failure mid-game is unrecoverable — abandon this game,
            # report no result. The whole match should still have plenty of
            # signal even if one or two games drop out.
            print(f"  game {game_index}: {owner.label} /ai-move failed at move {moves_played + 1}: {e}", file=sys.stderr)
            return GameResult(
                game_index=game_index, new_color=new_plays_color,
                winner=None, new_won=None, margin=None, margin_for_new=None,
                reason=f"error:{owner.label}", moves=moves_played,
                elapsed_s=time.monotonic() - t0,
            )

        row = ai_resp["point"]["row"]
        col = ai_resp["point"]["col"]
        # The owner already advanced its own state via /ai-move; the response
        # carries the result if THIS move ended the game (second pass).
        final_result = final_result or _extract_result(ai_resp)

        if row < 0:
            mirror_resp = mirror.pass_move(mirror_gid)
            consecutive_passes += 1
            last_played.append((cur, -1, -1))
        else:
            mirror_resp = mirror.play_move(mirror_gid, row, col)
            consecutive_passes = 0
            last_played.append((cur, row, col))
        # Mirror may also surface the result (its own copy of the second-pass).
        final_result = final_result or _extract_result(mirror_resp)

        moves_played += 1
        cur = "white" if cur == "black" else "black"

    result = final_result or {}
    winner = result.get("winner")
    margin = result.get("margin")
    reason = result.get("reason") or ("max_moves" if consecutive_passes < 2 else "score")
    new_won = (winner == new_plays_color) if winner in ("black", "white") else None
    margin_for_new: Optional[float] = None
    if margin is not None and winner in ("black", "white"):
        margin_for_new = float(margin) if winner == new_plays_color else -float(margin)

    if sgf_dir is not None:
        sgf_dir.mkdir(parents=True, exist_ok=True)
        sgf_path = sgf_dir / f"game_{game_index:03d}_{new_plays_color[0]}.sgf"
        _write_sgf(sgf_path, board_size=board_size, komi=effective_komi,
                   handicap=handicap, moves=last_played, winner=winner, margin=margin)

    return GameResult(
        game_index=game_index,
        new_color=new_plays_color,
        winner=winner,
        new_won=new_won,
        margin=margin,
        margin_for_new=margin_for_new,
        reason=reason,
        moves=moves_played,
        elapsed_s=time.monotonic() - t0,
    )


# ---------- SGF writer (minimal) ----------

def _write_sgf(path: Path, *, board_size: int, komi: float, handicap: int,
               moves: list[tuple[str, int, int]], winner: Optional[str],
               margin: Optional[float]) -> None:
    """Write a minimal SGF for replaying a calibration game."""
    def coord(row: int, col: int) -> str:
        # SGF: lowercase letters, a-s for 19x19. Pass = "" (or "tt" pre-FF[4]).
        if row < 0 or col < 0:
            return ""
        return chr(ord("a") + col) + chr(ord("a") + row)

    parts = [f"(;FF[4]GM[1]SZ[{board_size}]KM[{komi}]"]
    if handicap >= 2:
        parts.append(f"HA[{handicap}]")
    if winner and margin is not None:
        parts.append(f"RE[{'B' if winner == 'black' else 'W'}+{margin}]")
    elif winner:
        parts.append(f"RE[{'B' if winner == 'black' else 'W'}]")
    for color, row, col in moves:
        tag = "B" if color == "black" else "W"
        parts.append(f";{tag}[{coord(row, col)}]")
    parts.append(")")
    path.write_text("".join(parts))


# ---------- match summary ----------

def summarize(results: list[GameResult], *, rank: str, board_size: int) -> dict:
    completed = [r for r in results if r.new_won is not None]
    new_wins = sum(1 for r in completed if r.new_won)
    total = len(completed)
    rate = new_wins / total if total else 0.0
    lo, hi = wilson_ci(new_wins, total)
    avg_margin = (sum(r.margin_for_new for r in completed if r.margin_for_new is not None)
                  / max(1, sum(1 for r in completed if r.margin_for_new is not None)))
    in_band = 0.45 <= rate <= 0.55
    sanity_band = 0.40 <= rate <= 0.60
    summary = {
        "rank": rank,
        "board_size": board_size,
        "games": len(results),
        "completed": total,
        "errors": len(results) - total,
        "new_wins": new_wins,
        "old_wins": total - new_wins,
        "new_win_rate": rate,
        "ci95_lo": lo,
        "ci95_hi": hi,
        "avg_margin_for_new": avg_margin,
        "in_calibration_band_45_55": in_band,
        "in_sanity_band_40_60": sanity_band,
    }
    return summary


def print_summary(summary: dict) -> None:
    rate = summary["new_win_rate"]
    lo = summary["ci95_lo"]
    hi = summary["ci95_hi"]
    rank = summary["rank"]
    sz = summary["board_size"]
    band_status = "✅ within 45-55% target band" if summary["in_calibration_band_45_55"] \
        else ("⚠️ outside 45-55% but within 40-60% sanity band" if summary["in_sanity_band_40_60"]
              else "❌ outside 40-60% sanity band")
    print()
    print(f"{rank} @ {sz}×{sz}: new wins {summary['new_wins']}/{summary['completed']} "
          f"({rate*100:.1f}%, 95% CI {lo*100:.1f}-{hi*100:.1f}%) "
          f"| avg margin {summary['avg_margin_for_new']:+.2f} (new-perspective)")
    print(f"  → calibration: {band_status}")
    if summary["errors"]:
        print(f"  → {summary['errors']} game(s) errored out and were excluded from the rate")


# ---------- match runner ----------

def run_match(args: argparse.Namespace) -> int:
    log_root = Path(args.log_dir).expanduser().resolve()
    run_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = log_root / f"{args.rank}_{args.board}x{args.board}_{run_id}"

    with httpx.Client() as http:
        new = Backend("new", args.new_url, http)
        old = Backend("old", args.old_url, http)

        if not new.health() or not old.health():
            print(f"ERROR: backends not reachable. new={args.new_url} old={args.old_url}", file=sys.stderr)
            return 1

        print(f"Match: rank={args.rank} board={args.board}×{args.board} games={args.games}")
        print(f"  new = {args.new_url}   old = {args.old_url}")
        print(f"  logs → {run_dir}")
        print()

        results: list[GameResult] = []
        sgf_dir = run_dir / "sgf" if args.dump_sgf else None
        for i in range(args.games):
            new_color = "black" if i % 2 == 0 else "white"
            print(f"  game {i+1}/{args.games}  new={new_color:5} ...", end=" ", flush=True)
            r = play_one_game(
                new=new, old=old,
                rank=args.rank, board_size=args.board,
                komi=args.komi, handicap=args.handicap,
                new_plays_color=new_color, max_moves=args.max_moves,
                game_index=i + 1, sgf_dir=sgf_dir,
            )
            results.append(r)
            won = "new" if r.new_won else ("old" if r.new_won is False else "—")
            margin_str = f"{r.margin_for_new:+.1f}" if r.margin_for_new is not None else "?"
            print(f"{won:3} ({margin_str}) in {r.moves} moves [{r.elapsed_s:.1f}s]")

    summary = summarize(results, rank=args.rank, board_size=args.board)
    print_summary(summary)

    # Persist artifacts
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "summary.json").write_text(json.dumps({
        "args": {k: v for k, v in vars(args).items() if not callable(v)},
        "summary": summary,
    }, indent=2))
    csv_path = run_dir / "games.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(results[0]).keys()) if results else [])
        if results:
            writer.writeheader()
            for r in results:
                writer.writerow(asdict(r))

    print(f"\n  artifacts: {run_dir}")
    return 0


# ---------- CLI ----------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rank", required=True, help="Bot rank to calibrate, e.g. 15k")
    ap.add_argument("--board", required=True, type=int, choices=(5, 9, 13, 19), help="Board size")
    ap.add_argument("--games", type=int, default=30, help="Number of games (30=triage, 100=confirmation)")
    ap.add_argument("--old-url", default="http://localhost:8000", help="b20 backend URL")
    ap.add_argument("--new-url", default="http://localhost:8001", help="b28 backend URL")
    ap.add_argument("--komi", type=float, default=7.5, help="Komi (overridden to 0.5 if handicap>0)")
    ap.add_argument("--handicap", type=int, default=0, help="Handicap stones for Black")
    ap.add_argument("--max-moves", type=int, default=600, help="Move cap per game (safety net)")
    ap.add_argument("--log-dir", default="data/calibration_logs_b28", help="Where to write per-match artifacts")
    ap.add_argument("--dump-sgf", action="store_true", help="Save an SGF for each game (useful for inspection)")
    args = ap.parse_args()
    return run_match(args)


if __name__ == "__main__":
    raise SystemExit(main())
