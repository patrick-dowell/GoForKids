# 28 — In-game learning engine ("Play of the Game" review)

**Status: 🧪 Built 2026-06-16/17 (Session 25) — swing-based + replay-integrated.**
Built: `gameReview.ts` selects by **engine swing** (`scoreHistory`), with
capture/atari as the *interpretation* layer (what happened + magnitude + concept
link); falls back to capture/atari selection when there's no score data.
`GameReview` overlay + `gameReviewStore`, opened from "See your Play of the Game"
on the ranked game-end modal AND integrated into the **replay timeline** (markers,
★ skip-to-key-move, per-move explanation; saved games persist `scoreHistory`).
`?review=demo` / `?replay=demo` fixtures.
**Remaining (needs device w/ real KataGo scores):** populated swing review on a
real game (stub-AI/local has no scores → tactical fallback); local-region
cropping for 19×19 moment diagrams; wiring an energy reward (fp 26)
for opening the review. Original design capture below.

**Design captured 2026-06-16 (Patrick + Jarvis design session).**
Connects/absorbs: 04 (AI teacher review), 16 (mistake tracking), 03 (concept
lessons), 02 (puzzles), 19 (what-if), 26 (energy), 15 (rewards). This is the
candidate **spine** of the learning loop — the bridge that makes "playing" and
"learning" the same act, which is the #1 tester ask (full loop, no gaps).

## Strategic context — the wall problem

Any skill-ranking system (Elo/Glicko/our ladder) is designed to converge every
player to ~50% winrate at their true level. **The wall is the system working,
not a bug** — so it can't be tuned away. The retention question is therefore:
*what is climbing when rank isn't?* Card games (Pokémon Pocket, Hearthstone,
Arena) answer this by **manufacturing** a second axis — monthly resets, daily
packs — because a CCG has only one real ladder and nothing else.

**Go doesn't have to fake it.** It has honest, orthogonal progress axes already:
- **Handicap** — Go's native anti-wall; every game can be a real 50-50 fight
  between unequal players, which no other game offers. (Our ladder already uses
  it as the rung mechanism.)
- **Board size** — 9×9 / 13×13 / 19×19 are three parallel climbs (already built
  as independent ladders).
- **Learning** — an infinite, gradable axis orthogonal to rank.

### The four pillars (the retention model this feature lives in)
1. **Ladder progress** — real rank gains; voluntary resets for a fresh climb
   (opt-in, reward-bearing — agency, not chore). [fp 22/24/25]
2. **Calibrated 50-50 games at every rank** — the engine + handicap. The actual
   moat; still needs work (calibration). [fp 01/20, b28]
3. **Energy / staying engaged even while losing.** [fp 26]
4. **Learning — in context, from your own games. ← THIS DOC, the keystone.**

**Reframe that ties it together: the wall is the best classroom.** At a plateau
you play close, even games full of real mistakes at the edge of your ability —
the richest teaching material that exists. If the teacher is most active exactly
at the wall, the wall stops being a dead end and becomes where growth happens.

## The core idea — "Play of the Game"

After each game, a fast, automatic highlights reel (think Overwatch Play of the
Game) surfaces the few moments that mattered — **both** the great moves and the
costly ones. Each is named (the concept) with a link to the glossary. The player
can tap to review, or just move on to the next game. Over time, if the same
mistake keeps surfacing, *that* incentivizes the player to do the lesson or go
deeper with the teacher.

### Why this framing wins
- **Autopsy → trophy.** Same replay data, opposite emotional valence. A "mistake
  report" scolds; a "Play of the Game" rewards. It turns review — the most
  homework-shaped part of any learning app — into the reel you *want* to watch.
- **Pull, not push.** The system makes the repeated-mistake pattern *visible* and
  lets the kid reach for the lesson; it never nags. (Same principle as Jarvis's
  own operating model — hold the mirror, drop the agenda.)
- **Glanceable by default, deep on demand** — respects flow and the fact that a
  kid will usually pick "play again." Review is opt-in and fast.

