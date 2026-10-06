/**
 * "Bot plays online" flipped in the middle of a game. A game's calls go
 * where the game was created (client.ts onDevice), so the game in progress
 * keeps its bots and the setting governs the next game. Played through the
 * game store with the real client: a fake bridge for the device's engine
 * and a fake server for the online bots.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/SoundManager', () => ({
  playPlaceSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playPassSound: vi.fn(),
  playGameEndSound: vi.fn(),
  playTwoEyesSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

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

/** The device's engine: every analyze offers the same few points, best first
 *  (the selector skips any already taken). */
function installBridge() {
  const points = ['C3', 'G7', 'C7', 'G3', 'E3', 'E7'];
  const analyze = vi.fn(async (params: Record<string, unknown>) => ({
    candidates: points.map((move, order) => ({ move, visits: 40 - order * 5, winrate: 0.5, scoreLead: 0.5, prior: 0.3 - order * 0.04, order })),
    rootVisits: Number(params.maxVisits),
    kataGoPlayedMove: points[0],
  }));
  const capabilities = vi.fn(async () => ({ localBots: true, evalsPerSecond: 60, humanModel: false }));
  (globalThis as { window?: unknown }).window = {
    kataGo: { ping: async () => ({ pong: true }), analyze, capabilities },
    setTimeout,
    clearTimeout,
  };
  return { analyze };
}

/** The online bots: a 9×9 game, its moves, and its bot's replies. */
function installServer() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  let moves = 0;
  const replies = [{ row: 2, col: 2 }, { row: 6, col: 6 }];
  const state = () => ({
    game_id: 'srv00001', board, phase: 'playing', board_size: 9, komi: 6.5,
    current_color: moves % 2 ? 'white' : 'black', move_number: moves + 1, last_move: null, ko_point: null,
  });
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const path = String(url).replace(/^.*\/api/, '');
    let body: unknown;
    if (path === '/games') body = state();
    else if (path === '/games/srv00001/move') {
      const { row, col } = JSON.parse(init!.body!);
      board[row][col] = 1;
      moves++;
      body = state();
    } else if (path === '/games/srv00001/ai-move') {
      const p = replies.shift()!;
      board[p.row][p.col] = 2;
      moves++;
      body = { point: p, captures: [], score_lead: 0.5 };
    } else return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ detail: 'Game not found' }) };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { paths: () => fetchMock.mock.calls.map(([u]) => String(u).replace(/^.*\/api/, '')) };
}

async function boot(cloudBot: boolean) {
  localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', cloudBot }));
  const caps = await import('../capabilitiesStore');
  await caps.readDeviceCapabilities();
  const { useSettingsStore } = await import('../settingsStore');
  const { useGameStore } = await import('../gameStore');
  const { localGameRouter } = await import('../../api/localGameRouter');
  const { Color } = await import('../../engine/types');
  const log = await import('../../ai/selectorLog');
  const store = useGameStore;
  const stones = () => store.getState().getBoard().grid.filter((c) => c !== Color.Empty).length;
  /** The player's move, then the bot's reply: both land on the board. */
  const playAndAwaitBot = async (row: number, col: number) => {
    const before = stones();
    store.getState().playMove({ row, col });
    await vi.waitFor(() => {
      expect(store.getState().botTrouble).toBeNull();
      expect(stones()).toBe(before + 2);
      expect(store.getState().aiThinking).toBe(false);
    }, { timeout: 3000 });
  };
  await store.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: true, gameMode: 'ai', playerColor: Color.Black });
  return { useSettingsStore, store, localGameRouter, playAndAwaitBot, log };
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('"Bot plays online" flipped mid-game', () => {
  it('a game on the device stays there: the next move and the bot\'s reply, and nothing reaches the server', async () => {
    const b = installBridge();
    const server = installServer();
    const { useSettingsStore, store, localGameRouter, playAndAwaitBot, log } = await boot(false);
    const gameId = store.getState().gameId!;
    expect(gameId).toMatch(/^[0-9a-f]{8}$/);
    expect(localGameRouter.has(gameId)).toBe(true);

    await playAndAwaitBot(4, 4);
    expect(b.analyze).toHaveBeenCalledTimes(1);

    useSettingsStore.getState().setCloudBot(true);
    await playAndAwaitBot(4, 2);
    expect(b.analyze).toHaveBeenCalledTimes(2);
    expect(store.getState().gameId).toBe(gameId);
    expect(localGameRouter.getGame(gameId)!.move_number).toBe(5);
    expect(server.paths()).toEqual([]);
    expect(log.snapshotSelectorLog().some((l) => /FAILED/.test(l))).toBe(false);

    // the next game follows the setting
    await store.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: true, gameMode: 'ai' });
    expect(store.getState().gameId).toBe('srv00001');
  });

  it('a game on the server stays there: the next move and the bot\'s reply, and the engine is not asked', async () => {
    const b = installBridge();
    const server = installServer();
    const { useSettingsStore, store, localGameRouter, playAndAwaitBot } = await boot(true);
    expect(store.getState().gameId).toBe('srv00001');

    await playAndAwaitBot(4, 4);
    useSettingsStore.getState().setCloudBot(false);
    await playAndAwaitBot(4, 2);
    expect(server.paths()).toEqual([
      '/games',
      '/games/srv00001/move',
      '/games/srv00001/ai-move',
      '/games/srv00001/move',
      '/games/srv00001/ai-move',
    ]);
    expect(b.analyze).not.toHaveBeenCalled();
    expect(localGameRouter.has('srv00001')).toBe(false);
    expect(store.getState().gameId).toBe('srv00001');
  });
});
