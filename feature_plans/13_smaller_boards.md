# 13 — Smaller boards (9×9 and 13×13)

**Status:** ✅ Done (first cut)
**Priority:** High

## What
Add 9×9 and 13×13 as first-class board sizes alongside 19×19. These are the canonical smaller sizes in Go and the natural entry points for kids and new players. A 9×9 game takes 10 minutes; a 19×19 game takes 30+.

## Why
- The design doc is explicit: 9×9 and 13×13 pair with kid onboarding to form "the kid ramp." 19×19 is overwhelming for a 7-year-old's first contact with the game.
- Every learning feature — NUX (05), lessons (03), puzzles (02), AI review (04) — works better on smaller boards for beginners. A 9×9 game is short enough to review in one sitting.
- Shorter games = more completed games = tighter feedback loop for teaching and for our data on the player's ability.
- Online play (07) is far more viable on 9×9 — quicker matches, less commitment, lower barrier to a kid's first human game.

## Approach
1. **Engine support.** The Go rules engine in `frontend/src/engine/` and its Python mirror should already be parametric on board size — confirm and fix if not. Superko, territory scoring, SGF round-trip all need test coverage at 9 and 13.
2. **Star points.** Different hoshi patterns per board size (9×9 is 5-point, 13×13 is 5-point at specific intersections, 19×19 is 9-point).
3. **Komi adjustment.** Standard komi differs by board size (7 for 9×9 and 13×13 at Japanese rules, 6.5 for 19×19 Japanese). Handicap logic also needs per-size rethinking — smaller boards have fewer meaningful handicap stone positions.
4. **Renderer.** `GoBoard.tsx` should parametrize grid dimension. Audit any hard-coded 19s. Touch-target math changes on smaller boards (stones are physically bigger for the same canvas size, or canvas is smaller — decide).
5. **AI calibration.** Bot profiles were tuned on 19×19 Fox data. On 9×9, a "15k" doesn't behave the same — smaller board shrinks the search space (same visits = effectively stronger) and shortens the game (mistakes punish harder). Scope is tractable because we only need **3 tiers per size**:
   - **Beginner** → reuse `30k` (Seedling). Playtested: absolute beginner kid can barely beat it at 9 stones. Good difficulty floor.
   - **Intermediate** → reuse `15k` (Pebble).
   - **Advanced** → reuse `6k` (Ember). Our 6k profile actually plays closer to 5k, so it's a stronger "top bot" on small boards than the label suggests — fine for now.

   Profile data structure shifts from `RANK_PROFILES[rank]` to nested `RANK_PROFILES[size][rank]`, with 19×19 as the default fallback so existing callers don't break. Re-tune `visits`, `opening_moves`, `local_bias`, and `max_point_loss` per (size, rank). Six new profiles total: (9, 30k), (9, 15k), (9, 6k), (13, 30k), (13, 15k), (13, 6k). Use existing `bot_vs_bot.py` harness — pass size through and re-run the calibration loop.
6. **Board-size picker.** New Game dialog needs a size selector. Persist the user's last-used size as default.
7. **Lesson/puzzle/review content.** Most teaching content is clearer on 9×9. Feature 03 (lessons) and 02 (puzzles) should probably *default* to 9×9 for beginner content.
8. **Saved games & SGF.** SGF already encodes board size via `SZ[9]`, `SZ[13]`, `SZ[19]` — verify import/export round-trip.
9. **Study mode & review.** KataGo handles all sizes; confirm analysis configs work on smaller boards.
10. **Rating.** Glicko ratings are typically tracked separately per board size (a 10k at 19×19 is not a 10k at 9×9). Either track per-size ratings or don't rank small-board games until we have more data.

## Scope — first cut
- Engine, renderer, SGF, new-game picker support for 9×9 and 13×13. ✅
- Per-size handicap with hoshi-pattern positions (9×9 capped at 5, 13×13 at 9). ✅
- First-pass bot calibration for 30k / 15k / 6k on each small size, marked as needing playtest. ✅
- No per-size rating (small-board play is casual-only in first cut).

## Out of scope (first cut)
- Formal `bot_vs_bot.py` calibration loop for 9×9 / 13×13 profiles (we shipped guesses, iterating via play feedback).
- Per-size rating tracking.
- Size-specific opening coaching ("on 9×9, play the center").

## Open questions
- Default board size after this ships — does the app lead with 9×9 for new users (likely yes), or stay on 19×19?

## Resolved
- **Engine refactor** — `Board(size)` (TS + Py) and size-aware `Point` helpers. SGF round-trip parses `SZ[n]`. Frontend tests cover 9 and 13 (10 new in `SmallBoards.test.ts`).
- **Renderer** — `GoBoard.tsx` reads `boardSize` from the store and computes geometry per render. Per-size hoshi tables (9×9: 5 points, 13×13: 5 points, 19×19: 9 points). Coord labels and bounds checks parametric.
- **Picker + persistence** — board size selector in New Game dialog; last-used size stored in localStorage. Ranks not tuned for the chosen size are greyed out and labeled "9×9 not tuned" / "13×13 not tuned"; selected rank auto-snaps to a valid tier when size changes.
- **Handicap on 9×9 and 13×13** — hoshi-only on 9×9 (max 5), full 9-stone pattern on 13×13.
- **Bot profile structure** — `RANK_PROFILES_BY_SIZE[size][rank]` with 19×19 fallback for any rank without a size-specific override. New profile knobs: `pass_threshold`, `clarity_prior`, `clarity_score_gap`, `local_bias_in_opening`. 19×19 behavior unchanged via defaults.
- **Pass detection** — visits-gated. Pass candidates with too few search visits are ignored (their score estimate is just the value-network prior, not search-refined). Fixed mid-fuseki spurious passes on small boards. `pass_threshold` lowered to 0.10–0.15 on small boards to compensate for shallower search.
- **30k reactive play** — local-bias anchor is now the opponent's last move (threaded from `state.py`). 9×9/13×13 30k profiles use very high `local_bias` (0.80–0.85) and `local_bias_in_opening: True` so the bot mostly plays adjacent to whatever the player just played, like an absolute beginner. Clarity gate disabled on 30k so mistake injection actually applies in tactical positions.
- **Bug fixes shipped alongside:** dead-stone overlay carrying over into a new game (`gameStore.newGame` now resets `deadStones`); replay mode silent (`replayStore.nextMove` and the autoplay tick now play place/capture/pass sounds on forward steps).

## Dependencies
- None hard. Unblocks meaningful 05 (NUX), 03 (lessons), 02 (puzzles), and kid-targeted 07 (online play).

## Success signals
- New users land on 9×9 and finish a first game in under 15 minutes.
- Lesson completion rate on 9×9 > current lesson completion rate on 19×19.
- Kids request 9×9 specifically when playing.
