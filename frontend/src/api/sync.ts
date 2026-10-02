/**
 * Sync API (feature 32): the ten routes under `/api/sync`, revision 3's five
 * admin routes under `/api/sync/admin`, and revision 4's eight friends
 * routes under `/api/sync/friends`, coded to the contract in
 * feature_plans/32_sync_foundation.md. Rides the shared
 * `request` helper in client.ts (base URL, timeout, network retry); a non-OK
 * response arrives as an `ApiError` carrying its status and JSON body.
 *
 * A linked device authenticates with `Authorization: Bearer <device_token>`.
 * Nothing in this module is called for a device that is not linked.
 */

import { ApiError, request, requestWithStatus } from './client';
import type { PersistedState } from '../store/autoPlayStore';
import type { SavedGame } from '../store/libraryStore';

/** The synced state document. Its top-level keys are only these six — the
 *  server answers 422 to any other key. There is no free-text name: the
 *  player's name travels as `handle`, two word-list positions. Settings are
 *  not synced. */
export interface SyncStateDoc {
  schema: 1;
  /** The persisted payload of `goforkids.autoplay.v1`, unchanged. */
  ladder: PersistedState;
  /** The persisted array of `goforkids-learn-progress`. */
  lessons: string[];
  avatar: string;
  avatarPicked: boolean;
  /** The generated name as [adjective, noun] positions (0–63 each). May be
   *  absent (a record made before names existed). */
  handle?: [number, number];
}

export interface RemoteState {
  rev: number;
  state: SyncStateDoc;
}

/** `GET /state` (revision 3) also says whether this device's profile is an
 *  admin and gives this device's own id. */
export interface StateReply extends RemoteState {
  admin?: boolean;
  device_id?: string;
}

/** One device of a profile, as the admin list shows it. Times are
 *  `YYYY-MM-DDTHH:MM:SSZ`; `last_seen_at` is null until the device is seen. */
export interface AdminDevice {
  device_id: string;
  created_at: string;
  last_seen_at: string | null;
  /** What the device said it was ('iPad' | 'iPhone' | 'web'), or null for a
   *  row written before devices reported a kind and not seen since. */
  kind: string | null;
}

/** One board of a profile in the admin list: the stored rung (null when
 *  missing or malformed) and how many ranked games its history holds. */
export interface AdminBoard {
  rung: string | null;
  games: number;
}

/** `GET /admin/players`: the profiles, and when the server began recording
 *  `last_seen_at` (a device row with no stamp from before then was last used
 *  before it, not never). */
export interface AdminList {
  players: AdminPlayer[];
  lastSeenSince: string | null;
}

/** One entry of `GET /admin/players`. */
export interface AdminPlayer {
  player_id: string;
  handle: [number, number] | null;
  boards: Record<string, AdminBoard>;
  devices: AdminDevice[];
  replays: number;
  created_at: string;
  updated_at: string;
  no_device_since: string | null;
  /** Null while the profile has a device; otherwise whole days left before
   *  the cleanup deletes it, rounded up, never below 0. */
  days_left: number | null;
}

/** One accepted friend in `GET /friends` (revision 4). `since` is when the
 *  request was accepted, `YYYY-MM-DDTHH:MM:SSZ`. */
export interface FriendEntry {
  player_id: string;
  handle: [number, number] | null;
  avatar: string;
  since: string;
}

/** One pending request to this player in `GET /friends`. `sent_at` is when
 *  the request was first sent. */
export interface FriendRequestEntry {
  player_id: string;
  handle: [number, number] | null;
  avatar: string;
  sent_at: string;
}

export interface FriendsList {
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
}

/** One ranked result on a friend's card: `ts` is epoch ms. */
export interface FriendResult {
  board: string;
  result: 'win' | 'loss';
  rung: string | null;
  ts: number;
}

/** `GET /friends/{player_id}`: only values the server has checked. `boards`
 *  has the admin list's shape (a rung or null, and a game count). */
export interface FriendCard {
  player_id: string;
  handle: [number, number] | null;
  avatar: string;
  boards: Record<string, AdminBoard>;
  games: number;
  recent: FriendResult[];
}

