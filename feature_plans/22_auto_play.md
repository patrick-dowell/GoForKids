# 22 — Auto-play (matchmaker + ranked progression)

**Status:** 📝 Planned
**Priority:** High
**Scope (first cut):** 19×19 only

## What
The default Play surface picks the matchup for you. Track the player's 19×19 rank starting at 30k. Each rank corresponds to a fixed `(bot, handicap)` tuple — the matchmaker is deterministic, no randomization. Win 3 games at any rung → promote (losses are no-ops). Rank-ups celebrate. The existing "pick board / pick bot / pick handicap" flow becomes "Custom Match," demoted to a secondary entry on the homepage.

## Why
- Three-step setup is a wall for first-time players (especially kids). One-tap Play is the right default.
- "Am I getting better?" is the single biggest retention question Go asks. Without a matchmaker the player has to guess. With one, they see themselves climb.
- The Glicko-2 system in `backend/app/game/rating.py` is fully built. Auto-play exposes it as **shadow tracking** on the Profile page (feature 23) — but rank progression itself runs on a deterministic linear ladder, so kids see clean integer ranks moving up steadily without statistical drift.
- Custom Match still serves adults, bot-vs-bot spectator, and anything off-ladder.

## Approach

### Home page redesign
- Primary "Play" button → goes straight into the auto-play match-picker card.
- Secondary "Custom Match" link below.
- A small "19×19: 27k" rank chip near the Play button. Tap → goes to Profile (feature 23).
- The existing bot roster on the homepage moves behind a "Browse bots" entry that opens Custom Match prefilled.

### Match-picker card (pre-game friction)
Brief screen, ~2 seconds to read, one button:
- Avatar + bot name + bot rank (e.g. "⚪ Sprout — 18k")
- Handicap line ("You play Black, +9 stones" / "even" / etc.)
- Wins-to-promotion counter ("Win 2 more to promote to 26k")
- Play button. No tweaking — that's what Custom Match is for.

### Matchmaker — linear ladder

Each rank is a single fixed matchup. The first promotion (30k → 27k) jumps 3 ranks because there's no validated bot between 30k and 18k, so the lowest "vs-18k" rung is H9 = effective 27k. After the first jump, every promotion is exactly 1 rank.

| Rank | Matchup |
|------|---------|
| 30k  | 30k bot, even |
| 27k  | 18k bot, H9 |
| 26k  | 18k bot, H8 |
| 25k  | 18k bot, H7 |
| 24k  | 18k bot, H6 |
| 23k  | 18k bot, H5 |
| 22k  | 18k bot, H4 |
| 21k  | 18k bot, H3 |
| 20k  | 18k bot, H2 |
| 19k  | 18k bot, H1 |
| 18k  | 18k bot, even |
| 17k  | 15k bot, H2 |
| 16k  | 15k bot, H1 |
| 15k  | 15k bot, even |
| 14k  | 12k bot, H2 |
| 13k  | 12k bot, H1 |
| 12k  | 12k bot, even |
| 11k  | 9k bot, H2 |
| 10k  | 9k bot, H1 |
| 9k   | 9k bot, even |
| 8k   | 6k bot, H2 |
| 7k   | 6k bot, H1 |
| 6k   | 6k bot, even |
| 5k   | 3k bot, H2 *(needs feature 01: 3k validated)* |
| 4k   | 3k bot, H1 |
| 3k   | 3k bot, even |
| 2k   | 1d bot, H2 *(needs feature 01: 1d validated)* |
| 1k   | 1d bot, H1 |
| 1d   | 1d bot, even (top of ladder) |

Komi defaults follow the existing handicap rules in `state.py` (komi → 0.5 when handicap ≥ 1).

### Promotion — first-to-3 per rung
- Win 3 games at the current rung → promote. Losses are no-ops; they don't reset the count, they don't count against you. Wins counter is per-rung and resets on promotion.
- The wins-toward-promotion counter is visible on the match-picker card and the Profile page.
- On promotion: snap to the next rung's `(bot, handicap)` tuple, reset wins counter, fire the rank-up celebration.
- **No demotion.** The displayed rung only moves up.
- **Glicko shadow-tracking.** Each finished game also runs through the existing `update_rating` and the result is stored on Profile (Advanced tab). Glicko does **not** drive promotion in v1 — it's a power-user diagnostic, plus a hedge: if real playtest data shows the linear ladder promotes too slowly or too fast at higher ranks, we can flip to Glicko-driven promotion at 12k+ without re-architecting.

### Persistence
`localStorage` per-browser (until accounts ship). Single key `goforkids.autoplay.v1`:
```
{
  "19x19": {
    "currentRung": "27k",
    "winsAtCurrentRung": 1,
    "lossStreak": 0,                   // for anti-frustration
    "shadowRating": { mu, phi, sigma },
    "history": [{ rung, opp, handicap, result, ts }],
    "promotionEvents": [{ from, to, ts }]
  }
}
```
All ranked games still flow through the backend Glicko endpoint for `shadowRating` math; matchmaking and promotion run client-side off `currentRung` and `winsAtCurrentRung`.

