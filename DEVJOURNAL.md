# Development Journal

## Session 8 — April 24-25, 2026

Two major features landed plus a stack of polish.

### Smaller boards (feature 13) — shipped end-to-end
- **Engine refactor.** `Board` (TS + Py) takes a `size` constructor arg; `Point.index/neighbors/is_valid` accept size with default 19. SGF round-trips `SZ[n]`. New tests in `SmallBoards.test.ts` cover `Board(9)` and `Board(13)` for capture, scoring, ko.
- **Renderer.** `GoBoard.tsx` reads `boardSize` from the store, computes geometry per render, draws the right hoshi pattern (5 points on 9×9 corners + tengen, 5 hoshi + 4 edge midpoints on 13×13, 9 hoshi on 19×19) and per-size coord labels.
- **Picker + persistence.** Board size selector in New Game dialog; last-used size in `localStorage`. Ranks not calibrated for the chosen size are greyed out and labeled "X×X not tuned"; the selected rank auto-snaps to a valid tier when size changes.
- **Handicap** on all three sizes — hoshi-only on 9×9 (cap 5), full 9-stone pattern on 13×13.
- **Bot calibration v1** — `RANK_PROFILES_BY_SIZE[size][rank]` with 19×19 fallback. Six small-board profiles (30k / 15k / 6k × 9 / 13). New profile knobs: `pass_threshold`, `clarity_prior`, `clarity_score_gap`, `local_bias_in_opening`. 30k on small boards uses very high `local_bias` anchored to the opponent's last move (threaded through `state.py`) and disables the clarity gate so mistake injection actually applies in tactical positions — plays like an absolute beginner who responds to whatever you just played.
- **Pass detection refinement.** Visits-gated. A pass candidate is only trusted if it received `max(2, best.visits // 10)` visits during search — at low total visits, pass with 1 visit is just the value-network prior and was triggering spurious mid-fuseki passes.
- **Ko illegal-move filter.** KataGo doesn't see our move history (we send empty `moves`), so it can recommend ko recaptures. Bot picks one → engine rejects → state.py falls back to pass. Fix: filter all KataGo candidates through `board.try_play` on a clone before any decision logic so illegal moves never leave `_select_with_katago`. Resolved the "9k bot passes during ko fights" complaint.

### Animations & sound effects (feature 12) — first cut
- **Density toggle (Full / Zen).** Single 0.4× multiplier feeds both `theme.animationIntensity` (via `withDensity` helper) and a master `GainNode` in `SoundManager` that every sound routes through. Subscribed to the settings store so flipping ramps audio in ~50ms. (Caught a self-connection bug where my `replace_all` hit the destination-bound line — silent audio for one commit. Fixed.)
- **Capture celebration scaled to 3 tiers** in `stoneAnimations.ts` via `tierFor(count)`: small (1–2), medium (3–6), hero (7+). Each tier configures duration, flash on/off, flash color, shockwave count (0/1/2), shockwave scale and alpha, particle speed.
- **Connection pulse** fires when a move merges 2+ separate same-color groups. New `Board.detectMergedGroups` runs before `tryPlay`; result lands in `gameStore.lastMerged` and `GoBoard.tsx` fires the animation. v1 was too subtle ("you might want to make it flare more"); v2 has an impact halo plus two staggered expanding rings.
- **Live score graph** in the right sidebar — KataGo-backed (`SCORE_ESTIMATE_VISITS = 30` in `state.py`), point-margin from Black's perspective, decoupled from bot strength so all bots produce comparable values. `play_move` is now async to await the eval; ~50–150ms per move on Mac Metal. Toggleable in Settings → off by default. Header shows "Score (You − Seedling)" with player names; leader chip shows a stone icon for the side that's leading.

### Two real bugs in the score graph
- **Sign flipped every move.** Empirical testing showed `rootInfo.scoreLead` from KataGo's analysis engine is always Black-perspective regardless of `initialPlayer` (despite docs implying side-to-move). My flip-when-white-to-move was making the displayed lead swing B+20 → W+20 → B+20 with the same underlying position. Fixed by removing the flip.
- **Score reset to ~0 after a pass.** Pass branches called `appendScorePoint()` which uses the local `scoreTerritory()` flood-fill — useless mid-game. Fix: backend `AIMoveResponse` for pass branches now includes the carried-over `game.score_lead` (board unchanged on pass, so the prior estimate is valid). Frontend pass branches read that instead of recomputing.
- **Final point matches tally.** When the game ends, push `result.black_score - result.white_score` as the last data point so the line ends at the rules-based final number, not the pre-scoring KataGo estimate that's offset by dead-stone cleanup.

