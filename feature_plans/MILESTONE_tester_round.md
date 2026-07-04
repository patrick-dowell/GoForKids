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

**Order of attack: §5 → §3 → §1 → §4a.** §2 is in capture-mode, not queued for a fix attempt. **§5 and §1 closed 2026-07-02 (Sessions 33–34, device-validated) — next up: §3 (9×9 profile review), then §4a.** Open bug from §1's device pass: highlight-note cutoff on phone portrait (see §1).

### 1. Score graph in replays  ✅ built + device-validated 2026-07-02 (S34) — one known bug below
Mount the existing `ScoreGraph` in the replay view with a position cursor synced to the timeline. Small and frontend-only: `scoreHistory` is already persisted on every library entry (`libraryStore.ts`), so past on-device games already have the data. Web/stub games without `scoreHistory` simply don't show the graph.
- _Acceptance:_ stepping through a replayed game shows the score arc with a "you are here" marker; matches the live-game graph's read of the final margin.
> **Status: built (Session 34), device-validated by Patrick same night.**
> Shipped as the replay's scrubber — the panel had zero vertical slack (layout
> suite failed 9/14 viewports on the naive mount), so the graph absorbs the
> slider + marker strip: "Move N / M" header, lead-at-cursor, tap/drag-to-seek,
> key-move dots on the arc. No-scoreHistory saves keep the old slider.
>
> **KNOWN BUG (Patrick's device pass, 2026-07-02): highlight-note cutoff on
> iPhone Pro Max PORTRAIT** — the key-move explanation card
> (`.replay-highlight-note`, the "biggest gains and losses" copy) is cut off /
> renders wrong; fine in landscape. Diagnosis: the note only mounts when the
> cursor is ON a key move, adding ~70px to a panel that fits portrait with
> zero slack — the same exact-budget failure the graph itself hit. **The
> layout suite missed it because the replay sweep runs at move 0, where no
> note is visible** — fix must add a seek-to-key-move state to
> `e2e/layout.spec.ts` first, then make the note pay for itself (tighter
> clamp on portrait phones / overlay instead of in-flow / absorb another
> row). Next replay-polish session.

### 2. Ko-fight passes — CAPTURE MODE (no fix attempt until an instrumented repro)
Still occurring in game-breaking situations (Patrick, ~late June — less frequent since Option B, but not gone). **Decision 2026-07-02: we've attempted fixes ≥3 times without closing it; do not attempt #4 blind.** The S27 logging can already distinguish the mechanism — `filtered-empty-*` = the known koSIMPLE-vs-superko mismatch (root fix A: align KataGo's rules config); `pass-threshold` / `katago-top-pass` = a *different* too-eager-pass bug — but no field incident has ever been captured (Patrick is never attached to Xcode when it happens).
- **Action now (folds into §5):** buffer recent `[selector]` log lines in-app and attach them to the saved game — both the local library entry and the §5 upload payload — so the next repro carries its own diagnosis.
- **NEW LEAD (2026-07-03, S35):** first captured field repro — share code **888P9NXK**. Investigation surfaced a backend desync mechanism: `GameStateManager.undo` dropped handicap stones from the backend board (server twin of the Sprint 2 frontend bug — fixed + tested in S35, needs Render deploy). A backend board missing black stones poisons every Render-path analysis, compounding the known empty-`moves` ko hole in `move_selector.py`. **To verify against the repro:** was 888P9NXK (a) a handicap game with (b) an undo before the ko fight? If yes → likely explains the web-path incident; if no → second desync source still at large. Either way the on-device koSIMPLE-vs-superko root fix (A) remains open.
- **Then:** fix whichever path the log names. If it's the superko path, note root fix A changes KataGo's rules config and can subtly shift bot behavior — if that lands after the §3 recalibration, budget a touch-up pass on the profiles.

### 3. 9×9 bot profiles too strong — full review
Patrick played 15k even on 9×9 and it played perfectly through the entire game. Full review of all 9×9 profiles in `data/profiles/b28.yaml`.
- **Hypothesis to test first:** on 9×9 the plausible-move space is small, so the rank-noise / candidate-filtering that weakens the bot on 19×19 collapses toward top-move play — a "15k" with few surviving candidates just plays KataGo's best line. If confirmed, this needs a 9×9-specific weakening mechanism (wider candidate pools / more temperature at low rungs), not just nudged numbers.
- Verify with the bot-vs-bot calibration tooling (AI_CALIBRATION.md) that the ladder still orders correctly after — each rung beats the one below, loses to the one above.
- Both selector paths (TS + Python) read the same profile YAML, so tuning is data-only; a mechanism change must land in both.
- _Acceptance:_ low-kyu 9×9 rungs make visibly human mistakes; Patrick's play-feel check at a few rungs + bot-vs-bot ladder ordering both pass.

### 4a. Highlights: click → quick replay
Play-of-the-Game highlights become tappable: a highlight opens a quick replay scoped to that moment (reuses the existing replay infra — jump to the move, a few moves of context either side). Explanation copy improvements welcome where cheap, but the deep version is 4b.
- _Acceptance:_ from the game-end highlights, tapping one lands you in the game at that move with the existing per-move explanation; back returns to highlights.

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
