import { create } from 'zustand';
import { adminApi, type AdminPlayer, type PairingCode } from '../api/sync';
import { canRemoveDevice, canSignOutPlayer, freshPlayerState, isAllowedCodeExpiry } from '../profile/admin';
import { isHandle, type Handle } from '../profile/names';
import { useSyncStore } from './syncStore';

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
  loading: boolean;
  /** The latest load failed (offline, a 5xx). */
  loadFailed: boolean;

  /** Load the list. Never throws. */
  refresh: () => Promise<void>;
  /** Make a profile with the fresh state and this name; resolves to its id
   *  once the list has it. */
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
    loading: false,
    loadFailed: false,

    refresh: async () => {
      const seq = ++loadSeq;
      set({ loading: true });
      try {
        const players = await useSyncStore.getState().adminRequest((token) => adminApi.listPlayers(token));
        if (seq === loadSeq) set({ players, loadFailed: false });
      } catch {
        if (seq === loadSeq) set({ loadFailed: true });
      } finally {
        if (seq === loadSeq) set({ loading: false });
      }
    },

    createPlayer: async (handle) => {
      if (!isHandle(handle)) throw new Error('admin: not a name');
      const state = freshPlayerState(handle);
      const res = await useSyncStore.getState().adminRequest((token) => adminApi.createPlayer(token, state));
      await reload();
      return res.player_id;
    },

    mintCode: async (playerId, expiresAt) => {
      if (!isAllowedCodeExpiry(expiresAt, new Date())) throw new Error('admin: expiry out of range');
      return useSyncStore
        .getState()
        .adminRequest((token) => adminApi.mintCode(token, playerId, expiresAt.toISOString()));
    },

    removeDevice: async (deviceId) => {
      if (!canRemoveDevice({ device_id: deviceId, created_at: '', last_seen_at: null }, selfIds())) {
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
  useAdminStore.setState({ players: null, loading: false, loadFailed: false });
});
