# 10 — iPad app

**Status:** 🧪 Beta — runs on a real M-series iPad, native AI inference, bundled UI. Not yet shipped through TestFlight or the App Store.
**Priority:** Medium

## Outcome

Path: chose route 2 (WKWebView shell with native KataGo bridge), executed across
sessions 13–14. The shipping app is a SwiftUI WKWebView host that loads the
React frontend bundled in the app bundle. AI inference runs on-device via Apple's
Neural Engine using KataGo's CoreML backend. Bot rank selection runs in
TypeScript on-device using the same `data/profiles/b28.yaml` Render's Python
backend uses — single source of truth across all platforms.

Render is still required at runtime for game-state endpoints (move/pass/score);
making the iPad fully offline is "Phase D" — see roadmap below.

### What works today

- Real M1 iPad, sub-second AI moves at kid-bot visit counts (~80-90 NN/s
  sustained on M1 ANE)
- All 8 bot ranks (30k–6k) play at b28-calibrated strength matching the web app
- Live score graph from on-device KataGo (no Render dependency)
- Eye-fill safety, sensible openings, auto-pass — all feature-equivalent to web
- Cosmic dark theme app icon
- App icon shows on home screen, app launches like a real iOS app

### Done milestones

| Sub-phase | What |
|---|---|
| Spike (Apr 30) | Validated KataGo + CoreML on real M-series iPad in a throwaway directory; wrote the build playbook (8 gotchas) |
| Phase 1 (May 1) | WKWebView host pointed at Render — sanity check |
| Phase 2A (May 1) | JS bridge + native KataGo for AI moves and score-lead |
| Path C (May 4) | TS port of `move_selector.py` so iPad bots are b28-calibrated, not fixed-strength |
| Phase 3 (May 4) | Bundle React frontend into app bundle, load via custom `app://` URL scheme handler. UI no longer depends on Render |

## Roadmap (remaining)

| Phase | Status | What |
|---|---|---|
| D | next | Port game state (Board / captures / ko / scoring) to TypeScript so iPad doesn't need Render at all. Largest remaining piece (~6-10h). After this, the iPad is fully offline-capable |
| Smoke matrix | when convenient | Real games at each rank × board on iPad to confirm the b28 calibration carried over correctly through the Python→TS port |
| Hygiene | when convenient | Bundle Identifier rename from `ccy.KataGo-iOS` (the upstream fork's) to a phasesix-branded one. Re-triggers signing setup |
| Apple Pencil | future | Annotation during review mode — only relevant if traction warrants it |
| TestFlight | when ready | Distribute to family / beta testers. Requires App Store Connect setup, screenshots, kid-app category compliance review |
| App Store | future | Public listing. Requires kid-app category data-disclosure labels, privacy policy, etc. |

## Architecture (current)

```
┌──────────────────────┐                ┌──────────────────────┐
│      iPad app        │                │       Render         │
│                      │                │                      │
│ WKWebView            │                │  goforkids-api       │
│  (app://localhost/)  │   game state   │  FastAPI + KataGo    │
│        │             │   /move /pass  │  (CPU, b20 default)  │
│        ▼             │ ◄────────────► │                      │
│ Bundled React app    │                └──────────────────────┘
│ (frontend/dist)      │
│        │             │
│        ▼             │
│ window.kataGo        │      AI selection: TypeScript port of
│        │             │      move_selector.py reading b28.yaml
│        ▼             │      runs on-device. Bridge is a dumb
│ KataGoBridge.swift   │      "analyze" surface returning candidates.
│ (analyze)            │
│        │             │
│        ▼             │
│ KataGoHelper.mm      │
│ → CoreML on ANE      │
└──────────────────────┘
```

Single source of truth:
- **UI:** `frontend/src/` serves both web (Render) and iPad (bundled).
- **Bot calibration:** `data/profiles/b28.yaml` consumed by both Render's
  Python (`move_selector.py` via `profile_loader.py`) and iPad's TS
  (`moveSelector.ts` via `profileLoader.ts` and `@rollup/plugin-yaml`).

The bridge detection in `frontend/src/api/client.ts` (`typeof window.kataGo`)
is the only frontend code that knows whether it's running on the iPad or
the web.

## Work regardless of route (still relevant)

- Audit touch targets — stones on a 19x19 board need a tap tolerance larger than the stone itself.
- Handle iPad split view and rotation.
- Test haptics for stone placement (feels great if tuned right).
- App Store content policy for kid-targeted apps — review Apple's guidelines early before TestFlight / App Store submission.
- Parental privacy labels — App Store requires disclosure about data collection for kids' apps.

## Open questions (for App Store submission)

- App Store review for kid-app category — Apple's extra requirements (no third-party ads, strict data practices). Worth a dry-run review of Apple's "Kids" category guidelines before TestFlight.
- Does keeping the Render backend requirement (until Phase D) trip any App Store guideline 4.2? The bundled UI + native CoreML inference + custom URL scheme should make us safely on the right side; worth confirming.

## Reference

- Build playbook + setup steps: `ios/README.md`
- Spike playbook (gotchas): `~/Projects/GoForKidsIOS-Spike/README.md`
- Session-by-session story: `DEVJOURNAL.md` Sessions 13–14

## Success signals

- iPad session length > desktop session length.
- Kids say "it feels like an app" — confirmed on family testing once we have it.
- (For App Store) > 4-star average rating and approval under the kids category.
