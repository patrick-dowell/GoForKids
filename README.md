# GoForKids

A Go (board game) teaching app built kid-first — but with enough depth for returning adult players. Play against a rank-calibrated AI that feels like a real opponent, not a crippled engine. Review your games with plain-language explanations powered by Claude.

**Status:** v1 technical foundation. Proves the AI rank ladder, board feel, and study mode on 19x19. Kid-facing onboarding, smaller boards, and the parent surface land in v2.

## What's Working

- **19x19 board** with a cosmic dark theme (gold-tinted grid, gradient stones, star points)
- **Play vs KataGo AI** with rank-calibrated move selection (15k–3k). The AI plays human-like moves at the target rank, not random or uniformly weakened
- **Animations** — stone placement snap, capture shatter with particles, atari glow
- **Procedural sound** — position-varying placement chimes, layered capture impacts, game-end chord (Web Audio API, no asset files)
- **Game controls** — pass, resign, undo (undoes both your move and the AI's response)
- **Game library** — auto-saves finished games, persists across sessions
- **Study mode** — post-game analysis with KataGo evaluation + Claude API narrative explanations calibrated to player reading level
- **Dead stone detection** — KataGo ownership analysis removes dead stones before scoring
- **Glicko-2 rating system** — tracks player improvement across ranked games
- **SGF export/import** — standard Go game record format

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React, TypeScript, Vite, Canvas2D, Zustand |
| Backend | Python, FastAPI, SQLite |
| AI Engine | KataGo (Metal/GPU) |
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

For study mode narratives, set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Tests

```bash
cd frontend
npx vitest run
```

34 tests covering the Go rules engine (captures, ko/superko, territory scoring, SGF round-trip).

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

| Rank | Mistake freq | Max point loss | Randomness |
|------|-------------|----------------|------------|
| 15k  | 45%         | 15 pts         | High       |
| 10k  | 28%         | 8 pts          | Medium     |
| 5k   | 12%         | 3 pts          | Low        |
| 3k   | 7%          | 2 pts          | Minimal    |

The AI auto-passes when KataGo sees no moves worth more than 0.5 points over passing, preventing unnecessary endgame fills.

## Design Philosophy

> *It should feel less like "Go in space" and more like Go played late at night, when the room is quiet and the board feels bigger than it is.*

See [designdoc.md](designdoc.md) for the full product vision, design pillars, and v2 roadmap.

## License

TBD
