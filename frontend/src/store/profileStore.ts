import { create } from 'zustand';
import type { PlayerAvatarType } from '../components/Avatar';

/**
 * Player identity store — avatar + display name. Separate from
 * `autoPlayStore` (which is rank-and-history) because the player's
 * identity isn't board-size-specific and would survive a rank reset.
 *
 * Persisted under `goforkids.profile.v1`. Migrates the legacy
 * `goforkids_avatar` key from the old NewGameDialog if present.
 */

const STORAGE_KEY = 'goforkids.profile.v1';
const LEGACY_AVATAR_KEY = 'goforkids_avatar';

export type DisplayName = string;

interface PersistedProfile {
  avatar: PlayerAvatarType;
  displayName: DisplayName;
}

interface ProfileState {
  avatar: PlayerAvatarType;
  displayName: DisplayName;

  setAvatar: (avatar: PlayerAvatarType) => void;
  setDisplayName: (name: DisplayName) => void;
  loadFromStorage: () => void;
}

const VALID_AVATARS: PlayerAvatarType[] = ['blackhole', 'nova', 'nebula'];

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

export const useProfileStore = create<ProfileState>((set, get) => ({
  avatar: 'blackhole',
  displayName: '',

  setAvatar: (avatar) => {
    set({ avatar });
    persist({ avatar, displayName: get().displayName });
  },

  setDisplayName: (displayName) => {
    set({ displayName });
    persist({ avatar: get().avatar, displayName });
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<PersistedProfile>;
        set({
          avatar: isValidAvatar(p.avatar) ? p.avatar : 'blackhole',
          displayName: typeof p.displayName === 'string' ? p.displayName : '',
        });
        return;
      }
      // Migrate from the pre-Profile-page legacy avatar key. NewGameDialog
      // wrote 'blackhole'/'nova'/'nebula' to `goforkids_avatar` directly.
      const legacy = localStorage.getItem(LEGACY_AVATAR_KEY);
      if (isValidAvatar(legacy)) {
        const migrated: PersistedProfile = { avatar: legacy, displayName: '' };
        set(migrated);
        persist(migrated);
        localStorage.removeItem(LEGACY_AVATAR_KEY);
      }
    } catch (e) {
      console.warn('Failed to load player profile:', e);
    }
  },
}));

// Dev convenience for the Profile page's dev tools + browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __profileStore: typeof useProfileStore }).__profileStore = useProfileStore;
}
