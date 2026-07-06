# Milestone — Tester Round: Learning-Loop Polish

**Created:** 2026-06-25 · **Rescoped:** 2026-07-02 (original scope closed; five items remain)
**Audience:** the 6 current testers — mostly adults, a few elementary kids. **Already onboarded** (they've done learn-to-play). NOT camp / cold-start kids — the July camps are a separate, later target.
**Theme:** harden and polish the learning engine, then ship. **Validation > new features.**
**Exit criteria:** the five remaining items below closed. Device validation is ongoing (Patrick + Roland validate items as they land, not as a separate end-gate — the original §7 checklist model worked and continues).

---

## Done — original scope, closed 2026-07-02

All seven original sections shipped and device-validated across Sessions 26–32 (detail in DEVJOURNAL). Patrick reviewed the lessons + glossary content 2026-07-02: feels good, voice pass closed. Everything surfaced during device testing was addressed.

- **Undo banking** (banked-3, gated on `autoplayContext`; `HistoryEntry` records usage) — S26.
- **Menu-trap fix** (header Home + centralized `goHome()` teardown + scoring-overlay 20s timeout / 8s escape) — S26. No recurrences; screen-state-machine escalation not needed.
- **Ko-superko Option B mitigation** + `[selector] PASS reason=…` logging, TS + Python — S27. *Mitigates, does not close* the pass bug — see Remaining §2.
- **Lessons polish:** quiz wrong-answer retry with coached hints (S30 — the 7yo-playtest dead-end, fp 03 §D); four advanced lessons (ko/ladders/nets/snapback, engine-verified positions) + advanced-lessons menu (S31 — fp 03 §B); glossary enrichment — liberties group/corner diagrams, False Eyes concept, multi-diagram support (S31 — fp 03 §A).
- **Polish batch from Patrick's device pass** (S32): glossary page-flip nav (buttons/swipe/arrows), board taps blocked under feedback popups, territory-quiz board pinning, safe-area fix for menu Home, **SGF share-sheet bridge** (`shareSGF` — the May TestFlight bug).
- Shipped in-window though extra-milestone: avatar art + character select (S28), responsive sweep + Playwright layout suite `npm run test:layout` (S29).

Still open from fp 03 but **not gating this milestone**: §C "make territory, don't chase captures" beat; fp 30 depth-appreciation arc.

---

## Remaining — rescoped 2026-07-02

**Order of attack: §5 → §3 → §1 → §4a.** §2 is in capture-mode, not queued for a fix attempt. **§5 and §1 closed 2026-07-02 (Sessions 33–34, device-validated); §2 closed provisionally 2026-07-04; §3 effectively done 2026-07-05 (S44); §4a shipped 2026-07-05 (S45). ALL FIVE ITEMS BUILT — the milestone closes on Patrick's device pass (§3 final ladder + §4a quick-replay flow + the S45 attribution/layout fixes).** §1's portrait note-cutoff bug fixed in S45 (see §1).

**Device-validation fixes (the ongoing pass, S44–S46, all shipped + pushed):** rebuilt the 9×9 ranked ladder to use the real 18k/12k bots as komi-bridged rungs + Black/White color variety on in-between rungs (S44); removed the unimplemented **Study mode** (button appeared randomly); fixed the **White first-move board-lock** (tapping before the bot's opening move placed the bot's stone — fixed at UI + store layers); fixed **DX4QAWTT** — the S43 endgame territory net was passing mid-game because a large open region read as sealed territory (now settle-only). Detail: DEVJOURNAL S44–S46. These are device-pass polish/bug fixes under the "validate as they land" model, not new milestone scope.

### 1. Score graph in replays  ✅ built + device-validated 2026-07-02 (S34) — one known bug below
Mount the existing `ScoreGraph` in the replay view with a position cursor synced to the timeline. Small and frontend-only: `scoreHistory` is already persisted on every library entry (`libraryStore.ts`), so past on-device games already have the data. Web/stub games without `scoreHistory` simply don't show the graph.
- _Acceptance:_ stepping through a replayed game shows the score arc with a "you are here" marker; matches the live-game graph's read of the final margin.
> **Status: built (Session 34), device-validated by Patrick same night.**
> Shipped as the replay's scrubber — the panel had zero vertical slack (layout
> suite failed 9/14 viewports on the naive mount), so the graph absorbs the
> slider + marker strip: "Move N / M" header, lead-at-cursor, tap/drag-to-seek,
> key-move dots on the arc. No-scoreHistory saves keep the old slider.
>
> ~~**KNOWN BUG (Patrick's device pass, 2026-07-02): highlight-note cutoff on
> iPhone Pro Max PORTRAIT**~~ **FIXED 2026-07-05 (S45), pending device
> confirm.** The suite-blindness mechanism was deeper than move-0 sweeps:
> the suite's Chromium reports `env(safe-area-inset-*) = 0`, so every
> phone-portrait probe ran with ~93px more height than a real phone.
> `sweep()` now emulates real per-device insets via the `--safe-*` custom
> properties + a new `replay on a key move` state (seeks to a highlight,
> panel dressed to real-game height). That reproduced this bug headless —
> phone-portrait replay panel +35-47px past the fold — and caught THREE
> more device-truth cutoffs (iPad 10.2 landscape board +4px, game-late
> iPad mini landscape +24px, big-iPad landscape replay + note +17-25px),
> all fixed in the same pass. Suite at 11 tests, all green under insets.
> Detail: DEVJOURNAL S45.

### 2. Ko-fight passes  ✅ CLOSED (provisionally) 2026-07-04 — fix #4 device-validated
> **Patrick's device pass (2026-07-04): two games — multi-stone handicap, multiple kos, an early undo — no bad passes, clean logs. Closed for now; the desync-seed question stays instrumented (any future `[desync]` line reopens as its own item). Capture-mode history + fix detail below (S35–S36).**

Still occurring in game-breaking situations (Patrick, ~late June — less frequent since Option B, but not gone). **Decision 2026-07-02: we've attempted fixes ≥3 times without closing it; do not attempt #4 blind.** The S27 logging can already distinguish the mechanism — `filtered-empty-*` = the known koSIMPLE-vs-superko mismatch (root fix A: align KataGo's rules config); `pass-threshold` / `katago-top-pass` = a *different* too-eager-pass bug — but no field incident has ever been captured (Patrick is never attached to Xcode when it happens).
- **Action now (folds into §5):** buffer recent `[selector]` log lines in-app and attach them to the saved game — both the local library entry and the §5 upload payload — so the next repro carries its own diagnosis.
- **REPRO CAPTURED + CLASSIFIED (2026-07-03, S35): share code 888P9NXK — capture-first worked.** First instrumented field incident; the embedded selector log names the pass path directly. The game: 19×19 HA[2] casual vs 18k, on-device (`capture=v2 bridge=yes`), B+100.5. At move 235 the log reads `[getAIMoveViaBridge] engine rejected KataGo's pick (5,17): Ko violation — passing instead` — and (5,17) = `rf`, the ko recapture in the SGF's corner fight (`W[rf] B[rg] W[] B[sf] W[]`). **Mechanism = the known koSIMPLE-vs-superko mismatch, but surfacing through a pass path Option B never covered:** the *commit-time* catch in `client.ts` (`getAIMoveViaBridge` ~:404; `finishMoveViaBridge` ~:587 has a twin) — the pick sailed through the selector and died at `api.playMove`, and the catch passes. (Why the selector's isLegal filter didn't reject it first is worth a look — likely the board handed to the selector lacks the ko/history state the router has.)
  - **Fix attempt #4 is now justified (the repro named its path):** extend Option B's legal-fallback to both commit-time catches — on rejection, re-select excluding the rejected point (or play the legal-heuristic fallback) instead of passing. Root fix A (positional-superko rules for KataGo) remains the real answer for *strong* ko play.
  - **Loose end:** the pass at move 233 committed with NO reason line — either a third unlogged pass path or a capture-v2 gap. Audit pass-path logging while in there.
