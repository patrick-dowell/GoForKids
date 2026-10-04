import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectAiMove, _resetReadCooldowns, type HumanRoute, type PositionAnalysis } from '../moveSelector';
import { Board } from '../../engine/Board';
import { Color, type Point } from '../../engine/types';

/**
 * The human route inside selectAiMove (the server's `_select_ai_move_inner`):
 * when the caller hands over a human route, its move is played; when the
 * route declines (handled=false) or throws, the standard selector plays with
 * the b28.yaml rung; with no route the selector is the standard one.
 */

const E5: Point = { row: 4, col: 4 };
const C7: Point = { row: 2, col: 2 };

/** One clear candidate: every branch of the 9×9 15k's standard path plays it. */
function analyzeSpy() {
  return vi.fn(
    async (): Promise<PositionAnalysis> => ({
      rootVisits: 16,
      candidates: [{ move: E5, visits: 16, winrate: 0.5, scoreLead: 1, prior: 0.95, order: 0 }],
    }),
  );
}

function route(select: HumanRoute['select']): HumanRoute & { lines: string[] } {
  const lines: string[] = [];
  return { select: vi.fn(select), log: (l: string) => lines.push(l), lines };
}

beforeEach(() => _resetReadCooldowns());

describe('selectAiMove with a human route', () => {
  it("plays the human path's move and never asks the standard analysis", async () => {
    const analyze = analyzeSpy();
    const human = route(async () => ({ handled: true, move: C7 }));
    expect(await selectAiMove(new Board(9), Color.Black, '15k', null, analyze, { human })).toEqual(C7);
    expect(human.select).toHaveBeenCalledTimes(1);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("plays the human path's pass", async () => {
    const analyze = analyzeSpy();
    const human = route(async () => ({ handled: true, move: null }));
    expect(await selectAiMove(new Board(9), Color.Black, '15k', null, analyze, { human })).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('hands the move to the standard selector when the human path declines', async () => {
    const analyze = analyzeSpy();
    const human = route(async () => ({ handled: false, move: null }));
    expect(await selectAiMove(new Board(9), Color.Black, '15k', null, analyze, { human })).toEqual(E5);
    expect(human.select).toHaveBeenCalledTimes(1);
    // the b28.yaml 9×9 15k's visits and wide-root noise: the standard rung
    expect(analyze).toHaveBeenCalledWith(16, { wideRootNoise: 0.7 });
  });

  it('hands the move to the standard selector when the human path throws, and logs it', async () => {
    const analyze = analyzeSpy();
    const human = route(async () => {
      throw new Error('bridge gone');
    });
    expect(await selectAiMove(new Board(9), Color.Black, '15k', null, analyze, { human })).toEqual(E5);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(human.lines).toEqual(['human net threw (Error: bridge gone), standard selector']);
  });

  it('asks the human path again on each eye-fill retry, as the server does', async () => {
    // Black's own eye at A9; the human path keeps proposing it, then a real move.
    const board = new Board(9);
    for (const p of [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }]) board.tryPlay(Color.Black, p);
    const answers = [{ row: 0, col: 0 }, { row: 0, col: 0 }, C7];
    const human = route(async () => ({ handled: true, move: answers.shift() ?? null }));
    const analyze = analyzeSpy();
    expect(await selectAiMove(board, Color.Black, '15k', null, analyze, { human })).toEqual(C7);
    expect(human.select).toHaveBeenCalledTimes(3);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('with no route, asks the standard analysis exactly as before', async () => {
    const analyze = analyzeSpy();
    expect(await selectAiMove(new Board(9), Color.Black, '15k', null, analyze)).toEqual(E5);
    expect(analyze).toHaveBeenCalledWith(16, { wideRootNoise: 0.7 });
  });
});
