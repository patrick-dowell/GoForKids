/**
 * Auto-play matchmaker — feature 22 (19×19) + feature 24 (9×9 hybrid).
 *
 * A per-board linear ladder where each rung is a fixed matchup chosen so the
 * matchup's effective strength equals the player's rank. Promotion is
 * deterministic: win 3 games at any rung → next rung. Losses are no-ops.
 *
 * Handicap mechanism is board-dependent (feature 24 finding):
 *   - 19×19: stones. One stone ≈ 1 rank — smooth.
 *   - 9×9 weak end (30k–6k): stones. Komi is INERT for low-visit bots
 *     (30k/6k komi sweeps were flat), so the profiles themselves are the
 *     rungs; stones are the handicap + anti-frustration dimension.
 *   - 9×9 strong end (3k–1d): komi. High-visit bots respond cleanly to komi
 *     (the 1d sweep is a clean sigmoid, ~5–7 komi ≈ 1 rank), so komi gives
 *     fine-grained sub-rungs the chunky 9×9 stone (≈2–3 ranks/stone) cannot.
 *
 * `Matchup` carries a `kind` tag + always-present `handicap` and an optional
 * `komi`. The always-present `handicap` keeps existing 19×19 consumers (which
 * read `.handicap`) working unchanged; komi rungs report `handicap: 0`.
 */

/** A rank label on the auto-play ladder, e.g. "30k", "27k", ..., "1d". */
export type Rung = string;

/** Board sizes with an auto-play ladder. 13×13 is not yet calibrated. */
export type BoardSize = 9 | 13 | 19;

export interface Matchup {
  /** Which handicap mechanism this rung uses. */
  kind: 'stones' | 'komi';
  /** Bot rank label, e.g. "30k", "18k", ..., "1d". */
  bot: string;
  /** Handicap stones the player takes (0 = even). Always present; 0 for komi
   *  rungs so existing 19×19 consumers can keep reading `.handicap`. */
  handicap: number;
  /** Komi (added to White's score; LOWER ⇒ Black/player advantage). Only
   *  meaningful when `kind === 'komi'`; undefined for stones rungs. */
  komi?: number;
  /** True when the underlying bot has a calibrated profile on this board.
   *  False rungs hold the player at the prior rung instead of promoting. */
  validated: boolean;
}

/* ------------------------------------------------------------------------- *
 * Rung specs — internal table format, one per board.
 * ------------------------------------------------------------------------- */

type StonesSpec = readonly [rung: Rung, bot: string, kind: 'stones', handicap: number];
type KomiSpec = readonly [rung: Rung, bot: string, kind: 'komi', komi: number];
type RungSpec = StonesSpec | KomiSpec;

/** 19×19 ladder — stones throughout (feature 22). */
const SPECS_19: ReadonlyArray<RungSpec> = [
  ['30k', '30k', 'stones', 0],
  ['27k', '18k', 'stones', 9],
  ['26k', '18k', 'stones', 8],
  ['25k', '18k', 'stones', 7],
  ['24k', '18k', 'stones', 6],
  ['23k', '18k', 'stones', 5],
  ['22k', '18k', 'stones', 4],
  ['21k', '18k', 'stones', 3],
  ['20k', '18k', 'stones', 2],
  ['19k', '18k', 'stones', 1],
  ['18k', '18k', 'stones', 0],
  ['17k', '15k', 'stones', 2],
  ['16k', '15k', 'stones', 1],
  ['15k', '15k', 'stones', 0],
  ['14k', '12k', 'stones', 2],
  ['13k', '12k', 'stones', 1],
  ['12k', '12k', 'stones', 0],
  ['11k', '9k', 'stones', 2],
  ['10k', '9k', 'stones', 1],
  ['9k', '9k', 'stones', 0],
  ['8k', '6k', 'stones', 2],
  ['7k', '6k', 'stones', 1],
  ['6k', '6k', 'stones', 0],
  ['5k', '3k', 'stones', 2],
  ['4k', '3k', 'stones', 1],
  ['3k', '3k', 'stones', 0],
  ['2k', '1d', 'stones', 2],
  ['1k', '1d', 'stones', 1],
  ['1d', '1d', 'stones', 0],
];

