/**
 * Human SL move selection — TypeScript port of the server's
 * `_select_with_human_net` (backend/app/ai/move_selector.py), which is the
 * spec. Not called by the app yet: the iPad bridge returns no human policy,
 * so wiring this in is a later bridge job.
 *
 * A profile with `human_sl_profile` takes its moves from KataGo's human SL
 * network: its prediction of what players of that rank play. Per move:
 *   1. one evaluation with the profile set -> the human policy for every
 *      point; moves that put the bot's own group in atari without capturing,
 *      and fills of its own single-point eyes, are left out while anything
 *      else is on offer;
 *   2. in the opening (fewer than `human_tilt_from` moves played, and the
 *      opponent has not passed): sample by human probability;
 *   3. otherwise the candidates are the human net's moves at `human_cand_min`
 *      or more (at most `human_cand_max`); the main net scores the position
 *      after each, and after a pass (`human_score_visits` each);
 *        - if no candidate beats passing by `human_pass_margin` points, pass;
 *        - if the best gain is under `human_small_gain`, the best candidate
 *          and a pass are read again at `human_confirm_visits`, and the bot
 *          plays that candidate straight if it still gains
 *          `human_confirm_margin`, else passes;
 *        - candidates losing more than `human_loss_cap` against the best are
 *          dropped;
 *        - the sample leans toward the candidates that lose more:
 *          weight = p * exp(loss / human_tilt).
 *   A negative `human_tilt` gets the same scoring, pass check, second look
 *   and loss cap, but the lean runs the other way, toward the candidates that
 *   lose less: the weight falls as the loss grows (no 15-point cap; the
 *   exponent is never positive, so it cannot overflow). With a tilt of 0, or
 *   none, the candidates are scored only after the opponent's pass; otherwise
 *   the move is sampled by human probability as in step 2. Scoring with no
 *   lean at all is human_tilt: .inf (or -.inf), where exp(loss / tilt) = 1.
 * The bot also passes when the main net's raw policy puts more than half its
 * weight on pass.
 *
 * Where this differs from the Python, and why:
 *  - The engine is bound to one position (the game's moves, the handicap
 *    setup, the side to move) by whoever builds it, so its two calls take
 *    only what varies; moves go over as points, not GTP strings, and there is
 *    no query priority (a server-side queue concern).
 *  - `movesPlayed` is the Python's `len(engine_moves)`: handicap stones not
 *    counted. The app's bridge move list puts them first as Black moves; see
 *    movesPlayedExcludingHandicap.
 *  - Randomness comes from an injected `rng`, used the way Python's
 *    random.choices uses random().
 *  - The server's time budget and its routing (`_select_ai_move_inner`) stay
 *    with the caller.
 */

import { Color, MoveResult, type Point, type Stone } from '../engine/types';
import type { Board } from '../engine/Board';
import { isEyeFill, type MoveCandidate } from './moveSelector';
import type { RankProfile } from './profileLoader';

/** The engine's answer for the position itself, read with the human profile
 *  set (the Python's analyze with humanSLProfile and include_policy). */
export interface HumanPolicyAnswer {
  /** The human net's policy: every point row-major from the top-left, pass
   *  last (size² + 1 values); illegal points are negative. Missing when the
   *  engine has no human model. */
  humanPolicy: number[] | null | undefined;
  /** The main net's raw policy, same layout. */
  policy: number[] | null | undefined;
  /** The root score lead, Black's perspective. */
  scoreLead: number;
}

/** The engine's reading of the position after one move by the side to move. */
export interface ScoreAfterAnswer {
  /** The root score lead, Black's perspective. */
  scoreLead: number;
  winrate: number;
}

/** What the selector asks of the engine: the Python's two kinds of
 *  analyze() call, one to one. */
export interface HumanNetEngine {
  /** Evaluate the position with the human SL profile `profileName` set, at
   *  `visits`, returning both policies. */
  humanPolicy(profileName: string, visits: number): Promise<HumanPolicyAnswer>;
  /** The main net's evaluation (no human profile) of the position after the
   *  side to move plays `move`, searched at `visits`. */
  scoreAfter(move: Point | 'pass', visits: number): Promise<ScoreAfterAnswer>;
}

/** The knobs the human path reads; `human_sl_profile` is required here
 *  because the caller only takes this path when the profile names one. */
export type HumanNetProfile = Pick<
  RankProfile,
  | 'human_tilt'
  | 'human_tilt_from'
  | 'human_cand_min'
  | 'human_cand_max'
  | 'human_score_visits'
  | 'human_pass_margin'
  | 'human_small_gain'
  | 'human_confirm_visits'
  | 'human_confirm_margin'
  | 'human_loss_cap'
