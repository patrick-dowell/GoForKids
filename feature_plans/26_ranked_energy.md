# 26 — Ranked energy & superpowers

**Status: DESIGN CAPTURE (Patrick's idea, 2026-06-11 late night). Not scheduled.**

## Problem

Undo, Finish Game (and eventually hints) are too powerful for ranked play but
valuable in casual games. The binary options are both bad: leave them in ranked
(breaks ladder integrity) or strip them (sterile, frustrates kids).

## Core design (Patrick's)

Build up **energy** in ranked play, spendable only in ranked, on "superpowers":

| Event / Power | Energy |
| --- | --- |
| Loss | +5 |
| Win | +10 |
| Undo | −10 |
| Hint — a few engine moves to choose from | −25 |
| Finish Game | −50 (the max) |

Adds a strategy layer around energy management and rewards just playing,
without breaking the ladder.

## Why it works (analysis, 2026-06-11)

- **Losses pay out** — sneaky-good psychology, and it directly softens the
  feature-25 setback rule (a loss at 12k+ costs a win of progress but banks
  5 energy). Struggle accumulates resources that help break the slump: an
  agentic complement to the automatic safeguard.
- **Bounded assist economics.** At 50% winrate income ≈ 7.5/game: an undo
  every ~1.3 games, a hint every ~3.3, a finish every ~6.7. Generous but
  bounded; effective strength inflation is real but small and quantifiable.
- **The hint is a learning feature in disguise** — choosing among candidate
  moves is active comparison, the Study Mode seed inside ranked.
- **Aspiration loop**: grayed-out powers with visible costs give kids a reason
  to keep playing ("12 more energy until Finish").

## Required guards (non-negotiable before shipping)

- **Resign-farming**: 5/loss means a turn-1 resign earns 5 energy in seconds →
  ~2 minutes farms a Finish. Energy must require a minimum game length (e.g.
  ≥20 moves) and/or resigns earn 0.
- **Banked cap** (e.g. 100) so hoarding can't chain-trivialize sessions.
- **Record power usage in `HistoryEntry` from day one** — data first, policy
  later (e.g. shadow rating could discount assisted wins down the road).

## Open questions

1. **Pricing philosophy** — undo 10 < hint 25 punishes regret less than it
   rewards learning. The inverse (hint cheap, undo pricey) teaches
   forward-looking play. What should the ladder incentivize?
2. **Finish Game strength in ranked** — full-strength KataGo endgame can swing
   real points in a close game; 50 energy may not be enough of a brake.
   Options: gate Finish on a decisive lead (|scoreLead| > threshold), or play
   the finish at rank-appropriate strength.
3. **Hint presentation** — how many candidates, at what strength, shown how?
   (Top-3 full-strength = strong assist; mixed-quality candidates = more
   teaching, more design.)
4. **Energy pool: global or per-board?** Rungs are per-board; energy is
   probably a player-level resource (simpler, more fun).
5. **Theming** — fits the cosmic avatar world ("star power"?); natural overlap
   with the rewards arc (avatar animation on power use).

## MVP slicing

1. **Phase 1**: energy earn/spend + gate the EXISTING undo/finish behind it in
   ranked. No new mechanics — mostly store + HUD + gating.
2. **Phase 2**: Hint (new analysis UI; Study-Mode-adjacent).
3. **Phase 3**: theming/animation, folded into the rewards arc (shareable
   profile, avatars).
