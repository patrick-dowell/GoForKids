/**
 * Play-of-the-Game review (feature plan 28). After a game, surface the few
 * moments that mattered most — and explain what happened.
 *
 * SELECTION is by **engine swing**: the moves where KataGo's score estimate
 * (`scoreHistory`, captured per move during play) moved the most. Captures are
 * a *consequence*, not usually the key move — so they no longer drive selection.
 * INTERPRETATION reuses the board-state detectors (capture / atari) to say what
 * happened at the swing, plus the point magnitude and who moved. When a swing
 * has no clean tactical explanation (a big territorial/shape move), we still
 * report the magnitude honestly — deeper "why" is the LLM-teacher's future job.
 *
 * FALLBACK: when there's no score data (no KataGo — e.g. the stub-AI backend, or
 * the QA fixture), selection falls back to the old capture/atari detection so
 * the review still works.
 *
 * Design (fp 28): lead with glory — a good moment leads when one exists. Few
 * (≤3). Reuses DiagramBoard for the moment snapshots.
 */
import { Board } from '../engine/Board';
import { Color, type Point, type MoveRecord, type Stone, oppositeColor } from '../engine/types';
import type { DiagramPosition } from './concepts';

export type HighlightKind = 'good' | 'learn';

/** Per-move score point — mirrors gameStore's ScorePoint (lead = Black's view). */
export interface ScorePoint {
  move: number;
  lead: number;
}

export interface ReviewHighlight {
  /** 1-based move number this moment happened on. */
  moveNumber: number;
  /** Concept id linking into the glossary, or null for a non-tactical swing. */
  conceptId: string | null;
  /** 'good' = the swing favored the player; 'learn' = it went against them. */
  kind: HighlightKind;
  /** Kid-facing one-liner. */
  headline: string;
  /** Board snapshot of the moment, for DiagramBoard. */
  position: DiagramPosition;
  /** Points the move swung, from the player's perspective (negative = against). */
  swing?: number;
  /** Internal rank — bigger = more notable. */
  weight: number;
}

/** Points below this aren't a "key" swing; opening estimates are also skipped. */
const MIN_SWING = 4;
const MIN_MOVE = 3;
/** Don't pick two highlights within this many moves (avoids same-fight clusters). */
const DEDUPE_WINDOW = 3;

/* ------------------------------------------------------------------ helpers */

/** Replay moves[0..upTo] (inclusive) onto a fresh board; captures resolve. */
function boardAfter(moves: MoveRecord[], upTo: number, size: number): Board {
  const b = new Board(size);
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const m = moves[i];
    if (m.point) b.tryPlay(m.color as Stone, m.point);
  }
  return b;
}

function stonesOf(board: Board, size: number): DiagramPosition['stones'] {
  const stones: DiagramPosition['stones'] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const c = board.get({ row, col });
      if (c !== Color.Empty) stones.push({ row, col, color: c });
    }
  }
  return stones;
}

function neighbors(p: Point, size: number): Point[] {
  const out: Point[] = [];
  if (p.row > 0) out.push({ row: p.row - 1, col: p.col });
  if (p.row < size - 1) out.push({ row: p.row + 1, col: p.col });
  if (p.col > 0) out.push({ row: p.row, col: p.col - 1 });
  if (p.col < size - 1) out.push({ row: p.row, col: p.col + 1 });
  return out;
}

const plural = (n: number) => (n === 1 ? '' : 's');

interface Tactic {
  conceptId: string;
  captures: number;
  highlight: Point[];
}

