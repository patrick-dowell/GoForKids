import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Project-wide vitest env is 'node' (no jsdom): shim the minimal Web Storage
// surface the store graph touches, as gameStore.botSetStamp.test.ts does.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

vi.mock('../../audio/SoundManager', () => ({
  playPlaceSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playPassSound: vi.fn(),
  playGameEndSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    createGame: vi.fn(),
    getGame: vi.fn(),
    playMove: vi.fn(),
    pass: vi.fn(),
    resign: vi.fn(),
    undo: vi.fn(),
    getAIMove: vi.fn(),
    finishMove: vi.fn(),
  },
  abortPendingRequests: vi.fn(),
}));

import { useGameStore } from '../gameStore';
import { _resetDeviceCapabilities, readDeviceCapabilities } from '../capabilitiesStore';
import { Color } from '../../engine/types';
import { api } from '../../api/client';

/**
 * A game asked for at cold start, before the device said where its bots play,
 * waits for the answer (bounded). Meanwhile the screen says it is getting the
 * game ready and the board takes no stone: the last board on screen is not
 * the new game.
 */
describe('a game asked for before the capabilities answer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    vi.mocked(api.playMove).mockReturnValue(new Promise(() => {})); // the bot's reply is not this test's
    _resetDeviceCapabilities();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    _resetDeviceCapabilities();
  });

  const start = () =>
    useGameStore.getState().newGame({
      boardSize: 9,
      targetRank: '15k',
      useBackend: true,
      gameMode: 'ai',
      playerColor: Color.Black,
    });
  const stones = () => useGameStore.getState().getBoard().grid.filter((c) => c !== Color.Empty).length;

  it('says it is getting ready and takes no stone until the answer, then starts the game', async () => {
    let answer: (c: { localBots: boolean; evalsPerSecond: number; humanModel: boolean }) => void = () => {};
    (globalThis as { window?: unknown }).window = {
      kataGo: { ping: async () => ({ pong: true }), capabilities: () => new Promise((r) => (answer = r)) },
    };
    void readDeviceCapabilities();
    const started = start();
    await new Promise((r) => setTimeout(r, 0));
    const before = stones();
    useGameStore.getState().playMove({ row: 4, col: 4 });
    expect(stones()).toBe(before);
    expect(useGameStore.getState().startingGame).toBe(true);
    expect(api.createGame).not.toHaveBeenCalled();

    answer({ localBots: true, evalsPerSecond: 40, humanModel: false });
    await started;
    expect(useGameStore.getState().startingGame).toBe(false);
    expect(useGameStore.getState().gameId).toBe('abcd1234');
    expect(stones()).toBe(0);
    useGameStore.getState().playMove({ row: 4, col: 4 });
    expect(stones()).toBe(1);
  });

  it('nothing to wait for: no waiting state at all', async () => {
    const seen: boolean[] = [];
    const unsubscribe = useGameStore.subscribe((s) => seen.push(s.startingGame));
    await start(); // the web: no bridge, nothing to wait for
    unsubscribe();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  });
});
