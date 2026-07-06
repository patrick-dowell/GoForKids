# 31 — Cross-platform reach (web-fast / Android / Windows)

**Status: PARKED (2026-07-06) — revisit after App Store review / camp.**
Trigger: one tester has no iOS device; web bots measured **unplayable**
(production timings 2026-07-06: ~85ms network, ~2.5s player /move —
the redundant score-lead analysis — and **~21s per bot move** = ~1
visit/sec on Render's shared CPU). The iOS speedup was hardware (ANE,
50-200 visits/s), not software; there is no software path from 1 visit/s
to smooth play on Render CPU.

## The options, ranked

### A. Cloud-GPU web (recommended first step — likely dominates)
One modest GPU (T4/A10-class) running the KataGo analysis engine
(TensorRT/CUDA — KataGo's native habitat) does hundreds of visits/sec on
9×9; the bots need 16-50/move, and the engine batches across queries, so
one GPU serves many concurrent games.
- **Covers Android + Windows + Chromebooks in one stroke** — the app is
  already a web app; bot speed is the only blocker.
- **Ladder parity:** web could run the SAME b28 net + b28.yaml profiles
  as iOS (profiles are per-net; today's web runs an uncalibrated b20
  ladder — a divergence we currently just accept).
- Render has NO GPUs (open feature request) → engine goes on a GPU
  provider (Fly.io GPUs / RunPod / Modal / Lambda); API stays on Render;
  engine.py already isolates the engine process, so this is a contained
  refactor. ~$220-450/mo always-on, less with scale-to-zero (~10-30s
  cold start = model load).
- Cheap independent win regardless: **reuse the selection analysis's
  root eval for score_lead** (the same redundancy the S45 attribution
  fix killed on device) — saves ~5s/cycle on web today.
- Effort: days + ops.

### B. Android native
- Selector (TS) + profiles (per-net data) port ~free inside a WebView;
  the engine is the work: KataGo **OpenCL via NDK** + a Kotlin bridge
  mirroring the Swift one.
- Gotcha for OUR audience: flagship phones run b28-on-9×9 acceptably;
  **cheap kid tablets won't** — and dropping to a smaller net means a
  full recalibration campaign for that net (see S38-S51 for what that
  costs). Effort: weeks + a per-device perf QA surface.
- Real advantages over A: offline play, Play Store presence. Best done
  AFTER A, as a thin WebView wrapper on the same fast backend (cheap),
  going full-native-engine only if offline demand shows up.
- **Snapdragon detail (Patrick's Q, 2026-07-06):** three chips, three
  answers. CPU (Kryo/Eigen): ~1 visit/s, non-starter. GPU (Adreno via
  KataGo's stock OpenCL backend): the feasible path — NDK build + Kotlin
  bridge, ~1-2 weeks — but b28 runs ~5-20 v/s on flagships and ~1-5 v/s
  on mid-range kid tablets = works on expensive phones, not the target
  devices. NPU (Hexagon via QNN) is the true ANE-equivalent BUT KataGo
  has no NPU backend for Android — the iOS CoreML path exists only
  because a community member built that whole fork (we got it free).
  Building the QNN equivalent = ONNX conversion + custom inference
  backend, ~1-3 months specialized work, Qualcomm-only (Exynos/Tensor
  need yet another path); same project class as the llama.cpp Hexagon
  ports. This INVERTS Android-native's appeal (cheap tier misses the
  audience, right tier is very expensive) and strengthens the
  cloud-GPU-web-first sequencing.

### C. Windows native
- Smallest missing user set (desktop users can use the web version once
  A exists). Electron/Tauri wrapper + the same GPU backend. Only worth
  it if a concrete need appears.

### D. Small-net web (b6/b10 on CPU) — the budget alternative to A
20-50× faster CPU inference; weaker raw strength is directionally what
a kyu ladder wants anyway. But: new net = full recalibration campaign +
a second ladder to maintain. Keep as fallback if GPU cost is a blocker.

## Billing-shape note (Patrick's Q, 2026-07-06)
- **b28 profiles transfer verbatim**: the GPU runs the same b28c512nbt
  net file as iOS; profiles are per-net; the Python selector already
  reads b28.yaml (Render currently points at b20 only because of CPU
  speed). Web would finally play the SAME calibrated ladder as devices.
- **Zero-usage cost ≈ $0 with scale-to-zero providers** (Modal, RunPod
  serverless, Fly auto-stop machines): cents/month model storage +
  per-second GPU only while ≥1 game is active (~$0.30-0.60/hr T4-class,
  shared across all concurrent games via engine batching). Trade-off:
  ~15-45s cold start on the first move after idle (TensorRT plan cache
  keeps it low) → "waking up the Go master…" loading moment, then fast
  all session. Always-on boxes ($220-450/mo) are the wrong shape for
  this traffic.

## Implementation plan
Step-by-step with estimates: **[31a_cloud_gpu_web.md](31a_cloud_gpu_web.md)**
(≈5–8 working days total; step 0, the score-lead reuse fix, is worth
doing independently of everything else).

## Decision inputs when revisiting
- How many non-iOS users actually materialize (camp families, GO BASE)?
- Monthly GPU cost vs. that demand; scale-to-zero acceptability.
- Whether App Store review / camp surfaced anything that changes
  priorities.