> & { human_sl_profile: string };

/** The Python's SelectorEval: score data from the selector's own queries.
 *  Leads are Black's perspective. */
export interface HumanNetEval {
  /** The root lead of the position the bot was given; the first query that
   *  fills it wins. */
  scoreLeadBefore: number | null;
  /** The scored candidates of this move (empty when none were scored). */
  candidates: MoveCandidate[] | null;
}

/** handled=false sends the caller to the standard selector (no human policy
 *  came back, or a query failed); move=null with handled=true is a pass. */
export interface HumanNetResult {
  handled: boolean;
  move: Point | null;
}

export interface HumanNetOptions {
  opponentPassed?: boolean;
  evalOut?: HumanNetEval | null;
  /** Uniform in [0, 1); defaults to Math.random. */
  rng?: () => number;
  /** Receives the Python's diagnostic lines. */
  log?: (line: string) => void;
}

const HUMAN_TILT_LOSS_CAP = 15.0;
const HUMAN_PASS_POLICY = 0.5;

/** The count `human_tilt_from` is measured against, in the server's sense:
 *  moves played (passes included), handicap stones not counted. The app's
 *  bridge move list (buildBridgeMovesFromGame) starts with the handicap
 *  stones as Black moves. */
export function movesPlayedExcludingHandicap(
  bridgeMoves: readonly unknown[],
  handicapStones: number,
): number {
  return bridgeMoves.length - handicapStones;
}

/** The move leaves its own group with a single liberty and captures nothing.
 *  Mirrors _is_self_atari. */
export function isSelfAtari(board: Board, color: Stone, point: Point): boolean {
  const test = board.clone();
  const { result, captures } = test.tryPlay(color, point);
  if (result !== MoveResult.Ok) return false;
  // it captured: taking stones with your last liberty is a real move
  if (captures.length > 0) return false;
  return test.countLiberties(test.getGroup(point)) === 1;
}

/** Python's random.choices(range(n), weights)[0]: bisect_right over the
 *  cumulative weights at random() * total, never past the last index. */
function choiceIndex(weights: number[], rng: () => number): number {
  const cum: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    cum.push(acc);
  }
  const x = rng() * acc;
  for (let i = 0; i < cum.length - 1; i++) {
    if (cum[i] > x) return i;
  }
  return cum.length - 1;
}

function gtp(p: Point, size: number): string {
  return `${'ABCDEFGHJKLMNOPQRST'[p.col]}${size - p.row}`;
}

/** Python int() on a profile number. */
const int = Math.trunc;

