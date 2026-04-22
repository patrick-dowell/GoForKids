# 17 — Rank / progress UI widget

**Status:** 📝 Planned
**Priority:** Medium

## What
Surface the Glicko-2 rating system — which is already built but invisible. A rank widget on the homepage showing current rank, a small chart of recent progress, and an indication of "one step above" (the next bot to beat) and "one step below" (where you came from).

## Why
- The rating system exists and works; not showing it is leaving a core loop on the floor.
- Rank is the most concrete "am I getting better?" signal a Go player has. Kids who can see their rank climb are kids who keep playing.
- Wires into many other features — the bot ladder (01) becomes meaningful when you can see yourself climbing it; the parent dashboard (14) leads with rank progress; the NUX (05) diagnostic sets the starting rank.

## Approach
1. **Rank widget on homepage.** Cosmic-themed badge showing current rank (e.g., "12k Explorer"). Clicking expands to a chart of rank over time.
2. **Rank-up celebration.** When the Glicko rating crosses a rank threshold, a clear celebration moment — animation + sound + sticker (ties to rewards 15). Rank-downs are silent; no need to rub it in.
3. **"Next challenger" on homepage.** Shows the bot one rank above the player with a "play" button. Closes the loop — you see your rank, you see who's next, one click to try.
4. **Ranked vs casual.** Only ranked games move the rating. Today both modes exist; make the distinction visually clear on the new-game flow.
5. **Chart.** Rank over time with the rank-up moments flagged. Weekly granularity initially; zoomable.
6. **Starting rank.** NUX diagnostic (feature 05) or self-report sets the initial rating. No rating before the first ranked game.
7. **Rating math guardrails.** Glicko parameters should be set so a beginner's rating converges reasonably fast (15–20 games) but isn't whiplashed by a single fluke win. Audit the existing parameters.
8. **Per-board-size ratings.** Once smaller boards (13) ship, rating is separate per size. Initially this widget shows 19×19 rating only and labels it as such.

## Scope — first cut
- Homepage widget with current rank + "next challenger" button.
- Rank-over-time chart on click.
- Rank-up celebration animation and sticker.
- Clear ranked vs casual distinction in new-game UI.

## Out of scope (first cut)
- Per-board-size ratings.
- Rating floor / protection mechanics.
- Rating confidence interval display (too technical for kids).
- Projected rank timeline ("you'll hit 10k in ~12 games").

## Open questions
- How do we display rank progress to a brand-new player who has no history? (Show "unranked" with a small "play 5 ranked games to get your rank" prompt.)
- Should the rank name be kyu/dan terminology or kid-friendly terms (Explorer, Voyager, etc.)? **Leaning:** both, with the traditional term in small text.
- Do we celebrate *every* rank step (20k → 19k → 18k) or only round steps (20k → 15k → 10k)? Every step is more celebration but risks inflation.

## Dependencies
- Feature 01 (bot ladder) — "next challenger" only works with a full ladder.
- Feature 13 (smaller boards) — if per-size ratings land, this widget needs size-aware UI.
- Feature 15 (rewards loop) — rank-up sticker is a milestone.

## Success signals
- Players check their rank widget between games.
- Rank-ups are shared or screenshotted.
- Ranked-game completion rate increases after this ships (people playing ranked for the rating movement, not just casual).
