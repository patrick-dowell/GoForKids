# Bot rank profiles

YAML profile files loaded by `backend/app/ai/profile_loader.py` at runtime via the env var `CALIBRATION_PROFILE_PATH` (default: `b20.yaml`).

## Files

- **`b20.yaml`** — Production calibration for the b20 KataGo network. The current source of truth for everything running on Render and on `make native-backend`. Tuning rationale per profile lives in `AI_CALIBRATION.md`.
- **`b28.yaml`** — Production-active calibration for the b28c512nbt network (locked 2026-05-04). See per-profile inline comments for iteration history; see `AI_CALIBRATION.md` "b28 calibration outcome" section for the rate/margin summary table and key learnings. The production Dockerfile defaults to this file.

During a future network swap, the WIP file would be `<network>_candidate.yaml`, edited via `data/calibrate_b28.py` against the previous network's YAML, then renamed to `<network>.yaml` once every profile is locked.

## Schema

```yaml
profiles:
  19x19:           # Board size key — supported: 5x5, 9x9, 13x13, 19x19
    "30k":         # Rank key — string, can be any KYU/DAN identifier
      visits: 10
      max_point_loss: 30.0
      mistake_freq: 0.55
      policy_weight: 0.15
      randomness: 0.78
      random_move_chance: 0.08
      local_bias: 0.42
      first_line_chance: 0.0
      min_candidates: 15
      opening_moves: 8
      # Optional knobs (omitted = use the move_selector default):
      # pass_threshold: 0.3
      # clarity_prior: 0.5
      # clarity_score_gap: 5.0
      # local_bias_in_opening: false
```

`profile_loader.py` validates that every required knob is present and typed correctly; unknown knobs log a warning.

## Lookup semantics

`get_profile(rank, size)` resolves in this order:
1. `(size, rank)` — explicit per-size override.
2. `(19, rank)` — fall back to the 19x19 profile of the same rank.
3. `(19, "15k")` — last-resort fallback.

This matches the previous Python behavior in `RANK_PROFILES_BY_SIZE`.

## Gotcha — git-LFS materialization

`backend/models/b20.bin.gz` and `b28.bin.gz` are tracked via git-LFS (see `.gitattributes`). After a fresh clone, a `git pull`, or in some cases just leaving the working tree alone overnight, the working-copy files can revert to ~134-byte LFS pointer files instead of the real ~80–270 MB networks. KataGo can't load a pointer; before this was hardened, the backend would silently fall back to a "random legal move" stub AI and every calibration result became a measurement of `b20-vs-random`, not `b20-vs-b28`.

Three defenses now in place:

1. **`make calibrate-up*` checks each model file is > 1 MB** before launching backends, with a "run `git lfs pull`" hint on failure.
2. **Backends launch with `STRICT_KATAGO=1`** (see `app/katago/engine.py`): in strict mode, missing/broken model files (and any KataGo start failure) raise an exception instead of silently falling back to stub AI. Out of strict mode (production), the original graceful-fallback behavior is preserved.
3. **`make calibrate-up*` runs a real `/ai-move` smoke on each backend** post-startup and verifies `score_lead` is non-null. Stub AI returns `score_lead=null`; the smoke fails fast if either backend is degraded.

If you ever see a calibration result with avg margin > ~20 pts and a wildly out-of-band rate (e.g. <15% or >85%), that's the signature of one side running stub AI — check `data/calibration_logs_b28/backend-{old,new}.log` for "KataGo failed" or "Using stub AI".

## Editing for calibration

The calibration loop (per `feature_plans/20_b28_calibration.md`) is:

1. Bring up the paired backends: `make calibrate-up`.
2. Pick an `(rank, board_size)` profile.
3. Run a triage match: `make calibrate RANK=15k BOARD=9 GAMES=30`.
4. Look at the win rate. New bot too weak (<45%) → increase its strength: bump `visits`, drop `mistake_freq`, raise `policy_weight`, etc. Too strong (>55%) → opposite.
5. Edit the candidate YAML (during the b28 calibration this was `b28_candidate.yaml`; after lock it's `b28.yaml`). The backend caches the loaded profile, so a clean reload requires restarting the backend: `make calibrate-down && make calibrate-up`.
6. Re-run triage. Repeat until it's in 45-55%.
7. Run a confirmation match: `make calibrate RANK=15k BOARD=9 GAMES=100`. Must hold 45-55%.
8. Move on to the next profile.

Smaller boards converge fastest; the plan's recommended order is:

| Board | Ranks                          | Why                                |
|-------|--------------------------------|------------------------------------|
| 5×5   | 30k                            | first-game profile                 |
| 9×9   | 30k, 15k, 6k                   | quick iteration, informs 13×13/19  |
| 13×13 | 30k, 15k, 6k                   | mid-cost; cross-checks 9×9 numbers |
| 19×19 | 30k, 18k, 15k, 12k, 9k, 6k     | most expensive, do last            |
