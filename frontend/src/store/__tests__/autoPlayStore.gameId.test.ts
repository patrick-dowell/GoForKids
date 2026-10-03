import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRankedResult,
  normalizeLadder,
  onRankedResult,
  reapplyRankedResults,
  useAutoPlayStore,
  type RankedResult,
} from '../autoPlayStore';
import { freshState } from '../../autoplay/matchmaker';

// Project-wide vitest env is 'node' (no jsdom): the minimal Web Storage the
// store persists through.
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

/**
 * Feature 32, revision 8: a ranked result records the Library id its game was
 * saved under (`gameId` on the history entry), so a friend's feed can open
 * that replay. Entries from before carry none and stay valid.
 */
describe('autoPlayStore — the saved game on the history entry', () => {
  beforeEach(() => {
    localStorage.clear();
    useAutoPlayStore.getState().clearPlayer();
    useAutoPlayStore.getState().setBoardSize(9);
  });

  it("records the game's Library id on the entry and hands it to sync", () => {
    const heard: RankedResult[] = [];
    const stop = onRankedResult((r) => heard.push(r));
    useAutoPlayStore.getState().recordResult('win', 1, 'a1b2c3d4');
    stop();
    const history = useAutoPlayStore.getState().history;
    const entry = history[history.length - 1];
    expect(entry).toMatchObject({ result: 'win', undosUsed: 1, gameId: 'a1b2c3d4' });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ boardSize: 9, result: 'win', gameId: 'a1b2c3d4', ts: entry.ts });
    // Persisted with it.
    expect(localStorage.getItem('goforkids.autoplay.v1')).toContain('"gameId":"a1b2c3d4"');
  });

  it('a result with no saved game has no gameId at all', () => {
    useAutoPlayStore.getState().recordResult('loss');
    useAutoPlayStore.getState().recordResult('loss', 0, '');
    for (const entry of useAutoPlayStore.getState().history) expect('gameId' in entry).toBe(false);
  });

  it("a queued result keeps its id when sync re-applies it; one that isn't a string is dropped", () => {
    const queued = [
      { boardSize: 9, result: 'win', undosUsed: 0, ts: 1000, gameId: 'g-1' },
      { boardSize: 9, result: 'win', undosUsed: 0, ts: 2000, gameId: 42 },
      { boardSize: 9, result: 'loss', undosUsed: 0, ts: 3000 },
    ] as unknown as RankedResult[];
    const { ladder } = reapplyRankedResults({ byBoardSize: {} }, queued);
    const history = ladder.byBoardSize['9x9']!.history;
    expect(history.map((h) => h.gameId)).toEqual(['g-1', undefined, undefined]);
    expect(history.map((h) => 'gameId' in h)).toEqual([true, false, false]);
  });

  it('an older entry without one still loads and still takes new results', () => {
    const old = { rung: '30k', bot: '30k', handicap: 0, result: 'win' as const, ts: 1, undosUsed: 0 };
    const { slots } = normalizeLadder({ byBoardSize: { '9x9': { rungState: freshState(9), history: [old], promotionEvents: [] } } });
    expect(slots['9x9']!.history).toEqual([old]);
    const out = applyRankedResult(slots['9x9']!, 3, { boardSize: 9, result: 'win', undosUsed: 0, ts: 2, gameId: 'new' });
    expect(out.slot.history.map((h) => h.gameId)).toEqual([undefined, 'new']);
  });
});
