import { create } from 'zustand';

/**
 * The admin's labels (feature 32, revision 3): a few words per profile,
 * typed by the grown-up running a class to say whose profile it is. They
 * live on this device only, under `goforkids.admin.labels.v1`, keyed by
 * player id, and are never sent anywhere: no request body, URL or header
 * carries one. Sync clears them with the rest of the player data on a log
 * out and on a 401, so they never stay on a device that leaves the admin
 * profile.
 *
 * Kept apart from the sync store (which clears them) so it imports nothing.
 */

export const ADMIN_LABELS_KEY = 'goforkids.admin.labels.v1';

/** Longest label kept. */
export const ADMIN_LABEL_MAX = 40;

export type AdminLabels = Record<string, string>;

function readLabels(): AdminLabels {
  try {
    const raw = localStorage.getItem(ADMIN_LABELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AdminLabels = {};
    for (const [id, label] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof label === 'string') out[id] = label;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLabels(labels: AdminLabels) {
  try {
    if (Object.keys(labels).length === 0) localStorage.removeItem(ADMIN_LABELS_KEY);
    else localStorage.setItem(ADMIN_LABELS_KEY, JSON.stringify(labels));
  } catch (e) {
    console.warn('Failed to save admin labels:', e);
  }
}

interface AdminLabelsState {
  labels: AdminLabels;
  /** Set (or, with an empty string, remove) one profile's label. */
  setLabel: (playerId: string, label: string) => void;
  /** Drop every label, here and in storage. */
  clear: () => void;
}

export const useAdminLabels = create<AdminLabelsState>((set, get) => ({
  // Read once, when the app loads this module.
  labels: readLabels(),

  setLabel: (playerId, label) => {
    const next = { ...get().labels };
    const text = label.slice(0, ADMIN_LABEL_MAX);
    if (text.trim()) next[playerId] = text;
    else delete next[playerId];
    set({ labels: next });
    writeLabels(next);
  },

  clear: () => {
    set({ labels: {} });
    try {
      localStorage.removeItem(ADMIN_LABELS_KEY);
    } catch {
      // Storage unavailable: nothing was kept there either.
    }
  },
}));
