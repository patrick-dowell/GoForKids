# 03 — Concept lessons

**Status:** 🧪 Beta — first-cut arc shipped (11 lessons, end-to-end onboarding to a 9×9 game). Awaiting real-user playtest data before deciding on the next batch.
**Priority:** High

## What
An interactive, guided walkthrough of core Go concepts. Not a wall of text — a sequence of small steps: see a position, read one short explanation, try the move, get feedback, move on. Each lesson targets one concept and ends with a small puzzle set or a real game.

## Why
- Kids learn by doing, not reading. A well-paced "show one thing, do one thing" loop beats any tutorial page.
- Without a concept ladder, the game is opaque: players don't know *what* they're supposed to be learning.
- Lessons funnel directly into puzzles (02) and the bot ladder (01) — they're the "why" before the "do".

## Shipped (v1 — lessons 1–11)

The whole first-cut arc is live. Every lesson is one of three `kind`s, all config-driven from `frontend/src/learn/lessons.ts`:

| # | Title | Kind | Concept |
|---|-------|------|---------|
| 1 | Drop Your First Stone | puzzle (multi-turn) | placement, taking turns |
| 2 | Capture One Stone | puzzle | last-liberty capture |
| 3 | Big Capture | puzzle | groups share liberties; one stone takes the whole group |
| 4 | Save Your Team | puzzle (secondTurn + chase) | extending under pressure |
| 5 | First Battle | game (5×5 vs 30k Seedling, komi=0) | playing the first real game |
| 6 | Capture Race | puzzle (secondTurn + auto-reply) | semeai on 9×9 |
| 7 | One Eye Isn't Enough | puzzle | filling the last liberty captures a 1-eye group |
| 8 | Two Eyes = Forever Safe | puzzle (validateIllegal) | filling either eye is suicide |
| 9 | Safe or Gone? | quiz (3 mini-boards) | identify safe vs dead shapes; on "Gone" the kill move plays automatically with capture animation + sound |
| 10 | Two Eyes | puzzle-series (3 parts) | (a) make life with the vital point, (b) kill from the other side, (c) try-and-fail on a wider shape — defender adapts via a function-based response |
| 11 | Big Board Time | game (9×9 vs 30k Seedling) | graduation onto a real board |

Cross-cutting UX features that landed alongside the lessons:

- **Three lesson kinds in the engine.** `puzzle` (single board, optional `secondTurn` for two-move sequences, optional `afterSuccess` for an opponent reply); `quiz` (a list of multiple-choice questions, one mini-board each, with optional `killMove` demos); `puzzle-series` (a list of one-move sub-puzzles each with its own board / validator / success copy, with an optional `responseFor` function so the defender's reply can adapt to the user's move, plus `playoutAfter` for chained background moves and `successHighlight` for post-resolution eye-region indicators).
- **Bottom-anchored success modal.** No full-screen backdrop — the modal sits at the bottom of the viewport, board fully visible behind it. The capture animations from `killMove` / `playoutAfter` actually play out where the player can watch them.
- **Cosmic Board reward** unlocks between lesson 4 and lesson 5 — pacing payoff for finishing the first puzzle batch.
- **"Try another move" button** on lessons that succeed via a discovery action (the suicide-on-eye path), so the player can explore the alternate without losing completion.
- **Territory overlay** on lesson 11 (Count Your Land) reuses the in-game scoring screen's territory-dot rendering — visual consistency with the real game.
- **Two-eyes triumph sound** plays whenever a group locks in life (correct "Safe" answer in lesson 9, vital point made in lesson 10 Part 1, defender's reply forms eyes in lesson 10 Part 3). Procedural Web Audio (cosmic + classic packs).

## Not yet built (deferred to wave 2 of lessons)

- **Board overlay primitives** (arrows, labels, "play here" ghost stones). Current lessons only have point-glow highlights and the fixed-position eye-region highlight — that's been enough for v1's concept set, but more advanced lessons (ladder, net, snapback, sente/gote) will need richer annotation.
- **Branching lesson trees** — current path is strictly linear.
- **Voice narration**, authoring UI, parent-facing lesson progress dashboard.
- **Concept ladder beyond two-eyes** — ladders, nets, snapbacks, connect/cut, influence vs territory, endgame counting, opening principles, sente/gote. These are the next batch once playtest data tells us where players actually get stuck.

## Open questions
- Are the lessons too long / too short / well-paced? Need real-user data.
- Does the modal-at-the-bottom UX read on mobile and iPad as well as desktop? Anecdotally yes; needs a real test.
- Should lessons be skippable for returning users, or does the full sequence matter every time? Currently the harness wipes progress on lesson-mode entry (testing convenience — not a permanent product choice).

## Dependencies
- None hard. Feeds 02 (puzzles share concept tags) and 05 (NUX sends first-time users into lesson 1).

## Success signals
- A first-time user can complete the first 3 lessons without getting stuck.
- Lesson completion rate from first to eleventh lesson > 40%.
- Kids who finish the lesson track graduate to playing 15k with a better-than-random record.

## Next batch — from the learn-to-play-go.github.io comparison + first 7yo playtest (2026-06-27)

Two inputs landed together: a content comparison against
[learn-to-play-go.github.io](https://learn-to-play-go.github.io/) (an adult,
rules-complete tutorial with coached interactive exercises), and the **first
non-Roland/non-Max 7yo** through the app (Roland's friend's son). Concrete adds:

**A. Glossary / concept enrichment (do in the glossary — fp 29):**
- **`liberties`** — add an explicit explanation **plus a large-group liberties
  diagram** (theirs shows a whole group's shared liberties; ours only shows a
  lone center stone with 4). Patrick's call — the group case is what actually
  builds intuition. Bonus: show edge/corner stones have fewer liberties.
- **False eyes** — real vs. false eye. Fold into `two-eyes` / `life-and-death`.
  *The* classic kid trap ("I have two eyes!" — no, one is false and the group
  dies). Theirs teaches it explicitly (`falseEye` scenario); we don't.

**B. New advanced lessons** (today taught only in-game / as glossary stubs).
These need the richer board-annotation primitives flagged in "Not yet built"
(arrows, labels, ghost stones):
- **Ko** — Patrick: ko is important and we only explain it in-game; give it an
  advanced lesson. (Note the registry's `ko-rule` example is `null` — a static
  diagram reads poorly; a stepped lesson is the right vehicle.)
- **Ladders**, **Nets**, **Snapback** — their Advanced section shows ladders +
  snapback; we should have lessons for those three (nets included). Concepts
  already exist in the registry (`ladders` / `nets` / `snapback`), no lessons yet.

**C. Beginner-strategy beat:**
- **"Don't chase captures — make territory."** The single biggest beginner
  breakthrough, and our arc is tactics-heavy (capture/atari/races) without it.
  Theirs says it plainly ("focus less on capturing the opponent's stones").

**D. Lessons UX — wrong-answer handling (CONFIRMED by the 7yo playtest, blocking):**
- Watching the 7yo: when he **picked a wrong answer to a quiz question** (the
  `quiz` kind, e.g. lesson 9 "Safe or Gone?"), the app gave **no help and no
  chance to try again** — he stalled and got discouraged. This is the
  "coached corrective hints" idea from the comparison, now confirmed in play:
  add a concept-specific nudge on a wrong answer ("not quite — look at whether
  White can still capture this") + a retry, instead of a dead end. Folds into the
  milestone's **lessons-polish** item (MILESTONE §1) — highest-priority of this
  batch since it's a live, observed kid-frustration.

> Bigger-picture observation from the same playtest — after easy wins vs. the
> beginner bot the 7yo thought Go was *easy*, only sensing the depth on a harder
> bot with no guidance. Captured separately as **[fp 30](30_difficulty_arc.md)**
> (conveying Go's depth before a kid writes it off as shallow).
