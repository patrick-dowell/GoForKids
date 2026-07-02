# Development Journal

## Session 30 — July 1–2, 2026 (quiz wrong-answer retry — the 7yo-playtest dead-end, fp 03 §D)

**Addendum (07-02) — big-iPad portrait replay: side-by-side panel VETOED.**
Patrick on his 13" Pro: putting the replay controls beside the board (S29
addendum fix) shrank the board to ~676px — too small for 19×19 review. The
board is the point; the panel serves it. Reverted to the stacked layout for
ALL portrait ≤1099px: strip hidden + compact panel + board height-bound to
`100dvh - 530px` → **846px board** on the 13" (bigger than the side-by-side
gave!), controls fully visible underneath, no scrolling. Design principle to
remember: on portrait iPads the vertical budget beats a side column — never
trade board size for panel placement. Suite still green (8 tests).

Patrick flagged it as the top-priority bug: the wrong-answer dead-end from the
2026-06-27 playtest was still unfixed. Confirmed, then shipped the agreed fix.

**What the code did (the frustration, precisely):** a wrong quiz answer showed
the question's `failMessage` — which literally says *"Look again…"* /
*"Count again…"* — while the only button was **"Next question →"**. The kid
was invited to look again and marched forward anyway; the question was burned.
Worse: wrong on the LAST question showed "See results →" and **completed the
lesson anyway**. (Board-move lessons already had a `retry` status; only the
`quiz` kind dead-ended.)

**The fix (learnStore + LessonStepModal):**
- Wrong answer → hint + **Try again** re-opens the SAME question
  (`retryQuiz`; the board never changed on a wrong answer, so clearing the
  feedback modal is sufficient). No path advances past an unanswered question
  anymore — completion only ever happens through a correct answer.
- Scoring is **first-try only** (`quizMissedCurrent` flag; killMove branch
  included), and the results line adapts: perfect → "You got 3 of 3 right!",
  otherwise → "You got 2 of 3 on the first try — and figured out the rest!"
- Fallback failMessage rewritten for retry ("take another look and try
  again!"); the real failMessages were already written as corrective hints.

Verified in-browser end-to-end (lesson 9 "Two Eyes 3": wrong → hint →
Try again → same question → correct → doesn't score → advance → finish →
first-try phrasing). 5 new store tests (`learnStore.quizRetry.test.ts`,
SoundManager mocked for node); 170 total, build green. Milestone §1
wrong-answer item + fp 03 §D marked shipped.

Still open from the same playtest cluster: the depth-appreciation arc (fp 30)
and the learn-to-play-go.github.io content borrows (fp 03).

## Session 29 — July 1, 2026 (responsive sweep: 5 cut-off bugs, incl. Roland's iPad-landscape board)

**Addendum 2 — LAYOUT POLICY adopted (Patrick): scrolling in exactly two
places — Profile and the Library list. Everything else fits, period.**
Recorded in designdoc.md Resolved Decisions; enforced by the suite (STRICT
probes by default, REACHABLE only for the two sanctioned screens). Applying
it meant making replay actually FIT on all 14 viewports instead of leaning
on scroll:
- **Compact replay panel** wherever height is tight (≤1099px, or wide+short):
  tighter gaps/padding, hint line dropped, narrative clamped to 3 lines
  (2 on phone landscape — known trade-off: a clamped note can hide its
  "Learn: <concept>" link on narrow panels), and the S17-era 122px
  scroll-clearance padding-bottom removed (dead weight when nothing scrolls).
- **Player-card strip hidden in replay under 1000px width** (and wide+short):
  the panel header carries the matchup; the vertical space is what lets
  board + full controls coexist. 12.9"/13" keep the cards.
- **Stacked portrait replay** boards height-bind to `100dvh - 530px`;
  phone-landscape replay drops the meta/result lines and fits the panel
  beside the height-bound board.
- **Bug found by eyeball, not probe:** a leftover 700–999px-landscape board
  rule distorted the canvas on phones (width-capped while height stayed
  100%) — every visibility probe passed. Removed the rule (no iPad is that
  narrow in landscape) and added a **squareness assertion** (`square:` probe,
  |w−h| ≤ 2px) to the suite so distortion is now machine-checked too.
- **Choose-avatar + ranked picker, phone landscape:** compacted to fit
  outright (single-row avatar grid; horizontal bot row with 56px avatar).
- Suite grew profile + library tests (the sanctioned scrollers, explicit
  scroll containers required) — 8 tests, ~20s, all green; build green,
  165 unit tests.

**Addendum (same evening) — Patrick's 13" iPad Pro found bug #6 + a probe
blind spot.** Replay portrait on the 13" Pro (1032×1376 — NOT the same as
the 12.9's 1024×1366, and not in the original matrix) showed the replay
panel cut off. Dimensionally the panel just tails past the fold and *desktop*
body-scroll reaches it — which is exactly why the suite passed: the probe
counted body scroll as "reachable," but **WKWebView body scrolling is
unreliable** (the S17 profile-scroll lesson, re-learned). Three fixes
(commit after `91403d0`):
1. **Big-iPad portrait (1000–1099px) replay: panel sits BESIDE the board**
   (320px column, board flexes to ~680px) — everything visible, zero
   scrolling. Flex-wrap gotcha: wrap happens on BASE sizes (items never
   shrink to avoid wrapping), so the canvas max-width needs an explicit
   `calc(100vw - 356px)` term or the panel wraps below anyway.
2. **All ≤1099px replay: `.app-replay` is an explicit scroll container**
   (height: 100dvh + overflow-y: auto + touch scrolling) — the S17 fix
   pattern, so reachability never depends on WKWebView body scroll. Phone
   landscape keeps its own overflow:hidden + panel-scroll (later in file).
3. **Suite hardened:** 13" Pro added to the matrix (now 6 screens × 14
   viewports = 84 assertions) and replay's reachability probe got
   `noBodyScroll: true` — body scroll no longer counts, only an explicit
   scrollable ancestor. The stricter probe immediately flagged 10.2"
   landscape replay as latently broken on-device too (controls +13px past
   the fold, body-scroll-only) — covered by fix 2.