/** One friend in `GET /friends/feed` (revision 5): the list entry's name
 *  and avatar, the card's boards, and whether a device of theirs was seen
 *  in the last ten minutes. */
export interface FeedFriend {
  player_id: string;
  handle: [number, number] | null;
  avatar: string;
  active_recently: boolean;
  boards: Record<string, AdminBoard>;
}

/** One feed event: a ranked result (`bot` is the rung of the bot played, or
 *  null) or a promotion (`to` is the new rung). `ts` is epoch ms. */
export type FeedEvent =
  | {
      kind: 'game';
      player_id: string;
      handle: [number, number] | null;
      avatar: string;
      board: string;
      result: 'win' | 'loss';
      rung: string | null;
      bot: string | null;
      ts: number;
    }
  | {
      kind: 'promotion';
      player_id: string;
      handle: [number, number] | null;
      avatar: string;
      board: string;
      from: string | null;
      to: string;
      ts: number;
    };

/** `GET /friends/feed`: every friend, and the newest 50 events across them. */
export interface FriendsFeed {
  friends: FeedFriend[];
  events: FeedEvent[];
}

/** One of a friend's replays in `GET /friends/{id}/games`: `board` is a
 *  card board key or null, `outcome` is for the friend (`watched` for a bot
 *  game they watched), `opponent` the bot's rung. */
export interface FriendGameEntry {
  id: string;
  /** ISO 8601. */
  date: string;
  board: string | null;
  outcome: 'win' | 'loss' | 'watched' | null;
  opponent: string | null;
}

/** `GET /friends/{id}/games/{game_id}`: the replay rebuilt from checked
 *  values (no share code, no backend game id, no diagnostic log). */
export interface FriendGame {
  id: string;
  date: string;
  payload: Partial<SavedGame>;
}

/** What `POST /players` and `POST /pairing-codes/redeem` hand back. */
export interface DeviceGrant extends RemoteState {
  player_id: string;
  device_token: string;
}

export interface PairingCode {
  code: string;
  /** ISO 8601. */
  expires_at: string;
}

export interface RemoteGameEntry {
  id: string;
  /** ISO 8601. */
  date: string;
}

export interface RemoteGame extends RemoteGameEntry {
  payload: SavedGame;
}

/** `PUT /state` either lands (`rev = base_rev + 1`) or conflicts (409) with
 *  the server's copy, which the caller rebases onto. */
export type PutStateResult =
  | { ok: true; rev: number }
  | { ok: false; rev: number; state: SyncStateDoc };

const BASE = '/sync';

/** What this device tells the server it is, in `X-Device-Kind`. The native
 *  shell injects `window.kataGo` on every iOS build, so its presence means
 *  the iPad or iPhone app; anything else is a browser. Not personal: the
 *  admin list uses it to tell an iPad row from a browser row. */
export type DeviceKind = 'iPad' | 'iPhone' | 'web';

export function deviceKind(): DeviceKind {
  if (typeof window === 'undefined' || !window.kataGo) return 'web';
  return /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'iPad';
}

function authed(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Device-Kind': deviceKind(),
    },
  };
}

/** Headers for the two requests that make a device row without a token. */
function unauthed(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Device-Kind': deviceKind() };
}

function gamePath(id: string): string {
  return `${BASE}/games/${encodeURIComponent(id)}`;
}

/** The replay as it goes to the server: the bot's diagnostic log stays on
 *  the device. Everything else in the SavedGame rides as-is. */
export function replayPayload(game: SavedGame): SavedGame {
  const { selectorLog: _omit, ...rest } = game;
  void _omit;
  return rest;
}

