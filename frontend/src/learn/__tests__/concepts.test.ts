import { describe, it, expect } from 'vitest';
import {
  CONCEPTS,
  CORE_CONCEPTS,
  EXTENDED_CONCEPTS,
  getConcept,
  isConceptId,
} from '../concepts';
import { Board } from '../../engine/Board';
import { Color, type Point } from '../../engine/types';

describe('concept registry — well-formedness', () => {
  it('has the 10 core concepts Patrick finalized (2026-06-16)', () => {
    expect(CORE_CONCEPTS.map((c) => c.id)).toEqual([
      'placing-stones',
      'liberties',
      'capture',
      'atari',
      'groups',
      'two-eyes',
      'suicide-rule',
      'ko-rule',
      'territory-count',
      'who-wins',
    ]);
  });

  it('has the 11 extended concepts', () => {
    expect(EXTENDED_CONCEPTS).toHaveLength(11);
    expect(EXTENDED_CONCEPTS.every((c) => c.tier === 'extended')).toBe(true);
  });

  it('every concept has a unique id and a non-empty kid-simple `short`', () => {
    const ids = CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CONCEPTS) {
      expect(c.short.length, c.id).toBeGreaterThan(0);
      expect(c.name.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every `related` id points at a real concept (no dead cross-links)', () => {
    for (const c of CONCEPTS) {
      for (const rid of c.related ?? []) {
        expect(isConceptId(rid), `${c.id} → ${rid}`).toBe(true);
      }
    }
  });

  it('getConcept / isConceptId behave', () => {
    expect(getConcept('atari')?.name).toBe('Atari');
    expect(getConcept('nope')).toBeUndefined();
    expect(isConceptId('two-eyes')).toBe(true);
    expect(isConceptId('two-eyez')).toBe(false);
  });
});

/* Helper: count a stone's group liberties on a board built from a diagram. */
function liberties(board: Board, p: Point): number {
  const size = board.size;
  const color = board.get(p);
  const seen = new Set<number>();
  const libs = new Set<number>();
  const stack: Point[] = [p];
  while (stack.length) {
    const q = stack.pop()!;
    const idx = q.row * size + q.col;
    if (seen.has(idx)) continue;
    seen.add(idx);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = q.row + dr, nc = q.col + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const np = { row: nr, col: nc };
      const nidx = nr * size + nc;
      const nc2 = board.get(np);
      if (nc2 === Color.Empty) libs.add(nidx);
      else if (nc2 === color && !seen.has(nidx)) stack.push(np);
    }
  }
  return libs.size;
}

function boardFromDiagram(size: number, stones: Array<{ row: number; col: number; color: Color }>): Board {
  const b = new Board(size);
  for (const s of stones) b.set({ row: s.row, col: s.col }, s.color);
  return b;
}

describe('concept example positions — legal & correct Go', () => {
  it('every example fits its board and has no overlapping stones', () => {
    for (const c of CONCEPTS) {
      if (!c.example) continue;
      const { size, stones } = c.example;
      const seen = new Set<number>();
      for (const s of stones) {
        expect(s.row >= 0 && s.row < size && s.col >= 0 && s.col < size, `${c.id} in-bounds`).toBe(true);
        const idx = s.row * size + s.col;
        expect(seen.has(idx), `${c.id} no overlap`).toBe(false);
        seen.add(idx);
      }
    }
  });

  it('atari diagram: the marked White stone has exactly ONE liberty', () => {
    const ex = getConcept('atari')!.example!;
    const b = boardFromDiagram(ex.size, ex.stones);
    expect(liberties(b, { row: 2, col: 2 })).toBe(1);
  });

  it('capture diagram: the marked White stone has ZERO liberties', () => {
    const ex = getConcept('capture')!.example!;
    const b = boardFromDiagram(ex.size, ex.stones);
    expect(liberties(b, { row: 2, col: 2 })).toBe(0);
  });

  it('two-eyes diagram: both highlighted points are real eyes (all neighbors Black)', () => {
    const ex = getConcept('two-eyes')!.example!;
    const b = boardFromDiagram(ex.size, ex.stones);
    for (const eye of ex.highlight!) {
      expect(b.get(eye), 'eye is empty').toBe(Color.Empty);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = eye.row + dr, nc = eye.col + dc;
        if (nr < 0 || nr >= ex.size || nc < 0 || nc >= ex.size) continue; // edge counts as wall
        expect(b.get({ row: nr, col: nc }), `eye ${eye.row},${eye.col} neighbor`).toBe(Color.Black);
      }
    }
    // Two DISTINCT eyes.
    expect(ex.highlight!.length).toBe(2);
  });

  it('suicide diagram: the marked point is surrounded by White (Black there would self-capture)', () => {
    const ex = getConcept('suicide-rule')!.example!;
    const b = boardFromDiagram(ex.size, ex.stones);
    const pt = ex.highlight![0];
    expect(b.get(pt)).toBe(Color.Empty);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = pt.row + dr, nc = pt.col + dc;
      if (nr < 0 || nr >= ex.size || nc < 0 || nc >= ex.size) continue;
      expect(b.get({ row: nr, col: nc })).toBe(Color.White);
    }
  });
});
