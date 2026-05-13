# 21 — iPhone (Pro Max) support

**Status:** 🟡 Beta — frontend responsive pass landed 2026-05-08; native re-test on iPhone hardware still pending
**Priority:** Medium
**Depends on:** 10 (iPad app — same WKWebView shell)

## What landed (2026-05-08)
- **Three-tier responsive layout** in `frontend/src/App.css`:
  - Wide (≥ 1100px): existing iPad-landscape three-column layout, unchanged.
  - Medium (700–1099px): avatars become a horizontal strip above the board; board + side panel sit side-by-side underneath. Covers iPad portrait + iPhone Pro Max landscape.
  - Narrow (< 700px): everything stacks vertically. Pass / Resign etc. become a horizontal row. Covers iPhone Pro Max portrait.
  - Phone landscape (height ≤ 500px AND landscape): forces row layout with `.app { height: 100dvh; overflow: hidden }` so the board is height-bound and the canvas's `height: 100%` has something definite to lock onto. Avatar strip becomes a thin 90px column on the left.
- **Board canvas is display-size responsive.** `CANVAS_SIZE = 700` stays as the internal resolution; the rendered display rectangle is now CSS-driven via `.go-board-canvas { width: 100%; max-width: 700px; aspect-ratio: 1 }`. `toBoard()` already converts rect coords → canvas-internal coords, so hit-testing carries over for free.
- **Per-screen responsive passes**: HomePage (title scales, action buttons stack on phone, bot strip scrolls horizontally), LearnView (compact header, smaller progress dots, scrollable dot strip), and the existing dialog system (NewGame, Settings, Library, Replay, ScoringInProgress, BotPassed, LessonStepModal, LessonGameEnd, PrivacyTerms, AccessGate) all already used `width: min(X, 92vw)` patterns and adapt naturally — verified visually at iPad-portrait + iPhone-portrait + iPhone-landscape.
- **Touch targets** on medium and narrow: `.btn { min-height: 44px }` (Apple HIG); replay buttons are 44×44.
- **Safe-area-inset** plumbing: `viewport-fit=cover` + `apple-mobile-web-app-capable` meta tags in `index.html`; `var(--safe-top|bottom|left|right)` CSS variables threaded through `.app`, `.app-header`, `.settings-gear`, `.feedback-button`. Notch and home-indicator stop clipping content.
- **Touch behavior**: canvas gets `touch-action: manipulation` to stop iOS from interpreting a stone-place tap as pinch-zoom or scroll. `user-scalable=no` in the viewport meta keeps the page from rubber-banding.
- **iOS targeting**: `TARGETED_DEVICE_FAMILY = "1,2"` (universal binary) and Info.plist orientation keys for both iPhone and iPad were already set in the iPad project — no Xcode work required to land the iPhone path. The next iPad build automatically becomes a universal binary.

## Polish from real-device playtest (2026-05-08)
After the initial responsive pass shipped, on-device testing surfaced several issues, all fixed:
- **Lesson canvas was stretched non-square** in both iPad orientations because `.go-board-canvas { max-width: 700px }` capped width while LearnView's `width/height: 100% !important` let height fill the larger square container. Override `max-width: none` in `.learn-board-square canvas` so the lesson container's `min(100cqi, 100cqb)` square rule stays in charge. (commit `d381c7b`)
- **Captures + komi were missing on medium/narrow** (the initial pass collapsed them to keep avatar strip thin). Restored compactly: medium gets a single horizontal row of mini stones inside the existing tray; phone landscape shows just the count badge (90px column too tight for stones); phone portrait collapses each tray to a single thin label line ("Captures 1" / "Komi 6.5") with no stones, no background. (commits `d381c7b`, `03f64e6`)
- **Active-player indicator was too subtle.** Border 1→2 px; layered glow (2 px ring + 22 px + 44 px bloom) replaces the single 12 px / 0.15 glow; status text "Playing"/"Thinking" goes 11→13 px, weight 500→700, with a new pulsing `::before` dot. Inactive card fades to 0.55 opacity via `:has(.player-card-active)` so the active one pops by contrast. (commit `d381c7b`)
- **Phone portrait pushed Pass/Resign off-screen** when the score graph was on. The `.game-info` row below the board was rendering everything (turn, matchup, captures, move counter, score graph) — all redundant with the avatar strip except the score graph. Hidden the redundant bits on `max-width: 699px`; only score graph stays. Player cards also tightened: tray padding/background go transparent, mini-stones drop, just thin label lines remain. Card height roughly halves. (commit `03f64e6`)
- **Phone landscape was hiding the score graph** despite plenty of vertical room in the 180 px side panel. Brought it back. (commit `03f64e6`)
- **Mid-game AI stall** from `TypeError: Load failed` on POST /move. Added retry layer to the `request()` helper in api/client.ts — up to 2 retries with 300 ms + 900 ms backoff, only on TypeError (network failures), not on HTTP errors. Why duplicate POST /move can't double-play: TypeError specifically means the request never reached the server, so server state hasn't changed. (commit `d9aaf4e`)
- **Placement accessibility on small viewports** (commits `bbb1176` → `17fcd6b` → `fbdd0c7`). 19×19 on iPhone Pro Max is finger-fatal without help — three-layer fix:
  - *Hold-to-hover-then-place* — pointerdown shows a ghost stone, pointermove drags it around, pointerup commits at the release position. Drag off-canvas to abort. Quick tap still works.
  - *Red crosshair* through the hover point during press — the ghost is invisible under a fingertip, so thin red lines spanning the full row + column give a visible placement target.
  - *Pinch-to-zoom + double-tap reset* — two-finger pinch scales [1, 3] with the midpoint anchored under the fingers; double-tap resets when zoomed. Transform applied via CSS, browser composites smoothly, `toBoard()` works unchanged because `getBoundingClientRect` already returns the transformed rect.
