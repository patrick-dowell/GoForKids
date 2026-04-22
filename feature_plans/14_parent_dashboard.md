# 14 — Parent-facing dashboard

**Status:** 📝 Planned
**Priority:** High

## What
A dedicated "for grown-ups" surface that shows what the kid is learning: rank progress over time, concepts mastered, puzzles solved, games played, time spent. Not a surveillance tool — a "proof of learning" view a kid can show a parent, and a reassurance surface for the parent deciding whether to keep the app installed.

## Why
- Parents are the gatekeeper. They approve the install, they pay, they decide when to uninstall. Without a clear "here's what your kid is getting out of this" story, we lose on the purchase and retention funnel regardless of how good the kid experience is.
- Design doc is explicit: "parent-facing surface — simple 'what your kid is learning' view."
- Pairs directly with COPPA and online-play trust: a parent who sees a thoughtful dashboard trusts the product more broadly.
- Gives the kid a reward-loop moment — showing a parent the trophy shelf, the rank-up graph, the solved puzzles.

## Approach
1. **Access model.** The dashboard is read-only from the kid's perspective. In v1 of this feature, access is a "for grown-ups" button on the homepage that opens the view — no auth gate. In a later version (tied to online play, feature 07), it's gated by a parent account / PIN.
2. **Data to surface.**
   - **Rank over time** — Glicko rating chart, weekly granularity. Shows improvement.
   - **Concepts mastered** — check list tied to the taxonomy from features 02/03. "Knows capture. Learning ladders. Hasn't seen seki yet."
   - **Games played** — count, average length, result split. Time-of-day histogram for parents curious about screen time.
   - **Puzzles solved** — count by concept, recent streaks.
   - **Lessons completed** — checklist.
   - **Time played** — daily, weekly; weekly average. Parents care about this.
   - **Recent highlights** — "solved first ladder puzzle Tuesday," "beat 20k bot for the first time Thursday."
3. **Language.** Written for a parent, not a Go player. No jargon. "Your kid is getting better at spotting captures" not "their tactical recognition has improved."
4. **Layout.** One page, scannable in 60 seconds. Charts, not tables. No dense stats.
5. **Print / share.** A "print-friendly" or "share as image" action for fridge/teachers/grandparents. This is a surprisingly high-value feature — it closes the loop on the kid's sense of accomplishment.
6. **Privacy posture.** All data is local in v1. Clear "this stays on your device" note. No third-party analytics hook reads it.
7. **COPPA tie-in.** If a parent email is on file (from beta gating or online play), the dashboard can optionally email a weekly summary. Default off.

## Scope — first cut
- Local-data dashboard: rank chart, games played, puzzles solved, lessons completed, time played.
- "For grown-ups" button on homepage — no auth.
- No email digests.
- No print/share yet.

## Out of scope (first cut)
- Parent account / PIN.
- Weekly email summaries.
- Multi-kid households.
- Parent-configurable screen time limits.
- Classroom / teacher mode.

## Open questions
- Is concept-mastery inferred (from puzzle solve rates, from review patterns), or explicit (the lesson marks you complete)? **Leaning:** explicit from lessons, supplemented by inferred from puzzles.
- Do we show the parent the kid's losses? (Yes — losses are learning. Frame as "games played," not "wins vs losses.")
- When does the dashboard become an entry point of its own vs a side door off the kid's homepage?

## Dependencies
- Feature 01 (full bot ladder) — rank progression only means something with a real ladder.
- Feature 02 (puzzles) and 03 (lessons) — most of the "learning" surfaces are these.
- Feature 15 (rewards cluster) — trophy shelf and milestones should surface here too.

## Success signals
- Parents cite the dashboard as a reason to keep the app installed.
- "Shared with family member" events happen (print, screenshot, etc.).
- Kids pull up the dashboard themselves to show someone.
