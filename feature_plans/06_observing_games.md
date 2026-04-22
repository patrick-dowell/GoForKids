# 06 — Observing games (OGS integration)

**Status:** 📝 Planned
**Priority:** Medium

## What
Let players watch live or recent games from OGS (Online Go Server), with our engine optionally turned on to explain what's happening: whose stones are alive/dead, who's ahead, what the big moves were.

## Why
- Kids learn a lot from watching. Explaining a pro game with our teacher lens is a unique angle.
- Extends playtime without requiring a matchmaker — good for retention between their own games.
- Differentiator: OGS itself doesn't have a kid-friendly explainer.

## Approach
1. **OGS API.** OGS has a public REST + real-time API. Explore:
   - Listing live games (filtered by rank range appropriate for our audience).
   - Game state streaming (moves, clocks, chat).
   - SGF fetch for completed games.
   Document rate limits and auth requirements.
2. **Game browser.** A "watch" tab: list of ongoing games, filter by rank and board size (push 9×9 and 13×13 up for kids). Preview shows current position thumbnail.
3. **Viewer UI.** Reuses our board renderer and replay, streaming live moves. Add a "commentary on/off" toggle.
4. **Commentary layer.** When on: every N moves (or on demand), run KataGo and surface a short banner — "Black just invaded the top right, KataGo likes White's response" — written in kid-friendly language via Claude. Throttle cost.
5. **Chat.** OGS chat should be **off by default** for a kid audience (moderation surface we don't own). Optional read-only mode for older users.
6. **Safety.** No identifying info surfaced (usernames hashed/anonymized in our UI). No linking back to OGS profiles in kid mode.

## Scope — first cut
- Browse + watch completed recent games (not live) — simpler, fewer edge cases.
- KataGo commentary on a manual "explain" button, not continuous.
- No chat.

## Out of scope (first cut)
- Live streaming with real-time move updates.
- Letting users log in with OGS accounts.
- Commentary on dan-level games (we should filter to amateur games where our teaching angle makes sense).

## Open questions
- Does OGS's API TOS permit embedding their games in a third-party app? Check before building.
- Do we cache/store OGS games in our SQLite, or always fetch fresh?
- Is "watch a stranger play" even interesting to a 9-year-old, or do we need something more structured (e.g., "watch 12k Blue beat 15k Red with commentary")?

## Dependencies
- None strictly — but the "commentary" language quality piggybacks on the AI teacher (04) prompts and concept taxonomy (03).

## Success signals
- Kids open the watch tab at least once per session and stay for > 2 minutes.
- Commentary reads as insightful, not boilerplate.
- No complaints about inappropriate chat or content.