/** What tactical thing (if any) happened at move `i` — used to *explain* a swing. */
function tacticAt(moves: MoveRecord[], i: number, board: Board, size: number): Tactic | null {
  const m = moves[i];
  if (!m.point) return null;
  if (m.captures.length > 0) {
    return { conceptId: 'capture', captures: m.captures.length, highlight: [m.point, ...m.captures] };
  }
  const victim = oppositeColor(m.color as Stone);
  const seen = new Set<number>();
  for (const nb of neighbors(m.point, size)) {
    if (board.get(nb) !== victim) continue;
    const group = board.getGroup(nb);
    const key = group[0].row * size + group[0].col;
    if (seen.has(key)) continue;
    seen.add(key);
    if (board.countLiberties(group) === 1) {
      const last = board.getLiberties(group)[0] ?? null;
      return { conceptId: 'atari', captures: 0, highlight: last ? [m.point, nb, last] : [m.point, nb] };
    }
  }
  return null;
}

/** Turn a scored move into a highlight: who moved, how big, what happened. */
function interpret(
  moves: MoveRecord[],
  i: number,
  size: number,
  swingBlack: number,
  playerColor: Stone,
): ReviewHighlight {
  const m = moves[i];
  const isPlayerMove = (m.color as Stone) === playerColor;
  const swingForPlayer = playerColor === Color.Black ? swingBlack : -swingBlack;
  const good = swingForPlayer >= 0;
  const pts = Math.max(1, Math.round(Math.abs(swingForPlayer)));
  const board = boardAfter(moves, i, size);
  const tactic = tacticAt(moves, i, board, size);
  const cap = tactic?.captures ?? 0;

  let headline: string;
  if (good) {
    headline = isPlayerMove
      ? cap > 0
        ? `Great move! You captured ${cap} stone${plural(cap)} and gained about ${pts} point${plural(pts)}.`
        : `Strong move — you gained about ${pts} point${plural(pts)} here.`
      : `The bot slipped here — you gained about ${pts} point${plural(pts)}.`;
  } else {
    headline = isPlayerMove
      ? `This move backfired — about ${pts} point${plural(pts)} the other way.`
      : cap > 0
        ? `The bot captured ${cap} of your stone${plural(cap)} — about ${pts} point${plural(pts)}.`
        : `The bot found a strong move here — about ${pts} point${plural(pts)}.`;
  }

  return {
    moveNumber: m.moveNumber,
    conceptId: tactic?.conceptId ?? null,
    kind: good ? 'good' : 'learn',
    headline,
    position: {
      size,
      stones: stonesOf(board, size),
      highlight: tactic?.highlight ?? (m.point ? [m.point] : []),
    },
    swing: swingForPlayer,
    weight: Math.abs(swingBlack),
  };
}

/** Lead with glory: a good moment first, then by magnitude. */
function leadWithGlory(a: ReviewHighlight, b: ReviewHighlight): number {
  if ((a.kind === 'good') !== (b.kind === 'good')) return a.kind === 'good' ? -1 : 1;
  return b.weight - a.weight;
}

/* --------------------------------------------------------------- public API */

/**
 * Build the review for a finished game. `scoreHistory` is KataGo's per-move
 * score lead (Black's perspective); when present, the biggest swings are the
 * highlights. `playerColor` frames "you" vs "the bot".
 */
export function buildReview(
  moves: MoveRecord[],
  scoreHistory: ScorePoint[],
  playerColor: Stone,
  size: number,
  max = 3,
): ReviewHighlight[] {
  // Engine-swing selection (preferred).
  const swings: Array<{ moveNumber: number; swingBlack: number }> = [];
  for (let i = 1; i < scoreHistory.length; i++) {
    const swingBlack = scoreHistory[i].lead - scoreHistory[i - 1].lead;
    const moveNumber = scoreHistory[i].move;
    if (moveNumber < MIN_MOVE) continue;
    if (Math.abs(swingBlack) < MIN_SWING) continue;
    swings.push({ moveNumber, swingBlack });
  }

  if (swings.length === 0) {
    return tacticalFallback(moves, playerColor, size, max);
  }

  swings.sort((a, b) => Math.abs(b.swingBlack) - Math.abs(a.swingBlack));
  const picked: ReviewHighlight[] = [];
  const used: number[] = [];
  for (const s of swings) {
    if (picked.length >= max) break;
    const idx = s.moveNumber - 1;
    const m = moves[idx];
    if (!m || !m.point) continue; // pass / out of range
    if (used.some((u) => Math.abs(u - s.moveNumber) < DEDUPE_WINDOW)) continue;
    used.push(s.moveNumber);
    picked.push(interpret(moves, idx, size, s.swingBlack, playerColor));
  }

  picked.sort(leadWithGlory);
  return picked;
}

