import { useEffect } from 'react';
import { create } from 'zustand';
import { ApiError } from '../api/client';
import {
  friendsApi,
  type FriendCard,
  type FriendEntry,
  type FriendGameEntry,
  type FriendRequestEntry,
  type FriendsFeed,
} from '../api/sync';
import { isFriendCode, normalizeFriendCode, sendOutcome, type SendOutcome } from '../profile/friends';
import { replayToOpen } from '../profile/friendsFeed';
import { useReplayStore } from './replayStore';
import { useSyncStore } from './syncStore';

/**
 * The Friends section's data and actions (feature 32, revisions 4 and 5).
 * Every request goes through the sync store's `friendsRequest`, which takes
 * the 401 path on a 401.
 *
 * Held in memory only: nothing here is ever written to storage. It is
 * dropped whenever this device's token changes (a log out, a 401, a log in
 * to another profile), and a reply still on its way then is dropped too.
 *
 * When it loads (revision 5):
 *   - the lists, after every sync pass that ends logged in (so the requests
 *     received, and the badge counting them, are known from launch on), and
 *     whenever the app comes back to the screen;
 *   - everything (code, lists, feed) when the Friends section opens, after
 *     each action, from its Refresh button, and every 30 seconds while a
 *     watcher is mounted (`useFriendsWatch`): the section watches all three;
 *     a screen that only shows the requests badge may watch the lists.
 * Nothing is asked while this device is logged out.
 */

/** The three things a load can ask for. */
export type FriendsPart = 'code' | 'list' | 'feed';
const ALL: readonly FriendsPart[] = ['code', 'list', 'feed'];

/** How often a mounted watcher refreshes. */
export const FRIENDS_REFRESH_MS = 30_000;

interface FriendsData {
  /** This profile's friend code; null until loaded. */
  code: string | null;
  /** Accepted friends, newest first; null until loaded. */
  friends: FriendEntry[] | null;
  /** Pending requests to this player, newest first; null until loaded. The
   *  requests badge reads `incoming?.length ?? 0`. */
  incoming: FriendRequestEntry[] | null;
  /** What friends did lately, and who is online; null until loaded. */
  feed: FriendsFeed | null;
  /** Whose card is open, and the card once it has come. */
  cardFor: string | null;
  card: FriendCard | null;
  /** The open card's friend's replays, newest first; null until loaded. */
  cardGames: FriendGameEntry[] | null;
  /** Loading the open card's replays failed. */
  cardGamesFailed: boolean;
}

interface FriendsState extends FriendsData {
  /** A load of the lists is on its way. */
  loading: boolean;
  /** The latest load of some part failed (offline, a 5xx, a 429). */
  loadFailed: boolean;

  /** Load the code, both lists and the feed (or only `parts`). Never throws;
   *  makes no request when this device isn't logged in. */
  refresh: (parts?: readonly FriendsPart[]) => Promise<void>;
  /** Load the lists only (the requests badge). Never throws. */
  refreshList: () => Promise<void>;
  /** Replace the friend code; the old one stops working at once. */
  newCode: () => Promise<void>;
  /** Send a request to the player with this code, as typed. A code that
   *  isn't one is caught here, without a request. Never throws. */
  send: (typed: string) => Promise<SendOutcome>;
  accept: (playerId: string) => Promise<void>;
  decline: (playerId: string) => Promise<void>;
  /** Open a friend's card, then load their replays. A 404 (no longer
   *  friends) closes it and throws. */
  openCard: (playerId: string) => Promise<void>;
  closeCard: () => void;
  /** Remove a friend; their card closes. */
  remove: (playerId: string) => Promise<void>;
  /** Fetch one of the open card's friend's replays and open it in the replay
   *  viewer, the way the Library opens one. Throws on failure: a 404 (the
   *  game, or the friendship, is gone) first brings the section up to date;
   *  `FriendReplayUnreadable` when the replay can't be shown. */
  openGame: (playerId: string, gameId: string) => Promise<void>;
}

