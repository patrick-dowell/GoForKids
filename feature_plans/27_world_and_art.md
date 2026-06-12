# 27 — World & art pass ("a world you're living in")

**Status: DESIGN CAPTURE (Patrick, 2026-06-11). Not scheduled.** Absorbs/extends
11 (avatars) and 12 (animations), and supplies the cosmetic payload for 15
(rewards loop) and 26 (ranked energy).

## Vision (Patrick's framing)

Make the app feel like a **world you're living in**, not a UI with bots in it.
Spell out the world's details; define the player avatars and bot characters
properly; remake the art so it all looks good and consistent; ideally animate
the characters so they **react to the game**.

## Shape of the work

1. **World bible — the first artifact, and the prerequisite.** The world's
   fiction (the cosmic theme is already established: Seedling → Void, star
   imagery), each bot's character/personality/rank flavor, the player avatar
   roster, and a visual style guide (palette, line weight, proportions).
   This is *writing and art direction, not engineering* — it can be built in
   salon-mode evenings without owning a focus window. Bonus compounding: bot
   personalities written here later feed game **commentary** (fp 06 observing
   + fp 04 AI teacher) — the world bible is shared infrastructure for the
   next-version features too.
2. **Asset production.** A consistent avatar set: players + bots + reward
   unlockables. 2026 reality: AI image generation with character sheets makes
   a consistent solo-produced set feasible; decide gen vs. commission vs.
   hybrid per piece.
3. **Animation layer.** Event-driven character reactions: good move, blunder,
   capture, win/loss, rank-up, (fp 26) power use. Tech choice in design —
   sprite sheets / Lottie / CSS states. Event hooks largely exist already
   (RankUpOverlay, game-end modals, capture events).
4. **Rewards integration.** The new avatars/cosmetics ARE the unlockables that
   15/26 progression grants — this doc supplies what those systems spend.

## Sequencing

World bible → assets → animations. Mechanics (fp 26 phase 1) can land before
or in parallel — it creates the slots this art fills.

## Open questions

- Art pipeline: AI-gen with style anchoring vs. commissioned vs. hybrid?
- Animation tech + performance budget (note the iPad thermal item in
  DEVJOURNAL — animation work must not worsen it).
- How much world fiction surfaces as in-app text vs. stays visual flavor?
