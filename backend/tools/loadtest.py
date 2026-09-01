#!/usr/bin/env python3
"""Concurrent-client load harness for the analysis backend.

Simulates N players each running a live 9x9 game against the bot:
create game -> loop(play a legal human move -> request the AI reply,
timed -> think). Measures the ai-move latency distribution per phase,
counting requests that cross the frontend's 20s hard timeout
(REQUEST_TIMEOUT_MS in frontend/src/api/client.ts) — those are the
requests a real client would have abandoned.

Stdlib only. Example:

    python3 tools/loadtest.py --base https://goforkids-api.onrender.com \
        --clients 12 --duration 180 --think 10,20 --csv out.csv

The harness itself never aborts at 20s — it waits for the true latency
so saturation is measurable rather than censored.
"""

import argparse
import csv
import json
import random
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request

CLIENT_TIMEOUT_S = 20.0  # frontend REQUEST_TIMEOUT_MS, the "would have failed" line
HARNESS_TIMEOUT_S = 120.0  # true ceiling before the harness gives up on a request
RANKS = ["30k", "18k", "15k"]


def post(base, path, body=None, timeout=HARNESS_TIMEOUT_S):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        base + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def empty_points(board):
    return [
        (r, c)
        for r, row in enumerate(board)
        for c, v in enumerate(row)
        if v == 0
    ]


def run_client(idx, base, stop_at, think_lo, think_hi, samples, errors, lock):
    rng = random.Random(idx)
    try:
        state = post(
            base,
            "/api/games",
            {"board_size": 9, "target_rank": RANKS[idx % len(RANKS)], "mode": "casual"},
        )
    except Exception as e:  # noqa: BLE001 - record and bail; phase report shows it
        with lock:
            errors.append(("create", repr(e)))
        return
    gid = state["game_id"]

    while time.time() < stop_at:
        # Human move: random empty point; on an illegal-move 400, try another.
        pts = empty_points(state["board"])
        if len(pts) < 15 or state.get("phase") != "playing":
            try:
                state = post(
                    base,
                    "/api/games",
                    {"board_size": 9, "target_rank": RANKS[idx % len(RANKS)], "mode": "casual"},
                )
                gid = state["game_id"]
                continue
            except Exception as e:  # noqa: BLE001
                with lock:
                    errors.append(("recreate", repr(e)))
                return
        placed = False
        for _ in range(8):
            r, c = rng.choice(pts)
            try:
                state = post(base, f"/api/games/{gid}/move", {"row": r, "col": c})
                placed = True
                break
            except urllib.error.HTTPError as e:
                if e.code == 400:
                    continue  # illegal point; pick another
                with lock:
                    errors.append(("move", f"HTTP {e.code}"))
                break
            except Exception as e:  # noqa: BLE001
                with lock:
                    errors.append(("move", repr(e)))
                break
        if not placed:
            time.sleep(2)
            continue

        # The measured request: the AI reply.
        t0 = time.time()
        try:
            post(base, f"/api/games/{gid}/ai-move")
            dt = time.time() - t0
            with lock:
                samples.append((time.time(), idx, dt, "ok"))
        except Exception as e:  # noqa: BLE001
            dt = time.time() - t0
            with lock:
                samples.append((time.time(), idx, dt, "err"))
                errors.append(("ai-move", repr(e)))

        # Refresh state for the next point pick (ai-move response lacks the grid).
        try:
            req = urllib.request.Request(base + f"/api/games/{gid}")
            with urllib.request.urlopen(req, timeout=HARNESS_TIMEOUT_S) as r:
                state = json.loads(r.read().decode())
        except Exception:  # noqa: BLE001
            pass

        time.sleep(rng.uniform(think_lo, think_hi))


