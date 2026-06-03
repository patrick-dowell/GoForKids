# 24 — 9×9 ranked ladder (komi-based fine-grained handicap)

**Status:** 📝 Planned
**Priority:** High (top response to beta feedback that 19×19 is intimidating)
**Scope (first cut):** 9×9 auto-play ladder only

## Context

TestFlight beta feedback (2026-05-14 → 2026-05-17): the app is fun but 19×19 is daunting for newcomers. Even 18k Sprout + 9 handicap stones is a hard first game. 9×9 is the natural softer on-ramp — smaller board, faster games, more wins per session — but right now the 9×9 ladder has only **4 profile rungs** (30k Seedling, 15k Pebble, 6k Ember, 1d Void) and no auto-play surface. Auto-play and Profile (features 22, 23) are 19×19 only.

**Anchor state (user playtest + Phase 0/1 bot-vs-bot, 2026-05-18):**
- **Trusted anchors:** 30k Seedling, 6k Ember, 1d Void — playtest- AND bot-vs-bot-validated. Rank ordering monotonic, gaps real.
- **Broken / replaced:** old 15k Pebble — Phase 0 confirmed it plays at ~25–30k effective strength. Re-tuned with new knobs in `b28.yaml`.
- **Speculative additions (need validation):** new profiles for 18k, 12k, 9k, 3k. Each is a conservative knob-delta step from its nearest validated anchor.

## Phase 0/1 results (2026-05-18)

**Phase 0 — rank-ordering validation** (180 games, ~1h wall time):

| Pairing | Gap (label) | Black% | Avg margin (B persp) | Interpretation |
|---|---:|---:|---:|---|
| 30k v 15k | 15 | 7% | -70 | 15k UNDER-strength |
| 15k v 6k | 9 | 0% | -84 | 15k stomped by 6k like 30k is |
| 6k v 1d | 6 | 13% | **-26** | clean, real Go |
| 30k v 6k | 24 | 0% | -89 | calibrated |
| 30k v 1d | 21 | 0% | -89 | calibrated |
| 15k v 1d | 14 | 0% | -86 | 15k stomped same as 30k v 1d |

The 30k → 6k → 1d chain is monotonic and well-calibrated. Old 15k is the lone outlier — when 6k crushes 15k as completely as it crushes 30k (-84 vs -89 avg margin), 15k's effective strength is in 30k territory.

**Phase 1 — komi-per-rank slope** (600 games over 15 cells, ~2.5h):

| Profile | Visits | Komi: +14 → -14 (Black%) | Slope verdict |
|---|---:|---|---|
| 30k | 4 | 52 / 50 / 52 / 52 / 65 | **komi-deaf** (responds only at extreme) |
| 6k | 12 | 50 / 50 / 52 / 85 / 75 | **2-step** (peaks at -7, regresses at -14) |
| 1d | 50 | 15 / 40 / 80 / 85 / 95 | **clean sigmoid**, 4 usable rungs |

**Key finding: komi response scales with visit count.** Low-visit profiles produce stomp games where score is decided by who-captures-what (komi is noise). High-visit profiles produce real Go games where komi shifts outcomes monotonically. The boundary is somewhere between 12 and 50 visits — **a new mid-tier profile meant to support komi-based ladder rungs needs ≥30 visits.**

## Profile design for the missing ranks (speculative v1, 2026-05-18)

Five profiles added/revised in `data/profiles/b28.yaml` 9×9 block. Design principle learned from the old 15k's failure: **small knob deltas per 3-rank step**, not big simultaneous deltas at every knob. The old 15k erred by combining higher randomness + higher local_bias + lower policy_weight + local_bias_in_opening all at once vs the 6k baseline; cumulatively this over-weakened it by ~15 ranks.

Conservative knob progression (the values that change between adjacent ranks):

