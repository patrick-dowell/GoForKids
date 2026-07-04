/**
 * Rank-calibrated AI move selection — TypeScript port of
 * backend/app/ai/move_selector.py.
 *
 * The Python file is the source of truth during the iPad rollout. Behavior
 * here is intended to match it heuristic-by-heuristic so the b28 profiles
 * in data/profiles/b28.yaml produce equivalent strength on iPad as the
 * calibration runs predicted. Once iPad smoke-testing confirms parity, the
 * Python becomes redundant on the iPad path (Render still uses it for now).
 *
 * The selector is given a `PositionAnalysis` from KataGo (via the iPad
 * bridge) — it does NOT call KataGo itself. That keeps the selector pure-
 * synchronous logic with one async escape hatch: if we discover we need a
 * fresh analysis after an eye-fill rejection, the caller can re-invoke us.
 */

import {
  Color,
  MoveResult,
  type Stone,
  type Point,
  isValidPoint,
  neighbors,
} from '../engine/types';
import { Board } from '../engine/Board';
import { getProfile, type RankProfile } from './profileLoader';
import { recordSelectorLog } from './selectorLog';

/** Single candidate from KataGo analysis — mirrors the Python MoveCandidate. */
export interface MoveCandidate {
  /** (row, col), or (-1, -1) for pass. */
  move: { row: number; col: number };
  visits: number;
  winrate: number;
  scoreLead: number;
  prior: number;
  /** Order in KataGo's preference list (0 = best). Redundant with array
   *  position but useful for diagnostics. */
  order: number;
}

/** PositionAnalysis — mirrors the Python PositionAnalysis. */
export interface PositionAnalysis {
  rootVisits: number;
  candidates: MoveCandidate[];
}

/** A null result here means "pass" (the Python returns None for both pass
 *  and "couldn't pick a move" — same semantics, callers commit a pass). */
export type SelectionResult = Point | null;

// --- Utilities ---------------------------------------------------------------

/** Distance from the nearest board edge. */
export function edgeDistance(row: number, col: number, size: number): number {
  return Math.min(row, col, size - 1 - row, size - 1 - col);
}

/** True if playing `point` would fill a friendly eye. Mirrors _is_eye_fill. */
export function isEyeFill(board: Board, color: Stone, point: Point): boolean {
  if (board.get(point) !== Color.Empty) return false;
  const size = board.size;

  // All orthogonal neighbors must be our color (or off-board).
  for (const nb of neighbors(point, size)) {
    if (board.get(nb) !== color) return false;
  }

  // Diagonals: at least 3 of 4 (or all on-board diagonals) must be friendly.
  // Edge counts as friendly.
  const diagonals = [
    { row: point.row - 1, col: point.col - 1 },
    { row: point.row - 1, col: point.col + 1 },
    { row: point.row + 1, col: point.col - 1 },
    { row: point.row + 1, col: point.col + 1 },
  ];
  let friendly = 0;
  let total = 0;
  for (const d of diagonals) {
    if (isValidPoint(d, size)) {
      total += 1;
      if (board.get(d) === color) friendly += 1;
    } else {
      friendly += 1;
    }
  }
  if (total === 0) return true;
  return friendly >= Math.max(total - 1, 1);
}

/** Find legal moves within `radius` of `center`. */
function getNearbyMoves(board: Board, color: Stone, center: Point, radius = 3): Point[] {
  const size = board.size;
  const moves: Point[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const r = center.row + dr;
      const c = center.col + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const p: Point = { row: r, col: c };
      const test = board.clone();
      const { result } = test.tryPlay(color, p);
      if (result === MoveResult.Ok) moves.push(p);
    }
  }
  return moves;
}

/** Pick a legal move at random, weighted by edge distance (prefer 3rd/4th
 *  line). Mirrors the Python _pick_random_legal weights. */
function pickRandomLegal(board: Board, color: Stone): Point | null {
  const size = board.size;
  const moves: Point[] = [];
  const weights: number[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const p: Point = { row, col };
      const test = board.clone();
      const { result } = test.tryPlay(color, p);
      if (result !== MoveResult.Ok) continue;
      moves.push(p);
      const ed = edgeDistance(row, col, size);
      if (ed === 2 || ed === 3) weights.push(2.5);
      else if (ed === 4 || ed === 5) weights.push(1.5);
      else if (ed === 1) weights.push(0.8);
      else if (ed === 0) weights.push(0.2);
      else weights.push(1.0);
    }
  }
  if (moves.length === 0) return null;
  return weightedChoice(moves, weights);
}

