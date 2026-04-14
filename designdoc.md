> **Status**: Draft v0.3 — open questions deferred to v2. See companion doc *Building a Rank-Calibrated Go Bot Using KataGo* for AI architecture.
> 

> **What v1 is for**: V1 is the *technical foundation*, not a kid-shippable product on its own. It proves the AI rank ladder, the board feel, and the study mode work on 19×19 — the hardest surface for AI calibration. The kid-facing wrapper (smaller boards, age-appropriate first contact, parent surface) lands in v2 once the foundation is solid. We are deliberately not putting a half-baked onboarding in front of children.
> 

## Vision

A Go app that feels as rewarding to touch as Pokémon TCG Pocket, with a teaching AI that meets players where they are. **Built kid-first** — the target player is a child learning the game from scratch — but the polish and depth should make it equally usable for returning adult players. There are plenty of adult Go apps; nothing really geared toward kids. That gap is the opportunity.

## Design Pillars

1. **Every stone feels good.** Placement, capture, and connection are tactile, animated, and celebrated. The board is a toy, not a spreadsheet.
2. **The AI is a sparring partner, not a wall.** Scales smoothly from absolute beginner to dan level, and plays *like* a player of that rank — not like a crippled engine.
3. **Understanding > winning.** Study mode is the secret weapon. KataGo gives the truth; our layer translates it into something an 8-year-old actually learns from.
4. **Kid-first, adult-friendly.** Defaults assume a child who doesn't know the rules. Adults can turn down celebration density and turn up information density.

## Resolved Decisions

- **Platform**: Web first (React + TypeScript + Vite, PixiJS for the board). iOS via Unity in v2+. Animation specs in tool-agnostic JSON so the feel ports forward.
- **Board size**: 19×19 only in v1. AI calibration is hardest and most valuable here, OGS rank data is 19×19-anchored. Onboarding UX must do real work to make 19×19 non-scary for kids.
- **AI approach**: Per the *Rank-Calibrated KataGo* doc — KataGo as base engine + rank-aware move selection layer. V1 ships Phase 1 (heuristic sampling); Phase 2 (OGS-trained rank model) is v1-stretch / v2.
- **Audience**: Kid-first. Target player ~7–12, learning from scratch. Adults are a welcome secondary audience but do not drive defaults.
- **Monetization**: Cheap one-time purchase (~$4–8), no IAP, no ads, no recurring. No monetized reward loops.
- **Infra cost**: Not a v1 constraint. Funded separately. This unlocks GPU-backed KataGo from day one for both live play and study analysis — no CPU compromises, no rate-limited analysis. Hosting likely Modal or Runpod, autoscaled GPU workers. Specific architecture deferred but cost no longer shapes design.

## V1 Scope

### 1. Onboarding (minimal in v1)

- V1 assumes the player knows the basic rules. Full kid-first onboarding is a v2 concern that lands alongside 9×9 and 13×13 boards.
- Bare minimum in v1: a short interactive rules refresher (capture, ko, two eyes, scoring) for adults coming back to the game. Skippable.
- The full age-7 onboarding flow, the rules tutorial, and the 19×19 first-contact UX problem are all explicitly v2.

### 2. Board & Interaction Feel

- Stone placement: satisfying snap, subtle squash/stretch, soft shadow settle. Sound design is first-class.
- **Reactive animations** triggered by board events:
    - *Capture*: stones lift, shimmer, fly to a captured-stones tray. Bigger captures = bigger celebration.
    - *Connection*: pulse along newly-shared liberties when groups join.
    - *Atari*: warning glow on threatened groups (on by default for kyu ranks; toggleable).
    - *Net / ladder*: detected geometrically; first few times trigger a named callout.
    - *Snapback / seki / throw-in*: small sparkle so players notice they did something cool.
- **Reward loop** (intrinsic only — no currency, no IAP):
    - Stickers and trophies for milestones (first capture, first win, first ladder, first 10 games)
    - Unlockable board styles, stone styles, sound packs — earned through play
    - Gentle daily-play streak (no FOMO mechanics)
    - A trophy shelf the kid can show parents
- **Density toggle**: kids get full celebrations by default; adults / dan-level players can switch to a calmer Zen mode.

### 3. Scaling AI Opponent

