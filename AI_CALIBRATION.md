# AI Bot Calibration Guide

How each bot rank was configured, tested, and tuned. Use this to recreate or refine any bot.

## Architecture

All bots use the same pipeline:

```
KataGo analysis (N visits) → Candidate moves → Rank-based sampling → Eye-fill safety check → Move
```

**KataGo** generates candidate moves with evaluations (winrate, score lead, policy prior). The **rank-calibrated selector** then decides which move to play based on the bot's profile — sometimes the best move, sometimes a deliberate mistake.

**Key insight from playtesting:** a real 15k player doesn't pick "slightly suboptimal" moves from a pro's candidate list. They play fundamentally differently — locally reactive, poor reading, wrong direction. The selector simulates this through multiple mechanisms, not just "add noise to the best move."

## Profile Parameters

Each bot has these tuning knobs in `backend/app/ai/move_selector.py`:

| Parameter | What it does | Low rank (30k) | High rank (3k) |
|-----------|-------------|----------------|----------------|
| `visits` | KataGo search depth. Fewer = weaker candidates | 10 | 300 |
| `mistake_freq` | % of moves where a suboptimal candidate is actively boosted | 55% | 6% |
| `max_point_loss` | Largest allowed mistake in points. Caps catastrophic blunders | 30 | 2.5 |
| `policy_weight` | How much to follow KataGo's policy prior (0=ignore, 1=strict) | 0.15 | 0.85 |
| `randomness` | Jitter in candidate weighting (0=deterministic, 1=chaotic) | 0.78 | 0.10 |
| `random_move_chance` | % of moves that are truly random legal moves (not from KataGo) | 8% | 0% |
| `local_bias` | % of moves that respond near the last stone instead of globally | 42% | 0% |
| `opening_moves` | First N moves play from KataGo's top 3 only (sensible opening) | 8 | 5 |
| `min_candidates` | How many KataGo candidates to consider | 15 | 5 |

## Safety Checks

Applied to ALL ranks before returning a move:

- **Eye-fill prevention**: Never play inside your own eye. Checks if all orthogonal neighbors are friendly and ≥3 of 4 diagonals are friendly. If triggered, retries up to 5 times, then passes.
- **Pass logic**: Only pass when KataGo's #1 candidate is literally "pass". No heuristic second-guessing.

## Individual Bot Profiles

### 30k — Seedling

**Character:** Weakest bot. Knows the rules and won't walk into obvious captures, but makes huge strategic errors constantly.

**Profile:**
```python
visits=10, mistake_freq=0.55, max_point_loss=30, policy_weight=0.15,
randomness=0.78, random_move_chance=0.08, local_bias=0.42, opening_moves=8
```

**Calibration target:** 50/50 vs 18k at 9 handicap stones.

**Calibration history:**
| Version | Config | Result vs 18k (9H) | Issue |
|---------|--------|---------------------|-------|
| v0 | Pure heuristic, no KataGo | 0/6 wins | Can't hold territory at all, games don't end |
| v1 | KataGo 5 visits, 65% mistakes | 1/6 wins (17%) | Too shallow, loses everything |
| v2 (current) | KataGo 10 visits, 55% mistakes | 4/6 wins (67%) | Slightly above 50% target, acceptable |

**Key lesson:** Pure heuristic (no KataGo) doesn't work even for 30k — without any reading ability, the bot can't defend territory or end games. Even 10 visits gives enough shape awareness to be functional.

---

### 18k — Sprout

**Character:** Weak but not random. Has basic shape instincts but makes frequent large mistakes. Plays too locally.

**Profile:**
```python
visits=12, mistake_freq=0.55, max_point_loss=28, policy_weight=0.18,
randomness=0.76, random_move_chance=0.12, local_bias=0.38, opening_moves=12
```

**Calibration targets:**
- Loses to 15k ~75-80% at even games
- ~50/50 vs 30k at 9 handicap

**Calibration data source:** 10,000 real 18k Fox Go Server games (`data/analyze_15k.py` run on 18k directory)

**Real 18k player statistics (Fox server):**
- 53% of moves within 2 intersections of previous move
- 18% tenuki rate (>6 away from last move)
- 11% first-line play
- Average game length: 124 moves
- 28% of games end in ≤50 moves
- Center (K10) is the most played point

**Bot validation:** `test_bot_vs_real.py --rank 18k` (76 positions from 15 games):
- 10.5% exact match with real 18k moves
- 21% within 2 intersections
- 32% within 5 intersections

