# 12 — Animations & sound effects (expansion)

**Status:** 📝 Planned
**Priority:** Medium

## What
Expand the reactive animation and sound layer beyond placement + capture. The design doc calls out connection pulses, life/two-eye shimmer, atari glow, named tactical callouts (ladder, snapback, seki, net), and celebration-scaled captures. Some exist in code but don't trigger; most don't exist yet.

## Why
- Design pillar #1 is "every stone feels good." Placement and capture feel good today; the rest of the board is silent.
- These animations *teach* — a connection pulse makes the kid notice that two groups are now one. A two-eye shimmer tells them something important without words. Animation as pedagogy.
- Sound design is called out as doing "heavy lifting" for the cosmic theme. Right now we have procedural chimes and impacts; there's headroom for an ambient bed and tonal shifts.

## Approach

### Animation events to add
1. **Connection pulse.** When two groups merge, a pulse travels along the newly shared liberties. Code exists in `stoneAnimations.ts` but never triggers — wire up group-merge detection in the engine.
2. **Two-eye shimmer.** When a group achieves two clear eyes, a very subtle shimmer on the group. Detect geometrically (eye-shape recognition) after each move. Only fire once per group-achieves-life event.
3. **Atari threat glow.** Glow exists for the target group in atari. Verify it fires reliably at all ranks (design doc: on by default for kyu, toggleable).
4. **Named tactical callouts.** Geometric detection, then a small text/glyph callout the first few times a player encounters each:
   - Ladder (cascading line of atari moves)
   - Net (loose enclosure)
   - Snapback (opponent captures into a capture)
   - Seki (mutual life with no eyes)
   - Throw-in (sacrifice to reduce liberties)
5. **Capture celebration scaled to size.** 1-stone capture stays subtle. 5+-stone capture leans into the "gravitational collapse" animation described in the design doc. 20+-stone capture is a hero moment.
6. **Territory reveal at scoring.** Existing nebula fill — audit pacing, tune to feel earned.
7. **Milestone animations.** First capture, first win, first ladder, first seki. Cross-feature with the rewards cluster (see gaps note).

### Sound events to add
1. **Ambient bed.** Low, sparse drone during play. Different register for casual (stargazing) vs ranked (battle of galaxies) — same instrument family, different intensity. Mute toggle obviously.
2. **Connection sound.** Soft tonal merge when groups join.
3. **Two-eye sound.** Barely-there chord when life is achieved.
4. **Ladder cascade.** Ascending arpeggio as the ladder plays out, with the resolution note on the final capture.
5. **Named-moment stingers.** Short unique sounds for snapback, seki, net.
6. **Game-end chord.** Exists — audit whether it feels different for win / loss / close result.
7. **UI sounds.** Menu navigation, button presses — should match the cosmic register, not generic click.

### Infrastructure
- **Animation registry.** One place in code that maps "event name → animation spec." Makes porting to iPad/native easier (design doc notes animation specs should be tool-agnostic JSON).
- **Density toggle.** "Zen mode" reduces animation intensity and sound layers for adults. One user setting that dampens celebration and ambient sound globally.
- **Tactical detector module.** Shared by animations, named callouts, and the AI teacher (feature 04) — detect ladder/net/snapback/seki once, surface everywhere.
- **Performance.** All animations stay Canvas2D where possible; avoid creating detection work that blocks the render thread on low-end iPads.

## Scope — first cut
- Connection pulse wired to group-merge detection.
- Two-eye shimmer (detect + render).
- Named callouts for ladder and snapback only (the two most common).
- Capture celebration scaled to 3 tiers (small/medium/hero).
- Ambient sound bed with one register.
- Density toggle in settings.

## Out of scope (first cut)
- Seki / net / throw-in detection (harder to get right, add in iteration 2).
- Multi-register ambient (casual vs ranked).
- Stinger sounds for every named moment.
- Avatar signature motion (covered in feature 11).

## Open questions
- How do we test that these animations feel good without actual kid playtesting? Beta hosting (09) gates real validation.
- Tactical detection at what cost? A full detector pass every move on a 19×19 is cheap on desktop; on iPad it may not be. Profile early.
- Do we ship pre-recorded sound or continue procedural? **Leaning:** procedural for responsiveness (ambient bed can layer pre-recorded pads under procedural events).
- How do we source or license the ambient bed without spending heavily?

## Dependencies
- Feature 04 (AI teacher) — shares the tactical detector.
- Feature 11 (avatars) — share animation registry and density toggle.
- Feature 08 (traditional mode) — density toggle lives next to the theme toggle in a shared settings panel (which doesn't exist yet).

## Success signals
- A beta kid says something like "did you see when my stones lit up?" without prompting.
- Adult testers don't find the animations distracting (or turn on Zen mode without feeling punished).
- Tactical callouts fire accurately — no false positives on "ladder" when it isn't one.