## Architecture — separate DETECTION from EXPLANATION

**Detection is solved; explanation is the work; within explanation, classifying
beats generating.**

- **Detection** = sharp moves on the score-lead curve (the score graph, just
  fixed in Session 24). A teachable moment is a big swing — yours or the
  opponent's. ~Free.
- **Explanation, reliable path (preferred):** a library of **rule-based concept
  detectors** that pattern-match the board transition at each swing using engine
  state we already have — group went 2→1 liberty undefended = **atari**; a
  connected group's ownership flipped = **life-and-death**; forced capture
  sequence = **ladder**; took stones left in atari = **nice capitalize**.
  Detector fires → label + glossary link (and optionally the anchored fp 03
  lesson). Human-authored = correct, no hallucination.
- **Explanation, powerful path (later, gated):** an LLM teacher for moments the
  detectors can't name or for "but why" — fed KataGo ground truth, constrained,
  claims checked against engine state. ⚠️ LLMs read board state poorly and will
  confidently teach *wrong* Go — never lead with this; it rides on top of the
  reliable core. Eventually conversational → merges with fp 19 (what-if).

**Coverage is a gradient that favors us:** tactical concepts (atari, capture,
ladder, life-death) detect cleanly; strategic ones (shape, direction,
overconcentration) mostly don't — but kids need the tactical concepts first
anyway. The hard-to-detect stuff is stuff the target age isn't ready for.

## Build path

**Crawl — "turning points" (almost no new AI):** post-game, deep-analyze (reuse
the Finish-Game 100+ visit pass), pick the single biggest swing + best move,
auto-play them as short replay clips. "Here are your key moments." No concept
naming required; unlabeled still works.

**Walk — name it:** detector library tags each moment with concept + glossary
link; unclassifiable moments degrade gracefully to "big swing, no label." This
is where it becomes a *teacher*.

**Run — patterns + dialogue:** cross-game mistake tracking (fp 16) surfaces "you
keep missing atari this week" → prescribes the lesson/puzzles (fp 02/03). LLM
teacher for nuance + what-if (fp 19).

## Design principles (non-negotiable)

- **Lead with glory, not the wound — adapt to the result.** In a **loss**, open
  with the player's best move (costly moments available but not headline). In a
  **win**, the near-miss is fine to feature (low stakes, ego intact). Never open
  a kid's post-game with where they blew it.
- **Few highlights.** One hero moment + maybe one lesson moment. Scarcity is what
  makes a Play of the Game feel special; a 10-item report card is a report card.
- **Record the concept tag on every flagged moment from day one** — even in
  crawl, before the cross-game pattern feature exists. The repeated-mistake
  payoff is only as good as the data quietly accumulated before you built it.
  (Same discipline as logging energy-usage from day one in fp 26.)
- **Review must be fast AND rewarding.** Wire it to energy (fp 26): reviewing a
  moment earns energy. Don't let it become homework — it competes with "play
  again" and will lose if it feels like work.
- **Flag the good moments, not just mistakes.** The praise-to-correction ratio
  *is* whether a kid comes back. Most review tools ship an all-negative autopsy;
  don't.

## Dependency note (re-justifies the current focus window)

The PotG names a concept and links to the **glossary** → the lessons/glossary
become the *destination* the most-watched post-game screen feeds into. The
lessons overhaul (current focus window) isn't a detour from this engine — it's
the half that must exist first for the links to land somewhere good. They're one
project: lessons are where the highlight points.

## Open questions

- How many highlights max (lean few — 1–2)?
- In-game silent marking of moments vs. purely post-game compute? (Post-game
  preferred — flow + iPad thermals.)
- Concept taxonomy: reuse fp 03's, or does the detector library define its own
  and fp 03 maps onto it?
- Does the hero-highlight get the energy reward, or only deeper review?
- Where does this sit in the roadmap vs. lessons/puzzles — likely *the* next-
  version learning centerpiece, with the crawl version possibly sneaking into
  this version once lessons land.
