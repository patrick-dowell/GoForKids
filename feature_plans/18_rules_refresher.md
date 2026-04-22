# 18 — Rules refresher (returning adult path)

**Status:** 📝 Planned
**Priority:** Low

## What
A short, skippable, interactive rules refresher for adults who knew Go once and are coming back. Covers capture, ko, two eyes, scoring. Not a full lesson track (that's feature 03) — a 3-minute "oh right, that's how that works" tour.

## Why
- The design doc calls this out as the one minimal-v1 onboarding piece.
- Adults who learned Go decades ago and haven't played since need a quick refresh, not a 20-lesson path designed for children.
- NUX (05) needs somewhere to route the "A little" and "Yes I've played" branches if those users want a brush-up.

## Approach
1. **Four screens, not forty.**
   - **Screen 1 — Capture.** "Stones with no liberties are removed." Show a one-move example. Accept the capture.
   - **Screen 2 — Ko.** "You can't immediately recreate the previous position." Show the textbook ko example; try the illegal move, see the refusal, try again elsewhere.
   - **Screen 3 — Two eyes.** "A group with two separate eyes is alive forever." Show an eye-shape group; try to kill it (get a polite "this group is safe").
   - **Screen 4 — Scoring.** "Territory + captures + komi." Show a small finished board; count together.
2. **Skippable.** Big "Skip" button on every screen. The user is an adult — respect their time.
3. **Reuses lesson primitives.** Built on the same show/try/watch machinery as feature 03, just as a pre-canned path. If 03 isn't ready, this ships with a simpler implementation.
4. **Entry points.**
   - NUX (05) "A little" branch optionally routes here.
   - Settings → "Review the rules" link.
   - A subtle "rules refresher" card on the homepage for first-week users that auto-dismisses after use.
5. **Tone calibration.** This is adult-voiced. Not "Let's learn!" — closer to "Here's the rule, here's an example, move on."

## Scope — first cut
- Four-screen refresher, reusable lesson machinery.
- Skip available on every screen.
- Accessible from settings and NUX.

## Out of scope (first cut)
- Japanese vs Chinese scoring comparison (we're Japanese only for now).
- Detailed ko / superko rules (basic ko only).
- Handicap explanation (comes up on the new-game screen contextually if at all).
- Read-aloud / voice narration.

## Open questions
- Does this really need to be its own feature or can it be a single branch inside 03 (concept lessons)? **Leaning:** a branch inside 03, but worth documenting separately so it's scoped.
- Is four screens the right number? Too few and we skip real gotchas; too many and we lose the refresher vibe.
- Do we include ko-threat intuition or just the ko rule itself? (Refresher-scope: rule only.)

## Dependencies
- Feature 03 (concept lessons) — reuses the lesson machinery. If 03 isn't ready, this can ship with a slightly simpler implementation.
- Feature 05 (NUX) — the "A little" branch is this feature's main entry point.

## Success signals
- Adults who use it go on to play a first game (not just read the refresher and bounce).
- Completion rate > 80% for users who start it — if people bail midway, it's too long.
