# Development Journal

## Session 2 — April 22, 2026

### Planning
- Drafted `feature_plans/` — 19 self-contained docs + a status index with 4-wave sequencing (foundations → teaching loop → reward/parent loop → expansion). Covers bots, puzzles, lessons, AI teacher review, NUX, OGS observation, online play, traditional mode, hosting, iPad, avatars, animations, smaller boards, parent dashboard, rewards, mistake tracking, rank UI, rules refresher, what-if.

### Shipped — feature 08 (traditional board mode), first cut
- `theme/themes.ts` abstracts the board renderer. Two themes: `cosmic` (default, extracted from the existing hardcodes) and `classic` (kaya wood, slate/clamshell stones, thin dark grid, flat translucent territory).
- `settingsStore` persists theme choice to localStorage.
- Real recorded wooden "clack" + capture samples in `frontend/public/assets/`; Web Audio API plays them with procedural fallback if loading fails.
- Reduced animation intensity in classic — subtler squash, no shockwave, fewer particles.
- Floating gear in the bottom-right opens a small settings modal with side-by-side theme preview cards.

### Side improvements landed this session
- **Library filter tabs** — All / Your games / Observed, with counts. Saved games now tagged `gameType` and (for bot-vs-bot) `blackRank`/`whiteRank`. Legacy saves without the tag fall back to `human-vs-bot`.
- **Clear all saved games** — button at the bottom of the Library with a confirm-then-commit flow.
- **Last-move marker overhaul** — replaced the tiny center dot with a halo ring around the stone + a bold move number on the stone. Both are needed: the halo is visible even on solid classic stones, and the number disambiguates which of several recent stones was the latest.
- **AnimationManager fix** — the placement animation used to draw a flat stone at scale=1 on its final frame, overwriting any persistent overlay. The manager now does one final base-board draw after animations complete, so the halo + move number survive.

### Bugs hit during the session
- "Bots don't move" turned out to be the backend not running — not a code bug. Noted in memory for future sessions.
- Move-number text rendered fine to the base board but was being covered by the placement animation's final frame (see AnimationManager fix above).

---

## Session 1 — April 14-15, 2026

### What we built (from zero to playable app in one session)

**Core Infrastructure**
- React + TypeScript + Vite frontend with Canvas2D board renderer
- Python + FastAPI backend with KataGo integration
- Go rules engine in TypeScript (34 tests) with captures, ko/superko, territory scoring, SGF import/export
- Mirrored Go engine in Python for server-authoritative game state
- Zustand state management, REST API client, WebSocket-ready architecture

**Board & Feel**
- 19x19 board with cosmic dark theme and gold-tinted grid lines
- Gradient stones with specular highlights (black stones visible against dark background)
- Stone placement animation (squash/stretch snap)
- Capture animation (shatter + particle scatter + shockwave ring)
- Capture flight animation (stones fly from board into prisoner trays)
- Atari warning glow
- Web Audio procedural sound (position-varying placement chimes, layered capture impacts, game-end chord)
- Territory overlay (nebula-style radial gradient fills)
- Dead stone markers (faded stones with red X)

**AI System**
- KataGo integration via Analysis Engine JSON API (Metal/GPU on Mac)
- Phase 1 rank-calibrated move selection with 10 tuning knobs per rank
- 8 bot ranks: 30k Seedling → 18k Sprout → 15k Pebble → 12k Stream → 10k Boulder → 8k Ember → 5k Storm → 3k Void
- Data-driven calibration from 154k real 15k games and 299k real 18k games (Fox Go Server)
- Bot validation framework: test_bot_vs_real.py (24% exact match at 15k) and bot_vs_bot.py (15k beats 18k 83%)
- Eye-fill prevention (no bot fills its own eyes)
- Auto-pass when KataGo's #1 move is pass
- Game-phase awareness (sensible openings, mistakes in midgame)

**Game Modes**
- Play vs AI (human vs bot at selected rank)
- Bot vs Bot spectator mode with speed controls (slow/normal/fast) and pause
- Local play (human vs human, no backend needed)
- Handicap stones (2-9) on standard star points, komi adjusts to 0.5
- Casual and ranked modes (Glicko-2 rating system built but not yet surfaced in UI)

**Avatars & UI**
- 3 player avatars: Black Hole, Nova, Nebula (CSS-only art, persisted to localStorage)
- 8 bot avatars with escalating visual presence (Seedling → Void)
- Player cards with active-turn glow and AI thinking pulse
- Prisoner trays (10x5 grid, captured stones with drop animation)
- Avatar picker in New Game dialog
- Cosmic homepage with twinkling starfield, floating stones, bot roster

**Game Lifecycle**
- New Game dialog with mode selector, avatar picker, rank selector, handicap slider
- Game controls (pass, undo, resign, finish game)
- Finish Game — KataGo plays out both sides at 500 visits, scores with dead stone detection
- Japanese scoring with territory + captures + komi breakdown display
- Dead stone detection via KataGo ownership analysis
- Auto-save finished games to localStorage library
- SQLite persistence on backend

