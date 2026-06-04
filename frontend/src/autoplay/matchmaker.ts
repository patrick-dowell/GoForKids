/**
 * Auto-play matchmaker — feature 22 (19×19) + feature 24 (9×9).
 *
 * A per-board linear ladder where each rung is a fixed matchup chosen so the
 * matchup's effective strength equals the player's rank. Promotion is
 * deterministic: win 3 games at any rung → next rung. Losses are no-ops.
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
 * 9×9 (feature 24) uses this to ramp smoothly across just two bots near the
 * bottom: e.g. 30k bot Black+no-komi (easiest) → … → 30k bot you-White+2
 * stones → hand off to the 15k bot at its easy end (you-Black+2 stones) → …
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
 * 9×9 ladder — feature 24, full 23-rung points-model ramp (Patrick's design,
 * 2026-06-04). Difficulty is one continuous "player advantage in points" axis
 * from bot + color + handicap stones (≥2, ≈7 pts/stone) + komi. Only the six
 * real 9×9 profiles (30k/15k/9k/6k/3k/1d) are ever named as bots.
 *
 * ⚠️ ENGINE DEPENDENCY: rung 12k combines a handicap (2 stones) WITH a custom
 * komi (3.5). The engine forces komi=0.5 whenever handicap>0 (frontend
 * gameStore + localGameRouter, AND backend state.py). Until all three honor an
 * explicit komi, 12k plays at komi 0.5 — collapsing toward 10k. Marked † below.
 *
 * Labels and point values are intuited/playtest-seeded, PENDING further
 * validation. "Play black or white" rungs (even, 6.5 komi) default to Black.
 * Top rung is 1d; clearing it = the "2 dan" graduation (no 2d bot to calibrate).
 */
const SPECS_9: ReadonlyArray<RungSpec> = [
  // 30k bot
  { rung: '30k', bot: '30k', playerColor: 'black', handicap: 0, komi: 0 },              // no komi
  { rung: '28k', bot: '30k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },      // 6.5 komi
  { rung: '25k', bot: '30k', playerColor: 'white', handicap: 2 },                       // White, bot +2 stones
  // 15k bot
  { rung: '23k', bot: '15k', playerColor: 'black', handicap: 4 },                       // you +4 stones
  { rung: '21k', bot: '15k', playerColor: 'black', handicap: 3 },                       // you +3 stones
  { rung: '19k', bot: '15k', playerColor: 'black', handicap: 2 },                       // you +2 stones
  { rung: '17k', bot: '15k', playerColor: 'black', handicap: 0, komi: 0 },              // no komi
  { rung: '15k', bot: '15k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },      // even
  { rung: '14k', bot: '15k', playerColor: 'white', handicap: 0, komi: KOMI_HALF },      // White, 3.5 komi
  // 9k bot
  { rung: '13k', bot: '9k', playerColor: 'black', handicap: 2 },                        // you +2 stones
  { rung: '12k', bot: '9k', playerColor: 'black', handicap: 2, komi: KOMI_HALF },       // † you +2 + 3.5 komi
  { rung: '11k', bot: '9k', playerColor: 'black', handicap: 0, komi: 0 },               // no komi
  { rung: '10k', bot: '9k', playerColor: 'black', handicap: 0, komi: KOMI_HALF },       // 3.5 komi
  { rung: '9k', bot: '9k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even
  // 6k bot
  { rung: '8k', bot: '6k', playerColor: 'black', handicap: 0, komi: 0 },                // no komi
  { rung: '7k', bot: '6k', playerColor: 'black', handicap: 0, komi: KOMI_HALF },        // 3.5 komi
  { rung: '6k', bot: '6k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even
  // 3k bot
  { rung: '5k', bot: '3k', playerColor: 'black', handicap: 0, komi: 0 },                // no komi
  { rung: '4k', bot: '3k', playerColor: 'black', handicap: 0, komi: KOMI_HALF },        // 3.5 komi
  { rung: '3k', bot: '3k', playerColor: 'black', handicap: 0, komi: KOMI_EVEN },        // even
  // 1d bot
  { rung: '2k', bot: '1d', playerColor: 'black', handicap: 0, komi: 0 },                // no komi
  { rung: '1k', bot: '1d', playerColor: 'black', handicap: 0, komi: KOMI_HALF },        // 3.5 komi
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
    // The six bots with real 9×9 profiles in b28.yaml.
    validatedBots: new Set(['30k', '15k', '9k', '6k', '3k', '1d']),
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

/** Wins required at any rung to promote. */
export const WINS_TO_PROMOTE = 3;

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
 * - Loss: increments `lossStreak`. Wins counter unchanged.
 * - Win below threshold: increments `winsAtCurrentRung`, resets `lossStreak`.
 * - Win that hits threshold: promotes to next rung (resets both counters).
 * - Win at validation wall or ladder top: holds at current rung with
 *   `winsAtCurrentRung` pinned at `WINS_TO_PROMOTE`.
 */
export function applyResult(
  state: RungState,
  result: 'win' | 'loss',
  boardSize: BoardSize = 19,
): ApplyResultOutcome {
  if (result === 'loss') {
    return {
      state: { ...state, lossStreak: state.lossStreak + 1 },
      promoted: false,
      fromRung: null,
    };
  }

  const newWins = state.winsAtCurrentRung + 1;

  if (newWins < WINS_TO_PROMOTE) {
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
        winsAtCurrentRung: WINS_TO_PROMOTE,
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
