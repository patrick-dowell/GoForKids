import { create } from 'zustand';
import {
  type Rung,
  type RungState,
  applyResult,
  effectiveMatchup,
  matchupForRung,
  freshState,
} from '../autoplay/matchmaker';
import {
  type Rating,
  rankToRating,
  updateRating,
} from '../autoplay/glicko';

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
  /** Glicko-2 shadow rating. Updated per game; does NOT drive promotion
   *  in v1 (linear ladder is authoritative). Surfaced on the Profile page's
   *  Advanced tab. Optional in the schema for backward compat with
   *  payloads written before feature 23 landed. */
  shadowRating?: Rating;
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
  shadowRating: Rating;

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

/** Glicko-2 opponent uncertainty assumed for bot matches. Bots have
 *  well-calibrated strength (each rank validated against thousands of
 *  Fox games), so phi=100 is appropriate vs a default of 350. */
const BOT_OPP_PHI = 100;

/** Initial shadow rating for a brand-new player: seeded at the 30k rung
 *  with full prior uncertainty (phi=350) so the rating converges fast
 *  during the first ~15 games. */
function freshRating(): Rating {
  return { mu: rankToRating('30k'), phi: 350, sigma: 0.06 };
}

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
  shadowRating: freshRating(),
  gamePending: false,
  showRankUp: false,
  pendingFromRung: null,

  setGamePending: (pending: boolean) => set({ gamePending: pending }),

  recordResult: (result: 'win' | 'loss') => {
    const { rungState, history, promotionEvents, shadowRating } = get();
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
    // Shadow rating update. The matchup's effective opponent strength is
    // the player's CURRENT rung (handicap balances bot rank to player rung
    // by construction), so we compare the player against `currentRung` —
    // not against the raw bot rank.
    const oppMu = rankToRating(rungState.currentRung);
    const newShadowRating = updateRating(shadowRating, oppMu, BOT_OPP_PHI, result === 'win' ? 1 : 0);
    set({
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
      shadowRating: newShadowRating,
      gamePending: false,
      showRankUp: out.promoted,
      pendingFromRung: out.fromRung,
    });
    persist({
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
      shadowRating: newShadowRating,
    });
  },

  dismissRankUp: () => set({ showRankUp: false, pendingFromRung: null }),

  reset: () => {
    const fresh = freshState();
    const rating = freshRating();
    set({
      rungState: fresh,
      history: [],
      promotionEvents: [],
      shadowRating: rating,
      gamePending: false,
      showRankUp: false,
      pendingFromRung: null,
    });
    persist({ rungState: fresh, history: [], promotionEvents: [], shadowRating: rating });
  },

  setRung: (rung: Rung) => {
    matchupForRung(rung); // throws on invalid rung
    const newRungState: RungState = {
      currentRung: rung,
      winsAtCurrentRung: 0,
      lossStreak: 0,
    };
    // Manual rank set is a calibration tool. Snap the shadow rating to the
    // new rung's anchor with moderate uncertainty (phi=200) so subsequent
    // games can move it freely. Avoids leaving the shadow stuck at an
    // old value if the user jumped from 30k to 6k.
    const newShadow: Rating = { mu: rankToRating(rung), phi: 200, sigma: 0.06 };
    const { history, promotionEvents } = get();
    set({
      rungState: newRungState,
      shadowRating: newShadow,
      showRankUp: false,
      pendingFromRung: null,
    });
    persist({ rungState: newRungState, history, promotionEvents, shadowRating: newShadow });
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
        shadowRating: slot.shadowRating ?? freshRating(),
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