/** Random.choices(...) port: weighted single pick. */
function weightedChoice<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Total stones on the board — proxy for move number. */
function countStones(board: Board): number {
  let n = 0;
  for (const c of board.grid) if (c !== Color.Empty) n++;
  return n;
}

/** Build a Board instance from the backend's `number[][]` grid (0/1/2).
 *
 *  A grid-only board has NO move history, so its superko check is blind —
 *  pass `koBan` (from the server's `ko_point`, banning the side to move)
 *  or every heuristic branch in this file will happily propose the ko
 *  recapture the real engine then rejects (888P9NXK, 2026-07-03). */
export function boardFromGrid(
  grid: number[][],
  size: number,
  koBan?: { point: Point; color: Stone } | null,
): Board {
  const b = new Board(size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = grid[r][c];
      if (v !== 0) b.grid[r * size + c] = v as Color;
    }
  }
  b.koBan = koBan ?? null;
  return b;
}

// --- Main selection entry ----------------------------------------------------

/**
 * Top-level entry. Calls `analyze` to get KataGo candidates (skipped for
 * 30k pure-heuristic profile). Includes a 5-attempt eye-fill safety check.
 *
 * Returns `null` for pass.
 */
/** Optional tweaks to selectAiMove's behavior — currently just one flag for
 *  tutorial games where we want the bot to keep playing instead of declaring
 *  the game over (small 5×5/9×9 boards in lessons settle very quickly to a
 *  pass-pass termination at full strength, which surprises kid players). */
export interface SelectAiMoveOptions {
  /** When true, the selector never returns null (pass). If KataGo's
   *  preferred move is pass, fall back to the best legal non-pass
   *  candidate. Used by the lesson-context game flow. */
  neverPass?: boolean;
  /** When true, the opponent just passed: settle the game cleanly — analyze
   *  at SETTLE_VISITS and play KataGo's honest top move (or pass) WITHOUT
   *  mistake injection, so the bot passes at a settled position instead of
   *  filling its own territory. Mirrors the backend's `opponent_passed`. */
  opponentPassed?: boolean;
}

/** Deep visit count for "settle cleanly" moves after the opponent passes.
 *  Low-visit rank profiles never search `pass` enough to trust it; a deep
 *  search lets KataGo surface pass at a settled position. Matches the
 *  Python `SETTLE_VISITS`. */
const SETTLE_VISITS = 100;

export async function selectAiMove(
  board: Board,
  color: Stone,
  targetRank: string,
  lastOpponentMove: Point | null,
  analyze: (visits: number) => Promise<PositionAnalysis>,
  options: SelectAiMoveOptions = {},
): Promise<SelectionResult> {
  const move = await selectAiMoveInner(board, color, targetRank, lastOpponentMove, analyze, options);

  // Eye-fill safety check — never fill our own eye.
  if (move && isEyeFill(board, color, move)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const alt = await selectAiMoveInner(board, color, targetRank, lastOpponentMove, analyze, options);
      if (alt && !isEyeFill(board, color, alt)) return alt;
    }
    // 5 attempts all filled eyes. In neverPass mode the user explicitly
    // prefers a bad move (eye-fill) over the bot quitting, so return the
    // last attempted move instead of passing. Outside neverPass, passing
    // is the right call — filling your own eye kills the group.
    if (options.neverPass) return move;
    // This return used to be the one pass path with no log line — a field
    // repro couldn't distinguish it from the commit-rejection passes.
    logPass('eye-fill-retries-exhausted');
    return null;
  }

  return move;
}

async function selectAiMoveInner(
  board: Board,
  color: Stone,
  targetRank: string,
  lastOpponentMove: Point | null,
  analyze: (visits: number) => Promise<PositionAnalysis>,
  options: SelectAiMoveOptions = {},
): Promise<SelectionResult> {
  const profile = getProfile(targetRank, board.size);

  // 30k bot: pure heuristic, no KataGo at all.
  if (profile.use_katago === false) {
    return selectBeginnerMove(board, color, profile);
  }

  try {
    // Opponent passed → settle cleanly: deeper search so pass surfaces, and
    // selectWithKataGo skips mistake injection (see options.opponentPassed there).
    const visits = options.opponentPassed ? Math.max(profile.visits, SETTLE_VISITS) : profile.visits;
    const analysis = await analyze(visits);
    return selectWithKataGo(board, color, profile, analysis, lastOpponentMove, options);
  } catch {
    // KataGo unreachable — fall back to a random legal move so the game
    // doesn't lock up. Same behavior as the Python's except-clause.
    return pickRandomLegal(board, color);
  }
}

