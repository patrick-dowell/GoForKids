# 15 — Rewards loop (milestones, cosmetics, streaks, trophy shelf)

**Status:** 📝 Planned
**Priority:** High

## What
The intrinsic reward loop called out in the design doc: milestone stickers ("First Capture!", "First Win!", "10 Games Played!"), unlockable cosmetics (board styles, stone styles, sound packs, avatars), a gentle daily play streak, and a trophy shelf the kid can show parents. No currency, no IAP, no FOMO.

## Why
- Design pillar: "Every stone feels good" extends to "every accomplishment is noticed."
- Design doc is explicit about stickers, unlockables, streaks, trophy shelf — and equally explicit about *no* monetized reward mechanics. This feature is the positive version of that.
- For kids this is the heartbeat of retention. The bot ladder tells you where you are; milestones tell you how far you've come.
- Parents love showing off a kid's accomplishments. The trophy shelf is an extension of the parent dashboard (14) with the kid as narrator.

## Approach
1. **Milestone catalog.** Define the full list upfront so progression feels intentional, not ad hoc. Categories:
   - **First-time events:** first move, first capture, first win vs 30k, first ladder, first seki, first two-eye life, first comeback, first resignation.
   - **Count events:** 10/50/100 games played, 10/50/100 puzzles solved, 1/5/10 wins at each rank, 7-day streak.
   - **Skill events:** solve a life-and-death puzzle, win without any captures, win with ≥10 captures, reach each rank step.
2. **Detection.** Most milestones fire from existing events (capture, game-end, puzzle-solve). A few need new detection (comeback = losing by 20+ then winning; ladder detection from feature 12's tactical detector).
3. **Sticker presentation.** When a milestone fires mid-game, a small celebration — animation + sound, 2 seconds max. After the game, a "you earned this today" summary.
4. **Trophy shelf.** A dedicated route where all earned milestones live. Earned ones are colored and named; locked ones are silhouetted with a "???" tease (but not exact unlock conditions — discovery is part of the fun).
5. **Unlockable cosmetics.**
   - **Board styles** — different textures/colors (cosmic dark is default; unlock slate, starfield-subtle, classic kaya once we have it).
   - **Stone styles** — different stone finishes (gradient default; unlock matte, glossy, constellation-etched).
   - **Sound packs** — different chime families (default cosmic; unlock wooden, crystal, glass).
   - **Avatars** — tied to feature 11.
   Each cosmetic has an unlock condition. Cosmetics are swappable in settings once unlocked.
6. **Streak.** Gentle — play any one game or solve any one puzzle to keep the streak alive. Breaking it doesn't punish (no "you lost your streak!!" panic), it quietly resets. Display is a small number on the homepage. No push notifications pressuring the kid to come back.
7. **Milestone data model.** Event-driven: `MilestoneEvent(type, context, timestamp)`. Stored locally. Replayable if schema changes.
8. **Sharing.** Trophy shelf ties into the parent dashboard (14). Each milestone can be "shown to a grown-up" — a static page the kid can point to.

## Scope — first cut
- 15–20 milestones across first-time and count events.
- Mid-game celebration + end-of-game summary.
- Trophy shelf page.
- 3 unlockable board styles, 3 stone styles (no sound packs in first cut).
- Gentle streak (homepage number, no notifications).

## Out of scope (first cut)
- Sound pack cosmetics.
- Share-as-image for individual milestones.
- Seasonal/timed milestones.
- Any form of loot box, gacha, or randomness.
- Social leaderboards.

## Open questions
- How much do we tell the kid about locked milestones? Show "???" teases, or completely hide them?
- Should cosmetics be earned or gifted — do we want an initial pack available immediately so the cosmetics surface doesn't feel empty on day one?
- Streak display — literally "7 days" or something gentler like a moon phase / growing plant? (Leaning: something gentler. We're not Duolingo.)
- What happens when a kid has already played 100 games when this ships? Backfill retroactive milestones from game history, or only forward-looking?

## Dependencies
- Feature 02, 03 (puzzles, lessons) — many milestones fire from these surfaces.
- Feature 12 (animations/SFX) — celebration animations reuse that registry.
- Feature 11 (avatars) — some avatars are cosmetic unlocks.
- Feature 14 (parent dashboard) — trophy shelf integrates there.

## Success signals
- Kids check the trophy shelf voluntarily.
- A session doesn't feel "wasted" even on a loss (earned a "Brave Loss" or "10 Captures in One Game" style milestone).
- Zero complaints about FOMO mechanics from parents.
