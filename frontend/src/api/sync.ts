/**
 * Sync API (feature 32): the ten routes under `/api/sync`, coded to the
 * contract in feature_plans/32_sync_foundation.md. Rides the shared
 * `request` helper in client.ts (base URL, timeout, network retry); a non-OK
 * response arrives as an `ApiError` carrying its status and JSON body.
 *
 * A linked device authenticates with `Authorization: Bearer <device_token>`.
 * Nothing in this module is called for a device that is not linked.
 */

import { ApiError, request } from './client';
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

function authed(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
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
  createPlayer: (state: SyncStateDoc): Promise<DeviceGrant> =>
    request<DeviceGrant>(`${BASE}/players`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    }),

  mintPairingCode: (token: string): Promise<PairingCode> =>
    request<PairingCode>(`${BASE}/pairing-codes`, authed(token, { method: 'POST' })),

  redeemPairingCode: (code: string): Promise<DeviceGrant> =>
    request<DeviceGrant>(`${BASE}/pairing-codes/redeem`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getState: (token: string): Promise<RemoteState> =>
    request<RemoteState>(`${BASE}/state`, authed(token)),

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
