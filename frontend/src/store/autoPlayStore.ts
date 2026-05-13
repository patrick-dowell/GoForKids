import { create } from 'zustand';
import {
  type Rung,
  type RungState,
  applyResult,
  effectiveMatchup,
  matchupForRung,
  freshState,
} from '../autoplay/matchmaker';

export interface HistoryEntry {
  rung: Rung;
  bot: string;
  handicap: number;
  result: 'win' | 'loss';
  ts: number;
}

export interface PromotionEvent {
  from: Rung;
  to: Rung;
  ts: number;
}

interface PersistedSlot {
  rungState: RungState;
  history: HistoryEntry[];
  promotionEvents: PromotionEvent[];
  // shadowRating: Glicko mu/phi/sigma planned for feature 23 (Profile page).
  // Schema is forward-compatible: future fields are read if present, ignored otherwise.
}

interface PersistedState {
  byBoardSize: {
    '19x19'?: PersistedSlot;
  };
}

interface AutoPlayState {
  rungState: RungState;
  history: HistoryEntry[];
  promotionEvents: PromotionEvent[];

  /** True between when a player taps Play on the match-picker card and when
   *  the resulting game's outcome has been recorded. Used by App.tsx's
   *  game-end effect to fire `recordResult` exactly once per auto-play game. */
  gamePending: boolean;

  /** True when a rank-up celebration is queued. Set in `recordResult` on
   *  successful promotion; cleared by `dismissRankUp`. */
  showRankUp: boolean;
  /** When `showRankUp` is true, the rung the player was promoted FROM. */
  pendingFromRung: Rung | null;

  /** Mark a game as pending. Called by AutoPlayView right before
   *  `gameStore.newGame` so App.tsx's effect can correctly tie the
   *  upcoming game's result back to auto-play. */
  setGamePending: (pending: boolean) => void;

  /** Apply a single game result. Updates state, fires promotion if
   *  applicable, persists, clears `gamePending`. */
  recordResult: (result: 'win' | 'loss') => void;

  /** Dismiss the rank-up celebration overlay. */
  dismissRankUp: () => void;

  /** Reset to a fresh 30k state. Wipes history and promotion events. Used
   *  by the Profile page's "Reset to fresh 30k" dev tool. */
  reset: () => void;

  /** Snap to a specific rung. Clears `winsAtCurrentRung` and `lossStreak`.
   *  History and promotion events are preserved. Used by the Profile page's
   *  "Manual rank set" dev tool. */
  setRung: (rung: Rung) => void;

  /** Load persisted state from localStorage. Called on app mount. */
  loadFromStorage: () => void;
}

const STORAGE_KEY = 'goforkids.autoplay.v1';
const HISTORY_CAP = 200;

function persist(slot: PersistedSlot) {
  try {
    const payload: PersistedState = { byBoardSize: { '19x19': slot } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed to save auto-play state:', e);
  }
}

// Note: derived values (current matchup, safeguard-active flag, validation-
// wall flag) are NOT exposed as store methods. Returning freshly-allocated
// objects from a Zustand selector triggers React's "getSnapshot should be
// cached" warning and an infinite re-render loop. Components compute these
// directly from `rungState` using the matchmaker module's pure functions.
export const useAutoPlayStore = create<AutoPlayState>((set, get) => ({
  rungState: freshState(),
  history: [],
  promotionEvents: [],
  gamePending: false,
  showRankUp: false,
  pendingFromRung: null,

  setGamePending: (pending: boolean) => set({ gamePending: pending }),

  recordResult: (result: 'win' | 'loss') => {
    const { rungState, history, promotionEvents } = get();
    const matchup = effectiveMatchup(rungState.currentRung, rungState.lossStreak);
    const ts = Date.now();
    const newEntry: HistoryEntry = {
      rung: rungState.currentRung,
      bot: matchup.bot,
      handicap: matchup.handicap,
      result,
      ts,
    };
    const out = applyResult(rungState, result);
    const newHistory = [...history, newEntry].slice(-HISTORY_CAP);
    const newPromotionEvents = out.promoted && out.fromRung
      ? [...promotionEvents, { from: out.fromRung, to: out.state.currentRung, ts }].slice(-HISTORY_CAP)
      : promotionEvents;
    set({
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
      gamePending: false,
      showRankUp: out.promoted,
      pendingFromRung: out.fromRung,
    });
    persist({
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
    });
  },

  dismissRankUp: () => set({ showRankUp: false, pendingFromRung: null }),

  reset: () => {
    const fresh = freshState();
    set({
      rungState: fresh,
      history: [],
      promotionEvents: [],
      gamePending: false,
      showRankUp: false,
      pendingFromRung: null,
    });
    persist({ rungState: fresh, history: [], promotionEvents: [] });
  },

  setRung: (rung: Rung) => {
    matchupForRung(rung); // throws on invalid rung
    const newRungState: RungState = {
      currentRung: rung,
      winsAtCurrentRung: 0,
      lossStreak: 0,
    };
    const { history, promotionEvents } = get();
    set({
      rungState: newRungState,
      showRankUp: false,
      pendingFromRung: null,
    });
    persist({ rungState: newRungState, history, promotionEvents });
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw) as PersistedState;
      const slot = payload.byBoardSize?.['19x19'];
      if (!slot) return;
      set({
        rungState: slot.rungState ?? freshState(),
        history: slot.history ?? [],
        promotionEvents: slot.promotionEvents ?? [],
      });
    } catch (e) {
      console.warn('Failed to load auto-play state:', e);
    }
  },
}));

// Dev convenience: expose the store on `window.__autoPlayStore` so the
// browser console (and the upcoming feature 23 Profile page's dev tools)
// can poke at state during beta testing. Gated by Vite's DEV flag so
// production builds don't carry it.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __autoPlayStore: typeof useAutoPlayStore }).__autoPlayStore = useAutoPlayStore;
}
