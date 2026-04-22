# 05 — New-user experience (NUX)

**Status:** 📝 Planned
**Priority:** High

## What
The first 5 minutes of the app for someone who has never played Go. Today the homepage assumes you know what Go is and what rank to pick. NUX is a guided opening: ask who you are, teach the absolute basics, get you into a first game you can actually win.

## Why
- We have no answer to "I've never played Go before, help me." Every kid in our target audience is this user.
- Bounce rate on first open will be very high without this.
- NUX is the glue that makes lessons (03), puzzles (02), and the bot ladder (01) feel connected.

## Approach
1. **First-open detection.** If no profile in localStorage, land on the NUX flow instead of the homepage.
2. **NUX flow (draft):**
   - Step 1 — "Have you played Go before?" (Never / A little / Yes)
   - Step 2a (Never) — pick an avatar + name, then drop into Lesson 1 (stones & liberties).
   - Step 2b (A little) — short diagnostic: "solve this capture puzzle" × 3. Route to a lesson or skip.
   - Step 2c (Yes) — prompt for a starting rank and go straight to the bot select screen.
3. **First-game shepherd.** After the first lessons, the "first game" against the 30k bot should have on-board coaching: subtle highlights on legal captures, a "good move!" confirmation when they play something reasonable. Coaching fades with each subsequent game.
4. **Homepage, post-NUX.** Once you've completed NUX, homepage shows: next lesson, daily puzzle, play-vs-bot, library. NUX is not re-entered unless the user resets.
5. **Parent/guardian touch.** Optional one-screen "for grown-ups" card with a link to the about page, rough screen time, and an email field (for beta — ties to feature 09).

## Scope — first cut
- First-open detection + the 3-branch flow.
- Route "Never" straight into Lesson 1 (depends on 03 existing; if 03 isn't ready, fall back to a stripped "here's the board, here's how to capture" 60-second screen).
- First-game coaching overlays: just "legal moves are OK" and capture highlights. Minimal.

## Out of scope (first cut)
- Voice narration / read-aloud for pre-readers.
- Multi-profile on one device (the "sibling" case).
- Parent-controlled content gating.

## Open questions
- Age check on first open? We're targeting 7–12 but won't enforce it; COPPA implications for online play (07) are separate.
- Should the diagnostic puzzles set starting rank, or do we always start people at 30k? **Leaning:** diagnostic can jump them up the ladder.
- Do we let users skip NUX entirely? (Yes — a skip button on step 1, hidden-ish.)

## Dependencies
- Feature 03 (lessons) — ideally the "Never" branch routes into a real lesson. If 03 is late, ship NUX with a minimal inline tutorial.
- Feature 01 (bots) — the ladder needs to be populated for the "Yes, I've played" path to feel worthwhile.

## Success signals
- First-open → first-move-played rate > 80%.
- First-open → 3-games-played rate > 40%.
- Kids who hit NUX can play a 9x9 game against 30k without an adult explaining things.
