import { create } from 'zustand';
import type { ThemeId } from '../theme/themes';

const STORAGE_KEY = 'goforkids_settings';

interface PersistedSettings {
  themeId: ThemeId;
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { themeId: 'cosmic' };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return { themeId: parsed.themeId === 'classic' ? 'classic' : 'cosmic' };
  } catch {
    return { themeId: 'cosmic' };
  }
}

function saveSettings(s: PersistedSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

interface SettingsState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const initial = loadSettings();

export const useSettingsStore = create<SettingsState>((set) => ({
  themeId: initial.themeId,
  setTheme: (id: ThemeId) => {
    set({ themeId: id });
    saveSettings({ themeId: id });
  },
}));
