import { create } from 'zustand';
import {
  type Rung,
  type RungState,
  type BoardSize,
  applyResult,
  effectiveMatchup,
  matchupForRung,
  freshState,
  prevRung,
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

/** localStorage key per board, e.g. "9x9" / "19x19". Cross-board ladders are
 *  independent (feature 24): a player's 9×9 progress is separate from 19×19. */
type BoardKey = '9x9' | '13x13' | '19x19';
function boardKey(b: BoardSize): BoardKey {
  return `${b}x${b}` as BoardKey;
}

interface PersistedState {
  byBoardSize: Partial<Record<BoardKey, PersistedSlot>>;
}

interface AutoPlayState {
  /** The board the player is currently laddering on. Defaults to 19×19. */
  boardSize: BoardSize;

  // Active-board slot, mirrored from `slots[boardKey(boardSize)]`.
  rungState: RungState;
  history: HistoryEntry[];
  promotionEvents: PromotionEvent[];
  shadowRating: Rating;

  /** Per-board slots cache (includes the active board, kept in sync). Lets
   *  the player switch boards without losing progress on either. */
  slots: Partial<Record<BoardKey, PersistedSlot>>;

  /** True between when a player taps Play on the match-picker card and when
   *  the resulting game's outcome has been recorded. Used by App.tsx's
   *  game-end effect to fire `recordResult` exactly once per auto-play game. */
  gamePending: boolean;

  /** True when a rank-up celebration is queued. Set in `recordResult` on
   *  successful promotion; cleared by `dismissRankUp`. */
  showRankUp: boolean;
  /** When `showRankUp` is true, the rung the player was promoted FROM. */
  pendingFromRung: Rung | null;

  /** Switch the active ladder board. Snapshots the current board's progress
   *  and loads (or freshly seeds) the target board's. No-op if unchanged. */
  setBoardSize: (boardSize: BoardSize) => void;

  /** Mark a game as pending. Called by AutoPlayView right before
   *  `gameStore.newGame` so App.tsx's effect can correctly tie the
   *  upcoming game's result back to auto-play. */
  setGamePending: (pending: boolean) => void;

  /** Apply a single game result on the active board. Updates state, fires
   *  promotion if applicable, persists, clears `gamePending`. */
  recordResult: (result: 'win' | 'loss') => void;

  /** Dismiss the rank-up celebration overlay. */
  dismissRankUp: () => void;

  /** Reset the active board to a fresh 30k state. Wipes its history and
   *  promotion events; other boards are untouched. */
  reset: () => void;

  /** Snap the active board to a specific rung. Clears `winsAtCurrentRung`
   *  and `lossStreak`. History and promotion events are preserved. */
  setRung: (rung: Rung) => void;

  /** Voluntary player-facing derank (feature 25): step down one rung on the
   *  active board, clearing both counters. No-op at the bottom rung. Unlike
   *  `setRung` (a calibration tool), the shadow rating is left untouched —
   *  the player wants easier games, not a recalibration. */
  derank: () => void;

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

function emptySlot(boardSize: BoardSize): PersistedSlot {
  return { rungState: freshState(boardSize), history: [], promotionEvents: [], shadowRating: freshRating() };
}

/** Extract the active board's slot from the live state. */
function activeSlot(s: Pick<AutoPlayState, 'rungState' | 'history' | 'promotionEvents' | 'shadowRating'>): PersistedSlot {
  return {
    rungState: s.rungState,
    history: s.history,
    promotionEvents: s.promotionEvents,
    shadowRating: s.shadowRating,
  };
}

function persistSlots(slots: Partial<Record<BoardKey, PersistedSlot>>) {
  try {
    const payload: PersistedState = { byBoardSize: slots };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed to save auto-play state:', e);
  }
}

// Note: derived values (current matchup, safeguard-active flag, validation-
// wall flag) are NOT exposed as store methods. Returning freshly-allocated
// objects from a Zustand selector triggers React's "getSnapshot should be
// cached" warning and an infinite re-render loop. Components compute these
// directly from `rungState` + `boardSize` using the matchmaker's pure functions.
export const useAutoPlayStore = create<AutoPlayState>((set, get) => ({
  boardSize: 19,
  rungState: freshState(19),
  history: [],
  promotionEvents: [],
  shadowRating: freshRating(),
  slots: {},
  gamePending: false,
  showRankUp: false,
  pendingFromRung: null,

  setBoardSize: (boardSize: BoardSize) => {
    const s = get();
    if (s.boardSize === boardSize) return;
    // Snapshot the board we're leaving, then load the one we're entering.
    const slots = { ...s.slots, [boardKey(s.boardSize)]: activeSlot(s) };
    const target = slots[boardKey(boardSize)] ?? emptySlot(boardSize);
    set({
      boardSize,
      rungState: target.rungState,
      history: target.history,
      promotionEvents: target.promotionEvents,
      shadowRating: target.shadowRating ?? freshRating(),
      slots,
      showRankUp: false,
      pendingFromRung: null,
    });
  },

  setGamePending: (pending: boolean) => set({ gamePending: pending }),

  recordResult: (result: 'win' | 'loss') => {
    const { boardSize, rungState, history, promotionEvents, shadowRating, slots } = get();
    const matchup = effectiveMatchup(rungState.currentRung, rungState.lossStreak, boardSize);
    const ts = Date.now();
    const newEntry: HistoryEntry = {
      rung: rungState.currentRung,
      bot: matchup.bot,
      handicap: matchup.handicap,
      result,
      ts,
    };
    const out = applyResult(rungState, result, boardSize);
    const newHistory = [...history, newEntry].slice(-HISTORY_CAP);
    const newPromotionEvents = out.promoted && out.fromRung
      ? [...promotionEvents, { from: out.fromRung, to: out.state.currentRung, ts }].slice(-HISTORY_CAP)
      : promotionEvents;
    // Shadow rating update. The matchup's effective opponent strength is
    // the player's CURRENT rung (handicap/komi balances bot rank to player
    // rung by construction), so we compare the player against `currentRung`.
    const oppMu = rankToRating(rungState.currentRung);
    const newShadowRating = updateRating(shadowRating, oppMu, BOT_OPP_PHI, result === 'win' ? 1 : 0);
    const slot: PersistedSlot = {
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
      shadowRating: newShadowRating,
    };
    const newSlots = { ...slots, [boardKey(boardSize)]: slot };
    set({
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
      shadowRating: newShadowRating,
      slots: newSlots,
      gamePending: false,
      showRankUp: out.promoted,
      pendingFromRung: out.fromRung,
    });
    persistSlots(newSlots);
  },

  // Don't clear `pendingFromRung` here — AutoPlayGameEndModal reads it to
  // render a "congrats on reaching N" state for the game that just caused
  // the promotion. It stays set until the next `recordResult` either
  // replaces it with a new fromRung (another promotion) or with null.
  dismissRankUp: () => set({ showRankUp: false }),

  reset: () => {
    const { boardSize, slots } = get();
    const slot = emptySlot(boardSize);
    const newSlots = { ...slots, [boardKey(boardSize)]: slot };
    set({
      rungState: slot.rungState,
      history: slot.history,
      promotionEvents: slot.promotionEvents,
      shadowRating: slot.shadowRating,
      slots: newSlots,
      gamePending: false,
      showRankUp: false,
      pendingFromRung: null,
    });
    persistSlots(newSlots);
  },

  setRung: (rung: Rung) => {
    const { boardSize, history, promotionEvents, slots } = get();
    matchupForRung(rung, boardSize); // throws on invalid rung for this board
    const newRungState: RungState = {
      currentRung: rung,
      winsAtCurrentRung: 0,
      lossStreak: 0,
    };
    // Manual rank set is a calibration tool. Snap the shadow rating to the
    // new rung's anchor with moderate uncertainty (phi=200) so subsequent
    // games can move it freely.
    const newShadow: Rating = { mu: rankToRating(rung), phi: 200, sigma: 0.06 };
    const slot: PersistedSlot = { rungState: newRungState, history, promotionEvents, shadowRating: newShadow };
    const newSlots = { ...slots, [boardKey(boardSize)]: slot };
    set({
      rungState: newRungState,
      shadowRating: newShadow,
      slots: newSlots,
      showRankUp: false,
      pendingFromRung: null,
    });
    persistSlots(newSlots);
  },

  derank: () => {
    const { boardSize, rungState, history, promotionEvents, shadowRating, slots } = get();
    const prev = prevRung(rungState.currentRung, boardSize);
    if (!prev) return;
    const newRungState: RungState = {
      currentRung: prev,
      winsAtCurrentRung: 0,
      lossStreak: 0,
    };
    const slot: PersistedSlot = { rungState: newRungState, history, promotionEvents, shadowRating };
    const newSlots = { ...slots, [boardKey(boardSize)]: slot };
    set({
      rungState: newRungState,
      slots: newSlots,
      showRankUp: false,
      pendingFromRung: null,
    });
    persistSlots(newSlots);
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw) as PersistedState;
      const stored = payload.byBoardSize ?? {};
      const slots: Partial<Record<BoardKey, PersistedSlot>> = {};
      for (const [key, slot] of Object.entries(stored)) {
        if (!slot) continue;
        slots[key as BoardKey] = {
          rungState: slot.rungState,
          history: slot.history ?? [],
          promotionEvents: slot.promotionEvents ?? [],
          shadowRating: slot.shadowRating ?? freshRating(),
        };
      }
      // Active board defaults to 19×19 on load.
      const active = slots['19x19'] ?? emptySlot(19);
      set({
        boardSize: 19,
        rungState: active.rungState ?? freshState(19),
        history: active.history ?? [],
        promotionEvents: active.promotionEvents ?? [],
        shadowRating: active.shadowRating ?? freshRating(),
        slots,
      });
    } catch (e) {
      console.warn('Failed to load auto-play state:', e);
    }
  },
}));

// Dev convenience: expose the store on `window.__autoPlayStore` so the
// browser console (and the feature 23 Profile page's dev tools) can poke at
// state during beta testing. Gated by Vite's DEV flag so production builds
// don't carry it.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __autoPlayStore: typeof useAutoPlayStore }).__autoPlayStore = useAutoPlayStore;
}