**Calibration history:**
| Version | Config | Result vs 15k (even) | Issue |
|---------|--------|---------------------|-------|
| v1 | 52% mistakes, 15 visits | 40% loss rate | Too strong, only 3 ranks weaker than 15k |
| v2 | 60% mistakes, 10 visits | 100% loss rate | Too weak, random chaos |
| v3 (current) | 55% mistakes, 12 visits | 83% loss rate | On target (75-80%) |

---

### 15k — Pebble

**Character:** The anchor bot. Knows basic shapes and plays recognizable openings, but makes strategic errors in the midgame — wrong direction, overconcentration, misses cutting points.

**Profile:**
```python
visits=30, mistake_freq=0.40, max_point_loss=20, policy_weight=0.30,
randomness=0.60, random_move_chance=0.05, local_bias=0.25, opening_moves=30
```

**Calibration data source:** 10,000 real 15k Fox Go Server games (154k total available in `data/15k/`)

**Real 15k player statistics (Fox server):**
- 57% of moves within 2 intersections of previous move
- 15% tenuki rate
- 10.5% first-line play
- Average game length: 164 moves
- 68% of games end by resignation
- Star points (D4, Q4, Q16, D16) are the 4 most played intersections

**Bot validation:** `test_bot_vs_real.py --rank 15k` (80 positions from 15 games):
- 24% exact match with real 15k moves
- 37% within 2 intersections
- 50% within 5 intersections
- 57% same quadrant

**Phase-by-phase accuracy:**
| Phase | Exact | Close (≤2) | Same area (≤5) | Avg distance |
|-------|-------|-----------|----------------|-------------|
| Opening (1-30) | 23% | 38% | 54% | 7.3 |
| Midgame (31-100) | 21% | 32% | 54% | 6.9 |
| Endgame (100+) | 30% | 40% | 40% | 7.2 |

**Calibration history:**
| Version | Config | Result | Issue |
|---------|--------|--------|-------|
| v1 (original) | 100 visits, 45% mistakes | Felt like 5k | KataGo candidates all too strong |
| v2 | 20 visits, random+local injection | Felt like 25k | Too much chaos, first-line moves |
| v3 (current) | 30 visits, sensible openings, midgame mistakes | Feels ~15k | Playtested and validated |

**Key design decisions:**
- Opening phase (first 30 moves): picks from KataGo top 3 only — even 15k players play recognizable star-point openings
- Mistake distribution: bell curve centered at 35% of max point loss, not uniform random
- No first-line injection — real 15k play 10% first-line but injecting it makes the bot feel random, not weak

---

### 12k — Stream

**Character:** A step above 15k. Still makes recognizable strategic errors, but searches deeper, follows KataGo's policy more closely, and makes fewer large mistakes.

**Profile (v4):**
```python
visits=42, mistake_freq=0.34, max_point_loss=17, policy_weight=0.42,
randomness=0.45, random_move_chance=0.02, local_bias=0.20, opening_moves=22
```

**Calibration targets:**
- Wins ~70-80% vs 15k at even games (3-rank gap, mirrors 18k losing to 15k 75-80%)
- Closer to 50/50 vs 15k at 3 handicap stones (15k handicapped up)
- Match rate vs real 12k Fox games in the same ballpark as 15k-vs-15k (exact ≥ 15%, close ≥ 25%)

**Calibration data source:** 151,844 real 12k Fox Go Server games (`data/12k/`, downloaded from featurecat/go-dataset 2026-04-22).

**Bot validation — `test_bot_vs_real.py --rank 12k` (112 positions from 20 games):**
| Metric | 12k v4 | 15k baseline |
|--------|--------|--------------|
| Exact match | 15.3% | 24% |
| Close (≤2) | 25.2% | 37% |
| Same area (≤5) | 43.2% | 50% |
| Same quadrant | 53.2% | 57% |
| Avg distance | 8.6 | — |

**Phase-by-phase accuracy (v4):**
| Phase | Exact | Close (≤2) | Same area (≤5) | Avg dist |
|-------|-------|-----------|----------------|----------|
| Opening (1-30) | 12% | 25% | 48% | 7.6 |
| Midgame (31-100) | 20% | 30% | 45% | 8.1 |
| Endgame (100+) | 13% | 19% | 35% | 10.5 |