**Replay & Study**
- Game library with saved games, date, result, opponent rank
- Full game replay with move-by-move navigation (buttons, slider, arrow keys)
- Autoplay with speed controls (slow/normal/fast)
- Territory overlay at final position with KataGo-backed dead stone detection
- Download SGF for use in external apps (KaTrain, Sabaki, OGS)
- Auto-complete moves preserved in SGF (KataGo endgame moves included in replay)
- Study mode UI (backend wired but not yet connected to game replay)
- Handicap stones properly encoded in SGF (AB[] properties)

**Quality & Testing**
- 34 Go engine unit tests (captures, ko, superko, territory, SGF round-trip)
- Bot calibration test suite against real Fox server games
- Bot vs bot match runner with handicap support
- Game data analysis tools (move distribution, local response patterns, edge distance)
- Capture double-count bug fix
- Board flicker fix (canvas resize on every draw)

### Bugs fixed during the session
- Black stones invisible on dark background → gradients + border rings
- Animations rendering at wrong positions → DPR double-scaling fix
- Captures counted twice when group touches placed stone at multiple points
- Bot passed on move 4 → auto-pass logic only when KataGo says pass
- Bot filled its own eyes → eye-fill safety check on all moves
- Score display showing confusing Chinese scoring totals → Japanese scoring with breakdown
- Bot-vs-bot result text saying "You win" → shows bot names
- SGF export missing handicap stones → AB[] properties added
- Board flickering in bot-vs-bot → canvas size set once, not on every draw
- Bot-vs-bot: player could click board and see game controls → all blocked
- Replay territory not showing → useEffect dependency fix + KataGo ownership

### Key design decisions
- Canvas2D over PixiJS — simpler, avoids async init issues, good enough for 2D board
- Japanese scoring over Chinese — "count territory + captures" is easier for kids
- KataGo ownership for dead stone detection — more accurate than heuristics
- Data-driven bot calibration — real game statistics instead of guessing
- No first-line injection — makes bot feel random, not weak
- Opening phase in bot profiles — even beginners play recognizable openings
- Server-generated SGF for auto-completed games — preserves KataGo endgame moves

---

## V1 Remaining TODO

### High Priority
- [ ] **Rating display in UI** — Glicko system is built, needs a widget showing rank + progress over time
- [ ] **Study mode wired to replay** — clicking a library game should allow KataGo analysis + Claude narrative, not just board replay
- [ ] **What-if exploration** — click alternate move in study mode, see KataGo eval update live

### Medium Priority
- [ ] **Connection pulse animation** — code exists in stoneAnimations.ts but never triggers (detect when groups merge)
- [ ] **Milestone stickers** — "First Capture!", "First Win!", "10 Games Played!" — the reward loop for kids
- [ ] **Rules refresher** — short interactive tutorial (capture, ko, two eyes, scoring) for returning adults
- [ ] **Ladder/snapback/seki callouts** — detect special moves geometrically, show a named callout the first few times
- [ ] **Validate 12k–3k bots** — run bot-vs-bot and test_bot_vs_real for each rank pair, download Fox data for each

### Low Priority
- [ ] **Zen mode toggle** — reduce animation density for adults
- [ ] **Unlockable cosmetics** — board styles, stone styles, sound packs earned through play
- [ ] **Daily streak** — gentle play streak, no FOMO mechanics
- [ ] **Mistake tracking across games** — "you keep making this mistake" teacher pattern
- [ ] **Trophy shelf** — milestone collection the kid can show parents

---

## V2 Roadmap (from design doc)

- **Kid-first onboarding** — full age-7 tutorial, rules teaching, guided first game
- **9x9 and 13x13 boards** — paired with kid onboarding as the "kid ramp"
- **Phase 2 AI** — train rank-conditioned neural network on OGS data (56M games)
- **Parent-facing surface** — "what your kid is learning" stats, rank progress, time played
- **iOS / Unity port** — animation specs in tool-agnostic JSON for portability
- **Online play vs humans** — OGS API integration
- **Puzzle mode** — ranked tsumego from 20k to dan
- **Concept-teaching minigames** — Atari Go, capture race, ladder drills
- **Cloud sync** — parent-gated, multi-device profiles
- **Social features** — shared replays, friends (with COPPA compliance)

---

## Technical Debt
- [ ] Canvas resize only on mount works but doesn't handle window resize — add a ResizeObserver
- [ ] Replay replays from move 0 each time goToMove is called — could cache board states
- [ ] Bot-vs-bot creates a new backend game for each move (the test harness approach leaked into the frontend) — should use a single game with alternating ai-move calls
- [ ] The 30k bot's `_select_beginner_move` function is now unused (30k uses KataGo) — clean up dead code
- [ ] Multiple KataGo processes could spawn if the engine singleton race conditions — add a lock
- [ ] The `game.board.hash()` function joins all 361 grid values into a string — use a proper hash for superko
