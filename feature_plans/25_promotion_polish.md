# 25 — Ranked promotion polish

**Status: shipped (Session 23, 2026-06-11).** Design settled with Patrick
2026-06-11; supersedes the 2026-06-05 sketch (which had a loss-streak reset).

## Problem (playtest feedback, 2026-06-05)

Promotion felt too generous: 3 wins regardless of losses, especially at higher
ranks. Promotions should feel earned — but beginners should never feel
punished.

## Design

| Rank band | Wins to promote | Loss effect |
| --- | --- | --- |
| 30k–13k | 3 | none (kid-first) |
| 12k–6k | 4 | −1 win progress (floor 0) |
| 5k–1d | 5 | −1 win progress (floor 0) |

- The rung itself is **never** lost to game results — no auto-demotion, ever
  (kid-first policy, unchanged).
- Marker ranks `FOUR_WIN_FROM = '12k'` and `FIVE_WIN_FROM = '5k'` resolve
  per-ladder by rung index; a ladder without a marker rank (e.g. a future
  13×13 ladder) simply never enters that tier.
- The anti-frustration safeguard (5-loss streak → easier matchup along the
  rung's own axis) is unchanged and independent of the setback rule.
- **Voluntary derank**: Profile rank card, "Too tough? Move down a rank…",
  two-tap inline confirm (WKWebView-safe). One rung down, counters cleared,
  shadow rating untouched.
- Transparency: the auto-play game-end modal notes the setback rule on losses
  inside the tier, so the shrinking progress bar is always explained.

## Rejected alternatives

- **Loss-streak resets progress to 0** (the 2026-06-05 sketch) — superseded:
  per-loss −1 is more legible and the cost lands immediately instead of as a
  cliff.
- **Auto-demotion** — rejected outright (kid-first).
- **Two-tier 3→5** — Patrick preferred the graduated 3/4/5.

## Notes

- The Profile rank graph replays history through `applyResult`, so games
  recorded under the old flat-3 rules replay slightly differently — cosmetic
  only; the graph was already approximate (setRung / reset / derank are not in
  history).
- While wiring, fixed a latent board-blindness bug in `AutoPlayGameEndModal`
  (`nextRung` without `boardSize` — wrong promote-to copy on 9×9, hard throw
  at rung 28k).
