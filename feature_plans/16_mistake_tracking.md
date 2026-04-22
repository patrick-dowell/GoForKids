# 16 — Mistake tracking across games

**Status:** 📝 Planned
**Priority:** Medium

## What
A longitudinal view of the mistakes a player keeps making. Feature 04 explains mistakes within a single game; this feature tracks them across many games and surfaces the patterns. "You've missed a capture in atari 8 of your last 10 games. Let's work on that."

## Why
- Single-game review (feature 04) is great, but the real teaching leverage is the *recurring* mistake. A good human coach notices "you keep doing this" — we can do that too.
- Converts losses into lessons, not just individual reviews. The kid sees their own trajectory.
- Creates a self-reinforcing loop with lessons (03) and puzzles (02): if the system detects you keep getting laddered, it surfaces the ladder lesson and serves ladder puzzles.
- Design doc calls this out as the "teacher can say 'you've been making this same mistake — let's work on it'" pattern.

## Approach
1. **Mistake taxonomy.** Feature 04 already classifies moves (excellent/inaccuracy/blunder) and ideally by type (atari ignored, overconcentration, bad direction, missed capture, ladder into own wall, etc.). This feature depends on that classification being structured, not just narrative.
2. **Mistake event store.** Every classified mistake from review writes a `MistakeEvent(game_id, move_number, type, magnitude, board_region, rank_at_time)` row. Local SQLite for v1.
3. **Pattern detection.** Queries over the event store:
   - **Frequency:** top N mistake types in the last 30 days / 10 games.
   - **Trend:** is this mistake type going up or down over time?
   - **Context:** does this mistake type happen mostly in the opening, midgame, or endgame?
4. **Surfacing patterns.** Three surfaces:
   - **End-of-game review banner** — "You've missed 5 captures this week. Want to try a capture puzzle set?" (only if pattern confidence is high).
   - **Dedicated "coach" tab** — a view that lives alongside the library and shows current patterns with recommended action.
   - **Parent dashboard (14)** — "Your kid has been working on X" as a quieter version of the same data.
5. **Action loop.** Every detected pattern pairs with a recommended next step: a lesson (03), a puzzle set (02), or a focused practice game (play 30k and try to only capture cleanly). One-click to start.
6. **Improvement callout.** The flip side — "you've cut your ladder mistakes in half this month" deserves a celebration. Ties to rewards cluster (15).
7. **Privacy and framing.** Mistake tracking can feel bad. Language is always forward-looking: "let's work on" not "you've been failing at." No shame, no exposure of raw counts unless the kid asks.
8. **Decay / horizon.** Old mistakes shouldn't haunt — weight recent games more heavily. A 3-month-old ladder blunder isn't a pattern.

## Scope — first cut
- Mistake event store and classification integration with feature 04.
- Top 3 pattern detection (most frequent mistake type, over last 10 games).
- End-of-game review banner with lesson/puzzle recommendation.
- Improvement callout when a tracked pattern trends down.

## Out of scope (first cut)
- Dedicated "coach" tab (can be a follow-up).
- Multi-category correlation ("you blunder in the endgame when you're ahead").
- Peer comparison ("other 15ks also struggle with this").
- Predictive ("you're about to hit this mistake — careful").

## Open questions
- How confident does a pattern need to be before we surface it? Firing on noise is worse than not firing.
- What's the minimum game count before we even attempt pattern detection? (Probably 5.)
- Does the AI teacher (04) need to be enhanced to produce structured mistake types, or is a post-hoc classifier easier?
- Should this feature ever nag — "you haven't done the recommended puzzle set" — or is it strictly opt-in?

## Dependencies
- Feature 04 (AI teacher) — needs structured per-move mistake classification.
- Feature 02 (puzzles) and 03 (lessons) — actions/recommendations target these surfaces.
- Feature 14 (parent dashboard) — quieter surface for parents.

## Success signals
- Recommended puzzles and lessons are completed at higher rates than un-recommended ones (signals the recommendation is relevant).
- Mistake frequency in a tracked category measurably decreases over a multi-week window.
- Kids don't feel the feature is judgmental — beta feedback on tone is positive.
