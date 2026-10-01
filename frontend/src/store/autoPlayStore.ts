import { create } from 'zustand';
import {
  type Rung,
  type RungState,
  type BoardSize,
  applyResult,
  effectiveMatchup,
  matchupForRung,
  freshState,
  hasLadder,
  prevRung,
  resolveRung,
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
  /** Ranked undos spent during this game. Recorded from day one so assisted
   *  wins can be discounted in the shadow rating later if needed (fp 26). */
  undosUsed?: number;
}

export interface PromotionEvent {
  from: Rung;
  to: Rung;
  ts: number;
}

export interface PersistedSlot {
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
export type BoardKey = '9x9' | '13x13' | '19x19';
export function boardKey(b: BoardSize): BoardKey {
  return `${b}x${b}` as BoardKey;
}

/** The persisted payload of `goforkids.autoplay.v1`. Also the `ladder` of the
 *  sync state document (feature 32), unchanged. */
export interface PersistedState {
  byBoardSize: Partial<Record<BoardKey, PersistedSlot>>;
  /** Player-level ranked undo bank (0..UNDO_BANK_MAX). Optional for back-compat
   *  with payloads written before banked undos shipped (absent ⇒ full bank). */
  undoBank?: number;
}

/** One finished ranked game, as `recordResult` applies it. Sync (feature 32)
 *  queues these while a device can't push, and re-applies them in order on
 *  top of the server's ladder; `ts` doubles as the history entry's timestamp,
 *  which is how a re-apply recognises a result the server already holds. */
export interface RankedResult {
  boardSize: BoardSize;
  result: 'win' | 'loss';
  undosUsed: number;
  ts: number;
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

  /** Player-level ranked undo bank (0..UNDO_BANK_MAX). Spent by
   *  `gameStore.undo()` in autoplay-context (ranked) games; refilled +1 by
   *  `recordResult` per game finished. Casual / lesson undo ignores this. */
  undoBank: number;

  /** Switch the active ladder board. Snapshots the current board's progress
   *  and loads (or freshly seeds) the target board's. No-op if unchanged. */
  setBoardSize: (boardSize: BoardSize) => void;

  /** Mark a game as pending. Called by AutoPlayView right before
   *  `gameStore.newGame` so App.tsx's effect can correctly tie the
   *  upcoming game's result back to auto-play. */
  setGamePending: (pending: boolean) => void;

  /** Apply a single game result on the active board. Updates state, fires
   *  promotion if applicable, refills one ranked undo (capped), records
   *  `undosUsed` on the history entry, persists, clears `gamePending`. */
  recordResult: (result: 'win' | 'loss', undosUsed?: number) => void;

  /** Spend one ranked undo from the player-level bank. Returns false (no-op)
   *  when the bank is empty. Called by `gameStore.undo()` for ranked games. */
  spendUndo: () => boolean;

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

  /** The persisted payload as it stands (what `goforkids.autoplay.v1` holds). */
  exportLadder: () => PersistedState;

  /** Replace every board's ladder and the undo bank with `payload` (sync,
   *  feature 32), keep the active board, and persist. Stale rungs migrate
   *  exactly as on load. Celebration state is left alone. */
  adoptLadder: (payload: PersistedState) => void;

