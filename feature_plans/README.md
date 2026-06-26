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
| 01 | [Bot ladder completion (12k–1d)](01_bot_ladder.md) | 🚧 In progress | High | — |
| 02 | [Puzzles](02_puzzles.md) | 📝 Planned | High | 03 (shared concept taxonomy) |
| 03 | [Concept lessons](03_concept_lessons.md) | 🧪 Beta | High | — |
| 04 | [AI Go Teacher (review mode)](04_ai_teacher_review.md) | 📝 Planned | High | Study-mode plumbing in v1 |
| 05 | [New-user experience (NUX)](05_nux.md) | 📝 Planned | High | 03 (lessons exist to funnel into) |
| 06 | [Observing games (OGS)](06_observing_games.md) | 📝 Planned | Medium | — |
| 07 | [Kid-safe online play](07_online_play.md) | 📝 Planned | Medium | 09 (hosting), COPPA review |
| 08 | [Traditional board mode](08_traditional_mode.md) | ✅ Done (first cut) | Low | — |
| 09 | [Publishing online (beta hosting)](09_publishing.md) | 📝 Planned | High | — |
| 10 | [iPad app](10_ipad_app.md) | 🧪 Beta | Medium | 09 (or parallel) |
| 11 | [Avatars (expansion & polish)](11_avatars.md) | 📝 Planned | Medium | 01, 05, 12 |
| 12 | [Animations & sound effects](12_animations_and_sound.md) | 🧪 Beta | Medium | 04, 08, 11 |
| 13 | [Smaller boards (9×9, 13×13)](13_smaller_boards.md) | ✅ Done | High | — |
| 14 | [Parent-facing dashboard](14_parent_dashboard.md) | 📝 Planned | High | 01, 02, 03, 15 |
| 15 | [Rewards loop (milestones, cosmetics, streaks)](15_rewards_loop.md) | 📝 Planned | High | 02, 03, 11, 12, 14 |
| 16 | [Mistake tracking across games](16_mistake_tracking.md) | 📝 Planned | Medium | 04, 02, 03, 14 |
| 17 | [Rank / progress UI widget](17_rank_progress_ui.md) | ❄️ On hold (superseded by 22 + 23) | Medium | — |
| 18 | [Rules refresher (returning adults)](18_rules_refresher.md) | 📝 Planned | Low | 03, 05 |
| 19 | [What-if exploration (interactive review)](19_whatif_exploration.md) | 📝 Planned | Medium | 04 |
| 20 | [b28 bot calibration harness](20_b28_calibration.md) | 📝 Planned | High | — |
| 21 | [iPhone (Pro Max) support](21_iphone_support.md) | 🟡 Beta | Medium | 10 |
| 22 | [Auto-play (matchmaker + ranked progression)](22_auto_play.md) | 🧪 Beta | High | 01, 23 |
| 23 | [Profile page](23_profile_page.md) | 🧪 Beta | High | 22, 11 |
| 24 | [9×9 ranked ladder (points model)](24_9x9_ladder.md) | 🧪 Beta (shipped 2026-06-03→11) | High | 22, 23 |
| 25 | [Ranked promotion polish](25_promotion_polish.md) | ✅ Done (2026-06-11) | High | 22, 24 |
| 26 | [Ranked energy & superpowers](26_ranked_energy.md) | 📝 Planned | High | 22, 25 |
| 27 | [World & art pass](27_world_and_art.md) | 📝 Planned | High | 11, 12, 15, 26 |
| 28 | [Learning engine — "Play of the Game" review](28_learning_engine_potg.md) | 🧪 Beta (swing-based + replay-integrated, Session 25) | High | 29, 03, 04, 16, 26; score graph |
| 29 | [Concept registry & glossary](29_concept_registry_glossary.md) | 🧪 Beta (built Session 25) | High | — (the spine; 02/03/04/16/28 depend on it) |

## Active milestone

➡️ **[Tester Round — Learning-Loop Polish](MILESTONE_tester_round.md)** (scoped 2026-06-25):
lessons / replay / highlights polish · undo banking · "back to menu" fix ·
maybe glossary pass → device validation by Patrick + Roland. Validation > new
features. Energy / world-art / puzzles deferred.

## Roadmap (as of 2026-06-11 — supersedes the wave plan below)

**Now — the Learning Loop build (re-sequenced 2026-06-11):** the core tester
feedback is the **full loop — learning → playing → learning, no gaps**; the
ranked loop exists (9×9 + 19×19) but ~5 minutes of lessons is the gap. So:
**lessons overhaul first** (03 + glossary + more lessons; open question whether
a small puzzles MVP makes the pre-build cut) → device pass on the 2026-06-11
polish batch → bot validation (6k v3, 15k recheck, rung-label spot check; fp 20
harness; opening variety rides along) → **Render redeploy** (new komi field) →
TestFlight. 13×13 ranked: deliberately skipped — revisit on tester demand.

**The retention / learning thesis (design session 2026-06-16, see fp 28):** the
ranked "wall" is mathematically guaranteed; Go answers it with honest progress
axes (handicap, board sizes, learning) instead of CCG-style fake resets. Four
pillars: ladder progress (22/24/25) · calibrated 50-50 games (01/20) · energy
(26) · **in-context learning (28 — the keystone).** The lessons overhaul below
is the first half of pillar 4 — it's where fp 28's highlights link into.

**Learning-engine architecture (design session 2026-06-16, fp 28 + 29):**
philosophy = glossary is the canonical concept set; each lesson teaches ONE
concept; lessons cover only the must-knows to enter a game; the rest is taught
**as you play** (fp 28 in-context teacher). Build order: **29 (concept registry
+ glossary) is the spine, built first** → lessons become one-concept on-ramps
referencing it → 28 (Play of the Game) + 02/04/16 consume the registry.
⚠️ This may supersede/merge the older 03/02 plans — under review.

**This version (focus windows, order being decided):**
- **Lessons overhaul → now anchored on fp 29.** Build the concept registry +
  glossary (the spine), reframe the 11 shipped lessons as one-concept on-ramps
  against it, tighten. NOT "more lessons" — the depth moves to play + glossary.
- **World & art pass** (27 — world bible → assets → animations)
- **Ranked energy + rewards** (26 phase 1 + 15 — mechanics that spend 27's art)
- **Study Mode design session** (04 scoping — too big/vague to schedule unscoped)
- Opening variety rides along with the bot-validation work (move-selector
  change; needs play-validation)

**Next version (explicitly tabled 2026-06-11, Patrick's call):**
- Social — friends, profiles, matching (doc TBD)
- Watching games with commentary/analysis for kids (06 + 04 — note: 27's bot
  personalities feed this)
- Puzzles (02)
- Online play (07 — biggest infra; COPPA review)

## Original wave plan (historical)

**Wave 1 — Foundations for feedback:** 09 (publish beta), 01 (finish bots), 13 (smaller boards), 05 (NUX shell), 17 (rank widget).
**Wave 2 — Teaching loop:** 03 (concept lessons), 02 (puzzles), 04 (AI teacher review), 19 (what-if), 16 (mistake tracking), 18 (rules refresher).
**Wave 3 — Reward and parent loop:** 15 (rewards), 14 (parent dashboard), 11 (avatars), 12 (animations/SFX).
**Wave 4 — Expansion:** 06 (observe OGS), 07 (online play), 08 (traditional mode), 10 (iPad).

## How to use these docs

Each feature doc is self-contained and written to kick off a dedicated working session. Update the status in this index when a session starts or ships. If the approach shifts during implementation, edit the doc so future sessions start from the latest thinking.
