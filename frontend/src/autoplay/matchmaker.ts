/**
 * Auto-play matchmaker — feature 22 (19×19) + feature 24 (9×9).
 *
 * A per-board linear ladder where each rung is a fixed matchup chosen so the
 * matchup's effective strength equals the player's rank. Promotion is
 * deterministic: win N games at a rung → next rung, where N grows up the
 * ladder (3 below 12k, 4 from 12k, 5 from 5k — feature 25). From 12k onward
 * each loss also sets progress back one win (floored at 0; the rung itself is
 * never lost). Below 12k losses are no-ops — pure kid-first.
 *
 * A rung's difficulty is set by FOUR levers, which together form a single
 * continuous "how much help does the human get" axis:
 *   - which bot (stronger bot ⇒ harder),
 *   - player color (Black moves first = easier; White hands the bot the
 *     initiative AND any handicap stones),
 *   - handicap stones (always Black's: the player's advantage when the player
 *     is Black, the bot's when the player is White),
 *   - komi (added to White's score; the engine forces 0.5 when handicap > 0).
 *
 * 9×9 (feature 24, rebuilt S44) has a real bot every ~3 ranks from 18k up, so
 * the upper ladder ramps by KOMI alone (bot komi 0 → 3.5 → 6.5 even) and the
 * player fights each new bot directly. Handicap STONES survive only in the
 * 30k→20k desert below the weakest sampling bot (18k).
 */

/** A rank label on the auto-play ladder, e.g. "30k", "27k", ..., "1d". */
export type Rung = string;

/** Board sizes with an auto-play ladder. 13×13 is not yet calibrated. */
export type BoardSize = 9 | 13 | 19;

/** The color the human plays on a rung. */
export type PlayerColor = 'black' | 'white';

export interface Matchup {
  /** Bot rank label, e.g. "30k", "15k", ..., "1d". */
  bot: string;
  /** Color the human plays. Black (default) moves first; White hands the
   *  early initiative — and any handicap stones — to the bot. */
  playerColor: PlayerColor;
  /** Handicap stones, always placed for Black (0 = none). The player's
   *  advantage when the player is Black; the bot's when the player is White. */
  handicap: number;
  /** Explicit komi (added to White's score). Undefined ⇒ the engine's default
   *  for the board. The engine forces komi 0.5 whenever handicap > 0. */
  komi?: number;
  /** True when the bot has a calibrated profile on this board. False rungs
   *  hold the player at the prior rung instead of promoting onto them. */
  validated: boolean;
}

/* ------------------------------------------------------------------------- *
 * Rung specs — internal table format, one per board.
 * ------------------------------------------------------------------------- */

interface RungSpec {
  rung: Rung;
  bot: string;
  /** Defaults to 'black'. */
  playerColor?: PlayerColor;
  /** Defaults to 0. */
  handicap?: number;
  /** Explicit komi for non-handicap rungs; omit to use the engine default. */
  komi?: number;
  /** Color-variety alternative for an in-between (komi-edge) rung: the SAME
   *  rung difficulty expressed the other way — you play White against the
   *  next-WEAKER bot instead of Black-with-advantage against the stronger
   *  one. `gameMatchup` shows it on alternating games so the rung switches
   *  color AND bot. Difficulty-matched: white komi = 3.5 − the Black
   *  variant's komi (S44, Patrick's request). Only in-between rungs whose
   *  weaker neighbor is a real sampling bot have this (not 20k/19k, below
   *  which only the 30k heuristic lives). */
  colorAlt?: { bot: string; komi: number };
}

