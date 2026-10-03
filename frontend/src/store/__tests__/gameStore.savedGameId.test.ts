import { describe, it, expect, vi, beforeEach } from 'vitest';

// Project-wide vitest env is 'node' (no jsdom) — shim the minimal Web
// Storage surface the store graph touches, matching autoPlayStore's test.
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
import { useLibraryStore } from '../libraryStore';
import { Color } from '../../engine/types';
import { api } from '../../api/client';

/**
 * Feature 32, revision 8: a finished game is saved to the Library before its
 * ranked result is recorded (App's game-end effect runs after the store's
 * final set), and the store keeps the id it was saved under, which App puts
 * on the history entry. Every ranked game that finishes is saved: under the
 * backend game id, or "local-" and the time when the backend was out of
 * reach at the start.
 */
describe('gameStore — the Library id a finished game was saved under', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useLibraryStore.getState().clearAll();
    vi.mocked(api.resign).mockResolvedValue(undefined as never);
  });

  const ranked = () =>
    useGameStore.getState().newGame({
      boardSize: 9,
      targetRank: '12k',
      useBackend: true,
      gameMode: 'ai',
      playerColor: Color.Black,
      autoplayContext: true,
    });

  it('the backend game id, set when the game is saved, and cleared by the next game', async () => {
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    await ranked();
    expect(useGameStore.getState().savedGameId).toBeNull();
    useGameStore.getState().resign();
    expect(useGameStore.getState().savedGameId).toBe('abcd1234');
    expect(useLibraryStore.getState().games[0].id).toBe('abcd1234');
    await ranked();
    expect(useGameStore.getState().savedGameId).toBeNull();
  });

  it('a local id when the backend was out of reach', async () => {
    vi.mocked(api.createGame).mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await ranked();
    useGameStore.getState().resign();
    const id = useGameStore.getState().savedGameId;
    expect(id).toMatch(/^local-\d+$/);
    expect(useLibraryStore.getState().games[0].id).toBe(id);
  });
});
