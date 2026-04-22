# GoForKids — Feature Plans

Planning docs for the next wave of features. Each doc captures what the feature is, why it matters, and a rough approach so we can spin up a focused session to build it.

## Status legend
- 📝 **Planned** — doc written, not started
- 🚧 **In progress** — session(s) active
- 🧪 **Beta** — shipped, collecting feedback
- ✅ **Done** — landed and stable
- ❄️ **On hold** — intentionally paused

## Feature index

| # | Feature | Status | Priority | Depends on |
|---|---------|--------|----------|------------|
| 01 | [Bot ladder completion (12k–1d)](01_bot_ladder.md) | 📝 Planned | High | — |
| 02 | [Puzzles](02_puzzles.md) | 📝 Planned | High | 03 (shared concept taxonomy) |
| 03 | [Concept lessons](03_concept_lessons.md) | 📝 Planned | High | — |
| 04 | [AI Go Teacher (review mode)](04_ai_teacher_review.md) | 📝 Planned | High | Study-mode plumbing in v1 |
| 05 | [New-user experience (NUX)](05_nux.md) | 📝 Planned | High | 03 (lessons exist to funnel into) |
| 06 | [Observing games (OGS)](06_observing_games.md) | 📝 Planned | Medium | — |
| 07 | [Kid-safe online play](07_online_play.md) | 📝 Planned | Medium | 09 (hosting), COPPA review |
| 08 | [Traditional board mode](08_traditional_mode.md) | ✅ Done (first cut) | Low | — |
| 09 | [Publishing online (beta hosting)](09_publishing.md) | 📝 Planned | High | — |
| 10 | [iPad app](10_ipad_app.md) | 📝 Planned | Medium | 09 (or parallel) |
| 11 | [Avatars (expansion & polish)](11_avatars.md) | 📝 Planned | Medium | 01, 05, 12 |
| 12 | [Animations & sound effects](12_animations_and_sound.md) | 📝 Planned | Medium | 04, 08, 11 |
| 13 | [Smaller boards (9×9, 13×13)](13_smaller_boards.md) | 📝 Planned | High | — |
| 14 | [Parent-facing dashboard](14_parent_dashboard.md) | 📝 Planned | High | 01, 02, 03, 15 |
| 15 | [Rewards loop (milestones, cosmetics, streaks)](15_rewards_loop.md) | 📝 Planned | High | 02, 03, 11, 12, 14 |
| 16 | [Mistake tracking across games](16_mistake_tracking.md) | 📝 Planned | Medium | 04, 02, 03, 14 |
| 17 | [Rank / progress UI widget](17_rank_progress_ui.md) | 📝 Planned | Medium | 01, 13, 15 |
| 18 | [Rules refresher (returning adults)](18_rules_refresher.md) | 📝 Planned | Low | 03, 05 |
| 19 | [What-if exploration (interactive review)](19_whatif_exploration.md) | 📝 Planned | Medium | 04 |

## Suggested sequencing

**Wave 1 — Foundations for feedback:** 09 (publish beta), 01 (finish bots), 13 (smaller boards), 05 (NUX shell), 17 (rank widget).
Without hosting there are no beta testers; without a full bot ladder players hit a wall; without smaller boards the kid ramp doesn't exist; without NUX first-timers bounce; without the rank widget the ladder is invisible.

**Wave 2 — Teaching loop:** 03 (concept lessons), 02 (puzzles), 04 (AI teacher review), 19 (what-if), 16 (mistake tracking), 18 (rules refresher).
These form the learning spine. Share a concept taxonomy across all of them.

**Wave 3 — Reward and parent loop:** 15 (rewards), 14 (parent dashboard), 11 (avatars), 12 (animations/SFX).
Once learning works, make accomplishments felt — by kid and by parent.

**Wave 4 — Expansion:** 06 (observe OGS), 07 (online play), 08 (traditional mode), 10 (iPad).

## How to use these docs

Each feature doc is self-contained and written to kick off a dedicated working session. Update the status in this index when a session starts or ships. If the approach shifts during implementation, edit the doc so future sessions start from the latest thinking.
