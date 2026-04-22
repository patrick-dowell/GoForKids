# 04 — AI Go Teacher (review mode)

**Status:** 📝 Planned
**Priority:** High

## What
After a game, the player can open it in review mode and get a move-by-move AI analysis: good moves marked "!", questionable moves "?", blunders "??", and a short natural-language explanation of what was good or what went wrong. Inspired by chess.com's review feature.

## Why
- The single most effective teaching tool in modern chess learning, adapted for Go.
- We already have KataGo for eval and the Claude API wired for narratives (per v1 memory). This feature unifies them.
- Gives every game post-play value, even losses — turning a frustrating loss into a lesson is the whole pitch.

## Approach
1. **Per-move eval pass.** For each move in the game, run KataGo analysis to get:
   - Win-rate before the move.
   - Win-rate after the move.
   - Score estimate before/after.
   - Top 3 alternative moves with their win-rates.
   The delta (win-rate drop, score drop) is the move's quality signal.
2. **Classify moves.** Thresholds map delta → symbol:
   - `!` Excellent — best or near-best (tie with top).
   - `?` Inaccuracy — moderate drop.
   - `??` Blunder — large drop.
   - No mark — fine/normal move.
   Tune thresholds by rank: a 30k doesn't need "?" on every non-optimal move.
3. **Narrative layer.** For marked moves only, generate a short Claude explanation using: board position, the move, the top alternative, win-rate delta, any detected tactical pattern (ladder, atari, cut). Cache results — regenerating on each open is expensive.
4. **Review UI.** Reuse existing replay. Add a "mistake bar" scrubber (colored dots above the timeline showing where mistakes happened). Clicking a marked move shows the explanation + the alternative as a ghost stone.
5. **Pattern detection.** Beyond win-rate, detect common teachable moments: "you got laddered", "your group lost both eyes", "you missed a capture". These get explicit callouts.
6. **Rate limiting / cost.** Analysis of a full game is expensive. Options: analyze lazily (only when user opens review), cache server-side, only run Claude narrative for top-3 moments rather than every mistake.

## Scope — first cut
- KataGo eval + classification for every move.
- Mistake bar scrubber.
- Claude narrative for the top 3 biggest moments only (blunders and brilliancies).
- Works on any saved game from the library.

## Out of scope (first cut)
- Real-time analysis during live play (that's different — potentially a "coach hint" feature).
- What-if exploration (play alternate moves and see the line) — already on the v1 TODO.
- Multi-game pattern detection ("you always blunder in the endgame") — that's a separate feature.

## Open questions
- What's the threshold for "?" at 30k vs 5k? Absolute win-rate deltas will be wildly different.
- How much KataGo compute per review? At 500 visits per move × 200 moves × many games, costs add up. Maybe 100 visits/move default, bump on demand.
- Do we surface the "?" marks during the game too, or only on review? **Leaning:** review-only for v1 to avoid hand-holding during play.

## Dependencies
- Study-mode plumbing from v1 (KataGo integration + Claude API are built).
- Feature 03 (concept tags) helps the narrative reference the right concept.

## Success signals
- Players open review on >40% of finished games.
- Review narratives feel specific, not generic ("you played the ladder into your own wall" > "this move was bad").
- Measurable rank improvement for players who review regularly.
