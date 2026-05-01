# 20 — b28 Bot Calibration Harness

**Status:** 📝 Planned
**Priority:** High (blocks the b20 → b28 model swap on Render+local; that swap blocks Path C / iPad rank calibration)

## What

A tool that recalibrates every existing bot profile — **all ranks × all board sizes** — for the new b28 KataGo network by pitting candidate b28-tuned bots against the current b20-calibrated bots head-to-head and iterating parameters until they reach ~50/50 win rate.

End artifacts:
- `data/profiles/b28.yaml` — calibrated parameter values per `(rank, board_size)`, ready to load.
- `move_selector.py` updated to load profiles from YAML at runtime instead of hardcoded Python.
- `AI_CALIBRATION.md` updated with the new numbers + methodology note.

## Why

The current bot calibration in `move_selector.py` was tuned by hand against the b20 g170-era network. We want to switch all platforms to b28 (the network we proved works on iPad in Phase 2A) but the existing parameter values won't produce the same strength on b28 — visit counts, mistake frequencies, policy weights all need re-tuning. Doing it from scratch per rank by playtesting against humans would take weeks. Anchoring to the existing bots gives us a measurable, automatable target.

## Why this approach (vs alternatives)

- **vs. retuning by feel against humans:** way faster, deterministic, repeatable.
- **vs. validating against a real-game dataset (`test_bot_vs_real.py`):** that tool answers "does this bot resemble human play at rank X" but doesn't tell us "is it the same strength as our existing rank-X bot." 50/50 vs the existing bot is a more direct strength signal.
- **vs. just using ELO from `bot_vs_bot.py`:** ELO works but you need many rank pairs to converge; head-to-head at a single rank converges faster and gives per-rank-per-board precision.

## Scope: profile matrix

The calibration covers every explicit `(rank, board_size)` profile that currently exists in `move_selector.py`:

| Board | Ranks with explicit profiles |
|-------|-----------------------------|
| 5×5   | 30k                          |
| 9×9   | 30k, 15k, 6k                 |
| 13×13 | 30k, 15k, 6k                 |
| 19×19 | 30k, 18k, 15k, 12k, 9k, 6k   |

That's **13 profiles**. Smaller boards fall back to bigger-board profiles for ranks that don't have an explicit entry — calibration preserves this fallback behavior; we re-tune only what's explicit. (If we later want full-matrix coverage — e.g. an explicit 9k on 9×9 — that's an extension, not the v1 goal.)

## Approach

### Profiles as YAML (refactor `move_selector.py` to load at runtime)

Both the existing baseline and the calibration candidates live in YAML:

```yaml
# data/profiles/b20.yaml — current production calibration, translated from
# move_selector.py verbatim. Source of truth going forward; the Python no
# longer hardcodes profile numbers.
profiles:
  19x19:
    "30k":
      visits: 10
      policy_weight: 0.15
      mistake_freq: 0.55
      max_point_loss: 30
      randomness: 0.78
      random_move_chance: 0.08
      local_bias: 0.42
      opening_moves: 8
      use_katago: true
    "18k": { ... }
    "15k": { ... }
    "12k": { ... }
    "9k":  { ... }
    "6k":  { ... }
  13x13:
    "30k": { ... }
    "15k": { ... }
    "6k":  { ... }
  9x9:   { ... }
  5x5:
    "30k": { ... }   # first-game tuned, komi=0
```

Calibration candidates mirror the structure in `data/profiles/b28_candidate.yaml`. The final calibrated values land in `data/profiles/b28.yaml` once each profile passes its target. `move_selector.py` reads from a YAML path determined by env var (`CALIBRATION_PROFILE_PATH`) or defaults to `b20.yaml` / `b28.yaml` based on which model is active.

This refactor is small and load-bearing — once it's done, calibration is a YAML-edit + match-run loop, not a Python-edit + restart loop.

### Architecture: two backend instances

Easiest route — no new backend logic:

- **`backend-old`** on `:8000` — `KATAGO_MODEL=b20.bin.gz`, `CALIBRATION_PROFILE_PATH=data/profiles/b20.yaml`. Authoritative for what each rank "feels like."
- **`backend-new`** on `:8001` — `KATAGO_MODEL=b28.bin.gz`, `CALIBRATION_PROFILE_PATH=data/profiles/b28_candidate.yaml`. The bot we're tuning.

Both run the same code; only env differs. Calibration tool drives both via HTTP, alternates whose AI plays each move, reports the result.

### Phase 0 — sanity check (mandatory before any tuning)

Before tuning a single param, prove the harness measures what we think it measures:

1. Spin up **two `backend-old` instances** — both b20, both loading `b20.yaml`. Identical configs.
2. Run a 100-game match at **15k on 9×9** between them (b20 vs b20).
3. **Expected:** ~50% win rate (binomial 95% CI: 40-60%). If you see anything outside ~40-60%, the harness has a measurement bug — color asymmetry not handled, score-margin tiebreaker miscoded, state desync between backends, etc. Fix first; do not proceed.
4. Repeat on **13×13** and **19×19** at the same rank to confirm the harness behaves identically across board sizes.

Only after sanity check passes do we move to b28 calibration.

### Match runner

```sh
python data/calibrate_b28.py \
  --rank 15k \
  --board 9 \
  --old-url http://localhost:8000 \
  --new-url http://localhost:8001 \
  --games 100
```

Output:
```
15k @ 9×9: b28 wins 47/100 (47%, 95% CI 37-57%) | avg score margin -1.2 (b28 perspective)
  → calibration: ✅ within 45-55% target band
```

Per game:
- Create a game on each backend at the same rank + board size.
- Alternate "who is white" each game so first-move advantage is symmetric.
- Per turn: query the appropriate backend for an AI move, then `play` it on BOTH backends to keep state in sync.
- Capture result + score margin, optional SGF dump.

### Per-(rank, board) iteration loop

For each of the 13 profiles, in this order (smallest board first — converges fastest, often informs bigger boards):

1. Seed the candidate by cloning the b20 entry to b28's YAML (just a copy at first — the value of all 13 b20 profiles get duplicated as a starting point).
2. **Triage match** — 30 games. Tells us roughly which direction we're off.
3. Iterate knobs in priority order (see below). Re-run 30-game triage matches.
4. **Confirmation match** — 100 games. Result must be in the **45-55%** band.
5. Optional: run a second 100-game confirmation. If both ~50%, lock the profile.
6. Cross-check: confirm sanity tests still pass (no eye-fill, sensible openings, auto-pass on settled positions).

Knobs in tuning priority:
1. `visits` — dominant strength dial. b28 is stronger per visit than b20 → likely needs *fewer* visits to match each rank.
2. `policy_weight` — how strictly to follow KataGo's policy. Lower = looser play.
3. `mistake_freq` + `max_point_loss` — how often / how badly to deliberately blunder.
4. `randomness`, `random_move_chance`, `local_bias` — flavor knobs; tune last.
5. `opening_moves` — usually doesn't need to change between networks.

After all 13 done:
- Cross-rank validation per board: run `bot_vs_bot.py` with `12k_b28` vs `15k_b28` on 19×19 etc., confirm ordering holds (~3-handicap = even, ~75-80% win rate at no handicap).
- Update `move_selector.py` to load `b28.yaml` instead of `b20.yaml` (or via env).
- Update `AI_CALIBRATION.md` with new numbers + a "calibrated against b20-anchored matches, $DATE" methodology note.
- Swap `backend/models/b20.bin.gz` → `b28.bin.gz` in `Dockerfile` + local Mac config.

### Statistical sizing

- 100 games at p=0.5 gives a ±10% 95% CI. Target band 45-55% should be reached with the observed rate near 50%.
- 30 games is too noisy to confirm "we're done" — but useful for "are we in the right ballpark" during early iteration.
- If two consecutive 100-game runs give ~50% with the same params, lock it.

### Speed considerations (this is the real cost)

13 profiles × ~3-5 iteration rounds × (1 triage + 1 confirmation match) × games per match = a lot. Rough budget per profile, assuming a fresh-start triage flow:

| Board | Per-game time @ low visits | 30-game triage | 100-game confirmation |
|-------|---------------------------:|---------------:|----------------------:|
| 5×5   | ~10 sec                    | ~5 min         | ~17 min               |
| 9×9   | ~30 sec                    | ~15 min        | ~50 min               |
| 13×13 | ~90 sec                    | ~45 min        | ~2.5 h                |
| 19×19 | ~3 min                     | ~1.5 h         | ~5 h                  |

Total compute envelope to fully calibrate the matrix: somewhere in the **40-80 hours** of wall time, depending on how many iteration rounds each profile needs.

Mitigations:
- **9×9 first** for every rank, then propagate to 13×13 and 19×19 — bigger-board params often start close to 9×9 numbers, fewer rounds needed.
- **Triage at 30 games, confirm at 100** — don't waste compute on full confirmations during exploratory iteration.
- **Multiple backend pairs** — running 2-3 backend pairs concurrently on different port-pairs lets us calibrate multiple `(rank, board)` combos in parallel if you have CPU headroom. A Mac with 8+ cores can comfortably run 3-4 KataGo engines.
- **`KATAGO_SCORE_VISITS=0`** in calibration mode — skip per-move score-lead computation. Big savings.
- **Low `numSearchThreads` per engine** — calibration doesn't need Render-tuned settings; turn KataGo down per-engine to share cores.
- **Skip 19×19 confirmation runs for triage-stable profiles** — if a profile is already in 47-53% on 9×9 and 13×13, the 19×19 100-game run might be unnecessary; one 30-game spot-check could suffice for sign-off.
- **Run overnight.** This is a "kick off, sleep, check in the morning" workload, not interactive.

## File layout (proposed)

```
data/
├── calibrate_b28.py             ← match runner + iteration CLI
├── calibration_logs_b28/        ← per-match SGF dumps + CSV summaries per (rank,board)
└── profiles/
    ├── b20.yaml                 ← translated from current move_selector.py
    ├── b28_candidate.yaml       ← work-in-progress during calibration
    └── b28.yaml                 ← final, after every profile passes target

backend/
├── models/
│   ├── b20.bin.gz               ← current (committed)
│   └── b28.bin.gz               ← new (download script or LFS; ~150 MB)
└── app/ai/
    ├── move_selector.py         ← refactored to load profiles from YAML
    └── profile_loader.py        ← new: parses + validates the YAML

Makefile additions:
  calibrate-up                   # docker-compose up paired backends on :8000+:8001
  calibrate-down
  calibrate RANK=15k BOARD=9 GAMES=100
  calibrate-sanity BOARD=9       # Phase 0: b20-vs-b20 sanity check
```

## Out of scope (separate work)

- The b20 → b28 model swap on Render and local Mac (a separate small commit once calibration produces good numbers).
- Filling out missing matrix combos (e.g. explicit 9×9 9k profile). Kept as fallbacks for now; can be added later.
- Path C — porting `move_selector.py` to TypeScript. Comes after this; it's a faithful translation of known-good calibrated values, not a re-tuning.
- Continuous re-calibration on every KataGo network upgrade. This is a one-shot tool for the b20 → b28 transition, kept around in `data/` in case we need it again.

## Definition of done

- All 13 explicit profiles calibrated to 45-55% win rate vs their b20 counterparts over ≥100 games each.
- `data/profiles/b28.yaml` checked in.
- `move_selector.py` refactored to load profiles from YAML at runtime.
- `bot_vs_bot.py` cross-rank validation passes (rank ordering holds with adjacent-rank bots within expected handicap-equivalent gaps) on at least 9×9 and 19×19.
- `AI_CALIBRATION.md` updated with the new numbers and methodology note.
- Decision documented (in DEVJOURNAL): are we ready to swap models on Render+local, or does anything need another pass first?

After this lands, Path C (TypeScript port of `move_selector.py`) becomes a mechanical translation of known-good calibrated values, not a fresh tuning effort — and the iPad gets proper rank calibration as a side effect.