/** 19×19 ladder — stones throughout, player always Black (feature 22). */
const SPECS_19: ReadonlyArray<RungSpec> = [
  { rung: '30k', bot: '30k', handicap: 0 },
  { rung: '27k', bot: '18k', handicap: 9 },
  { rung: '26k', bot: '18k', handicap: 8 },
  { rung: '25k', bot: '18k', handicap: 7 },
  { rung: '24k', bot: '18k', handicap: 6 },
  { rung: '23k', bot: '18k', handicap: 5 },
  { rung: '22k', bot: '18k', handicap: 4 },
  { rung: '21k', bot: '18k', handicap: 3 },
  { rung: '20k', bot: '18k', handicap: 2 },
  { rung: '19k', bot: '18k', handicap: 1 },
  { rung: '18k', bot: '18k', handicap: 0 },
  { rung: '17k', bot: '15k', handicap: 2 },
  { rung: '16k', bot: '15k', handicap: 1 },
  { rung: '15k', bot: '15k', handicap: 0 },
  { rung: '14k', bot: '12k', handicap: 2 },
  { rung: '13k', bot: '12k', handicap: 1 },
  { rung: '12k', bot: '12k', handicap: 0 },
  { rung: '11k', bot: '9k', handicap: 2 },
  { rung: '10k', bot: '9k', handicap: 1 },
  { rung: '9k', bot: '9k', handicap: 0 },
  { rung: '8k', bot: '6k', handicap: 2 },
  { rung: '7k', bot: '6k', handicap: 1 },
  { rung: '6k', bot: '6k', handicap: 0 },
  { rung: '5k', bot: '3k', handicap: 2 },
  { rung: '4k', bot: '3k', handicap: 1 },
  { rung: '3k', bot: '3k', handicap: 0 },
  { rung: '2k', bot: '1d', handicap: 2 },
  { rung: '1k', bot: '1d', handicap: 1 },
  { rung: '1d', bot: '1d', handicap: 0 },
];

/** Even-game (EVEN) and half-step (HALF) komi on 9×9. Patrick's points model
 *  (playtest-calibrated 2026-06-04): 1 rank ≈ 4 pts; a 2-stone handicap ≈ 14
 *  pts ≈ 3.5–4 ranks; EVEN komi (6.5) ≈ 2 ranks; HALF komi (3.5) ≈ 1 rank.
 *  NOTE: there is no 1-stone handicap on 9×9 — a single stone ≈ no-komi, so the
 *  minimum real handicap is 2 stones. The ladder fills stone gaps with komi. */
const KOMI_EVEN = 6.5;
const KOMI_HALF = 3.5;

/**
 * 9×9 ladder — feature 24 points-model ramp, REBUILT 2026-07-05 (S44) after
 * the distribution-calibration campaign gave EIGHT real 9×9 profiles
 * (30k/18k/15k/12k/9k/6k/3k/1d, was six). With a real bot every ~3 ranks
 * from 18k up, the whole upper ladder is now bridged by KOMI ALONE (each bot:
 * komi 0 ≈ 2 ranks easy → 3.5 ≈ 1 rank easy → 6.5 even), so the player fights
 * each new bot directly instead of a big-handicap proxy of its neighbor.
 * Handicap STONES now survive only in the 30k→20k "desert", where the 30k
 * heuristic bot is the only profile below 18k. This kills the old +4/+3-stone
 * grind against the 15k bot and the +2-stone-plus-komi 12k rung.
 *
 * Difficulty is still one continuous "player advantage in points" axis
 * (bot + color + stones ≥2 ≈7 pts each + komi). Labels/points are
 * playtest-seeded, PENDING validation. Even (6.5 komi) rungs default Black.
 * Top rung is 1d; clearing it = the "2 dan" graduation (no 2d bot).
 */
