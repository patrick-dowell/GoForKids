# 08 — Traditional board mode

**Status:** ✅ Done (first cut) — 2026-04-22
**Priority:** Low

## What
A settings toggle that swaps the cosmic theme for a traditional look: wooden kaya board, glass/shell stones, classic click sound, no animations beyond a simple stone placement. For adults and kids who prefer the classic aesthetic.

## Why
- Not everyone wants the cosmic theme; some adults specifically want a "normal" Go board.
- Cheap way to double the audience (adult secondary audience stated in v1 overview).
- Tests how portable our renderer is — good scaffolding for future themes (anime, minimalist, etc.).

## Approach
1. **Theme abstraction.** Pull all board/stone visual params out of `GoBoard.tsx` into a theme object: board color, grid color, star point style, stone renderer, hoshi size, line weight, shadow.
2. **Two themes shipped.**
   - `cosmic` (default) — current look.
   - `classic` — kaya wood color, black stones with subtle highlight, white stones off-white, thin black grid.
3. **Sound pack abstraction.** Same approach — swap the Web Audio procedural chimes for a sampled wooden click for classic mode. Keep capture sounds minimal.
4. **Animation intensity.** Classic mode turns down the squash/stretch and capture particles — an opinionated choice that reads as "serious".
5. **Settings surface.** New settings panel (we don't have one yet). Theme + sound + animation-intensity sliders live here. Persist to localStorage.
6. **Territory overlay variant.** Nebula gradient → simple translucent color fill in classic mode.

## Scope — first cut
- Theme abstraction, two themes, sound swap, setting in a simple modal.

## Shipped
- `theme/themes.ts` with `Theme` type + `cosmic` and `classic` themes.
- `settingsStore` persists theme choice to localStorage.
- Classic theme: kaya wood board, slate/clamshell stones, thin dark grid, flat translucent territory, reduced animation intensity, red halo for last-move marker.
- Real sampled sounds in `frontend/public/assets/` (placement + capture m4a) for classic mode, with procedural fallback if the sample fails to load.
- Floating gear (bottom-right) opens a settings dialog with side-by-side preview cards.
- UI chrome (homepage, player cards) stays cosmic — intentional scope limit noted in first-cut.

## Follow-ups left open
- Per-piece cosmetic overrides (cosmic board + classic stones, etc.).
- Unlockable themes (belongs in rewards cluster — feature 15).
- Dedicated settings panel with separate toggles for theme / sound / animation intensity (today they're bundled).
- Reskin the rest of the UI chrome for classic mode.

## Out of scope (first cut)
- Unlockable themes tied to play progress (that's the cosmetics feature).
- Custom user-uploaded themes.
- Per-piece-type overrides (e.g., cosmic board with classic stones).

## Open questions
- Is this a v1.x polish or v2 work? **Leaning:** low priority, do after 01/03/04/05/09.
- Where do settings live in the UI? We don't have a settings route yet.
- Does classic mode turn off milestone stickers and cosmic UI chrome, or only the board?

## Dependencies
- None hard. Easier to land if we first extract a settings panel (doesn't exist yet).

## Success signals
- An adult tester says "I'd use this" without qualification.
- No rendering regressions in cosmic mode after the refactor.
