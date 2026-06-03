#!/usr/bin/env python3
"""
9×9 ladder calibration orchestrator — Phases 0 + 1 of feature 24.

Phase 0: validate rank ordering between existing 9×9 profiles via even-game
         bot-vs-bot at default komi.
Phase 1: measure komi-per-rank slope via same-profile-vs-same-profile at a
         sweep of komi values. Curve fit → "1 rank ≈ N komi points" anchor
         per profile.

Trusted anchor profiles: 30k Seedling, 6k Ember, 1d Void. User-playtest
validated as of 2026-05-18.
Profile under review: 15k Pebble — user reports it may play weaker than
its label. Phase 0 will show this in 30k v 15k / 15k v 6k margins. Phase 1
runs for 15k too (under a separate flag) so a future re-tuning has data.

Single-backend harness. Expects a b28 backend reachable on --port (default
8101 = the b28 backend that comes up with `make calibrate-up`). Add 15k
via --include-15k-phase1 once you want the slower second-half run.

Resumable: writes per-game rows to results.csv as it goes. Re-running with
the same --output-dir picks up where it left off (skips pairings whose game
count is already met).

Usage:
    # In one terminal — bring up the b28 backend on :8101
    make calibrate-up   # or: make 9x9-ladder-up (single-backend variant)

    # In another — kick off the overnight run
    python data/calibrate_9x9_ladder.py \\
        --output-dir data/calibration_logs_b28/9x9_ladder_$(date +%Y-%m-%d)

Outputs (under --output-dir):
    results.csv     — per-game append log (rerun-safe)
    summary.md      — per-pairing rollups (Wilson CI, margin avg, etc.)
    progress.log    — append-only progress log
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import math
import sys
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional

import httpx


# ---------- matrices ----------

@dataclass
class Pairing:
    """One (black_profile, white_profile, komi) cell — N games per cell."""
    phase: str            # 'p0' or 'p1'
    black: str
    white: str
    komi: float
    games: int
    label: str
    handicap: int = 0

    @property
    def key(self) -> str:
        # Stable string used for resume-skip matching against results.csv.
        return f"{self.phase}|{self.black}|{self.white}|h{self.handicap}|k{self.komi:+.1f}"


# Phase 0: cross-profile, no handicap, default komi=7.5 (white-advantage).
# Goal — confirm monotonic strength order across 30k < 15k < 6k < 1d.
# Triangulation pairings (every-to-every) help spot which profile is off
# when the adjacent pair doesn't behave.
PHASE0: list[Pairing] = [
    Pairing('p0', '30k', '15k', 7.5, 30, '30k v 15k (validate 15k from below)'),
    Pairing('p0', '15k', '6k',  7.5, 30, '15k v 6k  (validate 15k from above)'),
    Pairing('p0', '6k',  '1d',  7.5, 30, '6k v 1d   (top-end gap check)'),
    Pairing('p0', '30k', '6k',  7.5, 20, '30k v 6k  (triangulation)'),
    Pairing('p0', '30k', '1d',  7.5, 20, '30k v 1d  (triangulation)'),
    Pairing('p0', '15k', '1d',  7.5, 20, '15k v 1d  (triangulation)'),
]

# Phase 1: same-profile, varying komi. Komi is white's advantage in points,
# so lower komi = Black favored. Default 9×9 komi is ~7. We sweep across
# the regime where Black goes from disadvantaged → strongly favored.
KOMI_SWEEP = [14.0, 7.0, 0.0, -7.0, -14.0]

# Per-profile games-per-komi. The fast bots get 40 (±15% 95% CI). 1d's
# 50-visit profile is ~5x slower per move, so it gets 20 (±22% CI) to
# keep total wall time under a typical overnight. The curve shape lands
# even with looser CIs; tighten to 100 games during Phase 3 once we're
# picking exact ladder values.
PHASE1_GAMES = {"30k": 40, "15k": 40, "6k": 40, "1d": 20}

def _phase1_for(profile: str) -> list[Pairing]:
    games = PHASE1_GAMES[profile]
    return [
        Pairing('p1', profile, profile, k, games,
                f'{profile} v {profile} @ komi={k:+g} (komi-per-rank slope)')
        for k in KOMI_SWEEP
    ]

# Ordering matters: fastest profile first so the morning-after results
# include the most data even if the run was interrupted mid-1d.
PHASE1_TRUSTED: list[Pairing] = (
    _phase1_for('30k') + _phase1_for('6k') + _phase1_for('1d')
)
PHASE1_15K_OPTIONAL: list[Pairing] = _phase1_for('15k')


# Profile validation matrix — runs adjacent-rank bot-vs-bot pairs to check
# that 18k/15k/12k/9k/3k profile guesses produce the expected strength gap
# vs each other and vs the trusted anchors.
# Target band: stronger profile wins 60-90% per 3-rank step. Outside that
# band, the candidate profile needs another tuning pass.
PROFILE_VALIDATION: list[Pairing] = [
    Pairing('pv', '30k', '18k', 7.5, 30, '30k v 18k (anchor v candidate, 12-rank gap)'),
    Pairing('pv', '18k', '15k', 7.5, 30, '18k v 15k (candidate v candidate, 3-rank gap)'),
    Pairing('pv', '15k', '12k', 7.5, 30, '15k v 12k (candidate v candidate, 3-rank gap)'),
    Pairing('pv', '12k', '9k',  7.5, 30, '12k v 9k  (candidate v candidate, 3-rank gap)'),
    Pairing('pv', '9k',  '6k',  7.5, 30, '9k v 6k   (candidate v anchor, 3-rank gap)'),
    Pairing('pv', '6k',  '3k',  7.5, 30, '6k v 3k   (anchor v candidate, 3-rank gap)'),
    Pairing('pv', '3k',  '1d',  7.5, 30, '3k v 1d   (candidate v anchor, 3-rank gap)'),
]

# Relabel validation — after dropping the v3 12k/9k profiles and renaming
# v3 12k -> 18k and v3 9k -> 15k, test the three adjacent pairings that
# actually exist in the final profile set.
RELABEL_VALIDATION: list[Pairing] = [
    Pairing('pv', '30k', '18k', 7.5, 30, '30k v 18k (relabeled — expect 18k ~90-100%, 12-rank gap)'),
    Pairing('pv', '18k', '15k', 7.5, 30, '18k v 15k (relabeled — borderline, v3 was 60%)'),
    Pairing('pv', '15k', '6k',  7.5, 30, '15k v 6k  (new adjacent pair — 9-rank label gap, expect 6k ~95%)'),
]

# Final validation — after committing v2-18k KataGo profile as the new 15k
# and the visits=9 candidate as 9k. Tests the full 5-profile chain.
FINAL_VALIDATION: list[Pairing] = [
    Pairing('pv', '30k', '15k', 7.5, 30, '30k v 15k (new 15k = v2-18k profile — expect 15k ~95%+)'),
    Pairing('pv', '15k', '9k',  7.5, 30, '15k v 9k  (if cliff smooth: 9k ~70-85%; sharp: 50/50 or 95%+)'),
    Pairing('pv', '9k',  '6k',  7.5, 30, '9k v 6k   (if 9k mid-cliff: 6k ~70-85%; if 9k=6k-tier: 50/50)'),
    Pairing('pv', '6k',  '3k',  7.5, 30, '6k v 3k   (stability check, expect 3k ~65-75%)'),
]


# ---------- statistics ----------

def wilson_ci(wins: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    p = wins / total
    denom = 1 + z*z/total
    center = (p + z*z/(2*total)) / denom
    half = z * math.sqrt(p*(1-p)/total + z*z/(4*total*total)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


# ---------- backend protocol ----------

def play_game(
    client: httpx.Client, api_url: str,
    black: str, white: str, komi: float, handicap: int,
    board: int = 9, max_moves: int = 400,
) -> dict:
    """Play one bot-vs-bot game. Returns dict with winner, margin, moves."""
    # Backend logic: when handicap>0 it forces komi=0.5. For Phase 1 we
    # always pass handicap=0 so the komi value we set flows through.
    r = client.post(f"{api_url}/games", json={
        "target_rank": black,
        "mode": "casual",
        "komi": komi,
        "player_color": "black",
        "handicap": handicap,
        "board_size": board,
        "black_rank": black,
        "white_rank": white,
    }, timeout=15)
    if r.status_code != 200:
        return {"winner": "error", "margin": None, "moves": 0,
                "error": f"create {r.status_code}: {r.text[:200]}"}
    gid = r.json()["game_id"]

    passes = 0
    move_num = 0
    result = None
    ai = None
    while move_num < max_moves:
        try:
            r = client.post(f"{api_url}/games/{gid}/ai-move", timeout=120)
        except Exception as exc:
            return {"winner": "error", "margin": None, "moves": move_num,
                    "error": f"ai-move exc: {exc}"}
        if r.status_code != 200:
            return {"winner": "error", "margin": None, "moves": move_num,
                    "error": f"ai-move {r.status_code}: {r.text[:200]}"}
        ai = r.json()
        ar, ac = ai["point"]["row"], ai["point"]["col"]

        if ar < 0:
            passes += 1
            if passes >= 2:
                # Backend auto-scored and cleared the game; read from
                # final_state in the AIMoveResponse.
                final = ai.get("final_state") or {}
                result = final.get("result")
                break
        else:
            passes = 0
            # On a non-pass, check if the game ended naturally (resign).
            try:
                state = client.get(f"{api_url}/games/{gid}", timeout=10).json()
                if state.get("phase") != "playing":
                    result = state.get("result")
                    break
            except Exception:
                pass
        move_num += 1

    # Figure out final move count.
    final_blob = ai.get("final_state") if ai else None
    if final_blob and final_blob.get("move_number") is not None:
        real_moves = final_blob["move_number"]
    else:
        try:
            state = client.get(f"{api_url}/games/{gid}", timeout=10).json()
            real_moves = state.get("move_number", move_num)
        except Exception:
            real_moves = move_num

    winner = result.get("winner", "unknown") if result else "unknown"
    margin = result.get("margin") if result else None
    reason = result.get("reason") if result else None
    return {"winner": winner, "margin": margin, "moves": real_moves,
            "reason": reason}


# ---------- resume logic ----------

CSV_HEADER = [
    "ts", "pairing_key", "phase", "black", "white", "komi", "handicap",
    "game_index", "winner", "margin", "moves", "reason", "elapsed_s", "error",
]

def existing_counts(csv_path: Path) -> dict[str, int]:
    """Map pairing_key -> number of (non-error) games already recorded."""
    if not csv_path.exists():
        return {}
    counts: dict[str, int] = {}
    with open(csv_path, newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            if row.get("winner") in ("black", "white"):
                counts[row["pairing_key"]] = counts.get(row["pairing_key"], 0) + 1
    return counts


def append_row(csv_path: Path, row: dict) -> None:
    new_file = not csv_path.exists()
    with open(csv_path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_HEADER)
        if new_file:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in CSV_HEADER})


# ---------- per-pairing runner ----------

def run_pairing(
    client: httpx.Client, api_url: str, out_dir: Path,
    pairing: Pairing, already: int, log_fn,
) -> None:
    todo = pairing.games - already
    if todo <= 0:
        log_fn(f"  SKIP {pairing.key} — already {already}/{pairing.games}")
        return

    log_fn(f"\n=== {pairing.label} ===")
    log_fn(f"  key={pairing.key}  already={already}/{pairing.games}  running {todo} more")

    csv_path = out_dir / "results.csv"
    wins_b = wins_w = errs = 0

    # Backfill counters from CSV so the per-pairing console line is accurate
    # after a resume.
    if already > 0 and csv_path.exists():
        with open(csv_path, newline="") as f:
            r = csv.DictReader(f)
            for row in r:
                if row["pairing_key"] != pairing.key:
                    continue
                if row["winner"] == "black": wins_b += 1
                elif row["winner"] == "white": wins_w += 1
                else: errs += 1

    for i in range(todo):
        game_idx = already + i + 1
        t0 = time.time()
        res = play_game(
            client, api_url,
            black=pairing.black, white=pairing.white,
            komi=pairing.komi, handicap=pairing.handicap,
        )
        elapsed = time.time() - t0
        winner = res.get("winner", "unknown")
        if winner == "black": wins_b += 1
        elif winner == "white": wins_w += 1
        else: errs += 1

        append_row(csv_path, {
            "ts": dt.datetime.now().isoformat(timespec="seconds"),
            "pairing_key": pairing.key,
            "phase": pairing.phase,
            "black": pairing.black,
            "white": pairing.white,
            "komi": pairing.komi,
            "handicap": pairing.handicap,
            "game_index": game_idx,
            "winner": winner,
            "margin": res.get("margin", ""),
            "moves": res.get("moves", 0),
            "reason": res.get("reason", ""),
            "elapsed_s": f"{elapsed:.2f}",
            "error": res.get("error", ""),
        })

        mg = res.get("margin")
        margin_str = f"+{mg}" if mg not in (None, "") else (res.get("reason") or "?")
        log_fn(f"  [{game_idx}/{pairing.games}] {winner} {margin_str} ({res.get('moves', 0)} mv, {elapsed:.1f}s)")

    total = wins_b + wins_w
    if total:
        lo, hi = wilson_ci(wins_b, total)
        log_fn(f"  ROLL  Black ({pairing.black}) {wins_b}/{total} = "
               f"{100*wins_b/total:.0f}% [95% CI {100*lo:.0f}-{100*hi:.0f}%]"
               f"  errors={errs}")


# ---------- summary writer ----------

def write_summary(out_dir: Path) -> None:
    csv_path = out_dir / "results.csv"
    if not csv_path.exists():
        return
    rows = list(csv.DictReader(open(csv_path, newline="")))

    # Group by pairing_key.
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["pairing_key"], []).append(r)

    lines = ["# 9×9 ladder calibration — summary",
             "",
             f"_Generated {dt.datetime.now().isoformat(timespec='seconds')}_",
             "",
             "## Phase 0 — rank-ordering validation (even games, komi=7.5)",
             "",
             "| Pairing | Games | Black wins | Win% | 95% CI | Avg margin | Notes |",
             "|---------|------:|-----------:|-----:|-------:|-----------:|-------|"]
    # Phase 0 first, then Phase 1, in stable order.
    def _key_sort(k: str) -> tuple:
        parts = k.split("|")
        return (parts[0], parts[1], parts[2], parts[4])

    for phase_filter, phase_header in [
        ("p0", None),
        ("p1", "\n## Phase 1 — komi-per-rank slope (same-profile, varying komi)\n\n"
               "| Pairing | Komi | Games | Black wins | Win% | 95% CI | Avg margin |\n"
               "|---------|-----:|------:|-----------:|-----:|-------:|-----------:|"),
        ("pv", "\n## Profile validation — adjacent-rank bot-vs-bot "
               "(target: stronger wins 60-90% per 3-rank step)\n\n"
               "| Pairing | Games | Black wins | Win% | 95% CI | Avg margin | Notes |\n"
               "|---------|------:|-----------:|-----:|-------:|-----------:|-------|"),
    ]:
        if phase_header:
            lines.append(phase_header)
        for key in sorted(groups, key=_key_sort):
            if not key.startswith(phase_filter):
                continue
            rs = groups[key]
            wins_b = sum(1 for r in rs if r["winner"] == "black")
            wins_w = sum(1 for r in rs if r["winner"] == "white")
            errs   = sum(1 for r in rs if r["winner"] not in ("black", "white"))
            n = wins_b + wins_w
            if n == 0:
                continue
            lo, hi = wilson_ci(wins_b, n)
            margins = [float(r["margin"]) for r in rs
                       if r.get("margin") not in (None, "", "None")
                       and r["winner"] == "black"]
            margins += [-float(r["margin"]) for r in rs
                        if r.get("margin") not in (None, "", "None")
                        and r["winner"] == "white"]
            avg_margin = sum(margins) / len(margins) if margins else float("nan")
            parts = key.split("|")
            label = f"{parts[1]} v {parts[2]}"
            if phase_filter in ("p0", "pv"):
                notes_parts = []
                if errs: notes_parts.append(f"errs={errs}")
                if phase_filter == "pv":
                    w_pct = 100 * wins_w / n
                    if 60 <= w_pct <= 90 or 60 <= 100*wins_b/n <= 90:
                        notes_parts.append("✓ in band")
                    elif w_pct > 90 or 100*wins_b/n > 90:
                        notes_parts.append("⚠ too lopsided")
                    else:
                        notes_parts.append("⚠ too flat")
                notes = ", ".join(notes_parts)
                lines.append(f"| {label} | {n} | {wins_b} | {100*wins_b/n:.0f}% | "
                             f"{100*lo:.0f}-{100*hi:.0f}% | {avg_margin:+.1f} | {notes} |")
            else:
                komi = parts[4][1:]  # 'k+7.0' -> '+7.0'
                lines.append(f"| {label} | {komi} | {n} | {wins_b} | {100*wins_b/n:.0f}% | "
                             f"{100*lo:.0f}-{100*hi:.0f}% | {avg_margin:+.1f} |")

    (out_dir / "summary.md").write_text("\n".join(lines) + "\n")


# ---------- top level ----------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="9×9 ladder calibration — Phase 0 + Phase 1 orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--port", type=int, default=8101,
                        help="Backend port (default 8101 = make calibrate-up b28 side)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="Directory for results.csv + summary.md + progress.log")
    parser.add_argument("--phases", default="0,1",
                        help="Comma list: 0, 1, pv, rv (default 0,1). "
                             "pv = profile validation (full adjacent-rank matrix). "
                             "rv = relabel validation (3-pair matrix for the final relabeled profile set)")
    parser.add_argument("--include-15k-phase1", action="store_true",
                        help="Also run the 15k same-profile komi sweep "
                             "(adds ~2.5h to the run)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the matrix + estimated time, then exit")
    args = parser.parse_args()

    out_dir: Path = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    progress_path = out_dir / "progress.log"

    def log(msg: str) -> None:
        print(msg, flush=True)
        with open(progress_path, "a") as f:
            f.write(msg + "\n")

    # Build matrix.
    phases = [p.strip() for p in args.phases.split(",")]
    matrix: list[Pairing] = []
    if "0" in phases: matrix += PHASE0
    if "1" in phases: matrix += PHASE1_TRUSTED
    if "1" in phases and args.include_15k_phase1:
        matrix += PHASE1_15K_OPTIONAL
    if "pv" in phases: matrix += PROFILE_VALIDATION
    if "rv" in phases: matrix += RELABEL_VALIDATION
    if "fv" in phases: matrix += FINAL_VALIDATION

    if not matrix:
        sys.exit("Empty matrix — pass --phases 0,1, pv, rv, or fv")

    # Rough per-pairing time estimate, for a heads-up before the run starts.
    # 9×9 game length is ~50-80 moves; per-move time scales with visit count.
    # Use AVERAGE visits across the two players since each plays half the
    # moves — using max overestimates cross-rank pairings significantly.
    visit_est = {"30k": 4, "18k": 9, "15k": 10, "12k": 11, "9k": 12,
                 "6k": 12, "3k": 30, "1d": 50}
    def _est_secs(p: Pairing) -> float:
        # ~60 moves/game; per move 0.15s + visits * 0.08s on Mac native b28.
        avg_v = (visit_est.get(p.black, 12) + visit_est.get(p.white, 12)) / 2
        return p.games * 60 * (0.15 + avg_v * 0.08)
    total_est = sum(_est_secs(p) for p in matrix)
    log(f"Matrix: {len(matrix)} pairings, "
        f"{sum(p.games for p in matrix)} total games, "
        f"~{total_est/3600:.1f} h estimated wall time")
    for p in matrix:
        log(f"  {p.key}  games={p.games}  ~{_est_secs(p)/60:.0f} min")

    if args.dry_run:
        log("\n(dry-run, exiting)")
        return

    api_url = f"http://{args.host}:{args.port}/api"
    health_url = f"http://{args.host}:{args.port}/health"

    log(f"\nChecking backend at {health_url}...")
    try:
        with httpx.Client(timeout=10) as probe:
            r = probe.get(health_url)
            assert r.status_code == 200, r.text
    except Exception as exc:
        log(f"ERROR: backend not reachable: {exc}")
        log("       Bring it up with: make calibrate-up   (b28 side on :8101)")
        log("       OR:                make 9x9-ladder-up (single-backend on :8200)")
        sys.exit(2)
    log("  ✓ backend healthy")

    counts = existing_counts(out_dir / "results.csv")
    if counts:
        log(f"Resuming — found {sum(counts.values())} games already on disk across "
            f"{len(counts)} pairings")

    t_start = time.time()
    with httpx.Client(timeout=180) as client:
        for pairing in matrix:
            run_pairing(client, api_url, out_dir, pairing,
                        already=counts.get(pairing.key, 0), log_fn=log)
            write_summary(out_dir)  # refresh after every pairing
    log(f"\nDONE. Total wall time: {(time.time()-t_start)/3600:.2f} h")
    log(f"Summary: {out_dir/'summary.md'}")


if __name__ == "__main__":
    main()
