# 07 — Kid-safe online play

**Status:** 📝 Planned
**Priority:** Medium

## What
Let kids play Go against other kids online — matched by rank, moderated for safety, no open chat, no identifying info. The goal is real human opponents without the risks of a general-purpose online game server.

## Why
- Playing humans is qualitatively different from playing bots and is a core reason players return.
- No existing Go server is built with COPPA/kid-safety as the default.
- Closes the loop on the whole product: learn → practice → play real people → climb rank.

## Approach
1. **Legal/compliance first.** Before anything else: COPPA review. What data can we collect, what consent flow do we need, what's the parental-approval model? This gates design.
2. **Accounts & identity.**
   - Kids pick a cosmic handle (non-identifying, from a curated list or with heavy filter).
   - No real names, no photos, no free-text profiles.
   - Parent email tied to the account for consent.
3. **Matchmaking.** Rank-based queue using our Glicko-2 rating. Match within ±2 ranks. Prefer 9×9 and 13×13 for quicker games.
4. **Live game transport.** WebSocket (our architecture is already WebSocket-ready). Server-authoritative board (Python engine mirrors frontend). Clock with kid-friendly overtime (long byoyomi or no clock at all).
5. **Communication surface — deliberately tiny.**
   - No free-text chat ever.
   - Canned emotes only: "good game", "thanks", "nice move", a smiley, an "oops" — curated short list.
   - No emotes that can be weaponized (no thumbs-down, no clocks-tapping taunts).
6. **Moderation.**
   - Report button → flagged to human review.
   - Auto-detect stalling/disconnect-abuse, auto-forfeit after N minutes.
   - Ban/timeout system on the parent account.
7. **Presence.** Show "X kids online" and "Y games in progress" without exposing specific users.
8. **Parent dashboard (minimal).** Games played, opponents' ranks, report history. Email digest optional.

## Scope — first cut
- Rank-matched 9×9 play with canned emotes, server clock, WebSocket transport.
- Handle-based accounts, parent email on file, simple consent screen.
- Report button → email queue.

## Out of scope (first cut)
- Friends lists, private invites.
- Voice, video, or free-text chat of any kind.
- Tournaments.
- Matchmaking across regions/latency tiers (start with "best effort").

## Open questions
- COPPA compliance model — are we the "operator" or does a parent-signup partner handle it? (Big question, research early.)
- Do we need moderation staff to stand this up, or can auto-moderation + canned emotes get us to beta safely?
- Do parents trust a brand-new site with their kid's online play? (Probably not without a clear "here's why it's safe" page.)

## Dependencies
- Feature 09 (publishing/hosting) — need a production host.
- Glicko-2 rating already built (needs to be surfaced first).
- Potentially depends on a legal advisor review before launch.

## Success signals
- Zero unmoderated text between users.
- Matches happen in < 60s during active hours.
- No moderation incidents require escalation beyond auto-actions in the first month.