/** A friend's replay came back in a shape the viewer can't take. */
export class FriendReplayUnreadable extends Error {
  constructor() {
    super('friends: a replay that cannot be shown');
    this.name = 'FriendReplayUnreadable';
  }
}

const EMPTY: FriendsData & { loading: boolean; loadFailed: boolean } = {
  code: null,
  friends: null,
  incoming: null,
  feed: null,
  cardFor: null,
  card: null,
  cardGames: null,
  cardGamesFailed: false,
  loading: false,
  loadFailed: false,
};

/** Per part, bumped by every load of it (and every drop), so an older reply
 *  never lands over a newer one. */
const seq: Record<FriendsPart, number> = { code: 0, list: 0, feed: 0 };
/** Whether each part's latest load failed. */
const failed: Record<FriendsPart, boolean> = { code: false, list: false, feed: false };
/** Bumped by every load of a card's replays. */
let gamesSeq = 0;

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

  const markFailed = (part: FriendsPart, didFail: boolean) => {
    failed[part] = didFail;
    set({ loadFailed: failed.code || failed.list || failed.feed });
  };

  const loadCode = async () => {
    const mine = ++seq.code;
    try {
      const res = await call((t) => friendsApi.getCode(t));
      if (mine !== seq.code) return;
      if (typeof res?.code === 'string') set({ code: res.code });
      markFailed('code', false);
    } catch {
      if (mine === seq.code) markFailed('code', true);
    }
  };

  const loadList = async () => {
    const mine = ++seq.list;
    set({ loading: true });
    try {
      const list = await call((t) => friendsApi.list(t));
      if (mine !== seq.list) return;
      const patch: Partial<FriendsState> = { friends: list.friends, incoming: list.incoming };
      // A friend who is gone from the list takes their open card along.
      const open = get().cardFor;
      if (open && !list.friends.some((f) => f?.player_id === open)) {
        Object.assign(patch, { cardFor: null, card: null, cardGames: null, cardGamesFailed: false });
      }
      set(patch);
      markFailed('list', false);
    } catch {
      if (mine === seq.list) markFailed('list', true);
    } finally {
      if (mine === seq.list) set({ loading: false });
    }
  };

  const loadFeed = async () => {
    const mine = ++seq.feed;
    try {
      const feed = await call((t) => friendsApi.feed(t));
      if (mine !== seq.feed) return;
      set({ feed });
      markFailed('feed', false);
    } catch {
      if (mine === seq.feed) markFailed('feed', true);
    }
  };

  const loaders: Record<FriendsPart, () => Promise<void>> = { code: loadCode, list: loadList, feed: loadFeed };

  /** The open card's friend's replays. A 404 means they are no longer
   *  friends: the section catches up, which closes the card. */
  const loadCardGames = async (playerId: string) => {
    const mine = ++gamesSeq;
    try {
      const games = await call((t) => friendsApi.games(t, playerId));
      if (mine === gamesSeq && get().cardFor === playerId) set({ cardGames: games, cardGamesFailed: false });
    } catch (err) {
      if (mine !== gamesSeq || get().cardFor !== playerId) return;
      set({ cardGames: null, cardGamesFailed: true });
      if (err instanceof ApiError && err.status === 404) await get().refresh();
    }
  };

  return {
    ...EMPTY,

    refresh: async (parts = ALL) => {
      if (!useSyncStore.getState().deviceToken) return;
      await Promise.all(ALL.filter((part) => parts.includes(part)).map((part) => loaders[part]()));
    },

    refreshList: () => get().refresh(['list']),

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
      gamesSeq++;
      set({ cardFor: playerId, card: null, cardGames: null, cardGamesFailed: false });
      try {
        const card = await call((t) => friendsApi.card(t, playerId));
        // Closed, another opened, or the data dropped meanwhile: not shown.
        if (get().cardFor !== playerId) return;
        set({ card });
      } catch (err) {
        if (get().cardFor === playerId) set({ cardFor: null, card: null });
        // No longer friends: the list catches up.
        if (err instanceof ApiError && err.status === 404) await get().refresh();
        throw err;
      }
      // Not awaited: the card shows while its replays are on their way.
      void loadCardGames(playerId);
    },

    closeCard: () => {
      gamesSeq++;
      set({ cardFor: null, card: null, cardGames: null, cardGamesFailed: false });
    },

    remove: async (playerId) => {
      await act(async (t) => {
        await friendsApi.remove(t, playerId);
        if (get().cardFor === playerId) get().closeCard();
      });
    },

    openGame: async (playerId, gameId) => {
      let found;
      try {
        found = await call(async (t) => ({ game: await friendsApi.game(t, playerId, gameId), token: t }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // The game, or the friendship, is gone: the list catches up (which
          // closes a gone friend's card), and an open card its replays.
          await get().refresh();
          if (get().cardFor === playerId) await loadCardGames(playerId);
        }
        throw err;
      }
      // Logged out meanwhile: nothing opens.
      if (!current(found.token)) return;
      const replay = replayToOpen(found.game);
      if (!replay) throw new FriendReplayUnreadable();
      useReplayStore.getState().loadGame(replay.sgf, replay.meta);
    },
  };
});