| Rank | visits | mistake_freq | mpl | randomness | rmc | local_bias | lbio | policy_w | opening_mv |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 30k | 4 | 0.70 | 30 | 0.88 | 0.20 | 0.85 | true | 0.08 | 2 |
| **18k** | 9 | 0.65 | 25 | 0.76 | 0.14 | 0.47 | true | 0.15 | 3 |
| **15k** (new) | 10 | 0.625 | 23 | 0.73 | 0.12 | 0.38 | true | 0.18 | 3 |
| **12k** | 11 | 0.60 | 21 | 0.70 | 0.10 | 0.30 | false | 0.22 | 4 |
| **9k** | 12 | 0.575 | 19 | 0.67 | 0.09 | 0.22 | false | 0.24 | 4 |
| 6k | 12 | 0.55 | 18 | 0.65 | 0.08 | 0.18 | false | 0.25 | 4 |
| **3k** | 30 | 0.40 | 13 | 0.52 | 0.05 | 0.12 | false | 0.38 | 4 |
| 1d | 50 | 0.22 | 8 | 0.38 | 0.02 | 0.06 | false | 0.50 | 3 |

Validation matrix runs adjacent-pair bot-vs-bot:
- 30k v 18k, 18k v 15k, 15k v 12k, 12k v 9k, 9k v 6k, 6k v 3k, 3k v 1d
- 30 games per pairing = 210 games total, ~1.5h wall time
- Target: stronger wins **70–85%** per 3-rank step (~75-80% is typical for 1-rank gap on 19×19; 3-rank gap on 9×9 is comparable due to compressed effective ranges)

Per-pairing pass criteria: stronger profile wins 60–90% inclusive. Outside that band → adjust the candidate profile and rerun.

Run via:
```sh
make 9x9-ladder-up                      # backend if not still up
make 9x9-ladder-profile-validation      # ~1.5h adjacent-pair matrix
```

## What

A 9×9 ranked auto-play ladder modeled on the 19×19 one (feature 22), but with two structural differences driven by the math of 9×9:

1. **Komi instead of stones for fine-grained handicap.** A single handicap stone on 9×9 is worth roughly 2–3 ranks of strength (vs ~1 rank on 19×19), so the stones-only model used on 19×19 produces a chunky 4–5 rung ladder. Komi adjustment in 1–3 point increments gives us ~10–15 smooth rungs over the same skill range.
2. **No new Fox-data calibration.** Three of the four existing profile rungs (30k, 6k, 1d) are playtest-validated. Calibration work in this feature is *between-profile ELO + handicap economics*, not absolute strength tuning. If a gap is too large we add an interpolated profile rung, but we're not re-tuning the 3 known-good ones. (15k may need re-tuning depending on Phase 0 results.)

End-state: tap Play on 9×9 → one-tap match-picker → a (bot, komi) tuple that adjusts by ~1 rank between rungs → progressive promotion just like 19×19.

## Why

- **Beta retention.** "First win" is the single most important moment for a new player. A 9×9 ladder starting at very-beginner-friendly settings gets a kid to "I won!" in their first few games.
- **9×9 is the natural Go on-ramp.** Real Go pedagogy starts on 9×9. Lessons (feature 03) graduate kids onto 9×9 games; right now they hit a 4-rung ladder with big gaps.
- **Existing 4 profiles are already calibrated.** The expensive work (profile tuning) is done. Building the ladder around them is a structural exercise, not a calibration cycle.
- **Komi is already a first-class field.** `Game.ts:35` constructor takes a `komi: number`; `state.py:179` accepts it on game creation; SGF round-trips it via `KM[...]`. No engine changes needed.

## Why komi, not stones (first cut)

| Dimension | Stones on 9×9 | Komi |
|-----------|---------------|------|
| Granularity | ~2–3 ranks per stone (8–12 points) | ~1 rank per 3–5 points |
| Max useful | ~5 stones (the board is too small for more) | unbounded |
| Kid-visible | Yes — stones on the board are obvious | No — number on a scoreboard |
| Engine-ready | Yes (`_handicap_positions` table in state.py) | Yes (komi field on `Game`) |
| Standard practice | Common but coarse | Common in handicap-komi formats (e.g. KGS, OGS) |

