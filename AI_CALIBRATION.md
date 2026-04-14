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

**Profile:**
```python
visits=50, mistake_freq=0.32, max_point_loss=15, policy_weight=0.40,
randomness=0.50, random_move_chance=0.03, local_bias=0.18, opening_moves=25
```

Not yet validated against real games or bot-vs-bot. Interpolated between 15k and 10k.

---

### 10k — Boulder

**Profile:**
```python
visits=80, mistake_freq=0.25, max_point_loss=10, policy_weight=0.50,
randomness=0.40, random_move_chance=0.02, local_bias=0.12, opening_moves=20
```

Not yet validated. Interpolated.

---

### 8k — Ember

**Profile:**
```python
visits=120, mistake_freq=0.18, max_point_loss=6, policy_weight=0.60,
randomness=0.30, random_move_chance=0.01, local_bias=0.08, opening_moves=15
```

Not yet validated. Interpolated.

---

### 5k — Storm

**Profile:**
```python
visits=200, mistake_freq=0.10, max_point_loss=4, policy_weight=0.75,
randomness=0.18, random_move_chance=0.0, local_bias=0.03, opening_moves=10
```

Not yet validated. Interpolated.

---

### 3k — Void

**Character:** Strongest bot. Plays near-optimal with occasional small mistakes.

**Profile:**
```python
visits=300, mistake_freq=0.06, max_point_loss=2.5, policy_weight=0.85,
randomness=0.10, random_move_chance=0.0, local_bias=0.0, opening_moves=5
```

Not yet validated. At 300 visits and 6% mistake rate, this should play close to KataGo's full strength. The main weakness compared to full KataGo is the occasional 2.5-point mistake.

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