See *Building a Rank-Calibrated Go Bot Using KataGo* for full architecture. V1-specific notes:

- **V1 ships Phase 1**: KataGo + heuristic rank-aware sampling layer (point-loss distributions, policy filtering, randomness tuned by target rank). Target a believable ladder from ~15k to ~3k.
- **Very-beginner end (20k–15k) is the highest-risk piece** — beginners play locally-reactive moves and ignore whole-board strategy. May need a small handcrafted shape-based policy as a stopgap. Prototype this early; it's where our actual users start.
- **V2**: Phase 2 — train rank-conditioned model on OGS data. Makes both 20k and dan feel *real*.
- **Infra**: GPU-backed KataGo from day one (Modal / Runpod / similar). High visit counts available for both live play and study analysis. Cost not a constraint.

### 4. Single-Player Ranked vs AI

- Player picks Ranked Game → matched to bot ~1 stone above current rating → result updates rating (Glicko-style).
- Casual mode for any rank, no rating change.
- Resign and pass supported. KataGo scores at game end with kid-friendly territory overlay (shaded zones, not dots).
- Games auto-saved to library for study.

### 5. Study Mode (the teacher)

The single most differentiating feature. With cost no longer a constraint, this can be lavish.

- KataGo analyzes every move at high visit count: winrate, score delta, top alternatives, multi-move variations.
- We layer a **narrative explanation** on top:
    - Identify 3–7 critical moments per game (biggest swings).
    - Plain-language explanation of what happened, what was better, and *why*.
    - **Tone calibrated to player rank and reading level.** Kids: short sentences, simple words, concrete language. Adults SDK+: precise Go vocabulary.
    - Categorize mistakes by type (atari ignored, overconcentration, bad direction, etc.) and track over time. Teacher can say "you've been making this same mistake — let's work on it."
- Walk-through mode: step through the game with inline commentary.
- **What-if exploration**: let the player click any move, place a different stone, and see KataGo's evaluation update. With GPU available, this is fast enough to feel interactive.
- **Implementation**: deterministic feature extraction from KataGo (mistake type, magnitude, board region) + LLM for the prose layer only, tightly constrained. Reduces hallucination risk on Go-specific content.

### 6. Kid-Safety & Compliance

- **Assume COPPA applies.** No PII collection, no email-required accounts, no chat, no third-party ad SDKs, careful analytics (privacy-first, aggregated).
- Local-first profiles where possible. Cloud sync, if any, is parent-gated.
- Parent-facing surface: simple "what your kid is learning" view — rank progress, concepts mastered, time played.
- No social features, no external sharing in v1.

## Look & Feel (exploratory)

> **Status**: Direction, not commitment. Revisit once the feel prototype is in front of us.
> 

**Calibration for v1: subtle but present.** The cosmic frame should be discoverable, not assaultive. The risk of going full starfield from day one is tipping into theme-park territory and undermining the dignity of the game itself. Better to start restrained and let the aesthetic earn more space across versions.

The mental model: it should feel less like "Go in space" and more like *Go played late at night, when the room is quiet and the board feels bigger than it is.* That's the *Hikaru no Go* feeling — introspective, a little mysterious, occasionally transcendent.

**Core thematic frame**: cosmic / mysterious / playful, drawing on the *Hikaru no Go* sensibility and Go's own long tradition of cosmic metaphor (*uchū-ryū*, the goban as star chart, stones as constellations). Pokémon Pocket remains the reference for *interaction polish* — tactile feel, satisfying micro-animations, celebration density — but the *aesthetic* is cosmic wonder, closer to *Cosmos* / *Interstellar* / *2001* than to space opera. Awe, not franchise. Avoid specific Star Wars iconography (IP risk and pulls the app toward themed-skin territory).

**What "subtle but present" means in practice for v1:**

- **Calm base palette.** Deep navy or charcoal, not black-and-purple-nebula. Cosmic feeling from depth and quietness, not from overt imagery.
- **Board stays legible first.** Clean readable lines, subtle intersections. Not a screaming starfield with stones on top — more like a dark slate with a faint suggestion of stars beneath.
- **Animations carry the theme, not the chrome.** A capture has gravitational-collapse feel, but it's a half-second moment, not a five-second cinematic. Mystery lives in *behavior*, not decoration.
- **Sound does heavy lifting.** Low ambient bed, sparse, occasional resonant tones. Probably the cheapest way to establish "cosmic" without committing visual budget.
- **Reserve big moments for big moments.** Hero animations (first ladder, snapback, winning a ranked game) lean into the theme harder. Routine moves stay quiet. This also makes special moments feel special.

