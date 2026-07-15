import { create } from 'zustand';
import type { ThemeId } from '../theme/themes';

const STORAGE_KEY = 'goforkids_settings';

/**
 * Animation/sound density.
 * - "full"  : theme intensity unchanged. Cosmic celebrates, classic stays restrained.
 * - "zen"   : 0.4× intensity multiplier on top of theme — quieter visuals, softer audio.
 *             For adults / low-distraction play; off by default.
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
  /** Cloud bot (2026-07-14): force bot moves onto the
   *  HTTP/Render path even when the native KataGo bridge is injected. For
   *  older iPads where on-device analysis takes ~1 min/move vs ~2s on
   *  Render. Enforced inside getKataGoBridge() — when ON the getter returns
   *  null, so every bridge consumer uniformly behaves like the web build.
   *  Default OFF: bridge behavior unchanged. */
  cloudBot: boolean;
}

const DEFAULTS: PersistedSettings = {
  themeId: 'cosmic',
  density: 'full',
  showScoreGraph: true,
  cloudBot: false,
};

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      themeId: parsed.themeId === 'classic' ? 'classic' : 'cosmic',
      density: parsed.density === 'zen' ? 'zen' : 'full',
      // Default ON: only an explicit false (user toggled it off) disables it.
      showScoreGraph: parsed.showScoreGraph !== false,
      // Default OFF: only an explicit true routes the bot online.
      cloudBot: parsed.cloudBot === true,
    };
  } catch {
    return { ...DEFAULTS };
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
  cloudBot: boolean;
  setTheme: (id: ThemeId) => void;
  setDensity: (d: Density) => void;
  setShowScoreGraph: (v: boolean) => void;
  setCloudBot: (v: boolean) => void;
}

const initial = loadSettings();

function persistCurrent(get: () => SettingsState) {
  const s = get();
  saveSettings({
    themeId: s.themeId,
    density: s.density,
    showScoreGraph: s.showScoreGraph,
    cloudBot: s.cloudBot,
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  themeId: initial.themeId,
  density: initial.density,
  showScoreGraph: initial.showScoreGraph,
  cloudBot: initial.cloudBot,

  setTheme: (id: ThemeId) => {
    set({ themeId: id });
    persistCurrent(get);
  },

  setDensity: (d: Density) => {
    set({ density: d });
    persistCurrent(get);
  },

  setShowScoreGraph: (v: boolean) => {
    set({ showScoreGraph: v });
    persistCurrent(get);
  },

  setCloudBot: (v: boolean) => {
    set({ cloudBot: v });
    persistCurrent(get);
  },
}));
