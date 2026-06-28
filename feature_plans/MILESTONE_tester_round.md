# Milestone — Tester Round: Learning-Loop Polish

**Created:** 2026-06-25
**Audience:** the 6 current testers — mostly adults, a few elementary kids. **Already onboarded** (they've done learn-to-play). NOT camp / cold-start kids — the July camps are a separate, later target.
**Theme:** harden and polish the just-built learning engine (Sessions 23–25) and close the one navigation trap, then ship. **Validation > new features** — the point of this round is good signal on the learning loop, not new surface area.
**Exit criteria:** every Tier-1 item below is closed *and* device-validated by Patrick + Roland.

---

## In scope

### 1. Lessons polish
The lessons are now the front door for any returning/new player, and they were reworked in Session 25 (renamed per-concept, grammar/voice, "self-capture", new 9×9 pre-game card). Remaining:
- **The ramp gap** — lessons 6–9 don't prepare a kid for a real 9×9 game; the jump is too steep (flagged in DEVJOURNAL "Polish / Feature gaps"). Tighten the bridge from concept → first 9×9.
- **Wrong-answer handling (observed in the first-7yo playtest, 2026-06-27):** a quiz `kind` lesson gives **no help and no retry** on a wrong answer — the kid stalled and got discouraged. Add a concept-specific nudge + a try-again instead of a dead end. Highest-priority lessons-polish item; details in [03 concept lessons](03_concept_lessons.md) §"Next batch" D.
- Flow/copy issues surfaced during device play.
- _Acceptance:_ a player finishing the lesson arc can sit down to a 9×9 ranked game without feeling dropped off a cliff, and a wrong quiz answer coaches rather than dead-ends. Folds into [03 concept lessons](03_concept_lessons.md).

### 2. Replay polish
Session 25 turned replay into a review surface (timeline markers, ★ skip-to-key-move, per-move explanation + concept link, handicap/dead-stone scoring fixes). Remaining:
- **Surface the score (`scoreLead`) graph during replay** — at minimum show how the game's score moved, the most-requested "more analysis" item.
- General flow/legibility polish from device play (marker density, the un-crammed iPhone controls row).
- _Acceptance:_ stepping through a finished game tells a clear story — key moves marked, what happened, and the score arc. (Device-validate handicap-game replay scoring — see §7.) Folds into [04 AI teacher review](04_ai_teacher_review.md).

### 3. Highlights (Play of the Game) polish
Selection is by **engine swing** (the moves where KataGo's per-move score moved most), captures interpreted as consequence. **Has never been seen working with real scores** — the local stub AI has no per-move `scoreHistory`, so PotG only populates on device.
- **Validate it produces sensible highlights on a real device** with on-device KataGo scores; tune selection if the picks aren't the moves a human would call decisive.
- Confirm each highlight's concept link lands on the right glossary page, and the opt-in "See your Play of the Game" flow reads well on the ranked game-end modal.
- _Acceptance:_ a real ranked game yields 1–3 highlights that feel like the actual turning points, each linking to a concept. [28 learning engine PotG](28_learning_engine_potg.md).

### 4. Undo banking  ✅ built + locally verified 2026-06-25 (pending device validation, §7)
Replaces today's unlimited undo with a bounded, kid-forgiving resource in ranked.

> **Status:** Built. `npm run build` green, 163 tests pass (+5 new in
> `autoPlayStore.undoBank.test.ts`), and verified live in the preview: the
> ranked button renders `Undo (N)`, a click spends 3→2, it's disabled at 0
> with an explanatory tooltip, losses pay out +1, capped at 3, persists across
> reload. Uncommitted on `main`. Remaining: on-device pass (§7).

- **Step 0 (DONE — gated on `autoplayContext`).** Two different "ranked" notions exist: (a) the **auto-play ladder** (the real progression) launches with `autoplayContext: true` and leaves `isRanked` false — that's why undo showed there; (b) the **Custom Match "Ranked" checkbox** sets `isRanked` (drives the backend `mode` + the Library "· Ranked" badge), with `autoplayContext` false. The bank gates on `autoplayContext` so it meters only the ladder. Custom-ranked games keep their prior behavior (undo hidden via the retained `!isRanked` gate); custom-unranked / lesson / casual stay unlimited.
- **Design (flat banked-3 — decided 2026-06-25):** bots reply near-instantly, so there's no information-free window to tell a misclick from a misplay — don't try. Every ranked undo spends one token.
  - **Bank capped at 3.** Each undo in ranked spends 1; at 0, undo is unavailable until refilled.
  - **+1 to the bank on every ranked game finished (win or loss)**, capped at 3 — so there's always ≥~1 undo/game, which covers misclicks comfortably.
  - **New ranked player starts with a full bank (3).**
  - **Casual / unranked: unlimited undo** (unchanged).
- **Skip the resign-farming guard** here — a +1 undo isn't worth a 20-second resign, and cap 3 bounds it. (Keep that guard for the full energy system later.)
- **Record undo usage in `HistoryEntry` from day one** (per fp 26) so assisted wins can be discounted in shadow rating later if it matters.
- Small HUD: "undos left" indicator in ranked + a brief "+1 undo earned" beat on game-end.
- _Acceptance:_ ranked undo is bounded to a visible 3-deep bank that refills +1 per game finished (win or loss); at 0 it's unavailable; casual undo is untouched. A narrowed, shippable subset of [26 ranked energy](26_ranked_energy.md) — does not foreclose building full energy later.

### 5. "Can't get back to menu" fix  ✅ built + locally verified 2026-06-25 (pending device validation, §7)
The #1 open bug. Root cause confirmed in code: the `.scoring-overlay` (z-index 9500) is **non-dismissible** (only auto-clears when `scoringInProgress` flips false), and `request()` had **no timeout** — so a hung backend left it covering the only path home (the title) forever.

> **Status: built — three layers (tactical; state-machine refactor deferred per Patrick).**
> 1. **Home control in the game-screen header** ([HomeButton.tsx](../frontend/src/components/HomeButton.tsx)), next to Library / New Game — consistent control placement, and zero extra vertical cost (matters on iPhone). The "GoForKids" title is now a plain heading (it was a hidden, coverable home affordance). Sub-screens keep their own "← Home" banners; all home paths route through one teardown, so no redundant double-Home.
> 2. **Centralized `goHome()`** in App: aborts in-flight requests, tears down every overlay/sub-view, resets all view flags. Every home affordance (header button, each screen's exit, the scoring escape) routes through it — fixes the family of "flag left in a bad combo" bugs (e.g. replay-close #4).
> 3. **Trap-proofing the one full-screen blocker (the scoring overlay).** `request()` now has a 20s `AbortController` timeout + `abortPendingRequests()`, so a hung scoring call aborts → its `catch` flips `scoringInProgress` false → **the modal self-clears**. The modal also reveals a **"Taking too long? Go home" escape after 8s** so the user never has to wait on the timeout. ([client.ts](../frontend/src/api/client.ts), [ScoringInProgressModal.tsx](../frontend/src/components/ScoringInProgressModal.tsx))
>
> Mid-game, the header Home confirms ("Leave this game? Progress won't be saved" — a React confirm, not WKWebView-flaky `window.confirm`); elsewhere it goes home immediately, with no false confirm even if a stale `phase: 'playing'` lingers. Verified live (desktop + 375px iPhone width): the header fits, the mid-game confirm, and the delayed scoring escape all work (screenshots); no console errors, build green, 163 tests pass. Remaining: on-device pass (§7).
>
> _Escalation:_ if traps still recur after testing, do the **screen state machine** (collapse the ~7 view-flag booleans into one enum).

### 6. Glossary polish
Patrick's **voice pass** on the first-draft glossary copy — the kid-simple `short` lines and concept pages in [`src/learn/concepts.ts`](../frontend/src/learn/concepts.ts). **In scope** for this round (confirmed 2026-06-25).

### 7. Device validation (Patrick + Roland) — the gate
Most of Sessions 23–25 shipped in code but has **never been validated on a real device**. This pass clears that backlog. Checklist:
- [ ] **Play of the Game** populates with sensible highlights on real KataGo scores (§3); on a **handicap game** the snapshot diagrams now include Black's handicap stones (fixed 2026-06-27 — confirm on device).
- [ ] **Handicap-game replay scoring** is correct on a fresh handicap game (§2).
- [ ] **Settle-fill:** bot passes promptly after the player passes (no 2–3 own-territory moves).
- [ ] **Score graph** roughly matches the final margin, including late-game.
- [ ] **Rung 12k (9×9)** plays to scoring with White's line showing **komi 3.5** (not 0.5).
- [ ] **6k difficulty** feels right at rungs 8k–6k; bot-vs-bot still beats 9k, still loses to 3k (the v3 soften is unvalidated).
- [ ] **Derank button + loss-setback note** render correctly (styled blind against the dark theme).
- [ ] **Color variety** alternates on the even rungs as intended.
- [ ] **Undo banking** behaves per §4 on device (the `Undo (N)` header button counts down; refills +1 per game; casual unlimited).
- [ ] **Back-to-home (§5)** — the header **Home** button works from any screen incl. mid-game (confirm), and the scoring overlay shows a "Go home" escape after ~8s.
- [ ] **Ko-superko safety net (Session 27)** — reproduce the ko/premature-pass; the bot should now **play a legal move instead of passing**. Watch the Xcode console for `[selector] PASS reason=…`: if a bad pass survives and logs `katago-top-pass`/`pass-threshold` (not `filtered-empty-*`), that's a *separate* too-eager-pass issue, not superko. (Root rules fix A + the 19×19 dame fill remain open — DEVJOURNAL Session 27.)
- _Watch (don't actively build):_ iPad **sound-death after several games** — a likely-fix + diagnostics already shipped; if it recurs, capture the `[Audio] resuming AudioContext, state was: <X>` log.

> **Deploy note:** the Session 24 komi fix lives in the bundled frontend, so a fresh **Xcode rebuild** picks it up for device testers — no Render redeploy needed for TestFlight. The **Render redeploy** only matters for *web* clients (who don't run on-device analysis); do it before any web tester sees the score graph.

---

## Out of scope (explicitly deferred)
- **Energy — full system** (26): undo banking is the only slice this round. Hints / Finish-Game economy, "losses pay out", aspiration loop → later.
- **World & art pass** (27), **rewards loop** (15), **puzzles** (02), **parent dashboard** (14), **NUX / front-door routing** (05 — testers are already onboarded), **study mode** (04 design).
- **13×13 bot rebalance**, **iOS SGF download bridge**, **phone thermal profiling** — known, low-priority, not gating this round.

---

## Resolved decisions
1. **Undo: flat banked-3** (decided 2026-06-25). Misclick-vs-misplay can't be told apart — the bot replies near-instantly, so there's no information-free window. The bank handles misclicks fine (≥1 undo/game). §4 reflects this.
2. **Glossary polish: in** for this round (§6).

## Notes / findings (2026-06-25)
- **`isRanked` is a dead flag** (never set `true` anywhere) — see §4 step 0. This is also why "remove undo from ranked" looked done in code but wasn't in practice.
- The board already has **ghost-stone-on-press, commit-on-lift** placement ([GoBoard.tsx](../frontend/src/board/GoBoard.tsx)), which mitigates some touch misclicks — relevant when judging how much the free-misclick undo actually needs to cover.