**Calibration history:**
| Version | Config | Even vs 15k | H3 vs 15k | Exact match | Notes |
|---------|--------|-------------|-----------|-------------|-------|
| v1 (interpolated) | visits=50, mistake=0.32, loss=15 | 75% (6/8) | 71% (5/7) | — | Too strong on H |
| v2 | visits=40, mistake=0.36, loss=17 | 71% (5/7) | 62% (5/8) | 15% | Match rate too low (too random) |
| v3 (reverted) | visits=35, mistake=0.38, loss=18 | 40% (2/5) | — | — | Overshot; games stalled past 400 moves |
| v4 (current) | visits=42, mistake=0.34, loss=17, policy=0.42, rand=0.45 | 75% (6/8) | 62% (5/8) | 15% / 25% / 43% | Match rate recovered; win rates held |

**Key lessons:**
- **Pure randomness hurts match rate without hurting win rate much.** v2 cranked `randomness` and `random_move_chance` for H3 balance but tanked midgame match rate (12% exact) because the bot was making chaotic moves no real 12k player would make.
- **Higher `policy_weight` + lower `randomness` matches humans better than low noise ever did.** KataGo's policy prior is trained from human games, so strong policy following naturally reproduces human-like choice distributions. Mistakes come from the bell-curve point-loss mechanism instead.
- **Handicap theory ("3 stones ≈ 3 ranks") doesn't hold tightly for bots.** 15k's opening code already picks from KataGo's top 3, so handicap stars aren't "free points" against our 15k. H3 sitting at 62% is the realistic floor for this matchup.
- **Games can exceed 400 moves at this rank pair.** Bumped `bot_vs_bot.py` default `--max-moves` to 600 after v4 hit several 400-move caps under lower randomness.

---

> **Rank relabel (2026-04-23).** The four bots below were renamed to land
> on a uniform 3-rank step through the ladder: 30k → 18k → 15k → 12k →
> 9k → 6k → 3k → 1d. Profile parameters are unchanged from their old
> labels (10k, 8k, 5k, 3k) — they were interpolated and never validated,
> so the new labels are aspirational until calibration runs. In the UI
> these four are marked "coming soon" and disabled in the bot picker.

### 9k — Boulder (was 10k)

**Character:** Mid-kyu with solid basics. Recognizes shape, follows KataGo's policy closely, makes moderate errors mostly in the midgame. Plays like a player who's learned the rules but still misjudges direction and timing.

**Profile (v5, validated):**
```python
visits=80, mistake_freq=0.25, max_point_loss=10, policy_weight=0.50,
randomness=0.40, random_move_chance=0.02, local_bias=0.12, opening_moves=20
```

v5 = v1 parameters (inherited from old 10k) + universal pass fix + universal clarity gate. v2-v4 tried bumping visits (80 → 120/140) to prevent group-drops in playtest, but that flattened the rank gap against 6k. v5 returns to v1 values because the universal code-level fixes now handle the most egregious tactical blunders, while visits=80 keeps 9k's natural tactical imperfection intact.

**Calibration targets:**
- Wins ~75-80% vs 12k at even games (3-rank gap).
- Roughly 50/50 vs 12k at 3 handicap (12k handicapped up).
- Match rate vs real 9k Fox games in the same ballpark as 12k-vs-12k (exact ≥ 15%, close ≥ 25%).

**Calibration data source:** 291,525 real 9k Fox Go Server games (`data/9k/`, downloaded from featurecat/go-dataset 2026-04-23).

**Bot-vs-bot results:**
| Test | Result | Target |
|------|--------|--------|
| Even vs 12k | 81% win (13/16) | 75-80% |
| 12k + 3H vs 9k | 50% win for 9k (4/8) | ~50% |

**Bot validation — `test_bot_vs_real.py --rank 9k` (114 positions from 20 games):**
| Metric | 9k v1 | 12k v4 | 15k baseline |
|--------|-------|--------|--------------|
| Exact match | 20.2% | 15.3% | 24% |
| Close (≤2) | 30.7% | 25.2% | 37% |
| Same area (≤5) | 47.4% | 43.2% | 50% |
| Same quadrant | 54.4% | 53.2% | 57% |
| Avg distance | 7.6 | 8.6 | — |

**Phase-by-phase accuracy (v1):**
| Phase | Exact | Close (≤2) | Same area (≤5) | Avg dist |
|-------|-------|-----------|----------------|----------|
| Opening (1-30) | 29% | 39% | 55% | 6.2 |
| Midgame (31-100) | 16% | 29% | 42% | 7.9 |
| Endgame (100+) | 16% | 24% | 45% | 8.8 |