/** Drop everything: nothing about other players outlives this device's
 *  standing on its profile. */
function drop() {
  for (const part of ALL) {
    seq[part]++;
    failed[part] = false;
  }
  gamesSeq++;
  useFriendsStore.setState({ ...EMPTY });
}

useSyncStore.subscribe((s, prev) => {
  // A log out, a 401 or a log in to another profile changes the token.
  if (s.deviceToken !== prev.deviceToken) drop();
  // A sync pass ended, logged in (at launch, after a log in or a create, and
  // after every later pass): the requests received catch up, so a badge
  // counting them is right from the home screen on.
  if (prev.syncing && !s.syncing && s.deviceToken) void useFriendsStore.getState().refreshList();
});

/* ------------------------------------------------------------------------- *
 * Watchers: refresh every FRIENDS_REFRESH_MS while one is mounted.
 * ------------------------------------------------------------------------- */

const watches = new Map<number, readonly FriendsPart[]>();
let watchIds = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** What the mounted watchers want, or just the lists when none is mounted. */
function watchedParts(): FriendsPart[] {
  const parts = new Set<FriendsPart>(['list']);
  for (const p of watches.values()) for (const part of p) parts.add(part);
  return ALL.filter((part) => parts.has(part));
}

/** Refresh `parts` every FRIENDS_REFRESH_MS until the returned function is
 *  called. The lists are always among them. No request while logged out. */
export function watchFriends(parts: readonly FriendsPart[]): () => void {
  const id = ++watchIds;
  watches.set(id, parts);
  if (timer === null) {
    timer = setInterval(() => void useFriendsStore.getState().refresh(watchedParts()), FRIENDS_REFRESH_MS);
  }
  return () => {
    watches.delete(id);
    if (watches.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** React: keep these parts fresh while the calling component is mounted.
 *  The Friends section passes all three; a screen that shows only the
 *  requests badge can pass `['list']`. */
export function useFriendsWatch(parts: readonly FriendsPart[] = ALL): void {
  const key = ALL.filter((p) => parts.includes(p)).join(',');
  useEffect(() => watchFriends(key.split(',') as FriendsPart[]), [key]);
}

// The app came back to the screen: whatever is watched catches up (the lists
// at least, for the badge).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void useFriendsStore.getState().refresh(watchedParts());
  });
}

// Dev convenience, like the other stores.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __friendsStore: typeof useFriendsStore }).__friendsStore = useFriendsStore;
}