export const syncApi = {
  /** Create the profile. `createKey` makes a repeat safe (revision 2.1): the
   *  server answers 201 for a new profile, or 200 with the profile an earlier
   *  attempt with the same key already made (its current rev and state, and
   *  a fresh token; the `state` sent this time is ignored). */
  createPlayer: async (
    state: SyncStateDoc,
    createKey: string,
  ): Promise<{ repeated: boolean; grant: DeviceGrant }> => {
    const res = await requestWithStatus<DeviceGrant>(`${BASE}/players`, {
      method: 'POST',
      headers: unauthed(),
      body: JSON.stringify({ state, create_key: createKey }),
    });
    return { repeated: res.status === 200, grant: res.body };
  },

  mintPairingCode: (token: string): Promise<PairingCode> =>
    request<PairingCode>(`${BASE}/pairing-codes`, authed(token, { method: 'POST' })),

  redeemPairingCode: (code: string): Promise<DeviceGrant> =>
    request<DeviceGrant>(`${BASE}/pairing-codes/redeem`, {
      method: 'POST',
      headers: unauthed(),
      body: JSON.stringify({ code }),
    }),

  getState: (token: string): Promise<StateReply> =>
    request<StateReply>(`${BASE}/state`, authed(token)),

  putState: async (token: string, baseRev: number, state: SyncStateDoc): Promise<PutStateResult> => {
    try {
      const res = await request<{ rev: number }>(
        `${BASE}/state`,
        authed(token, { method: 'PUT', body: JSON.stringify({ base_rev: baseRev, state }) }),
      );
      return { ok: true, rev: res.rev };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as Partial<RemoteState> | null;
        if (body && typeof body.rev === 'number' && body.state) {
          return { ok: false, rev: body.rev, state: body.state };
        }
      }
      throw e;
    }
  },

  listGames: async (token: string): Promise<RemoteGameEntry[]> => {
    const res = await request<{ games: RemoteGameEntry[] }>(`${BASE}/games`, authed(token));
    return Array.isArray(res?.games) ? res.games : [];
  },

  getGame: (token: string, id: string): Promise<RemoteGame> =>
    request<RemoteGame>(gamePath(id), authed(token)),

  putGame: async (token: string, game: SavedGame): Promise<boolean> => {
    const res = await request<{ kept: boolean }>(
      gamePath(game.id),
      authed(token, {
        method: 'PUT',
        body: JSON.stringify({ date: game.date, payload: replayPayload(game) }),
      }),
    );
    return res?.kept !== false;
  },

  deleteGame: (token: string, id: string): Promise<void> =>
    request<void>(gamePath(id), authed(token, { method: 'DELETE' })),

  revokeDevice: (token: string): Promise<void> =>
    request<void>(`${BASE}/devices/current`, authed(token, { method: 'DELETE' })),
};

/**
 * The admin routes (revision 3), for a device of a profile listed as an
 * admin on the server. Any other device gets 403 from every one of them.
 * Nothing here carries the admin's labels: those stay on the device.
 */
export const adminApi = {
  listPlayers: async (token: string): Promise<AdminList> => {
    const res = await request<{ players: AdminPlayer[]; last_seen_since?: string | null }>(
      `${BASE}/admin/players`,
      authed(token),
    );
    return {
      players: Array.isArray(res?.players) ? res.players : [],
      lastSeenSince: typeof res?.last_seen_since === 'string' ? res.last_seen_since : null,
    };
  },

  createPlayer: (token: string, state: SyncStateDoc): Promise<{ player_id: string; rev: number }> =>
    request<{ player_id: string; rev: number }>(
      `${BASE}/admin/players`,
      authed(token, { method: 'POST', body: JSON.stringify({ state }) }),
    ),

  /** `expiresAt` is sent as given: the caller passes `toISOString()`. */
  mintCode: (token: string, playerId: string, expiresAt: string): Promise<PairingCode> =>
    request<PairingCode>(
      `${BASE}/admin/players/${encodeURIComponent(playerId)}/pairing-codes`,
      authed(token, { method: 'POST', body: JSON.stringify({ expires_at: expiresAt }) }),
    ),

  removeDevice: (token: string, deviceId: string): Promise<void> =>
    request<void>(`${BASE}/admin/devices/${encodeURIComponent(deviceId)}`, authed(token, { method: 'DELETE' })),

  signOutPlayer: (token: string, playerId: string): Promise<void> =>
    request<void>(
      `${BASE}/admin/players/${encodeURIComponent(playerId)}/devices`,
      authed(token, { method: 'DELETE' }),
    ),
};

/**
 * The friends routes (revision 4, and revision 5's feed and a friend's
 * replays), for a logged-in device. The only thing a player types here is a
 * friend code, and it goes only into the body of `POST /friends/requests`.
 */
