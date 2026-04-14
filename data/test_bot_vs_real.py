"""
Test the 15k bot against real 15k games via the running backend API.

For each position in a sample of real games, we:
1. Create a backend game
2. Replay moves up to the test position
3. Ask the bot for a move via the AI endpoint
4. Compare to what the real 15k player actually played

Requires the backend to be running on localhost:8000.

Usage:
    python test_bot_vs_real.py [--games 30] [--positions-per-game 6]
"""

import os
import re
import sys
import random
import argparse
import json
from collections import Counter
import httpx

API = "http://localhost:8000/api"
SGF_DIR = os.path.join(os.path.dirname(__file__), '15k')
BOARD_SIZE = 19


def sgf_to_point(coord: str) -> tuple[int, int]:
    if len(coord) != 2:
        return (-1, -1)
    col = ord(coord[0]) - ord('a')
    row = ord(coord[1]) - ord('a')
    if 0 <= col < BOARD_SIZE and 0 <= row < BOARD_SIZE:
        return (row, col)
    return (-1, -1)


def parse_sgf_moves(sgf: str) -> list[tuple[str, int, int]]:
    moves = []
    for m in re.finditer(r';([BW])\[([a-s]{2})\]', sgf):
        color = m.group(1)
        row, col = sgf_to_point(m.group(2))
        if row >= 0:
            moves.append((color, row, col))
    return moves


def manhattan_dist(r1, c1, r2, c2) -> int:
    return abs(r1 - r2) + abs(c1 - c2)


def edge_distance(row: int, col: int) -> int:
    return min(row, col, BOARD_SIZE - 1 - row, BOARD_SIZE - 1 - col)


