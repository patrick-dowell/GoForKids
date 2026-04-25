import { create } from 'zustand';
import type { ThemeId } from '../theme/themes';

const STORAGE_KEY = 'goforkids_settings';

/**
 * Animation/sound density.
 * - "full"  : theme intensity unchanged. Cosmic celebrates, classic stays restrained.
 * - "zen"   : 0.4× intensity multiplier on top of theme — quieter visuals, softer audio.
 *             For adults / focused study; off by default.
 */
export type Density = 'full' | 'zen';

const ZEN_MULTIPLIER = 0.4;

export function densityMultiplier(density: Density): number {
  return density === 'zen' ? ZEN_MULTIPLIER : 1;
}

interface PersistedSettings {
  themeId: ThemeId;
  density: Density;
  showScoreGraph: boolean;
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { themeId: 'cosmic', density: 'full', showScoreGraph: false };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      themeId: parsed.themeId === 'classic' ? 'classic' : 'cosmic',
      density: parsed.density === 'zen' ? 'zen' : 'full',
      showScoreGraph: parsed.showScoreGraph === true,
    };
  } catch {
    return { themeId: 'cosmic', density: 'full', showScoreGraph: false };
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
  density: Density;
  showScoreGraph: boolean;
  setTheme: (id: ThemeId) => void;
  setDensity: (d: Density) => void;
  setShowScoreGraph: (v: boolean) => void;
}

const initial = loadSettings();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  themeId: initial.themeId,
  density: initial.density,
  showScoreGraph: initial.showScoreGraph,

  setTheme: (id: ThemeId) => {
    set({ themeId: id });
    const s = get();
    saveSettings({ themeId: id, density: s.density, showScoreGraph: s.showScoreGraph });
  },

  setDensity: (d: Density) => {
    set({ density: d });
    const s = get();
    saveSettings({ themeId: s.themeId, density: d, showScoreGraph: s.showScoreGraph });
  },

  setShowScoreGraph: (v: boolean) => {
    set({ showScoreGraph: v });
    const s = get();
    saveSettings({ themeId: s.themeId, density: s.density, showScoreGraph: v });
  },
}));
