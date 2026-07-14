/**
 * Cloud bot toggle (Settings → "Bot plays online (for older iPads)").
 *
 * The setting must make the app behave EXACTLY like the web build even when
 * the native KataGo bridge is injected: getKataGoBridge() returns null, so
 * client.ts routes createGame/ai-move over HTTP to Render instead of the
 * on-device path. Exists for old iPads where on-device analysis takes
 * ~1 min/move vs ~2s on Render (2026-07-15 school session).
 *
 * Project-wide vitest env is 'node'; we shim `localStorage` + `window` here
 * (same approach as localGameRouter.test.ts) rather than pull in jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal localStorage shim — settingsStore persists here, localGameRouter
// stores local games here.
function installLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/** Fake `window.kataGo` matching the Swift injection. analyze is a spy so
 *  tests can assert the bridge was NOT consulted when cloud bot is on. */
function installBridge() {
  const analyze = vi.fn(async () => ({
    candidates: [{ move: 'C3', visits: 10, winrate: 0.5, scoreLead: 0, order: 0 }],
    rootVisits: 10,
    kataGoPlayedMove: 'C3',
  }));
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window: object }).window = {};
  }
  (globalThis as { window: { kataGo?: unknown } }).window.kataGo = {
    ping: async () => ({ pong: true }),
    analyze,
  };
  return { analyze };
}

function uninstallWindow() {
  delete (globalThis as { window?: unknown }).window;
}

beforeEach(() => {
  // Fresh module registry per test: settingsStore reads localStorage at
  // import time, so each test seeds storage FIRST, then imports.
  vi.resetModules();
  installLocalStorage();
});

afterEach(() => {
  uninstallWindow();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getKataGoBridge cloud-bot gate', () => {
  it('returns the bridge when the setting is OFF (default), null when ON, and back — no reload', async () => {
    installBridge();
    const { getKataGoBridge } = await import('../nativeKataGo');
    const { useSettingsStore } = await import('../../store/settingsStore');

    // Default OFF → bridge visible (current iPad behavior unchanged).
    expect(useSettingsStore.getState().cloudBot).toBe(false);
    expect(getKataGoBridge()).not.toBeNull();

    // ON → bridge hidden from ALL consumers.
    useSettingsStore.getState().setCloudBot(true);
    expect(getKataGoBridge()).toBeNull();

    // OFF again → bridge visible again; the getter re-reads per call, so the
    // Settings toggle takes effect immediately (the runtime-toggle contract
    // client.ts useLocal() documents).
    useSettingsStore.getState().setCloudBot(false);
    expect(getKataGoBridge()).not.toBeNull();
  });

  it('still returns null on the web (no bridge), whatever the setting', async () => {
    // No window at all — the web build. The gate must not throw.
    const { getKataGoBridge } = await import('../nativeKataGo');
    const { useSettingsStore } = await import('../../store/settingsStore');
    expect(getKataGoBridge()).toBeNull();
    useSettingsStore.getState().setCloudBot(true);
    expect(getKataGoBridge()).toBeNull();
  });
});

describe('client.ts path selection with bridge present + cloud bot ON', () => {
  it('getAIMove goes over HTTP (/ai-move) and never consults the bridge', async () => {
    const { analyze } = installBridge();
    const dto = { point: { row: 2, col: 3 }, captures: [], score_lead: 1.5 };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => dto }));
    vi.stubGlobal('fetch', fetchMock);

    const { useSettingsStore } = await import('../../store/settingsStore');
    useSettingsStore.getState().setCloudBot(true);
    const { api } = await import('../client');

    const result = await api.getAIMove('g1', '30k');

    expect(result).toEqual(dto);
    expect(analyze).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/games/g1/ai-move');
    expect(init.method).toBe('POST');
  });

  it('createGame goes over HTTP (POST /games), not the local router', async () => {
    installBridge();
    const dto = { game_id: 'server-game', board: [], phase: 'playing' };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => dto }));
    vi.stubGlobal('fetch', fetchMock);

    const { useSettingsStore } = await import('../../store/settingsStore');
    useSettingsStore.getState().setCloudBot(true);
    const { api } = await import('../client');

    const result = await api.createGame({ board_size: 9, target_rank: '30k' });

    // Server DTO passed through verbatim — proves the HTTP branch answered,
    // not localGameRouter (whose ids are 8-hex and boards are real).
    expect(result).toEqual(dto);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/games$/);
  });

  it('OFF keeps the local path: createGame uses localGameRouter, no HTTP', async () => {
    installBridge();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('../client');
    const result = await api.createGame({ board_size: 9, target_rank: '30k' });

    // Real on-device game (8-hex id from localGameRouter), zero network.
    expect(result.game_id).toMatch(/^[0-9a-f]{8}$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('persistence (Patrick flips it once per iPad in the morning)', () => {
  it('setCloudBot(true) survives a "relaunch" (fresh module load from storage)', async () => {
    const first = await import('../../store/settingsStore');
    first.useSettingsStore.getState().setCloudBot(true);

    // Simulate app relaunch: new module instances, same localStorage.
    vi.resetModules();
    const second = await import('../../store/settingsStore');
    expect(second.useSettingsStore.getState().cloudBot).toBe(true);
  });

  it('settings persisted before this feature default to OFF', async () => {
    // An iPad that already has goforkids_settings from a previous build.
    localStorage.setItem(
      'goforkids_settings',
      JSON.stringify({ themeId: 'cosmic', density: 'full', showScoreGraph: true }),
    );
    const { useSettingsStore } = await import('../../store/settingsStore');
    expect(useSettingsStore.getState().cloudBot).toBe(false);
  });

  it('flipping cloudBot preserves the other persisted settings', async () => {
    localStorage.setItem(
      'goforkids_settings',
      JSON.stringify({ themeId: 'classic', density: 'zen', showScoreGraph: false }),
    );
    const { useSettingsStore } = await import('../../store/settingsStore');
    useSettingsStore.getState().setCloudBot(true);

    const raw = JSON.parse(localStorage.getItem('goforkids_settings')!);
    expect(raw).toEqual({
      themeId: 'classic',
      density: 'zen',
      showScoreGraph: false,
      cloudBot: true,
    });
  });
});
