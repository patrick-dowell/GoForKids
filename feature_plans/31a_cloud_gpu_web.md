# 31a — Cloud-GPU web: implementation plan

**Status: PARKED (companion to fp 31 — the "do it" doc for option A).**
Written 2026-07-06 while the context is fresh. Goal: web games with the
SAME b28 net + b28.yaml ladder as iOS, bot moves ≤ ~1.5s, ~$0 idle cost.

**Measured baseline (2026-07-06, production):** network 85ms · player
/move ~2.5s (redundant score-lead analysis) · bot /ai-move ~21s (~1
visit/s on Render shared CPU). The fix is hardware for the engine +
removing one redundancy; everything else (game state, selector,
profiles, frontend) stays where it is.

## Architecture in one line
Render API (unchanged owner of games/selector/profiles) → HTTP →
**GPU engine service** (a container on a scale-to-zero GPU provider
running KataGo's JSON analysis engine with the b28 net). engine.py
already isolates the engine behind `analyze()` — this is a transport
swap, not a rearchitecture.

---

## Steps

| # | Step | Estimate | Notes |
|---|------|----------|-------|
| 0 | Score-lead reuse fix (independent win) | **0.5–1 day** | Do regardless of GPU |
| 1 | Provider choice + engine-service prototype | **1–2 days** | The only experimental step |
| 2 | `RemoteKataGoEngine` adapter in the backend | **1 day** | Mechanical |
| 3 | Cold-start UX (warmup ping + loading state) | **0.5–1 day** | Small frontend touch |
| 4 | Web → b28.yaml profile switch + parity check | **0.5 day** | Config + one sanity set |
| 5 | Scoring/finish paths through the remote engine | **0.5 day** | Timeout budgets |
| 6 | Ops: spend caps, logging, downtime behavior | **0.5–1 day** | Guardrails before testers |
| 7 | Concurrency sanity (one GPU, N games) | **0.5 day** | Reuse bot_vs_bot as load gen |
| 8 | Flagged rollout + a week of cost watching | **0.5 day** + watch | |
| | **Total** | **≈ 5–8 working days** | 1–2 calendar weeks at solo pace |

### 0. Score-lead reuse (do first, independent of everything)
The backend runs a separate 30-visit `_compute_score_lead` after BOTH the
player's /move and the bot's /ai-move. Reuse the selection analysis's
root eval instead (the exact S45 attribution-fix pattern from the device
path — `score_lead_before` = root eval, chosen-candidate eval = after).
On /move, drop or async the eval (the graph point backfills on the next
ai-move — device already works this way). Saves ~5s/cycle TODAY on CPU;
on GPU it removes one round trip per move. Tests: mirror the frontend's
`mergeAiScorePoints` suite server-side.

### 1. Provider + engine-service prototype (the experimental step)
Requirements: scale-to-zero, per-second billing, T4/A10-class, container
keeps a long-lived process warm between requests, region near Render
(Oregon) to keep the hop < ~50ms.
- **First candidate: Modal** — python-native, `@app.cls` with idle
  timeout (warm container holds the KataGo subprocess + NN cache),
  built-in web endpoints + auth, volumes for net + TensorRT plan cache.
  RunPod serverless / Fly GPU machines with auto-stop are the fallbacks.
- Container: KataGo **CUDA backend first** (simple build, loads fast);
  TensorRT as a follow-up optimization only if throughput demands it
  (TensorRT's first-start plan compile is minutes — must be cached in a
  volume or it poisons every cold start).
- Endpoint: `POST /analyze` — passthrough of the KataGo JSON analysis
  query/response verbatim (the backend already speaks it). Concurrent
  requests just write to the same engine stdin; KataGo batches
  internally.
- **Benchmarks to capture before proceeding:** visits/s on 9×9 b28
  (expect hundreds), cold-start wall time (target < 45s), warm p50/p95
  for a 16-visit and a 200-visit query, hop latency from Render.

### 2. RemoteKataGoEngine adapter
Same interface as the subprocess engine (`analyze()`, ownership flag,
override settings). Selected by env (`KATAGO_REMOTE_URL` + auth token).
Details that matter:
- **Timeout tiers:** warm query ~10s; a designated "may-be-cold" path
  (first query of a game) up to ~60s.
- Retry once on connection errors (container swap), never on 4xx.
- Keep the subprocess engine code intact as the local/calibration path —
  calibration keeps running on the Mac exactly as today.

### 3. Cold-start UX
- `createGame` fires an async warmup ping at the GPU service — the
  container spins up while the player looks at the empty board; by their
  first move it's usually warm.
- Frontend: a friendly first-move wait state ("waking up the Go
  master…") when /ai-move exceeds ~4s. One small component; the S26
  scoring-overlay timeout pattern applies (never trap the user).
- Idle timeout on the provider: ~5–10 min (a kid's between-games pause
  shouldn't re-cold-start; a dead session shouldn't burn GPU hours).

### 4. Profile switch: web joins the iOS ladder
`CALIBRATION_PROFILE_PATH=data/profiles/b28.yaml` on Render. b28
profiles are per-net and the GPU runs the same net file → the whole
S38–S51 calibration transfers verbatim. Sanity: one 12-game
local-vs-remote set per anchor rung (same YAML, Mac Metal vs cloud GPU)
— margins should be statistically indistinguishable. Also delete the
"web plays b20" caveat wherever docs mention it.

### 5. Scoring / finish paths
`score-position` (ownership, 200 visits) and `finish_move` (500 visits)
ride the same adapter — just verify their timeout budgets and that
`include_ownership` passes through. These are the heaviest single
queries; on GPU they drop from ~30–60s to ~1–3s, which incidentally
fixes web Finish Game feel too.

### 6. Ops guardrails (before testers touch it)
- Provider spend cap + alert (e.g., $25/mo ceiling to start).
- Log per query: visits, wall ms, cold/warm, game id — into the existing
  backend logging.
- Downtime behavior: if the GPU service errors/timeouts out, return a
  clear "the bots are napping — try again in a minute" error. Explicitly
  do NOT silently fall back to CPU b20 (that resurrects the
  two-different-ladders problem that burned us; an env flag can force
  CPU mode manually in an emergency).

### 7. Concurrency sanity
Drive ~10 simultaneous games (bot_vs_bot as load generator) at one
T4-class instance: per-move p95 should hold < ~2s thanks to engine
batching. Set the provider's max-containers to 1–2 initially — cost
control beats latency at this scale.

### 8. Rollout
Env-flagged on Render → the iOS-less tester first → a week of cost +
latency watching → default-on for web.

---

## Cost model (from fp 31, refined)
- Idle: ~$0 (model storage cents/month).
- Active: ~$0.30–0.60/hr T4-class, shared across ALL concurrent games.
  A heavy camp afternoon ≈ $1–2. A month of current web traffic ≈
  single-digit dollars.
- The only way to accidentally spend real money is a stuck-warm
  container — that's what the idle timeout + spend cap are for.

## Risks / unknowns
- **TensorRT plan compile on cold start** — avoided by starting with the
  CUDA backend; revisit only if throughput needs it.
- **Provider hop latency** from Render Oregon — pick region accordingly;
  benchmark in step 1 before committing.
- **Cold start > 45s** on some providers — would push the warmup-ping
  pattern from nice-to-have to mandatory; measure early.
- **b28-on-GPU vs b28-on-Metal determinism** — evals differ in noise,
  not distribution; the step-4 sanity set catches any real drift.
- Selector parity is NOT at risk: the Python selector is the same code
  web uses today; only the engine transport changes.

## Explicitly out of scope
- Android/Windows wrappers (fp 31 options B/C — later, on top of this).
- Serving the frontend from the GPU host, multi-region, autoscaling
  beyond 1–2 containers, online multiplayer.
