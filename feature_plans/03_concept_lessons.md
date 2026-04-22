# 03 — Concept lessons

**Status:** 📝 Planned
**Priority:** High

## What
An interactive, guided walkthrough of core Go concepts. Not a wall of text — a sequence of small steps: see a position, read one short explanation, try the move, get feedback, move on. Each lesson targets one concept and ends with a small puzzle set.

## Why
- Kids learn by doing, not reading. A well-paced "show one thing, do one thing" loop beats any tutorial page.
- Without a concept ladder, the game is opaque: players don't know *what* they're supposed to be learning.
- Lessons funnel directly into puzzles (02) and the bot ladder (01) — they're the "why" before the "do".

## Approach
1. **Define the concept ladder** (shared with 02):
   - Stones and liberties → Capture → Atari → Ladder → Net → Snapback → Two eyes → Life and death → Connect/cut → Influence vs territory → Endgame counting → Opening principles → Sente/gote.
2. **Lesson format.** Each lesson is a sequence of steps; each step is one of:
   - **Show** — a static position with annotation.
   - **Try** — the player makes a move; the lesson validates and responds.
   - **Watch** — a scripted sequence of moves plays out with narration.
   - **Quiz** — a mini-puzzle; can't advance until solved.
   Backed by a tiny scripting format (JSON/YAML).
3. **Lesson player UI.** Board on the left, annotation panel on the right, "next step" button. Reuses `GoBoard.tsx` with overlay primitives (arrows, circles, labels) for teaching.
4. **Board overlay primitives** — we'll need arrows, highlight circles, labels, "play here" hints. Build these once, reuse across lessons and the AI teacher (04).
5. **Progress tracking.** Lessons are a linear path with branch unlocks. Completing a lesson unlocks the next + its puzzle set.
6. **Authoring.** Lessons live as JSON/YAML in the repo so they're version-controlled and easy to iterate. A short authoring guide in the doc makes it possible for a non-engineer to write new lessons.

## Scope — first cut
- 6 lessons covering: Stones & Liberties, Capture, Atari & Running, Ladder vs Net, Two Eyes, Territory Basics.
- Board overlay primitives: arrow, circle, label, "play here" ghost stone.
- Simple linear progression; no branching trees yet.

## Out of scope (first cut)
- Branching lesson trees.
- Voice narration.
- Authoring UI (author in JSON/YAML for now).
- Parent-facing lesson progress dashboard.

## Open questions
- Do lessons use the 19x19 board or a smaller teaching board (9x9, or a clipped region)? **Leaning:** use a local window of the board — the lesson says "consider this corner" and only draws that region.
- How much reading vs. doing? Target is < 2 sentences per "show" step.
- Should the AI (Claude) author lesson text dynamically, or is everything pre-written? **Leaning:** pre-written for consistency and safety.

## Dependencies
- None hard. Feeds 02 (puzzles share concept tags) and 05 (NUX sends first-time users into lesson 1).

## Success signals
- A first-time user can complete the first 3 lessons without getting stuck.
- Lesson completion rate from first to sixth lesson > 40%.
- Kids who finish the lesson track graduate to playing 15k with a better-than-random record.
