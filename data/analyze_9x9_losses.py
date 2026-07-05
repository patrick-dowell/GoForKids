"""
Per-move point-loss + locality analysis for 9x9 SGFs (§3 distribution
calibration, 2026-07-05).

Replays each game through the KataGo JSON analysis engine (one query per
game, analyzeTurns = every position) and computes, for every move:
  loss    = score-lead delta the mover gave up vs. best play
            (root scoreLead before vs. after the move, mover perspective)
  local   = Chebyshev distance to the opponent's previous move

Aggregates per input directory (= per rank band):
  mean/median loss, bucket shares (near-optimal <0.5 / small 0.5-2 /
  medium 2-5 / blunder >5), locality distribution.

Usage:
  python analyze_9x9_losses.py human_games_9x9_ogs/15k [more dirs...]
  python analyze_9x9_losses.py --sqlite path/to.db --rank 15k

The bot's own games (calibration harness SQLite, games table) go through
the identical pipeline so bot and human histograms are directly
comparable — the tuning target is: bot histogram ≈ human histogram.
Output: per-dir report to stdout + CSV rows to <dir>/losses.csv.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sqlite3
import statistics
import subprocess
import sys

KATAGO = os.environ.get("KATAGO_PATH", "katago")
MODEL = os.environ.get(
    "KATAGO_MODEL",
    os.path.join(os.path.dirname(__file__), "..", "backend", "models", "b28.bin.gz"),
)
CONFIG = os.environ.get(
    "KATAGO_ANALYSIS_CONFIG",
    "/opt/homebrew/opt/katago/share/katago/configs/analysis_example.cfg",
)
VISITS = 200
SIZE = 9
COLS = "ABCDEFGHJ"  # GTP letters, no I


def sgf_to_moves(sgf: str):
    """[('B','E5'), ('W','pass'), ...] from a 9x9 SGF."""
    out = []
    for color, coord in re.findall(r";([BW])\[([a-z]{0,2})\]", sgf):
        if coord == "" or coord == "tt":
            out.append([color, "pass"])
        else:
            col, row = ord(coord[0]) - 97, ord(coord[1]) - 97
            out.append([color, f"{COLS[col]}{SIZE - row}"])
    return out


def sgf_komi(sgf: str) -> float:
    m = re.search(r"KM\[([0-9.+-]+)\]", sgf)
    return float(m.group(1)) if m else 7.5


def gtp_dist(a: str, b: str) -> int | None:
    """Chebyshev distance between two GTP points (None if either is a pass)."""
    if a == "pass" or b == "pass":
        return None
    ax, ay = COLS.index(a[0]), int(a[1:])
    bx, by = COLS.index(b[0]), int(b[1:])
    return max(abs(ax - bx), abs(ay - by))


class Analyzer:
    def __init__(self):
        self.proc = subprocess.Popen(
            [KATAGO, "analysis", "-model", MODEL, "-config", CONFIG,
             "-override-config", "reportAnalysisWinratesAs=BLACK"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True,
        )
        self._qid = 0

    def game_leads(self, moves, komi: float) -> dict[int, float]:
        """Root scoreLead (black perspective) for every turn 0..len(moves)."""
        self._qid += 1
        qid = f"g{self._qid}"
        query = {
            "id": qid,
            "rules": "japanese",
            "komi": komi,
            "boardXSize": SIZE,
            "boardYSize": SIZE,
            "initialStones": [],
            "moves": moves,
            "analyzeTurns": list(range(len(moves) + 1)),
            "maxVisits": VISITS,
        }
        self.proc.stdin.write(json.dumps(query) + "\n")
        self.proc.stdin.flush()
        leads: dict[int, float] = {}
        expected = len(moves) + 1
        while len(leads) < expected:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("katago analysis engine died")
            resp = json.loads(line)
            if resp.get("id") != qid:
                continue
            if "error" in resp:
                raise RuntimeError(f"query error: {resp['error']}")
            if resp.get("isDuringSearch"):
                continue
            leads[resp["turnNumber"]] = resp["rootInfo"]["scoreLead"]
        return leads

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.terminate()
        except Exception:
            pass


def analyze_game(an: Analyzer, moves, komi: float):
    """[(mover, loss, local_dist, phase)] for every non-pass move.
    phase = game tercile 0/1/2 (opening/middle/endgame by move number) —
    added so the 'plays well early, collapses late' signature is measurable
    (Patrick's device round, 2026-07-05; flat histograms are blind to it)."""
    leads = an.game_leads(moves, komi)
    rows = []
    n = len(moves)
    for i, (color, point) in enumerate(moves):
        if point == "pass":
            continue
        delta = leads[i + 1] - leads[i]  # black-perspective lead change
        loss = -delta if color == "B" else delta
        prev = moves[i - 1][1] if i > 0 else None
        phase = min(2, (3 * i) // max(n, 1))
        rows.append((color, loss, gtp_dist(point, prev) if prev else None, phase))
    return rows


def summarize(label: str, rows):
    losses = [max(r[1], 0.0) for r in rows]  # clip search-noise negatives
    if not losses:
        print(f"{label}: no moves")
        return
    n = len(losses)
    buckets = {
        "near-optimal (<0.5)": sum(1 for l in losses if l < 0.5),
        "small (0.5-2)": sum(1 for l in losses if 0.5 <= l < 2),
        "medium (2-5)": sum(1 for l in losses if 2 <= l < 5),
        "blunder (>=5)": sum(1 for l in losses if l >= 5),
    }
    dists = [r[2] for r in rows if r[2] is not None]
    local_share = sum(1 for d in dists if d <= 2) / len(dists) if dists else 0
    print(f"\n== {label} — {n} moves")
    print(f"   mean loss {statistics.mean(losses):+.2f}  median {statistics.median(losses):+.2f}")
    for k, v in buckets.items():
        print(f"   {k}: {v / n * 100:.0f}%")
    print(f"   locality: {local_share * 100:.0f}% of moves within 2 of the previous move"
          f" (median dist {statistics.median(dists) if dists else '—'})")
    # Phase curve: mistake TIMING. A flat curve = human texture (small
    # mistakes throughout); low-high skew = "plays well early, collapses
    # late" — the sampler v1 signature Patrick caught on device.
    names = ["opening", "middle", "endgame"]
    parts = []
    for ph in (0, 1, 2):
        pl = [max(r[1], 0.0) for r in rows if len(r) > 3 and r[3] == ph]
        if pl:
            bl = sum(1 for l in pl if l >= 5) / len(pl) * 100
            parts.append(f"{names[ph]} {statistics.mean(pl):+.2f} ({bl:.0f}% bl)")
    if parts:
        print(f"   phase curve: {' | '.join(parts)}")


def rows_from_sgf_dir(an: Analyzer, d: str):
    rows = []
    csv_lines = ["game,mover,loss,local_dist,phase"]
    for name in sorted(os.listdir(d)):
        if not name.endswith(".sgf"):
            continue
        sgf = open(os.path.join(d, name)).read()
        if "SZ[9]" not in sgf:
            continue
        moves = sgf_to_moves(sgf)
        if len(moves) < 15:
            continue
        try:
            game_rows = analyze_game(an, moves, sgf_komi(sgf))
        except Exception as e:
            print(f"  {name}: {e}", flush=True)
            continue
        rows.extend(game_rows)
        for c, l, dist, phase in game_rows:
            csv_lines.append(f"{name},{c},{l:.2f},{'' if dist is None else dist},{phase}")
        print(f"  {name}: {len(game_rows)} moves analyzed", flush=True)
    with open(os.path.join(d, "losses.csv"), "w") as f:
        f.write("\n".join(csv_lines) + "\n")
    return rows


def rows_from_sqlite(an: Analyzer, db: str, rank: str, side: str = "B"):
    """Bot games from a calibration-harness DB (games table stores full
    SGF; `target_rank` is the BLACK bot's rank in bot-vs-bot games). By
    default counts Black's moves for games where target_rank == rank;
    pass side='W' with the BLACK rank filter to measure the White bot of
    those same games (e.g. the 9k side of '15k v 9k' games)."""
    conn = sqlite3.connect(db)
    rows = []
    for gid, sgf, komi in conn.execute(
        "SELECT id, sgf, komi FROM games WHERE target_rank = ? AND sgf IS NOT NULL",
        (rank,),
    ):
        if "SZ[9]" not in (sgf or ""):
            continue
        moves = sgf_to_moves(sgf)
        if len(moves) < 15:
            continue
        try:
            game_rows = [r for r in analyze_game(an, moves, komi or sgf_komi(sgf)) if r[0] == side]
        except Exception as e:
            print(f"  game {gid}: {e}", flush=True)
            continue
        rows.extend(game_rows)
        print(f"  game {gid}: {len(game_rows)} {side}-side moves analyzed", flush=True)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="*", help="SGF directories (one summary each)")
    ap.add_argument("--sqlite", help="calibration-harness DB of bot games")
    ap.add_argument("--rank", help="BLACK bot rank filter for --sqlite games")
    ap.add_argument("--side", default="B", choices=["B", "W"],
                    help="which side's moves to measure (W = the opponent bot)")
    args = ap.parse_args()

    an = Analyzer()
    try:
        for d in args.dirs:
            print(f"\n### {d}", flush=True)
            rows = rows_from_sgf_dir(an, d)
            summarize(d, rows)
        if args.sqlite:
            print(f"\n### bot games: {args.sqlite} rank={args.rank} side={args.side}", flush=True)
            rows = rows_from_sqlite(an, args.sqlite, args.rank, args.side)
            summarize(f"bot ({args.rank} games, {args.side} side)", rows)
    finally:
        an.close()


if __name__ == "__main__":
    main()