- **FIX #4 SHIPPED (2026-07-03, S36) — four layers, pending device validation:**
  1. **The selector is now ko-aware.** The proposer of the banned recapture wasn't (only) KataGo — the selector's `local_bias`/`random_move_chance` branches run *before* candidate selection on a grid-only board with no history, so every ko recapture looked legal to them (and after a ko take, the recapture point is always adjacent to `lastOpponentMove`, which local-bias anchors on — that's why it reliably hits ko fights). New `Board.koBan` (set only by `boardFromGrid`, from the server's `ko_point`, which both the local router and the backend already expose) is enforced in `tryPlay`, so all selector branches inherit the ban through the one choke point. Real game boards never set it — zero engine-behavior change. This restores parity with the Python selector, which gets ko-awareness for free from the real server board.
  2. **Commit-time rejections no longer pass.** `getAIMoveViaBridge` retries up to 3 legal alternatives (`pickLegalNonEyeMove` with exclusions); `finishMoveViaBridge` falls to KataGo's next real candidate. Pass only on exhaustion, with `PASS reason=commit-rejected-exhausted` logged.
  3. **The move-233 loose end is closed — it was a THIRD silent pass path:** `gameStore.requestAIMove` fell through to the "AI passed" block whenever the *local* `_game.playMove` rejected a move the server had already committed — unlogged, and it desynced the boards further every time (server kept the move, local recorded a pass). Now: `LOCAL-REJECT` selector-log line + force-resync from the server board (`Game.forceApplyServerMove`; `AIMoveDTO.board` carries the post-move grid on bridge/local paths, HTTP falls back to `getGame`). Same fix in bot-vs-bot and the finish loop; the eye-fill wrapper (4th silent path, found in the same audit) now logs `PASS reason=eye-fill-retries-exhausted`.
  4. **Desync detection:** after every move that returns a server board, local hash vs server hash; first mismatch per game logs `[desync] … move=N`. Move 233 *proves* a pre-233 desync existed (clean-history sim: no rejectable White move exists at 233) whose seed is still unidentified — backend-undo ruled out for this repro (all-bridge game; local router undo delegates to the already-fixed `Game.undo`); player-move sync-failure swallow now logs too. The next repro dates the divergence instead of leaving it to reconstruction.
  - Tests 202 (was 199 post-S35): `Board.koBan` suite, `Game.forceApplyServerMove` suite, `moveSelector.koBan` integration (KataGo offering ONLY the banned recapture must not produce it), and `gameStore.desyncRecovery` (the exact 888P9NXK shape: server-committed move locally rejected → resync, `api.pass` never called). `npm run build` green.
  - **Still open under §2:** root fix A (KataGo superko rules — now lower priority: koBan + commit-retry cover the observed class, A only buys *stronger* ko play), and Patrick's device validation in real ko fights.
  - **Desync seed: Patrick's hypothesis (handicap + undo) SUPPORTED — two undo holes found + fixed (S36 addendum 2):** (a) a server game with a 1-move history (only handicap games — bot moves first) took the *local-only* undo branch and never called `api.undo` — instant silent desync, works on the bridge too; (b) the chained `api.undo`s were fire-and-forget with a swallowed catch. Now a single-move undo syncs the server, and **every undo verifies local-vs-server board from the undo response** (`[desync]` / `undo server-sync FAILED` selector-log lines on mismatch/failure).
  - **Closing protocol (agreed 2026-07-03):** Patrick device-tests — provoke ko fights (take kos repeatedly, incl. edge/corner), one handicap game with undos (incl. undoing the bot's opening move), a Finish Game — then uploads the games. Clean selector logs (no unexplained pass, no `[desync]`) + no felt passes ⇒ close §2. Any `[desync]` line ⇒ new seed lead, its own item.
  - Side finding, unrelated to this repro: the backend's `GameStateManager.undo` dropped handicap stones (server twin of the Sprint 2 frontend bug) — desynced the backend board from the frontend engine in every web-path handicap game with an undo. Fixed + first backend tests in S35 (commit 76c49ac). ~~The web path's empty-`moves` ko hole in `move_selector.py` is still open.~~ **CLOSED S36:** KataGo now gets real history (`_engine_history` → `engine.analyze(moves=…)`) on both `get_ai_move` and `finish_move`; server pass-on-rejection fallbacks replaced with legal-fallback/candidate-walk. **Bonus find while in there: `_select_with_katago` had a swallowed `NameError` (missing `opponent_passed` param) since 2026-06-04 — the Render bot has been playing pure random-legal moves for a month** (on-device unaffected; the broad `except` hid it — now `logger.exception`). Backend tests 6. Disregard any June web-path play-feel observations.
- **Then:** fix whichever path the log names. If it's the superko path, note root fix A changes KataGo's rules config and can subtly shift bot behavior — if that lands after the §3 recalibration, budget a touch-up pass on the profiles.

### 3. 9×9 bot profiles too strong — full review  ✅ EFFECTIVELY DONE 2026-07-05 (S44) — held open for Patrick's final device pass
> **RESOLUTION (S44, 2026-07-05):** rebuilt the entire 9×9 ladder (30k→1d) on
> a data-driven **out-of-pool sampling mechanism** (reading_rate / policy_temp
> / wide_root_noise + **sampler v2**: sample_lapse + sample_loss_cap), calibrated
> against a **per-move-loss histogram table of real human games at each rank**
> (`data/human_games_9x9_ogs/`, analyzer `data/analyze_9x9_losses.py`). Final
> state meets the "measurably works" bar on BOTH instruments: bot-vs-bot ladder
> is monotonic with near-even 3.5-pt/rank handicaps, AND each rung's loss
> histogram sits on its human column (15k median 1.11 vs human 1.14; 9k
> 0.52 vs 0.58). Anchors 30k/18k/6k/1d validated by Patrick on device; middle
> retuned to match. Root causes found + fixed along the way: the **iOS bridge
> parsed 1 candidate per analysis since May** (S41 — the real reason every
> prior retune felt identical on device), an **edge-false-eye pass** (JEA338QQ),
> and a **no-pass/junk-fill endgame** (GN5R6K9G). Full arc: DEVJOURNAL S38–S44;
> profile lineage in `data/profiles/9x9_profile_archive.yaml`; every bot game in
> `data/calibration_logs_b28/9x9_s38-s42_bot_battles.md`. **Open only for
> Patrick's device pass on the final build; deferred: opening-fidelity lever
> (humans blunder openings hardest on 9×9), 3k↔1d closeness (accepted),
> autoplay-ladder matchmaker cleanup (18k/12k now have real profiles).**
>
> ---
> _Original investigation (S38–S43) below, kept for the record._
>
> **Patrick's full report (2026-07-04, he's ~2d IGS):** 6k very hard even + ≈3k-like;
> 1d about right (even at 1 stone); **9k possibly easier than 15k**; 15k "plays
> perfectly, then one dumb mistake — the gap is way too large."
>
> **Hypothesis CONFIRMED by code-trace, with a twist:** the mid rungs ran the
> clarity gates on their defaults (prior 0.5 / gap 5.0 — fire constantly on 9×9)
> and the 5-visit candidate pool contained no real mistakes for mistake mode to
> pick, so "mistake_freq 0.72" produced near-perfect play. The 9k<15k inversion
> is the same mechanism inverted: 9 visits surfaces a wider pool = real mistakes.
>
> **Fix shipped (S38, mechanism + data, TS+Python parity, tests 210/10, build
> green):** new `local_bias_from_candidates` knob (myopic mode — strongest
> KataGo candidate near the anchor instead of random-nearby noise); 15k/9k get
> visits 16 (pool breadth), explicit clarity gates (0.87/15, 0.80/10), myopic
> local_bias (0.55, 0.40), fewer pure-random blunders; 6k mistake_freq
> 0.55→0.65 (knob-only, per Patrick); 30k/3k/1d untouched. Automated ladder-
> ordering check run locally (see S38). **Closes on Patrick's bottom-up ladder
> play-through.**
>
> **ITER 2 (same day, S39) after Patrick's device pass failed iter 1** (15k
> bimodal + still way too strong; 9k destroying a 2d): new `score_noise`
> knob — noisy scoreLead argmax replaces the mistake machinery on 15k
> (σ=6.0) and 9k (σ=4.5); iter 1's myopic-local was near-perfect on 9×9
> because local ≈ global there. **Same device round surfaced the JEA338QQ
> "ko bug again" pass — actually an edge-false-eye misclassification in
> `isEyeFill` (predates everything); fixed both selectors + wrapper now
> plays a legal fallback instead of passing (detail: S39).** §2 stays
> closed — no `[desync]`, the koBan/resync layers held.
>
> **ITER 2b–2d (same night): sigma experiment failed informatively → final
> config drops BOTH new mechanisms from the profiles.** Sigma 6 ≡ sigma 12
> in ladder results and sigma-9k beat 6k twice (inverted): the candidate
> pool is a strength floor, uniform-over-pool is STRONGER than the mistake
> machinery, and going below the floor needs out-of-pool moves (policy
> sampling — future milestone, needs bridge plumbing). Also: 8-game cells
> flipped 7/8→3/8 on identical configs — bot-vs-bot is ordering-sanity
> only; Patrick's play-feel is the calibration instrument. **Final: 15k +
> 9k on the machinery with random-nearby local, myopic branch off (it was
> the destroys-a-2d perfect-play mode), knobs strictly ordered 15k<9k;
> visits 16 + explicit clarity gates kept from iter 1. score_noise +
> local_bias_from_candidates remain in both selectors as dormant tested
> knobs. Closes on Patrick's bottom-up ladder pass.** Detail: S39.
>
> **ITER 3 (2026-07-05, S40, Patrick-approved): the out-of-pool mechanism
> shipped.** `wide_root_noise` (KataGo wideRootNoise per-profile — pool
> becomes a wide scored policy sample, 29 candidates vs 3-5, verified live)
> + `reading_rate`/`policy_temp` (bot READS only 30%/55% of moves; the rest
> are prior-sampled shape moves — clarity gates and machinery now live
> inside the reading path only, so unread fights get genuinely misread).
> Patrick's mistake model maps directly: small-mistake freq = 1−reading_rate,
> size = policy_temp, big mistakes = prior tail + random_move_chance.
> Ladder: 30k ≪ 15k < 9k < 6k monotonic (15k-9k gap thin — dial ready if
> needed). Touches BOTH Swift bridge copies → **needs Xcode rebuild**; watch
> `[Bridge] analyze returned N candidates` (~15-30 on 15k) and any GTP error
> after `kata-set-param wideRootNoise` (older bundled KataGo would reject
> it). Closes on Patrick's device pass. Detail: S40.
>
> **ITER 3b (2026-07-05): anchor-calibrated.** Device pass on iter 3 still
> read "perfect" — the b28 policy prior is dan-strength on 9×9; temp 1.4 was
> far too cold. Sweep against the FIXED 6k using Patrick's anchor (2d plays
> 6k even ⇒ true 15k ≈ +40..50 behind 6k): **15k locked at reading_rate 0.15
> / policy_temp 2.2 → +46.7/+50.8 vs 6k (n=12, stable)**. Final ladder:
> 30k ≪ 15k (+89) < 9k (+34) < 6k (+19) < 3k < 1d. Upload payloads now carry
> `[analyze] wrn=… candidates=N` (device pool-width self-diagnosis). Human
> reference games for the mistake-texture study: `data/human_games_9x9_ogs/`
> (Fox dataset is 100% 19×19). **Awaiting Patrick's rebuild + bottom-up
> ladder pass — §3 closes there.** Detail: S40.
>
> **ROOT CAUSE FOUND (2026-07-05, S41, via Patrick's upload E38J2NEN):
> the iOS bridge has parsed exactly ONE candidate per analysis since
> Phase D (May).** KataGo returns all ~29 root moves concatenated on one
> info line; `parseInfoLine` stops at the first `pv`, so the device pool
> was one move deep — every rank was structurally forced into perfect
> top-move play, no matter what the profiles said. Fixed in both Swift
> copies (segment-split before parsing). This also amplified the old
> superko ko-pass class (1-candidate pools emptied on any illegal pick)
> and starved on-device settle-pass detection. **Post-fix, the whole
> device ladder plays weaker than Patrick remembers — his 6k≈2d anchor
> was measured against the bug. Re-anchor bottom-up on next rebuild;
> the S40 15k calibration (vs the correctly-parsed local 6k) transfers
> as-is.** Detail: S41.
- **Hypothesis to test first:** on 9×9 the plausible-move space is small, so the rank-noise / candidate-filtering that weakens the bot on 19×19 collapses toward top-move play — a "15k" with few surviving candidates just plays KataGo's best line. If confirmed, this needs a 9×9-specific weakening mechanism (wider candidate pools / more temperature at low rungs), not just nudged numbers.
- Verify with the bot-vs-bot calibration tooling (AI_CALIBRATION.md) that the ladder still orders correctly after — each rung beats the one below, loses to the one above.
- Both selector paths (TS + Python) read the same profile YAML, so tuning is data-only; a mechanism change must land in both.
- _Acceptance:_ low-kyu 9×9 rungs make visibly human mistakes; Patrick's play-feel check at a few rungs + bot-vs-bot ladder ordering both pass.

### 4a. Highlights: click → quick replay  ✅ SHIPPED 2026-07-05 (S45) — pending Patrick's device pass
Play-of-the-Game highlights become tappable: a highlight opens a quick replay scoped to that moment (reuses the existing replay infra — jump to the move, a few moves of context either side). Explanation copy improvements welcome where cheap, but the deep version is 4b.
- _Acceptance:_ from the game-end highlights, tapping one lands you in the game at that move with the existing per-move explanation; back returns to highlights.
> **Status: shipped (Session 45).** Whole card = tap target ("Watch it
> happen ▶") → replay opens at moveNumber−4, **autoplays into the key move**
> (Patrick's call: motion is what makes "what happened" readable), stops on
> it with the note + graph dot showing; **★ Highlights** button returns to
> the review. `?review=demo` QAs the whole loop.
>
> **Root cause found during design (the real §4a payoff): on-device score
> attribution was one move late** — player moves never get their own
> analysis, and the bridge's root eval (= the position after the PLAYER's
> move) was recorded at the bot's move number. Every player blunder read
> "The bot found a strong move here"; the concept tagger inspected the
> bot's reply and almost never fired. Fixed: the AI-move DTO carries both
> evals (`score_lead_before` → player's move, chosen-candidate eval → bot's
> move), all five gameStore paths merge them, undo trims by move number.
> Web path was already correct (fresh backend analysis per move) and is
> untouched. **Device-pass note: highlights will land one move earlier than
> before, correctly on YOUR move, with you-framed headlines.**
>
> **DEVICE PASS ROUND 1 (2026-07-05): attribution fix validated on device**
> (you-framed "This move backfired" on Patrick's own move). Two findings,
> both fixed same evening (S47):
> 1. **The way back was invisible** (Patrick missed ★ Highlights next to
>    Close and got stuck) → the header title slot becomes an accent-filled
>    iOS-style top-left **"← ★ Back to Highlights"** on drill-down replays.
> 2. **"Clear what the bad play was, not what the good line was"** → the
>    deferred red-stone shipped as the **better-move star**: on a player-
>    mistake key move, on-device KataGo analyzes the position BEFORE the
>    mistake (real history, 100 visits) and its top pick pulses on the
>    board with the lesson-highlight glow + a golden note line ("⭐ A
>    better spot is glowing on the board — worth about N more points").
>    Player mistakes only; hidden when KataGo agrees with the move played;
>    cached per move; retroactive on old games; web shows nothing (bridge-
>    only — Render-analyze web fallback is cut-line). Detail: DEVJOURNAL S47.
>
> **DEVICE PASS ROUND 2 (2026-07-05): "the new feature is really good."**
> One bug — 4-line notes lost the 4th line (the glossary link) to the
> phone's 3-line clamp. Fixed (S48): star hint + glossary link share one
> wrapping row, clamp 3→4 paid from control chrome (not the board), and
> the big-iPad-landscape replay column widened 260→340px out of the
> board's horizontal slack (board is height-bound there — zero cost).
>
> Closes on device pass round 3 (the note fix is the only delta).

### 5. Replay upload — thin slice  ✅ CLOSED 2026-07-02 (Patrick's call after device validation + share test)
Upload a finished game to the backend; get a shareable ID. Motivation: a friend wants to review games with Patrick, and it's the diagnostic channel for §2 (embedded selector logs) and §3 (bot-felt-wrong games become calibration evidence).

> **Status: built (Session 33).** Backend: `app/uploads/storage.py` (own module,
> `uploaded_games` table, kid-readable 8-char share codes, no FKs — split-ready
> per the storage decision below) + `app/routers/uploads.py` (POST/GET, 1MB cap,
> case-insensitive fetch); wired in main.py. Frontend: `ai/selectorLog.ts` ring
> buffer (pass reasons + superko fallbacks + bridge rejected-pick lines; cleared
> on newGame, snapshotted into `SavedGame.selectorLog` on save), Share button in
> the Library (uploads → shows the code, tap-to-copy link on web / bare code on
> iOS, code persists via `sharedId`), `?shared=CODE` deep link hydrates the
> replay. Verified live in the preview end-to-end (upload → cold-load by
> lowercase code with an empty library → step through moves; row + selector log
> confirmed in SQLite), backend smoke (round-trip, 404/400/413), `npm run build`
> green, 186 unit + 9 layout tests. Remaining: on-device pass (share a real
> game from Patrick's iPad to a friend on the web — needs the Render deploy).
- Backend already has SQLite persistence (`storage.py`: players/games tables, `save_game`, `/history`) — on-device games just never call it. Thin slice = a new endpoint accepting the full replay JSON (moves, `scoreHistory`, result, profile rung, board size, **recent `[selector]` log lines**) → returns an ID; a fetch-by-ID that hydrates the replay view.
- In-app: an "Upload game" affordance on the library entry / game-end; loading a shared ID into replay (deep link is fine for now).
- **Storage (decided 2026-07-02):** v1 = a new `uploaded_games` table in the existing SQLite DB on the Render persistent disk (`GOFORKIDS_DB`) — share-ID PK, a few queryable columns, full replay payload as a JSON blob. **Down the road (before App Store release) this splits into its own database** — so build the v1 for a cheap split: uploads get their own storage module (not entangled with `game/storage.py` internals), and payloads are self-contained (no FKs into players/games).
- **UX revision (Patrick, 2026-07-02 evening, shipped S34):** Share lives in the **replay panel** next to Download SGF (not the Library rows); after upload the button IS the link — tap copies the web URL and opens it in the browser (native: new WKUIDelegate hands `window.open` to Safari — needs the Xcode rebuild).
- **Deferred to later versions:** friend codes, friends profiles, browsing others' games and progress — this slice is upload + fetch-by-ID only.
- _Acceptance:_ Patrick uploads a game from his device, sends the ID/link to a friend, the friend opens it in replay on the web. Uploaded games with a bot pass include the pass-reason log.

---

## Out of scope (explicitly deferred)
- **4b — Highlight/replay analysis with alternative play trees.** Needs per-move candidate variations (PVs) captured at play time from on-device KataGo — new data we don't record yet, and retroactive games won't have it. The foundation for real review-mode analysis; likely its own milestone. Decide after 4a ships.
- **Friends / friend codes / social** (extends §5 later).
- Prior deferrals stand: full energy system (26), world & art (27), rewards loop (15), puzzles (02), parent dashboard (14), NUX (05), study mode (04), mistake tracking (16), 13×13 rebalance, phone thermal profiling. 19×19 dame-fill (S27 finding) remains known + non-gating.

---

## Resolved decisions
1. **Undo: flat banked-3** (2026-06-25) — shipped.
2. **Glossary polish: in** (2026-06-25) — closed 2026-07-02 with Patrick's review.
3. **Ko passes: capture-first** (2026-07-02) — no fix attempt until an instrumented repro names the pass path; instrumentation rides §5.
4. **Highlights split 4a/4b** (2026-07-02) — quick-replay in, play-tree analysis parked.
5. **Replay upload thin slice: in** (2026-07-02) — upload + fetch-by-ID only; social layer later.

## Notes / findings
- `isRanked` is a dead flag (never set true) — the ladder is `autoplayContext`; see S26.
- Board has ghost-stone-on-press, commit-on-lift placement (`GoBoard.tsx`) — relevant to how much misclick coverage undo needs.
- `scoreHistory` persists per library entry — why §1 is frontend-only.
- Backend SQLite already exists — why §5 is small.