def run_finisher(idx, base, stop_at, samples, errors, lock):
    """End-of-game client: plays a few quick moves, then loops finish-move
    (one full-strength engine move per call) with no think time — the
    Finish Game flow's real request pattern."""
    rng = random.Random(1000 + idx)
    state = None
    while time.time() < stop_at:
        try:
            state = post(
                base, "/api/games", {"board_size": 9, "target_rank": "15k", "mode": "casual"}
            )
        except Exception as e:  # noqa: BLE001
            with lock:
                errors.append(("f-create", repr(e)))
            return
        gid = state["game_id"]
        # Seed a short midgame so finish has something to wrap up.
        for _ in range(4):
            pts = empty_points(state["board"])
            for _ in range(8):
                r, c = rng.choice(pts)
                try:
                    state = post(base, f"/api/games/{gid}/move", {"row": r, "col": c})
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 400:
                        continue
                    break
                except Exception:  # noqa: BLE001
                    break
            try:
                post(base, f"/api/games/{gid}/ai-move")
            except Exception:  # noqa: BLE001
                pass
        # The storm: tight finish loop until the game ends or phase stops.
        while time.time() < stop_at:
            t0 = time.time()
            try:
                res = post(base, f"/api/games/{gid}/finish-move")
                dt = time.time() - t0
                with lock:
                    samples.append((time.time(), f"fin{idx}", dt, "finish-ok"))
                if res.get("final_state"):
                    break
            except urllib.error.HTTPError as e:
                dt = time.time() - t0
                with lock:
                    samples.append((time.time(), f"fin{idx}", dt, "finish-err"))
                if e.code == 400:  # game left playing phase
                    break
                with lock:
                    errors.append(("finish", f"HTTP {e.code}"))
                break
            except Exception as e:  # noqa: BLE001
                dt = time.time() - t0
                with lock:
                    samples.append((time.time(), f"fin{idx}", dt, "finish-err"))
                with lock:
                    errors.append(("finish", repr(e)))
                break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--clients", type=int, required=True)
    ap.add_argument("--duration", type=int, default=180)
    ap.add_argument("--think", default="10,20")
    ap.add_argument("--finishers", type=int, default=0)
    ap.add_argument("--csv", default=None)
    args = ap.parse_args()
    think_lo, think_hi = (float(x) for x in args.think.split(","))

    samples, errors = [], []
    lock = threading.Lock()
    stop_at = time.time() + args.duration
    threads = [
        threading.Thread(
            target=run_client,
            args=(i, args.base, stop_at, think_lo, think_hi, samples, errors, lock),
            daemon=True,
        )
        for i in range(args.clients)
    ] + [
        threading.Thread(
            target=run_finisher,
            args=(k, args.base, stop_at, samples, errors, lock),
            daemon=True,
        )
        for k in range(args.finishers)
    ]
    for i, t in enumerate(threads):
        t.start()
        time.sleep(0.5)  # stagger joins like real players
    for t in threads:
        t.join(timeout=args.duration + HARNESS_TIMEOUT_S + 30)

    print(
        f"\nphase: clients={args.clients} finishers={args.finishers} "
        f"duration={args.duration}s think={args.think}"
    )
    for label, statuses in (("ai-move", ("ok",)), ("finish-move", ("finish-ok",))):
        rows = [s for s in samples if s[3] in statuses]
        errs = len([s for s in samples if s[3] == statuses[0].replace("ok", "err")])
        lat = [s[2] for s in rows]
        if not lat and not errs:
            continue
        print(f"{label}: requests={len(rows)+errs} ok={len(rows)} err={errs}")
        if lat:
            lat_sorted = sorted(lat)
            q = lambda p: lat_sorted[min(len(lat_sorted) - 1, int(p * len(lat_sorted)))]
            over = [d for d in lat if d > CLIENT_TIMEOUT_S]
            print(
                f"  latency s: p50={statistics.median(lat):.2f} p90={q(0.90):.2f} "
                f"p95={q(0.95):.2f} max={max(lat):.2f} | over "
                f"{CLIENT_TIMEOUT_S:.0f}s (client would have timed out): {len(over)}"
            )
    if errors:
        print(f"errors ({len(errors)}): first 5: {errors[:5]}")
    if args.csv:
        with open(args.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["ts", "client", "latency_s", "status"])
            w.writerows(samples)
        print(f"samples -> {args.csv}")


if __name__ == "__main__":
    main()
