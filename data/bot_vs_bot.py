"""
Bot vs Bot match runner.

Plays games between two bot ranks to verify strength differential.
Supports handicap stones to measure the rank gap.

Uses the backend's native bot-vs-bot support (black_rank + white_rank on
game creation) — one game per match, one ai-move call per turn. Much
faster than the old per-move "recreate + replay" approach.

Expected (with good calibration):
  - 3-rank gap ≈ 3 handicap stones, so 12k vs 15k should be roughly
    even at 3 handicap (Black=weaker with 3 stones), and the stronger
    bot should win ~75-80% at even games.

Usage:
    python bot_vs_bot.py --black 15k --white 12k --games 6
    python bot_vs_bot.py --black 15k --white 12k --games 6 --handicap 3
"""

import argparse
import sys
import time
import httpx

API = "http://localhost:8000/api"


def play_game(client: httpx.Client, black_rank: str, white_rank: str,
              handicap: int = 0, komi: float = 7.5, max_moves: int = 500,
              verbose: bool = False) -> dict:
    """
    Play a full game between two bots via the backend's native bot-vs-bot
    game mode: one game created with both black_rank and white_rank set,
    then ai-move calls in a loop until the game ends.
    """
    effective_komi = 0.5 if handicap > 0 else komi

    r = client.post(f"{API}/games", json={
        "target_rank": black_rank,          # Back-compat; ignored when both are set
        "mode": "casual",
        "komi": effective_komi,
        "player_color": "black",
        "handicap": handicap,
        "black_rank": black_rank,
        "white_rank": white_rank,
    })
    if r.status_code != 200:
        return {
            "black_rank": black_rank, "white_rank": white_rank,
            "handicap": handicap, "komi": effective_komi,
            "moves": 0, "winner": "error", "result": None,
            "error": f"create game failed: {r.text}",
        }
    gid = r.json()["game_id"]

    passes = 0
    move_num = 0
    result = None

    while move_num < max_moves:
        r = client.post(f"{API}/games/{gid}/ai-move", timeout=60)
        if r.status_code != 200:
            if verbose: print(f"  AI move failed: {r.text}")
            break

        ai = r.json()
        ar, ac = ai["point"]["row"], ai["point"]["col"]

        if ar < 0:
            passes += 1
            if verbose: print(f"  Move {move_num+1}: pass (consecutive: {passes})")
            if passes >= 2:
                state = client.get(f"{API}/games/{gid}").json()
                result = state.get("result")
                break
        else:
            passes = 0
            if verbose:
                who = "black" if move_num % 2 == 0 else "white"
                # After handicap, white moves first — flip the parity
                if handicap >= 2:
                    who = "white" if move_num % 2 == 0 else "black"
                print(f"  Move {move_num+1}: {who} at ({ar},{ac})")

        # Check for natural game end
        state = client.get(f"{API}/games/{gid}").json()
        if state.get("phase") != "playing":
            result = state.get("result")
            break

        move_num += 1

    # Count real moves from the game state (ignore handicap setup)
    state = client.get(f"{API}/games/{gid}").json()
    real_moves = state.get("move_number", move_num)
    winner = result.get("winner", "unknown") if result else "unknown"

    return {
        "black_rank": black_rank,
        "white_rank": white_rank,
        "handicap": handicap,
        "komi": effective_komi,
        "moves": real_moves,
        "winner": winner,
        "result": result,
    }


def main():
    parser = argparse.ArgumentParser(description="Bot vs Bot match runner")
    parser.add_argument('--black', type=str, required=True, help='Black bot rank')
    parser.add_argument('--white', type=str, required=True, help='White bot rank')
    parser.add_argument('--games', type=int, default=5, help='Number of games')
    parser.add_argument('--handicap', type=int, default=0, help='Handicap stones for Black')
    parser.add_argument('--komi', type=float, default=7.5, help='Komi (overridden to 0.5 if handicap > 0)')
    parser.add_argument('--max-moves', type=int, default=600, help='Max moves per game')
    parser.add_argument('--verbose', action='store_true', help='Print each move')
    args = parser.parse_args()

    client = httpx.Client(timeout=120)
    try:
        r = client.get(f"{API.replace('/api','')}/health")
        assert r.status_code == 200
    except Exception:
        print("ERROR: Backend not running on localhost:8000")
        sys.exit(1)

    hc_str = f" (handicap {args.handicap})" if args.handicap > 0 else ""
    print(f"Bot vs Bot: {args.black} (Black) vs {args.white} (White){hc_str}")
    print(f"Playing {args.games} games, max {args.max_moves} moves each\n")

    results = []
    black_wins = 0
    white_wins = 0
    errors = 0

    for i in range(args.games):
        t0 = time.time()
        print(f"Game {i+1}/{args.games}...", end=" ", flush=True)

        game_result = play_game(
            client, args.black, args.white,
            handicap=args.handicap, komi=args.komi,
            max_moves=args.max_moves, verbose=args.verbose,
        )
        results.append(game_result)

        elapsed = time.time() - t0
        w = game_result["winner"]
        m = game_result["moves"]

        if w == "black":
            black_wins += 1
        elif w == "white":
            white_wins += 1
        else:
            errors += 1

        margin = ""
        if game_result["result"]:
            mg = game_result["result"].get("margin", 0)
            reason = game_result["result"].get("reason", "")
            if reason == "resignation":
                margin = " (resign)"
            elif mg:
                margin = f" (+{mg})"

        print(f"{w} wins{margin} in {m} moves ({elapsed:.1f}s)")

    print(f"\n{'='*50}")
    print(f"RESULTS: {args.black} vs {args.white}{hc_str}")
    print(f"{'='*50}")
    total_completed = black_wins + white_wins
    if total_completed > 0:
        print(f"Black ({args.black}) wins: {black_wins}/{total_completed} ({100*black_wins/total_completed:.0f}%)")
        print(f"White ({args.white}) wins: {white_wins}/{total_completed} ({100*white_wins/total_completed:.0f}%)")
    if errors:
        print(f"Errors / incomplete: {errors}")

    avg_moves = sum(r["moves"] for r in results) / len(results) if results else 0
    print(f"Average game length: {avg_moves:.0f} moves")


if __name__ == "__main__":
    main()
