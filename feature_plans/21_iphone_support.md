# 21 — iPhone (Pro Max) support

**Status:** 📝 Planned
**Priority:** Medium
**Depends on:** 10 (iPad app — same WKWebView shell)

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
