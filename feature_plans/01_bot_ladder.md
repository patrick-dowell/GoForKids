# 01 — Bot ladder completion (12k → 1 dan)

**Status:** 🚧 In progress — 12k validated 2026-04-22
**Priority:** High

## Progress
- **30k Seedling, 18k Sprout, 15k Pebble** — validated (session 1).
- **12k Stream** — validated 2026-04-22 (v4 profile): 75% even-game win vs 15k, 62% at H3, 43% same-area match rate vs real 12k Fox games. Slight over-performance at handicap (should be ~50%, is 62%) — documented, not blocking.
- **9k Boulder** — validated 2026-04-23 at inherited parameters (no tuning): 81% even vs 12k (13/16), 50% at H3 (4/8) — textbook handicap balance. Match rate 20% exact / 47% same-area / 29% opening exact vs real 9k Fox games.
- **6k Ember, 3k Storm, 1d Void** — still interpolated only; no validation yet. Marked "coming soon" (greyed out + disabled) in the bot picker.

## Rank ladder (current labels)
30k Seedling · 18k Sprout · 15k Pebble · 12k Stream · 9k Boulder · 6k Ember · 3k Storm · 1d Void

Relabeled 2026-04-23 from the old 30k/18k/15k/12k/10k/8k/5k/3k progression to a uniform 3-rank step. Profiles for the four renamed bots (Boulder, Ember, Storm, Void) still hold their old parameters pending recalibration at the new labels.



## What
Today there are 8 bot ranks from 30k to 3k, but only three of them (15k, 18k, and one other) are fully calibrated against real data. We need to finish calibrating the remaining bots and extend the ladder upward through 12k, 10k, 8k, 5k, 3k, 1k, and 1 dan so players have a full progression.

## Why
- Without a full ladder, stronger kids (and adults) hit a ceiling and lose interest.
- The stated v1 goal is 30k–1d; we haven't hit it yet.
- Each bot is a rung of a reward loop — beating one, then facing the next, is the core progression.

## Approach
1. **Audit existing bots.** For each rank already defined in `backend/app/ai/move_selector.py`, confirm it's been validated against Fox data (see `AI_CALIBRATION.md`). List gaps.
2. **Download Fox data for missing ranks.** Use the same pipeline as 15k/18k (featurecat/go-dataset) for 12k, 10k, 8k, 5k, 3k, 1k, 1d.
3. **Analyze per-rank patterns.** Run `data/analyze_15k.py` (generalized) to extract move distribution, edge distance, local response patterns.
4. **Tune profile per rank.** Adjust the 10 knobs in `move_selector.py` for each rank. Respect existing invariants: no first-line injection, eye-fill prevention, sensible openings.
5. **Validate each rank.** Use `data/test_bot_vs_real.py` (match-rate vs Fox games) and `data/bot_vs_bot.py` (neighbor rank should beat the one below ~70–85%).
6. **Wire into UI.** Extend the bot roster on the homepage and new-game dialog with cosmic-themed avatars for the new ranks.
7. **Document calibration.** Append each new rank's tuning story to `AI_CALIBRATION.md`.

## Scope — first cut
- Just the ranks currently missing from 12k up to 1d.
- Keep the Phase 1 heuristic approach; no neural network yet (that's V2).

## Out of scope
- Phase 2 rank-conditioned NN (V2 roadmap).
- Bots above 1 dan.
- Bot personalities beyond rank (territorial vs influence vs aggressive) — that's its own feature.

## Open questions
- Do we want themed avatars beyond the cosmic set, or continue the progression (Void → ??? → Singularity)?
- Should the 1-dan bot use higher KataGo visit counts to feel noticeably sharper?
- How much Fox data do we need per rank to tune reliably? (We had 154k at 15k, 299k at 18k — may be overkill.)

## Dependencies
None.

## Success signals
- A user can ladder from 30k through 1d without hitting a missing/broken bot.
- Each rank beats the one immediately below ~70–85% of the time in bot-vs-bot.
- Match rate vs real Fox games at each rank is ≥ 20%.
