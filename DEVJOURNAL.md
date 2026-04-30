# Development Journal

## Session 11 — April 28-29, 2026

Shipped the beta hosting end-to-end. App is live on Render at
`https://goforkids-web.onrender.com` with the API at `goforkids-api.onrender.com`,
gated by a shared password. Most of the session was a debug-driven walk
through the gap between "works locally" and "works in a Linux container
behind a CDN with a disk-mounted DB and multiple workers."

### Hosting blueprint
- `render.yaml` defines two services: a Vite static site + a FastAPI Web
  Service running our Dockerfile. Frontend has SPA-rewrite + security
  headers; backend mounts a 1 GB persistent disk at `/data` for SQLite.
- Backend Dockerfile (`backend/Dockerfile`) two-stage: builder downloads
  the KataGo v1.16.0 Eigen Linux x64 release, runtime stage is python:slim
  with libgomp1, the extracted KataGo binary, the b20 model + analysis
  config (both committed at `backend/{models,configs}/`), and the app code.
- Frontend reads `VITE_API_BASE_URL`; backend reads `CORS_ALLOWED_ORIGINS`,
  `GOFORKIDS_DB`, `KATAGO_*`. All env-driven so local dev is unchanged.
- Resource size lives in the Render dashboard slider, not the blueprint.
  Currently on Pro tier (2 dedicated vCPU + 4 GB).

### Beta-readiness frontend additions
- `AccessGate` wraps `<App/>`, gates on `VITE_BETA_PASSWORD` with
  localStorage persistence. Unset = no gate (local dev).
- `FeedbackButton` (fixed bottom-left) opens `VITE_FEEDBACK_URL` with a
  `{context}` placeholder filled at click time (current gameId, rank,
  page URL). Unset = button hidden. Works as `mailto:` or GitHub-issue URL.
- `PrivacyTermsModal` triggered from a footer link on the homepage.
  Minimal one-pager.

### Five bugs surfaced and fixed during deploy
Each one taught us something about the local-vs-deployed gap.

**1. Build was failing on accumulated TS errors.** Vite dev mode skips
typecheck so they piled up unseen. Added a `Stone = Color.Black | Color.White`
type alias to fix the most-common offender (`Board.tryPlay`'s captures map
indexed by `Color`). Fixed unused-import warnings across the touched files
during the recent learn-lesson work.