  /** Log out (feature 32): every board back to a fresh start, a full undo
   *  bank, nothing pending or celebrating. Persists. */
  clearPlayer: () => void;
}

const STORAGE_KEY = 'goforkids.autoplay.v1';
const HISTORY_CAP = 200;

/** Ranked undo bank cap (banked undos, 2026-06-25). Player-level — NOT
 *  per-board. Each ranked undo spends 1; every ranked game finished (win or
 *  loss) refills +1 up to this cap. Casual / lesson games are unlimited and
 *  ignore the bank entirely. Flat model: a misclick and a misplay both cost
 *  one token (bots reply near-instantly, so there's no telling them apart). */
export const UNDO_BANK_MAX = 3;

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

function persistState(slots: Partial<Record<BoardKey, PersistedSlot>>, undoBank: number) {
  try {
    const payload: PersistedState = { byBoardSize: slots, undoBank };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed to save auto-play state:', e);
  }
}

export interface AppliedRankedResult {
  slot: PersistedSlot;
  undoBank: number;
  promoted: boolean;
  fromRung: Rung | null;
}

/**
 * Apply one finished ranked game to its board's slot and the undo bank. Pure.
 * This is the whole of what `recordResult` does to the ladder — the history
 * entry, `applyResult`, the promotion event, the shadow-rating update and the
 * undo refill — so sync can re-apply queued results through the same logic.
 */
export function applyRankedResult(
  slot: PersistedSlot,
  undoBank: number,
  r: RankedResult,
): AppliedRankedResult {
  const { rungState, history, promotionEvents } = slot;
  const shadowRating = slot.shadowRating ?? freshRating();
  const matchup = effectiveMatchup(rungState.currentRung, rungState.lossStreak, r.boardSize);
  const newEntry: HistoryEntry = {
    rung: rungState.currentRung,
    bot: matchup.bot,
    handicap: matchup.handicap,
    result: r.result,
    ts: r.ts,
    undosUsed: r.undosUsed,
  };
  const out = applyResult(rungState, r.result, r.boardSize);
  const newHistory = [...history, newEntry].slice(-HISTORY_CAP);
  const newPromotionEvents = out.promoted && out.fromRung
    ? [...promotionEvents, { from: out.fromRung, to: out.state.currentRung, ts: r.ts }].slice(-HISTORY_CAP)
    : promotionEvents;
  // Shadow rating update. The matchup's effective opponent strength is
  // the player's CURRENT rung (handicap/komi balances bot rank to player
  // rung by construction), so we compare the player against `currentRung`.
  const oppMu = rankToRating(rungState.currentRung);
  const newShadowRating = updateRating(shadowRating, oppMu, BOT_OPP_PHI, r.result === 'win' ? 1 : 0);
  return {
    slot: {
      rungState: out.state,
      history: newHistory,
      promotionEvents: newPromotionEvents,
      shadowRating: newShadowRating,
    },
    // Finishing a ranked game (win OR loss) refills one undo, capped — so the
    // bank trends toward ~1 undo available per game, which covers misclicks.
    undoBank: Math.min(UNDO_BANK_MAX, undoBank + 1),
    promoted: out.promoted,
    fromRung: out.fromRung,
  };
}

/** Parse a persisted payload (from storage or from the sync record) into
 *  clean slots and a clamped undo bank, migrating stale rungs. */
export function normalizeLadder(payload: Partial<PersistedState> | null | undefined): {
  slots: Partial<Record<BoardKey, PersistedSlot>>;
  undoBank: number;
} {
  const stored = payload?.byBoardSize ?? {};
  const slots: Partial<Record<BoardKey, PersistedSlot>> = {};
  for (const [key, slot] of Object.entries(stored)) {
    if (!slot) continue;
    // Migrate a stale saved rung to a valid one on the current ladder.
    // The S44 9×9 rebuild dropped the 21k/23k rungs; a device still
    // parked on one crashed the ranked/profile screen with "Unknown
    // rung" (2026-07-06). resolveRung is a no-op for valid rungs.
    const size = parseInt(key, 10) as BoardSize; // "9x9" → 9
    let rungState = slot.rungState;
    if (rungState?.currentRung) {
      const migrated = resolveRung(rungState.currentRung, size);
      if (migrated !== rungState.currentRung) {
        rungState = { ...rungState, currentRung: migrated };
      }
    }
    slots[key as BoardKey] = {
      rungState,
      history: slot.history ?? [],
      promotionEvents: slot.promotionEvents ?? [],
      shadowRating: slot.shadowRating ?? freshRating(),
    };
  }
  // Undo bank is player-level (clamped; absent in old payloads ⇒ full).
  const undoBank = Math.max(0, Math.min(UNDO_BANK_MAX, payload?.undoBank ?? UNDO_BANK_MAX));
  return { slots, undoBank };
}

/**
 * Re-apply queued ranked results, in order, on top of another copy of the
 * ladder (sync's rebase, feature 32). A result whose timestamp already sits
 * in that board's history is skipped: it reached the server on an earlier
 * push whose reply was lost. Results for a board with no ladder are skipped.
 * Returns the new payload and the results that were actually applied.
 */
export function reapplyRankedResults(
  base: Partial<PersistedState> | null | undefined,
  queued: ReadonlyArray<RankedResult>,
): { ladder: PersistedState; applied: RankedResult[] } {
  const norm = normalizeLadder(base);
  let slots = norm.slots;
  let undoBank = norm.undoBank;
  // Only the base's own history counts as "already there" — not entries
  // this loop adds.
  const held = new Set<string>();
  for (const [key, slot] of Object.entries(slots)) {
    for (const h of slot?.history ?? []) held.add(`${key}|${h.ts}|${h.result}`);
  }
  const applied: RankedResult[] = [];
  for (const r of queued) {
    if (!hasLadder(r.boardSize)) continue;
    const key = boardKey(r.boardSize);
    const slot = slots[key] ?? emptySlot(r.boardSize);
    if (held.has(`${key}|${r.ts}|${r.result}`)) continue;
    const out = applyRankedResult(slot, undoBank, r);
    slots = { ...slots, [key]: out.slot };
    undoBank = out.undoBank;
    applied.push(r);
  }
  return { ladder: { byBoardSize: slots, undoBank }, applied };
}

type RankedResultListener = (r: RankedResult) => void;
const rankedResultListeners = new Set<RankedResultListener>();
const beforeRankedResultListeners = new Set<() => void>();

/** Be called at the very start of `recordResult`, before it reads the
 *  ladder — sync applies a ladder it held back during the game here, so the
 *  game's result lands on top of it. Returns an unsubscribe function. */
export function onBeforeRankedResult(fn: () => void): () => void {
  beforeRankedResultListeners.add(fn);
  return () => {
    beforeRankedResultListeners.delete(fn);
  };
}

/** Be told about every ranked result `recordResult` applies (sync queues them).
 *  Returns an unsubscribe function. */
export function onRankedResult(fn: RankedResultListener): () => void {
  rankedResultListeners.add(fn);
  return () => {
    rankedResultListeners.delete(fn);
  };
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
  undoBank: UNDO_BANK_MAX,

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

  spendUndo: () => {
    const { undoBank, slots } = get();
    if (undoBank <= 0) return false;
    const newUndoBank = undoBank - 1;
    set({ undoBank: newUndoBank });
    persistState(slots, newUndoBank);
    return true;
  },

  recordResult: (result: 'win' | 'loss', undosUsed = 0) => {
    for (const fn of beforeRankedResultListeners) fn();
    const s = get();
    const r: RankedResult = { boardSize: s.boardSize, result, undosUsed, ts: Date.now() };
    const out = applyRankedResult(activeSlot(s), s.undoBank, r);
    const newSlots = { ...s.slots, [boardKey(s.boardSize)]: out.slot };
    set({
      rungState: out.slot.rungState,
      history: out.slot.history,
      promotionEvents: out.slot.promotionEvents,
      shadowRating: out.slot.shadowRating ?? freshRating(),
      slots: newSlots,
      gamePending: false,
      showRankUp: out.promoted,
      pendingFromRung: out.fromRung,
      undoBank: out.undoBank,
    });
    persistState(newSlots, out.undoBank);
    for (const fn of rankedResultListeners) fn(r);
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
    persistState(newSlots, get().undoBank);
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
    persistState(newSlots, get().undoBank);
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
    persistState(newSlots, get().undoBank);
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw) as PersistedState;
      const { slots, undoBank } = normalizeLadder(payload);
      // Active board defaults to 19×19 on load.
      const active = slots['19x19'] ?? emptySlot(19);
      set({
        boardSize: 19,
        rungState: active.rungState ?? freshState(19),
        history: active.history ?? [],
        promotionEvents: active.promotionEvents ?? [],
        shadowRating: active.shadowRating ?? freshRating(),
        slots,
        undoBank,
      });
    } catch (e) {
      console.warn('Failed to load auto-play state:', e);
    }
  },

  exportLadder: () => {
    const { slots, undoBank } = get();
    return { byBoardSize: slots, undoBank };
  },

  adoptLadder: (payload: PersistedState) => {
    const { slots, undoBank } = normalizeLadder(payload);
    const { boardSize } = get();
    const active = slots[boardKey(boardSize)] ?? emptySlot(boardSize);
    set({
      rungState: active.rungState ?? freshState(boardSize),
      history: active.history,
      promotionEvents: active.promotionEvents,
      shadowRating: active.shadowRating ?? freshRating(),
      slots,
      undoBank,
    });
    persistState(slots, undoBank);
  },

  clearPlayer: () => {
    const { boardSize } = get();
    const fresh = emptySlot(boardSize);
    set({
      rungState: fresh.rungState,
      history: fresh.history,
      promotionEvents: fresh.promotionEvents,
      shadowRating: fresh.shadowRating ?? freshRating(),
      slots: {},
      undoBank: UNDO_BANK_MAX,
      gamePending: false,
      showRankUp: false,
      pendingFromRung: null,
    });
    persistState({}, UNDO_BANK_MAX);
  },
}));

// Dev convenience: expose the store on `window.__autoPlayStore` so the
// browser console (and the feature 23 Profile page's dev tools) can poke at
// state during beta testing. Gated by Vite's DEV flag so production builds
// don't carry it.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __autoPlayStore: typeof useAutoPlayStore }).__autoPlayStore = useAutoPlayStore;
}
