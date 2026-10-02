import { beforeEach, describe, expect, it } from 'vitest';
import { useAutoPlayStore } from '../../store/autoPlayStore';
import { boardSlot, initialProfileTab, onBoard } from '../profileBoards';

// Project-wide vitest env is 'node' (no jsdom). Shim the minimal Web Storage
// surface the store uses, as autoPlayStore.undoBank.test.ts does.
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
 * The Profile page's board tabs (feature 32, revision 7): a tab shows a
 * board's ladder without making it the board Play plays next, and an action
 * taken on a tab lands on that tab's board only.
 */

const STORAGE_KEY = 'goforkids.autoplay.v1';

function stored() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
}

beforeEach(() => {
  localStorage.clear();
  useAutoPlayStore.getState().clearPlayer();
  // clearPlayer keeps the active board; start every test on 19×19.
  useAutoPlayStore.getState().setBoardSize(19);
  localStorage.clear();
});

describe('initialProfileTab', () => {
  it('opens on the board the caller asked for', () => {
    expect(initialProfileTab(9, 19)).toBe(9);
    expect(initialProfileTab(19, 9)).toBe(19);
  });

  it('else on the active board', () => {
    expect(initialProfileTab(undefined, 9)).toBe(9);
    expect(initialProfileTab(null, 19)).toBe(19);
  });

  it('else on 19×19 (a board without a tab, asked for or active)', () => {
    expect(initialProfileTab(13, 13)).toBe(19);
    expect(initialProfileTab(undefined, 13)).toBe(19);
    expect(initialProfileTab(13, 9)).toBe(9);
  });
});

describe('boardSlot', () => {
  it('reads the active board from the live fields and the other from its slot, switching nothing', () => {
    onBoard(9, (s) => s.setRung('20k'));
    const s = useAutoPlayStore.getState();
    expect(s.boardSize).toBe(19);
    expect(boardSlot(s, 9).rungState.currentRung).toBe('20k');
    expect(boardSlot(s, 19).rungState).toBe(s.rungState);
    expect(useAutoPlayStore.getState().boardSize).toBe(19);
  });

  it('gives a never-played board a fresh slot, the same object every time', () => {
    const s = useAutoPlayStore.getState();
    expect(s.slots['9x9']).toBeUndefined();
    const a = boardSlot(s, 9);
    expect(a.rungState.currentRung).toBe('30k');
    expect(a.history).toEqual([]);
    expect(a.shadowRating.phi).toBe(350);
    expect(boardSlot(useAutoPlayStore.getState(), 9)).toBe(a);
  });
});

describe('onBoard', () => {
  it('derank on the other tab: that board steps down, the active board and Play board are untouched', () => {
    useAutoPlayStore.getState().setRung('18k'); // 19×19, active
    onBoard(9, (s) => s.setRung('15k'));
    onBoard(9, (s) => s.derank());

    const s = useAutoPlayStore.getState();
    expect(s.boardSize).toBe(19);
    expect(s.rungState.currentRung).toBe('18k');
    expect(boardSlot(s, 9).rungState.currentRung).toBe('16k');
    // Persisted for both boards.
    expect(stored().byBoardSize['9x9'].rungState.currentRung).toBe('16k');
    expect(stored().byBoardSize['19x19'].rungState.currentRung).toBe('18k');
  });

  it('reset on the other tab resets only that board', () => {
    useAutoPlayStore.getState().setRung('20k');
    onBoard(9, (s) => s.setRung('15k'));
    onBoard(9, (s) => s.reset());
    const s = useAutoPlayStore.getState();
    expect(s.boardSize).toBe(19);
    expect(s.rungState.currentRung).toBe('20k');
    expect(boardSlot(s, 9).rungState.currentRung).toBe('30k');
  });

  it('on the active board acts in place, without a switch', () => {
    useAutoPlayStore.getState().setBoardSize(9);
    useAutoPlayStore.getState().setRung('15k');
    onBoard(9, (s) => s.derank());
    const s = useAutoPlayStore.getState();
    expect(s.boardSize).toBe(9);
    expect(s.rungState.currentRung).toBe('16k');
  });

  it('hands the active board back even when the action throws', () => {
    expect(() => onBoard(9, (s) => s.setRung('not-a-rung'))).toThrow();
    expect(useAutoPlayStore.getState().boardSize).toBe(19);
  });
});