export const friendsApi = {
  getCode: (token: string): Promise<{ code: string }> =>
    request<{ code: string }>(`${BASE}/friends/code`, authed(token)),

  /** A new code; the old one stops working at once. */
  newCode: (token: string): Promise<{ code: string }> =>
    request<{ code: string }>(`${BASE}/friends/code`, authed(token, { method: 'POST' })),

  /** `code` is sent as given: the caller normalises it first. 202 whatever
   *  the state between the two players. */
  sendRequest: (token: string, code: string): Promise<void> =>
    request<unknown>(`${BASE}/friends/requests`, authed(token, { method: 'POST', body: JSON.stringify({ code }) })).then(
      () => undefined,
    ),

  list: async (token: string): Promise<FriendsList> => {
    const res = await request<Partial<FriendsList>>(`${BASE}/friends`, authed(token));
    return {
      friends: Array.isArray(res?.friends) ? res.friends : [],
      incoming: Array.isArray(res?.incoming) ? res.incoming : [],
    };
  },

  accept: (token: string, playerId: string): Promise<void> =>
    request<void>(
      `${BASE}/friends/requests/${encodeURIComponent(playerId)}/accept`,
      authed(token, { method: 'POST' }),
    ),

  decline: (token: string, playerId: string): Promise<void> =>
    request<void>(
      `${BASE}/friends/requests/${encodeURIComponent(playerId)}/decline`,
      authed(token, { method: 'POST' }),
    ),

  card: (token: string, playerId: string): Promise<FriendCard> =>
    request<FriendCard>(`${BASE}/friends/${encodeURIComponent(playerId)}`, authed(token)),

  remove: (token: string, playerId: string): Promise<void> =>
    request<void>(`${BASE}/friends/${encodeURIComponent(playerId)}`, authed(token, { method: 'DELETE' })),

  /** Revision 5: what friends did lately. */
  feed: async (token: string): Promise<FriendsFeed> => {
    const res = await request<Partial<FriendsFeed>>(`${BASE}/friends/feed`, authed(token));
    return {
      friends: Array.isArray(res?.friends) ? res.friends : [],
      events: Array.isArray(res?.events) ? res.events : [],
    };
  },

  /** A friend's replays, newest 20. 404 for anyone who is not a friend. */
  games: async (token: string, playerId: string): Promise<FriendGameEntry[]> => {
    const res = await request<{ games?: unknown }>(
      `${BASE}/friends/${encodeURIComponent(playerId)}/games`,
      authed(token),
    );
    return Array.isArray(res?.games) ? (res.games as FriendGameEntry[]) : [];
  },

  game: (token: string, playerId: string, gameId: string): Promise<FriendGame> =>
    request<FriendGame>(
      `${BASE}/friends/${encodeURIComponent(playerId)}/games/${encodeURIComponent(gameId)}`,
      authed(token),
    ),
};

/** The create key's alphabet (64 symbols, so a random byte's low six bits
 *  pick one uniformly). */
const CREATE_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const CREATE_KEY_LENGTH = 32;

/** A fresh create key: 32 characters from `A-Z a-z 0-9 - _`, from the
 *  platform's cryptographic random source. */
export function makeCreateKey(): string {
  const bytes = new Uint8Array(CREATE_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  let key = '';
  for (const b of bytes) key += CREATE_KEY_ALPHABET[b & 63];
  return key;
}

/** True for a key the server would accept (16–64 of the alphabet). */
export function isCreateKey(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

/** The share-code alphabet pairing codes are drawn from (no 0/O, 1/I/L, …). */
export const PAIRING_CODE_ALPHABET = '23456789ACDEFGHJKMNPQRTVWXY';
export const PAIRING_CODE_LENGTH = 8;

/** Normalise what a player typed: drop every space, upper-case the rest.
 *  The server normalises too; this keeps "abcd efgh" from failing early. */
export function normalizePairingCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** "ABCDEFGH" → "ABCD EFGH": two groups of four, easier to read aloud. */
export function formatPairingCode(code: string): string {
  const c = normalizePairingCode(code);
  return c.length === PAIRING_CODE_LENGTH ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}
