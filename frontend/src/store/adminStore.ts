import { create } from 'zustand';
import { adminApi, type AdminPlayer, type PairingCode } from '../api/sync';
import { canRemoveDevice, canSignOutPlayer, freshPlayerState, isAllowedCodeExpiry } from '../profile/admin';
import { isHandle, randomHandle, type Handle } from '../profile/names';
import { isHandleTaken, MAX_HANDLE_RETRIES, useSyncStore } from './syncStore';

/**
 * The Admin section's data and actions (feature 32, revision 3). Every
 * request goes through the sync store's `adminRequest`, which takes the 401
 * path on a 401 and hides the section on a 403. The list is held in memory
 * only and dropped when this device stops being an admin or logs out.
 *
 * The admin's labels are not here and never reach a request: they live in
 * adminLabels.ts, on this device only.
 */

interface AdminState {
  /** The profiles, most recently updated first; null until loaded. */
  players: AdminPlayer[] | null;
  /** When the server began recording when a device was last seen (ISO), or
   *  null when it didn't say: a device row with no stamp from before then
   *  was last used before it, not never. */
  lastSeenSince: string | null;
  loading: boolean;
  /** The latest load failed (offline, a 5xx). */
  loadFailed: boolean;

  /** Load the list. Never throws. */
  refresh: () => Promise<void>;
  /** Make a profile with the fresh state and this name; resolves to its id
   *  once the list has it. When another profile has the name, another is
   *  picked and tried, silently (revision 6): the list shows the name the
   *  profile got. */
  createPlayer: (handle: Handle) => Promise<string>;
  /** A code that logs a device into this profile, valid until `expiresAt`
   *  (after now, at most 24 hours ahead). */
  mintCode: (playerId: string, expiresAt: Date) => Promise<PairingCode>;
  /** Sign one device out. Never this device. */
  removeDevice: (deviceId: string) => Promise<void>;
  /** Sign out every device of a profile. Never this device's own profile. */
  signOutPlayer: (playerId: string) => Promise<void>;
}

function selfIds() {
  const s = useSyncStore.getState();
  return { playerId: s.playerId, deviceId: s.deviceId };
}

/** Bumped by every load, so an older reply never overwrites a newer one. */
let loadSeq = 0;

export const useAdminStore = create<AdminState>((set, get) => {
  /** After a change, show the list as it now is. A failed reload leaves the
   *  change done and the list flagged as stale. */
  const reload = () => get().refresh();

  return {
    players: null,
    lastSeenSince: null,
    loading: false,
    loadFailed: false,

    refresh: async () => {
      const seq = ++loadSeq;
      set({ loading: true });
      try {
        const list = await useSyncStore.getState().adminRequest((token) => adminApi.listPlayers(token));
        if (seq === loadSeq) set({ players: list.players, lastSeenSince: list.lastSeenSince, loadFailed: false });
      } catch {
        if (seq === loadSeq) set({ loadFailed: true });
      } finally {
        if (seq === loadSeq) set({ loading: false });
      }
    },

    createPlayer: async (handle) => {
      if (!isHandle(handle)) throw new Error('admin: not a name');
      let name: Handle = handle;
      let made: { player_id: string } | null = null;
      for (let retries = 0; !made; retries++) {
        try {
          const state = freshPlayerState(name);
          made = await useSyncStore.getState().adminRequest((token) => adminApi.createPlayer(token, state));
        } catch (e) {
          if (!isHandleTaken(e)) throw e;
          // Not the 409 the section explains as "this device signs out with
          // Log out": past the bound, say only that it didn't work this time.
          if (retries >= MAX_HANDLE_RETRIES) throw new Error('admin: every name tried was taken');
          name = randomHandle(name);
        }
      }
      await reload();
      return made.player_id;
    },

    mintCode: async (playerId, expiresAt) => {
      if (!isAllowedCodeExpiry(expiresAt, new Date())) throw new Error('admin: expiry out of range');
      return useSyncStore
        .getState()
        .adminRequest((token) => adminApi.mintCode(token, playerId, expiresAt.toISOString()));
    },

    removeDevice: async (deviceId) => {
      if (!canRemoveDevice({ device_id: deviceId, created_at: '', last_seen_at: null, kind: null }, selfIds())) {
        throw new Error('admin: this device signs out with Log out');
      }
      await useSyncStore.getState().adminRequest((token) => adminApi.removeDevice(token, deviceId));
      await reload();
    },

    signOutPlayer: async (playerId) => {
      const player = get().players?.find((p) => p.player_id === playerId);
      if (!player || !canSignOutPlayer(player, selfIds())) {
        throw new Error("admin: not a profile whose devices this device may sign out");
      }
      await useSyncStore.getState().adminRequest((token) => adminApi.signOutPlayer(token, playerId));
      await reload();
    },
  };
});

// Other players' data never outlives this device's admin standing: when a
// pass says it is no longer an admin, a 403 hides the section, or the device
// logs out, the list goes, and a reply still on its way is dropped.
useSyncStore.subscribe((s) => {
  if (s.admin) return;
  loadSeq++;
  useAdminStore.setState({ players: null, lastSeenSince: null, loading: false, loadFailed: false });
});
