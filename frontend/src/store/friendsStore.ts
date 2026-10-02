import { create } from 'zustand';
import { ApiError } from '../api/client';
import { friendsApi, type FriendCard, type FriendEntry, type FriendRequestEntry } from '../api/sync';
import { isFriendCode, normalizeFriendCode, sendOutcome, type SendOutcome } from '../profile/friends';
import { useSyncStore } from './syncStore';

/**
 * The Friends section's data and actions (feature 32, revision 4). Every
 * request goes through the sync store's `friendsRequest`, which takes the
 * 401 path on a 401.
 *
 * Held in memory only: nothing here is ever written to storage. It is
 * dropped whenever this device's token changes (a log out, a 401, a log in
 * to another profile), and a reply still on its way then is dropped too.
 *
 * The section refreshes when the Profile page opens and after each action;
 * nothing here polls.
 */

interface FriendsData {
  /** This profile's friend code; null until loaded. */
  code: string | null;
  /** Accepted friends, newest first; null until loaded. */
  friends: FriendEntry[] | null;
  /** Pending requests to this player, newest first; null until loaded. */
  incoming: FriendRequestEntry[] | null;
  /** Whose card is open, and the card once it has come. */
  cardFor: string | null;
  card: FriendCard | null;
}

interface FriendsState extends FriendsData {
  loading: boolean;
  /** The latest load failed (offline, a 5xx). */
  loadFailed: boolean;

  /** Load the code and both lists. Never throws; makes no request when this
   *  device isn't logged in. */
  refresh: () => Promise<void>;
  /** Replace the friend code; the old one stops working at once. */
  newCode: () => Promise<void>;
  /** Send a request to the player with this code, as typed. A code that
   *  isn't one is caught here, without a request. Never throws. */
  send: (typed: string) => Promise<SendOutcome>;
  accept: (playerId: string) => Promise<void>;
  decline: (playerId: string) => Promise<void>;
  /** Open a friend's card. A 404 (no longer friends) closes it and throws. */
  openCard: (playerId: string) => Promise<void>;
  closeCard: () => void;
  /** Remove a friend; their card closes. */
  remove: (playerId: string) => Promise<void>;
}

const EMPTY: FriendsData & { loading: boolean; loadFailed: boolean } = {
  code: null,
  friends: null,
  incoming: null,
  cardFor: null,
  card: null,
  loading: false,
  loadFailed: false,
};

/** Bumped by every load (and every drop), so an older reply never lands. */
let loadSeq = 0;

function call<T>(fn: (token: string) => Promise<T>): Promise<T> {
  return useSyncStore.getState().friendsRequest(fn);
}

export const useFriendsStore = create<FriendsState>((set, get) => {
  /** Run an action, then show the section as it now is (a refresh makes no
   *  request once this device is logged out). */
  const act = async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await call(fn);
    } finally {
      await get().refresh();
    }
  };

  /** Still logged into the profile this token belongs to. */
  const current = (token: string) => useSyncStore.getState().deviceToken === token;

  return {
    ...EMPTY,

    refresh: async () => {
      const seq = ++loadSeq;
      if (!useSyncStore.getState().deviceToken) return;
      set({ loading: true });
      try {
        const [code, list] = await Promise.allSettled([
          call((t) => friendsApi.getCode(t)),
          call((t) => friendsApi.list(t)),
        ]);
        if (seq !== loadSeq) return;
        const patch: Partial<FriendsState> = {
          loadFailed: code.status === 'rejected' || list.status === 'rejected',
        };
        if (code.status === 'fulfilled' && typeof code.value?.code === 'string') patch.code = code.value.code;
        if (list.status === 'fulfilled') {
          patch.friends = list.value.friends;
          patch.incoming = list.value.incoming;
          // A friend who is gone from the list takes their open card along.
          const open = get().cardFor;
          if (open && !list.value.friends.some((f) => f?.player_id === open)) {
            patch.cardFor = null;
            patch.card = null;
          }
        }
        set(patch);
      } finally {
        if (seq === loadSeq) set({ loading: false });
      }
    },

    newCode: async () => {
      await act(async (t) => {
        const res = await friendsApi.newCode(t);
        if (current(t) && typeof res?.code === 'string') set({ code: res.code });
      });
    },

    send: async (typed) => {
      const code = normalizeFriendCode(typed);
      if (!isFriendCode(code)) return 'not-a-code';
      try {
        await act((t) => friendsApi.sendRequest(t, code));
        return 'sent';
      } catch (e) {
        return sendOutcome(e instanceof ApiError ? e.status : null, code);
      }
    },

    accept: async (playerId) => {
      await act((t) => friendsApi.accept(t, playerId));
    },

    decline: async (playerId) => {
      await act((t) => friendsApi.decline(t, playerId));
    },

    openCard: async (playerId) => {
      set({ cardFor: playerId, card: null });
      try {
        const card = await call((t) => friendsApi.card(t, playerId));
        // Closed, another opened, or the data dropped meanwhile: not shown.
        if (get().cardFor === playerId) set({ card });
      } catch (err) {
        if (get().cardFor === playerId) set({ cardFor: null, card: null });
        // No longer friends: the list catches up.
        if (err instanceof ApiError && err.status === 404) await get().refresh();
        throw err;
      }
    },

    closeCard: () => set({ cardFor: null, card: null }),

    remove: async (playerId) => {
      await act(async (t) => {
        await friendsApi.remove(t, playerId);
        if (get().cardFor === playerId) set({ cardFor: null, card: null });
      });
    },
  };
});

/** Drop everything: nothing about other players outlives this device's
 *  standing on its profile. */
function drop() {
  loadSeq++;
  useFriendsStore.setState({ ...EMPTY });
}

// A log out, a 401 or a log in to another profile changes the token.
useSyncStore.subscribe((s, prev) => {
  if (s.deviceToken !== prev.deviceToken) drop();
});

// Dev convenience, like the other stores.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __friendsStore: typeof useFriendsStore }).__friendsStore = useFriendsStore;
}
