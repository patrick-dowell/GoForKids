# 10 — iPad app

**Status:** 📝 Planned
**Priority:** Medium

## What
A native or near-native iPad experience. Kids use iPads way more than laptops; the board feels natural on a touch screen; App Store presence is a credibility signal for parents.

## Why
- The target audience (7–12) lives on iPads.
- Touch-first stone placement feels better than mouse.
- App Store listing is a discovery channel and a "this is a real thing" signal for parents.

## Approach
Three plausible routes, ordered by effort:

1. **Responsive PWA (cheapest, fastest).** Make the web app iPad-friendly — proper touch targets, iPad viewport handling, PWA manifest, offline for the parts that can be offline. Users "Add to Home Screen" from Safari. *No App Store presence but ships this week.*

2. **Capacitor / webview shell (medium).** Wrap the existing React app in a Capacitor shell, ship to App Store. Keeps the web codebase as the source of truth; native shell handles permissions, storage, notifications. Good for parity with web.

3. **Native SwiftUI rewrite (highest, last).** A real native app. Unity port was mentioned in the v2 roadmap, but for iPad specifically SwiftUI is the most natural fit. Reuse the Python backend unchanged. Keep animation specs in tool-agnostic JSON (already a v1 design goal) so the native app can consume them.

**Leaning:** Ship 1 (responsive PWA) immediately after feature 09. Move to 2 (Capacitor) once beta feedback shows iPad is the primary device. Consider 3 only if we have real traction and a specific native-only feature that justifies it (Apple Pencil annotation during review, say).

### Work regardless of route
- Audit touch targets — stones on a 19x19 board need a tap tolerance larger than the stone itself.
- Handle iPad split view and rotation.
- Test haptics for stone placement (feels great if tuned right).
- App Store content policy for kid-targeted apps — review Apple's guidelines early if going to route 2 or 3.
- Parental privacy labels — App Store requires disclosure about data collection for kids' apps.

## Scope — first cut
- Route 1: responsive PWA. Touch tuning, home-screen install, offline shell.

## Out of scope (first cut)
- Capacitor shell.
- Native SwiftUI.
- Apple Pencil features.
- iOS phone (smaller screen) optimization — iPad first.

## Open questions
- How much of the backend needs to be callable from the app? If online play (07) ships, networking must be rock-solid.
- Apple's kids-app category has extra requirements (no third-party ads, strict data practices) — review before App Store submission.
- Do we need an Apple Developer account now, or only when we ship route 2?

## Dependencies
- Feature 09 (publishing) — the PWA needs a hosted backend.
- Ideally the bot ladder (01) is mostly complete before App Store submission — a first impression with a half-finished ladder is bad.

## Success signals
- iPad session length > desktop session length.
- Kids say "it feels like an app" even on the PWA.
- (For App Store) > 4-star average rating and approval under the kids category.