### Rank-up celebration
- Reuse the Cosmic-Board-overlay pattern from Learn-to-Play: full-screen burst, gold-gradient "You're now {rank}!", new rank badge tile, sound. Sticks until tap.
- Fires from the post-game flow once the result is committed and `winsAtCurrentRung` reaches 3. Single overlay on top of the existing game-end modal.
- The first promotion (30k → 27k) is a 3-rank jump — see Open questions for whether it warrants distinct copy.

### Anti-frustration safeguard
If the player loses 5 games in a row at the current rung with zero wins, the next match adds **+2 stones** to the current rung's handicap. Quiet — no UI callout. On the next win the rung's normal handicap is restored. On further losses the +2 stays (no stacking). Caps at 9 total stones (engine limit). For rungs already at H9 (27k vs 18k), the safeguard is a no-op — the bot is already maxed-out weak. Wins counter is per-rung and not affected by the safeguard +2 (you're still on the same rung, just with a temporary cushion).

## Scope — first cut
- 19×19 only
- Home page redesign (Play / Custom Match split + rank chip)
- Match-picker card with wins counter
- Linear-ladder matchmaker (table above)
- First-to-3 promotion
- Per-browser localStorage persistence
- Rank-up celebration overlay
- 5-loss anti-frustration safeguard (+2 stones, restores on win)
- Glicko shadow-tracking writes (no UI effect here; Profile page is where it shows)

## Out of scope (first cut)
- 9×9 / 13×13 auto-play (waits on those validated ladders — feature 01 dependency)
- Demotion mechanics
- Cross-device sync (waits on user accounts)
- Rank-over-time chart (lives on the Profile page — feature 23)
- Per-rank badges on the homepage roster
- Match-picker variants ("rematch", "switch colors", "play one more")
- Glicko-driven promotion (linear ladder is v1; flip-over is a future option, not a v1 feature)

## Open questions
- **5k → 4k wall.** What happens when the player wins 3 at 5k but the 3k bot isn't validated yet? Options: (a) stay at 5k pending validation with a "you're at the top of the calibrated ladder" message, (b) promote to 4k anyway and use the in-progress 3k profile (risky if calibration shifts). Default: **(a)**. Same question applies to 6k → 5k since 5k itself uses the 3k bot.
- **First promotion celebration.** 30k → 27k is a 3-rank jump and the first time the player encounters handicap mode. Worth distinct copy ("you've graduated to handicap mode!") in the celebration, or treat identically to other promotions? Default: identical.
- **Anti-frustration interaction with wins counter.** Default above is "wins counter is unaffected by the safeguard +2." Confirm this is the intent and not "wins-while-safeguarded count at half weight" or similar.
- **Custom Match games — feed Glicko shadow?** Default: no — auto-play only, so Custom Match remains a sandbox. Otherwise sandbagging in Custom Match could distort the shadow rating.

## Dependencies / pre-reqs
- **Feature 01 (bot ladder completion).** 19×19 currently has 30k → 18k → 15k → 12k → 9k → 6k validated; 3k and 1d still "coming soon." Auto-play is functional today but will hit a wall at 6k → 5k until 3k bot is validated.
- **Feature 23 (Profile page).** Tightly coupled — same data model, Profile is the destination the rank chip points at. Recommend shipping 22 + 23 together.
- **Feature 17 superseded.** Its remaining unique contributions (rank chart + rank-up celebration) are absorbed by 23 and 22. Mark on hold in the index.
- **Feature 15 (rewards loop).** Rank-ups are milestones in the rewards taxonomy. Coordinate the celebration assets so the rank-up overlay isn't a one-off.
- **`rank_to_rating` dan-side bug.** `rank_to_rating("1d")` returns 2100, less than `rank_to_rating("1k")` = 2400. Should be 2500 (one rank above 1k). Doesn't block auto-play (linear ladder doesn't need accurate Glicko ratings), but the shadow Glicko display on Profile breaks at the top of the ladder. Fix while we're in there.
- **`to_go_rank` comment in `rating.py`.** Says "1500 = ~15k"; per the actual formula 1500 = 10k. Cosmetic.

## Sequencing
Slots into Wave 1 (foundations for feedback) alongside features 01 and 13. Auto-play is the answer to "what does the average kid do when they tap Play?"

## Success signals
- Day-1 retention: kid completes Learn-to-Play → taps Play → finishes the auto-picked game → returns the next day.
- Median games-to-first-promotion: 3–6 games (3 is the floor with a 50% expected win rate at 30k vs 30k).
- Adults find Custom Match without support questions.
- Rank-up celebrations get screenshotted / shown to parents.
- Anti-frustration trigger fires < 10% of the time (high frequency = a bot calibration is off, not the matchmaker).
