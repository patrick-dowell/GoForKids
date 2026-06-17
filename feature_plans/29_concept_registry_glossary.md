# 29 — Concept registry & glossary

**Status: 📝 Planned — design captured 2026-06-16 (Patrick + Jarvis design session).**
The **schema/spine of the whole learning engine**, and the first thing to build.
⚠️ **May supersede / reframe earlier plans** (03 lessons, 02 puzzles, parts of
04/16) — see "Relationship to existing plans." Don't treat 03/02 as fixed until
this is decided.

## The pedagogical philosophy (Patrick, 2026-06-16)

- **The glossary is the canonical set of concepts we teach** — the full map.
- **Each lesson teaches exactly one concept.**
- **Lessons cover only the concepts you need to get into a game.** They're the
  on-ramp, deliberately short — NOT the whole curriculum.
- **The rest is taught as you play** — in-context, via the learning engine
  (fp 28) and the glossary-on-demand.
- Everything is **optional, never forced** — the glossary is there when you want
  to understand something, not homework. (Same DNA as fp 28 and the teacher:
  available, glanceable-then-deep, pull not push.)

This reframes the "5 min of lessons / need more lessons" tester feedback: the
fix is NOT more lessons. Lessons stay a short, one-concept-each on-ramp; depth
comes from playing + in-context teaching. The current 11 lessons are already
~the minimum-to-play set — the work is formalizing, tightening, and building the
reference layer around them.

## What

1. **Concept registry (`concepts.ts`)** — the single source of truth every
   learning feature reads from. Per concept:
   - `id` (e.g. `atari`), display name, **kid-simple explanation** (1–2 sentences)
   - an **example position** (small SGF, rendered on the existing board component)
   - `related` concept ids (Wikipedia-style links; enables a loose graph)
   - `lessons` that teach it, `puzzles` that drill it
   - `detector` ref (for fp 28's Play-of-the-Game tagging)
   - `tier`: **core** (needed to play) vs **extended** (taught in-context)
2. **`ConceptLink` component** — wrap any concept term anywhere in the app
   (lessons, PotG, tooltips, glossary cross-refs) → routes to that concept's page.
   "atari is clickable everywhere" becomes cheap once the registry exists.
3. **Glossary / concept page** — progressive disclosure:
   - **Lead with the 5-second answer**: the simple explanation + example position.
     (A kid clicking "atari" mid-confusion wants one sentence + a picture, NOW —
     not a menu.)
   - **Then optional depth, below**: do/redo the lesson · do puzzles · (later)
     "see it in your games" (fp 28 / 16).
   - **Glossary index**: browsable list of all concepts, core set surfaced first.

## The "core set" — concepts needed to play (seed list, to finalize)

placement & turns · liberties · capture (last liberty) · groups (shared
liberties) · atari · two eyes = life · suicide / illegal moves · territory &
scoring. (~maps to today's lessons 1–11.) Everything else — ladder, net,
snapback, cut/connect, semeai depth, ko tactics, sente/gote, shape, influence,
endgame — is **extended**, taught in-context as it arises.

## Build path

1. **Registry + core concepts** — author `concepts.ts` for the core set
   (extract from the 11 shipped lessons; don't invent a taxonomy). Wire
   `lessons.ts` to reference concept ids.
2. **Glossary page + `ConceptLink`** — the page (quick answer → optional depth)
   and the link component; sprinkle links where concepts already appear.
3. **Extended concepts incrementally** — add registry entries (explanation +
   example) for the long tail so the in-context teacher (fp 28) has somewhere to
   link, even before lessons/puzzles exist for them. A concept page can exist
   with just explanation + example; lesson/puzzle slots fill in later.
4. **Template-driven authoring** — make adding a concept cheap (text + one SGF +
   related ids). Content is the real cost; the plumbing is small.

## Relationship to existing plans (Patrick: "may deprecate if we like these better")

- **03 (concept lessons)** — reframed: lessons become one-concept on-ramps that
  *reference* this registry, not standalone content. The shipped 11 mostly fit
  already. Likely merges into "core-set lessons hanging off 29."
- **02 (puzzles)** — puzzles become concept-tagged drills the glossary/teacher
  prescribe; the registry provides the tags it already assumed existed.
- **04 (AI teacher) / 16 (mistake tracking) / 28 (PotG)** — all consume registry
  concept ids. 29 is their shared dependency.
- **Action:** keep 03/02 as-is for now but flag them "architecture under review
  pending 28/29." Decide on merge/deprecate once the registry is real and we see
  if the new structure wins.

## Open questions

- Finalize the **core set** — exactly which concepts gate "ready to play"?
- Registry shape: flat list + `related` links (pragmatic start) vs. an explicit
  prerequisite graph (richer, more upfront design). Lean flat-first.
- Where do example positions come from — hand-authored SGF per concept, or
  pulled from real game moments? (Hand-authored for core; real moments later.)
- Does the glossary page reward engagement (energy, fp 26), or stay pure
  reference? (Lean: pure reference — it's the one place that should feel
  pressure-free.)
