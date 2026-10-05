/**
 * The "Human-style bots" setting (persisted like "Bot plays online") and the
 * device capabilities read once at app start, which decide whether its
 * Settings row exists at all. vitest's env is 'node': localStorage and
 * window are shimmed as in api/__tests__/cloudBot.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function installBridge(bridge: Record<string, unknown>) {
  (globalThis as { window?: unknown }).window = { kataGo: { ping: async () => ({ pong: true }), ...bridge } };
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('humanBots persistence', () => {
  it('defaults to off', async () => {
    const { useSettingsStore } = await import('../settingsStore');
    expect(useSettingsStore.getState().humanBots).toBe(false);
  });

  it('survives a relaunch once turned on, and once turned off again', async () => {
    const first = await import('../settingsStore');
    first.useSettingsStore.getState().setHumanBots(true);
    vi.resetModules();
    const second = await import('../settingsStore');
    expect(second.useSettingsStore.getState().humanBots).toBe(true);
    second.useSettingsStore.getState().setHumanBots(false);
    vi.resetModules();
    const third = await import('../settingsStore');
    expect(third.useSettingsStore.getState().humanBots).toBe(false);
  });

  it('settings saved before this feature, or with anything but true, read as off', async () => {
    for (const saved of [
      { themeId: 'cosmic', density: 'full', showScoreGraph: true, cloudBot: true },
      { themeId: 'cosmic', humanBots: 'true' },
      { themeId: 'cosmic', humanBots: 1 },
    ]) {
      vi.resetModules();
      localStorage.setItem('goforkids_settings', JSON.stringify(saved));
      const { useSettingsStore } = await import('../settingsStore');
      expect(useSettingsStore.getState().humanBots).toBe(false);
    }
  });

  it('is stored beside the other settings and leaves them as they were', async () => {
    localStorage.setItem(
      'goforkids_settings',
      JSON.stringify({ themeId: 'classic', density: 'zen', showScoreGraph: false, cloudBot: true }),
    );
    const { useSettingsStore } = await import('../settingsStore');
    useSettingsStore.getState().setHumanBots(true);
    expect(JSON.parse(localStorage.getItem('goforkids_settings')!)).toEqual({
      themeId: 'classic',
      density: 'zen',
      showScoreGraph: false,
      cloudBot: true,
      humanBots: true,
    });
    // and the cloud toggle's own writes keep it
    useSettingsStore.getState().setCloudBot(false);
    expect(JSON.parse(localStorage.getItem('goforkids_settings')!).humanBots).toBe(true);
  });
});

describe('device capabilities, read once at start', () => {
  it('no bridge (the web): nothing read, no human model', async () => {
    const caps = await import('../capabilitiesStore');
    await caps.readDeviceCapabilities();
    expect(caps.useCapabilitiesStore.getState().capabilities).toBeNull();
    expect(caps.hasHumanModel()).toBe(false);
  });

  it('a native build without capabilities(): no human model, and nothing to warn about', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installBridge({});
    const caps = await import('../capabilitiesStore');
    await caps.readDeviceCapabilities();
    expect(caps.hasHumanModel()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps what the bridge reports, and asks only once', async () => {
    const answer = { localBots: true, evalsPerSecond: 55.5, humanModel: true };
    const capabilities = vi.fn(async () => answer);
    installBridge({ capabilities });
    const caps = await import('../capabilitiesStore');
    await Promise.all([caps.readDeviceCapabilities(), caps.readDeviceCapabilities()]);
    await caps.readDeviceCapabilities();
    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(caps.useCapabilitiesStore.getState().capabilities).toEqual(answer);
    expect(caps.hasHumanModel()).toBe(true);
  });

  it('humanModel false, or anything but true, is no human model', async () => {
    for (const humanModel of [false, 'yes', 1, undefined]) {
      vi.resetModules();
      installBridge({ capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel }) });
      const caps = await import('../capabilitiesStore');
      await caps.readDeviceCapabilities();
      expect(caps.hasHumanModel()).toBe(false);
    }
  });

  it('a failing capabilities() is no human model, and the app carries on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installBridge({ capabilities: async () => Promise.reject(new Error('probe failed')) });
    const caps = await import('../capabilitiesStore');
    await expect(caps.readDeviceCapabilities()).resolves.toBeUndefined();
    expect(caps.useCapabilitiesStore.getState().capabilities).toBeNull();
    expect(caps.hasHumanModel()).toBe(false);
  });

  it('is read from the bridge itself while "Bot plays online" hides it from the game', async () => {
    localStorage.setItem('goforkids_settings', JSON.stringify({ cloudBot: true }));
    installBridge({ capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: true }) });
    const { getKataGoBridge } = await import('../../api/nativeKataGo');
    const caps = await import('../capabilitiesStore');
    await caps.readDeviceCapabilities();
    expect(getKataGoBridge()).toBeNull();
    expect(caps.hasHumanModel()).toBe(true);
  });

  it('_resetDeviceCapabilities forgets the answer for the next read', async () => {
    const capabilities = vi.fn(async () => ({ localBots: true, evalsPerSecond: 40, humanModel: true }));
    installBridge({ capabilities });
    const caps = await import('../capabilitiesStore');
    await caps.readDeviceCapabilities();
    caps._resetDeviceCapabilities();
    expect(caps.hasHumanModel()).toBe(false);
    await caps.readDeviceCapabilities();
    expect(capabilities).toHaveBeenCalledTimes(2);
  });
});

describe('getHumanRung: the four conditions', () => {
  async function setup(o: { cloudBot?: boolean; humanBots?: boolean; humanModel?: boolean; bridge?: boolean }) {
    if (o.bridge !== false) {
      installBridge({ capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: o.humanModel ?? true }) });
    }
    const caps = await import('../capabilitiesStore');
    await caps.readDeviceCapabilities();
    const { useSettingsStore } = await import('../settingsStore');
    useSettingsStore.getState().setCloudBot(o.cloudBot ?? false);
    useSettingsStore.getState().setHumanBots(o.humanBots ?? true);
    return import('../../api/nativeKataGo');
  }

  it('all four: the human rung', async () => {
    const { getHumanRung } = await setup({});
    expect(getHumanRung('15k', 9)?.human_tilt).toBe(-8);
  });

  it('any one missing: undefined', async () => {
    expect((await setup({ humanBots: false })).getHumanRung('15k', 9)).toBeUndefined();
    vi.resetModules();
    installLocalStorage();
    expect((await setup({ humanModel: false })).getHumanRung('15k', 9)).toBeUndefined();
    vi.resetModules();
    installLocalStorage();
    expect((await setup({ cloudBot: true })).getHumanRung('15k', 9)).toBeUndefined();
    vi.resetModules();
    installLocalStorage();
    delete (globalThis as { window?: unknown }).window;
    expect((await setup({ bridge: false })).getHumanRung('15k', 9)).toBeUndefined();
    vi.resetModules();
    installLocalStorage();
    expect((await setup({})).getHumanRung('3k', 9)).toBeUndefined();
  });
});