- **Phone-landscape polish** (commits `b0dc91b`, `a393488`): player cards stack avatar-above-name (was overflowing the 90 px column); `.app-header` becomes `position: absolute` in the top-right so the board reaches the viewport top edge; coordinate labels now `'700 12px monospace'` with 24 px clearance from the board edge so glyph tops don't sit on the dark canvas background.

## Polish from second iPad playtest (2026-05-12 / 13)
After Session 17's playtest, more iPad-specific layout polish landed
(also benefits iPhone since they share medium/narrow breakpoints):
- **iPad landscape board got much bigger** (commit `a8714f6`).
  `.game-layout` switched from flex-row to CSS grid: avatar (top-
  left) + side panel (bottom-left) stack on a 260 px left column,
  board fills the entire 1fr right column at `width/height:
  min(100cqi, 100cqb)` square. Board went 700×700 → ~917×917 on
  1366×1024.
- **iPad portrait board got much bigger** (commits `a8714f6` →
  `daf7333` → `8f1432d`). Side panel dropped to a full-width row
  below the board. Game-info row trimmed (turn / matchup / captures /
  move-counter all redundant with the avatar strip). Score-graph
  SVG cap fix (its `width=100%` with no height attribute was
  scaling the 200×70 viewBox to ~350 px on a 1000-wide panel).
  Square-board fix (CSS `width: 100% + max-height + aspect-ratio: 1`
  resolves to a non-square rect; switched to `width: min(100%,
  calc(100dvh - 520px))` so aspect-ratio resolves to a true square).
  Pass / Resign moved to a horizontal row instead of two full-width
  blocks. Board went 700×700 → ~846×846 on 1024×1366.

## Tutorial-game flow polish (2026-05-12)
Session 17 also landed a stack of tutorial-game-flow improvements
(see DEVJOURNAL Session 17 for details): bot keeps playing in the
5x5 tutorial via `neverPass` flag and an exhaustive pass-leak
audit, auto-end on no legal moves via `lessonAutoPass` chain,
ko/suicide explainer modals, board canvas not text-selectable,
plus two lesson-layout fixes (board shift between steps, wrong
second-move reset).

## Action item to ship to iPhone
- Rebuild the iOS app in Xcode → "Bundle React frontend" Run Script picks up the responsive frontend → install on an iPhone Pro Max for native verification of (a) CoreML inference parity vs iPad and (b) layout on real device pixels (browser-resize verification only checks viewport, not safe-area-inset values which are 0 on web but real on hardware).

