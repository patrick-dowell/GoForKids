# GoForKids

A Go (board game) teaching app built kid-first — but with enough depth for returning adult players. Play against a rank-calibrated AI that feels like a real opponent, not a crippled engine. Review your games with plain-language explanations powered by Claude.

**Status:** v1 technical foundation + the first wave of kid-facing onboarding (lessons 1–7 + 10), now in closed beta on Render. Proves the AI rank ladder, board feel, study mode, small-board play on 5×5 / 9×9 / 13×13 / 19×19, and an interactive Learn-to-Play flow that teaches placement, capture, survival, capture races, and two-eye life — then graduates the player onto a real 9×9 game.

## What's Working

- **Learn-to-Play onboarding (lessons 1–7 + 10)** — interactive puzzles teach stone placement, single-stone capture, big-group capture, multi-step rescue with a chasing opponent, capture races, and two-eye life. Plus two `kind: 'game'` lessons: first-battle on 5×5 (komi=0) and a 9×9 graduation game. Modal-based step UX (no auto-advance), per-step Continue, "Next lesson →" continuation after game lessons, Cosmic Board reward unlock between lessons 4 and 5. Config-driven lesson engine in `frontend/src/learn/lessons.ts`. Lessons 8 (multi-board quiz) and 9 (territory counting) pending design
- **5×5, 9×9, 13×13, and 19×19 boards** with a cosmic dark theme (gold-tinted grid, gradient stones, star points). Per-size hoshi, coords, and handicap (max 5 on 9×9, 9 elsewhere). 5×5 used by the first-game flow with komi=0 so Black's first-move advantage feels real for new players
- **Play vs KataGo AI** with rank-calibrated move selection (30k–6k validated; 3k / 1d shown as "coming soon"). The AI plays human-like moves at the target rank, not random or uniformly weakened. 5×5 has a first-game-tuned 30k profile; 9×9 / 13×13 have their own profiles for 30k / 15k / 6k; the rest fall back to 19×19 tunings
- **Bot vs Bot mode** — pick two ranks and watch
- **Animations** — stone placement snap, capture celebration scaled across 3 tiers (small / medium / hero), connection pulse on group merges, atari glow, capture shatter with particles
- **Procedural sound** — position-varying placement chimes, layered capture impacts, game-end chord (Web Audio API, no asset files); routed through a single master gain so the density toggle controls volume
- **Density toggle** — Full / Zen mode dampens both visuals and audio for adults / focused study
- **Live score graph** — toggleable in settings; KataGo-backed (~30 visits per move) point-margin estimate from Black's perspective, with player names and stone icons. Final point matches the rules-based tally
- **Game controls** — pass, resign, undo (undoes both your move and the AI's response), auto-finish from move 20+
- **Game library** — auto-saves finished games, persists across sessions
- **Replay mode** — step / autoplay through saved games with sound
- **Study mode** — post-game analysis with KataGo evaluation + Claude API narrative explanations calibrated to player reading level
- **Dead stone detection** — KataGo ownership analysis removes dead stones before scoring
- **Glicko-2 rating system** — tracks player improvement across ranked games
- **SGF export/import** — standard Go game record format, any size
- **Beta hosting on Render** — Vite static site + Dockerized FastAPI/KataGo backend, defined in `render.yaml`. Frontend gated by a shared password (`VITE_BETA_PASSWORD`); floating feedback button (`VITE_FEEDBACK_URL`) opens prefilled mailto / GitHub issue with session context; minimal privacy-and-terms modal. Active games persist to SQLite on a disk-mounted volume so multi-worker requests stay coherent. Local mirror of the deployed image via `make up` (Docker, `--platform linux/amd64`)
- **Native iPad app** — WKWebView wrapping the same React frontend, bundled into the app and served via a custom `app://` URL scheme handler (no Render dependency for UI assets). KataGo runs natively on the iPad's Neural Engine via CoreML; rank-calibrated move selection runs in TypeScript on the iPad reading the same `data/profiles/b28.yaml` Render's Python backend uses. Game-state endpoints (move/pass/score) still hit Render — full offline support is Phase D. See `ios/README.md` and `DEVJOURNAL.md` Sessions 13–14

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React, TypeScript, Vite, Canvas2D, Zustand |
| Backend | Python, FastAPI, SQLite |
| AI Engine | KataGo (Metal/GPU on Mac, Eigen/CPU on Render Linux, CoreML/ANE on iPad) |
| iPad shell | SwiftUI + WKWebView + ChinChangYang/KataGo fork (see `ios/README.md`) |
| Study Narration | Claude API |

## Setup

### Prerequisites

- Node.js 20+
- Python 3.9+
- [KataGo](https://github.com/lightvector/KataGo) — `brew install katago` on macOS

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:5173

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn websockets pydantic anthropic aiosqlite python-multipart
uvicorn app.main:app --port 8000
```

KataGo is auto-detected from the Homebrew install path. To override:

```bash
export KATAGO_PATH=/path/to/katago
export KATAGO_MODEL=/path/to/model.bin.gz
export KATAGO_CONFIG=/path/to/analysis.cfg
```

Bot rank profiles are loaded from YAML at runtime (see `data/profiles/`).
Both `b20.yaml` and `b28.yaml` ship in the production image; the active
profile is controlled by `CALIBRATION_PROFILE_PATH`. Production currently
defaults to b20 — b28 was calibrated head-to-head against b20 (see
`AI_CALIBRATION.md` "b28 calibration outcome" + `feature_plans/20_b28_calibration.md`)
but its per-move latency on Render Standard is too high; flipping back
to b28 is a single env-var override (`KATAGO_MODEL` + `CALIBRATION_PROFILE_PATH`),
no rebuild required. b28 is the right choice on local Mac (Metal) or iPad
(ANE) where inference is fast.

For study mode narratives, set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Tests

```bash
# Go rules engine (34 tests)
cd frontend && npx vitest run

# Bot calibration vs real 15k games (requires backend running)
cd data && python test_bot_vs_real.py --games 20
```

### Local mirror of the Render deployment

To debug bugs that only show up on Render (Linux Eigen KataGo backend
behaves differently than Mac Metal at low visit counts), run the
production Docker image locally:

```bash
make up                # build + start the API container (slow first time;
                       # uses linux/amd64 emulation on Apple Silicon)
make native-frontend   # in another terminal — Vite hits localhost:8000
make logs              # tail API logs
make test-katago       # smoke-test KataGo via /health and a sample game
make down              # stop
```

The container mounts `backend/data/` as `/data` so SQLite persists across
restarts. Override KataGo perf knobs via env (e.g.
`KATAGO_VISITS=200 make up`) to A/B test settings without rebuilding.

## Architecture

```
GoForKids/
├── frontend/                 # React + TypeScript + Vite
│   └── src/
│       ├── engine/           # Go rules engine (pure TS, tested)
│       ├── board/            # Canvas2D renderer + animations
│       ├── audio/            # Web Audio procedural sounds
│       ├── components/       # React UI (controls, dialogs, study mode)
│       ├── store/            # Zustand state management
│       └── api/              # Backend REST client
├── backend/                  # Python + FastAPI
│   └── app/
│       ├── katago/           # KataGo process manager (analysis JSON API)
│       ├── ai/               # Rank-calibrated move selection (Phase 1)
│       ├── game/             # Server-side engine, rating, SQLite storage
│       ├── study/            # KataGo analysis + Claude narrative generation
│       └── routers/          # API endpoints
├── designdoc.md              # Full product design document
└── RankCalibratedGoBot.md    # AI architecture notes
```

## How the AI Works

KataGo generates candidate moves with evaluations (winrate, score lead, policy prior). The rank-calibrated selector then samples from these candidates using tuning knobs per rank:

| Rank | Mistake freq | Max point loss | Random moves | Local bias | KataGo visits |
|------|-------------|----------------|--------------|------------|---------------|
| 15k  | 40%         | 20 pts         | 5%           | 25%        | 30            |
| 10k  | 25%         | 10 pts         | 2%           | 12%        | 80            |
| 5k   | 10%         | 4 pts          | 0%           | 3%         | 200           |
| 3k   | 6%          | 2.5 pts        | 0%           | 0%         | 300           |

The bot also uses **game-phase awareness**: in the opening (first 30 moves at 15k), it plays from KataGo's top 3 candidates only — even beginners play recognizable openings. Mistakes are concentrated in the midgame where real beginners misread fights and miss direction. The AI auto-passes when KataGo sees no moves worth more than 0.5 points over passing.

### Calibration from Real Games

Profiles were tuned using analysis of 10,000 real 15k games from the [Fox Go Server dataset](https://github.com/featurecat/go-dataset) (154k games at 15k level). Key findings that shaped the bot:

- 57% of real 15k moves are within 2 intersections of the previous move
- Only 15% tenuki rate (playing far from the action)
- 10.5% first-line play
- Average game length: 164 moves, 68% end by resignation

### Validation

The bot is tested against real 15k game positions using `data/test_bot_vs_real.py`. The test replays positions from real Fox server games through the backend API and compares the bot's move choice to what the real player played.

Baseline results (80 positions from 15 games):

| Metric | Result |
|--------|--------|
| Exact match | 24% |
| Close (within 2) | 37% |
| Same area (within 5) | 50% |
| Same quadrant | 57% |

These numbers are healthy — even two different 15k humans would only agree ~25-30% of the time.

```bash
# Run the calibration test (requires backend running)
cd data
python test_bot_vs_real.py --games 30 --positions 6
```

## Design Philosophy

> *It should feel less like "Go in space" and more like Go played late at night, when the room is quiet and the board feels bigger than it is.*

See [designdoc.md](designdoc.md) for the full product vision, design pillars, and v2 roadmap.

## License

TBD
