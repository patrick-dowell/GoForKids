import { describe, it, expect, beforeEach } from 'vitest';
import { useLibraryStore, type SavedGame } from '../libraryStore';

// Project-wide vitest env is 'node' (no jsdom). Shim the minimal Web Storage
// surface the store uses, matching the localGameRouter test's approach.
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

function makeGame(id: string, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    sgf: '(;GM[1]SZ[9])',
    date: new Date().toISOString(),
    playerColor: 'black',
    opponentRank: '15k',
    result: 'Black wins by 5.5',
    moveCount: 40,
    isRanked: false,
    gameId: null,
    ...extra,
  };
}

/**
 * Share-code persistence (MILESTONE_tester_round §5): after an upload the
 * SavedGame remembers its share id so re-sharing shows the existing code
 * instead of storing a duplicate.
 */
describe('libraryStore sharing', () => {
  beforeEach(() => {
    localStorage.clear();
    useLibraryStore.getState().clearAll();
  });

  it('setSharedId stamps the right game and persists it', () => {
    const s = useLibraryStore.getState();
    s.saveGame(makeGame('a'));
    s.saveGame(makeGame('b'));

    useLibraryStore.getState().setSharedId('a', 'ABCD2345');

    const games = useLibraryStore.getState().games;
    expect(games.find((g) => g.id === 'a')?.sharedId).toBe('ABCD2345');
    expect(games.find((g) => g.id === 'b')?.sharedId).toBeUndefined();

    // Survives a reload from storage.
    useLibraryStore.setState({ games: [] });
    useLibraryStore.getState().loadFromStorage();
    expect(
      useLibraryStore.getState().games.find((g) => g.id === 'a')?.sharedId,
    ).toBe('ABCD2345');
  });

  it('setSharedId(id, undefined) clears a stale code (server lost the upload)', () => {
    const s = useLibraryStore.getState();
    s.saveGame(makeGame('a', { sharedId: 'DEADC0DE' }));
    useLibraryStore.getState().setSharedId('a', undefined);
    expect(useLibraryStore.getState().games[0].sharedId).toBeUndefined();

    useLibraryStore.setState({ games: [] });
    useLibraryStore.getState().loadFromStorage();
    expect(useLibraryStore.getState().games[0].sharedId).toBeUndefined();
  });

  it('selectorLog round-trips through save + storage', () => {
    const log = ['2026-07-02T00:00:00.000Z [selector] PASS reason=pass-threshold'];
    useLibraryStore.getState().saveGame(makeGame('c', { selectorLog: log }));

    useLibraryStore.setState({ games: [] });
    useLibraryStore.getState().loadFromStorage();
    expect(
      useLibraryStore.getState().games.find((g) => g.id === 'c')?.selectorLog,
    ).toEqual(log);
  });
});