### Polish
- "You wins by N" → "**You win** by N"; third-person ("Black wins") kept.
- Final tally now shows "= 67 total" alongside each side's territory + captures + komi breakdown.
- Komi chip was overflowing on the white row → `flex-wrap: wrap` on `.score-values`.
- Greyed-out / not-tuned rank labels in the New Game picker on smaller boards.
- Backend `logging.basicConfig(INFO)` so `logger.info` / `logger.warning` in `app.*` modules surface in uvicorn output (was invisible before, masking diagnostic logs).

### Deferred
- **Two-eye shimmer** — needs eye geometry + per-game dedup so it doesn't refire each move. Punted.
- **Named tactical callouts** (ladder / snapback / seki / net / throw-in) — folds into feature 04 (AI teacher) where the tactical detector belongs.
- **Ambient sound bed** — open question on sourcing/licensing.

### Hosting plan finalized in [09_publishing.md](feature_plans/09_publishing.md)
CPU VPS for bots (~$15/mo) + on-demand GPU pod for reviews (warm-pool-of-one pattern). Beta budget ceiling $100/mo, expected $25–60/mo.

### Status of feature plans after this session
- 13 (Smaller boards): ✅ Done
- 12 (Animations & sound): 🧪 Beta — first cut shipped

---

## Session 7 — April 23-24, 2026

### Two code-level fixes that apply to every bot rank

**Universal pass-preference fix.** Previously we only passed when KataGo's #1 was literally pass. That let KataGo's shallow-visit ties ("fill 0-point dame" vs "pass" both 0) leak the fill option into the candidate pool, where the mistake mechanism could pick a *slightly worse than pass* move (fill own liberty). Now we also pass whenever KataGo lists pass with score ≥ 0.3pts below the top move, and we filter out any candidates worse than pass from the mistake pool. Tuned the threshold to 0.3 (not 0.5) so we still play real half-point endgame moves that show up as ~0.4 in shallow search.

**Universal clarity gate.** In tactically clear positions, mistake injection is catastrophic — there's no such thing as a "moderately bad" move in a life/death fight. Before running the mistake mechanism, we now check two "is this position obvious?" signals: (a) KataGo's top candidate has policy prior ≥ 0.5, or (b) its score_lead is ≥ 5 points ahead of #2. Either triggers "just play the top move." This surgically handles the user-reported case where 6k was letting dead groups live because the mistake mechanism overrode the obvious kill.

Both fixes apply to every rank automatically, so they retroactively cleaned up some behavior at weaker ranks too.

### 6k calibration iterations