## What's still open
- **Finish Game still doesn't work on iPad** despite the per-move loop in d34ab1b shipping. Hypothesis: full-strength KataGo at 500 visits on Render b20 takes ~5s per call (state.py:359) plus a follow-up score-lead analyze; over a 50-move endgame, individual calls hit cold-start contention or transient slowness past iPad WKWebView's 60s URLSession timeout. Frontend loop also gives up on first error. **Held pending parallel KataGo perf work** — that may make finish-game work as-is. If still broken after perf lands, parked proposal is: drop visits 500 → 150 in `state.py:finish_move`, add 2-retry layer to `gameStore.finishGame` loop, add `[finishGame]` diagnostic logs.
- **Audio interrupted-state fix verification** — shipped 219aaca with diagnostic logs; awaiting next iPad repro of "sound dies" to confirm the fix or surface a different state to handle.
- **CoreML on iPhone Neural Engines (A17 Pro / A18 Pro).** Current ANE config (`numNNServerThreadsPerModel = 1`, `coremlDeviceToUse = 100`) was tuned for M-series; may need re-tuning per [iPad gotcha #14](../DEVJOURNAL.md). Re-test on first iPhone install.
- **Smaller iPhones (mini, regular).** `< 700px` narrow rules already cover them but no explicit testing yet.
- **Bundle Identifier** still `ccy.KataGo-iOS` from the upstream fork; rename before TestFlight.
- **TestFlight + App Store** — gated on the rebuild + iPhone hardware sanity pass.

## Original plan (preserved for reference)

## What
Make the GoForKids iOS app run well on an iPhone — initial target the iPhone Pro Max form factor (largest current iPhone, the most playable Go board on a phone). Cover both the WKWebView-bundled UI layout and the native KataGo bridge on iPhone hardware.

## Why
- An iPhone is the device most kids actually have access to — the iPad path validates the architecture but a phone build is the realistic distribution channel.
- A phone-shaped session is shorter and more fits-in-pocket: aligns with 9×9 kid ramp (feature 13) which is the natural board size for a phone screen.
- Most of the technical risk is already retired by the iPad app — this is mostly layout, hit-target, and a re-test of CoreML on iPhone Neural Engines.

## Approach
1. **Audit current app layout in iPhone-sized viewports.**
   - Drop the WKWebView into an iPhone Pro Max simulator first; capture what clips, overlaps, or vanishes.
   - Same audit on iPhone 15 / 14 standard sizes for an idea of how far down we want to support.
2. **Decide orientation policy.**
   - iPad bug: portrait clips UI (DEVJOURNAL Known Bugs). For iPhone, portrait is the dominant grip — landscape feels wrong.
   - Probably: iPhone defaults to portrait + Go board scaled to width; iPad keeps landscape primary.
   - Either way, fix the iPad portrait bug first or in parallel — same underlying responsive layout.
3. **Responsive frontend pass.**
   - Audit `frontend/src/` for hard-coded widths / aspect ratios / desktop-shaped components (homepage, new-game dialog, settings, replay viewer, lesson UI, score panel).
   - Smaller boards (9×9, 13×13) should be the default on a phone-sized viewport.
   - Touch-target audit — buttons sized for fingertips on a 6.7" phone, not pointer-precise mouse hits.
4. **Native side.**
   - Confirm CoreML inference works on iPhone Neural Engines (A17 Pro / A18 Pro). The iPad ANE config was tuned for M-series — may need re-tuning thread/device knobs (see iPad gotcha #14).
   - Universal app vs separate iPhone target — likely universal, since the WKWebView shell is the same.
   - Check `Info.plist` device family + supported orientations.
5. **Bot strength on a phone.**
   - Same b28 model, same TS move selector — strength should carry. Re-validate on iPhone hardware that visits/sec is acceptable; A17/A18 ANE should be comparable to M1.
6. **Hit testing on the board.**
   - Stones are smaller in absolute pixels on a phone — a 19×19 board on a 6.7" screen has tiny intersections. Either:
     - Default to 9×9 on phones (cleanest), or
     - Implement zoom + pan for 19×19 (more work, but closer to pad parity).
7. **App Store classification.**
   - Once iPhone runs, the App Store listing covers both. No separate review.

## Scope — first cut
- iPhone Pro Max only (don't optimize for older / smaller iPhones yet).
- Universal binary, same Xcode target as the iPad app.
- Default to 9×9 on phone-sized viewports.
- Portrait-primary on phone, landscape-primary on iPad.
- Fix the iPad portrait clipping bug as a side-effect of the responsive pass.

## Out of scope (first cut)
- Smaller iPhones (mini, regular). Add once Pro Max works.
- iPhone-specific UX features (haptics, Dynamic Island, Live Activities).
- Apple Pencil — iPad-only feature, doesn't apply.
- Zoom + pan for 19×19 on phone (defer; default to 9×9 instead).
- Phone-specific bot calibration (assume b28 + TS selector carry over; re-test only).

## Open questions
- Do we ship phone support before TestFlight, or do iPad TestFlight first and add phone in a follow-up build? Probably iPad-first since it's closer to ready, but phone widens the beta-tester pool meaningfully.
- 19×19 on an iPhone Pro Max: playable, or too cramped? Decides whether zoom/pan is worth the work later.
- Any kid-app review surprises specific to iPhone (vs iPad)?

## Success criteria
- App launches and is fully usable on iPhone Pro Max in portrait.
- 9×9 game playable end-to-end with a finger on a 6.7" screen — no missed taps, no clipped UI, no hidden buttons.
- Bot moves return in comparable time to iPad (sub-second at kid-bot visit counts).
- Same app binary still runs correctly on iPad (no regressions).
