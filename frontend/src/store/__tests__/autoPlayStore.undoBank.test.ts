import { describe, it, expect, beforeEach } from 'vitest';
import { useAutoPlayStore, UNDO_BANK_MAX } from '../autoPlayStore';

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

/**
 * Banked ranked undos (flat banked-3, 2026-06-25). The bank is a player-level
 * resource: each ranked undo spends 1 (gameStore.undo → spendUndo); every
 * ranked game finished refills +1, capped. Casual / lesson undo ignores it.
 * Spec: feature_plans/MILESTONE_tester_round.md §4.
 */
describe('autoPlayStore — banked ranked undos', () => {
  beforeEach(() => {
    localStorage.clear();
    useAutoPlayStore.setState({ undoBank: UNDO_BANK_MAX, history: [] });
  });

  it('starts at a full bank', () => {
    expect(useAutoPlayStore.getState().undoBank).toBe(UNDO_BANK_MAX);
  });

  it('spendUndo decrements, and floors at 0 (no-op when empty)', () => {
    useAutoPlayStore.setState({ undoBank: 2 });
    expect(useAutoPlayStore.getState().spendUndo()).toBe(true); // 2 → 1
    expect(useAutoPlayStore.getState().spendUndo()).toBe(true); // 1 → 0
    expect(useAutoPlayStore.getState().undoBank).toBe(0);
    expect(useAutoPlayStore.getState().spendUndo()).toBe(false); // empty
    expect(useAutoPlayStore.getState().undoBank).toBe(0);
  });

  it('finishing a ranked game refills +1, capped — even a loss pays out', () => {
    useAutoPlayStore.setState({ undoBank: 1 });
    useAutoPlayStore.getState().recordResult('loss');
    expect(useAutoPlayStore.getState().undoBank).toBe(2);

    useAutoPlayStore.setState({ undoBank: UNDO_BANK_MAX });
    useAutoPlayStore.getState().recordResult('win');
    expect(useAutoPlayStore.getState().undoBank).toBe(UNDO_BANK_MAX); // capped
  });

  it('records undosUsed on the game history entry', () => {
    useAutoPlayStore.getState().recordResult('win', 2);
    const history = useAutoPlayStore.getState().history;
    expect(history[history.length - 1].undosUsed).toBe(2);
  });

  it('persists the bank across a reload', () => {
    useAutoPlayStore.setState({ undoBank: 2 });
    useAutoPlayStore.getState().spendUndo();      // → 1, persisted to storage
    useAutoPlayStore.setState({ undoBank: 99 });  // clobber the in-memory value
    useAutoPlayStore.getState().loadFromStorage(); // restore from storage
    expect(useAutoPlayStore.getState().undoBank).toBe(1);
  });
});
