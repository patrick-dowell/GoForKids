/**
 * Play-of-the-Game review (feature plan 28). After a game, surface the few
 * moments that mattered — both the good ones and the costly ones — each tagged
 * with a concept that links into the glossary (fp 29).
 *
 * MVP detectors are pure board-state (no KataGo): **captures** and **atari**.
 * Both are reliable, kid-legible, and need no engine — so the review works
 * fully offline / without the backend. Score-swing ranking (which needs the
 * on-device analysis) is a documented future enhancement, not part of v1.
 *
 * Design (fp 28): lead with glory, not the wound — in a loss, the first
 * highlight is a player success. Keep it few (≤3). Reuses DiagramBoard for the
 * moment snapshots.
 */
import { Board } from '../engine/Board';
import { Color, type Point, type MoveRecord, type Stone, oppositeColor } from '../engine/types';
import type { DiagramPosition } from './concepts';

export type HighlightKind = 'good' | 'learn';

export interface ReviewHighlight {
  /** 1-based move number this moment happened on. */
  moveNumber: number;
  /** Concept id — links into the glossary. */
  conceptId: string;
  /** 'good' = the player did something nice; 'learn' = it happened TO them. */
  kind: HighlightKind;
  /** Kid-facing one-liner. */
  headline: string;
  /** Board snapshot of the moment, for DiagramBoard. */
  position: DiagramPosition;
  /** Internal rank — bigger = more notable. */
  weight: number;
}

/** Replay moves[0..upTo] (inclusive) onto a fresh board; captures resolve. */
function boardAfter(moves: MoveRecord[], upTo: number, size: number): Board {
  const b = new Board(size);
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const m = moves[i];
    if (m.point) b.tryPlay(m.color as Stone, m.point);
  }
  return b;
}

/** Board → DiagramBoard stones array. */
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

/**
 * Build the review highlights for a finished game. `playerColor` is the human's
 * color so we can frame "you" vs "the bot". Returns up to `max` highlights,
 * good moments first (and at least one good moment leading when any exist).
 */
export function buildReview(
  moves: MoveRecord[],
  playerColor: Stone,
  size: number,
  max = 3,
): ReviewHighlight[] {
  const candidates: ReviewHighlight[] = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m.point) continue; // pass
    const mover = m.color as Stone;
    const isPlayer = mover === playerColor;
    const board = boardAfter(moves, i, size);

    // --- Capture: the mover removed stones this move. ---
    if (m.captures.length > 0) {
      const n = m.captures.length;
      candidates.push({
        moveNumber: m.moveNumber,
        conceptId: 'capture',
        kind: isPlayer ? 'good' : 'learn',
        headline: isPlayer
          ? `You captured ${n} stone${plural(n)}!`
          : `The bot captured ${n} of your stone${plural(n)} here.`,
        position: {
          size,
          stones: stonesOf(board, size),
          // The captured points are empty now — mark where they came off.
          highlight: m.captures,
        },
        // Captures are the most legible moment; bigger = more notable.
        weight: 100 + n * 10 + (isPlayer ? 1 : 0),
      });
      continue; // one highlight per move; capture outranks atari
    }

    // --- Atari: after the move, an opponent group adjacent to it has exactly
    //     one liberty (the mover just threatened a capture). ---
    const victimColor = oppositeColor(mover);
    const seenGroups = new Set<number>();
    let atariStone: Point | null = null;
    let lastLiberty: Point | null = null;
    for (const nb of neighbors(m.point, size)) {
      if (board.get(nb) !== victimColor) continue;
      const group = board.getGroup(nb);
      const key = group[0].row * size + group[0].col;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      if (board.countLiberties(group) === 1) {
        atariStone = nb;
        lastLiberty = board.getLiberties(group)[0] ?? null;
        break;
      }
    }
    if (atariStone) {
      candidates.push({
        moveNumber: m.moveNumber,
        conceptId: 'atari',
        kind: isPlayer ? 'good' : 'learn',
        headline: isPlayer
          ? `You put the bot in atari — one move from a capture.`
          : `Your stones were in atari here — one move from being captured.`,
        position: {
          size,
          stones: stonesOf(board, size),
          highlight: lastLiberty ? [atariStone, lastLiberty] : [atariStone],
        },
        weight: 50 + (isPlayer ? 1 : 0),
      });
    }
  }

  if (candidates.length === 0) return [];

  const good = candidates.filter((c) => c.kind === 'good').sort((a, b) => b.weight - a.weight);
  const learn = candidates.filter((c) => c.kind === 'learn').sort((a, b) => b.weight - a.weight);

  // Lead with glory: take the best good moments first, then at most one learn
  // moment, capped at `max`. If there are no good moments at all (rare — a game
  // with only the player getting captured), fall back to the learn moments.
  const picked: ReviewHighlight[] = [];
  const learnBudget = 1;
  for (const g of good) {
    if (picked.length >= max - Math.min(learnBudget, learn.length)) break;
    picked.push(g);
  }
  for (const l of learn) {
    if (picked.length >= max) break;
    picked.push(l);
  }
  // Keep the leading slot a good moment when we have one (chronology within is fine).
  return picked.slice(0, max);
}
