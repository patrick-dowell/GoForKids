# 11 — Avatars (expansion & polish)

**Status:** 📝 Planned
**Priority:** Medium

## What
Today there are 3 player avatars (Black Hole, Nova, Nebula) and 8 bot avatars (Seedling → Void). We want more of both, and a quality pass on the existing ones so they feel like characters rather than CSS shapes.

## Why
- Avatars are the kid's self-expression in the app. Three options isn't enough — kids want to pick "their" one.
- Bot avatars carry the ladder's identity. The progression from Seedling to Void is the narrative of getting stronger; each one should be memorable.
- Low-effort, high-perceived-quality change — polish here lifts the whole app's feel.

## Approach
1. **Audit the existing roster.** CSS-only art today — quick but limited. Decide whether to:
   - Keep CSS-only and push it further (SVG filters, layered gradients, subtle motion).
   - Move to SVG illustrations (more expressive, still sharp at any resolution).
   - Move to animated Lottie/rive files (best feel, more tooling).
   *Leaning:* SVG with light CSS animation for v1 of this work; Lottie for hero moments only.
2. **Expand the player roster** to ~12 avatars along a clear thematic axis:
   - Celestial bodies: Black Hole, Nova, Nebula, Pulsar, Quasar, Comet, Eclipse, Aurora, Galaxy, Wormhole, Supernova, Singularity.
   - Each has a distinct silhouette, color story, and single signature motion (a pulse, a rotation, a twinkle).
3. **Expand the bot roster to 12 ranks** (paired with feature 01). Current: Seedling, Sprout, Pebble, Stream, Boulder, Ember, Storm, Void. Need avatars for 12k, 10k (Boulder exists), 8k (Ember exists), 5k (Storm exists), 3k (Void exists), 1k, 1d. Gaps: 12k and above 3k need filling. Theme continues the "escalating natural/cosmic force" ladder.
4. **Polish pass on existing.** Tighten the shape language so the 11 of them feel like one set, not eleven one-offs. One designer pass across the whole roster.
5. **Signature motion per avatar.** A 1–2 second loop that plays on the homepage card and during the AI-thinking state. Subtle — cosmic wonder, not Saturday morning cartoon.
6. **Active-turn treatment.** The existing glow when it's that player's turn should feel bonded to the specific avatar — Nova's glow is a flare, Black Hole's is a gravitational lens warp.
7. **Avatar picker UX.** Today it's in the New Game dialog. Consider:
   - A dedicated "choose your avatar" moment during NUX (feature 05).
   - Letting the kid change avatar from their profile later.
   - Hinting at locked avatars without spoiling the unlock.
8. **Unlocks (optional, ties to feature 12 / rewards cluster).** Start with ~6 avatars unlocked and reveal the rest through play milestones — first capture, first win, first game at each rank, etc. Do this only if the rewards cluster lands.

## Scope — first cut
- SVG-ify and polish the existing 11 avatars.
- Add 4 more player avatars (total 7) and 4 more bot avatars to cover the full ladder (01).
- Signature motion for each. Active-turn treatments bonded to avatar.

## Out of scope (first cut)
- Full character illustrations beyond silhouette + color.
- Voice / dialogue per avatar.
- User-uploaded avatars.
- Full Lottie animation rewrite.

## Open questions
- Do we hire/contract a designer for this, or push our own CSS/SVG work further?
- Do avatars have names kids can personalize, or are the names fixed and kids name their *profile*?
- Should the player's chosen avatar affect anything mechanical (no — cosmetic only), or is there a light flavor difference?

## Dependencies
- Feature 01 (bot ladder) — new bot avatars depend on which ranks we ship.
- Feature 05 (NUX) — picking an avatar should be a clear moment in first-open.
- Feature 12 (animations/SFX) — signature motion per avatar shares infrastructure.

## Success signals
- Kids have a "favorite" and talk about it by name.
- Beta feedback mentions the avatars unprompted.
- Avatar change rate in-product is low after the first pick — means the initial pick feels like a commitment, not a placeholder.