export async function selectWithHumanNet(
  engine: HumanNetEngine,
  board: Board,
  color: Stone,
  profile: HumanNetProfile,
  movesPlayed: number,
  options: HumanNetOptions = {},
): Promise<HumanNetResult> {
  const { opponentPassed = false, evalOut = null, rng = Math.random, log = () => {} } = options;
  const size = board.size;
  const n = size * size;
  const name = profile.human_sl_profile;
  const at = (idx: number): Point => ({ row: Math.floor(idx / size), col: idx % size });
  const pass = (): HumanNetResult => ({ handled: true, move: null });
  try {
    const analysis = await engine.humanPolicy(name, 1);
    const human = analysis.humanPolicy;
    const main = analysis.policy;
    if (!human || !main || human.length <= n || main.length <= n) {
      log('human net: no human policy in the answer, standard selector');
      return { handled: false, move: null };
    }

    if (evalOut) {
      if (evalOut.scoreLeadBefore === null) evalOut.scoreLeadBefore = analysis.scoreLead;
      evalOut.candidates = [];
    }

    if (main[n] > HUMAN_PASS_POLICY) {
      log(`human net PASS: main-net pass policy ${main[n].toFixed(2)}`);
      return pass();
    }

    // Legal by OUR rules: KataGo plays simple ko under japanese rules and
    // this engine positional superko, so its policy can offer a recapture
    // tryPlay rejects.
    const legal: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const p = human[i];
      if (p > 0 && board.clone().tryPlay(color, at(i)).result === MoveResult.Ok) legal.push([i, p]);
    }
    if (legal.length === 0) {
      log('human net PASS: no legal move in the human policy');
      return pass();
    }

    // Not moves a player makes on purpose: its own group into atari for
    // nothing, its own eye filled. Kept only when nothing else is on offer.
    const sane = legal.filter(
      ([i]) => !isSelfAtari(board, color, at(i)) && !isEyeFill(board, color, at(i)),
    );
    const pool = sane.length > 0 ? sane : legal;

    const tilt = profile.human_tilt ?? 0;
    const tiltOn = tilt !== 0 && movesPlayed >= int(profile.human_tilt_from ?? 12);
    if (!(tiltOn || opponentPassed)) {
      const [idx, prob] = pool[choiceIndex(pool.map(([, p]) => p), rng)];
      log(`human net ${name}: sampled ${gtp(at(idx), size)} (p=${prob.toFixed(2)})`);
      return { handled: true, move: at(idx) };
    }

    const candMin = profile.human_cand_min ?? 0.03;
    const candMax = int(profile.human_cand_max ?? 8);
    const byProb = [...pool].sort((a, b) => b[1] - a[1]);
    let cands = byProb.filter(([, p]) => p >= candMin).slice(0, candMax);
    if (cands.length === 0) cands = byProb.slice(0, 1);

    // The main net scores the position after each candidate, and after a
    // pass. Leads are Black-perspective; `vals` are from the mover's side.
    const visits = int(profile.human_score_visits ?? 4);
    const results = await Promise.all([
      ...cands.map(([i]) => engine.scoreAfter(at(i), visits)),
      engine.scoreAfter('pass', visits),
    ]);
    const sign = color === Color.Black ? 1 : -1;
    const vals = results.slice(0, -1).map((r) => sign * r.scoreLead);
    const passVal = sign * results[results.length - 1].scoreLead;
    const best = Math.max(...vals);

    if (evalOut) {
      evalOut.candidates = cands.map(([i, p], j) => ({
        move: at(i),
        visits,
        winrate: results[j].winrate,
        scoreLead: results[j].scoreLead,
        prior: p,
        order: j,
      }));
    }

    const margin = profile.human_pass_margin ?? 0.75;
    const gain = best - passVal;
    if (gain < margin) {
      log(`human net PASS: the best of ${cands.length} candidates gains ${gain.toFixed(1)} over passing`);
      return pass();
    }

    const small = profile.human_small_gain;
    if (small != null && gain < small) {
      const [idx, prob] = cands[vals.indexOf(best)];
      const deep = int(profile.human_confirm_visits ?? 12);
      const [again, passed] = await Promise.all([
        engine.scoreAfter(at(idx), deep),
        engine.scoreAfter('pass', deep),
      ]);
      const confirmed = sign * again.scoreLead - sign * passed.scoreLead;
      const move = gtp(at(idx), size);
      if (confirmed < (profile.human_confirm_margin ?? margin)) {
        log(
          `human net PASS: ${move} gained ${gain.toFixed(1)} over passing at ` +
            `${visits} visits and ${confirmed.toFixed(1)} at ${deep}`,
        );
        return pass();
      }
      log(
        `human net ${name}: small endgame, played ${move} (p=${prob.toFixed(2)}), ` +
          `gain over pass ${gain.toFixed(1)} at ${visits} visits and ${confirmed.toFixed(1)} at ${deep}`,
      );
      return { handled: true, move: at(idx) };
    }

    const losses = vals.map((v) => best - v);
    let keep = cands.map((_, j) => j);
    const cap = profile.human_loss_cap;
    if (cap != null) keep = keep.filter((j) => losses[j] <= cap); // the best (loss 0) always stays
    let weights: number[];
    if (tiltOn && keep.length > 1 && tilt > 0) {
      weights = keep.map((j) => cands[j][1] * Math.exp(Math.min(losses[j], HUMAN_TILT_LOSS_CAP) / tilt));
    } else if (tiltOn && keep.length > 1) {
      // Negative tilt: loss >= 0, so the exponent is <= 0 and exp only underflows to 0.
      weights = keep.map((j) => cands[j][1] * Math.exp(losses[j] / tilt));
    } else {
      weights = keep.map((j) => cands[j][1]);
    }
    const k = keep[choiceIndex(weights, rng)];
    const [idx, prob] = cands[k];
    log(
      `human net ${name}: picked ${gtp(at(idx), size)} (p=${prob.toFixed(2)}, loss=${losses[k].toFixed(1)}) ` +
        `of ${keep.length} candidates (${cands.length} scored), ` +
        `worst loss ${Math.max(...keep.map((j) => losses[j])).toFixed(1)}, ` +
        `gain over pass ${(vals[k] - passVal).toFixed(1)}`,
    );
    return { handled: true, move: at(idx) };
  } catch (e) {
    log(`human net failed (${String(e)}), standard selector`);
    return { handled: false, move: null };
  }
}
