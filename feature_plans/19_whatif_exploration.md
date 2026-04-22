# 19 — What-if exploration (interactive review)

**Status:** 📝 Planned
**Priority:** Medium

## What
In game review, let the player click any past move, place a *different* stone, and see KataGo's evaluation update live. "What if I played here instead?" A branch, not a commitment — and you can keep branching. Already on the v1 TODO list.

## Why
- Design doc calls this out as part of study mode: "let the player click any move, place a different stone, and see KataGo's evaluation update."
- This is where the AI teacher (04) graduates from "here's what was wrong" to "find the right move yourself." Teaches by letting the player *discover* the alternative.
- Massive leverage for feature 04 — reviews with exploration are far more educational than reviews that just narrate.

## Approach
1. **Review mode entry.** Already have replay — extend with an "explore from here" toggle on any move.
2. **Branching UI.** Once in explore mode, every move the player makes starts a branch off the main line. Main line stays visible (ghosted); branch is active. Back button unwinds the branch.
3. **Live KataGo eval.** Each move in the branch triggers a KataGo analysis call. Surface: win-rate, score lead, top alternative (as a ghost stone). Target latency < 2s with GPU backend.
4. **Bot plays a response.** When the player branches, have the AI (calibrated to the original opponent's rank, or KataGo at high visits) play a response so the branch feels like a real continuation, not a one-move experiment.
5. **Branch library.** Interesting branches can be saved ("I found a line where Black comes out ahead"). Shows on the game's review entry next time.
6. **Variation tree.** If the player explores multiple branches from the same move, show a small tree (like SGF variations) so they can compare. Kid-friendly visual — not a full Kifu-style node tree.
7. **Limits.** Cap branch depth (e.g., 10 moves) in v1 — after that, it's a new game, not an exploration.
8. **Cost.** Each branch step costs a KataGo call. Rate-limit per session; make sure the ambient cost of review sessions doesn't blow up the budget.

## Scope — first cut
- Toggle to branch from any move in review.
- KataGo eval updates live for each branch step.
- Bot responds at reasonable rank.
- Back button to unwind.
- Cap branch depth at 10.

## Out of scope (first cut)
- Saving branches to disk.
- Variation tree visualization.
- Multi-branch comparison.
- Sharing a branch with someone else.

## Open questions
- Who plays the opponent's side in the branch — KataGo at full strength (shows you the *best* response) or at original rank (shows a *realistic* response)? **Leaning:** realistic by default, with a "show me the best response" toggle.
- How do we visually distinguish main line from branch? Ghost stones, different color, labeled?
- What's the right KataGo visit count for branch analysis — same as main review, or lower for speed?

## Dependencies
- Feature 04 (AI teacher review) — this extends that surface.
- GPU-backed KataGo (v1 infra decision) — CPU latency kills the feel.

## Success signals
- Players who explore retain more from a review than players who only watch.
- Time spent in review mode goes up when this ships.
- Branches get created for > 50% of review sessions.
