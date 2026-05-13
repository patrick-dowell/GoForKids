/**
 * Auto-play matchmaker — feature 22.
 *
 * Linear ladder where each rung is a fixed (bot, handicap) tuple chosen so
 * the matchup's effective strength equals the player's rank. Promotion is
 * deterministic: win 3 games at any rung → next rung. Losses are no-ops.
 *
 * 19×19 only in v1.
 */

/** A rank label on the auto-play ladder, e.g. "30k", "27k", ..., "1d". */
export type Rung = string;

export interface Matchup {
  /** Bot rank label, e.g. "30k", "18k", ..., "1d". */
  bot: string;
  /** Handicap stones the player takes (0 = even). */
  handicap: number;
  /** True when the underlying bot has been calibrated. False rungs are
   *  pending feature 01 and should hold the player at the prior rung
   *  instead of promoting onto them. */
  validated: boolean;
}

/** Bots with a calibrated 19×19 profile. 3k and 1d are still pending —
 *  see `feature_plans/01_bot_ladder.md`. Mirrors the `validated` flags in
 *  `frontend/src/components/Avatar.tsx` for the 19×19 surface. */
const VALIDATED_BOTS = new Set(['30k', '18k', '15k', '12k', '9k', '6k']);

const MATCHUPS: ReadonlyArray<readonly [Rung, string, number]> = [
  ['30k', '30k', 0],
  ['27k', '18k', 9],
  ['26k', '18k', 8],
  ['25k', '18k', 7],
  ['24k', '18k', 6],
  ['23k', '18k', 5],
  ['22k', '18k', 4],
  ['21k', '18k', 3],
  ['20k', '18k', 2],
  ['19k', '18k', 1],
  ['18k', '18k', 0],
  ['17k', '15k', 2],
  ['16k', '15k', 1],
  ['15k', '15k', 0],
  ['14k', '12k', 2],
  ['13k', '12k', 1],
  ['12k', '12k', 0],
  ['11k', '9k',  2],
  ['10k', '9k',  1],
  ['9k',  '9k',  0],
  ['8k',  '6k',  2],
  ['7k',  '6k',  1],
  ['6k',  '6k',  0],
  ['5k',  '3k',  2],
  ['4k',  '3k',  1],
  ['3k',  '3k',  0],
  ['2k',  '1d',  2],
  ['1k',  '1d',  1],
  ['1d',  '1d',  0],
];

/** Ordered list of rungs from weakest (index 0) to strongest (last). */
export const LADDER_RUNGS: ReadonlyArray<Rung> = MATCHUPS.map((m) => m[0]);

const RUNG_INDEX = new Map<Rung, number>(LADDER_RUNGS.map((r, i) => [r, i]));

/** Wins required at any rung to promote. */
export const WINS_TO_PROMOTE = 3;

/** Loss streak that triggers the anti-frustration safeguard. */
export const SAFEGUARD_LOSS_THRESHOLD = 5;

/** Extra handicap stones added when the safeguard is active. */
export const SAFEGUARD_BONUS_STONES = 2;

/** Engine cap on handicap stones for 19×19 (matches `MAX_HANDICAP_BY_SIZE`). */
const MAX_HANDICAP = 9;

/** The starting rung for a new auto-play journey. */
export const STARTING_RUNG: Rung = '30k';

/** Look up the base matchup (no safeguard) for a rung. */
export function matchupForRung(rung: Rung): Matchup {
  const tuple = MATCHUPS.find((m) => m[0] === rung);
  if (!tuple) throw new Error(`Unknown rung: ${rung}`);
  return {
    bot: tuple[1],
    handicap: tuple[2],
    validated: VALIDATED_BOTS.has(tuple[1]),
  };
}

/** Effective matchup for a player given their rung and current loss streak.
 *  Adds +2 stones (capped at MAX_HANDICAP) when the safeguard is active. */
export function effectiveMatchup(rung: Rung, lossStreak: number): Matchup {
  const base = matchupForRung(rung);
  if (lossStreak < SAFEGUARD_LOSS_THRESHOLD) return base;
  const boosted = Math.min(MAX_HANDICAP, base.handicap + SAFEGUARD_BONUS_STONES);
  if (boosted === base.handicap) return base;
  return { ...base, handicap: boosted };
}

/** True when `effectiveMatchup` would return a boosted handicap (i.e. the
 *  safeguard is currently affecting the matchup). */
export function isSafeguardActive(rung: Rung, lossStreak: number): boolean {
  if (lossStreak < SAFEGUARD_LOSS_THRESHOLD) return false;
  return effectiveMatchup(rung, lossStreak).handicap > matchupForRung(rung).handicap;
}

/** Returns the rung above this one, or null if at the top of the ladder. */
export function nextRung(rung: Rung): Rung | null {
  const i = RUNG_INDEX.get(rung);
  if (i === undefined) throw new Error(`Unknown rung: ${rung}`);
  if (i + 1 >= LADDER_RUNGS.length) return null;
  return LADDER_RUNGS[i + 1];
}

/** True when the rung above the given one uses a calibrated bot. False ⇒
 *  the player has hit the validation wall (e.g. 6k → 5k blocked until the
 *  3k bot is calibrated). */
export function isNextRungValidated(rung: Rung): boolean {
  const next = nextRung(rung);
  if (!next) return false;
  return matchupForRung(next).validated;
}

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
 *   `winsAtCurrentRung` pinned at `WINS_TO_PROMOTE` (visual "you've capped
 *   the calibrated ladder" state).
 */
export function applyResult(
  state: RungState,
  result: 'win' | 'loss',
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
  const next = nextRung(state.currentRung);
  if (!next || !isNextRungValidated(state.currentRung)) {
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

/** A fresh rung-state for a brand-new player. */
export function freshState(): RungState {
  return {
    currentRung: STARTING_RUNG,
    winsAtCurrentRung: 0,
    lossStreak: 0,
  };
}