// --- 30k pure-heuristic path -------------------------------------------------

/**
 * Plays random legal moves with basic survival instincts. Priorities (each
 * gated on a probability from the profile so the bot is messy):
 *   1. Save own group in atari
 *   2. Capture opponent group in atari
 *   3. Local response near a recent stone
 *   4. Random legal move (preferring 3rd/4th line)
 */
function selectBeginnerMove(board: Board, color: Stone, profile: RankProfile): SelectionResult {
  const opponent = color === Color.Black ? Color.White : Color.Black;
  const size = board.size;

  // 1. Save own atari groups.
  if (Math.random() < (profile.save_atari_chance ?? 0.5)) {
    const ownAtari = board.getAtariGroups().filter((g) => g.color === color);
    if (ownAtari.length > 0) {
      const group = ownAtari[Math.floor(Math.random() * ownAtari.length)];
      const test = board.clone();
      const { result } = test.tryPlay(color, group.liberty);
      if (result === MoveResult.Ok) return group.liberty;
    }
  }

  // 2. Capture opponent atari groups.
  if (Math.random() < (profile.capture_chance ?? 0.4)) {
    const oppAtari = board.getAtariGroups().filter((g) => g.color === opponent);
    if (oppAtari.length > 0) {
      const group = oppAtari[Math.floor(Math.random() * oppAtari.length)];
      const test = board.clone();
      const { result } = test.tryPlay(color, group.liberty);
      if (result === MoveResult.Ok) return group.liberty;
    }
  }

  // 3. Local response near an existing stone.
  if (Math.random() < profile.local_bias) {
    const occupied: Point[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board.get({ row: r, col: c }) !== Color.Empty) occupied.push({ row: r, col: c });
      }
    }
    if (occupied.length > 0) {
      const recent = occupied.length > 8 ? occupied.slice(-8) : occupied;
      const anchor = recent[Math.floor(Math.random() * recent.length)];
      const nearby = getNearbyMoves(board, color, anchor, 2);
      if (nearby.length > 0) return nearby[Math.floor(Math.random() * nearby.length)];
    }
  }

  // 4. Random legal move (avoid eyes).
  for (let i = 0; i < 10; i++) {
    const m = pickRandomLegal(board, color);
    if (m && !isEyeFill(board, color, m)) return m;
  }
  return pickRandomLegal(board, color);
}

// --- KataGo-backed path ------------------------------------------------------

/** Diagnostic: log WHY the bot passed, so device repros are self-explaining —
 *  a positional-superko filter (`filtered-empty-*`) vs KataGo choosing pass
 *  (`katago-*`) vs the settle pass-threshold (`pass-threshold`). Plain
 *  console.log so it surfaces in the iOS bridge / Xcode console. */
function logPass(reason: string): void {
  const line = `[selector] PASS reason=${reason}`;
  console.log(line);
  recordSelectorLog(line);
}

/** A legal move that doesn't fill our own eye — the safety fallback for when
 *  EVERY KataGo candidate was filtered illegal. The usual cause is a ko-rule
 *  mismatch: KataGo runs simple ko under `japanese` rules and offers a move our
 *  positional-superko engine rejects as a whole-board repeat. Returns null only
 *  when the board's legal moves are all own-eye fills (or there are none) — then
 *  passing is genuinely correct.
 *
 *  `exclude` skips specific points — the commit-rejection retry in client.ts
 *  uses it so a pick the game engine already refused isn't offered again. */
export function pickLegalNonEyeMove(
  board: Board,
  color: Stone,
  exclude: Point[] = [],
): Point | null {
  const excluded = (m: Point) =>
    exclude.some((p) => p.row === m.row && p.col === m.col);
  for (let i = 0; i < 16; i++) {
    const m = pickRandomLegal(board, color);
    if (m && !excluded(m) && !isEyeFill(board, color, m)) return m;
  }
  return null;
}