**Key lesson:** The v4 insight from 12k calibration — **high `policy_weight` + low `randomness` beats chaos** — was already baked into the interpolated 10k profile. So the 9k slot shipped valid on first run. Keep this formula when calibrating 6k, 3k, 1d.

---

### 6k — Ember (was 8k)

**Character:** A rank above 9k. Slightly tighter reading, fewer mid-size mistakes. Imperfection is supposed to feel like "missed the deep read" rather than "deliberately picked a worse move."

**Profile (v5, shipped):**
```python
visits=120, mistake_freq=0.22, max_point_loss=9, policy_weight=0.50,
randomness=0.38, random_move_chance=0.02, local_bias=0.08, opening_moves=18
```

> ⚠️ **Known limitation.** Human playtest said v4 (visits=150, mistake_freq=0.32, max_loss=11) felt "a bit stronger than 6k" and that mistakes felt "too drastic" — artificial rather than natural. v5 dials down injected mistakes and relies more on natural tactical limitations from shallower visits, but **Phase 1 can't properly simulate the *type* of mistakes real 6k players make** (wrong direction, missed big point, overconcentration) — only their frequency and point-loss magnitude. This is a known refinement area; the proper fix is Phase 2 (rank-conditioned NN trained on human games).

**Earlier versions (for reference):**
| Ver | Config | Observed |
|-----|--------|----------|
| v1 | inherited 8k | 88% even, 88% H3 — too strong |
| v2 | visits=95, mistake=0.23 | 81% even, 50% H3, 18.5% match — blundered large groups in playtest |
| v3 | visits=150 + clarity gate | fixed blunders, 100% vs 9k — too strong |
| v4 | visits=150 + mistake=0.32 max=11 | 25% match (best ever), still 88% vs 9k. Playtest: "stronger than 6k, mistakes feel drastic" |
| v5 | visits=120 + mistake=0.22 max=9 | Shipped without further bot-vs-bot testing per owner |

**Calibration targets:**
- Wins ~75-80% vs 9k at even games (3-rank gap).
- Roughly 50/50 vs 9k at 3 handicap (9k handicapped up).
- Match rate vs real 6k Fox games in the same ballpark as 9k-vs-9k.

**Calibration data source:** 296,465 real 6k Fox Go Server games (`data/6k/`, downloaded from featurecat/go-dataset 2026-04-23).

**Calibration history:**
| Version | Config | Even vs 9k | H3 vs 9k+3 | Notes |
|---------|--------|-----------|------------|-------|
| v1 (inherited from old 8k) | visits=120, mistake=0.18, loss=6, policy=0.60 | 88% (7/8) | 88% (7/8) — H3 didn't balance at all | Way too strong — playing like 4k/5k |
| v2 (current) | visits=95, mistake=0.23, loss=9, policy=0.52, rand=0.37 | 81% (13/16) | 50% (4/8) | On target; mirrors 9k's calibration signal |

**Bot validation — `test_bot_vs_real.py --rank 6k` (120 positions from 20 games):**
| Metric | 6k v2 | 9k v1 | 12k v4 | 15k baseline |
|--------|-------|-------|--------|--------------|
| Exact match | 18.5% | 20.2% | 15.3% | 24% |
| Close (≤2) | 30.3% | 30.7% | 25.2% | 37% |
| Same area (≤5) | 45.4% | 47.4% | 43.2% | 50% |
| Same quadrant | 49.6% | 54.4% | 53.2% | 57% |
| Avg distance | 8.6 | 7.6 | 8.6 | — |

**Phase-by-phase accuracy (v2):**
| Phase | Exact | Close (≤2) | Same area (≤5) | Avg dist |
|-------|-------|-----------|----------------|----------|
| Opening (1-30) | 15% | 30% | 42% | 8.7 |
| Midgame (31-100) | 18% | 35% | 52% | 7.1 |
| Endgame (100+) | 23% | 26% | 41% | 9.9 |

Edge distance: bot 2.6 vs real 2.7 — essentially identical.

**Key lesson:** The old interpolated 8k profile jumped too far from 10k. When I relabeled 8k→6k and 10k→9k, the implicit assumption was "the same distance between ranks" — but the old 10k→8k gap was a 2-rank label spanning a 3-rank strength jump. v2 proves the right recipe between validated ranks is **small deltas** on every lever, not "one step stronger on everything."