Roland's iPad cut off the bottom two rows of the board in landscape, and
Patrick had seen replay-mode cut-offs on several devices — so instead of
whack-a-mole we probed every major screen across 12 device viewports (iPhone
Pro/Max, iPad mini/10.2"/Air/11"/12.9", both orientations) with a
bounding-box probe in the preview browser (element fully visible OR reachable
via a scrollable ancestor — eyeballing 100 screenshots doesn't scale).
Commit `c7fa5f9`. **Five real cut-offs found, all fixed:**

1. **Game board, sub-1100px iPad landscape** — Roland's bug, reproduced
   exactly at 1080×810 (board bottom +153px ≈ 2 rows of 9×9). The medium
   branch (700–1099px) assumed "iPad landscape is ≥1100px" and only
   height-caps the board under `orientation: portrait`; 10.2" (1080×810) and
   9.7" (1024×768) iPads in landscape are medium-width. Fix: height-bind via
   `max-width: min(700px, calc(100dvh - 280px))`. Subtlety: it must be
   `max-width` — lifting max-width and using `width: min(...)` (like the
   portrait rule) lets the canvas's intrinsic size inflate the
   board-container's flex-basis, wrapping the side panel (Pass/Resign) below
   the fold. So Roland's iPad is a 10.2"-class device.
2. **Replay board, wide-branch landscape iPads (mini 1133×744, Air
   1180×820)** — board dragged 150–205px past the viewport. The wide grid
   has no definite height, so the 1fr row sized to the ~850px replay-controls
   stack (the row-spanning board fills rows via 100cqb). 12.9" only survived
   by having enough pixels. Fix: `.app-replay` gets the phone-landscape
   treatment (height: 100dvh + overflow: hidden), `min-height: 0` on the
   game-layout (flex min-height:auto trap) and side panel, which now scrolls
   in place.
3. **Replay controls, phone landscape (852×393, 932×430)** — `.app` is
   overflow:hidden there and the side-panel column had no scroll: controls
   ~240px below the fold, UNREACHABLE. Fix: side panel `overflow-y: auto`.
4. **Choose-avatar screen (S28!), phone landscape** — "That's me!" 43px
   below the fold, nothing scrolled. Fix: reward overlay scrolls +
   `margin: auto` content centering (flex-center alone clips the top of
   overflowing content). Also fixes the Cosmic Board reward screen.
5. **Ranked match-picker, phone landscape** — ▶ Play 212px below the fold
   behind AutoPlayView's starfield-clipping `overflow: hidden`: you could
   not start a ranked match on a landscape phone at all. Fix: scoped
   `overflow-y: auto` at max-height:500px landscape.

Everything else passed: game screen across all 12 viewports, replay across 8,
lessons / home / profile / glossary / library / end-modals (incl. the S28
124px hero avatar at 393px height — the end-card already scrolls internally).
Build green, 165 tests.

**Testing pattern worth keeping** — SHIPPED same session as a scripted
Playwright suite: `frontend/e2e/layout.spec.ts` + `playwright.config.ts`,
run with **`npm run test:layout`** (spins up / reuses the vite dev server).
Six specs × the 12-viewport matrix = 72 assertions in ~14s: game (board +
Pass/Resign strict), replay (board strict, controls scroll-reachable),
lesson, choose-avatar gate (fresh profile), ranked picker, home. STRICT =
fully in viewport; REACHABLE = allowed past the fold only if a scrollable
ancestor can get there — the distinction that caught the "present but
unreachable" bugs a visual skim missed. Validated by re-introducing the
Roland board bug: the suite fails with `[game @ iPad 10.2 landscape
1080x810] .go-board-canvas: bottom +154px past viewport`. Run it before
camp builds / after any CSS-breakpoint work. (Not wired into `npm run
build`; it needs the dev server + chromium, so it stays an explicit step.)

## Session 28 — July 1, 2026 (avatar art: kid characters + villains, end-screen hero shots, character-select NUX)

Patrick and Roland made a 7-image avatar set in ChatGPT (four kid characters,
three crystal villains playing Go over star-boards) and we shipped it end to
end in one session. Commits `05ce629` → `298801d` (+ docs). First real bite of
[fp 11 avatars](feature_plans/11_avatars.md). All verified in web preview
(desktop + 375px) and on Patrick's device mid-session; build green, 165 tests.

### Art → app pipeline
- Originals are ~3MB PNGs each (~21MB — would've shipped inside the WKWebView
  bundle from `public/assets/`). Resized to 640px JPEGs (~1.4MB total) in
  `frontend/public/avatars/`; originals preserved in `art/avatar-sources/`
  (they're Patrick + Roland's creations — treated as source assets, committed).
- `Avatar.tsx` grew an image path: types listed in `AVATAR_IMAGES` render an
  `<img>` (object-position 50% 18% — top-anchored cover crop so faces survive
  the circle at 36–56px); everything else stays CSS-drawn. Paths are
  `import.meta.env.BASE_URL`-relative (vite `base: './'`) for the iOS bundle.

### Who's who
- **Players** (4 new, joining the 3 CSS ones — existing picks survive via
  `VALID_AVATARS`): **Tide** (water boy), **Eclipse** (purple-vortex girl),
  **Prism** (rainbow boy), **Comet** (gold boy). Names are Jarvis picks —
  Roland may want to rename; one-line changes in `PLAYER_AVATARS`.
- **Top bots**: **Ember 6k** = black dragon-scale + molten gold (reads as
  embers in charcoal), **Storm 3k** = green figure flanked by two cyclone
  vortexes, **Void 1d** = white-crystal being under the set's most prominent
  black hole (matches Void's cosmic-dark CSS in spirit). Assignment logic:
  Ember was unambiguous; Storm-green vs Void-white is the judgment call —
  swappable in `AVATAR_IMAGES` if device feel disagrees. Lower rungs stay CSS.

### End-screen hero shots (Patrick's idea, on-device reaction to the art)
Win → your avatar big (124px, gold ring, pop-in); lose → the bot's avatar
looms (cool purple ring). Shared `EndHeroAvatar` in `GameEndModal.tsx`
replaces the 🏆/🤖 emoji in both the ranked and custom-AI end modals; local
hot-seat / bot-vs-bot keep 🏁. Degrades fine for CSS avatars.

### One-time character select at Learn to Play entry (fp 11 item 7)
Patrick: "most people don't know to set their avatar" — so the first screen
of Learn to Play is now **Choose your character!** (`ChooseAvatarScreen.tsx`,
reward-overlay starfield styling, all 7 avatars, ← Home escape per the S26
menu-trap rule). Gate = new persisted `profileStore.avatarPicked`, set by ANY
deliberate pick (this screen or the Profile picker) → shows at most once,
ever. Existing testers all see it once on next Learn entry (intended — none
of them know the avatars exist). Backing out without picking leaves the flag
unset. Design call: current avatar is preselected so one tap exits; flip to
forced-active-pick if rushing kids keep the default.

### Open threads
- Roland naming pass on Tide/Eclipse/Prism/Comet.
- Storm/Void assignment sanity-check on device.
- Lower-rung bot art + signature motion + unlocks remain in fp 11.

## Session 27 — June 26–27, 2026 (bot endgame bugs: ko-superko pass + dame fill)

Patrick reported two on-device (iPhone, direct Xcode build) bot-play bugs while
wrapping the milestone work; we diagnosed both and shipped a mitigation for the
serious one. Commits `d407376`→`3e77a98`. Both still want overnight device
validation.

### The ko-superko pass — game-breaking, root-caused from a device repro
Symptom: the bot passes during ko fights (and other spots), throwing a won
position. The first plausible cause — the **backend** sends KataGo an *empty
moves list* (move_selector.py:338-363, `PASS: all candidates illegal`) so it's
ko-blind — turned out to be the WEB path's bug, not Patrick's. On **device** the
plumbing is correct end-to-end: `requestAIMove` passes real `movesForBridge`
(gameStore.ts:904), the Swift bridge **replays it via legal `play` commands**
(KataGoBridge.swift:104-112), and `Board.clone()` preserves `koPoint` +
`positionHistory` (Board.ts:43-44). Patrick's repro found the real cause: a
**ko-rule mismatch.** KataGo runs `kata-set-rules japanese` = **`koSIMPLE`**
(printed in the bridge log), but our engine uses **positional superko**. In the
repro KataGo returned its sole best move `J5` (legal under simple ko, genmove
`play J5`), but J5 **repeats an earlier whole-board position**, so the selector's
`isLegal` filter rejected it → 0 candidates → null → pass. Not suicide (`sui0`),
not a history gap — purely positional-superko (app) vs simple-ko (KataGo)
disagreeing, so *any* KataGo-preferred move that repeats a position makes the bot
pass. A second repro showed the same thing as a premature mid-game pass (bot
passed at move 71 with H4 +7.2 still available two moves later).

### Fix shipped — Option B (safety net) + self-diagnosing logs (commit 3e77a98)
- **Don't pass when filtered to empty:** when the legality filter drops every
  KataGo candidate, the selector now plays a legal non-eye heuristic move
  (`pickLegalNonEyeMove`) instead of passing — only passing when nothing legal
  remains. TS `moveSelector.ts` + Python `move_selector.py` mirror (device + web).
- **`[selector] PASS reason=…` logging** on every pass path
  (`filtered-empty-no-legal-move` / `katago-top-pass` / `pass-threshold` /
  `opening-only-pass`) so the next repro self-classifies: a superko filter vs a
  genuine too-eager pass at low visits.
- **Root fix (A) still open:** set KataGo to **positional superko + territory
  scoring** (custom `kata-set-rules` instead of the `japanese` preset) so it
  never offers a superko-illegal move; Swift/bridge change + Render redeploy for
  web, needs validation.

### Dame fill on 19×19 — captured, not fixed
Separate mechanism: after the player passes, the bot fills score-neutral dame
instead of passing. Under japanese rules dame are worth 0, but on 19×19 the
settle search (`SETTLE_VISITS=100`) is too shallow for pass to win the
selector's visit-gated pass-detection, so the bot plays a dame (≈0, a hair above
pass from noise) then passes once they run out. Fix directions: scale settle
visits with board area + a "best move gains ~0 → just pass" shortcut. Left for
the bot session per Patrick.

### Lessons worth keeping
- **Don't trust the first plausible root cause.** "Backend sends no history" was
  real for WEB but wrong for device; tracing the whole device chain (TS → Swift
  `play` replay → engine clone) ruled it out, and the repro's `koSIMPLE` line was
  the actual smoking gun.
- **Make passes self-explaining.** A bot that "just passes" is a black box; a
  one-line reason per pass turns the next repro into a definitive classifier.

Build green, 163 tests, py_compile OK throughout. ⚠️ Both bot bugs need on-device
validation (Patrick testing overnight 2026-06-26).

## Session 26 — June 25–26, 2026 (tester-round milestone: undo banking + always-works home)

Scoped the **next-tester build** with Patrick, then shipped its first two items.
The frame (NOT the camp kids — the **6 current testers**, mostly adults + a few
elementary kids, already onboarded): **validation > new features.** Full plan in
[MILESTONE_tester_round.md](feature_plans/MILESTONE_tester_round.md): lessons /
replay / highlights polish · undo banking · back-to-home fix · glossary voice
pass → device validation by Patrick + Roland. World-art / energy / puzzles
deferred. Commits `3f1f97e`→`55f8b04`. Tests 158 → **163**.

### Undo banking — fp 26's first slice (commit 3f1f97e)
Replaces unlimited ranked undo with a **flat banked-3**: each ranked undo spends
one token, every game finished (win OR loss) refills +1 (capped 3), new players
start full; casual / lesson stay unlimited. We weighed a "hybrid" (free misclick
undo before the bot replies + a bank for real take-backs) but Patrick killed it:
bots respond near-instantly, so there's no information-free window to tell a
misclick from a misplay — the bank covers misclicks fine (≥1/game).
- **Gated on `autoplayContext`, not `isRanked`.** `isRanked` looked like the
  ranked signal but is only set by the Custom Match "Ranked" checkbox (+ the
  Library badge); the auto-play **ladder leaves it false** — which is *why* undo
  showed in ranked games. The bank keys off `autoplayContext` (the real ladder
  signal). Custom-ranked games keep their prior no-undo behavior via the
  retained `!isRanked` gate.
- State + persistence in `autoPlayStore` (player-level, not per-board);
  `undosUsed` recorded per `HistoryEntry` from day one (fp 26 "data first");
  "Undo (N)" HUD in `GameControls`; bank readout on the game-end modal. 5 new
  tests in `autoPlayStore.undoBank.test.ts`.

### Always-works "back to home" — menu-trap fix, bug #1 (commits 69e6d8e, 55f8b04)
Root cause confirmed: the `.scoring-overlay` (z 9500) is non-dismissible and
`request()` had no timeout, so a hung backend left it covering the only path
home (the title) forever. Patrick's framing — "a consistent, clear way home
regardless of screen" — drove a **tactical three-layer** fix (the deeper
view-flag→state-machine refactor was explicitly deferred to "if it still feels
bad after testing"):
1. **Home is a header control** next to Library / New Game (`HomeButton`). First
   cut floated it bottom-left at z 9600 (above the overlay); Patrick flagged it
   wasted vertical space on iPhone and broke control consistency, so it moved
   into the header. The "GoForKids" title is now a plain heading (was a hidden,
   coverable home path).
2. **One `goHome()`** in App: aborts in-flight requests, tears down every
   overlay/sub-view, resets all view flags. Every home affordance routes through
   it — kills the "flag left in a bad combo" bug family (same shape as the
   replay-close bug #4).
3. **Trap-proofing the scoring overlay** (now that Home doesn't float above it):
   `request()` gets a 20s `AbortController` timeout + `abortPendingRequests()`,
   so a hung scoring call aborts → `catch` clears `scoringInProgress` → the modal
   self-clears; AND the modal reveals a "Taking too long? Go home" escape after
   8s. Mid-game, the header Home confirms (a React confirm — NOT WKWebView-flaky
   `window.confirm`).
- **Bug caught in testing:** keying the confirm on `phase === 'playing'` fired it
  on the Profile screen too — `phase` stays 'playing' (stale) after you leave a
  game. Fixed by gating the confirm to the in-game button only
  (`confirmOnActiveGame`).

### Lessons worth keeping
- **Verify the "ranked" signal before gating on it.** A grep for *behavioral*
  reads of `isRanked` (not just the field declaration) surfaced the Custom-Match
  dependency that would otherwise have been a regression — the ladder's real
  signal is `autoplayContext`.
- **A floating "above everything" control is a smell.** Putting Home above the
  scoring overlay "worked," but the right fix was to make the one blocking modal
  non-trapping (timeout + its own escape) so Home can live where it belongs (the
  header). Fix the trap, don't float over it.
- **Local QA via the preview + `window.__gameStore` / `__autoPlayStore` hooks**
  drove the whole verification: forced the scoring overlay up to test the escape,
  resized to 375px for the iPhone header, drove ranked games move-by-move.

All ranked-ladder / learning-engine code untouched (both features are additive).
⚠️ Device-pending (milestone §7): both features on a real device — undo-banking
behavior, and the home control + scoring escape on iPhone.

## Session 25 — June 16–17, 2026 (the learning engine)

A multi-day build of the in-app learning loop, designed with Patrick first
(feature plans 28 + 29), then built and playtested end-to-end. The thesis:
**play → highlight → concept → glossary → lesson** as one connected loop, so
"learning" and "playing" stop being separate rooms. Commits `b568576`→`44f9076`.

### Concept registry + glossary (fp 29) — the spine
- `src/learn/concepts.ts`: the single source of truth every learning feature
  reads from. 10 **core** concepts (placing-stones, liberties, capture, atari,
  groups, two-eyes, suicide-rule, ko-rule, territory-count, who-wins) + 13
  **extended** (ladders … midgame, plus **komi** and **handicap**). Each has a
  kid-simple `short`, an optional example position, `related` links, and an
  optional `linkPrompt`. Go-correctness of the core example diagrams is
  unit-tested (atari = 1 liberty, capture = 0, two real eyes, self-capture
  surrounded).
- `DiagramBoard` (static prop-driven SVG goban — decoupled from the canvas
  `GoBoard`), `glossaryStore`, `ConceptLink` (tap any concept term anywhere →
  its page), `GlossaryView` (index + concept page: 5-second answer + diagram
  first, optional depth below). Home "Glossary" button; `?concept=` / `?glossary=`
  deep-links.
- **Glossary → lessons:** `LESSONS_FOR_CONCEPT` map + "Do the lesson(s)" button;
  a focused mode (`startConceptLessons`) plays a concept's lessons then RETURNS
  to its glossary page instead of marching through the curriculum.

### Lessons reworked
- Each concept lesson is **named after its concept** (Placing Stones, Capture,
  Groups, Atari, Two Eyes 1–4, Territory, …) and the header links to it via a
  per-concept `linkPrompt` ("How to Place Stones", "Two Eyes = Safe?", …).
- Grammar pass; **"suicide" → "self-capture"** in all kid-facing text (concept
  name + the in-game RuleViolationModal); lesson 12 "Big Board Time" → **"The
  9×9 Challenge"**; the 9×9 pre-game card now leads with **"How to win"**
  (capture / more territory / most points) and drops the rarely-read "What stuff
  means" section.
- **Two Eyes 4 playout/modal flow:** hold the "Next puzzle" modal until the
  capture sequence finishes (so it can't be skipped); part 3's interim modal now
  reads "Now watch White try…" so the first Continue visibly does something
  (it had shown "Two-eye master!" twice → looked frozen). The overly-broad
  playout guard that hid part 3's afterSuccess Continue was scoped to playouts
  only (`!_afterSuccessRun`).

### Play of the Game (fp 28)
- **Selection is by engine swing** — the moves where KataGo's per-move
  `scoreHistory` moved most. Captures are a *consequence*, not the key move, so
  they no longer drive selection. The capture/atari detectors became the
  *interpretation* layer (what happened + who moved + point magnitude + concept
  link); non-tactical swings still report magnitude honestly. Falls back to
  capture/atari selection when there's no score data (stub AI / fixtures).
- Opt-in "See your Play of the Game" on the ranked game-end modal; each
  highlight links its concept into the glossary. `?review=demo` fixture.

### Replay = review surface
- Saved games now persist `scoreHistory` + final `deadStones`. The replay
  computes highlights on load (`buildReview`), shows **timeline markers** at key
  moves (tap to jump), **★ skip-to-key-move** buttons (own row — un-crammed on
  iPhone), a "★ key move" indicator, and the **explanation + concept link** when
  you land on one. "Step through the game →" opens the just-finished game.
- **Scoring fixes:** `replayToMove` rebuilt the board by alternating colors from
  Black and dropped handicap stones → every ranked handicap game replayed wrong;
  now uses recorded move colors + places handicap stones. And the replay's
  dead-stone detection (`api.scorePosition`, Render-only) couldn't reach the
  on-device engine and left dead stones alive → it now reuses the live game's
  saved `deadStones`.

### iOS build + dev tooling
- **iOS build break:** the Xcode Run Script runs `npm run build` = `tsc -b &&
  vite build`. The repo's root `tsconfig.json` is a solution file (references
  only), so `npx tsc --noEmit` checked ~nothing and false-passed two errors
  (Color→Stone, private `Board.set`). **Lesson: verify with `npm run build`, not
  `vite build` / `tsc --noEmit` alone.**
- **Local QA via the preview tool:** dev-only `window.__learnStore` hook exposes
  the app's real store instance (a dynamic `import()` from an eval context
  resolves to a *separate* module instance — desynced from the app). With it,
  the full lesson flow is drivable + inspectable click-by-click locally.

Tests 118 → **158**. All ranked-ladder / promotion / calibration code untouched
(the learning engine is additive overlays). Device-pending items noted in fp 28
(populated PotG on real KataGo scores) and in the per-fix journal flags.

## Session 24 — June 11, 2026 (daytime polish block)

Two commits clearing the 2026-06-11 playtest findings.

**Settle-fill + score-graph fix — one root cause, fixed at the root.**
Diagnosis deepened from last night: the backend KataGo engine analyzes
EVERYTHING under **japanese rules + real komi**
([engine.py](backend/app/katago/engine.py)) — i.e. the b28 calibration
reference is japanese — while the on-device bridge hardcoded `komi: 7.5` +
`rules: 'tromp-taylor'` (client.ts, the old "acceptable for now" comment).
Both playtest bugs were that deviation: under area rules own-territory fills
are free, so the settle path never surfaced pass on-device; and assumed-7.5
komi inflated the score graph toward White by (7.5 − real komi) — rung 8k
plays komi 0. Fix: `GameStateDTO` (TS) and `GameStateResponse` (backend) now
expose **`komi`**; `getAIMoveViaBridge` and `finishMoveViaBridge` analyze with
`komi: state.komi, rules: 'japanese'`. `deadStonesViaOwnership` deliberately
untouched (painstakingly sign-calibrated; ownership-only). Note: **Render
redeploy needed** to serve the new komi field — web clients don't run
on-device analysis, so nothing breaks meanwhile.

**6k soften (v3, ⚠️ unvalidated).** `mistake_freq` 0.50→0.58,
`max_point_loss` 8→6 — more but smaller mistakes, Patrick's direction; quality
knobs untouched. Coupled (documented in-profile): lands alongside the settle
fix, which stops the bot's ~2–3 pt/game territory giveaway, so the net target
is "slightly easier than before." Validate bot-vs-bot (still beats 9k, still
loses to 3k) or playtest; if overshot, revert max_pl first.

Also: stale `RankUpOverlay` doc comment fixed. Verified: clean tsc, **136
tests**, build OK, backend py_compile OK.

Next-playtest checklist: bot passes back promptly after your pass; score
graph roughly matches final margins; 6k difficulty feel at rungs 8k–6k.

## Session 23 — June 11, 2026 (midnight block)

Feature 25: ranked promotion polish — the top item from the Session 22 feedback
batch. Design finalized in-session, superseding the Session 22 sketch (per-loss
setback instead of a loss-streak reset):

- **Graduated promotion threshold** — `winsToPromote(rung, board)`: 3 wins
  below 12k, 4 from 12k, 5 from 5k. On both current ladders that works out to
  3 through 13k, 4 for 12k–6k, 5 for 5k–1d (the 12k/5k marker ranks exist on
  both boards).
- **Loss setback** — from 12k upward each loss sets `winsAtCurrentRung` back
  one (floored at 0); the rung itself is never lost (no-auto-demotion stays
  policy). Below 12k losses remain no-ops — pure kid-first early game. The
  game-end modal surfaces the rule right when it bites ("At 9k, a loss sets
  your progress back one win") so the shrinking bar never feels mysterious.
- **Voluntary derank** — player-facing "Too tough? Move down a rank…" on the
  Profile rank card (two-tap inline confirm — the WKWebView-safe pattern from
  Session 22). New store action `derank()` steps down one rung, clears both
  counters, and leaves the shadow rating untouched (comfort feature, not
  recalibration). `prevRung()` added to the matchmaker.

Also fixed a latent 9×9 bug found while wiring: `AutoPlayGameEndModal` called
`nextRung()` without `boardSize`, so on the 9×9 ladder the "promote to X" copy
was computed against the **19×19** ladder — and at rung 28k (which doesn't
exist on 19×19) it would throw outright. The modal is now board-aware, and the
post-promotion celebration bar shows the FROM-rung's threshold (the bar the
player actually completed).

Files: `matchmaker.ts` (+`winsToPromote` / `lossSetbackActive` / `prevRung`,
new `applyResult` rules), `autoPlayStore.ts` (+`derank`), `AutoPlayView.tsx`,
`AutoPlayGameEndModal.tsx`, `ProfileView.tsx` (+ both CSS files). Verified:
clean tsc, **126 tests passing** (9 new: tier boundaries on both boards,
setback floor / never-demotes, streak-reset-on-win, prevRung), production
build OK.

⚠️ Device pass still wanted: the derank button + setback note are visually
unseen (styles written blind against the dark theme); play one 9×9 loss at
≥12k and one derank round-trip.

**Second commit — color variety on the even rungs** (Session 22 feedback #2:
"always plays Black" felt repetitive). New `gameMatchup(rung, lossStreak,
gamesAtRung, board)` wraps `effectiveMatchup` and alternates the player's
color on **color-symmetric rungs only** (no stones, full komi — the rungs the
points model already marked "play black or white"), deterministically by
games-played-at-rung parity (no stored randomness; history only changes on
`recordResult`, so the pick is stable across re-renders). Komi-edge rungs
(0 / 3.5), handicap rungs, and spec'd-White rungs never flip. Two kid-first
pauses: the **starting rung** never varies (a brand-new player's first games
stay consistent — relevant on 19×19 where 30k is an even game), and variety
**pauses while the safeguard is active** (its komi-easing assumes Black, and a
struggling kid gets the familiar setup back anyway). Consumers: AutoPlayView
match picker + ProfileView rank card both preview the same next-game matchup.
Verified: clean tsc, **133 tests** (6 new), build OK.

Also locked by test this session (Patrick requirement): **one win after the
safeguard returns the player to the base matchup** — already the behavior
(every win zeroes `lossStreak`), now a regression guarantee. Noted design
nuance, left as-is by choice: safeguard wins count toward promotion at full
value (below 12k a struggling kid can climb on eased wins — kid-first intent;
at 12k+ the loss setback makes it self-balancing).

**Third commit — handicap+komi engine fix (unblocks rung 12k).** The Session
21 note flagged three sites forcing komi to 0.5 whenever handicap > 0
(`gameStore.ts`, `localGameRouter.ts`, backend `state.py`); wiring the fix
surfaced a **fourth** — `client.ts` clamps in the HTTP request body too. All
four now follow the same rule: **an explicit komi wins, even with handicap**;
no explicit komi keeps the old behavior (0.5 on handicap games, default
otherwise). Backend `CreateGameRequest.komi` became `Optional[float] = None`
so absence is distinguishable from 7.5 — back-compatible, since old client
bundles always send komi explicitly (including 0.5 for handicap games, which
is exactly what they played before). Rung 12k (2 stones + 3.5 komi) now plays
at its true strength instead of collapsing toward 10k. New localGameRouter
tests pin: explicit komi + handicap honored, handicap-without-komi still 0.5,
and explicit komi 0 not treated as unset (assertions via the persisted
payload — `GameStateDTO` doesn't expose komi). Verified: clean tsc, **136
tests**, build OK, backend `py_compile` OK.

⚠️ Device check tonight: play rung 12k (9×9) to scoring and confirm White's
score line shows komi 3.5 (not 0.5).

Design doc: [25_promotion_polish.md](feature_plans/25_promotion_polish.md).
Still queued from Session 22: opening variety (move-selector change, both
inference paths — needs play-validation, not a midnight edit), rewards arc.

## Session 22 — June 5, 2026

Short session: two playtest bugs fixed (the user reached 8k on the 9×9 ladder,
so it's holding up in real play). Also captured a batch of ranked-polish
feedback for upcoming work — promotion should feel more earned (N-win threshold
scaling 3→5, no auto-demotion, a loss streak resets rung progress, optional
manual derank); games feel repetitive (always Black, near-identical openings —
fix via color variety on the symmetric "even" rungs + opening variety); and a
rewards arc (shareable profile, animated/anime-style avatars) for later.

### Two bug fixes

- **Profile dev tools did nothing on device.** "Set rank" / "Reset rank" used
  `window.confirm` / `window.prompt`, which silently no-op in WKWebView (no
  native JS-panel delegate → `confirm` returns false, `prompt` returns null), so
  the guards never passed. Replaced with inline confirmation: Set rung acts
  directly (reversible, dev-only); Reset arms on the first tap ("Tap again to
  confirm") and fires on the second, disarming on blur.
- **Stale game-end screen floated over a new game.** Both end modals
  (`GameEndModal`, `AutoPlayGameEndModal`) gate on `gameEndDismissed`, but Quit
  (`setShowHome(true)`) and `handleOpenNewGame` never dismissed it — so the
  finished game lingered in the store and re-rendered under the New Game dialog
  (the user's screenshot: an old "Void (1d) wins" panel over the dialog). Fix:
  `handleOpenNewGame` now dismisses the end state before opening the dialog
  (covers both modal types, since they share the flag); Quit and the auto-play
  Home handler also dismiss for hygiene.

117 tests, tsc clean, build OK. Both need a quick device confirm (B1 is
inherently a WKWebView behavior; B2 is the modal flow).

## Session 21 — June 4, 2026

Feature 24 took its real shape tonight: the 9×9 ranked ladder went from a
bot-bouncing first cut to a 23-rung points-model ramp; the 15k bot got weakened
off playtest feedback; a long-standing endgame bug (bots filling their own
territory instead of passing) got fixed at the root; and the home screen +
profile became per-ladder. All verified building clean (TS `tsc` + 117 tests +
production build; Python `py_compile`) and playtested on device.

### Ladder redesign — the points model

The first playable 9×9 ladder (commit 234ce66) bridged the six real profiles
(30k/15k/9k/6k/3k/1d) with a mix of even games + occasional komi/stones.
Playtest verdict: it "jumped around" — the bots are unevenly spaced (big cliffs
30k→15k and 15k→6k) and it swapped bots almost every rung. Reworked into one
continuous "player advantage in points" axis across overlapping bots:

- **The player can now play White** — a new rung dimension. When the player is
  White the handicap stones go to the *bot*, letting a single bot cover a wider
  rank range (you-Black+stones at the easy end → you-White at the hard end).
  `Matchup` became `{ bot, playerColor, handicap, komi }` (dropped the earlier
  stones|komi `kind` tag). `playerColor` is threaded through the store →
  AutoPlayView copy → App's `newGame`.
- **Points calibration (playtest):** 1 rank ≈ 4 pts; a 2-stone handicap ≈ 14 pts
  ≈ 3.5–4 ranks; 6.5 komi ≈ 2 ranks; 3.5 komi ≈ 1 rank. There is **no 1-stone
  handicap on 9×9** — one stone ≈ no-komi — so the minimum real handicap is 2.
  The ladder fills the chunky stone gaps with komi (no-komi → 3.5 → 6.5 against
  each bot): ~2-rank steps to 15k, ~1-rank steps from there to 1d. 23 rungs,
  30k → 1d; clearing the top = a "2 dan" graduation (no 2d bot to calibrate).
- **Engine dependency (one rung):** 12k (2 stones + 3.5 komi) needs the engine
  to honor an explicit komi on a handicap game; today komi is forced to 0.5 in
  three places (gameStore.ts, localGameRouter.ts, backend state.py). Until
  fixed, 12k plays at komi 0.5 (collapses toward 10k). Deferred — it's a scoring
  change to make with the backend up and a scoring test in front of us.

Labels (28k/25k/23k/…) and the exact bridge values are intuited/playtest-seeded,
pending bot-vs-bot validation; the 30k↔15k handoff is the seam to watch.

### 15k weakened

Playtest: 15k beat an adult tester twice and the ladder reached it too fast.
Goal: dull move QUALITY without touching its mistake character (the blunders
read as fair for ~15k). In b28.yaml 9×9 15k — visits 6→5, policy_weight
0.15→0.12, local_bias 0.30→0.38; randomness / mistake_freq / max_point_loss
left UNCHANGED. Three knobs at once is the exact pattern that over-weakened the
*old* 15k, so this is pending bot-vs-bot revalidation (should still stomp 30k,
still lose to 6k); if it overshot, revert `visits` to 6 first.

### Bots filling their own territory at game's end — fixed

Resurfaced on 9×9 playtest: after the player passes, the bot plays pointless
moves in its own territory instead of passing back. Root cause was NOT a missing
fix — the "drop candidates worse than pass" filter exists on both the Python and
on-device TS paths. It's gated on KataGo surfacing a `pass` candidate with ≥4
visits, which the 9×9 bots' tiny visit counts (6–9) almost never produce, so the
filter silently no-ops and mistake injection fills territory. It only ever
worked on 19×19 because those bots search deeper — a visit-count *effectiveness*
gap, not a code gap.

Fix (mirrors the existing Finish-Game path): when the opponent just passed,
route the bot through a "settle cleanly" path — analyze at `SETTLE_VISITS=100`
so pass reliably surfaces, AND skip mistake injection (play KataGo's honest top
move or pass). Signal: Python `consecutive_passes >= 1`; TS `last_move == null`
past the opening (a pass carries no point), with a stone-count guard against a
handicap game's first move. Off by default everywhere → normal play and
bot-vs-bot calibration unchanged. Files: move_selector.py, state.py,
moveSelector.ts, client.ts. **Verified on device: bots now end games cleanly.**

### Home screen + profile went per-ladder

Bug: the home rank chip hardcoded "19×19" but read the *active* board's rung, so
after picking 9×9 it showed "19×19" with the 9×9 rank; ProfileView had the same
19×19-hardcoding (label + `effectiveMatchup`/`nextRung`/`applyResult`/
`LADDER_RUNGS` all defaulting to board 19). Fixed by showing two independent
chips — 9×9 and 19×19, each reading its own board's rung (active from
`rungState`, other from its `slots` entry) — and making ProfileView
board-parameterized end to end (label, rank card, rank graph, dev tools).
Tapping a chip sets that board active and opens its profile. **Verified on
device.**

## Session 20 — May 18-19, 2026

Feature 24 — 9×9 ranked-mode foundations. Beta feedback: 19×19 too
intimidating, even Sprout 18k + H9 feels hard for new players. Need a
gentler on-ramp via 9×9. This session built out the bot ladder for 9×9
since that's prerequisite for the ranked-mode UX, and uncovered a much
harder profile-design problem than expected.

### Phase 0+1 — anchor validation + komi sweep (overnight, finished in 3.7h)

650 games via `data/calibrate_9x9_ladder.py` orchestrator (new this
session). Phase 0: cross-rank ordering across the 4 existing 9×9 profiles
(30k/15k/6k/1d). Phase 1: same-profile-vs-self komi sweep across 5 values
(+14/+7/0/-7/-14) to measure komi-per-rank slope per profile.

Findings:
- 30k/6k/1d rank ordering validated; old 15k confirmed broken
  (15k-v-6k margin -84 was nearly identical to 30k-v-6k margin -89, i.e.
  15k got stomped same as 30k).
- **Komi response scales with visit count.** 30k (4 visits) and 6k
  (12 visits) were komi-deaf across the full sweep range. 1d (50 visits)
  produced a clean sigmoid curve (15→40→80→85→95%). Means komi-based
  fine handicap only works for high-visit profiles.

### Profile design iterations (5 attempts)

**v1 (KataGo, small knob deltas):** 18k v 15k = 50/50 (no gap), 15k v 12k
= 12k 93% (cliff). Discovered the `local_bias_in_opening` knob was a
15-20 rank cliff — kills any profile that uses it.

**v2 (KataGo, lbio=false everywhere, visit-spread 6/8/10/11):** v2 18k
(visits=6) finally produced a real middle-tier bot — beat 30k 97% with
avg margin -82.7 (near-saturated stomp on 9×9). But middle-vs-middle
distinctions stayed flat: 18k v 15k = 50/50. Cliff still at visits 8→10.

**v3 (heuristic path, `use_katago: false`):** Discovered the
`_select_beginner_move` code path that bypasses KataGo entirely. Tuned
via `save_atari_chance` + `capture_chance`. Validation showed clean
curve internally (save_atari=0.55 → 0.75 produced 77% gap) but the
*entire* heuristic curve sat in the 28-35k effective range. Heuristic
at max-firing (save_atari=0.92) still lost 97% to KataGo 6k.

**v4 relabel attempt:** tried renaming the v3 heuristic profiles to
match perceived effective strength. Failed — 30k v "new 18k"
(save_atari=0.75) was 50/50, confirming heuristic profiles cluster at
30k tier regardless of internal differentiation.

**Final (v5):** sourced new 15k from v2-18k (KataGo visits=6, lbio=false,
mf=0.72) — the only profile shape that lands a real middle bot. Added
visits=9 as speculative 9k — turned out to land at ~10-12k effective
(small but real gap from new 15k, 7-point margin from 6k).

### Final 9×9 profile set (b28.yaml)

5 distinct effective strength tiers:

| Rank | Profile shape | Validation |
|------|---------------|------------|
| 30k  | KataGo lbio=true visits=4 | playtest + bot anchor |
| 15k  | KataGo lbio=false visits=6 mf=0.72 | middle-tier, ~15-22k effective (precise rank pending playtest) |
| 9k   | KataGo lbio=false visits=9 mf=0.63 | transition tier, ~10-12k effective |
| 6k   | KataGo lbio=false visits=12 mf=0.55 | playtest + bot anchor |
| 3k   | KataGo lbio=false visits=30 mf=0.40 | validated this session (70% vs 6k, 80% vs 1d) |
| 1d   | KataGo lbio=false visits=50 mf=0.22 | playtest + bot anchor |

**18k and 12k slots intentionally left as ladder-only rungs** — served by
(15k bot + komi) and (6k bot + handicap stones) in feature 22's 9×9
ranked-mode design.

### Files touched

- `data/profiles/b28.yaml` — 9×9 block rewritten (added 9k, retuned 15k,
  added 3k, dropped old broken 15k, dropped speculative heuristic 18k)
- `backend/app/ai/profile_loader.py` — split `REQUIRED_KEYS` from a new
  `HEURISTIC_REQUIRED_KEYS` so `use_katago: false` profiles can omit
  KataGo-only knobs (used during v3 experiments; harmless to keep)
- `data/calibrate_9x9_ladder.py` — new 360-line orchestrator. Supports
  4 matrix phases: `0,1` (Phase 0+1), `pv` (full adjacent-pair
  validation), `rv` (relabel validation), `fv` (final 4-pair validation).
  Resumable via results.csv append, writes summary.md per pairing.
- `Makefile` — 5 new targets: `9x9-ladder-{up,down,status,dry-run,
  overnight,profile-validation}` plus the b28-only single-backend launch
- `frontend/src/components/NewGameDialog.tsx` — 9k and 3k now appear in
  the 9×9 custom-match dropdown (sizes: NINETEEN_ONLY → NINE_AND_NINETEEN)
- `feature_plans/24_9x9_ladder.md` — new feature plan doc, captures the
  full komi-vs-stones design tradeoffs + Phase 0/1 results
- `feature_plans/README.md` — added feature 24 row

Calibration logs in `data/calibration_logs_b28/9x9_*` (5 separate runs,
~1200 games total wall-clock).

### Lessons worth keeping

1. **Bot-vs-bot win rate is a saturated signal at large rank gaps.**
   Anything weaker than ~10k loses to 6k at 95%+. Use margin (avg points
   from B's perspective) instead. Phase 0 margins like 6k v 1d = -25.9
   tell us "real Go game with one side winning"; -85+ tells us "stomp,
   one side got wiped off the board."

2. **The b28 9×9 profile space has structural cliffs.** Visits is the
   dominant strength dial in the lbio=false tier, but the transition
   from "middle" to "6k-like real Go" happens sharply between visits=8
   and visits=10. visits=9 (this session's "9k") landed close to the
   transition but the cliff is real — can't fill the 12k-9k middle
   with a single KataGo profile shape.

3. **Heuristic path (`use_katago: false`) sits firmly in 30k tier
   regardless of knob tuning.** Even max-firing heuristic
   (save_atari=0.92, capture=0.82) lost 97% to KataGo 6k. Curves
   internally (save_atari 0.55→0.75 differentiates clearly) but the
   whole curve is in 28-35k range. Useful as a 30k-flavor variant; not
   useful for filling the middle of the ladder.

4. **Worktree edits hit main repo when given absolute paths.** Edit tool
   with `/Users/patrickdowell/Projects/GoForKids/...` writes to main
   repo, not worktree. Use the explicit worktree path
   (`/Users/patrickdowell/Projects/GoForKids/.claude/worktrees/<name>/...`)
   for changes that should travel with the branch. This session's edits
   landed in main repo first; copied to worktree at the end to make the
   branch reflect the work.

### Open / followup

- humanSL (KataGo's human-policy model) is the right long-term solution
  for filling the 9k-15k gap with rank-realistic bots. Requires
  infrastructure work: download humanSL model file (~50-300MB), add
  `humanProfile` to KataGo analysis config, plumb a `humanSLProfile`
  param through move_selector. Estimated 4-6h. File as separate feature
  plan.

- Playtest 9×9 15k and 9k to determine true effective ranks. Current
  labels are provisional based on bot-vs-bot margin readings. Real rank
  could be 12k-22k for "15k" and 8-13k for "9k."

- Next session: 9×9 ranked play mode UI. Per feature 24's design, will
  use the new 6-profile set plus stones/komi bridging to build the
  10-12 rung ladder.

## Session 19 — May 17, 2026

First TestFlight beta cycle. The friends-and-family build went out
mid-week; 9 bugs surfaced across the next two days of real-device play
(iPad + iPhone Pro Max + iPhone 17 simulator). Closed 8 of them across
two sprints with zero new regressions in the 118-test suite. The
remaining open item (#9, heat / battery on iPhone) is held for a
later profiling session — the bug entry stays open until Xcode
Instruments confirms the suspected on-device KataGo inference cost.

### Sprint 1 — quick wins (5 bugs)

All UI / state-flow fixes, no engine work. Shipped together in commit
22a3fc1 then rebased onto main with a 5×5-tutorial follow-up
(`6e35a3b`) that switched the bot's no-legal-moves behavior from
resign to auto-pass per playtest preference (strict-Go-rules path,
also avoids any risk of the pass-pass scoring race we hadn't ruled out).

- **Auto-play game-end modal: dismiss + score breakdown.** The new
  ranked-Play modal lacked a Close button and the standard score-
  breakdown rows, so players couldn't get past it to inspect the
  final board. Reused the existing `ScoreSide` component (exported
  from `GameEndModal`), wired the existing `gameStore.gameEndDismissed`
  flag, and added a new `AutoPlayGameEndPanel` "See results" pill in
  the side panel post-dismiss to reopen.
- **Profile scroll on iPhone WKWebView portrait.** `.profile-view`
  had `overflow-x: hidden` with no height cap, which per CSS spec
  implicitly turns `overflow-y` into `auto` but leaves nothing to
  scroll against. Switched to explicit `height: 100dvh + overflow-y:
  auto + -webkit-overflow-scrolling: touch`. Merged with a
  contemporaneous safe-area-inset PR (`1f9c2b2`) — both fixes
  preserved.
- **Replay close button routes to home.** `replayStore.close()`
  alone left the user on the in-progress game underneath (showHome
  was still false from when Library was opened). Replaced inline
  store reference with a required `onClose` prop; App's new handler
  calls `closeReplay()` then `setShowHome(true)`.
- **Replay controls layout on iPhone portrait.** The floating
  settings gear (`bottom: 72px` in narrow mode to clear Pass/Resign)
  was overlapping the Speed-control row's right edge. Added an
  `.app-replay` modifier class toggled on `replayActive` and a
  `bottom: 14px` override so the gear sits at the bottom-right
  corner in replay mode; combined with `padding-bottom` on
  `.replay-controls` so Download SGF + hint clear the gear when
  fully scrolled.
- **5×5 tutorial bot freeze on suicide-only positions.** Original
  fix resigned for the bot to skip a suspected pass-pass async race;
  per playtest preference, switched to auto-pass on the bot's behalf
  (strict Go rules — passes are always legal). `lessonAutoPass` now
  treats bot and player symmetrically; recursive pass-pass termination
  ends the game via the standard scoring path.

### Sprint 1.5 — iPhone simulator follow-ups (2 bugs)

Caught during the user's iPhone Pro Max + iPhone 17 simulator pass.

- **Pro Max: "← Home" overlaps lesson dot (1) in lesson view.** The
  narrow breakpoint's `auto 1fr` grid wasn't constraining the
  `.learn-progress` flex container because `justify-self: end`
  (inherited from the default rule) sized it to its 376px content
  width, overflowing leftward into the back-button cell. Override
  to `justify-self: stretch` so `overflow-x: auto` can do its job.
- **Homepage bot roster crops both ends on iPhone.** `.home-content`
  is `align-items: center`, so `.home-bots` (sized to its 455px row
  content) centered out of bounds equally on both sides. First cut
  added `align-self: stretch + min-width: 0` but left Storm/Void
  scrolled off-screen; final fix shrinks avatars 44→32px and gap
  12→4px so all 8 fit centered on a ~400px viewport without scroll.

### Sprint 2 — handicap undo + Pro layout audit

- **Undo doesn't restore handicap stones (and silently swaps W/B).**
  Two bugs in one. Handicap stones weren't tracked anywhere
  accessible to `Game.undo()`'s board-rebuild, so they vanished. AND
  the replay loop pinned `currentColor = Color.Black` at the start
  and let `playMove` flip it naturally — which silently played the
  recorded W moves as B in handicap games (where White moves first).
  Fix: new `handicapStones: Point[]` field + `setHandicap()` method
  on `Game`. `undo()` now re-places handicap stones post-rebuild and
  sets `currentColor = move.color as Stone` before each replay step.
  Same color-of-record discipline applied to `fromSGF`. `toSGF` now
  emits `HA[n]` + `AB[xx][yy]...` tags so handicap survives library
  save/load and replay. `localGameRouter`'s pre-existing undo
  workaround removed — Game handles it natively now. 5 new
  `Game.test.ts` tests lock in handicap-undo, color-replay,
  non-handicap regression, AB emission, and SGF round-trip.
- **iPhone Pro layout audit — closed via cumulative work.** The
  Pro-specific complaints (homepage bot roster, lesson header
  overlap) were both fixed in Sprint 1.5. Audit at 393×852 (iPhone
  Pro / Pro Max) of home / new-game / game UI / lessons / profile /
  library / replay all clean. Bug stays closed unless a fresh repro
  surfaces a new cut-off location.

### Late-day follow-ups (May 17 → 18): 5×5 tutorial polish

The 5×5 tutorial bug (#3 in the TestFlight batch) needed three more
iterations on top of Sprint 1's "switch resign to pass" revert before
the flow felt right end-to-end. Each was a single small commit; all
came from the user playing the lesson on iPad and reporting what was
off. Useful pattern to remember: the original "freeze" symptom was a
composite of three orthogonal problems that the resign branch hid by
side-stepping each one — the more correct strict-Go-rules pass path
exposed them in turn.

1. **aiThinking flag leak** (5a6308b). `playMove` synchronously sets
   `aiThinking: true` to lock the UI for the upcoming bot turn. When
   `lessonAutoPass` handled the bot's pass internally and
   `requestAIMove` early-exited because the bot's turn was now done,
   nothing in the early-return path cleared the flag. UI stayed in
   "bot thinking" lock → looked like a freeze even though the bot had
   passed cleanly. The resign branch sidestepped this because phase
   flipped to `'finished'` and the game-end modal masked the locked UI.
2. **Missing BotPassedModal trigger** (d213593). `lessonAutoPass`
   was calling `_game.pass()` without setting `botJustPassed: true`,
   so the explainer modal that the selector-driven bot-pass path
   sets correctly was getting skipped on the auto-pass path. Capture
   `wasBotPass = currentColor !== playerColor` before the pass, set
   the flag on the non-finished commit. Recursion safety preserved.
3. **Symmetric player-out-of-moves modal** (8a685e9). The original
   `lessonAutoPass` also silently auto-passed when the *player* had
   no legal moves — same silent-pass problem, opposite direction.
   New `PlayerOutOfMovesModal` ("No more moves!" + single Pass-and-
   end button) replaces the silent player auto-pass. The button
   action `passAndEndGame` fires the player's pass AND forces the
   bot's pass on the same tick so the standard 2-pass scoring path
   runs and the score modal shows the final tally (a single player
   pass wouldn't end the game on its own — the bot would just play
   another move and loop the modal indefinitely if it still had
   legal moves). `lessonAutoPass` and the selector-pass branch both
   pick between `BotPassedModal` and `PlayerOutOfMovesModal` based
   on whether the player still has legal moves, so exactly one
   modal is on screen at a time.

### Workflow notes

- Worktree-then-rebase-onto-main flow kept the main branch's working
  tree intact for the iOS Xcode "Bundle React frontend" run script
  (which reads from `~/Projects/GoForKids/frontend`, not the
  worktree). Cycle each session: edit in worktree → push to remote
  main → `git pull --ff-only` in main repo → rebuild in Xcode.
- One conflict during rebase (`ProfileView.css`) merged my
  scroll-fix with `1f9c2b2`'s safe-area padding — kept both.
- The 5×5 tutorial follow-ups loop tightened the test-flight build
  cadence: each iteration was one commit + one Xcode archive +
  install on iPad + ~30s of lesson 5 play to confirm the next
  symptom. Fast feedback worth the small upload-and-process cycle.

## Session 18 — May 13, 2026

Auto-play (feature 22) + Profile page (feature 23) shipped together
with the Glicko-2 shadow rating wired in. Replaced the "Play" button
on the homepage with a one-tap surface that tracks the player's 19×19
rank from 30k and picks each matchup deterministically off a 29-rung
ladder. The pick-board / pick-bot / pick-handicap flow becomes
"Custom Match." Plus two bugs caught during playtest before pushing.

### Feature 22 — auto-play (linear ladder + match-picker + celebration)

The data model is a pure linear ladder. Each rank is a fixed
`(bot, handicap)` tuple chosen so handicap balances bot rank to the
player's rung: 30k → 27k (= 18k bot + H9) → 26k (H8) → ... → 18k even
→ 17k (= 15k bot + H2) → ... → 1d. 29 rungs total. The 30k → 27k jump
skips 28k/29k because there's no calibrated bot to fill that gap. Each
rung past the first promotes by exactly one rank. Source of truth is
`frontend/src/autoplay/matchmaker.ts`, fully covered by 32 unit tests
(ladder math, promotion logic, validation-wall holds, safeguard).

Promotion is first-to-3 wins per rung. Losses are no-ops — they don't
reset the count, don't count against you, don't demote. Anti-frustration
safeguard adds +2 handicap stones for the next match after 5 consecutive
losses at the current rung (capped at H9 so 27k is a no-op). Quiet, no
UI callout — meant to restore the win taste without surfacing it as a
demotion.

Persistence lives in `frontend/src/store/autoPlayStore.ts` (Zustand,
`goforkids.autoplay.v1` localStorage key). Tracks rung state, full
history (last 200 games), promotion events, and a `gamePending`
lifecycle flag App.tsx uses to record the result exactly once per
auto-play game.

The match-picker (`AutoPlayView`) is the pre-game friction screen — bot
avatar + rank + handicap line + wins-toward-promotion meter + one Play
button. Tapping Play sets `autoplayContext: true` on the game and dives
into the regular game UI. On game-end, the `AutoPlayGameEndModal` slides
in with the result + Home / Next match buttons. On a promotion-causing
win, the `RankUpOverlay` fires first — full-screen cosmic celebration,
gold star badge, "You're now 27k" gradient title — and the game-end
modal then renders underneath with all three progress segments lit gold
and "Congratulations on reaching 27k!" copy for the game that earned it.

Math fix while writing: the original plan's 2k/1k handicaps were off by
one stone — found by a property test that every step is exactly 1 rank
stronger than the previous. Plan doc + ladder code now agree.

### Feature 23 — Profile page (rank, history, Glicko shadow, dev tools)

New top-level Profile route alongside Play / Learn / Custom Match /
Library. Six sections:
- **Header** — avatar (CSS-art Black Hole / Nova / Nebula) + click-to-edit
  display name.
- **Current rank card** — big rank, current matchup line, wins-to-promotion
  meter, last-10 W/L chip strip.
- **Rank graph** — custom SVG step-line chart with gold promotion dots,
  rung labels 30k → 1d on Y, game number on X. Replays history through
  the matchmaker to derive the rung-at-each-game series.
- **Avatar picker** — moved out of NewGameDialog (which now shows a
  read-only "playing as Patrick" row with a "Change in Profile" link).
- **Advanced toggle** (collapsed by default, state persists in
  localStorage) — Glicko mu/phi/sigma + 95% CI + derived rank, matchmaker
  decision pseudocode, last-20 games table, promotion log.
- **Dev tools** — Manual rank set (dropdown of all rungs), Reset (type-
  RESET confirm), Export/Import JSON. Gated under Advanced; useful for
  beta testers validating the matchmaker from cold without grinding.

Glicko-2 ported to TS at `frontend/src/autoplay/glicko.ts` —
mechanical port of `backend/app/game/rating.py`. The two stay in sync
by virtue of implementing the same algorithm, not via code-sharing.
Two pre-existing bugs fixed in both source files in passing:

1. `rank_to_rating("1d")` returned 2100 vs `1k` = 2400 — so 1d was
   rated WEAKER than 1k, contrary to the rank ordering. New dan formula
   `2400 + dan*100` gives 1d=2500, 2d=2600, monotonic across the ladder.
2. `to_go_rank` had `max(1, ...)` clamping the raw rank before the
   dan-vs-kyu branch, making the `<= 0` branch unreachable. `mu=2500`
   returned "1k" instead of "1d". Dropped the clamp.

Each finished auto-play game updates the shadow rating via
`update_rating`. Opponent strength = player's current rung (handicap
balances by construction), not the raw bot rank. Shadow rating doesn't
drive promotion in v1 — that's the linear ladder's job — it's a power-
user diagnostic surfaced on the Profile's Advanced tab. Hedge for the
future: if real playtest data shows the linear ladder is too slow / too
fast at higher ranks, we can flip to Glicko-driven promotion at 12k+
without re-architecting.

### Bugs caught in playtest

**Cross-game double-fire on Next-match.** The first bug surfaced once
the Profile page made game history visible: a "W W L W" sequence
showed as 2W / 2L with no promotion instead of the expected 3W / 1L.
`handleStartAutoPlayGame` sets `gamePending=true` synchronously before
`newGame()`'s async `createGame` resolves and flips `phase` to
'playing'. During that gap, `gameStore` still has the previous game's
phase='finished' + result. The game-end effect re-fired and re-recorded
the previous outcome on every Next-match tap. Fix: a
`recordedThisGameRef` useRef that resets when `phase` transitions back
to 'playing' so each game records exactly once.

**Local-then-server result swap on player double-pass.** With a backend,
`gameStore.pass()` sets `result` from local `scoreTerritory` (no dead-
stone awareness) first, then ~5-10s later `syncServerScoring` replaces
`result` with the server's dead-stone-corrected version. On close games
dead stones can flip the winner — the effect was recording the local
(potentially wrong) winner. Fix: skip the effect while
`scoringInProgress` is true, so only the post-scoring result fires the
record.

**Game-end modal showed a "downgrade" right after promotion.** After
the player dismissed the rank-up celebration, the `AutoPlayGameEndModal`
underneath was reading the post-promotion rung state and showing
"0 of 3 wins at 27k to promote" with an empty progress bar. The win
that just earned the promotion was the only win that didn't fill any
segments. Fix: keep `pendingFromRung` set past `dismissRankUp` so the
modal can detect "this game caused the promotion" and render a
celebratory state — all three segments lit gold, copy reads
"Congratulations on reaching 27k!". `pendingFromRung` naturally clears
on the next `recordResult` call so the celebration only persists for
the game that earned it.

### Rebase onto main

After feature 22 + 23 + the first fix, rebased the four-commit stack
onto the latest `origin/main` (Session 17 had landed 25 commits ahead).
Manual resolution needed only on the c5852b7 (feature 22) commit:
- `feature_plans/README.md` — kept main's iPhone 21 🟡 Beta status,
  kept new rows 22 + 23.
- `frontend/src/App.tsx` — main added `GameEndModal` + `RuleViolationModal`
  to the modal stack; mine added `AutoPlayGameEndModal` + `RankUpOverlay`.
  All four coexist.
- `frontend/src/components/GameEndModal.tsx` — main's new generic
  end-of-game modal needed an `autoplayContext` early-return added,
  otherwise both it and `AutoPlayGameEndModal` would render in auto-
  play games. Same for `GameEndPanel`.

The other two commits (feature 23, the recording fix) replayed cleanly.
Post-rebase: 113/113 tests pass, TypeScript clean, browser smoke
verifies the modal-suppression and the cross-game fix both work.

### Lesson worth keeping

The same useEffect+Zustand pattern bit us twice in two different ways
in the same effect — first the cross-game stale-state issue, then the
local-then-server result swap. Both bugs share a root cause: the
"gamePending" guard alone isn't enough when an effect's dependencies
can change for reasons unrelated to "a NEW game ended." Three guards
combined did the job: gamePending (the obvious one), `scoringInProgress`
(skip while results are being refined), and a useRef reset on the next
`phase='playing'` transition (per-game dedup). When you're recording
discrete events keyed off reactive state, "exactly once" doesn't fall
out of one boolean flag — you need either a per-event ID or a
ref-based latch reset on the right edge.

### Status of feature plans after this session
- **22 (Auto-play):** 🧪 Beta — first cut shipped, 19×19 only. 9×9 /
  13×13 auto-play waits for those calibrated ladders.
- **23 (Profile page):** 🧪 Beta — first cut shipped, 19×19 section
  only. More board sizes added once feature 01 fills the ladders.
- **17 (Rank progress widget):** ❄️ Superseded by 22 + 23.

### Deferred to next session
- **Smoke-test auto-play against the real Render bots.** Local
  verification used resign-driven game-ends. Backend bots running on
  Render at calibrated visits will exercise the full pass-pass scoring
  + scoringInProgress path that the second fix targeted.
- **5k → 4k validation wall.** Player will hit it once they win
  through the validated 30k → 6k ladder; need to confirm the "you've
  reached the top of the calibrated ladder" message reads right vs
  starting the player into the un-validated 3k bot anyway.
- **Rate-limit Glicko-driven promotion switchover.** If linear-ladder
  pace doesn't match real player skill at higher ranks, the schema is
  forward-compatible for switching to Glicko-driven at 12k+.

### Late-day follow-ups (same session, post-playtest)

- **AutoPlayView header clipped by iOS status bar** (commit `fe800bc`).
  `.autoplay-header` had `padding: 18px 28px` with no `var(--safe-top)`
  handling, so the "← Home" button and the rank chip sat under the
  iPhone notch / iPad status bar in portrait. Mirrored the App.css
  pattern: `padding-top: calc(18px + var(--safe-top))` on the header,
  plus `padding-left/right: var(--safe-left/right)` on `.autoplay-view`
  for rotated-device edge insets. Verified at simulated 44 px notch:
  header padding 18 → 62, buttons clear the bar.

- **ProfileView header clipped by iOS status bar** (commit `1f9c2b2`).
  Same root cause and fix as AutoPlayView — `.profile-header-nav`
  picks up `padding-top: calc(18px + var(--safe-top))`, `.profile-view`
  picks up left/right insets + `min-height: 100dvh`.

- **Bot passed the turn after the player took a ko** (commit `4ebff34`).
  Real bug from ladder-mode playtest. Black takes a ko stone → White
  bot just passes instead of playing a ko threat or tenuki. Saw it
  consistently across multiple ranks.

  Root cause: the iPad bridge fed KataGo `boardToMoves(state.board)` —
  a sorted "all black stones then all white stones" stone list with no
  move order. KataGo replayed those out-of-order plays, ended up with
  the right stones on the board but **no notion of which point was
  just captured**. Its top suggestion was usually "retake the ko stone
  you just lost," our engine rejected that as `MoveResult.Ko`, and the
  selector's pass-threshold filter then declared pass as the best
  remaining option. The exact problem was even called out in a
  pre-existing TODO in `api/client.ts:321` ("wire move history into
  the bridge replay so KataGo's positional history matches ours").

  Fix: new `buildBridgeMovesFromGame(game, handicap, size)` helper in
  `gameStore.ts` builds the real GTP move list — handicap stones first
  as Black plays (KataGo's GTP accepts consecutive same-color plays),
  then `moveHistory` in chronological order with passes encoded as
  `'pass'`. Threaded as an optional `movesForBridge` field through
  `api.getAIMove` → `getAIMoveViaBridge` and through `api.finishMove`
  → `finishMoveViaBridge`. Falls back to `boardToMoves` if not
  supplied so any legacy caller still works. Verified output structure
  on both a 9×9 ko scenario (last emitted move is the ko-capturer) and
  a handicap=3 game (3 Black handicap moves at C3/G7/G3 emitted first,
  then play history). The pre-existing pass-fallback in the commit
  loop stays as a safety net for any other engine-vs-KataGo
  disagreement (e.g., a rare suicide edge case).

### Lesson worth keeping (followups)

Two of these three fixes (`fe800bc`, `1f9c2b2`) were the same iOS
safe-area pattern in two different new screens. Each new full-screen
view shipped during a feature build should pick up the App.css safe-
area-inset pattern as table stakes: `min-height: 100dvh`, side padding
from `--safe-left`/`--safe-right`, and `padding-top: calc(base +
var(--safe-top))` on the header. Easier to add once at scaffold time
than to remember each time.

---

## Session 17 — May 12–13, 2026

iPad-focused playtest pass on tutorial + small-board UX. Started with
two lesson layout bugs and finished with a bunch of tutorial-game-flow
polish (bot doesn't quit early, ko/suicide explainers, auto-end on no
legal moves, board not selectable) and a second wave of iPad responsive-
layout tuning (bigger boards in landscape AND portrait, square board
fix, horizontal Pass/Resign row, score-graph SVG cap).

### Lesson polish — fixed
- **Board shifted up/down between lesson steps** (commit `31b68f5`).
  The `.learn-feedback` div was conditionally rendered — present
  during awaiting/retry (~56 px tall via `min-height`) but
  *completely absent* during success/animating. That 56 px footer
  collapse let `.learn-board-wrap` grow, which on iPad landscape
  meant the board got taller (height-bound) and on iPad portrait
  meant the centered board shifted vertically. Fix: always render the
  `.learn-feedback` div; in success/animating it's an empty
  `aria-hidden` placeholder. CSS `min-height: 56px` stabilizes the
  slot so the board stays put.
- **Wrong second-move reset all the way to lesson start** in
  lessons 4 (Save Your Team) and 6 (Capture Race) (commit `1861b5b`).
  Both lessons have a `secondTurn` mechanic: user makes a first
  correct move, an `afterSuccess` auto-response lands, then the user
  must play a second move. The wrong-move branch was rebuilding the
  lesson's *initial* board and flipping `awaitingSecondMove` back to
  false — sending the player all the way back to redo the first move
  + watch the auto-response replay before getting another shot. Fix:
  capture a `secondTurnInitialBoard` snapshot when entering second-
  turn mode (after the auto-response lands), restore to *that* on a
  wrong second move. Player retries just the second step; the first
  move's progress isn't lost.

### Tutorial game-flow polish — fixed
- **Bot quits early in 5x5 / 9x9 tutorials.** A multi-iteration fix
  (4 commits before it really stuck): `7f3e0dc` introduced a
  `{ neverPass: true }` option that threads through
  `gameStore.requestAIMove → api.getAIMove → selectAiMove`. Several
  iterations later (`a8714f6 → daf7333 → 5aa986f`) closed every
  pass-leak in the selector:
    - Original logic gated on `lessonContext`. Gate refined to
      `lessonContext && _game.consecutivePasses === 0` so the bot
      reverts to normal pass-logic once the player passes — matches
      user spec "should pass if the player passes assuming the game
      is in fact over."
    - The selector's max-point-loss filter at 0.3 threshold dropped
      every non-pass candidate when KataGo's pass scoreLead was high.
      Eventually skipped the filter entirely in `neverPass` mode.
    - Three remaining null-return paths still leaked:
      - Eye-fill failsafe (5 retries all fill eyes → null): in
        `neverPass` returns the eye-fill anyway (bad move > quitting).
      - Branch 1 (KataGo's top is pass, no non-pass candidate): in
        `neverPass` falls back to `pickRandomLegal(board, color)`.
      - Branch 3 (filtered empty + top is pass): in `neverPass` scans
        full candidate list for any non-pass first, then
        `pickRandomLegal`.
  Stress-tested with KataGo returning ONLY pass as a candidate:
  0/30 passes in `neverPass` mode (same scenarios reliably pass
  without `neverPass`).
- **Auto-end tutorial games when no legal moves remain** (also in
  `7f3e0dc`). New `Board.hasLegalMove(color)` helper (clones each
  empty intersection and `tryPlay`s — O(size²), trivial at 5×5/9×9).
  New `lessonAutoPass(get, set)` helper that passes on behalf of
  `currentColor` when they have no legal moves, then recurses. Two
  consecutive auto-passes trigger the existing pass-pass scoring
  path. Wired into `requestAIMove` at the start (bot's turn, can't
  play) and after the bot's move lands (player's turn, can't play).
  Scoped to `lessonContext`.
- **Ko / suicide explainer modals** (also in `7f3e0dc`). New
  `ruleViolation: 'ko' | 'suicide' | null` state field + a
  `RuleViolationModal` component (reuses the BotPassedModal CSS).
  `playMove` sets the field when `_game.playMove` returns
  `MoveResult.Ko` or `MoveResult.Suicide`. Occupied stays silent
  (intuitive). Shows on every game — new players everywhere benefit.
- **Board canvas not text-selectable** (also in `7f3e0dc`). Added
  `user-select: none; -webkit-user-select: none; -webkit-touch-callout:
  none` to `.go-board-canvas`. Drag-to-place no longer starts a
  text selection on desktop; iOS long-press no longer pops the
  selection callout / magnifier. Text elsewhere unchanged.

### iPad responsive-layout second pass — fixed
After the responsive layout in Session 16, on-device testing surfaced
more issues. Three commits (`a8714f6`, `daf7333`, `8f1432d`) closed
them:
- **iPad landscape (wide, ≥ 1100px):** `.game-layout` swapped from
  flex-row to CSS grid. Avatar (top-left) + side panel (bottom-left)
  stack on a 260px left column; board fills the entire 1fr right
  column at `width/height: min(100cqi, 100cqb)` square (same
  container-query trick the lesson view uses). Board went from
  700×700 → ~917×917 on 1366×1024.
- **iPad portrait (medium + portrait):** side panel moves to a full-
  width row below the board (`width: 100%` so flex-wrap puts it on
  its own row). Hide the redundant game-info rows (turn-indicator,
  matchup, captures-display, move-counter) since the avatar strip
  already shows whose turn it is — mirrors the phone-portrait trim.
  Board went from 700×700 → ~846×846 on 1024×1366.
- **Score-graph SVG cut off in iPad portrait** (`daf7333`). The
  SVG declares `width="100%"` without a height attribute, so the
  intrinsic-sizing algorithm scaled its 200×70 viewBox proportionally
  — on a 1000px-wide side panel that meant a ~350 px tall graph (5×
  the design height). Cap the side-panel SVG to `height: 70px`.
- **Board rendering stretched non-square in iPad portrait** (`8f1432d`).
  CSS `width: 100% + max-height + aspect-ratio: 1` resolved to
  1000×846 (browser kept width=100% and cropped height), and the
  canvas's 700×700 internal coords drew stretched. Fix: set width
  itself to `min(100%, calc(100dvh - 520px))` so aspect-ratio
  resolves to a true square. Verified 846×846 at 1024×1366.
- **Pass / Resign stacked vertically and huge in iPad portrait**
  (`8f1432d`). Only the narrow rule was flipping `.control-buttons`
  to flex-row. Added the same row+wrap+`min-width: 120px` to iPad
  portrait — buttons share a row at ~480 px each instead of two
  full-width blocks.

### Lesson worth keeping
Multiple "still doesn't work" iterations on the same bug (the bot
keep-playing fix took 4 commits) usually means there are more
null-return paths in a function than your first scan saw. When a
"defend against passing" change still passes, audit *every* path in
the function that returns null/pass, not just the one you think
matters.

### Status of feature plans after this session
- **iPhone Pro Max (21) responsive coverage** continues to harden —
  every iPad-portrait fix here also benefits iPhone landscape and
  iPhone portrait since they share the medium/narrow blocks.
- **iPad portrait Known Bug** stays closed.

### Deferred to next session
- **Finish Game on iPad** — still held pending the user's parallel
  KataGo perf work.
- **Audio interrupted-state fix verification** — still awaiting next
  iPad repro of "sound dies."

### 19x19 30k bot — weakening pass (v3 → v4)
Playtest feedback: 30k feels too strong on 19x19, but not on 13x13 or
9x9. Diff'd the b28 30k profiles across boards and the 19x19 entry was
missing every "weakening knob" the smaller-board 30k profiles use —
strong `local_bias` (0.42 vs 0.80–0.87 elsewhere), no
`local_bias_in_opening`, no `clarity_prior` / `clarity_score_gap`, no
`pass_threshold`, and the tightest `max_point_loss` cap of any 30k
(18 vs 22–38). It was also nearly indistinguishable from 19x19 18k —
both inherited the same v3 heavy-noise template verbatim, leaving 30k
only marginally weaker than 18k.

**v4 change** ([b28.yaml](data/profiles/b28.yaml)):
- `local_bias` 0.42 → 0.80, added `local_bias_in_opening: true`
- `max_point_loss` 18 → 28
- Added `clarity_prior: 1.1`, `clarity_score_gap: 999.0`, `pass_threshold: 0.15`
- Core noise levels (visits=6, mistake_freq=0.75, random_move_chance=0.20)
  unchanged from v3.

**Calibration test (deprecated as a signal).** Tried to validate v4 by
running `30k+H9 vs 18k` on 19x19 with two b28 backends — target ~50%
since the user is designing a ranked-mode progression where players
advance from "beat 30k even" to "beat 18k at 9 stones." Built a
small asymmetric-rank harness (`calibrate_handicap_19x19_30k_vs_18k.py`,
removed after use) and ran 4 games. **Result: 4/4 sweep for 30k+H9
with margins +267 to +387** (avg +347 on a board with max ~361).
Pushed an aggressive v5 (visits 6→3, mistake_freq 0.75→0.88, rand
0.20→0.40, max_pl 28→45, opening_moves 8→2) — 2/2 sweep, avg +385.
**Cutting MCTS depth in half and doubling random play made the margin
worse, not better.** Diagnosis: the handicap-defender's noise
(local_bias plays roughly correct reactive moves) is cheap, while the
attacker's noise (`mistake_freq=0.72` blunders during invasions) is
catastrophic. Cross-rank handicap bot-vs-bot is a broken signal for
profile tuning. Rolled back to v4 for human-playtest validation. Saved
the limitation as a memory.

**Concurrent product-design implication.** For the ranked-mode
progression (beat 30k → beat 18k+H9 → … → beat 18k+H0), the 18k+H9
challenge needs the 18k bot to win some games against a beginner human;
if a near-random 30k bot defeats 18k+H9, a beginner human almost
certainly will too. Either 18k needs strengthening or the 9-stone
handicap is too generous at that tier. Deferred to playtest.

## Session 16 — May 7–8, 2026

iPad/iPhone playtest pass. Started with four bugs from the 2026-05-07
session (Resign winner, rapid-tap turn flip, Finish Game on iPad, sound
death) and finished with a full responsive layout shipping iPhone
support alongside the iPad portrait fix.

### iPad bugs from playtest — fixed
- **Resign credited the wrong winner.** Resign button was clickable
  during the bot's turn, and `Game.resign()` computed
  `winner = oppositeColor(currentColor)` — which gives the *player* the
  win when they click while it's the AI's turn (the common case on iPad
  where bots take ~5s). Disabled the button on `aiThinking`, added an
  optional explicit `loser` arg to `Game.resign()`, and fixed the
  matching backend `state.py:resign` to use `game.player_color` instead
  of the `currentColor`-based heuristic. Unit test in `Game.test.ts`
  locks the contract. (commit `ccd2afe`)
- **Rapid clicks during the bot's turn flipped the bot to playing as
  Black.** `aiThinking` wasn't set true synchronously when the player
  tapped a stone — only after `/move` POST resolved + a 400 ms timeout
  fired. In that window, `pass()` (which only checked `aiThinking`, no
  color guard) would record a *White* pass, then `requestAIMove`
  fetched the now-Black-to-move server state and posted a Black stone
  via `/move`. Set `aiThinking: true` synchronously in `playMove()`
  the moment the local stone lands; added `currentColor !== playerColor`
  guard to `pass()` for belt-and-suspenders. (commit `ccd2afe`)
- **Finish Game on iPad** — was already fixed in `origin/main` commit
  `d34ab1b` from the previous session; local was just behind. Replaces
  the server-side batch `auto_complete` (one POST → 100+ analyses →
  final state, hits iPad URLSession timeout) with a per-move
  `/finish-move` endpoint driven by a self-recursive frontend loop.
  Each move animates and plays a sound. **Update from playtest 2026-05-08:
  this is *still not working* on iPad — see Known Bugs.**
- **Sound dies after several games.** Likely-fix-plus-diagnostics
  shipped: `resumeAudio()` now triggers on any non-running
  `AudioContext.state` (was `=== 'suspended'` only — missed the
  iOS-specific `'interrupted'` state that follows notifications, lock
  screen, Siri, etc.) and logs the prior state on every resume attempt.
  Awaiting playtest confirmation — if the bug recurs the Xcode console
  will show which state we couldn't recover from. (commit `219aaca`)

### iPhone Pro Max support + iPad portrait responsive pass
The iPad portrait clipping bug and iPhone Pro Max support were the
same problem (the layout was fixed-shape ~1208 px wide; everything
narrower clipped). Single responsive pass shipped both:
- **Three-tier layout** in `App.css`:
  wide (≥ 1100 px, current iPad-landscape three-column) /
  medium (700–1099 px, avatar strip on top + board+controls below — covers
  iPad portrait + iPhone Pro Max landscape) /
  narrow (< 700 px, stacked vertical — iPhone Pro Max portrait) /
  phone-landscape (max-height: 500 + landscape, forces row layout
  with `.app { height: 100dvh; overflow: hidden }` so the board can
  height-bind via the canvas's `height: 100%`).
- **Board canvas display-responsive.** `CANVAS_SIZE = 700` stays as
  internal resolution; display rectangle CSS-driven via a new
  `.go-board-canvas` class with `width: 100%; max-width: 700px;
  aspect-ratio: 1`. `toBoard()` already converts rect coords → canvas
  coords, so hit-testing carries over. Phone-landscape branch flips to
  height-bound (`width: auto; height: 100%; max-width: none`).
- **iOS-side: zero work.** `TARGETED_DEVICE_FAMILY = "1,2"` and the
  Info.plist orientation keys for iPhone+iPad were already set in the
  iPad target — next Xcode rebuild produces a universal binary.
- Per-screen passes: HomePage (title scales, action buttons stack on
  phone, bot strip scrolls horizontally), LearnView (compact header,
  scrollable progress dots). All dialogs already used `min(X, 92vw)`
  patterns and adapted naturally.
- Touch + safe-area: `viewport-fit=cover` + safe-area-inset CSS vars
  threaded through app shell, header, settings gear, feedback button.
  Canvas gets `touch-action: manipulation`. `.btn` bumps to 44px
  min-height on medium/narrow per Apple HIG. (commit `2ae8526`)

### iPad/iPhone polish from real-device playtest (2026-05-08)
- **Lesson canvas stretched non-square** in both iPad orientations.
  My new `.go-board-canvas { max-width: 700px }` capped lesson canvas
  width at 700 while LearnView's `width/height: 100% !important`
  overrode width-but-not-max-width and let height fill the (larger)
  parent. Override `max-width: none` in `.learn-board-square canvas`
  so the lesson container's `min(100cqi, 100cqb)` stays in charge.
  (commit `d381c7b`)
- **Captures + komi were hidden** on medium/narrow viewports (the
  responsive pass collapsed them to keep the avatar strip thin). Back
  in place, compacted: medium gets a single horizontal row of mini
  stones inside the existing tray; phone landscape shows just the
  count badge (90 px column too tight for stones); phone portrait
  collapses each tray to a single thin label line ("Captures 1" /
  "Komi 6.5") with no stones, no background. (commits `d381c7b`, `03f64e6`)
- **Active-player indicator was too subtle.** Border 1 → 2 px,
  layered glow (2 px ring + 22 px + 44 px bloom replaces the single
  12 px / 0.15 glow), status text "Playing"/"Thinking" 11 → 13 px,
  weight 500 → 700, new pulsing `::before` dot. Inactive card fades to
  0.55 opacity via `:has(.player-card-active)` so the active one pops
  by contrast. iOS Safari 15.4+ supports `:has()` so the WKWebView is
  fine. (commit `d381c7b`)
- **Phone portrait pushed Pass/Resign off-screen** when the score
  graph was on. The `.game-info` row below the board was rendering
  *everything* — turn indicator, matchup, captures, move counter,
  score graph — even though the avatar strip already shows whose turn
  it is (active glow), the names, the matchup, and the captures
  (count badges in each card). All redundant on phone. Hide the
  redundant bits on `max-width: 699px`; only the score graph stays.
  Strip the `.game-info` chrome (background/padding/border) when
  only the graph is left. Player cards also tightened: tray padding
  + background go transparent, mini-stones drop, just thin label
  lines remain. Card height roughly halves. (commit `03f64e6`)
- **Phone landscape was hiding the score graph** despite plenty of
  vertical room in the 180 px side panel. Earlier responsive pass
  dropped it preemptively; brought it back. The 70 px-tall chart sits
  above the Pass / Undo / Resign buttons. (commit `03f64e6`)

### Mid-game AI stall fix
Bug surfaced in iPad logs: bridge analyzed fine but the follow-up POST
`/move` failed with `TypeError: Load failed` (WebKit's network-leg-
never-completed error), leaving the game stuck because the catch in
`requestAIMove` only cleared `aiThinking` without retrying. The fetch
helper in `api/client.ts` now retries up to 2 times on `TypeError`
only (300 ms + 900 ms backoff). HTTP errors don't retry — those are
real responses where the server saw the request. Why duplicate POST
`/move` retries can't double-play: TypeError specifically means the
request never reached the server, so server state hasn't changed.
Verified the retry path with injected fetch failures (3 attempts,
1206 ms elapsed, HTTP errors after retries succeed don't retry).
(commit `d9aaf4e`)

### Placement accessibility on small viewports
Real-device test of 19×19 on iPhone Pro Max showed that mis-placing
stones is a real problem — finger-sized targets on small intersections,
no preview before commit, no way to magnify a region. Three-layer
solution shipped:

1. **Hold-to-hover-then-place** (commit `bbb1176`). Switched the canvas
   from `onClick` + `onMouseMove` + `onMouseLeave` to unified pointer
   events with `setPointerCapture`. A tap-and-immediately-release still
   commits at the touched intersection (preserves the "tap to place"
   muscle memory for confident users), but a press-and-drag lets the
   player slide a ghost stone around until they're happy and release.
   Releasing OFF the canvas (or via pointercancel) aborts — the fat-
   finger escape hatch. Same flow for touch and mouse, so desktop
   users also get the click-and-drag-away-to-abort behavior.
2. **Red crosshair through the hover point during press** (commit
   `17fcd6b`). The ghost alone wasn't enough — a fingertip covered it.
   Thin red lines spanning the full row + column of the target
   intersection extend past the fingertip on every side, so the
   placement target stays visible. Crosshair color dims (`rgba(255,90,
   90,0.55)`) when pressing on an occupied intersection so "won't
   place here" reads without yelling.
3. **Pinch-to-zoom + double-tap reset** (commit `fbdd0c7`). Two-pointer
   pinch scales [1, 3] and keeps the midpoint between fingers anchored
   under them as the user zooms; pan clamped so the board can't be
   slid off-screen. Transform applied as CSS on the canvas element —
   no canvas-internal redraws, browser composites the zoom smoothly,
   and `toBoard()` works unchanged because `getBoundingClientRect`
   already returns the transformed rect. Double-tap detection (within
   280 ms / 30 px of previous tap) resets the transform AND cancels
   the pending commit — only works when zoomed, so non-zoomed play
   stays instant. When zoomed, single-tap commits defer 200 ms so the
   double-tap window can intercept. `touch-action: none` on the
   canvas overrides the wider `manipulation` so iOS doesn't grab the
   pinch for its own page-zoom. Transform auto-resets on game / lesson
   / replay changes.

### Phone-landscape polish (2026-05-08)
On-device test of the phone-landscape layout surfaced three issues, all
fixed in commit `b0dc91b`:
- **Player card text overflowed** the 90 px avatar column — a 56 px
  avatar + horizontal layout left only ~12 px for the name, so
  "Seedling (30k)" wrapped messily. Switched `.player-card-header`
  inside `.avatar-panel` to column flex on phone landscape: avatar
  (shrunk to 40 px) sits centered above the name + status which now
  span the full card width.
- **Top header bar ate ~57 px** of the 430 px viewport height.
  `.app-header` now `position: absolute` in the top-right corner on
  phone landscape; title hidden (not informative), buttons compacted
  to 28 px tall × 11 px font. Board can now extend edge-to-edge
  vertically. Side panel picks up `padding-top: 32px` so its score-
  graph / result content doesn't sit under the floating buttons.
- **Coordinate labels** were a thin 10 px monospace, washed out on
  19×19 and on small phone-landscape displays. Bumped to
  `'700 12px monospace'` everywhere.

Followup: coordinate labels needed clearance from the board edge
(commit `a393488`). They were drawn at x/y=15 inside a board rectangle
that starts at 10 px in, so glyph tops at y=9 sat on the dark canvas
background outside the board — reading as visual clipping on letters
with ascenders. Moved to 24 px so the full glyph sits inside the
warm board surface with a clean gap to the first grid line.

### Lesson worth keeping
The iPad and iPhone responsive bugs were structurally the same
problem (fixed-shape layout overflowing narrower viewports), so a
single pass handled both. Whenever a layout-clip bug shows up, check
whether other narrower viewports have the *same* bug before jumping
to a viewport-specific fix.

### Status of feature plans after this session
- **21 (iPhone Pro Max support)** — bumped Planned → Beta. Frontend
  is responsive at all four target viewports; iOS rebuild produces a
  universal binary automatically. CoreML on iPhone Neural Engine
  re-test still pending (A17 Pro / A18 Pro vs M-series tuning).
- **iPad portrait Known Bug** — closed.
- **Finish Game iPad-only Known Bug** — was thought closed; reopened
  after 2026-05-08 playtest, see Known Bugs.

### Deferred to next session
- **Finish Game on iPad still broken.** Same hypothesis as before:
  full-strength KataGo at 500 visits on Render b20 takes ~5 s per
  call; over a 50-move endgame, individual calls can hit cold-start
  contention or transient slowness > 60 s URLSession timeout. **Held
  off on the parked frontend/backend fix** (drop visits 500 → 150,
  add loop-level retry, add `[finishGame]` diagnostic logs) — the
  user is doing parallel performance work that may speed KataGo
  enough to make finish-game work as-is. If finish-game still fails
  after the perf work lands, revisit with the parked proposal.
- **Audio interrupted-state fix verification** — shipped + diagnostic
  logs, awaiting next iPad repro of "sound dies" to confirm the fix
  worked or surface a different state to handle.
- **Real-iPhone CoreML inference re-test.** Native ANE config was
  tuned for M-series (`numNNServerThreadsPerModel = 1`,
  `coremlDeviceToUse = 100`); A17/A18 Pro may want different tuning
  (per [iPad gotcha #14](#)). Test after first iPhone install.

## Session 17 — May 12, 2026

Phase D bug-fix pass driven by an iPad playtest. Started with two
on-device commits already in the tree from earlier in the day (Phase D
commits 1+2 + a partial ownership sign-convention fix), then closed
three real bugs the playtest surfaced and converted the end-game UI to
a modal so iPhone portrait stops cutting off the score breakdown.

### Phase D scoring sign-convention — *actual* fix

Earlier today commit `fe2f4d3` shipped an "ownership sign convention"
fix that negated KataGo's GTP output unconditionally, on the theory
that after two passes `currentColor` is always Black so we always send
`color: 'B'` to the bridge. The theory was wrong — parity depends on
the move count before the passes — and a 19×19 playtest immediately
hit the broken branch: 260 moves, pla=B at scoring time, raw ownership
values all ≈ −1 (correctly reporting "Black owns" under KataGo's GTP
"+1 = player-to-move owns" convention), router negated them anyway,
**238 stones marked dead, final score winner=white black=122 white=140.5**.

Root cause confirmed against `ios/KataGo/cpp/command/gtp.cpp:983` — the
GTP layer outputs `+1 = pla` regardless of which color pla is; the
internal `whiteOwnerMap` already gets flipped when `pla == BLACK` so
the *output* is always "from the player-to-move's view." To get to
`applyOwnership`'s "+1 = Black owns" contract we negate iff
`colorChar === 'W'`, not always.

- Replaced the unconditional `result.ownership.map((v) => -v)` in
  `deadStonesViaOwnership` with a conditional negate based on
  `colorChar`. Comment block rewritten to point at `19x19scoring.log`
  as the smoking gun + cite the KataGo source line.
- New unit test in `localGameRouter.test.ts` — *"removes dead stones
  correctly when scoring pla is Black (regression: 19x19scoring.log)"*
  — plays 14 moves on a 5×5 to force `currentColor = Black` at scoring,
  stubs the bridge with all-positive ownership (the pla=B convention
  for a Black-controlled board), asserts winner is Black. Existing
  pla=W test stays — together they pin both branches.

### Finish Game on iPad — *actually* working now

The reopened bug from Session 16 ("d34ab1b shipped, still broken on
iPad"). Two layers of fix:

1. **Route through the bridge.** `api.finishMove` was hard-wired to
   HTTP `/games/{id}/finish-move` with no bridge fallback — but iPad
   games only exist in localStorage, so the request hit Render with a
   game_id Render had never heard of, threw, and `gameStore.finishGame`'s
   catch block silently halted the auto-loop. The Xcode log captured
   the smoking gun at `19x19scoring.log:70745`:
   `[JS warn] finish-move failed: Ot@app://localhost/...`.
   New `finishMoveViaBridge` in `client.ts` runs the same loop locally:
   one bridge.analyze per call, play the top candidate via
   `localGameRouter.playMove`, return one `AIMoveDTO`. The gameStore
   loop drives it until two passes trigger on-device scoring.

2. **Don't use the rank-calibrated selector for finishing.** First cut
   delegated to `getAIMoveViaBridge('1d')`. Playtest: the kid bot
   torched an 8-point Black lead during auto-finish, because every
   b28 profile (including 1d) has deliberate `mistake_freq` injection
   for kid-friendly play — exactly wrong for endgame wrap-up. Switched
   `finishMoveViaBridge` to bypass the selector entirely and play
   KataGo's actual top candidate, matching the backend's
   `state.py:331` semantic (full-strength KataGo, top pick only).

3. **Use Japanese rules, not Tromp-Taylor.** Even at full strength the
   bot kept filling its own liberties forever. Cause: tromp-taylor is
   area scoring, under which playing in your own territory is
   point-neutral, so KataGo has no incentive to ever pass. The backend
   uses japanese (`engine.py:160`); our local `Game.score()` is
   territory-style too. Aligned the rules string, added an explicit
   pass-threshold check (`FINISH_PASS_THRESHOLD = 0.5`) that triggers
   when pass is in the candidate list with reasonable visits and
   within 0.5 points of best — matches the selector's normal pass logic.

4. **Ko fallback.** `boardToMoves` sends only current stone positions
   to the bridge — no move history — so KataGo can't see our
   positional-superko bans. Kid plays a capturing move into a ko shape,
   hits Finish Game; KataGo (history-blind) suggests the immediate
   recapture; our engine rejects `MoveResult.Ko`; `unwrap` throws; loop
   halts. Wrapped the `api.playMove` call in `getAIMoveViaBridge` and
   `finishMoveViaBridge` in try/catch — on rejection, fall back to a
   pass. Self-heals within one iteration (other side moves → ko clears).
   Followup task to send actual move history is filed.

### End-game UI converted to a modal

Inline `.game-result` block in `GameControls` was getting cut off
below the viewport on iPhone (the side panel doesn't scroll on narrow
widths) — score breakdown invisible to anyone on a phone.

- New `GameEndModal` (full-screen overlay + centered card) and
  `GameEndPanel` (compact "See results" pill in the sidebar after
  dismiss). Replaces the cut-off inline block. Pattern lifted from
  `LessonGameEndModal`; the two modals share CSS classes.
- Adaptive framing: AI games show "You won!" / "Seedling (30k) wins"
  using the bot's actual name from `gameStore.botName`; local games use
  "Black wins" / "White wins"; bot-vs-bot uses both bot names.
- New `gameEndDismissed` state in gameStore, mirroring
  `lessonGameEndDismissed`. Resets on `newGame`.
- Mounted at App level with `onQuit={() => setShowHome(true)}` so the
  Quit button drops back to the home screen.

### Layout fixes around the new modal

- **Modal cut off in landscape.** Card is `width: min(460px, 92vw); max-height: 90vh`.
  iPhone landscape is ~390pt tall → 90vh ≈ 351pt, card content was
  ~440pt, buttons just under the fold. `@media (max-height: 500px)`
  trims padding / icon / title / button sizes by ~120pt total — fits
  cleanly on iPhone, iPad landscape is unaffected (820pt tall).
- **Compact panel overlapped its own title in landscape.** Side panel
  in phone landscape is 180px wide; the horizontal `[icon] [text]
  [button]` flex doesn't fit, button has `flex-shrink: 0`, was sitting
  on top of the title text. Same media query stacks the pill vertically
  in landscape — icon hides (redundant with title), button takes the
  full width on its own line below.
- **Settings gear overlapped the bottom controls in iPhone portrait.**
  Gear at `bottom: 14px` sat on top of the Pass / Resign / Finish
  Game row that stacks below the board in narrow layouts. Bumped to
  `bottom: 72px` inside the `max-width: 699px` breakpoint — clears the
  touch-target row with breathing room.

### Files touched

- `frontend/src/api/client.ts` — new `finishMoveViaBridge`, bridge-aware
  `api.finishMove`, ko-fallback try/catch in `getAIMoveViaBridge`
- `frontend/src/api/localGameRouter.ts` — conditional negate in
  `deadStonesViaOwnership`, header comment rewrite
- `frontend/src/api/__tests__/localGameRouter.test.ts` — pla=B
  regression test
- `frontend/src/components/GameEndModal.tsx` — new, exports
  `GameEndModal` + `GameEndPanel`
- `frontend/src/components/LessonGameEndModal.css` — landscape media
  query (benefits both modals)
- `frontend/src/components/GameControls.tsx` — replaced inline
  `.game-result` block with `<GameEndPanel />`
- `frontend/src/App.tsx` — mount `<GameEndModal onQuit={…} />`
- `frontend/src/store/gameStore.ts` — `gameEndDismissed` state +
  dismiss/reopen actions
- `frontend/src/App.css` — gear repositioning under 699px breakpoint
- `.gitignore` — root-level `*.log` (Xcode playtest dumps)

All 56 unit tests pass; `tsc --noEmit` clean.

### Followups
- **Send move history to the bridge** (not just current stones) so
  KataGo's positional-superko tracking matches ours. Eliminates the
  ko-fallback (becomes dead code). Spawned task; deferred because the
  fallback is safe and the playtest can proceed without it.
- **Dead `.game-result` / `.score-breakdown` CSS** in `App.css` —
  inline block was removed but the rules still live there. Easy cleanup.

## Session 15 — May 5–6, 2026

Closed out the first-cut Learn-to-Play arc. Lessons 1–11 now form an
end-to-end intro that takes a first-timer from "what's a stone" through
two-eye life-and-death and onto a real 9×9 game. Calling this v1 done —
more concept lessons (ladders, nets, sente/gote, endgame counting) wait
for real playtest data to tell us where kids actually stall.

### New: Lesson 10 "Two Eyes" — three-part puzzle series

Needed a third lesson kind. `puzzle` and `quiz` were the existing two;
`puzzle-series` is new — a list of one-move sub-puzzles, each with its
own board / userPlays / validate / success copy, separated by a "Next
puzzle →" modal between parts.

Three parts, all on 9×9, player as Black throughout:

1. **Make Life** — black 5-wide ring with 1×3 internal eye-space, white
   surround. Play the vital point E7 → splits the inside into two real
   eyes.
2. **Take Life** — same shape but inverted colors (white ring, black
   surround). Same vital point — but now playing it KILLS instead of
   saving.
3. **Too Big to Kill** — wider white ring with 1×4 internal. Player
   attacks anywhere inside; white auto-replies with the inner cell of
   *opposite parity to the user's column* so the response is always
   legal AND always lands on an inner cell, leaving the two outer
   empties (3,3) and (3,6) as the eye-regions in every scenario.

The function-of-user-move response in Part 3 needed a small framework
extension (`responseFor: (userMove) => Point` on `PuzzlePart`). Cleaner
than wedging it into a static `afterSuccess.point`. Two more
`PuzzlePart` fields landed at the same time:

- `successHighlight` — points highlighted AFTER the auto-response fires.
  Bug-fix in passing: GoBoard wasn't reading puzzle-series part-level
  highlights at all. Now it does, plus an `eyeHighlight` override for
  pointing at newly-formed eye-regions.
- `playoutAfter` — chained background moves that resolve a sequence on
  the board while the success modal is up. Used in lesson 10 Part 2:
  player takes the vital point → "Vital point taken!" modal pops →
  background plays out white's last-ditch extension + black's capture,
  visible on the board behind the modal.

### Lesson 9 "Safe or Gone?" polish

Three quick wins on the existing quiz:

- **Black surround on every board.** Q1 (rabbity-six, Safe) gets a black
  wall on the row below; Q2 (single-eye ring, Gone) is fully ringed; Q3
  (T-shape, Gone) is surrounded with one liberty left. Reads as actual
  surrounded fights instead of floating shapes.
- **Kill move plays automatically on "Gone" answers.** Q2's eye gets a
  black stone, all 8 white stones come off with the capture animation +
  sound, then the success modal pops in ~900 ms later. Same for Q3.
  More fun than just a modal.
- **Triumphant two-eyes sound** on Q1's correct "Safe" answer. New
  `playTwoEyesSound()` in the SoundManager — two ascending chimes (one
  per eye) followed by a sustained major triad (C-E-G) with a slow
  decay. Cosmic + classic packs. Same sound also fires when the player
  makes two eyes in lesson 10 Part 1, and when white's reply forms the
  eye-regions in lesson 10 Part 3.

### Lesson 11 "Count Your Land" — territory overlay

Final summary screen now switches the board into the same territory-dot
rendering the in-game scoring screen uses. Computed from the quiz
questions' `highlight` arrays (Q1's points = Black's territory, Q2's =
White's). Visual consistency with the real game — kid sees the same
dots they'll see at the end of every match.

### Modal redesign

The success modal used to cover the middle of the screen with a
darkened backdrop, blocking the board. Now it anchors at the bottom of
the viewport with no backdrop and `pointer-events: none` on the wrapper
(card itself re-enables them). Slide-up animation, stronger drop
shadow. Board is fully visible behind it — necessary for the kill
animations and `playoutAfter` sequences to actually be watchable.

`tryMove` already rejected clicks during `success`/`animating` so there
was no risk to letting clicks pass through.

### Smaller polish

- Lesson 8 (Two Eyes = Forever Safe) shape shifted one column left so
  the right wall isn't pressed against the board edge.
- Lesson 10's three boards shifted up two rows so the bottom-anchored
  modal has breathing room over the play area.
- "Try another move" button on lesson 8 — when the player clicks an eye
  and gets the suicide-discovery success, they can click the OTHER eye
  to confirm without losing completion. Opt-in via
  `exploreAfterSuccess` on the Lesson type.

### Status of feature plans after this session

- 03 (Concept lessons): 🧪 Beta — first-cut arc shipped, 11 lessons live.
  Next batch waits for real-user playtest data.

---

## Session 14 — May 4, 2026 (continuation)

iPad gets the rest of the way to a finished app. Path C (TypeScript port
of `move_selector.py`) and Phase 3 (bundle the React frontend into the
app) both shipped in one push. The iPad now plays b28-calibrated bots
that match web strength rank-for-rank, and ships its own UI rather than
loading from Render.

### Path C — `move_selector.py` ported to TypeScript

Mechanical translation, ~280 lines of TS mirroring the 540-line Python.
The Python remains the source of truth; TS is the iPad copy until smoke
testing builds enough confidence to consider removing it.

- `frontend/src/ai/profileLoader.ts` mirrors `profile_loader.py`. Imports
  `data/profiles/b28.yaml` at build time via `@rollup/plugin-yaml` —
  single source of truth shared with the Python backend, no JSON
  conversion step. Vite's `server.fs.allow: ['..']` lets the import reach
  outside the frontend root into the repo's `data/profiles/`.
- `frontend/src/ai/moveSelector.ts` mirrors `move_selector.py` heuristic-
  for-heuristic: eye-fill safety with 5-attempt retry, 30k pure-heuristic
  atari/capture/local path, KataGo-backed pass detection (with the
  min-pass-visits gate), tactical clarity gate, opening top-3 sampling
  weighted by visits, random move injection, local bias, max_point_loss
  candidate filter, and mistake-injected weighted selection.
- The bridge surface flipped: the old `window.kataGo.aiMove(...)` is gone;
  `analyze(...)` returns the full KataGo candidate list (move, visits,
  winrate, prior, scoreLead, order). The TS selector picks the move
  locally — bridge is intentionally dumb. scoreLead is normalized to
  black's perspective at the bridge boundary.
- `api.getAIMove(gameId, targetRank?)` takes an optional rank now.
  `gameStore` passes `targetRank` for single-player and side-of-turn rank
  for bot-vs-bot. Web HTTP path ignores it (backend reads target_rank
  from the active-game record).

Smoke-tested on M1 iPad: bridge fires, KataGo returns 1+ candidates per
analyze, selector picks a sensible move, score graph still updates from
the bridge's scoreLead. Not the full rank-by-rank smoke matrix — that's
deferred until the user can play a few real games.

### Phase 3 — bundle the React frontend

Two-track problem: the universal config changes that affect both web and
iPad, and the iOS-specific work to actually load the bundle.

**Universal:**
- Vite `base: './'` so asset URLs in built `index.html` are relative
  (`./assets/foo.js` instead of `/assets/foo.js`). Works under both
  `https://` (Render) and the `app://localhost/` we landed on for iPad.
  Hash routing means SPA paths stay at `/` so this is safe for web.
- `index.html` got `./vite.svg` instead of `/vite.svg` and a real title
  ("GoForKids" instead of "Vite + React + TS"). Both shipped harmlessly
  to web users.

**iOS:**
- Xcode Run Script "Bundle React frontend": `cd frontend && export
  VITE_API_BASE_URL=https://goforkids-api.onrender.com && npm run build &&
  cp -R dist/* "<App>.app/web/"`. Runs every build; takes ~2-3s.
- `ContentView.swift` rewrite: instead of loading from Render's URL,
  loads `app://localhost/index.html` via a custom URL scheme handler.

### The blank-screen detour (real source: WKWebView refuses ES modules over file://)

Phase 3 looked done after the run script worked — `cp -R` populated the
bundle, `loadFileURL` opened the page, JS shim ran (we got the ping
message). But the React app silently never mounted. Black screen.

Trace was painful. Without Web Inspector (user preference) we had no
visibility into JS errors. Built diagnostic plumbing into the bridge:
console.{log,info,warn,error} interception, `window.onerror` capture-
phase listener (catches script load failures that don't bubble), 2-second
post-load DOM snapshot. Surfaced the actual error in one round-trip:

```
[JS error] resource load failed: SCRIPT
  file:///.../KataGo iOS.app/web/assets/index-Bg6RR7q8.js
```

WKWebView refuses to execute `<script type="module">` over file://. Well-
documented restriction; the standard fix is a custom URL scheme handler.

`WebBundleSchemeHandler` (~50 lines) implements `WKURLSchemeHandler` for
the `app` scheme. Registered on the WKWebViewConfiguration, it serves
files from `<App>.app/web/` on demand. The page loads via
`app://localhost/index.html`, has a real origin (`app://localhost`), and
ES modules work. Backend CORS allow-list extended to include
`app://localhost`.

The diagnostic plumbing stayed — `[JS log]` / `[JS error]` / etc lines
in the Xcode console are now permanent and free.

### Things that bit us this session

- **Render auto-deploy timing.** Path C frontend changes need to deploy
  to Render BEFORE rebuilding the iPad app, or the WKWebView loads the
  old client.ts that calls the deleted `bridge.aiMove()` instead of the
  new `bridge.analyze()`. Cost ~5 min before that clicked.
- **Xcode 16 Run Script default body.** When the user pasted my script,
  Xcode's placeholder comment ("Type a script or drag a script file from
  your workspace to insert its path.") leaked onto the same line as the
  trailing `ls "${DST}"` diagnostic, producing `ls "${DST}"insert its
  path.` — three bogus arguments and a non-zero exit. README now
  explicitly warns to clear the placeholder before pasting, and the
  diagnostic line is gone.
- **`crossorigin` attribute on Vite-built script tags.** Stripped in the
  Run Script via `sed` belt-and-suspenders. Custom scheme handler made
  it unnecessary, but no harm in keeping the strip.
- **Score graph "didn't render in production" replay.** Forgot during
  Path C smoke test that `showScoreGraph` defaults to false in
  localStorage and the iPad install is a fresh origin. Same bug, second
  appearance, still fixed by toggling Settings.

### Architecture after this session

```
┌──────────────────────┐                ┌──────────────────────┐
│      iPad app        │                │       Render         │
│                      │                │                      │
│ WKWebView            │                │  goforkids-api       │
│  (app://localhost)   │   game state   │  FastAPI + KataGo    │
│        │             │   /move /pass  │  (CPU, b20 default)  │
│        ▼             │ ◄────────────► │                      │
│ Bundled React app    │                └──────────────────────┘
│ (frontend/dist)      │
│        │             │
│        ▼             │
│ window.kataGo        │
│        │             │
│        ▼             │  AI inference + selection 100% on-device.
│ KataGoBridge.swift   │  TS selector consumes b28.yaml (same file
│ (analyze only)       │  Render's Python uses) for rank profiles.
│        │             │
│        ▼             │
│ KataGoHelper.mm      │
│ → CoreML on ANE      │
└──────────────────────┘
```

Single source of truth for everything calibration-related:
`data/profiles/b28.yaml` shared between TS (iPad) and Python (Render).
Single source of truth for UI: `frontend/src/`. The bridge detection in
`client.ts` is the only frontend code that knows whether it's running on
the iPad or the web.

### Roadmap update

| Phase | Status | What |
|---|---|---|
| 2A | ✅ Done | Native bridge for AI moves + scoreLead |
| C  | ✅ Done | TS port of `move_selector.py`; iPad bots b28-calibrated |
| 3  | ✅ Done | Bundle React UI in app; loads via `app://` custom scheme |
| D  | next | Port game state (board/captures/ko/scoring) to TS so iPad doesn't need Render at all (~6-10h, mostly mechanical) |
| Hygiene | when convenient | Bundle Identifier from `ccy.KataGo-iOS` to phasesix-branded |
| Smoke matrix | when convenient | Real games at each rank × board on iPad to confirm the b28 calibration carried over correctly |

### Lesson worth keeping

Diagnostic plumbing pays. The bridge's `[JS error]` / `[JS log]`
forwarding took 30 minutes to write and immediately surfaced the
ES-module-under-file:// failure that would have taken hours to find by
guessing. It's now permanent infrastructure — every JS error from now on
shows up in Xcode console without any ceremony. Worth the upfront cost
on any system that has a hard-to-inspect runtime.

### Deferred to next session

- Phase D: TS port of game state (Board/captures/ko/scoring) to make
  iPad fully offline. Largest remaining iPad piece.
- Smoke matrix on iPad (each rank × board) to confirm Path C parity
  with the Python.
- Optional: remove `move_selector.py` from the iPad code path (already
  not invoked from iPad — purely cleanup).
- Custom domain registration (still deferred from Session 11)
- Sentry + Plausible analytics (still deferred from Session 11)

---

## Session 13 — May 1 - 4, 2026

Feature 20 (b28 bot calibration) — start to finish in one extended push. All
16 explicit profiles calibrated against the b20 baseline, infrastructure
to swap models in place, then a strategic retreat on the production deploy
because b28 is too slow on Render Standard.

### Phase 1 — YAML refactor (load-bearing prerequisite)

Three commits before any calibration could even start. The 350+ lines of
hardcoded `RANK_PROFILES_*` dicts in `move_selector.py` got pulled into
`data/profiles/b20.yaml` (verbatim translation, AST-diffed against the
original to confirm zero drift). New `app/ai/profile_loader.py` reads the
file referenced by `CALIBRATION_PROFILE_PATH` at runtime with the same
fallback semantics (size → 19x19 → 15k). `move_selector.py` shrank from
888 lines to 541, calibration is now an edit-and-rerun loop instead of
edit-restart.

Docker context expansion was the unexpected gotcha here. `data/profiles/`
lives at the repo root but the build context was `./backend`, so the YAML
wouldn't have been available in the production image. Fixed by moving the
build context up to repo root (changes in `docker-compose.yml`,
`render.yaml`, root `.dockerignore`). That cascaded into discovering three
*more* Docker bugs: `platforms: [linux/amd64]` had to move under `build:`
instead of just `service:` so cross-arch builds worked on Apple Silicon;
the KataGo AppImage wouldn't execute under buildx + QEMU emulation
(`Exec format error`); and `unsquashfs` without a manual offset returned
"no superblock" because grep'ing for the `hsqs` magic finds a false
positive at byte 194134 inside the runtime ELF — fixed by parsing the ELF
section header table to compute the real squashfs offset.

### Phase 2 — calibration harness

`data/calibrate_b28.py` runs head-to-head matches between two backend
instances on different ports with different model+YAML pairs. Per-game
protocol: each backend creates a parallel game, the "owner" backend (the
one whose AI plays the current color) runs `/ai-move`, and the chosen
move is mirrored to the other backend via `/move` or `/pass`. Color
ownership alternates per game so first-move advantage washes out.

One subtle bug surfaced: the harness's first design did a follow-up
`GET /games/{id}` to read the result, but the backend deletes the
active-game row when `_score_game_async` runs, so the GET 404'd. Fix:
extract the result from the response body of the call that ended the
game — `/ai-move` surfaces it via `final_state`, `/pass` and `/move`
inline. No more trailing GET.

Phase 0 sanity (mandatory before tuning anything): 100 games at 15k 9×9,
*both* backends running b20 + b20.yaml. Hit 55/100 = 55.0% (95% CI
45.2-64.4%, margin +7.24). Inside the 45-55% target band; harness was
measuring correctly.

### Phase 3 — the silent stub-AI disaster

First half-day of "real" calibration runs were silently invalid. The
`backend/models/b28.bin.gz` file in the working tree had reverted to its
134-byte git-LFS pointer (the `.gitattributes` filter on `*.bin.gz` was
new and the working-tree file hadn't been re-smudged after a session
break). KataGo failed to load the pointer; `engine.py`'s exception handler
silently set `_engine = None`; `move_selector.py` fell back to
`_pick_random_legal()`. Every "calibration" run was actually measuring
b20-vs-random-legal-move-bot. The signature was a wildly out-of-band rate
(10-40%) with huge margins (-32 pts/game) — all of which we'd been
"explaining" with theories about b28's score_lead estimates being noisier.

Three defenses landed in commit `c397214`:

1. `STRICT_KATAGO=1` env var — in strict mode, missing/broken model files
   and engine-start failures *raise* instead of degrading to stub AI.
   Includes an explicit guard for files <1 MB with a "run `git lfs pull`"
   hint.
2. Pre-launch model-size check in `make calibrate-up*` — refuses to
   start backends with a model file < 1 MB.
3. Post-launch `/ai-move` smoke that verifies `score_lead` is non-null.
   Stub AI returns `null`; real KataGo returns a number.

After the hardening, every measurement was valid. Yesterday's "results"
got discarded and the work restarted from 5×5 30k.

### Phase 4 — calibration loop (the long part)

13 of the original plan's 13 profiles plus 2 extras (9×9 1d and 19×19 1d
were exposed in the picker but missed by the plan's matrix) — 15 total.
Sample-size policy got loosened from the plan's 30/100 to 30/50 to fit a
~25 hour total budget; CI widens from ±9.6% to ±13.4%.

Two cross-cutting findings worth remembering:

**Heavy-noise template.** For every profile where b28 dominated (which
turned out to be most of the 19×19 ladder), a four-knob change pulled the
rate down: cut `visits` 75-90%, bump `mistake_freq` 1.5-3×, bump
`random_move_chance` to 0.10-0.20, cap `max_point_loss`. 19×19 30k went
from 90% → 67%. 19×19 12k, 9k, 6k all landed in the strict 45-55% band
on the first heavy-noise iteration.

**`max_point_loss` matters more than expected.** At 13×13 30k the
b20-clone was *too weak* (33%) — flipped by lowering `max_point_loss`
35 → 22. The mechanism: b28's `score_lead` estimates are sharper, so a
"30 pts worse" mistake on b28 really is 30 pts worse, while b20's
noisier estimates yielded smaller real losses for the same nominal cap.
Capping the point-loss range capped real damage. Single most impactful
one-knob change in the whole calibration.

Two profiles refused to come into band no matter what we tried.
`13×13 15k` was tested across 5 rounds (`visits` ∈ {6,12,18,40} ×
`mistake_freq` ∈ {0.42, 0.55} × `max_pl` ∈ {22, 30}) — every round
landed 70-83%. Combined 115/150 = 76.7%. Locked at b20-clone with
documented over-strength. `19×19 18k` similar story. Both will play
~1 rank stronger than nominal. Fixable with profile-asymmetric levers
(different visit counts on b20-side vs b28-side) but the YAML schema
doesn't support that yet.

Final results table is in `AI_CALIBRATION.md` under "b28 calibration
outcome" — 6/16 profiles in strict band, 14/16 in sanity band, all
functional. Per-profile iteration history is captured inline as comments
in `data/profiles/b28.yaml`.

### Phase 5 — production deploy and immediate rollback

Renamed `b28_candidate.yaml` → `b28.yaml`, flipped the Dockerfile env
defaults to b28, pushed. Render rebuilt and went live on b28. Memory was
fine (1.39 GiB peak / 2 GB ceiling after a config-tuning pass that cut
`numSearchThreadsPerAnalysisThread` 16 → 1 and `nnCacheSizePowerOfTwo`
23 → 18). But user-perceived per-move latency was unacceptable on
Render's 1 vCPU, even after the visit-count cuts the calibration applied.

Reverted in `ebecef5`: Dockerfile defaults back to b20 + b20.yaml. b28
model and YAML still ship in the image; flipping back is a runtime env-var
override (no rebuild). Calibration work is preserved — `b28.yaml` is
still the canonical b28 calibration, `AI_CALIBRATION.md` and the
methodology section remain. Just the production *default* is b20 again
until a beefier Render tier or alternative hosting is decided.

### Things that bit us this session

- **git-LFS smudge.** Every model file under `backend/models/*.bin.gz`
  is tracked via LFS. After a fresh clone or a session break, the
  working-tree file can revert to a 134-byte pointer. There is now a
  three-layer defense (size check, STRICT_KATAGO, post-launch smoke),
  but the lesson is: "the file looks tiny, that's the bug."
- **Triage CIs are wide.** 30 games at p=0.5 has 95% CI ~30-70%. We saw
  triage swing 50% → 36% on consecutive runs of the *same* profile due
  to sampling. The 50-game confirmation was usually decisive but
  occasionally also wide. Don't over-interpret a single 30-game run.
- **My intuition about visits and the gap was wrong.** Predicted: deeper
  search smooths network differences. Reality: cutting visits *widened*
  b28's advantage because the policy net dominates at low visits, which
  is exactly where b28's bigger network shines. The "lower visits weakens
  b28" theory failed empirically; ended up locking 13×13 15k at b20-clone
  after five rounds going the wrong direction.
- **Mac native is the right local dev path.** Spent some time playtesting
  via `make up` (Docker compose, x86 emulated on Apple Silicon) and the
  16s/move latency was painful. Native Mac (brew KataGo + Metal) is
  ~5-8× faster locally; use it for all daily play.
- **The frontend caches game IDs in localStorage.** When you tear down
  a backend mid-session and bring up a new one with a fresh DB, the
  frontend's saved game state references IDs that no longer exist and
  every `/move` 404s. Hard-refresh + new game fixes it. Worth
  documenting somewhere.

### What's done; what's deferred

Done:
- All 16 b28 profiles calibrated and committed (`data/profiles/b28.yaml`).
- Calibration harness lives at `data/calibrate_b28.py` for future network
  upgrades; methodology section in `AI_CALIBRATION.md` is the playbook.
- LFS-pointer / silent-stub-AI footgun has three independent defenses.
- Both b20 and b28 ship in the production image; switching is one env-var
  flip on Render or one Dockerfile diff revert.
- Phase 0 sanity check (b20 vs b20) is reproducible via
  `make calibrate-up-sanity && make calibrate RANK=15k BOARD=9 GAMES=100`
  for the next time we change networks.

Deferred:
- b28 on Render. Production stays on b20 until a beefier tier is on the
  table or until Path C (TypeScript port of `move_selector.py`) makes
  iPad-native calibrated play viable without a backend.
- iPad-side b28 testing. Spike validated the model runs on M1 ANE; what
  remains is wiring the calibrated profile selection in. Started a
  scoping conversation at end of session — punted to a separate session.
- Two over-strength profiles (`13×13 15k`, `19×19 18k`) sit at ~77% even
  after iteration. Future fix is profile-asymmetric levers (different
  visit counts on b20-side vs b28-side during calibration). YAML schema
  doesn't support this today; not a blocker.



iPad app exists. Native KataGo runs on the Neural Engine via CoreML;
inference is no longer on Render's CPU. AI moves and score-lead are both
computed on-device. Single React codebase serves both web and iPad — no
duplication, no two-place edits.

### Spike first, then real app

Started with a disposable spike at `~/Projects/GoForKidsIOS-Spike/` to
validate that KataGo could even run on iPadOS before committing to the
hybrid architecture. Spike took the better part of a session of pure
Xcode/build-system debugging — eight separate gotchas, each documented in
the spike README. Highlights:

- Source files missing from the fork's Xcode project (had to add
  `sgfmetadata.cpp` and `evalcache.cpp` to the `katago` static-lib target;
  Xcode 16's "Add Files" dialog no longer has the target checkboxes, set
  via File Inspector after).
- The "m1" mlpackage variant requires a paired human-trained `.bin.gz`
  and special config; without it `genmove` throws `modelVersion = 0`
  because the CoreML backend silently fails to initialize. Use the
  non-m1 variant + the null-stub bin.gz instead.
- Xcode auto-compiles `.mlpackage` to `.mlmodelc` and strips the original
  from the bundle, but the Swift loader expects the raw `.mlpackage`.
  Workaround: remove from Copy Bundle Resources, add a Run Script phase
  that `cp -R`'s the raw mlpackage in. AND disable User Script Sandboxing
  (`Operation not permitted` otherwise).
- iOS Simulator throws
  `E5RT: Espresso exception: MpsGraph backend validation on incompatible OS`
  — Simulator's GPU stack can't run the b28 model. Build verification
  works on Simulator, but real `genmove` only works on a device.
- M1's Neural Engine is slower than M2/M3/M4 for these ops; the
  documented multi-thread split (GPU thread + ANE thread) was 3× *worse*
  than single-thread CoreML-only on M1. Single-thread is the right
  default; revisit when shipping on newer devices.

End of spike: ~80–90 NN/s sustained on M1, kid-bot visit counts (1–64)
respond in 46ms–707ms. Greenlight.

### Phase 1 — WKWebView host pointed at Render

30-min sanity check. Created a fresh Xcode project (`GoForKidsIOS`) with
a SwiftUI `UIViewRepresentable` wrapping `WKWebView`, pointed it at
`https://goforkids-web.onrender.com/#/`. App launched on iPad, loaded the
React frontend, AI moves worked through Render. Validated the WKWebView
container before introducing native AI complexity.

### Phase 2A — JS bridge to native KataGo

Threw away `GoForKidsIOS` (5 KB of throwaway), pivoted to the spike's
already-working Xcode project as the iPad app. Ripped out the demo
SwiftUI, replaced `ContentView.swift` with the WKWebView from Phase 1
plus a `KataGoBridge` Swift class.

Bridge architecture is satisfyingly thin:
- Swift class conforms to `WKScriptMessageHandler`, registered as
  `webkit.messageHandlers.katago`.
- A user script injected at `documentStart` exposes `window.kataGo` with
  promise-based methods (`aiMove`, `ping`).
- JS calls translate to GTP commands sent via the existing
  `KataGoHelper.sendCommand`/`getMessageLine` from the spike — no new
  C++ surface.
- Frontend `api/client.ts` checks `typeof window.kataGo` in `getAIMove`;
  if present, routes through the bridge, otherwise falls through to the
  existing `/api/games/:id/ai-move` HTTP path. Web users see zero
  behavior change.

Two API calls per AI move on iPad: GET game state from Render, ask the
bridge for a move, POST `/move` to commit. No backend changes required
because we use the existing human-move endpoint to commit AI moves.

Score-lead is plumbed end-to-end: bridge uses `kata-genmove_analyze`
instead of `genmove` to get per-candidate analysis info, parses out
`scoreLead` for the chosen move, negates when AI is white so the value
is from black's perspective (matches `GameStateDTO.score_lead`
convention). The score graph on iPad now updates from local KataGo, no
Render dependency for the live score either.

### Things that bit us this session

- **`ai-move` isn't a thin KataGo wrapper.** It's a wrapper around the
  Python backend's `move_selector.py`, which does rank-conditioned
  sampling, mistake injection, opening-phase logic, etc. Naive bridge
  → all bot ranks play the same strength. Accepted for Phase 2A as
  "tech preview"; proper fix is Path C (port `move_selector.py` to TS).
- **First attempt didn't fire because the iPad loaded an old frontend.**
  WKWebView pulls from Render. Local `client.ts` changes were sitting
  on disk. Lost ~10 minutes confirming the bridge was actually getting
  called before realizing we hadn't deployed the frontend changes yet.
- **`maxTime = 0.1` cfg cap.** First measurements showed only ~10 visits
  even at `maxVisits = 64`. KataGo's time budget cut search short. Fixed
  by sending `kata-set-param maxTime 60` from the bridge before genmove.
- **Score graph "didn't render in production."** Chased a "works locally,
  broken in prod" theory. Wasn't a build issue — `showScoreGraph`
  defaults to `false` in `settingsStore.ts` and lives in localStorage,
  which is per-origin. Local Mac had it enabled historically; Render and
  iPad were fresh origins. User toggled it on in Settings, problem solved.

### Architecture decision: single frontend, two delivery paths

`frontend/src/` is THE source of truth. Render auto-deploys it to web
on every push (existing). iPad's WKWebView currently loads from the
same Render URL; eventually (Phase 3) an Xcode build phase will run
`npm run build` and bundle `dist/*` into the app for offline support.
Either way: edit React once, both platforms pick it up. The bridge
detection in `client.ts` is the only frontend code that knows about the
native path, and it's a single 3-line check.

### Roadmap from here

| Phase | Status | What |
|---|---|---|
| 2A | ✅ Done | Native bridge for AI moves + scoreLead |
| C  | recommended next | Port `move_selector.py` to TypeScript so iPad bots are properly rank-calibrated. Today every iPad bot plays at fixed 64 visits regardless of rank — playable for adults, crushing for kids. ~4-6h, surgical refactor |
| 3  | after C | Bundle frontend locally so iPad UI works offline (no Render needed for assets). Required for App Store guideline 4.2. ~1-2h, mostly Xcode build phase scaffolding |
| D  | after 3 | Port game state (board/captures/ko/scoring) to TS so iPad doesn't need Render at all. Largest scope (~6-10h) |
| Hygiene | when convenient | Renaming Bundle Identifier from `ccy.KataGo-iOS` to a phasesix-branded one (re-triggers signing setup, not urgent) |

### Lesson worth keeping

Spike before commit. The 8 build gotchas would each have eaten a day
in a production-app context where every change requires careful review.
Doing them all in a throwaway directory let us blow through them
quickly, document the playbook, then carry only the working result
into the real repo. If a piece of work has unknown-unknowns and the
"is this even possible" question dominates the "how do we ship it"
question, build a spike.

### Status of feature plans after this session

- iPad app: 🟢 Phase 2A — native AI inference works, ships through
  Xcode to a real device, awaits TestFlight + Path C calibration

### Deferred to next session

- Path C: TypeScript port of `move_selector.py` for iPad bot rank
  calibration (also unlocks the path to making web's bot logic share
  the same code eventually)
- Phase 3: bundle frontend locally for offline iPad UI + App Store
  readiness
- Custom domain registration (still deferred from Session 11)
- Sentry + Plausible analytics (still deferred from Session 11)

---

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

## Known Bugs (observed in play, 2026-05-05 / iPad pass 2026-05-07 / TestFlight beta 2026-05-14 → 2026-05-17)

### Bot endgame play (reported by Patrick 2026-06-26 — captured w/ root-cause diagnosis, not yet fixed)
- [ ] ⚠️ **Bot passes during ko fights — can throw a won game (9×9 + 19×19).** GAME-BREAKING. **Patrick saw it on iPhone (direct Xcode build) = the on-device bridge path** (2026-06-26). Traced the whole on-device chain and the obvious cause is NOT it — the move-history plumbing is correct end-to-end: `requestAIMove` builds the real sequence and passes `movesForBridge` (gameStore.ts:904 + `buildBridgeMovesFromGame`); the Swift bridge **replays it via legal `play` commands** (`KataGoBridge.swift:104-112` — `clear_board`/`boardsize`/`komi`/`kata-set-rules japanese`, then `play <color> <pt>` per move), so KataGo's own board *is* ko-aware; and `Board.clone()` preserves `koPoint` + `positionHistory` (Board.ts:43-44), so the selector's `isLegal` filter correctly rejects the recapture. **CONFIRMED via repro (2026-06-26, 9×9 vs Ember 6k):** a **ko-rule mismatch**. KataGo runs `kata-set-rules japanese` = **`koSIMPLE`** (printed in the bridge log: `koSIMPLEscoreTERRITORY…`), but the app engine uses **positional superko** (`Board.positionHistory`, Board.ts:130-141). In the repro KataGo returned its single best move `J5` (legal under simple ko, genmove `play J5`), but `J5` **recreates an earlier whole-board position**, so the selector's `isLegal` (which clones the app board incl. ko state) **rejects it → 0 candidates → selector returns null → bot passes** (log: `analyze returned 1 candidates (best: J5 sl=-19.70 v=11)` immediately followed by `[localGameRouter] pass`). NOT suicide (KataGo's `sui0` forbids that too), NOT a history gap — purely **positional-superko (app) vs simple-ko (KataGo)** disagreeing, so *any* move KataGo loves that happens to repeat a board state makes the bot pass. **Fix options:** (A) ROOT — set KataGo to **positional superko + territory scoring** via a custom `kata-set-rules` (instead of the `japanese` preset) so it never offers a superko-illegal move and gives proper alternatives; risk = tiny eval shift vs b28's simple-ko calibration. (B) QUICK SAFETY NET (TS selector + Python mirror, helps both bridge & web) — when every candidate is filtered illegal, **fall back to a legal heuristic move instead of passing** (pass only when there's genuinely no legal move). Recommend B now (stops the game-throwing pass immediately) + A as the root. **B SHIPPED 2026-06-27** — the selector now falls back to a legal non-eye move instead of passing when every candidate is filtered (TS `moveSelector.ts` + Python `move_selector.py` mirror), plus `[selector] PASS reason=…` logging on every pass path (`filtered-empty-no-legal-move` / `katago-top-pass` / `pass-threshold` / `opening-only-pass`) so the next device repro classifies itself. STILL OPEN: root rules fix (A); on-device validation (does the fallback play sensibly?); and watch the logs — if premature passes survive B they'll show `katago-top-pass`/`pass-threshold`, i.e. a *separate* "too-eager pass at low visits" issue, not superko. **Separately, the WEB/Render path has its own ko hole:** `backend/app/ai/move_selector.py` sends KataGo an **empty `moves` list** (move_selector.py:338-363 — `PASS: all candidates illegal`), so web users are ko-blind regardless; fix = send the server-side move history to the backend analysis too. **Device test 2026-06-27 (Patrick): appears RESOLVED — bot no longer passes on kos; watching for recurrence.** Caveat: B is a *safety net* — in a ko it plays a heuristic legal move instead of KataGo's (superko-illegal) pick, so it won't throw the game but may not play the *strongest* ko move. Root fix A (positional-superko rules) is still the way to give proper ko play; tell-tale that B is firing = the bot plays an odd/random-looking move in a ko (rather than passing).
- [ ] **Bot fills neutral dame instead of passing after the player passes (esp. 19×19).** Wastes the player's time; not game-breaking. Analysis runs under **japanese rules** (dame = 0 pts) and the post-opponent-pass **settle path** (moveSelector.ts `opponentPassed` + `SETTLE_VISITS=100`; move_selector.py mirror) is supposed to surface pass. But the selector only passes if the pass candidate got **≥ max(4, best.visits/10) visits** AND the best move beats pass by < `pass_threshold`. On **19×19**, `SETTLE_VISITS=100` is likely too shallow for pass to accumulate enough visits among the many dame candidates, so the guard is skipped and the bot plays a dame fill (scoreLead ≈ pass under japanese, a hair higher from search noise) — then passes once the dame run out: exactly "fills neutrals, gains nothing, then passes." **Fix directions:** scale `SETTLE_VISITS` with board area, and/or a japanese-rules "score-neutral → just pass" heuristic in the settle path (if the best move's scoreLead gain over the current position is ~0, pass regardless of the pass candidate's visit count). Overlaps the milestone §7 settle-fill item (validated on 9×9, doesn't scale to 19×19). **Device test 2026-06-27 (Patrick): appears RESOLVED on a fresh build; watching.** ⚠️ Caveat: nothing this session directly changed the dame/settle logic — the apparent fix is most likely the **Session 24 settle + japanese-rules fix finally on Patrick's device** (dame = 0 pts on the settle path), or it simply didn't recur this round. The "`SETTLE_VISITS` too shallow on 19×19" concern can still surface on a denser/bigger endgame; if it does, the `[selector] PASS reason=…` log plus a fill-then-pass pattern will reveal it.
- [x] **Play of the Game board snapshots ignore handicap stones → confusing in handicap games (observed 2026-06-27)** — FIXED 2026-06-27. `gameReview.ts:boardAfter` rebuilt each highlight's snapshot on a fresh board replaying only `moves`, never placing the handicap setup stones — so on every stones-rung ladder game (12k+) the PotG diagrams were missing Black's handicap stones and read as nonsense. (Colors were already fine — `boardAfter` uses each move's recorded `m.color`.) Fix: thread `handicapStones` through `buildReview → interpret / tacticalFallback → boardAfter` and place them (Black) first, mirroring the replay's handicap handling (replayStore.ts:123-127). Both callers pass it: live game-end (`GameReview.tsx`, `game.handicapStones`) and replay (`replayStore.ts`, `Game.fromSGF(sgf).handicapStones`). 2 new tests in `gameReview.test.ts`; build green, 165 tests.

- [x] **"New Game" doesn't fully reset prior game state** — fixed 2026-05-05: `autoCompleting` flag was the only initial-state field missing from the `newGame()` reset block; if a prior game was mid Finish-Game, the new game's Pass / Resign / Finish Game buttons stayed disabled. Repro for any future leak: audit `gameStore` reset path against the initial-state object
- [x] **Hard to get back to main menu** — FIXED 2026-06-26 (Session 26). repro unclear; one likely cause: full-viewport modal overlays (e.g. `.scoring-overlay` z-index 9500 in [ScoringInProgressModal.css](frontend/src/components/ScoringInProgressModal.css)) cover the `GoForKids` title that's the only path home, and the `request()` helper in [api/client.ts](frontend/src/api/client.ts) has no `AbortController` timeout — so a hung backend leaves the modal stuck. Real fix: timeout + manual dismiss button, or raise the title's z-index. **Done** — confirmed exactly this root cause and shipped a tactical three-layer fix: a header **Home** control (replacing the coverable title), a centralized `goHome()` (aborts in-flight requests + full teardown), and the scoring overlay made non-trapping via a 20s `request()` timeout + an 8s "Go home" escape inside the modal. (Session 26 entry at top.)
- [ ] **13×13 bots are too strong across the board** — confirmed via playtest 2026-05-05. The b28.yaml comments self-document this for 15k ("kids picking 13x13 15k face a ~12k-equivalent. Rank ordering is preserved"); the same drift likely applies to 30k and 6k. Calibration approach was b28-vs-b20 head-to-head at the same nominal rank, which doesn't catch inter-rank gap drift on the new network. Same fix shape as the 19×19 relabel pass
- [x] **Score occasionally counted incorrectly** — root cause identified + fixed 2026-05-12 (Session 17). The Phase D on-device dead-stone detection (`localGameRouter.ts:deadStonesViaOwnership`) was negating KataGo's GTP ownership values unconditionally, on the false assumption that pla is always Black at scoring time. When parity made pla=W, the negate was correct (worked accidentally); when parity made pla=B (most 19×19 games), the sign flipped backwards and the wrong color's stones got marked dead. Real-world impact captured in `19x19scoring.log`: 260-move game scored as `winner=white black=122 white=140.5` with 238 stones wrongly marked dead. Fix: conditional negate based on `colorChar`, with a regression test for the pla=B branch
- [x] **"Finish game" mode hangs until final score appears** — fixed 2026-05-06 (commit d34ab1b): replaced the server-side `auto_complete` batch loop (one POST → 100+ KataGo analyses → final state) with a per-move `/finish-move` endpoint driven by a self-recursive frontend loop in `gameStore.finishGame`. Each KataGo move animates and plays a sound at natural pacing (~0.5–2s per analyze on Render b20). Also resolves the iPad-only "nothing happens when I click Finish Game" bug (every individual request is short, so iPad WKWebView's URLSession timeout is no longer a factor)
- [x] **iPad vertical (portrait) hides a lot of UI** — fixed 2026-05-08 as part of the [21 iPhone support](feature_plans/21_iphone_support.md) responsive pass. Three-tier breakpoints in App.css (wide ≥1100px, medium 700–1099px, narrow <700px) plus a phone-landscape height-bound branch. iPad portrait now uses an avatar strip across the top with board+controls underneath; iPhone portrait stacks vertically; iPhone landscape keeps the board height-bound with a thin avatar column. Same viewport pass also handles all dialogs, lessons, replay, library
- [x] **Resign button shows "You win" / wrong winner** — fixed 2026-05-07. Two layers: (1) Resign button now `disabled={autoCompleting || aiThinking}` so the player can't click during the bot's turn; (2) `Game.resign()` accepts an optional explicit `loser` color, and `gameStore.resign()` passes `playerColor` for AI games — so even if the click somehow lands during a wrong-current-color state, the right side is credited. Backend [resign()](backend/app/game/state.py:273) updated to use `game.player_color` (with bot-vs-bot fallback to current_color) so the persisted record matches. New unit test in `Game.test.ts` locks in the explicit-loser contract
- [x] **Rapid clicks during bot turn flip the bot to playing as Black** — fixed 2026-05-07. `playMove()` now sets `aiThinking: true` synchronously the moment the local stone lands (when `gameId && _game.phase === 'playing'`), so Pass / further taps are gated immediately instead of having a ~400ms + RTT window of false-`aiThinking`. `pass()` got the matching `currentColor !== playerColor` guard for belt-and-suspenders. Both branches also reset `aiThinking` on api-call failure so the UI doesn't soft-lock if a /move or /pass POST rejects
- [x] **"Finish game" doesn't work on iPad** — fixed 2026-05-12 (Session 17). Root cause was different from the Session 16 hypothesis: `api.finishMove` was HTTP-only with no bridge fallback, so on iPad (game_id only in localStorage) every call rejected and `gameStore.finishGame`'s catch silently halted the auto-loop. Three-part fix: (1) new `finishMoveViaBridge` runs the per-move loop locally via the bridge; (2) bypasses the rank-calibrated selector (mistake_freq was burning leads during finish) — plays KataGo's top candidate at 200 visits matching the backend's full-strength semantic; (3) uses Japanese rules + 0.5-point pass threshold so KataGo actually passes once the position is settled (under tromp-taylor area scoring it would fill its own liberties forever). Ko-fallback (catch playMove rejection, pass instead) handles the case where KataGo suggests a move our positional-superko engine rejects — boardToMoves doesn't send move history
- [ ] **Sound stops working after several games (restart fixes)** — observed 2026-05-07, iPad-only so far. Likely-fix-plus-diagnostics shipped 2026-05-08 (commit 219aaca): [`resumeAudio()`](frontend/src/audio/SoundManager.ts:104) now triggers on any non-running `AudioContext.state` (was `=== 'suspended'` only — missed the iOS-specific `'interrupted'` state that follows notifications, lock screen, Siri, etc.) and logs the prior state on every resume attempt, plus the result of the `resume()` promise. Next iPad repro: check Xcode console for `[Audio] resuming AudioContext, state was: <X>` — the value of X tells us where to look next. If still broken: secondary hypothesis is AudioNode accumulation (cosmic pack creates 4–5 OscillatorNodes per capture, no `disconnect()` on any) hitting a WebKit ceiling; fix shape would be `osc.onended = () => osc.disconnect()` on each node, or pooling. Fallback if `state === 'closed'` after interruption: recreate the `AudioContext` instead of trying to resume

> Three of the four iPad-specific bugs from the 2026-05-07 playtest pass are closed in code. The audio-death bug (#1) ships with a likely fix + diagnostic logs in commit 219aaca — open until a repro confirms either that sound recovers (close it) or that the logs reveal a different root cause. iPad must be rebuilt from Xcode to pick up the bundled frontend changes (Finish Game, Resign disable, rapid-click gate, audio resume).

> iPhone (Pro Max) support is now its own feature plan: [21_iphone_support.md](feature_plans/21_iphone_support.md)

- [x] **"Play" mode game-end modal: not dismissible + no score breakdown** — fixed 2026-05-17 (Sprint 1, commit 22a3fc1). Added × close button + click-overlay-to-dismiss + full `ScoreSide` breakdown (territory / captures / komi) to [AutoPlayGameEndModal](frontend/src/components/AutoPlayGameEndModal.tsx). Exported `ScoreSide` from `GameEndModal` for reuse. New `AutoPlayGameEndPanel` "See results" pill renders in the side panel post-dismiss to reopen the modal; wired into [GameControls](frontend/src/components/GameControls.tsx:146) alongside the existing lesson/standard branches. Uses the shared `gameStore.gameEndDismissed` flag so no new state needed.
- [x] **Library replay: playback controls misaligned on iPhone portrait** — fixed 2026-05-17 (Sprint 1, commit 22a3fc1). Two-part fix in [App.css](frontend/src/App.css): (1) added `padding-bottom: calc(72px + 36px + 14px + var(--safe-bottom))` to `.replay-controls` in the narrow breakpoint so the playback-speed row + Download SGF + hint clear the floating settings gear when scrolled to bottom; (2) added a new `.app-replay` modifier class on the App root div (toggled in [App.tsx](frontend/src/App.tsx) when `replayActive`) that drops the gear from `bottom: 72px` (needed for normal-mode Pass/Resign clearance) back to `bottom: 14px` so it sits at the corner over the lowest-value content instead of overlapping the mid-panel Speed-control "Fast" button.
- [x] **Close button in replay routes to a new game instead of home** — fixed 2026-05-17 (Sprint 1, commit 22a3fc1). `replayStore.close()` alone only flipped `active: false`, leaving the App on the in-progress game underneath (showHome was still false from when the Library was opened). [ReplayControls](frontend/src/components/ReplayControls.tsx) now takes a required `onClose` prop; App's new `handleCloseReplay` calls `closeReplay()` then `setShowHome(true)` + `setShowStudy(false)` to explicitly route home.
- [ ] **Download SGF doesn't work on iOS** — TestFlight beta 2026-05-14. Download SGF action no-ops on iPad/iPhone. WKWebView doesn't natively handle the standard `Blob` URL + `<a download>` flow that works in browsers; needs a native bridge that posts the SGF text to Swift and surfaces a `UIActivityViewController` (share sheet) for Save to Files / AirDrop, similar to the other iOS native bridges already in `localGameRouter`.
- [x] **Profile page not scrollable in iPhone portrait** — fixed 2026-05-17 (Sprint 1, commit 22a3fc1). `.profile-view` had `min-height: 100vh + overflow-x: hidden` with no height cap, which per CSS spec implicitly turns `overflow-y` into `auto` but leaves nothing to scroll against on iOS WKWebView. Switched [ProfileView.css](frontend/src/components/ProfileView.css) to explicit `height: 100dvh; overflow-y: auto; -webkit-overflow-scrolling: touch` (with `overflow-x: hidden` kept). Verified `scrollHeight 1125 > clientHeight 812` in mobile preview. Merge with the contemporaneous safe-area-inset PR (1f9c2b2) preserved both fixes.
- [x] **5×5 tutorial: White bot freezes when every move is suicide** — fixed across five iterations 2026-05-17 → 2026-05-18. (1) Sprint 1 (22a3fc1) had the bot resign on its behalf to avoid a suspected pass-pass race. (2) Per playtest preference, reverted to auto-pass (6e35a3b) — strict Go rules. (3) That exposed an `aiThinking` flag leak: `playMove` synchronously sets `aiThinking: true` to trigger the AI turn; when `lessonAutoPass` handled the bot's pass and `requestAIMove` early-exited, the flag was never cleared, leaving the UI in a "bot thinking" lock that looked like a freeze (5a6308b). (4) Once the freeze cleared, the explainer modal didn't pop because `lessonAutoPass` was calling `_game.pass()` without setting `botJustPassed: true` — restored (d213593). (5) Finally, the symmetric case (player out of legal moves) was silently auto-passing for them with no UI feedback; replaced with a new `PlayerOutOfMovesModal` ("No more moves!" + single Pass-and-end button) and a `passAndEndGame` action that fires both sides' passes in sequence so scoring runs and the kid sees the final tally (8a685e9). The selector-driven bot-pass path also got the swap so `BotPassedModal` ↔ `PlayerOutOfMovesModal` are picked correctly based on whether the player still has legal moves.
- [x] **iPhone Pro Max: "← Home" overlaps lesson dot (1) in lesson view header** — observed + fixed 2026-05-17 (commit 046b85e). In the narrow breakpoint the `.learn-header` grid drops to `auto 1fr` (back btn | progress). The default `.learn-progress { justify-self: end }` sized the flex container to its content width (~376px), which overflowed leftward into the back-button cell and visually overlapped dot (1) on 430pt-wide Pro Max portrait. Override to `justify-self: stretch` in [LearnView.css](frontend/src/components/LearnView.css) constrains it to its grid column so `overflow-x: auto` actually scrolls the dots past the fold.
- [x] **Homepage bot roster row bleeds off-screen on iPhone** — observed + fixed 2026-05-17 (commits 773fdde, 6b5c6b6). `.home-content` is `align-items: center`, so `.home-bots` was sizing to its (~455px) bot row content and centering it inside the narrower viewport pushed it off-screen equally on both sides (Seedling left + Void right cropped on iPhone 17 portrait). First commit added `align-self: stretch + min-width: 0` to `.home-bots` to constrain to parent width; that fixed the overflow but left Storm/Void scrolled off-screen. Second commit ([HomePage.css](frontend/src/components/HomePage.css) narrow block) shrank avatars 44→32px, gap 12→4px, and dropped label fonts 1px each so all 8 bots fit centered on ~400px-wide phones without horizontal scroll.
- [x] **iPhone Pro (non–Pro Max) layout is cut off** — addressed via cumulative Sprint 1 + Sprint 2 CSS fixes (Sprint 2 audit at 393×852, 2026-05-17). The Pro-width complaints surfaced on iPhone 17 simulator (homepage bot roster bleeding equally off both sides, fixed in 6b5c6b6 / 773fdde) and Pro Max (lesson header dots overlapping Home, fixed in 046b85e). Audit at 393×852 of home / new-game dialog / game UI / lessons / profile / library / replay all render cleanly with no cropping. If a future Pro-specific repro surfaces a NEW cut-off location, reopen with the specific view + viewport coords.
- [x] **Undo doesn't work in handicap games vs. the bot** — fixed 2026-05-17 (Sprint 2). Two bugs in one: (1) handicap stones weren't tracked anywhere accessible to undo's rebuild, so they vanished; (2) the replay loop used `currentColor` (always Black after rebuild) instead of each move's recorded color, silently swapping W/B in handicap games where White moves first. Fix: added `handicapStones: Point[]` field + `setHandicap(stones)` method to [Game.ts](frontend/src/engine/Game.ts); `undo()` now re-places handicap stones AND sets `currentColor = move.color as Stone` before each replay step. Also fixes the related SGF gaps: `toSGF` now emits `HA[n]` + `AB[xx][yy]...` tags, and `fromSGF` parses them via `setHandicap` and uses the recorded color when replaying. localGameRouter's pre-existing undo workaround removed (no longer needed). 5 new tests in [Game.test.ts](frontend/src/engine/__tests__/Game.test.ts) lock in handicap-undo, color-replay correctness, non-handicap regression, SGF AB emission, and round-trip.
- [ ] **Phone runs hot + elevated battery drain during play (needs profiling to confirm attribution)** — TestFlight beta 2026-05-14, iPhone. Observed warmer-than-normal device temperature and higher battery usage during sessions; unclear how much is GoForKids vs. other apps. Strong prior: Phase D shipped fully on-device KataGo Neural Engine inference, and iPhone has a tighter thermal envelope than iPad — every move (and every `finishMove` step) triggers a fresh ML inference, with no idle / low-power mode in between. Plausible secondary contributors: AudioContext nodes accumulating without `disconnect()` (already flagged in the audio bug), Canvas redraws on every animation frame even when idle, and the React re-render volume of the auto-play screen. Next step: Xcode Instruments → Energy + Time Profiler over a 5-minute play session to see where the watts go. Mitigations to consider if confirmed: lower default visit count for non-finish moves, skip inference when the bot is clearly losing/resigning, throttle Canvas to dirty-frames only.
- [x] **Bot plays 2–3 own-territory moves after the player passes (9×9 6k, playtest 2026-06-11)** — root cause diagnosed (Session 23 wrap): the settle-cleanly path (Session 21) deepens visits + skips mistake injection, but its analysis still runs `rules: 'tromp-taylor'` with hardcoded komi 7.5 (client.ts bridge call) — and under area rules own-territory fills are free, so honest KataGo doesn't surface pass. Fix shape, proven by `finishMoveViaBridge`: settle analyses → `rules: 'japanese'` + real komi, on BOTH engines (TS `moveSelector.ts`/`client.ts` and the Python path). Costs the bot ~2–3 pts/game today.
- [x] **Score graph reads a couple pts high for White, worse late-game (playtest 2026-06-11)** — two compounding causes: (1) on-device bridge analyses hardcode `komi: 7.5` (the "acceptable for now" comment in client.ts) while real 9×9 ranked komi is 0–6.5 (rung 8k plays komi 0); the backend path passes real `game.komi`, so Render and on-device currently disagree; (2) tromp-taylor scoreLead vs the app's territory scoring diverges late as dame/fills stop mattering to one ruleset. Fix shape: expose `komi` on `GameStateDTO`, thread real komi through every bridge analyze, align score-display analyses with the app's scoring rules — but keep move-selection analyses on tromp-taylor so b28 calibration stays untouched.

## Polish / Feature gaps (from play observation)
- [ ] **9×9 6k bot slightly too hard (playtest 2026-06-11)** — direction agreed with Patrick: more but smaller mistakes (`mistake_freq` 0.50 → ~0.58, `max_point_loss` 8 → 6; small deltas per the 15k over-weakening lesson). ⚠️ Tune AFTER the settle fix above — fixing the territory giveaway makes 6k ~2–3 pts stronger — and validate bot-vs-bot (still beats 9k, still loses to 3k). May also partly be the known 9k→6k calibration cliff; a softer 6k addresses both.
- [ ] **Lessons 6–9 don't prepare the kid for 9x9** — the ramp into a real game is too steep. Likely need to refine the existing lessons and possibly add new ones bridging concept → first 9x9 game. Folds into [03 concept lessons](feature_plans/03_concept_lessons.md)
- [ ] **Replays should show more analysis** — at minimum, surface the live score (scoreLead) graph during replay; eventual hookup to study mode / AI teacher narrative. Folds into [04 AI teacher review](feature_plans/04_ai_teacher_review.md)
- [ ] **More animation + "make it fun" polish** — extends [12 animations & sound](feature_plans/12_animations_and_sound.md) beyond the current beta cut
- [ ] **More + cooler avatars for bots and players** — PARTIAL 2026-07-01 (Session 28): 4 image player avatars (Tide/Eclipse/Prism/Comet, Patrick + Roland's ChatGPT art) + villain art for Ember/Storm/Void, plus end-screen hero shots and a one-time character-select at Learn entry. Remaining: art for the lower bot rungs, signature motion, unlocks. Ties into [11 avatars](feature_plans/11_avatars.md) and the [15 rewards loop](feature_plans/15_rewards_loop.md) (avatars as unlockables)