**Visual language ideas to prototype (calibrated subtle):**

- **Board as quiet starfield.** Faint suggestion of stars in the background; intersections are dim points that softly brighten when a stone is placed nearby. No constellation grid overlay in v1 — too busy.
- **Stones as celestial bodies, restrained.** Black = deep void with a faint inner depth; White = soft luminous, not glowing-bright. Distinct identities, but neither shouts.
- **Groups as constellations, only when meaningful.** The connection-pulse animation appears only when stones *newly* connect — not as a permanent overlay. Living groups (two eyes) get a very subtle shimmer that you might not notice until you do. This rewards attention rather than demanding it.
- **Captures as gravitational events.** Captured stones get pulled toward the capturing group and collapse. Bigger captures = bigger events. Ladders cascade. This is one of the few places we *do* lean in — captures are emotionally important, they should land.
- **Territory as quiet nebulae.** At scoring, territory fills in like soft glowing clouds claiming regions of the sky. Restrained color, slow fill.
- **The teacher as a navigator / stargazer.** Structural inspiration from Sai in *Hikaru no Go* — a wise companion who sees the board differently than you do. Avoid character specificity that reads as religious or appropriative. Mentor tone, not quiz tone.

**Sound design** (worth a dedicated session before the feel prototype):

- Low ambient drones as base layer, sparse and unobtrusive
- Stone placement as a soft chime, possibly resonating differently by board position
- Captures as collapse / whoosh
- Ladder cascades as ascending arpeggios
- Tonal shift between casual (stargazing) and competitive (battle of galaxies) registers — same language, different intensity

**Open thematic questions** (revisit across versions, not blocking v1):

1. **How literal does the cosmic frame get over time?** V1 stays restrained. V2+ can earn the right to lean further if the foundation works.
2. **Tone register**: shifting from quiet stargazing (casual) to battle of galaxies (ranked). Same visual language, calibrated intensity.
3. **Black/White asymmetry**: how distinct should the two players' visual identities be without breaking the symmetry of the game?
4. **Reference gathering**: build a moodboard before the feel prototype. Sources: *Hikaru no Go* (cosmic title sequences and Sai's introspective moments), *Cosmos* (Sagan), *Interstellar*, *2001*, ambient electronica album art, NASA imagery, classical Japanese star charts.

## Out of Scope for V1 (Backlog)

- **Kid-first onboarding flow** (the full age-7 tutorial, rules teaching, guided first game) — lands with v2 alongside smaller boards
- **9×9 and 13×13 boards** — paired with kid onboarding in v2; together they form the "kid ramp"
- **Parent-facing surface** ("what your kid is learning" stats / learning report) — important but not on the v1 critical path
- Concept-teaching minigames (Atari Go, capture race, ladder drills, first/second-line drills)
- Online play vs humans (likely OGS API)
- Puzzle mode with ranked tsumego (20k → dan)
- Phase 2 AI (OGS-trained rank-conditioned model)
- iOS / Unity port
- Social features, shared replays, friends
- Cloud sync / multi-device profiles
- Distribution / marketing strategy — revisit once MVP is near-complete

## Open Questions

All v1 open questions resolved. V2 questions to revisit when we start the kid ramp:

1. **19×19 vs smaller-board first contact for kids.** Pairs with 9×9 / 13×13 work in v2. Guided subset of the board? Sandbox before first real game? Very forgiving intro bot?
2. **Parent-facing surface scope.** Minimum viable is a stats screen; maximum is a full learning report. Lean minimum.
3. **Distribution.** Revisit once MVP is near-complete and we have something to show parents.

## Next Steps

1. **Feel prototype**: single 19×19 board in PixiJS with placement, capture, and 2–3 hero animations. Goal: does it feel like a toy?
2. **AI spike**: stand up GPU KataGo, implement Phase 1 heuristic rank layer, prototype a 15k bot and a 5k bot. Have actual beginners play them.
3. **Onboarding paper prototype**: storyboard the first 5 minutes for a 7-year-old who has never seen Go before.