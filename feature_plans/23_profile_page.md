# 23 — Profile page

**Status:** 📝 Planned
**Priority:** High
**Scope (first cut):** 19×19 only (matches feature 22 scope)
**Supersedes:** Feature 17 (rank progress UI widget)

## What
A Profile route in the main app navigation alongside Play, Learn, Custom Match, Library. Shows the player's avatar + name, current 19×19 rank, the current matchup, progress toward next promotion, a rank-over-time chart, and — behind an Advanced toggle — the underlying Glicko numbers, recent-results buffer, and dev tools for resetting / manually setting rank during beta.

## Why
- Rank tracking only matters if the player can see it. Today the Glicko code is invisible.
- The avatar picker currently lives in `NewGameDialog`, which becomes the secondary "Custom Match" entry under feature 22. Avatar selection needs a permanent home reachable from the default Play flow.
- Beta testers (you + a small group) need an easy way to reset / manually-set rank to validate the matchmaker from cold without clearing localStorage by hand.
- Future surfaces (parent dashboard, account sync, multiple profiles) anchor cleanly to a Profile page that already exists.

## Approach

### Navigation
Add a fifth top-level entry on the homepage nav: **Play / Learn / Custom / Library / Profile.** Profile route renders the page below.

### Page layout (top to bottom)

**1. Header — Avatar + Name.**
Big avatar tile + display name. Both editable inline. Tapping the avatar opens the picker grid (moved from NewGameDialog). Name is free text.

**2. Current rank card (19×19).**
- Big rank label: "27k"
- Current matchup: "Playing 18k bot with +9 stones"
- Wins-to-promotion meter: "1 of 3 wins toward 26k" with a 3-segment progress bar
- Recent results strip: last ~10 games as small W/L chips with hover-tooltip per chip (date, opponent, handicap)

**3. Rank graph.**
Line chart of rank over time. X-axis: game number (chronological). Y-axis: rank label, ordered top-to-bottom 30k → 1d. Promotion events marked as gold dots. Default range: full history (capped at 200 games for perf); zoom/pan on click.

**4. Avatar picker.**
The same grid currently in `NewGameDialog`, full-page-friendly. Selected avatar persists; reflected in the header tile and in any game where the player is shown.

**5. Advanced toggle.**
Collapsed by default. Persists open/closed in `localStorage`. When open, reveals:
- **Glicko under the hood:** `mu` / `phi` / `sigma` + 95% confidence interval + Glicko-derived rank label ("Glicko: 28.4k ± 2.1"). Read from `shadowRating` in `goforkids.autoplay.v1`.
- **Recent-results buffer:** full structured list, last N games — rung, opponent, handicap, result, timestamp.
- **Matchmaker decision pseudocode:** trivially small for v1's deterministic ladder ("rung = 27k → matchup = 18k bot, H9"); placeholder for future variants.

**6. Dev tools** (sub-section under Advanced):
- **Manual rank set** — dropdown of all ladder rungs (30k → 1d). Selecting one snaps `currentRung` to that value and resets `winsAtCurrentRung` to 0. Confirm modal.
- **Reset to fresh 30k** — wipes the entire `goforkids.autoplay.v1` payload. Confirm modal with "type RESET to confirm" pattern.
- **Export JSON** — dumps the full payload to a downloadable `.json` file (paranoid-tester safety net during beta).
- **Import JSON** — loads a previously-exported payload (useful for testing specific ranks against specific game histories).

### Persistence
Same `goforkids.autoplay.v1` localStorage key feature 22 uses. Profile is a read/write surface on top of the data model auto-play already maintains.

### Avatar picker decoupling
`NewGameDialog`'s avatar picker becomes a read-only display ("playing as Nova") with a "Change in Profile" link. Avoids two places that could disagree about the active avatar.

### Empty / cold-start states
- Brand-new player (zero games): rank card shows "30k — first match coming up!", graph shows a "no games yet" placeholder, recent-results strip empty, wins counter at 0/3.
- Reset: same as cold-start, plus a brief confirmation toast.

## Scope — first cut
- Profile route in main nav
- Avatar + name header
- Current rank card with matchup + wins meter + recent results strip
- Rank graph (line chart, full history, game-number x-axis)
- Avatar picker (moved from NewGameDialog)
- Advanced toggle revealing Glicko internals + recent-results buffer + matchmaker pseudocode
- Dev tools: manual-set, reset, export, import (gated under Advanced)
- 19×19 section only

## Out of scope (first cut)
- 9×9 / 13×13 / 5×5 sections (sized for feature 01 progress; show "more board sizes coming soon")
- Parent-facing variant of the profile (feature 14)
- Multiple profiles per browser (until accounts ship)
- Profile sharing / public link
- Social features (friends, rivals, etc.)
- Custom-Match game history filtering on this page (Library handles that)
- Display-name kid-safe filter list (free text in beta; revisit before public release)

## Open questions
- **Rank graph X-axis: game number, or wallclock date?** Default: game number (more meaningful in low-game-count regime).
- **Rank graph Y-axis: discrete rung label or continuous shadow Glicko `mu`?** Default: discrete rung (matches the matchmaker's view of reality). Glicko line could be a togglable secondary line under Advanced later.
- **Manual-set granularity:** rung-only, or also raw `mu/phi/sigma`? Default: rung-only in v1; raw Glicko set is over-engineered.
- **Dev tools longevity:** keep under Advanced indefinitely, gate behind a `?dev` query param, or hide before public release? Default: under Advanced for closed beta; revisit when public release approaches.

## Dependencies
- **Feature 22 (auto-play).** Tightly coupled — Profile reads the same `goforkids.autoplay.v1` data model. Ship together.
- **Feature 11 (avatars).** Picker UI moves here. Future avatar expansion lands in this surface.
- **Feature 17 (rank progress UI widget) — superseded.** Rank chart from 17 lives here; rank-up celebration is in 22; homepage rank chip is in 22. Mark 17 on-hold in the index.
- **`rank_to_rating` dan-side bug.** Same as feature 22's note — needed for the shadow Glicko display to be correct at the top of the ladder.

## Success signals
- Players visit Profile at least once per session (curiosity / progress check).
- Manual-set is used during beta to validate matchmaker decisions across the ladder without grinding 100+ games per validation.
- Adults find the Advanced toggle and the Glicko numbers track their intuitive sense of strength.
- After feature 14 (parent dashboard) ships, the parent-facing variant is a transformation of this page rather than a parallel rebuild — the data model on this page is rich enough.