/**
 * 9×9 hybrid ladder — feature 24. FIRST CUT.
 *
 * IMPORTANT: only SIX bots have calibrated 9×9 profiles in b28.yaml —
 * 30k, 15k, 9k, 6k, 3k, 1d. 18k and 12k are deliberately NOT 9×9 profiles
 * (the backend `get_profile` would silently fall back to their 19×19
 * profiles). Per the b28.yaml design note, the 18k/12k *rungs* are bridged:
 *   - 18k rung = 15k bot + komi (player head start)
 *   - 12k rung = 6k bot + handicap stones
 * Every rung below therefore names a bot that has a real 9×9 profile.
 *
 * Mechanism follows the visit-count finding (komi responds only at high
 * visits): stones bridge the low-visit bots (30k/15k/6k), komi bridges the
 * high-visit bots (1d). The 1d komi values are grounded in the Phase 1 sweep
 * (komi 7/4/1 ≈ Black 40%/58%/78%; standard 9×9 komi ≈ 7).
 *
 * Bridge values (the komi/stone amounts on 18k, 12k, 1k) are FIRST CUT
 * pending the Phase 3 bridging tests — see feature_plans/24_9x9_ladder.md.
 * Known rough spot: 9k → 6k is a noisy cliff (6k won 57–97% across runs).
 */
const SPECS_9: ReadonlyArray<RungSpec> = [
  ['30k', '30k', 'stones', 0], // real 30k profile, even
  ['18k', '15k', 'komi', 2],   // bridge: 15k bot, player ~+5 head start (FIRST CUT)
  ['15k', '15k', 'stones', 0], // real 15k profile, even
  ['12k', '6k', 'stones', 2],  // bridge: 6k bot, player takes 2 stones (FIRST CUT, per b28 note)
  ['9k', '9k', 'stones', 0],   // real 9k profile, even
  ['6k', '6k', 'stones', 0],   // real 6k profile, even
  ['3k', '3k', 'stones', 0],   // real 3k profile, even
  ['1k', '1d', 'komi', 4],     // bridge: 1d bot, player ~+3 head start (FIRST CUT)
  ['1d', '1d', 'stones', 0],   // real 1d profile, even — top of ladder
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
  /** Stones added by the anti-frustration safeguard (stones rungs). */
  safeguardBonusStones: number;
  /** Komi points shifted toward Black by the safeguard (komi rungs). ~1 rank. */
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
  const rungs = specs.map((s) => s[0]);
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
    // The six bots with real 9×9 profiles in b28.yaml (validated 2026-05-19).
    // 18k/12k are NOT here — their rungs bridge off 15k/6k (see SPECS_9).
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
  if (spec[2] === 'stones') {
    return { kind: 'stones', bot: spec[1], handicap: spec[3], validated: ladder.validatedBots.has(spec[1]) };
  }
  return { kind: 'komi', bot: spec[1], handicap: 0, komi: spec[3], validated: ladder.validatedBots.has(spec[1]) };
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
export const LADDER_RUNGS: ReadonlyArray<Rung> = SPECS_19.map((s) => s[0]);

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
  const spec = ladder.specs.find((s) => s[0] === rung);
  if (!spec) throw new Error(`Unknown rung "${rung}" on ${boardSize}×${boardSize}`);
  return specToMatchup(spec, ladder);
}

/** Effective matchup for a player given their rung and current loss streak.
 *  Safeguard: +stones (stones rungs, capped at the board's MAX_HANDICAP) or
 *  −komi (komi rungs — lower komi shifts the score toward Black/the player). */
export function effectiveMatchup(rung: Rung, lossStreak: number, boardSize: BoardSize = 19): Matchup {
  const ladder = ladderFor(boardSize);
  const base = matchupForRung(rung, boardSize);
  if (lossStreak < SAFEGUARD_LOSS_THRESHOLD) return base;

  if (base.kind === 'stones') {
    const boosted = Math.min(ladder.maxHandicap, base.handicap + ladder.safeguardBonusStones);
    if (boosted === base.handicap) return base;
    return { ...base, handicap: boosted };
  }
  // komi rung: lower komi ⇒ more player (Black) advantage.
  return { ...base, komi: (base.komi ?? 0) - ladder.safeguardBonusKomi };
}

/** True when `effectiveMatchup` would differ from the base matchup (i.e. the
 *  safeguard is currently affecting the matchup). */
export function isSafeguardActive(rung: Rung, lossStreak: number, boardSize: BoardSize = 19): boolean {
  if (lossStreak < SAFEGUARD_LOSS_THRESHOLD) return false;
  const base = matchupForRung(rung, boardSize);
  const eff = effectiveMatchup(rung, lossStreak, boardSize);
  if (base.kind === 'stones') return eff.handicap > base.handicap;
  return (eff.komi ?? 0) < (base.komi ?? 0);
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
