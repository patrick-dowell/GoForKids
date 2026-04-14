"""
Analyze 15k Go games from the Fox dataset to understand typical play patterns.

Outputs:
- Move distribution (where on the board 15k players play)
- Opening patterns (first 20 moves)
- Game length distribution
- Common local response patterns (how often they play near the last move)
- First-line play frequency
- Tenuki frequency (playing away from the action)
"""

import os
import re
import random
from collections import Counter, defaultdict

BOARD_SIZE = 19
SGF_DIR = "15k"

# GTP-style coordinate conversion
def sgf_to_point(sgf_coord: str) -> tuple[int, int]:
    """Convert SGF coordinate like 'dp' to (row, col)."""
    if len(sgf_coord) != 2:
        return (-1, -1)
    col = ord(sgf_coord[0]) - ord('a')
    row = ord(sgf_coord[1]) - ord('a')
    if 0 <= col < BOARD_SIZE and 0 <= row < BOARD_SIZE:
        return (row, col)
    return (-1, -1)


def parse_sgf_moves(sgf_text: str) -> list[tuple[str, int, int]]:
    """Extract moves from SGF. Returns [(color, row, col), ...]."""
    moves = []
    # Match ;B[xx] or ;W[xx]
    for m in re.finditer(r';([BW])\[([a-s]{2})\]', sgf_text):
        color = m.group(1)
        row, col = sgf_to_point(m.group(2))
        if row >= 0:
            moves.append((color, row, col))
    return moves


def edge_distance(row: int, col: int) -> int:
    """Distance from the nearest edge."""
    return min(row, col, BOARD_SIZE - 1 - row, BOARD_SIZE - 1 - col)


def manhattan_dist(r1, c1, r2, c2) -> int:
    return abs(r1 - r2) + abs(c1 - c2)


def analyze_games(sgf_dir: str, max_games: int = 5000):
    files = [f for f in os.listdir(sgf_dir) if f.endswith('.sgf')]
    if len(files) > max_games:
        files = random.sample(files, max_games)

    print(f"Analyzing {len(files)} games from {sgf_dir}/\n")

    # Counters
    game_lengths = []
    move_heatmap = [[0] * BOARD_SIZE for _ in range(BOARD_SIZE)]
    edge_dist_counts = Counter()  # How far from edge each move is
    local_response_dists = []  # Manhattan distance from previous move
    first_line_count = 0
    total_moves = 0
    tenuki_count = 0  # Playing > 6 away from last move
    opening_moves = defaultdict(int)  # First 4 moves patterns
    pass_count = 0
    games_with_result = Counter()

    for fname in files:
        path = os.path.join(sgf_dir, fname)
        try:
            with open(path, 'r', errors='ignore') as f:
                sgf = f.read()
        except:
            continue

        # Extract result
        result_match = re.search(r'RE\[([^\]]+)\]', sgf)
        if result_match:
            result = result_match.group(1)
            if 'B+' in result:
                games_with_result['black_wins'] += 1
            elif 'W+' in result:
                games_with_result['white_wins'] += 1
            if '+R' in result:
                games_with_result['resignation'] += 1
            elif '+T' in result:
                games_with_result['timeout'] += 1

        moves = parse_sgf_moves(sgf)
        if not moves:
            continue

        game_lengths.append(len(moves))

        # Opening pattern (first 4 moves as star point names)
        if len(moves) >= 4:
            opening = tuple((m[1], m[2]) for m in moves[:4])
            opening_moves[opening] += 1

        prev_row, prev_col = -1, -1
        for i, (color, row, col) in enumerate(moves):
            total_moves += 1
            move_heatmap[row][col] += 1

            ed = edge_distance(row, col)
            edge_dist_counts[ed] += 1

            if ed == 0:
                first_line_count += 1

            if prev_row >= 0:
                dist = manhattan_dist(row, col, prev_row, prev_col)
                local_response_dists.append(dist)
                if dist > 6:
                    tenuki_count += 1

            prev_row, prev_col = row, col

    # --- Report ---
    print(f"Games analyzed: {len(game_lengths)}")
    print(f"Total moves: {total_moves}")
    avg_len = sum(game_lengths) / len(game_lengths) if game_lengths else 0
    print(f"Average game length: {avg_len:.0f} moves")
    print(f"Median game length: {sorted(game_lengths)[len(game_lengths)//2]} moves")
    print()

    print("=== Win rates ===")
    total_decided = games_with_result['black_wins'] + games_with_result['white_wins']
    if total_decided:
        print(f"Black wins: {games_with_result['black_wins']} ({100*games_with_result['black_wins']/total_decided:.0f}%)")
        print(f"White wins: {games_with_result['white_wins']} ({100*games_with_result['white_wins']/total_decided:.0f}%)")
    print(f"By resignation: {games_with_result['resignation']}")
    print(f"By timeout: {games_with_result['timeout']}")
    print()

    print("=== Edge distance distribution ===")
    for d in range(10):
        pct = 100 * edge_dist_counts[d] / total_moves if total_moves else 0
        bar = '#' * int(pct)
        print(f"  Line {d+1}: {pct:5.1f}% {bar}")
    print(f"  First line (edge): {100*first_line_count/total_moves:.1f}% of all moves")
    print()

    print("=== Local response patterns ===")
    if local_response_dists:
        avg_dist = sum(local_response_dists) / len(local_response_dists)
        print(f"Average distance from previous move: {avg_dist:.1f}")
        print(f"Tenuki rate (>6 away): {100*tenuki_count/len(local_response_dists):.1f}%")

        # Distribution buckets
        buckets = Counter()
        for d in local_response_dists:
            if d <= 2:
                buckets['adjacent (1-2)'] += 1
            elif d <= 4:
                buckets['near (3-4)'] += 1
            elif d <= 6:
                buckets['medium (5-6)'] += 1
            elif d <= 10:
                buckets['far (7-10)'] += 1
            else:
                buckets['tenuki (11+)'] += 1

        total_resp = len(local_response_dists)
        for label in ['adjacent (1-2)', 'near (3-4)', 'medium (5-6)', 'far (7-10)', 'tenuki (11+)']:
            pct = 100 * buckets[label] / total_resp
            bar = '#' * int(pct)
            print(f"  {label:20s}: {pct:5.1f}% {bar}")
    print()

    print("=== Heatmap (top 15 most played intersections) ===")
    top_points = []
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            top_points.append((move_heatmap[r][c], r, c))
    top_points.sort(reverse=True)
    labels = "ABCDEFGHJKLMNOPQRST"
    for count, r, c in top_points[:15]:
        pct = 100 * count / total_moves
        coord = f"{labels[c]}{BOARD_SIZE - r}"
        print(f"  {coord:4s}: {count:6d} ({pct:.2f}%)")
    print()

    print("=== Game length distribution ===")
    brackets = [(0, 50), (51, 100), (101, 150), (151, 200), (201, 250), (251, 300), (301, 400), (401, 999)]
    for lo, hi in brackets:
        count = sum(1 for g in game_lengths if lo <= g <= hi)
        pct = 100 * count / len(game_lengths) if game_lengths else 0
        bar = '#' * int(pct)
        print(f"  {lo:3d}-{hi:3d}: {pct:5.1f}% {bar}")


if __name__ == "__main__":
    analyze_games(SGF_DIR, max_games=10000)