/**
 * No score data (stub AI / fixture): select by tactical event (capture, then
 * atari), framed as good/learn. The pre-score behavior, kept as a safety net.
 */
function tacticalFallback(
  moves: MoveRecord[],
  playerColor: Stone,
  size: number,
  max: number,
): ReviewHighlight[] {
  const candidates: ReviewHighlight[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m.point) continue;
    const isPlayer = (m.color as Stone) === playerColor;
    const board = boardAfter(moves, i, size);
    const tactic = tacticAt(moves, i, board, size);
    if (!tactic) continue;

    if (tactic.conceptId === 'capture') {
      const n = tactic.captures;
      candidates.push({
        moveNumber: m.moveNumber,
        conceptId: 'capture',
        kind: isPlayer ? 'good' : 'learn',
        headline: isPlayer
          ? `You captured ${n} stone${plural(n)}!`
          : `The bot captured ${n} of your stone${plural(n)} here.`,
        position: { size, stones: stonesOf(board, size), highlight: tactic.highlight },
        weight: 100 + n * 10 + (isPlayer ? 1 : 0),
      });
    } else {
      candidates.push({
        moveNumber: m.moveNumber,
        conceptId: 'atari',
        kind: isPlayer ? 'good' : 'learn',
        headline: isPlayer
          ? `You put the bot in atari — one move from a capture.`
          : `Your stones were in atari here — one move from being captured.`,
        position: { size, stones: stonesOf(board, size), highlight: tactic.highlight },
        weight: 50 + (isPlayer ? 1 : 0),
      });
    }
  }
  if (candidates.length === 0) return [];
  return candidates.sort(leadWithGlory).slice(0, max);
}

/**
 * A small known-good finished game for the `?review=demo` QA deep-link: Black
 * (the player) ataris then captures White on a 5×5, with a fabricated score
 * history so the capture reads as the biggest swing. Fixture, not product data.
 */
export const DEMO_REVIEW_GAME: {
  size: number;
  playerColor: Stone;
  moves: MoveRecord[];
  scoreHistory: ScorePoint[];
} = {
  size: 5,
  playerColor: Color.Black,
  moves: (
    [
      [Color.Black, { row: 0, col: 0 }, []],
      [Color.White, { row: 2, col: 2 }, []],
      [Color.Black, { row: 1, col: 2 }, []],
      [Color.White, { row: 4, col: 4 }, []],
      [Color.Black, { row: 3, col: 2 }, []],
      [Color.White, { row: 4, col: 3 }, []],
      [Color.Black, { row: 2, col: 1 }, []], // White(2,2) now in atari
      [Color.White, { row: 4, col: 2 }, []],
      [Color.Black, { row: 2, col: 3 }, [{ row: 2, col: 2 }]], // captures White(2,2)
    ] as Array<[Color, Point, Point[]]>
  ).map(([color, point, captures], i) => ({ color, point, captures, moveNumber: i + 1 })),
  scoreHistory: [
    { move: 0, lead: 0 },
    { move: 1, lead: 0 },
    { move: 2, lead: -1 },
    { move: 3, lead: 0 },
    { move: 4, lead: -1 },
    { move: 5, lead: 0 },
    { move: 6, lead: 1 },
    { move: 7, lead: 2 },
    { move: 8, lead: 1 },
    { move: 9, lead: 9 }, // the capture: +8 swing for Black (the player)
  ],
};
