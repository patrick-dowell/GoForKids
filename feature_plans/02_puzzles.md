# 02 — Puzzles

**Status:** 📝 Planned
**Priority:** High

## What
A puzzle mode where players solve short problems that reinforce specific concepts: capturing races, ladders, snapbacks, two eyes, connecting, cutting, life-and-death, endgame counting. Each puzzle has a known solution; the user places stones and gets immediate feedback.

## Why
- Puzzles are the fastest reinforcement loop in any skill game (tsumego is canonical in Go).
- They let a kid *apply* the concept we just taught in a lesson (tight coupling with concept lessons — feature 03).
- They give us a progress surface: "you solved 20 capture puzzles this week" is a parent-visible win.

## Approach
1. **Define the concept taxonomy** (shared with feature 03). Each puzzle is tagged with one or more concepts: `capture`, `ladder`, `snapback`, `atari`, `two-eyes`, `connect`, `cut`, `life-death`, `endgame`, etc.
2. **Puzzle data model.** SGF-like position + correct move sequence(s) + failure branches + concept tags + difficulty + hint text.
3. **Authoring pipeline.** Two sources:
   - Hand-authored puzzles (JSON files committed to repo) for the teaching spine.
   - Generated from real games: detect positions where the right move is forced and clear (KataGo win-rate delta > threshold).
4. **Puzzle player UI.** Reuses `GoBoard.tsx`. Shows the problem, accepts a move, compares to solution, branches correctly; shows hint on request; shows "why" after solve (short narrative, optionally Claude-generated).
5. **Progress tracking.** Per-concept mastery (e.g., "8/10 ladder puzzles solved"). Persists to localStorage for v1, SQLite when profiles exist.
6. **Puzzle picker.** Grouped by concept, with difficulty indicator. "Daily puzzle" slot on the homepage.

## Scope — first cut
- 30–50 hand-authored puzzles across 5 core concepts (atari, capture, ladder, two eyes, connect/cut).
- Single-move solutions plus 2–3 step sequences.
- Basic success/fail feedback; hint system; solve counter.

## Out of scope (first cut)
- Generated puzzles from real games.
- Timed puzzles, leaderboards.
- Multi-variation tsumego with many correct lines.
- Claude narrative per puzzle (nice-to-have, pull forward if cheap).

## Open questions
- Where do puzzles live in navigation — own tab, or inside a "Learn" hub with lessons?
- Should the kid enter *all* stones (show empty board) or just the next move from a given position? (Start with "next move from given position".)
- How do we get authoring leverage — is there an open dataset of tagged tsumego we can import?

## Dependencies
- Feature 03 (concept lessons) — share the concept taxonomy so puzzles reinforce specific lessons.

## Success signals
- A player can pick a concept, solve 10+ puzzles, and see their progress.
- Kids return for the daily puzzle.
- Puzzle solve-rate correlates with bot-ladder progression.
