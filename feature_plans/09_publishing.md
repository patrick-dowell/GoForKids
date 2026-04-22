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
2. **Backend hosting.** FastAPI + KataGo is the hard part — KataGo wants GPU for reasonable speed.
   - **Option A:** small VPS with CPU KataGo (slower but cheap).
   - **Option B:** GPU instance (Lambda Labs, Runpod, or similar) — ~$0.50–2/hour, only spin up on demand.
   - **Option C:** CPU for bot moves (they're already heuristic-guided and don't need deep search), GPU only for review/study. **Leaning C.**
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
- Frontend on Vercel, backend on a GPU VPS.
- SQLite, no user accounts.
- Feedback button, error logging, cost guardrails.

## Out of scope (first cut)
- Real authentication / user accounts.
- Staging environment.
- Managed DB migration.
- Horizontal scaling.

## Open questions
- What's the budget ceiling for beta? Decide before picking GPU tier.
- Do we need a privacy policy / terms page even for a gated beta? (Short answer: yes, even a minimal one.)
- Is the KataGo config we run locally replicable on the target host's GPU? (Mac Metal → Linux CUDA will need a different config.)
- What domain?

## Dependencies
- None — this is a blocker for 07 and a prerequisite for meaningful beta on all other features.

## Success signals
- A non-technical beta tester can reach the app, play a game, and submit feedback without help.
- Monthly infra bill is predictable and within budget.
- Deploy on merge works reliably.