def test_game(client: httpx.Client, sgf_path: str, positions_per_game: int = 6, target_rank: str = "15k") -> list[dict]:
    """Test several positions from one real game against the bot."""
    with open(sgf_path, 'r', errors='ignore') as f:
        sgf = f.read()

    moves = parse_sgf_moves(sgf)
    if len(moves) < 20:
        return []

    # Pick test positions spread across the game
    test_indices = set()
    phases = [
        (4, min(30, len(moves))),       # opening (skip first 4 — too obvious)
        (30, min(100, len(moves))),      # midgame
        (100, len(moves) - 1),           # endgame
    ]
    for start, end in phases:
        if start < end:
            available = list(range(start, end))
            count = min(max(1, positions_per_game // 3), len(available))
            test_indices.update(random.sample(available, count))

    results = []

    for test_idx in sorted(test_indices):
        # Create a fresh game for each test position
        r = client.post(f"{API}/games", json={
            "target_rank": target_rank, "mode": "casual",
            "komi": 7.5, "player_color": "black"
        })
        if r.status_code != 200:
            continue
        gid = r.json()["game_id"]

        # Replay moves up to the test position
        ok = True
        for i in range(test_idx):
            color_str, row, col = moves[i]
            # We need to play both colors through the move endpoint
            # The backend alternates turns, so we play each move in order
            r = client.post(f"{API}/games/{gid}/move", json={"row": row, "col": col})
            if r.status_code != 200:
                ok = False
                break

        if not ok:
            continue

        # Now ask the bot what it would play at this position
        real_color, real_row, real_col = moves[test_idx]
        real_move = (real_row, real_col)

        r = client.post(f"{API}/games/{gid}/ai-move", timeout=30)
        if r.status_code != 200:
            continue

        ai = r.json()
        bot_row, bot_col = ai["point"]["row"], ai["point"]["col"]

        if bot_row < 0:  # bot passed
            results.append({
                "move_number": test_idx + 1,
                "real_move": real_move,
                "bot_move": None,
                "exact_match": False,
                "dist": -1,
                "close_match": False,
                "same_region": False,
                "same_quadrant": False,
                "bot_passed": True,
            })
            continue

        bot_move = (bot_row, bot_col)
        dist = manhattan_dist(real_move[0], real_move[1], bot_move[0], bot_move[1])

        def quadrant(r, c):
            return (0 if r < 10 else 1, 0 if c < 10 else 1)

        results.append({
            "move_number": test_idx + 1,
            "real_move": real_move,
            "bot_move": bot_move,
            "exact_match": real_move == bot_move,
            "dist": dist,
            "close_match": dist <= 2,
            "same_region": dist <= 5,
            "same_quadrant": quadrant(*real_move) == quadrant(*bot_move),
            "bot_passed": False,
            "bot_edge_dist": edge_distance(bot_move[0], bot_move[1]),
            "real_edge_dist": edge_distance(real_move[0], real_move[1]),
        })

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--games', type=int, default=20, help='Number of games to sample')
    parser.add_argument('--positions', type=int, default=6, help='Positions per game to test')
    parser.add_argument('--rank', type=str, default='15k', help='Bot rank to test (e.g. 15k, 18k, 30k)')
    parser.add_argument('--sgf-dir', type=str, default=None, help='SGF directory (defaults to {rank}/)')
    args = parser.parse_args()

    sgf_dir = args.sgf_dir or os.path.join(os.path.dirname(__file__), args.rank)
    if not os.path.isdir(sgf_dir):
        # Try the closest available dataset
        fallbacks = {'20k': '18k', '30k': '18k', '25k': '18k'}
        fb = fallbacks.get(args.rank)
        if fb:
            sgf_dir = os.path.join(os.path.dirname(__file__), fb)
        if not os.path.isdir(sgf_dir):
            print(f"ERROR: SGF directory not found: {sgf_dir}")
            sys.exit(1)
        print(f"Note: No {args.rank} dataset, using {fb} games as proxy\n")

    # Check backend is running
    client = httpx.Client(timeout=30)
    try:
        r = client.get(f"{API.replace('/api','')}/health")
        assert r.status_code == 200
    except Exception:
        print("ERROR: Backend not running on localhost:8000. Start it first.")
        sys.exit(1)

    files = [f for f in os.listdir(sgf_dir) if f.endswith('.sgf')]
    if len(files) > args.games:
        files = random.sample(files, args.games)

    print(f"Testing {args.rank} bot against {len(files)} real games ({args.positions} positions each)")
    print(f"Using backend API at {API}\n")

    all_results = []
    for i, fname in enumerate(files):
        path = os.path.join(sgf_dir, fname)
        results = test_game(client, path, args.positions, target_rank=args.rank)
        all_results.extend(results)
        sys.stdout.write(f"\r  {i+1}/{len(files)} games, {len(all_results)} positions tested")
        sys.stdout.flush()

    print("\n")

    if not all_results:
        print("No positions tested!")
        return

    # --- Analysis ---
    total = len(all_results)
    valid = [r for r in all_results if not r.get("bot_passed")]
    passed = total - len(valid)

    exact = sum(1 for r in valid if r["exact_match"])
    close = sum(1 for r in valid if r["close_match"])
    same_region = sum(1 for r in valid if r["same_region"])
    same_quad = sum(1 for r in valid if r.get("same_quadrant", False))

    print(f"{'='*60}")
    print(f"RESULTS: {total} positions from {len(files)} games")
    print(f"{'='*60}")
    print(f"Bot passed:        {passed}/{total} ({100*passed/total:.1f}%)")
    print(f"Exact match:       {exact}/{len(valid)} ({100*exact/len(valid):.1f}%)" if valid else "")
    print(f"Close (≤2 away):   {close}/{len(valid)} ({100*close/len(valid):.1f}%)" if valid else "")
    print(f"Same area (≤5):    {same_region}/{len(valid)} ({100*same_region/len(valid):.1f}%)" if valid else "")
    print(f"Same quadrant:     {same_quad}/{len(valid)} ({100*same_quad/len(valid):.1f}%)" if valid else "")

    if valid:
        dists = [r["dist"] for r in valid]
        avg_dist = sum(dists) / len(dists)
        print(f"\nAvg distance from real move: {avg_dist:.1f}")

        dist_buckets = Counter()
        for d in dists:
            if d == 0: dist_buckets['exact (0)'] += 1
            elif d <= 2: dist_buckets['close (1-2)'] += 1
            elif d <= 5: dist_buckets['near (3-5)'] += 1
            elif d <= 10: dist_buckets['far (6-10)'] += 1
            else: dist_buckets['distant (11+)'] += 1

        print("\nDistance distribution:")
        for label in ['exact (0)', 'close (1-2)', 'near (3-5)', 'far (6-10)', 'distant (11+)']:
            count = dist_buckets[label]
            pct = 100 * count / len(valid)
            bar = '#' * int(pct / 2)
            print(f"  {label:16s}: {pct:5.1f}% {bar}")

        # By game phase
        print("\nBy game phase:")
        for phase_name, lo, hi in [("Opening (1-30)", 1, 30), ("Midgame (31-100)", 31, 100), ("Endgame (100+)", 101, 999)]:
            phase_r = [r for r in valid if lo <= r["move_number"] <= hi]
            if phase_r:
                pe = sum(1 for r in phase_r if r["exact_match"])
                pc = sum(1 for r in phase_r if r["close_match"])
                pr = sum(1 for r in phase_r if r["same_region"])
                pd = sum(r["dist"] for r in phase_r) / len(phase_r)
                print(f"  {phase_name:20s}: {len(phase_r):3d} pos, "
                      f"exact={100*pe/len(phase_r):.0f}%, "
                      f"close={100*pc/len(phase_r):.0f}%, "
                      f"region={100*pr/len(phase_r):.0f}%, "
                      f"avg_dist={pd:.1f}")

        # Edge distance comparison
        bot_edge = [r["bot_edge_dist"] for r in valid if "bot_edge_dist" in r]
        real_edge = [r["real_edge_dist"] for r in valid if "real_edge_dist" in r]
        if bot_edge and real_edge:
            print(f"\nEdge distance (avg): Bot={sum(bot_edge)/len(bot_edge):.1f}  "
                  f"Real={sum(real_edge)/len(real_edge):.1f}")


if __name__ == "__main__":
    main()