| Ver | Change | Result |
|-----|--------|--------|
| v4 | visits 95→150, mistake=0.32, max=11 | 25% match rate (best we've had), but playtest: "a bit stronger than 6k, mistakes feel drastic" |
| v5 | visits 120, mistake=0.22, max=9 | Shipped. Rely on natural tactical shallowness for imperfection; fewer artificial mistakes. Not bot-vs-bot tested at this profile. |

v5 is the current ship state but explicitly flagged as "best Phase 1 approximation" — it's not going to feel like a real 6k until Phase 2 lands.

### 9k calibration — abandoned strengthening, returned to v1

Tried three 9k revisions (v2 visits=120, v3 visits=140, v4 widened deltas) to close the gap against 6k v4 after 6k got its fixes. All lost 88-100% to 6k.

Root cause: the universal clarity gate flattens "clear" positions for *both* bots, so all rank gap has to come from "unclear" positions. Between a 6k at 150 visits and a 9k at 140 visits, unclear positions get played nearly identically — no 3-rank gap to be had.

v5 rolls back to v1 parameters (visits=80 + mistake=0.25 + max=10). The universal fixes already address the egregious "obvious one-move blunder" case that was the real playtest issue. What v1's visits=80 still does — and what we want — is misread mid-tactical positions that 6k at deeper visits handles. That's the 3-rank gap expressed as tactical depth.

### Final numbers for the two bots

| Test | 6k v5 | 9k v5 | Notes |
|------|-------|-------|-------|
| Even (stronger wins) | not re-tested | 88% (14/16 vs 6k v4) | 6k v4 data — v5 is softer |
| H3 balance | — | 9k+3 wins 88% vs 6k v4 | Overcompensates |
| Match rate exact | 25% (v4 data) | 20.4% | Both match real Fox distributions |
| Match rate close (≤2) | 38% (v4 data) | 33% | Close to 15k baseline |
| Match rate same-area | 50% (v4 data) | 49% | Close to 15k baseline |

Both bots pass the **match-rate** bar against real Fox data. The bot-vs-bot handicap math is off — our universal safety fixes make both bots more robust than the real humans at their nominal ranks, so 3 handicap stones are worth more than the 3-rank gap would predict.

### Flagged as known refinement area

Our mistake mechanism controls *how much* each error costs but not *what kind* of error it is. Real kyu players make specific types of mistakes (wrong direction, missed big point, overconcentration). Our bot picks random moves weighted by point-loss magnitude, which feels "artificial" in playtest. There's no Phase 1 lever that produces correct rank strength *and* human-feeling errors. Phase 2 (rank-conditioned NN trained on human games) is the path that resolves this.

This limitation is now documented in AI_CALIBRATION.md under "Future Work → Known refinement area — natural-feeling mistakes."

### Files touched
- `backend/app/ai/move_selector.py` — universal pass fix + clarity gate, 6k v5, 9k v5.
- `AI_CALIBRATION.md` — 6k v5 section, 9k v5 section, "Known refinement area" note.
- `feature_plans/01_bot_ladder.md` — progress.

---

## Session 6 — April 23, 2026 (evening)

### 6k "Ember" bot calibrated

**Final v2 numbers:**
- Even vs 9k: **81% (13/16)** — same clean 75-80% signal 9k gave us.
- 9k + 3 handicap vs 6k: **50% (4/8)** — textbook handicap balance again.
- Match rate vs 120 positions from 20 real 6k Fox games: 18.5% exact, 30% close, 45% same-area, 49% same-quadrant. Endgame exact 23%.

### Key lesson learned this session

**Don't assume the jump between validated ranks matches the jump between old interpolated ranks.**

The old 8k profile (visits=120, mistake=0.18, loss=6, policy=0.60) was way too strong for the new 6k slot — even-game win rate vs 9k was 88%, and handicap didn't balance *at all* (still 88% in favor of 6k with 9k given 3 stones). That's more like 4k/5k strength.

The underlying issue: when I renamed 8k → 6k yesterday I implicitly assumed "the old 10k/8k gap = the new 9k/6k gap." But 10k → 8k was 2 rank labels on a 3-rank-strength jump. Relabeling without retuning preserved the outsized strength jump.

**v2 recipe:** small nudges off 9k's profile instead of wholesale replacement.
- `max_point_loss`: 10 → 9 (small)
- `mistake_freq`: 0.25 → 0.23 (small)
- `policy_weight`: 0.50 → 0.52 (small)
- `randomness`: 0.40 → 0.37 (small)
- `visits`: 80 → 95 (moderate)
- `opening_moves`: 20 → 18 (small)

That produced a bot that's meaningfully but not crushingly stronger than 9k.

### Carry-forward for 3k and 1d

Keep the same "small deltas" recipe. The old 5k profile (max_loss=4, mistake=0.10, visits=200) is probably still too strong for the new 3k slot by the same logic. Start from 6k v2 and nudge, don't copy the old 5k wholesale. Same story for 1d vs the old 3k profile.

### Process notes

- Variance was high early. First even-game batch hit 62% (below target), second batch hit 100% — combined 16-game sample = 81%. 8-game batches are too small to trust in isolation at this rank level; always run 16 when the first batch looks off-target.
- Per-game time is longer at this strength (~100s/game for 6k vs 9k with visits=95). Budget ~15 min per 8-game batch.

### Files touched
- `backend/app/ai/move_selector.py` — 6k v2 profile with calibration notes.
- `frontend/src/components/Avatar.tsx` + `NewGameDialog.tsx` — 6k `validated: true`.
- `AI_CALIBRATION.md` — full 6k section, v1/v2 history, phase tables.
- `feature_plans/01_bot_ladder.md` — progress updated.
- `.gitignore` — added `data/6k/`.

Data: 296,465 real 6k Fox games downloaded to `data/6k/` (gitignored).

---

## Session 5 — April 23, 2026 (afternoon)

### 9k "Boulder" bot validated without tuning

Shipped the 9k profile at its inherited parameters (previously the old 10k slot). No iterations needed.

**Numbers:**
- Even vs 12k: **81% (13/16 games)** — right at the upper edge of the 75-80% target band. First 8-game batch came in at 88% (variance), second batch at 75%, combined gives the clean signal.
- 12k + 3 handicap vs 9k: **50% exactly (4/8)** — textbook handicap balance. This is the first time we've hit the clean handicap theory target.
- Match rate vs 114 positions from 20 real 9k Fox games: 20% exact, 31% close (≤2), 47% same-area (≤5), 54% same-quadrant. Opening exact 29% — actually better than the 15k baseline.

### Why it worked first try

The old 10k profile had `policy_weight=0.50` and `randomness=0.40` — already following the "v4 lesson" from 12k calibration (tight KataGo policy, low chaos). When I relabeled it to 9k yesterday, I got lucky — the bot was already tuned in the right direction.

Handicap theory for bots worked cleanly here in a way it didn't for 12k-vs-15k. Plausible reason: 15k's code picks from KataGo's top 3 moves even in the opening, so handicap stars feel "free" to it. 12k's profile is more mistake-prone, so handicap stones actually compensate as theory predicts.

### Carry-forward for remaining bots

Keep the v4 formula for 6k, 3k, 1d: `policy_weight ≥ 0.50`, `randomness ≤ 0.40`, moderate `mistake_freq`, bell-curve point-loss. Resist the urge to "add more chaos" for weaker handicap balance — 9k just proved the formula works cleanly on its own.

### Files touched
- `backend/app/ai/move_selector.py` — added calibration notes to the 9k profile comment.
- `frontend/src/components/Avatar.tsx` — flipped 9k `validated` to `true`.
- `frontend/src/components/NewGameDialog.tsx` — same flip for the picker dropdown.
- `AI_CALIBRATION.md` — full 9k section with tables and the "why it worked first try" note.
- `feature_plans/01_bot_ladder.md` — progress updated.
- `.gitignore` — added `data/9k/`.

Data: downloaded 291,525 games to `data/9k/` (gitignored, 60MB .7z).

---

## Session 4 — April 23, 2026

### Rebalanced bot ladder to a uniform 3-rank step

Renamed the top four bots so the ladder steps evenly by 3 ranks all the way up:
- Boulder: 10k → **9k**
- Ember: 8k → **6k**
- Storm: 5k → **3k**
- Void: 3k → **1d**

Full ladder: 30k → 18k → 15k → 12k → 9k → 6k → 3k → 1d. Profile parameters were carried over as-is; these four have never been validated at any label, so they need real calibration at their new labels. 15k and 12k keep their slots unchanged.

### Bot picker: grey out the uncalibrated bots

Added a `validated` flag to `BOT_AVATARS` (true for 30k, 18k, 15k, 12k; false for the rest). In the new-game dialog, unvalidated ranks render as disabled options with "coming soon" suffix. On the homepage roster they're dimmed (opacity 0.4) with a grayscale filter and a small "Soon" badge. Nothing blocks direct API calls to those ranks — they still work if invoked — but the UI steers players toward the calibrated set.

### Files touched
- `backend/app/ai/move_selector.py` — renamed profile dict keys; added a comment noting the rename date.
- `frontend/src/components/Avatar.tsx` — added `validated` to `BOT_AVATARS`.
- `frontend/src/components/NewGameDialog.tsx` — reworked `RANK_OPTIONS` and extracted a `rankOption` renderer that disables unvalidated entries.
- `frontend/src/components/HomePage.tsx` and `HomePage.css` — dim/locked styling + "Soon" badge.
- `AI_CALIBRATION.md`, `feature_plans/01_bot_ladder.md` — doc updates.

---

## Session 3 — April 22, 2026 (afternoon)

### Calibrated 12k "Stream" bot

First validated bot in the 12k→3k ladder. Went through four profile iterations.

**Final v4 numbers:**
- Even vs 15k: **75%** win rate (8 games) — in the 70-80% target band for a 3-rank gap.
- 15k + 3 handicap vs 12k: **62%** for 12k (8 games) — a bit above the 50% theoretical target.
- Match rate vs 151,844 real 12k Fox games (112 positions): 15% exact / 25% close / **43% same-area** / 53% same-quadrant.
- Midgame exact match: **20%** — essentially matching 15k's 21% baseline.

### Observation to carry forward

**The 12k bot is slightly strong at 3-stone handicap vs 15k (62% win rate instead of the theoretical 50%), but not by a huge margin.** Two plausible reasons:
1. 15k's opening code already picks from KataGo's top 3 moves, so the "free" handicap stones on star points aren't worth as much as they'd be against a real human 15k who plays less sensibly.
2. Bot handicap theory ("1 stone ≈ 1 rank") doesn't hold tightly because bot mistakes and human mistakes don't mirror each other.

Not worth further tuning right now — fixing H3 exactly requires either making 12k weaker (which drops its even-game win rate and hurts match rate) or making 15k's handicap play more exploitative (a separate change affecting that bot's identity). Revisit if we get human playtester feedback that 12k feels too hard at H3.