function selectWithKataGo(
  board: Board,
  color: Stone,
  profile: RankProfile,
  analysisIn: PositionAnalysis,
  lastOpponentMove: Point | null,
  options: SelectAiMoveOptions = {},
): SelectionResult {
  const stoneCount = countStones(board);
  const isOpening = stoneCount < profile.opening_moves;

  // Filter illegal candidates (e.g. ko recaptures KataGo doesn't know about).
  // Pass candidate (move.row < 0) is always kept.
  const isLegal = (c: MoveCandidate): boolean => {
    if (c.move.row < 0) return true;
    const test = board.clone();
    const { result } = test.tryPlay(color, { row: c.move.row, col: c.move.col });
    return result === MoveResult.Ok;
  };

  let candidates = analysisIn.candidates.filter(isLegal);
  if (candidates.length === 0) {
    // Every move KataGo offered is illegal in our engine — usually a ko-rule
    // mismatch (KataGo = simple ko under japanese; our engine = positional
    // superko), so KataGo's pick repeats a past board position. Passing here
    // throws away a live game (confirmed 2026-06-26, 9×9 vs Ember 6k). Play a
    // legal heuristic move instead; only pass if nothing legal remains.
    const fallback = pickLegalNonEyeMove(board, color);
    if (fallback) {
      const line = '[selector] all KataGo candidates illegal (likely superko) — playing legal fallback instead of passing';
      console.log(line);
      recordSelectorLog(line);
      return fallback;
    }
    logPass('filtered-empty-no-legal-move');
    return null;
  }

  // --- Pass detection ---
  // In tutorial mode (`options.neverPass`), both "KataGo wants to pass" and
  // "best move barely beats pass" fall through to the best legal non-pass
  // candidate. On tiny 5x5/9x9 tutorial boards the position settles fast
  // and the bot would otherwise quit the game before the kid is ready.
  let best = candidates[0];
  if (best.move.row < 0 && (!isOpening || options.neverPass)) {
    // KataGo's top is pass — either we'd normally pass (post-opening) OR
    // we explicitly forbid passing. Look for the best non-pass candidate.
    const nonPassBest = candidates.find((c) => c.move.row >= 0);
    if (!nonPassBest) {
      // No legal non-pass in KataGo's analysis (rare — usually means the
      // search was so narrow it only visited pass). In neverPass mode try
      // a random legal move ourselves before giving up; this catches the
      // 5x5 case where KataGo's 8-visit search converged on pass alone.
      if (options.neverPass) {
        const fallback = pickRandomLegal(board, color);
        if (fallback) return fallback;
      }
      logPass('katago-only-pass-no-nonpass');
      return null;
    }
    best = nonPassBest;
  }
  if (best.move.row < 0 && isOpening) {
    // Top is pass during opening — skip pass and use best non-pass.
    const nonPassBest = candidates.find((c) => c.move.row >= 0);
    if (!nonPassBest) { logPass('opening-only-pass'); return null; }
    best = nonPassBest;
  }

  const passThreshold = profile.pass_threshold ?? 0.3;
  const passCand = candidates.find((c) => c.move.row < 0) ?? null;
  // Match Python: pass needs at least max(4, best.visits/10) visits before
  // we trust its score estimate. Below that, score_lead is just the value-
  // network prior with no search refinement.
  const minPassVisits = Math.max(4, Math.floor(best.visits / 10));
  if (
    !isOpening &&
    !options.neverPass &&
    passCand !== null &&
    passCand.visits >= minPassVisits &&
    best.scoreLead - passCand.scoreLead < passThreshold
  ) {
    logPass('pass-threshold');
    return null;
  }

  // Opponent passed and a real move still beats passing (handled above): play
  // KataGo's honest top move WITHOUT mistake injection — a mistake here is
  // exactly what fills own territory at game's end.
  if (options.opponentPassed) {
    return best.move;
  }

  // --- Tactical clarity gate ---
  // If KataGo is overwhelmingly confident, skip mistake injection.
  const clarityPrior = profile.clarity_prior ?? 0.5;
  const clarityScoreGap = profile.clarity_score_gap ?? 5.0;
  if (best.prior >= clarityPrior) {
    return { row: best.move.row, col: best.move.col };
  }
  const nonPass = candidates.filter((c) => c.move.row >= 0);
  if (
    nonPass.length >= 2 &&
    nonPass[0].scoreLead - nonPass[1].scoreLead >= clarityScoreGap
  ) {
    return { row: nonPass[0].move.row, col: nonPass[0].move.col };
  }

  // --- OPENING: top-3 weighted by visits ---
  if (isOpening) {
    const top3 = candidates.slice(0, 3).filter((c) => c.move.row >= 0);
    if (top3.length > 0) {
      const w = top3.map((c) => Math.max(c.visits, 1));
      const sel = weightedChoice(top3, w);
      return { row: sel.move.row, col: sel.move.col };
    }
  }

  // --- Random move injection ---
  if (Math.random() < profile.random_move_chance) {
    const rand = pickRandomLegal(board, color);
    if (rand) return rand;
  }

  // --- Local bias ---
  // Profiles can opt into local_bias-during-opening with `local_bias_in_opening`.
  const localBiasActive =
    Math.random() < profile.local_bias &&
    (!isOpening || profile.local_bias_in_opening === true);
  if (localBiasActive) {
    const sz = board.size;
    let anchor: Point | null = null;
    if (lastOpponentMove && isValidPoint(lastOpponentMove, sz)) {
      anchor = lastOpponentMove;
    } else {
      const occupied: Point[] = [];
      for (let r = 0; r < sz; r++) {
        for (let c = 0; c < sz; c++) {
          if (board.get({ row: r, col: c }) !== Color.Empty) occupied.push({ row: r, col: c });
        }
      }
      if (occupied.length > 0) {
        const recent = occupied.length > 10 ? occupied.slice(-10) : occupied;
        anchor = recent[Math.floor(Math.random() * recent.length)];
      }
    }
    if (anchor) {
      const nearby = getNearbyMoves(board, color, anchor, 2);
      if (nearby.length > 0) return nearby[Math.floor(Math.random() * nearby.length)];
    }
  }

  // --- KataGo candidate selection with rank-based mistake injection ---
  const bestScore = candidates[0].scoreLead;

  // Filter to candidates within max_point_loss of the best.
  type Filtered = { c: MoveCandidate; pointLoss: number };
  let filtered: Filtered[] = [];
  for (const c of candidates.slice(0, profile.min_candidates + 5)) {
    if (c.move.row < 0) continue;
    const pointLoss = Math.abs(bestScore - c.scoreLead);
    if (pointLoss <= profile.max_point_loss) filtered.push({ c, pointLoss });
  }

  // Drop candidates strictly worse than passing (when pass has enough
  // visits to trust). Prevents endgame moves that fill own territory.
  //
  // Skip this filter entirely in neverPass mode. On small tutorial
  // boards (5x5) at low visit counts (~6) KataGo's scoreLead estimates
  // are noisy — any tighter threshold ends up dropping every non-pass
  // candidate and the bot quits despite being told not to. The
  // wrapping `selectAiMove` still rejects literal eye-fills via
  // `isEyeFill` (5 retries before giving up), and beyond eyes a 30k
  // bot playing "slightly suboptimal" closing moves is fine — the
  // user's priority is "bot keeps playing while the kid is playing,"
  // not "bot plays optimal endgame."
  if (!options.neverPass && passCand !== null && passCand.visits >= minPassVisits) {
    filtered = filtered.filter((f) => f.c.scoreLead >= passCand!.scoreLead - passThreshold);
  }

  if (filtered.length === 0) {
    // No non-pass candidate survived the max-point-loss filter, or KataGo
    // only returned pass.
    const c = candidates[0];
    if (c.move.row >= 0) return { row: c.move.row, col: c.move.col };
    // Top is pass. In neverPass mode try harder before giving up:
    // search the WHOLE candidate list for any non-pass, then fall back
    // to a random legal move on the board. Only return null (pass) if
    // there's literally nothing to play.
    if (options.neverPass) {
      const anyNonPass = candidates.find((cand) => cand.move.row >= 0);
      if (anyNonPass) return { row: anyNonPass.move.row, col: anyNonPass.move.col };
      const fallback = pickRandomLegal(board, color);
      if (fallback) return fallback;
    }
    logPass('katago-top-pass');
    return null;
  }

  // Build selection weights.
  const weights = filtered.map(({ c, pointLoss }) => {
    const policyW = Math.max(c.prior, 0.001) ** profile.policy_weight;

    let mistakeW: number;
    if (Math.random() < profile.mistake_freq) {
      // Mistake mode: prefer moderately-bad moves over the best one.
      if (pointLoss > 0) {
        const sweet = profile.max_point_loss * 0.35;
        mistakeW = Math.exp(-((pointLoss - sweet) ** 2) / (2 * sweet ** 2));
      } else {
        mistakeW = 0.3;
      }
    } else {
      mistakeW = Math.exp(-pointLoss * 0.8);
    }

    const jitter = 0.3 + 0.7 * Math.random() ** (1 - profile.randomness);
    return policyW * mistakeW * jitter;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  const selected =
    total === 0 ? filtered[0].c : weightedChoice(filtered.map((f) => f.c), weights);
  return { row: selected.move.row, col: selected.move.col };
}
