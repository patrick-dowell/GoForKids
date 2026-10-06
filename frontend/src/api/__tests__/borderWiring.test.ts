/**
 * The standard selector's border check before a pass (moveSelector.ts
 * passOrCloseBorder) on the device: the move path hands it the engine calls
 * it asks for (the scorer's ownership read and scoreAfter), so a bot about
 * to pass with a border open closes it instead. A native build without
 * scoreAfter passes exactly as before, with nothing asked and nothing logged.
 *
 * Runs through client.ts (api.getAIMove) on a real on-device game against a
 * fake bridge; the position is the selector's own border test's (a 9×9 12k
 * game, White to move, A8 closing four points).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../../engine/Board';
import { Color } from '../../engine/types';

function installLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const SIZE = 9;
// SGF coordinates (column letter, row letter from the top), Black first; White to move.
const GAME_12K = 'eeegcegdfgccecffefggfhdggffehgghhhedddfddccfdebebdafgbehgibccbbbdacdbafbfcgchbebfaeidb';
const DEAD_12K: Array<[number, number]> = [[1, 4], [1, 5], [2, 6], [3, 1], [3, 4], [3, 5], [3, 6], [4, 5], [5, 5]];
const MOVES = Array.from({ length: GAME_12K.length / 2 }, (_, k) => ({
  color: (k % 2 === 0 ? 'B' : 'W') as 'B' | 'W',
  row: GAME_12K.charCodeAt(2 * k + 1) - 97,
  col: GAME_12K.charCodeAt(2 * k) - 97,
}));

/** The count's ownership (Black +): stones and territory, the dead stones
 *  given to the other side, the open points 0. */
function ownership(): number[] {
  const board = new Board(SIZE);
  for (const m of MOVES) board.tryPlay(m.color === 'B' ? Color.Black : Color.White, m);
  const deadIdx = DEAD_12K.map(([r, c]) => r * SIZE + c);
  const counted = board.clone();
  for (const i of deadIdx) counted.grid[i] = Color.Empty;
  const { blackTerritory, whiteTerritory } = counted.scoreTerritory();
  const own: number[] = board.grid.map((c) => (c === Color.Black ? 0.9 : c === Color.White ? -0.9 : 0));
  for (const i of deadIdx) own[i] = -own[i];
  for (const i of blackTerritory) own[i] = 0.9;
  for (const i of whiteTerritory) own[i] = -0.9;
  return own;
}

/** The engine's top move is a pass, with nothing else on offer; asked for
 *  ownership it sends the count's, from the side to move's frame as KataGo
 *  does; every scoring query reads the same lead. */
function installBridge(withScoreAfter: boolean) {
  const own = ownership();
  const analyze = vi.fn(async (params: Record<string, unknown>) => ({
    candidates: [{ move: 'pass', visits: 50, winrate: 0.5, scoreLead: -26, prior: 0.6, order: 0 }],
    rootVisits: Number(params.maxVisits),
    kataGoPlayedMove: 'pass',
    ...(params.ownership ? { ownership: params.color === 'W' ? own.map((v) => -v) : own } : {}),
  }));
  const scoreAfter = vi.fn(async (_params: { move: string }) => ({ scoreLead: -26, winrate: 0.5 }));
  const bridge: Record<string, unknown> = {
    ping: async () => ({ pong: true }),
    analyze,
    capabilities: async () => ({ localBots: true, evalsPerSecond: 60, humanModel: false }),
  };
  if (withScoreAfter) bridge.scoreAfter = scoreAfter;
  (globalThis as { window?: unknown }).window = { kataGo: bridge, setTimeout, clearTimeout };
  return { analyze, scoreAfter };
}

async function botMove() {
  const caps = await import('../../store/capabilitiesStore');
  await caps.readDeviceCapabilities();
  const { api } = await import('../client');
  const { toGtp } = await import('../nativeKataGo');
  const log = await import('../../ai/selectorLog');
  const id = (await api.createGame({ board_size: SIZE, target_rank: '9k', komi: 6.5 })).game_id;
  for (const m of MOVES) await api.playMove(id, m.row, m.col);
  log.clearSelectorLog();
  const movesForBridge = MOVES.map((m) => ({ color: m.color, point: toGtp(m, SIZE) }));
  const move = await api.getAIMove(id, '9k', { movesForBridge, handicap: 0 });
  return { move, log: log.snapshotSelectorLog(), game: await api.getGame(id) };
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('the border check on the device', () => {
  it('a standard bot about to pass with a border open closes it (A8, four points)', async () => {
    const b = installBridge(true);
    const { move, log, game } = await botMove();
    expect(move.point).toEqual({ row: 1, col: 0 }); // A8
    expect(game.board[1][0]).toBe(2); // White's stone, committed
    expect(b.analyze).toHaveBeenCalledWith(expect.objectContaining({ ownership: true, color: 'W' }));
    expect(b.scoreAfter.mock.calls.map(([p]) => p.move)).toEqual(['A8', 'A7', 'A6', 'pass']);
    expect(log.some((l) => l.includes('closed a border at (1,0) instead of passing'))).toBe(true);
  });

  it('a native build without scoreAfter passes as before: no ownership read, nothing logged about a border', async () => {
    const b = installBridge(false);
    const { move, log } = await botMove();
    expect(move.point).toEqual({ row: -1, col: -1 });
    expect(b.analyze).toHaveBeenCalledTimes(1);
    expect(b.analyze).not.toHaveBeenCalledWith(expect.objectContaining({ ownership: true }));
    expect(log.some((l) => l.includes('border'))).toBe(false);
  });
});
