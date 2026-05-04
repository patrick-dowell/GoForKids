# Development Journal

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
