import { boardKey, normalizeLadder, useAutoPlayStore, type PersistedSlot } from '../store/autoPlayStore';
import { freshState, type BoardSize } from '../autoplay/matchmaker';

/**
 * The Profile page's board tabs (feature 32, revision 7): one tab per ladder,
 * each showing that board's rank card, graph, derank and Advanced blocks.
 *
 * The auto-play store keeps one "active" board — the one Play plays next and
 * records into (the match-picker's board pills set it). The tabs only LOOK
 * at a board: reading a slot never switches the active board, and the
 * per-board actions (derank, set rung, reset) reach a non-active board
 * through `onBoard`, which hands the active board back afterwards.
 */

export const PROFILE_BOARDS = [9, 19] as const;
export type ProfileBoard = (typeof PROFILE_BOARDS)[number];

export function isProfileBoard(b: unknown): b is ProfileBoard {
  return b === 9 || b === 19;
}

/** The tab the page opens on: the board the caller asked for, else the
 *  active board, else 19×19. */
export function initialProfileTab(requested: BoardSize | null | undefined, active: BoardSize): ProfileBoard {
  if (isProfileBoard(requested)) return requested;
  if (isProfileBoard(active)) return active;
  return 19;
}

/** A board's slot with a shadow rating, as the tabs show it. */
export type BoardSlot = Required<PersistedSlot>;

/** A never-played board, built through the store's own normaliser so the
 *  fresh rung and rating are the store's, not a copy. Stable references, so
 *  a selector returning them doesn't re-render forever. */
const FRESH: Record<ProfileBoard, BoardSlot> = {
  9: freshSlot(9),
  19: freshSlot(19),
};

function freshSlot(board: ProfileBoard): BoardSlot {
  const key = boardKey(board);
  const slot = normalizeLadder({
    byBoardSize: { [key]: { rungState: freshState(board), history: [], promotionEvents: [] } },
  }).slots[key]!;
  return slot as BoardSlot;
}

type AutoPlay = ReturnType<typeof useAutoPlayStore.getState>;

/** The slot for `board`: the live fields when it is the active board, else
 *  its cached slot, else a fresh one. Every field is a reference the store
 *  already holds (or a stable fresh one), so this is safe under useShallow. */
export function boardSlot(s: Pick<AutoPlay, 'boardSize' | 'rungState' | 'history' | 'promotionEvents' | 'shadowRating' | 'slots'>, board: ProfileBoard): BoardSlot {
  if (s.boardSize === board) {
    return { rungState: s.rungState, history: s.history, promotionEvents: s.promotionEvents, shadowRating: s.shadowRating };
  }
  const stored = s.slots[boardKey(board)];
  if (!stored) return FRESH[board];
  return {
    rungState: stored.rungState,
    history: stored.history,
    promotionEvents: stored.promotionEvents,
    shadowRating: stored.shadowRating ?? FRESH[board].shadowRating,
  };
}

/**
 * Run a ladder action on `board` without changing the board Play plays next.
 * The store's actions act on its active board, so: switch to `board`, act,
 * switch back. A switch only snapshots the slot it leaves (sync does not push
 * it), and the actions used here already clear the rank-up state a switch
 * clears.
 */
export function onBoard(board: BoardSize, act: (s: AutoPlay) => void): void {
  const active = useAutoPlayStore.getState().boardSize;
  if (active === board) {
    act(useAutoPlayStore.getState());
    return;
  }
  useAutoPlayStore.getState().setBoardSize(board);
  try {
    act(useAutoPlayStore.getState());
  } finally {
    useAutoPlayStore.getState().setBoardSize(active);
  }
}