---

### 3k — Storm (was 5k)

**Profile:**
```python
visits=200, mistake_freq=0.10, max_point_loss=4, policy_weight=0.75,
randomness=0.18, random_move_chance=0.0, local_bias=0.03, opening_moves=10
```

Not yet validated. Parameters carried over from the old 5k slot.

---

### 1d — Void (was 3k)

**Character:** Strongest bot. Plays near-optimal with occasional small mistakes.

**Profile:**
```python
visits=300, mistake_freq=0.06, max_point_loss=2.5, policy_weight=0.85,
randomness=0.10, random_move_chance=0.0, local_bias=0.0, opening_moves=5
```

Not yet validated. Parameters carried over from the old 3k slot. At 300 visits and 6% mistake rate this should play close to KataGo's full strength; main weakness is the occasional 2.5-point mistake.

---

## Calibration Tools

### `data/test_bot_vs_real.py`
Tests a bot against real games by replaying positions through the backend API.

```bash
# Test 15k bot against 15k Fox server games
python test_bot_vs_real.py --rank 15k --games 20 --positions 6

# Test 18k bot against 18k games
python test_bot_vs_real.py --rank 18k --sgf-dir 18k --games 20
```

Measures: exact match rate, distance distribution, phase-by-phase accuracy, edge distance comparison.

### `data/bot_vs_bot.py`
Plays games between two bots to verify strength differential.

```bash
# Even game: 18k vs 15k
python bot_vs_bot.py --black 18k --white 15k --games 8

# With handicap: 30k vs 18k at 9 stones
python bot_vs_bot.py --black 30k --white 18k --games 8 --handicap 9

# Verbose output (print each move)
python bot_vs_bot.py --black 30k --white 15k --games 3 --verbose
```

### `data/analyze_15k.py`
Statistical analysis of real game datasets. Run on any extracted SGF directory.

```bash
# Analyze 15k games
python analyze_15k.py  # (edit SGF_DIR in script, or duplicate for other ranks)
```

Measures: move distance distribution, edge distance, local response rates, game length, heatmap.

## Game Data

Downloaded from [featurecat/go-dataset](https://github.com/featurecat/go-dataset) (Fox Go Server):

| Rank | Games | Location |
|------|-------|----------|
| 15k | 154,295 | `data/15k/` (29 MB compressed) |
| 18k | 299,008 | `data/18k/` (46 MB compressed) |

To download additional ranks:
```bash
cd data
curl -L -o {rank}.7z "https://github.com/featurecat/go-dataset/raw/master/{rank}/{rank}.7z"
7z x {rank}.7z
```

Available ranks: 18k through 9d + Pro.

## Future Work

- **Phase 2 AI (v2):** Train a rank-conditioned neural network on OGS game data. Input: board position + target rank → Output: move probability distribution. This replaces the heuristic sampling with a model that learned how real humans play at each rank.
- **Validate 12k–3k bots:** Run bot-vs-bot and test_bot_vs_real for each rank pair.
- **Download more Fox ranks** (16k, 14k, 12k, 10k) for per-rank calibration.
- **Playtesting with real kyu players:** The ultimate validation — have actual 15k players play against the bot and report whether it feels like a peer.

### Known refinement area — natural-feeling mistakes

Our mistake mechanism picks moves by *point-loss magnitude* (bell curve centered at 35% of `max_point_loss`). That controls **how much** each mistake costs but not **what kind** of mistake it is. Real kyu players make specific types of errors — wrong direction of play, missed big point, overconcentration, ladder miscount, missed counter-atari. Our mechanism picks a plausible-by-point-loss move at random from KataGo's candidates, which produces mistakes that are statistically within range but qualitatively feel "artificial" or "drastic" to human opponents.

Observed in 6k calibration: dropping `mistake_freq` and `max_point_loss` (v4 → v5) softened the artificial feel but at the cost of the bot playing slightly *stronger* than its nominal rank — because fewer real-kind-of-mistakes are being made. There's no Phase 1 lever that produces both "correct rank strength" and "human-feeling errors" simultaneously. Phase 2 (rank-conditioned NN trained on human game records) is the path that resolves this because it reproduces *distributions* of human choices, not just their magnitudes.

Flagged in DEVJOURNAL session 7 (2026-04-24).