**2. KataGo binary "fuse: device not found, try 'modprobe fuse' first".**
The KataGo Eigen Linux x64 release is shipped as an AppImage that needs
FUSE to self-mount, and Render's container runtime doesn't expose FUSE.
Fix: run `./katago --appimage-extract` (which doesn't need FUSE itself)
in the builder stage and invoke `squashfs-root/AppRun` in runtime.

**3. KataGo deadlocked after ~10-20 moves.** Subprocess.Popen used
`stderr=PIPE` with no consumer task. KataGo writes verbose search
progress to stderr, the 64 KB OS pipe buffer fills after a handful of
queries, KataGo blocks on the next stderr write and stops processing
stdin queries. Looks exactly like a process crash but is just a pipe
deadlock. Fix: `stderr=DEVNULL`. Local Mac Metal is quieter on stderr
and games are shorter, so it never surfaced there.

**4. Game state randomly returned 404 on a freshly-created gameId.**
Same game would `FOUND, FOUND, NOT_FOUND, FOUND, FOUND` across 5
sequential GETs in 600 ms. Root cause: Render's container runtime
spawns multiple worker processes per container even on a "1 instance"
plan with a disk attached, and each worker had its own in-memory
`GameManager.games` dict. Fix: persist active games to a new
`active_games` SQLite table on the disk-mounted volume. `GameManager`
now `_load`s + `_save`s every operation through pickle blobs in the
table — the in-memory dict became a hint, not source of truth.

**5. "Bot passes on turn 1."** First chased it as a KataGo Eigen vs
Metal numerical-difference theory and a low-visit-budget theory. After
two speculative pushes, took a step back and added diagnostic logging
that dumped KataGo's full candidate list during the opening. The next
log line told the story instantly: `OPENING analysis (stone_count=0,
profile_visits=4): 1 candidates: (4,4 v=3 pri=0.808 ...)`. The board
was *empty* when the AI was asked to move — KataGo correctly returned
a real move, but our gameStore was firing `api.playMove()` and
`requestAIMove()` in parallel via `setTimeout`. The active-games
persistence layer (#4 above) exposed a race that in-memory state had
been masking: `/ai-move` could read the game from DB before `/move`
committed. Fix: chain `requestAIMove()` inside the `api.playMove().then()`
and `api.pass().then()` callbacks. The 400 ms breathing-room delay is
preserved inside the chain.

### Other improvements landed
- **"Calculating final score" modal.** KataGo ownership analysis takes
  ~10 s on 2 CPU. Before the modal, the UI flashed a wrong score (raw
  territory count without dead stones removed) for 10 s before snapping
  to the real result. New `ScoringInProgressModal` driven by a
  `scoringInProgress` flag in gameStore — set on user's second pass,
  cleared when the api.pass response arrives.
- **Pass-detection guard hardening (mostly unused, kept for safety).**
  Bumped `min_pass_visits` floor from 2 → 4 in the gap-based detection
  for low-visit profiles. The actual root cause of perceived passes
  turned out to be the race condition above, not pass detection.
- **Render perf tuning.** `KATAGO_THREADS=2`, `KATAGO_SCORE_VISITS=10`,
  `KATAGO_OWNERSHIP_VISITS=100` baked into the Dockerfile ENV, all
  overridable via dashboard.

### Local Docker mirror for future debugging
`docker-compose.yml` + `Makefile` at repo root build the deployed image
locally with `--platform linux/amd64`. Apple Silicon hosts get the same
Linux Eigen binary under QEMU emulation — slow, but numerically identical
to Render. Run `make up` + `make native-frontend` to mirror the deploy
locally and iterate without push cycles. Catches the class of bugs that
only show up on the deployed Linux Eigen / multi-worker / DB-backed
stack.

### Lesson worth keeping
Stop pushing speculative fixes. Two of this session's bugs (KataGo
deadlock, turn-1 pass) ate multiple deploy cycles before I added
diagnostic logging that revealed the actual cause in one round-trip.
"Add observation, then fix" beats "guess, push, observe, guess again"
every time the deploy is more than ~30 sec.

### Status of feature plans after this session
- 09 (Publishing online): 🟢 Beta — app is live, gated, instrumented;
  custom domain + KataGo CPU calibration + Sentry/analytics deferred

### Deferred to next session
- Custom domain registration
- Sentry error reporting + Plausible analytics
- Rate limits on KataGo + Claude calls per session/day
- Verify KataGo bot calibration still feels right on the deployed
  Linux Eigen build (specifically 6k and stronger; weaker ranks
  validated through play this session)
- KataGo "warm pool" GPU pod for review/study mode (separate from the
  always-on bot service)

---

## Session 10 — April 26, 2026

Added the next chunk of Learn-to-Play lessons (6, 7, 10) and the curriculum-continuation flow so the player can keep going after a game-kind lesson finishes. Lessons 8 (multiple-choice quiz) and 9 (territory counting) still deferred — they need new lesson mechanics that warrant a design pass first.

### New lessons
- **Lesson 6 — Who Gets Trapped?** Real shared-liberty capture race on 5×5: black at (1,2) and white at (3,2) both in atari with the same liberty (2,2). Black to move; (2,2) saves *and* captures. Validator is the existing `capturedCount >= 1`. Teaches "the player to move first wins the race."
- **Lesson 7 — Safe Eyes.** White rabbity-six shape with eyes at (1,1) and (1,3). Player tries to capture by clicking inside an eye and discovers it's suicide. New `validateIllegal?: (args) => LessonVerdict` hook on `Lesson` lets a lesson treat *illegal* moves as its success condition; in `learnStore.tryMove` we now run `validateIllegal` before the generic denied-flash treatment, and the success path doesn't try to commit the (illegal) stone — just bumps successSeq + transitions to `success` status.
- **Lesson 10 — Big Board Time.** `kind: 'game'` lesson, 9×9 vs the same friendly 30k bot. Reuses the Mission / What stuff means card. Added `gameConfig.preGameHeadline` + `gameConfig.preGameSubline` to the schema so each game lesson can have custom copy ("Big Board Time!" + "Same rules, bigger battlefield. Aim for the corners — they're easiest to live in.") without forking the card component.

Spec lessons 8 (Alive or Gone? — multi-board quiz) and 9 (Count Your Land — territory tally) skipped this session; they need a quiz lesson type and a count-by-clicking interaction respectively.

### Curriculum continuation after game-kind lessons
Previously, lesson 5 (the kind:'game' first-battle) effectively ended the curriculum: the user got dropped into the regular game UI and the only ways out were Move on (→ home) or Play again. With more lessons living past lesson 5, that was a wall. Now:

- New `learnStore.resumeAt(index)` action — re-enters the lesson view at a specific lesson without clearing progress (in contrast to `start()` which always resets to lesson 1).
- `LessonGameEndModal` accepts an optional `onNextLesson` prop and renders a third **Next lesson →** button (primary blue) when provided.
- `App.tsx` tracks `activeGameLessonId` for whichever lesson kicked off the current game, computes `nextLessonAfterGame` (or null if last), and threads `handleNextLessonAfterGame` through to the modal only when there's actually a next lesson. So lesson 5's game-end modal shows three buttons; lesson 10's shows two.

### Reward overlay scoping
The Cosmic Board overlay's trigger used to be "next lesson is `kind: 'game'` AND all puzzles complete." With lessons 6 and 7 added, "all puzzles complete" would have meant lessons 1–7 done and the overlay would only fire before lesson 10 — wrong. Tightened the check to "next lesson id is specifically `first-battle` AND lessons 1–4 are complete," which restores the original intent (reward fires between lesson 4 and 5 only). Renamed `allPuzzlesComplete` → `firstBatchComplete` and `PUZZLE_LESSON_IDS` → `FIRST_BATCH_PUZZLE_IDS` for clarity.

### Status of feature plans after this session
- 04 (Learn to Play): 🟡 In progress — 7 of 10 lessons shipped; lessons 8 (quiz) and 9 (territory counting) still pending design

### Deferred to next session
- Lesson 8 mechanics: multiple-choice "tap to answer" lesson type. Spec wants 3 mini-boards on one screen with Safe / Gone buttons.
- Lesson 9 mechanics: territory-counting interaction. Idea: render a finished position with territory glow, ask the user to count a side's spots by tapping each one, validate the count.
- Per-lesson stars (1–3 based on first-try / fast-solve / no-hint) and XP system from `intro.md`. We currently track only completion booleans.
- Persisted progress (still resets each "Learn to Play" tap by design until user accounts ship)
- Lesson 10 currently uses standard 9×9 komi (7) — first-time-player should maybe play with komi=0 for a confidence boost, similar to lesson 5's setup. Defer until we see real playthroughs.

---

## Session 9 — April 25-26, 2026

Built the Learn-to-Play onboarding flow end-to-end. First five lessons land; the back half (eyes, life/death, count-the-territory, 9×9 transition) lives in `intro.md` for the next session.

### Lesson engine architecture
Config-driven: each lesson is a plain object in `frontend/src/learn/lessons.ts` with board setup, validator, copy, and optional knobs (`secondTurn`, `afterSuccess`, `interimSuccessMessage`, `defaultShowHint`, `kind: 'puzzle' | 'game'`, `gameConfig`). New `frontend/src/learn/lessons.ts` schema + `frontend/src/store/learnStore.ts` Zustand store track lesson state; `frontend/src/components/LearnView.tsx` renders the shell. The existing `GoBoard.tsx` learns a third source (in addition to live game + replay) — when `learnActive`, it reads grid/highlights/clicks from the lesson store. New `frontend/src/board/geometry.ts` is the single source of board geometry (padding scales with size so 5×5 stones don't clip the edge).

### Lessons 1–5
1. **Drop Your First Stone** — empty 5×5 with pulsing gold highlight at center. Tap → black stone places, white auto-places, then user gets a *second* turn (anywhere empty) to feel the back-and-forth cadence. Two distinct celebrations: first stone gets "You're playing Go!", second stone gets "Keep going!" with the turn-by-turn rule.
2. **Trap One Stone** — single white in atari, fill the last liberty.
3. **Big Capture** — two white stones sharing one liberty; capture both at once.
4. **Save Your Team** — multi-step rescue with a chasing opponent. Black is in atari; user extends, then white auto-places to chase ("local-bias" anchoring), and user must extend again to truly escape. Validator checks the threatened group still exists + has ≥2 liberties post-rescue.
5. **First Battle** — `kind: 'game'` lesson. Pre-game card with Mission ⚫⚪⭐ + "What stuff means" 📈🤖🏁 bullets. Click "Let's Go!" → exits learn mode, calls `gameStore.newGame({ boardSize: 5, targetRank: '30k', lessonContext: true })`. New `RANK_PROFILES_5["30k"]` profile + `SUPPORTED_SIZES = (5, 9, 13, 19)` in `state.py`. Komi=0 on 5×5 so Black's first-move advantage feels real.

### Modal-based step UX (replaced auto-advance)
Every lesson step completion now shows a `LessonStepModal` (green headline + explanation + Continue button) over the board. Removed all auto-advance timers. Continue during `animating` calls `skipAfterSuccess()` to fire the queued auto-place; Continue during `success` calls `next()`. This eliminated a class of race-condition bugs where stale timers fired after the user manually advanced (e.g. queued auto-advance fired after dismissing the reward overlay, kicking the user out of learn mode entirely).

### Animations + visual feedback
- **Success ring** — golden burst at the placed stone on correct moves (`createSuccessRingAnimation` in `stoneAnimations.ts`)
- **Denied flash** — red ring pulses around the existing stone when the user tries to "move" a stone (clicks an occupied intersection). Direct RAF loop instead of going through `AnimationManager` to dodge a closure-staleness issue. Reinforces "stones can't be moved, only placed"
- **Hover ghost** is now color-aware (white translucent for lesson 4 where the user plays White — never mind, we ended up swapping lesson 4 to user-as-Black for consistency, but the hoverColor parameter remains)
- **Pulsing highlight** on lessons that opt in via `defaultShowHint` (lesson 1 only) — gold ring glows on the target intersection
- **Confirmed real-browser-only**: discovered that the preview tool's hidden tab (`document.hidden=true`) throttles `requestAnimationFrame` to zero, so animations don't render in test screenshots even though they work for real users. Verified via pixel-sampling between frames — the *static* draws verify, the *animation* in-betweens require an actual browser tab

### Reward + game-end modals
- **Cosmic Board Unlocked** reward overlay fires once after all four puzzles complete. Twinkling cosmic stars background, golden star badge, gradient text. Theme is forced to classic for the duration of the lessons and switched to cosmic on the lesson 5 launch so the unlock feels like a transformation
- **Bot-passed modal** explains "the bot thinks the game is over" with **Keep playing** / **Pass & end game** buttons. Triggered when the AI returns a pass mid-game and the game phase is still `playing`
- **Lesson game-end modal** — kid-friendly score breakdown ("N spots surrounded + M captures") with a side-by-side scoreboard, gold-gradient "You won!" title, **Move on** / **Play again** buttons. Modal can be dismissed (× button or backdrop click) and collapsed to a compact "See results" panel in the right side panel

### Backend tuning
- **5×5 30k bot profile** new in `RANK_PROFILES_5`. Two rounds of dial-tuning landed on a midpoint between the 9×9 fallback and a "very weak" extreme: `mistake_freq: 0.74`, `local_bias: 0.87`, `visits: 4`, `pass_threshold: 0.05` (very tight — bot won't pass while real points remain)
- **Pass-flow race fix** in `gameStore.pass()`. Previous code fired `api.pass()` as fire-and-forget then called `api.getGame()` in parallel, racing the backend; sometimes `getGame` saw the pre-pass board and missed dead stones in the score. Collapsed to a single chained `api.pass(gameId).then(...)` since the pass response already includes the scored board

### UX polish landed this session
- Reset learn progress + theme to classic on every "Learn to Play" tap (testing convenience until user accounts ship)
- Whole lesson view fits the viewport via CSS grid + container queries; board scales to remaining space, no scrollbar
- Lesson title prominent in the nav (3-col grid: Home button | centered title | progress dots)
- Settings gear hidden during lessons (returns for real games)
- Bottom feedback contrast bumped from `text-muted` to `text-secondary`
- Lesson 4 user-color flipped to Black for consistency across all lessons

### Status of feature plans after this session
- 04 (Learn to Play): 🟡 In progress — first 5 of 10 lessons shipped; lessons 6–10 pending

### Deferred to next session
- Lesson 6: Capture race / who-gets-trapped puzzle
- Lesson 7: Safe Eyes
- Lesson 8: Alive or Gone? (mini puzzle streak)
- Lesson 9: Count Your Land (territory scoring)
- Lesson 10: Big Board Time (9×9 transition)
- Reward / star system from `intro.md` — currently only the Cosmic Board unlock fires; per-lesson stars and XP not yet wired
- Persisted progress (no user accounts yet — currently resets every session by design)

---

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
