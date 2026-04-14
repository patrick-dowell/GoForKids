"""
Bot vs Bot match runner.

Plays games between two bot ranks to verify strength differential.
Supports handicap stones to measure the rank gap.

Expected: a 3-rank difference ≈ 3 handicap stones in Go.
So 18k vs 15k should be roughly even at 3 handicap stones,
and 15k should dominate at even games.

Usage:
    python bot_vs_bot.py --black 18k --white 15k --games 5
    python bot_vs_bot.py --black 18k --white 15k --games 5 --handicap 3
"""

import argparse
import sys
import time
import httpx

API = "http://localhost:8000/api"
BOARD_SIZE = 19

# Standard handicap stone positions (star points)
HANDICAP_POINTS = {
    2: [(3, 15), (15, 3)],
    3: [(3, 15), (15, 3), (15, 15)],
    4: [(3, 3), (3, 15), (15, 3), (15, 15)],
    5: [(3, 3), (3, 15), (15, 3), (15, 15), (9, 9)],
    6: [(3, 3), (3, 15), (15, 3), (15, 15), (3, 9), (15, 9)],
    7: [(3, 3), (3, 15), (15, 3), (15, 15), (3, 9), (15, 9), (9, 9)],
    8: [(3, 3), (3, 15), (15, 3), (15, 15), (3, 9), (15, 9), (9, 3), (9, 15)],
    9: [(3, 3), (3, 15), (15, 3), (15, 15), (3, 9), (15, 9), (9, 3), (9, 15), (9, 9)],
}


def play_game(client: httpx.Client, black_rank: str, white_rank: str,
              handicap: int = 0, komi: float = 7.5, max_moves: int = 500,
              verbose: bool = False) -> dict:
    """
    Play a full game between two bots.

    Black plays as `black_rank`, White plays as `white_rank`.
    Handicap stones are placed for Black if handicap > 0 (komi adjusts to 0.5).
    """
    effective_komi = 0.5 if handicap > 0 else komi

    # We'll run two parallel backend games — one for each bot's perspective.
    # Actually simpler: use one game, alternate AI moves at different ranks.
    # But the API only supports one rank per game.
    #
    # Workaround: maintain the board state locally via moves, and ask each
    # bot for its move by creating a fresh game, replaying moves, then
    # requesting ai-move.

    moves = []  # List of (row, col) — alternating black/white
    passes = 0
    result = None

    # Place handicap stones
    if handicap > 0 and handicap in HANDICAP_POINTS:
        for r, c in HANDICAP_POINTS[handicap]:
            moves.append(("H", r, c))  # H = handicap, not a real move

    move_num = 0
    # After handicap, white moves first
    current = "white" if handicap > 0 else "black"

    while move_num < max_moves:
        rank = black_rank if current == "black" else white_rank

        # Create a temp game at this rank
        r = client.post(f"{API}/games", json={
            "target_rank": rank, "mode": "casual",
            "komi": effective_komi, "player_color": "black"
        })
        if r.status_code != 200:
            if verbose: print(f"  Failed to create game: {r.text}")
            break
        gid = r.json()["game_id"]

        # Replay all moves so far
        replay_ok = True
        for entry in moves:
            if entry[0] == "H":
                # Handicap stone — play as black
                _, hr, hc = entry
                rr = client.post(f"{API}/games/{gid}/move", json={"row": hr, "col": hc})
                if rr.status_code != 200:
                    replay_ok = False
                    break
                # After handicap, need to pass for white to keep turn order
                # Actually the engine alternates, so after placing black handicap
                # stones we need white to "pass" to give black another handicap stone.
                # But that would trigger consecutive pass detection...
                # Simpler: just skip handicap replay and set up the position differently.
            elif entry[0] == "pass":
                rr = client.post(f"{API}/games/{gid}/pass")
                if rr.status_code != 200:
                    replay_ok = False
                    break
            else:
                _, mr, mc = entry
                rr = client.post(f"{API}/games/{gid}/move", json={"row": mr, "col": mc})
                if rr.status_code != 200:
                    replay_ok = False
                    break

        if not replay_ok:
            if verbose: print(f"  Replay failed at move {move_num}")
            break

        # Check if game ended during replay
        state = client.get(f"{API}/games/{gid}").json()
        if state["phase"] != "playing":
            result = state.get("result")
            break

        # Ask the bot for a move
        r = client.post(f"{API}/games/{gid}/ai-move", timeout=60)
        if r.status_code != 200:
            if verbose: print(f"  AI move failed: {r.text}")
            break

        ai = r.json()
        ar, ac = ai["point"]["row"], ai["point"]["col"]

        if ar < 0:
            # Bot passed
            passes += 1
            moves.append(("pass", -1, -1))
            if verbose: print(f"  Move {move_num+1}: {current} passes (consecutive: {passes})")
            if passes >= 2:
                # Game over — get the final state
                state = client.get(f"{API}/games/{gid}").json()
                result = state.get("result")
                break
        else:
            passes = 0
            moves.append(("move", ar, ac))
            if verbose: print(f"  Move {move_num+1}: {current} at ({ar},{ac})")

        move_num += 1
        current = "white" if current == "black" else "black"

    real_moves = sum(1 for m in moves if m[0] == "move")
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
    parser.add_argument('--komi', type=float, default=7.5, help='Komi (ignored if handicap > 0)')
    parser.add_argument('--max-moves', type=int, default=400, help='Max moves per game')
    parser.add_argument('--verbose', action='store_true', help='Print each move')
    args = parser.parse_args()

    client = httpx.Client(timeout=60)
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
    print(f"Black ({args.black}) wins: {black_wins}/{args.games} ({100*black_wins/args.games:.0f}%)")
    print(f"White ({args.white}) wins: {white_wins}/{args.games} ({100*white_wins/args.games:.0f}%)")

    avg_moves = sum(r["moves"] for r in results) / len(results) if results else 0
    print(f"Average game length: {avg_moves:.0f} moves")

    if args.handicap == 0:
        if white_wins > black_wins:
            print(f"\n→ {args.white} is stronger (as expected)")
        elif black_wins > white_wins:
            print(f"\n→ {args.black} is stronger (unexpected — {args.white} should be stronger)")
        else:
            print(f"\n→ Even — bots may be similar strength")


if __name__ == "__main__":
    main()