### Key tuning lesson (applicable to future ranks)

**Pure randomness hurts match rate more than it hurts win rate.** v2 cranked `randomness` (0.54) and `random_move_chance` (0.04) to nudge H3 toward 50/50, but the result was a midgame match rate of 12% — the bot was making chaotic moves no real 12k would play. v4 reversed this: lowered pure noise, raised `policy_weight` (0.36→0.42), and the bell-curve "moderately-bad-move" mechanism alone handled the human-error side. Midgame match rate jumped to 20% and win rates actually stayed on-target.

### Tooling changes this session

- Rewrote `data/bot_vs_bot.py` to use the backend's native bot-vs-bot support (single game with `black_rank`/`white_rank`, server-side handicap). Old version re-created a game and replayed every move before each AI move — O(N²) and handicap was broken for ≥2 stones. New version is ~10× faster.
- Bumped `bot_vs_bot.py` default `--max-moves` from 400 to 600. At this rank pair with lower randomness, games sometimes run past 400 naturally.
- Downloaded `data/12k/` Fox dataset (151,844 games, 30MB .7z).
- Updated `AI_CALIBRATION.md` with full v1→v4 history, match-rate data, and the lesson above.

### What's next on the bot ladder

10k, 8k, 5k, 3k, 1k, 1d still need validation. Apply the v4 lesson: prefer higher `policy_weight` + `mistake_freq` over `randomness`. Download matching Fox data for each (18k and 12k are done; 10k through 1d available on featurecat/go-dataset).

