import { create } from 'zustand';
import type { PlayerAvatarType } from '../components/Avatar';
import { isHandle, randomHandle, renderName, type Handle } from '../profile/names';

/**
 * Player identity store — avatar + generated name. Separate from
 * `autoPlayStore` (which is rank-and-history) because the player's
 * identity isn't board-size-specific and would survive a rank reset.
 *
 * The name is a `handle`: two positions into the word lists in
 * profile/names.ts (feature 32, revision 2). There is no free-text name;
 * an old `displayName` left in storage is dropped on load and never sent.
 *
 * Persisted under `goforkids.profile.v1`. Migrates the legacy
 * `goforkids_avatar` key from the old NewGameDialog if present.
 */

const STORAGE_KEY = 'goforkids.profile.v1';
const LEGACY_AVATAR_KEY = 'goforkids_avatar';

interface PersistedProfile {
  avatar: PlayerAvatarType;
  /** True once the user has DELIBERATELY picked an avatar (Learn intro or
   *  Profile page) — gates the one-time ChooseAvatarScreen. Defaults false
   *  for pre-existing profiles so everyone gets the intro screen once. */
  avatarPicked: boolean;
  /** The generated name; null until the player has one. */
  handle: Handle | null;
}

interface ProfileState {
  avatar: PlayerAvatarType;
  avatarPicked: boolean;
  handle: Handle | null;

  setAvatar: (avatar: PlayerAvatarType) => void;
  /** Set the name to these list positions (ignored if not a valid handle). */
  setHandle: (handle: Handle) => void;
  /** Pick a new random name, always different from the current one. */
  shuffleHandle: () => void;
  /** Take avatar and name from the synced profile. Sets the fields as given
   *  (unlike `setAvatar`, which always marks a deliberate pick). A missing or
   *  invalid handle leaves the current name alone. */
  adoptProfile: (p: { avatar?: unknown; avatarPicked?: unknown; handle?: unknown }) => void;
  /** Log out: back to a nameless default player. */
  clearPlayer: () => void;
  loadFromStorage: () => void;
}

const VALID_AVATARS: PlayerAvatarType[] = ['blackhole', 'nova', 'nebula', 'tide', 'eclipse', 'prism', 'comet'];

function isValidAvatar(v: unknown): v is PlayerAvatarType {
  return typeof v === 'string' && (VALID_AVATARS as string[]).includes(v);
}

function persist(state: PersistedProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save player profile:', e);
  }
}

function snapshot(s: ProfileState): PersistedProfile {
  return { avatar: s.avatar, avatarPicked: s.avatarPicked, handle: s.handle };
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  avatar: 'blackhole',
  avatarPicked: false,
  handle: null,

  setAvatar: (avatar) => {
    // Any explicit pick counts — also suppresses the one-time Learn intro.
    set({ avatar, avatarPicked: true });
    persist(snapshot(get()));
  },

  setHandle: (handle) => {
    if (!isHandle(handle)) return;
    set({ handle: [handle[0], handle[1]] });
    persist(snapshot(get()));
  },

  shuffleHandle: () => {
    set({ handle: randomHandle(get().handle) });
    persist(snapshot(get()));
  },

  adoptProfile: (p) => {
    const avatar = isValidAvatar(p.avatar) ? p.avatar : get().avatar;
    const avatarPicked = typeof p.avatarPicked === 'boolean' ? p.avatarPicked : get().avatarPicked;
    const cur = get().handle;
    const handle: Handle | null = isHandle(p.handle) ? [p.handle[0], p.handle[1]] : cur;
    const same =
      avatar === get().avatar &&
      avatarPicked === get().avatarPicked &&
      (handle === cur || (!!handle && !!cur && handle[0] === cur[0] && handle[1] === cur[1]));
    if (same) return;
    set({ avatar, avatarPicked, handle });
    persist(snapshot(get()));
  },

  clearPlayer: () => {
    set({ avatar: 'blackhole', avatarPicked: false, handle: null });
    persist(snapshot(get()));
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<PersistedProfile> & { displayName?: unknown };
        set({
          avatar: isValidAvatar(p.avatar) ? p.avatar : 'blackhole',
          avatarPicked: p.avatarPicked === true,
          handle: isHandle(p.handle) ? [p.handle[0], p.handle[1]] : null,
        });
        // The free-text name is gone (revision 2): rewrite storage without it.
        if ('displayName' in p) persist(snapshot(get()));
        return;
      }
      // Migrate from the pre-Profile-page legacy avatar key. NewGameDialog
      // wrote 'blackhole'/'nova'/'nebula' to `goforkids_avatar` directly.
      // A legacy pick was deliberate, so it counts as avatarPicked.
      const legacy = localStorage.getItem(LEGACY_AVATAR_KEY);
      if (isValidAvatar(legacy)) {
        set({ avatar: legacy, avatarPicked: true });
        persist(snapshot(get()));
        localStorage.removeItem(LEGACY_AVATAR_KEY);
      }
    } catch (e) {
      console.warn('Failed to load player profile:', e);
    }
  },
}));

/** The player's name as shown and shared (a shared replay's `player_name`):
 *  the rendered handle, or '' before there is one. */
export function currentPlayerName(): string {
  return renderName(useProfileStore.getState().handle);
}

// Dev convenience for the Profile page's dev tools + browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __profileStore: typeof useProfileStore }).__profileStore = useProfileStore;
}