const SPECS_9: ReadonlyArray<RungSpec> = [
  // 30k→20k desert — only the 30k heuristic bot lives below 18k, so this
  // stretch still needs stones. 18k's easy end (komi 0 ≈ 20k) picks it up.
  { rung: '30k', bot: '30k', playerColor: 'black', handicap: 0, komi: 0 },              // no komi (easiest)
  { rung: '28k', bot: '30k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },      // even vs 30k
  { rung: '25k', bot: '30k', playerColor: 'white', handicap: 2 },                       // White, bot +2 stones
  { rung: '22k', bot: '18k', playerColor: 'black', handicap: 2 },                       // you +2 stones vs 18k
  // 18k bot — komi triple (NEW real rung)
  { rung: '20k', bot: '18k', playerColor: 'black', handicap: 0, komi: 0 },              // no komi
  { rung: '19k', bot: '18k', playerColor: 'black', handicap: 0, komi: KOMI_HALF },      // 3.5 komi
  { rung: '18k', bot: '18k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },      // even
  // 15k bot — komi triple (in-between rungs also playable as White vs the
  // weaker 18k bot; white komi = 3.5 − black komi, same difficulty).
  { rung: '17k', bot: '15k', playerColor: 'black', handicap: 0, komi: 0, colorAlt: { bot: '18k', komi: KOMI_HALF } },
  { rung: '16k', bot: '15k', playerColor: 'black', handicap: 0, komi: KOMI_HALF, colorAlt: { bot: '18k', komi: 0 } },
  { rung: '15k', bot: '15k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },      // even
  // 12k bot — komi triple (NEW real rung)
  { rung: '14k', bot: '12k', playerColor: 'black', handicap: 0, komi: 0, colorAlt: { bot: '15k', komi: KOMI_HALF } },
  { rung: '13k', bot: '12k', playerColor: 'black', handicap: 0, komi: KOMI_HALF, colorAlt: { bot: '15k', komi: 0 } },
  { rung: '12k', bot: '12k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },      // even
  // 9k bot — komi triple
  { rung: '11k', bot: '9k', playerColor: 'black', handicap: 0, komi: 0, colorAlt: { bot: '12k', komi: KOMI_HALF } },
  { rung: '10k', bot: '9k', playerColor: 'black', handicap: 0, komi: KOMI_HALF, colorAlt: { bot: '12k', komi: 0 } },
  { rung: '9k', bot: '9k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even
  // 6k bot — komi triple
  { rung: '8k', bot: '6k', playerColor: 'black', handicap: 0, komi: 0, colorAlt: { bot: '9k', komi: KOMI_HALF } },
  { rung: '7k', bot: '6k', playerColor: 'black', handicap: 0, komi: KOMI_HALF, colorAlt: { bot: '9k', komi: 0 } },
  { rung: '6k', bot: '6k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even
  // 3k bot — komi triple
  { rung: '5k', bot: '3k', playerColor: 'black', handicap: 0, komi: 0, colorAlt: { bot: '6k', komi: KOMI_HALF } },
  { rung: '4k', bot: '3k', playerColor: 'black', handicap: 0, komi: KOMI_HALF, colorAlt: { bot: '6k', komi: 0 } },
  { rung: '3k', bot: '3k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even
  // 1d bot — komi triple
  { rung: '2k', bot: '1d', playerColor: 'black', handicap: 0, komi: 0, colorAlt: { bot: '3k', komi: KOMI_HALF } },
  { rung: '1k', bot: '1d', playerColor: 'black', handicap: 0, komi: KOMI_HALF, colorAlt: { bot: '3k', komi: 0 } },
  { rung: '1d', bot: '1d', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even — top (clear = 2 dan)
];

/* ------------------------------------------------------------------------- *
 * Per-board ladder definitions.
 * ------------------------------------------------------------------------- */

interface Ladder {
  boardSize: BoardSize;
  startingRung: Rung;
  specs: ReadonlyArray<RungSpec>;
  rungs: ReadonlyArray<Rung>;
  rungIndex: ReadonlyMap<Rung, number>;
  /** Bots with a calibrated profile on this board. */
  validatedBots: ReadonlySet<string>;
  /** Engine cap on handicap stones for this board (matches `MAX_HANDICAP_BY_SIZE`). */
  maxHandicap: number;
  /** Stones added/removed by the anti-frustration safeguard. */
  safeguardBonusStones: number;
  /** Komi points shifted toward Black by the safeguard (~1 rank). */
  safeguardBonusKomi: number;
}

function buildLadder(
  boardSize: BoardSize,
  specs: ReadonlyArray<RungSpec>,
  opts: {
    validatedBots: ReadonlySet<string>;
    maxHandicap: number;
    safeguardBonusStones: number;
    safeguardBonusKomi: number;
  },
): Ladder {
  const rungs = specs.map((s) => s.rung);
  return {
    boardSize,
    startingRung: rungs[0],
    specs,
    rungs,
    rungIndex: new Map(rungs.map((r, i) => [r, i])),
    ...opts,
  };
}

const LADDERS: Record<BoardSize, Ladder | undefined> = {
  19: buildLadder(19, SPECS_19, {
    validatedBots: new Set(['30k', '18k', '15k', '12k', '9k', '6k']),
    maxHandicap: 9,
    safeguardBonusStones: 2,
    safeguardBonusKomi: 6,
  }),
  9: buildLadder(9, SPECS_9, {
    // The eight bots with real 9×9 profiles in b28.yaml (18k + 12k added
    // S44 after the distribution-calibration campaign).
    validatedBots: new Set(['30k', '18k', '15k', '12k', '9k', '6k', '3k', '1d']),
    maxHandicap: 5,
    safeguardBonusStones: 2,
    safeguardBonusKomi: 6,
  }),
  13: undefined, // not yet calibrated
};

function ladderFor(boardSize: BoardSize): Ladder {
  const ladder = LADDERS[boardSize];
  if (!ladder) throw new Error(`No auto-play ladder for board size ${boardSize}`);
  return ladder;
}

function specToMatchup(spec: RungSpec, ladder: Ladder): Matchup {
  return {
    bot: spec.bot,
    playerColor: spec.playerColor ?? 'black',
    handicap: spec.handicap ?? 0,
    komi: spec.komi,
    validated: ladder.validatedBots.has(spec.bot),
  };
}

/* ------------------------------------------------------------------------- *
 * Constants.
 * ------------------------------------------------------------------------- */

/** Base wins required to promote at low rungs (below `FOUR_WIN_FROM`).
 *  Prefer `winsToPromote(rung, boardSize)` — the threshold grows up the
 *  ladder (feature 25: ranked promotion polish). */
export const WINS_TO_PROMOTE = 3;

/** From this rank (inclusive): 4 wins to promote, and each loss sets rung
 *  progress back one win (see `lossSetbackActive`). */
export const FOUR_WIN_FROM: Rung = '12k';

/** From this rank (inclusive): 5 wins to promote. */
export const FIVE_WIN_FROM: Rung = '5k';

/** Loss streak that triggers the anti-frustration safeguard. */
export const SAFEGUARD_LOSS_THRESHOLD = 5;

/** Extra handicap stones added when the safeguard is active (19×19 default;
 *  per-board values live on each `Ladder`). */
export const SAFEGUARD_BONUS_STONES = 2;

/** The starting rung for a new auto-play journey (same on every board). */
export const STARTING_RUNG: Rung = '30k';

/** Ordered 19×19 rungs, weakest → strongest. Back-compat export; prefer
 *  `ladderRungs(boardSize)` for board-aware code. */
export const LADDER_RUNGS: ReadonlyArray<Rung> = SPECS_19.map((s) => s.rung);

/** Ordered rungs for a board, weakest (index 0) → strongest. */
export function ladderRungs(boardSize: BoardSize = 19): ReadonlyArray<Rung> {
  return ladderFor(boardSize).rungs;
}

/** The starting rung for a board. */
export function startingRung(boardSize: BoardSize = 19): Rung {
  return ladderFor(boardSize).startingRung;
}

/** True when the board has a calibrated auto-play ladder. */
export function hasLadder(boardSize: BoardSize): boolean {
  return LADDERS[boardSize] !== undefined;
}

/* ------------------------------------------------------------------------- *
 * Matchup lookup.
 * ------------------------------------------------------------------------- */

/** Look up the base matchup (no safeguard) for a rung on a board. */
export function matchupForRung(rung: Rung, boardSize: BoardSize = 19): Matchup {
  const ladder = ladderFor(boardSize);
  const spec = ladder.specs.find((s) => s.rung === rung);
  if (!spec) throw new Error(`Unknown rung "${rung}" on ${boardSize}×${boardSize}`);
  return specToMatchup(spec, ladder);
}

/** True when `rung` exists on the given board's ladder. */
export function hasRung(rung: Rung, boardSize: BoardSize = 19): boolean {
  const ladder = LADDERS[boardSize];
  return ladder ? ladder.rungIndex.has(rung) : false;
}

/** Monotonic strength scalar for a rank label (stronger ⇒ larger):
 *  "30k" → -30, "1k" → -1, "1d" → +1, "2d" → +2. Unparseable ⇒ NaN. */
function rankStrength(rung: string): number {
  const m = /^(\d+)([kd])$/.exec(rung);
  if (!m) return NaN;
  const n = parseInt(m[1], 10);
  return m[2] === 'k' ? -n : n;
}

/** Resolve a possibly-stale persisted rung to a valid one on the current
 *  ladder: returns it unchanged if it exists, otherwise the nearest rung by
 *  strength (ties → the weaker/easier one, since rungs are ordered easy→hard
 *  and we scan front-to-back with a strict `<`). This is the migration for
 *  saved rungs from an older ladder shape — the S44 9×9 rebuild dropped the
 *  21k/23k rungs, and a device still parked on one of them crashed the
 *  ranked/profile screens (Roland's iPad, 2026-07-06). Falls back to the
 *  starting rung for unparseable input or a board with no ladder. */
export function resolveRung(rung: Rung, boardSize: BoardSize = 19): Rung {
  const ladder = LADDERS[boardSize];
  if (!ladder) return rung;
  if (ladder.rungIndex.has(rung)) return rung;
  const target = rankStrength(rung);
  if (Number.isNaN(target)) return ladder.startingRung;
  let best: Rung = ladder.startingRung;
  let bestDiff = Infinity;
  for (const r of ladder.rungs) {
    const s = rankStrength(r);
    const diff = Number.isNaN(s) ? Infinity : Math.abs(s - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

/** Effective matchup for a player given their rung and current loss streak.
 *  The safeguard always eases the matchup toward the player along the same
 *  difficulty axis the rung lives on:
 *    - komi rung (Black, komi > 0.5): drop komi toward 0,
 *    - Black with stones (or even): give the player more stones,
 *    - White (bot holds the stones): take stones back off the bot. */
export function effectiveMatchup(rung: Rung, lossStreak: number, boardSize: BoardSize = 19): Matchup {
  const ladder = ladderFor(boardSize);
  const base = matchupForRung(rung, boardSize);
  if (lossStreak < SAFEGUARD_LOSS_THRESHOLD) return base;

  // Ease a komi-only rung by dropping komi toward the player.
  if (base.handicap === 0 && base.komi !== undefined && base.komi > 0.5) {
    return { ...base, komi: Math.max(0, base.komi - ladder.safeguardBonusKomi) };
  }
  // Player is White and the bot (Black) holds the handicap — reduce it.
  if (base.playerColor === 'white') {
    const reduced = Math.max(0, base.handicap - ladder.safeguardBonusStones);
    if (reduced === base.handicap) return base;
    return { ...base, handicap: reduced };
  }
  // Player is Black — give the player more stones (capped at the engine max).
  const boosted = Math.min(ladder.maxHandicap, base.handicap + ladder.safeguardBonusStones);
  if (boosted === base.handicap) return base;
  return { ...base, handicap: boosted };
}

/** True when `effectiveMatchup` would differ from the base matchup. */
export function isSafeguardActive(rung: Rung, lossStreak: number, boardSize: BoardSize = 19): boolean {
  if (lossStreak < SAFEGUARD_LOSS_THRESHOLD) return false;
  const base = matchupForRung(rung, boardSize);
  const eff = effectiveMatchup(rung, lossStreak, boardSize);
  return eff.handicap !== base.handicap || eff.komi !== base.komi;
}

/** True when a rung is color-symmetric — an even game (no stones, full komi)
 *  plays the same for either color, so the ladder may vary who the player is.
 *  Komi-edge rungs (0 / 3.5) and handicap rungs encode a specific color's
 *  advantage and are never flipped; nor are spec'd-White rungs (already
 *  non-default). */
export function isColorSymmetric(rung: Rung, boardSize: BoardSize = 19): boolean {
  const base = matchupForRung(rung, boardSize);
  return (
    base.playerColor === 'black' &&
    base.handicap === 0 &&
    (base.komi === undefined || base.komi === KOMI_EVEN)
  );
}

/**
 * The matchup to actually play for the next game — `effectiveMatchup` plus
 * color variety (feature 25 follow-up, Session 22 feedback: "always Black" got
 * repetitive). On color-symmetric rungs the player alternates Black/White by
 * games already played at the rung (deterministic — no stored randomness).
 *
 * Variety pauses in two cases, both kid-first:
 *  - the starting rung: a brand-new player's first games stay consistent;
 *  - while the safeguard is active: its komi-easing assumes the player is
 *    Black, and a struggling kid gets the familiar setup back anyway.
 */
export function gameMatchup(
  rung: Rung,
  lossStreak: number,
  gamesAtRung: number,
  boardSize: BoardSize = 19,
): Matchup {
  const eff = effectiveMatchup(rung, lossStreak, boardSize);
  if (lossStreak >= SAFEGUARD_LOSS_THRESHOLD) return eff;
  if (rung === startingRung(boardSize)) return eff;
  if (gamesAtRung % 2 === 0) return eff; // even game → the base (Black) matchup

  // Odd game → the color-variety alternative. Two kinds:
  //  - symmetric (even) rung: same bot, flip color (komi rides along).
  //  - in-between rung: play White against the next-weaker bot at a
  //    difficulty-matched komi (colorAlt) — switches bot AND color.
  if (isColorSymmetric(rung, boardSize)) {
    return { ...eff, playerColor: eff.playerColor === 'black' ? 'white' : 'black' };
  }
  const alt = colorAltMatchup(rung, boardSize);
  return alt ?? eff;
}

/** The White-side color-variety matchup for an in-between rung, or null if
 *  the rung has none (desert rungs, even rungs, handicap rungs). Built from
 *  the spec's `colorAlt`: you play White against the next-weaker bot. */
function colorAltMatchup(rung: Rung, boardSize: BoardSize): Matchup | null {
  const ladder = ladderFor(boardSize);
  const i = ladder.rungIndex.get(rung);
  if (i === undefined) return null;
  const alt = ladder.specs[i].colorAlt;
  if (!alt) return null;
  return {
    bot: alt.bot,
    playerColor: 'white',
    handicap: 0,
    komi: alt.komi,
    validated: ladder.validatedBots.has(alt.bot),
  };
}

/* ------------------------------------------------------------------------- *
 * Ladder navigation.
 * ------------------------------------------------------------------------- */

/** Returns the rung above this one, or null if at the top of the ladder. */
export function nextRung(rung: Rung, boardSize: BoardSize = 19): Rung | null {
  const ladder = ladderFor(boardSize);
  const i = ladder.rungIndex.get(rung);
  if (i === undefined) throw new Error(`Unknown rung "${rung}" on ${boardSize}×${boardSize}`);
  if (i + 1 >= ladder.rungs.length) return null;
  return ladder.rungs[i + 1];
}

/** True when the rung above the given one uses a calibrated bot. False ⇒ the
 *  player has hit the validation wall (hold instead of promote). */
export function isNextRungValidated(rung: Rung, boardSize: BoardSize = 19): boolean {
  const next = nextRung(rung, boardSize);
  if (!next) return false;
  return matchupForRung(next, boardSize).validated;
}

/** Returns the rung below this one, or null at the bottom of the ladder. */
export function prevRung(rung: Rung, boardSize: BoardSize = 19): Rung | null {
  const ladder = ladderFor(boardSize);
  const i = ladder.rungIndex.get(rung);
  if (i === undefined) throw new Error(`Unknown rung "${rung}" on ${boardSize}×${boardSize}`);
  if (i === 0) return null;
  return ladder.rungs[i - 1];
}

/** True when `rung` sits at or above `marker` on this board's ladder. False
 *  when the ladder has no such marker rank (e.g. a future 13×13 ladder). */
function rungAtOrAbove(rung: Rung, marker: Rung, boardSize: BoardSize): boolean {
  const ladder = ladderFor(boardSize);
  const i = ladder.rungIndex.get(rung);
  if (i === undefined) throw new Error(`Unknown rung "${rung}" on ${boardSize}×${boardSize}`);
  const m = ladder.rungIndex.get(marker);
  return m !== undefined && i >= m;
}

/** Wins required to promote off `rung`: 3 below 12k, 4 from 12k, 5 from 5k.
 *  On both current ladders that's 3 through 13k, 4 for 12k–6k, 5 for 5k–1d. */
export function winsToPromote(rung: Rung, boardSize: BoardSize = 19): number {
  if (rungAtOrAbove(rung, FIVE_WIN_FROM, boardSize)) return 5;
  if (rungAtOrAbove(rung, FOUR_WIN_FROM, boardSize)) return 4;
  return WINS_TO_PROMOTE;
}

/** True when losses at `rung` set promotion progress back one win. */
export function lossSetbackActive(rung: Rung, boardSize: BoardSize = 19): boolean {
  return rungAtOrAbove(rung, FOUR_WIN_FROM, boardSize);
}

/* ------------------------------------------------------------------------- *
 * Rung state + promotion.
 * ------------------------------------------------------------------------- */

/** Per-board-size rung state. */
export interface RungState {
  currentRung: Rung;
  winsAtCurrentRung: number;
  lossStreak: number;
}

export interface ApplyResultOutcome {
  state: RungState;
  /** True when the result triggered a promotion. UI hooks the rank-up
   *  celebration off this. */
  promoted: boolean;
  /** When `promoted` is true, the rung the player was promoted FROM. */
  fromRung: Rung | null;
}

/**
 * Apply a single game result to the rung state. Pure.
 *
 * - Loss: increments `lossStreak`. From `FOUR_WIN_FROM` (12k) upward it also
 *   sets `winsAtCurrentRung` back one (floored at 0) — losses cost progress
 *   but never the rung itself. Below 12k the wins counter is untouched.
 * - Win below threshold (`winsToPromote`): increments wins, resets streak.
 * - Win that hits threshold: promotes to next rung (resets both counters).
 * - Win at validation wall or ladder top: holds at current rung with
 *   `winsAtCurrentRung` pinned at the rung's threshold.
 */
export function applyResult(
  state: RungState,
  result: 'win' | 'loss',
  boardSize: BoardSize = 19,
): ApplyResultOutcome {
  if (result === 'loss') {
    const wins = lossSetbackActive(state.currentRung, boardSize)
      ? Math.max(0, state.winsAtCurrentRung - 1)
      : state.winsAtCurrentRung;
    return {
      state: { ...state, winsAtCurrentRung: wins, lossStreak: state.lossStreak + 1 },
      promoted: false,
      fromRung: null,
    };
  }

  const needed = winsToPromote(state.currentRung, boardSize);
  const newWins = state.winsAtCurrentRung + 1;

  if (newWins < needed) {
    return {
      state: { ...state, winsAtCurrentRung: newWins, lossStreak: 0 },
      promoted: false,
      fromRung: null,
    };
  }

  // Hit promotion threshold. Hold at this rung if the next rung's bot is
  // unvalidated, or if there's no next rung at all.
  const next = nextRung(state.currentRung, boardSize);
  if (!next || !isNextRungValidated(state.currentRung, boardSize)) {
    return {
      state: {
        ...state,
        winsAtCurrentRung: needed,
        lossStreak: 0,
      },
      promoted: false,
      fromRung: null,
    };
  }

  return {
    state: {
      currentRung: next,
      winsAtCurrentRung: 0,
      lossStreak: 0,
    },
    promoted: true,
    fromRung: state.currentRung,
  };
}

/** A fresh rung-state for a brand-new player on a board. */
export function freshState(boardSize: BoardSize = 19): RungState {
  return {
    currentRung: startingRung(boardSize),
    winsAtCurrentRung: 0,
    lossStreak: 0,
  };
}