Komi wins for v1 because **granularity is the blocker** — we can't make a smooth progression with a tool that jumps 2–3 ranks per step. Stones are the better long-term answer for kid-visible feedback, deferred to the "stones translation" sub-plan below.

## Approach

### Phase 0 — sanity: validate rank ordering across the existing 4 profiles

Before adding any new rungs, prove the 4 existing profiles produce a monotonic strength order on 9×9. Runs cross-profile, even games, default komi=7.5.

Three adjacent pairings plus three triangulations (every-to-every). Triangulation matters here because the user has flagged 15k as possibly under-strength — if 30k v 15k comes in too tight AND 15k v 6k comes in too one-sided, the triangulation pairings (30k v 6k, 30k v 1d, 15k v 1d) tell us whether 15k is the odd one out or whether something else is drifting.

Run via the orchestrator (`make 9x9-ladder-overnight` covers both phases):
```sh
python data/calibrate_9x9_ladder.py --output-dir data/calibration_logs_b28/9x9_ladder_2026-05-18 --phases 0
```

Pass criteria per pairing:
- Black (the weaker profile) wins **< 30%** at the 95% CI upper bound, AND
- The triangulation chain (30k → 15k → 6k → 1d) is monotonic in win rate.

Failure → identify which profile is the outlier and decide: re-tune, or replace with an interpolated profile (Phase 2).

### Phase 1 — empirical handicap economics: how many komi points = 1 rank?

This is the core measurement. It runs **same-profile vs same-profile** with varying komi — which the saved [handicap calibration limitation](../) memory specifically allows (the broken signal is *cross-rank* handicap, not same-rank-komi).

For each trusted anchor (30k, 6k, 1d): same profile on both sides, sweep komi across `[14, 7, 0, -7, -14]` at 40 games per value. Komi is white's score-advantage in points, so lower komi → Black favored. Default 9×9 komi is ~7. The sweep covers Black-disadvantaged through Black-strongly-favored.

15k gets the same sweep gated behind `--include-15k-phase1` (or `make 9x9-ladder-overnight INCLUDE_15K=1`). It's slower (~2.5h additional wall time) and the data is only useful if Phase 0 confirms 15k is mis-labeled — in which case the sweep gives us the re-tuning baseline.

Outputs:
- A win-rate-vs-komi curve per profile.
- The "1-rank slope" — komi delta that moves win rate 50% → 80%, derived by fitting a smooth curve through the 5 sample points.
- Profile-dependent: stronger bots probably use komi differently than weaker ones. Each anchor produces its own conversion.

Statistical sizing: 40 games per komi value gives ±15% 95% CI — enough to spot the curve shape and read off 50% / 75% crossings. Tighten with 100-game confirmations during Phase 3 once we're choosing exact ladder rung values.

**`bot_vs_bot.py` caveat (handled by the orchestrator):** the backend forces `effective_komi = 0.5 if handicap > 0 else komi`. For Phase 1 the orchestrator always passes `handicap=0` so the swept komi value flows through unmodified.

