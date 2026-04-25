# 09 — Publishing online (beta hosting)

**Status:** 📝 Planned
**Priority:** High

## What
Get the app on the public internet at a real URL so beta testers (kids, parents, friends) can try it without running anything locally. Basic auth/gate so it's not wide open, feedback channel, monitoring.

## Why
- No beta testing until this lands.
- Every other feature's success signal depends on real users touching it.
- Forces us to confront the backend footprint (KataGo GPU, Claude API costs) before more users arrive.

## Approach
1. **Frontend hosting.** Static SPA on Vercel / Netlify / Cloudflare Pages. Pick one (leaning Vercel for DX).
2. **Backend hosting.** FastAPI + KataGo, split by workload:
   - **Bots → CPU VPS, always on.** Bot moves are already heuristic-guided and don't need deep search. A smaller network (b10c128, ~25 MB) runs fine on CPU at modest visit counts. Target: Hetzner CPX31 or similar, ~$15/mo.
   - **Reviews / AI teacher → on-demand GPU.** Review quality needs a bigger net (current b20c256 is plenty — no need for b40+) at higher visits, which only feels interactive on GPU. Use Runpod Pods or similar with a "warm pool of one" pattern: FastAPI starts the pod on a review request, runs KataGo there, idle-timeout stops it after ~10 min. At ~$0.22/hr for a 3090-class card, infrequent beta usage lands in the single-digit dollars per month.
   - Bot model and review model **can be the same binary** — just different `.bin.gz` files, different visit counts, different hardware targets. Keep b20 locally for dev; swap to b10 for the deployed bot VPS and re-run the calibration harness there to confirm ranks.
3. **Storage.** SQLite is fine for beta. Switch to managed Postgres only when we have multi-user online play (feature 07).
4. **Access gate.** Simple password or email-allowlist gate at the frontend. Not an account system yet — just keep randos out.
5. **Beta feedback surface.** "Send feedback" button → GitHub issue or email. Include a session ID so we can correlate with logs.
6. **Monitoring & logging.**
   - Frontend: Sentry for errors, simple pageview analytics (Plausible or Umami — privacy-respecting).
   - Backend: structured logs, error reports piped to email for beta.
7. **Cost guardrails.** Rate-limit KataGo calls per session. Rate-limit Claude calls per user per day. Document monthly cost estimate.
8. **CI/CD.** GitHub Actions → deploy on merge to `main`. Staging environment if cheap.
9. **Domain.** Pick and register.

## Scope — first cut
- One production environment, password-gated.
- Frontend on Vercel (free tier).
- Bot backend on a CPU VPS (~$15/mo), always on.
- Review backend on an on-demand GPU pod, auto-stopped when idle.
- SQLite, no user accounts.
- Feedback button, error logging, cost guardrails.

## Expected beta footprint
- Up to ~5 beta testers, infrequent use.
- Budget ceiling: **under $100/mo**.
- Rough monthly estimate at this scale:
  - Frontend (Vercel): $0
  - CPU VPS for bots: ~$15
  - On-demand GPU for reviews: ~$5–20 (mostly idle)
  - Claude API for teacher features: ~$5–20
  - Domain + misc: ~$2
  - **Total: ~$25–60/mo**, well inside the ceiling with headroom.
- If usage jumps, the GPU line is the one that moves — cap it via per-user daily review quota.

## Out of scope (first cut)
- Real authentication / user accounts.
- Staging environment.
- Managed DB migration.
- Horizontal scaling.

## Open questions
- Do we need a privacy policy / terms page even for a gated beta? (Short answer: yes, even a minimal one.)
- Is the KataGo config we run locally replicable on the target host's GPU? (Mac Metal → Linux CUDA will need a different config for the review pod.)
- What domain?
- Which GPU provider? Runpod Pods is the current leaning (per-second billing, scriptable start/stop API); Modal/Runpod Serverless are alternatives if cold-start latency is tolerable.
- Does swapping bots to a b10 model hold their calibrated ranks, or does the harness need a re-tune?

## Resolved
- **Budget ceiling:** under $100/mo for beta.
- **Backend split:** CPU VPS for bots, on-demand GPU for reviews.

## Dependencies
- None — this is a blocker for 07 and a prerequisite for meaningful beta on all other features.

## Success signals
- A non-technical beta tester can reach the app, play a game, and submit feedback without help.
- Monthly infra bill is predictable and within budget.
- Deploy on merge works reliably.
