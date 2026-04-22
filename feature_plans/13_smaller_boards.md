# 13 — Smaller boards (9×9 and 13×13)

**Status:** 📝 Planned
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
5. **AI calibration.** This is the non-trivial part. Bot profiles were tuned on 19×19 Fox data. On 9×9, a "15k" doesn't behave the same. Two options:
   - **Quick path:** reuse 19×19 profiles but acknowledge rank is fuzzy on small boards.
   - **Right path:** recalibrate each rank on 9×9 and 13×13 Fox data (featurecat dataset has these). Significant work but correct.
   *Leaning:* quick path for first release, flagged as "approximate rank on small boards," recalibration is follow-up work.
6. **Board-size picker.** New Game dialog needs a size selector. Persist the user's last-used size as default.
7. **Lesson/puzzle/review content.** Most teaching content is clearer on 9×9. Feature 03 (lessons) and 02 (puzzles) should probably *default* to 9×9 for beginner content.
8. **Saved games & SGF.** SGF already encodes board size via `SZ[9]`, `SZ[13]`, `SZ[19]` — verify import/export round-trip.
9. **Study mode & review.** KataGo handles all sizes; confirm analysis configs work on smaller boards.
10. **Rating.** Glicko ratings are typically tracked separately per board size (a 10k at 19×19 is not a 10k at 9×9). Either track per-size ratings or don't rank small-board games until we have more data.

## Scope — first cut
- Engine, renderer, SGF, new-game picker support for 9×9 and 13×13.
- Bot rank profiles reused from 19×19 with a "rank is approximate" disclaimer.
- No per-size rating (small-board play is casual-only in first cut).

## Out of scope (first cut)
- Recalibrated 9×9 and 13×13 bot profiles.
- Per-size rating tracking.
- Size-specific opening coaching ("on 9×9, play the center").

## Open questions
- Default board size after this ships — does the app lead with 9×9 for new users (likely yes), or stay on 19×19?
- How do handicap stones work at 9×9? Traditional placements don't map directly.
- Do we recalibrate bots per size before or after this lands? (If after, we ship with a caveat.)

## Dependencies
- None hard. Unblocks meaningful 05 (NUX), 03 (lessons), 02 (puzzles), and kid-targeted 07 (online play).

## Success signals
- New users land on 9×9 and finish a first game in under 15 minutes.
- Lesson completion rate on 9×9 > current lesson completion rate on 19×19.
- Kids request 9×9 specifically when playing.