Time budget (Mac native, b28 + Metal):
- Phase 0: ~2 hours (180 games, ~40s avg)
- Phase 1 trusted (30k/6k/1d): ~8 hours (600 games, ~50s avg — 1d's 50-visit profile dominates)
- Phase 1 + 15k: add ~2.5 hours

Run via:
```sh
make 9x9-ladder-up                  # boots a dedicated b28 backend on :8200
make 9x9-ladder-dry-run              # print matrix + ETA, confirm before committing
make 9x9-ladder-overnight            # Phase 0 + Phase 1 trusted (≈10h)
# OR:  make 9x9-ladder-overnight INCLUDE_15K=1   (≈12.5h)
make 9x9-ladder-down                 # next morning
```

Results land in `data/calibration_logs_b28/9x9_ladder_<date>/`:
- `results.csv` — per-game append log (rerun-safe; the orchestrator skips pairings already met)
- `summary.md` — rolled-up per-pairing Wilson CIs, refreshed after every pairing finishes
- `progress.log` — append-only console output

### Phase 2 — fill profile gaps (only if Phase 1 says the existing 4 leave gaps)

The 4 anchors are ~15 ranks apart (30k → 15k → 6k → 1d). If Phase 1 shows a single profile can stretch ~5 ranks via komi without quality breakdown, we're done with profile tuning. If a profile starts feeling weird at komi extremes (e.g. 30k+komi=-30 plays alien moves), add interpolated rungs:

- Candidate: **18k** (between 30k and 15k) — would mirror the 19×19 ladder.
- Candidate: **9k** (between 15k and 6k) — same.
- Candidate: **3k** (between 6k and 1d) — same.

Tune any added rung via b28-vs-b28 even-game ELO anchored to existing 9×9 profiles, target ~75-85% win rate over the rank below. Document in `data/profiles/b28.yaml` with the same comment-history style the other 9×9 entries use.

### Phase 3 — design the (bot, komi) ladder

Output of Phase 1 + 2 is a table like:

| Rung | Bot | Komi | Notes |
|------|-----|------|-------|
| 30k  | 30k | -X (Black ahead by X) | very beginner |
| 28k  | 30k | -Y |  |
| 26k  | 30k | -Z |  |
| ...  | ... | ... |  |
| 15k  | 15k | 7   | even / standard 9×9 komi |
| ...  | ... | ... |  |
| 1d   | 1d  | 7   | top of ladder |

Komi sign convention: `komi: number` field on `Game` is added to **white's** score, so negative komi → Black advantage. Player plays Black; lower komi = easier for player. Exact numbers are outputs of Phase 1, not designed in advance.

Target: **~10–15 rungs** spanning 30k → 1d, each gap ≈ 1 rank.

### Phase 4 — auto-play store / matchmaker / picker support

Today the matchmaker rung is `(bot, handicap_stones)` (`frontend/src/autoplay/matchmaker.ts`, per feature 22). 9×9 needs `(bot, komi_override)`.

Cleanest refactor: discriminated union for the rung shape.
```ts
type RungMatch =
  | { kind: 'stones'; bot: BotRank; handicap: number }   // 19×19 today
  | { kind: 'komi';   bot: BotRank; komi: number };      // 9×9 new
```

Per-board ladder definitions; `autoPlayStore` already keys by `boardSize` (per feature 22 + 23 design). Each board picks its own ladder shape.

UI surfaces that need to handle `kind: 'komi'`:
- **Match-picker card** ("⚪ Pebble — 15k · You start +8 ahead" instead of "+9 stones")
- **Game-end modal** (handicap line)
- **Profile rank graph** (rung labels)
- **Promotion celebration** (no change — celebrates the rank name)

### Phase 5 — homepage entry for 9×9 ladder

Two homepage Play affordances? Or one Play button that defaults to "the last board you played" and a board toggle? The 19×19 ladder is the de-facto default today.

Default: **board picker on the auto-play match-picker card itself**. Three pills at the top — 9×9 / 13×13 / 19×19 — visible state. 9×9 launches in pre-ladder mode for first-time users (no rung set yet → start at the lowest 9×9 rung). Player picks the board, sees their rung on that board, taps Play. Aligns with feature 23's per-board Profile section.

13×13 button stays disabled (greyed) until that ladder ships — see Out of scope.

## Scope — first cut

- Phase 0 sanity validation
- Phase 1 empirical komi-per-rank measurement on all 4 anchor profiles
- Phase 2 only if Phase 1 demands it
- Phase 3 ladder table
- Phase 4 matchmaker discriminated-union refactor + 9×9 rung definitions
- 9×9 added to auto-play match-picker card with board-pill chooser
- Profile page rank graph + history populated for 9×9
- Glicko shadow rating gets a parallel 9×9 series (separate from 19×19 — cross-board rating equivalence is not assumed)

## Stones translation plan (deferred, but designed-for)

The eventual move to stones-with-komi-equivalent on 9×9 is the long-term answer because stones are kid-visible. Two pieces of work it depends on:

1. **Empirical stones↔komi conversion at 9×9** (an extension of Phase 1). Same harness, but vary `--handicap` 1–5 at fixed komi=0.5 (post-handicap) against the same profile. Produces "1 stone ≈ N points of komi on 9×9 at rank R" for each anchor profile. Conversion is rank-dependent.
2. **Hybrid rung kind:** `{ kind: 'stones+komi'; bot; handicap; komi }` — handicap stones for the visible chunky steps, komi for the in-between rank polish. UI would show "⚪ Pebble — 15k · You play Black + 3 stones + 4 komi". Once we have the conversion table, the v1 komi-only ladder can be re-described in stones-equivalent for kids who learn handicap conventions.

Stones translation is its own future feature plan — call it 24a or fold into a v2 of this doc once Phase 1 data is in hand.

## Out of scope (first cut)

- 13×13 auto-play ladder (separate feature; 13×13 is known too strong across the board — see Known Bugs in DEVJOURNAL — and needs its own profile-level relabel pass first).
- 5×5 ladder (5×5 is tutorial-only, no ranked play planned).
- Stones-based 9×9 handicap (see Stones translation above).
- Cross-board rating equivalence ("is 9×9 1d the same as 19×19 1d?" — no, treat them as independent ladders).
- Re-tuning the 4 existing 9×9 profiles (out unless Phase 0 sanity flags an ordering issue).
- New lessons (parallel work — that's the user's track, not this one).

## Open questions

- **Komi display copy.** "+8 komi" is opaque to kids. "You start +8 points ahead" reads better. Confirm preferred copy on the match-picker card.
- **Sign convention exposure.** Internal komi is signed (negative → Black advantage). UI should always express it as "Black gets +X" so the player sees a positive number. Need to spec the display function.
- **First rung difficulty.** What komi value at 30k makes the game truly winnable for a first-game player? Phase 1 will say but we should validate with a couple of real first-time players before committing.
- **Promotion threshold.** First-to-3 wins (matching 19×19)? Or first-to-2 since 9×9 games are shorter and we want faster ladder movement? Default: 3 to match 19×19.
- **Anti-frustration safeguard** on 9×9. 19×19 adds +2 stones after 5 losses. 9×9 equivalent is "+N komi" — what N? Default: enough to move win rate ~+15% based on Phase 1 data.
- **Shadow Glicko on 9×9.** Separate `mu/phi/sigma` from 19×19, or a unified rating? Default: separate (cross-board strength is not 1:1).
- **Match-picker board pills — show 13×13 at all?** Defaults: show greyed-out + tooltip "Coming soon — 13×13 calibration in progress" to flag the roadmap without enabling the broken option.

## Dependencies

- **Feature 22 (Auto-play).** Provides the matchmaker / store / picker / celebration scaffolding. This feature extends it to a second board with a different rung shape.
- **Feature 23 (Profile page).** Already designed per-board. 9×9 just populates a parallel section.
- **No new bot calibration data** beyond the 4 existing profiles + ELO between them + komi economics measurement.
- **`bot_vs_bot.py` `--komi` flag at `--handicap 0`** — already works per `data/bot_vs_bot.py:30`; no harness changes needed for Phase 1.

## Success signals

- Median games-to-first-promotion on 9×9 ≤ 4 (i.e. first-time players hit a promotion in their session).
- Anti-frustration safeguard fires < 10% of rungs (high frequency = ladder steps are too big or profile is off).
- Beta testers stop saying "the bot is too hard" on 9×9.
- 9×9 session length grows — players play multiple games per sit, not one game and bounce.
- 9×9 → 19×19 graduation: players who clear the 9×9 ladder up to ~9k naturally pick up 19×19 with confidence.

## Sequencing

Slots into Wave 1 (foundations for feedback) alongside features 01, 22, 23. Companion to the parallel lessons work (feature 03 expansion) the user is planning — together they form the "first-time player completes a game and wants to play another" loop.