---

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
- [x] **Connection pulse animation** — wired to group-merge detection (Session 8)
- [ ] **Milestone stickers** — "First Capture!", "First Win!", "10 Games Played!" — the reward loop for kids
- [ ] **Rules refresher** — short interactive tutorial (capture, ko, two eyes, scoring) for returning adults
- [ ] **Ladder/snapback/seki callouts** — detect special moves geometrically, show a named callout the first few times (folded into feature 04, the AI teacher, which shares the tactical detector)
- [ ] **Validate 12k–3k bots** — run bot-vs-bot and test_bot_vs_real for each rank pair, download Fox data for each

### Low Priority
- [x] **Zen mode toggle** — Settings → "Animation & sound density" Full/Zen, scales theme intensity and master gain (Session 8)
- [ ] **Unlockable cosmetics** — board styles, stone styles, sound packs earned through play
- [ ] **Daily streak** — gentle play streak, no FOMO mechanics
- [ ] **Mistake tracking across games** — "you keep making this mistake" teacher pattern
- [ ] **Trophy shelf** — milestone collection the kid can show parents

---

## V2 Roadmap (from design doc)

- **Kid-first onboarding** — full age-7 tutorial, rules teaching, guided first game
- ~~**9x9 and 13x13 boards**~~ — shipped early (Session 8). 30k / 15k / 6k tunings per size; 18k / 12k / 9k / 3k / 1d marked "not tuned" on small boards
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
