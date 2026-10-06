/**
 * The "Human-style bots" row in Settings, from the first moment the app is
 * open. On a version's first launch the device's capabilities answer waits
 * on the engine's start (half a minute or more), so the row is there at
 * once, greyed with a line saying the bots are starting, and opens when the
 * answer has the human model. A device held to the online bots says so; the
 * web has no row.
 *
 * Server rendering reads a store's initial state, so the state a render
 * shows is written there too (seedCaps).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../audio/SoundManager', () => ({
  playPlaceSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playPassSound: vi.fn(),
  playGameEndSound: vi.fn(),
  playTwoEyesSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

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

type Caps = { localBots: boolean; evalsPerSecond: number; humanModel: boolean };

/** A fake bridge whose capabilities() answers `caps`, throws, or waits. */
function installBridge(caps: Caps | 'throw' | 'pending' | 'absent') {
  const bridge: Record<string, unknown> = { ping: async () => ({ pong: true }) };
  if (caps !== 'absent') {
    bridge.capabilities = () =>
      caps === 'pending'
        ? new Promise(() => {})
        : caps === 'throw'
          ? Promise.reject(new Error('no probe'))
          : Promise.resolve(caps);
  }
  (globalThis as { window?: unknown }).window = { kataGo: bridge, setTimeout, clearTimeout };
}

/** Start the read as main.tsx does, let it finish (or not), and render. */
async function settingsAfter(stored: { humanBots?: boolean } = {}, waitForRead = true) {
  localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', ...stored }));
  const caps = await import('../../store/capabilitiesStore');
  const read = caps.readDeviceCapabilities();
  if (waitForRead) await read;
  Object.assign(caps.useCapabilitiesStore.getInitialState(), caps.useCapabilitiesStore.getState());
  const { SettingsDialog } = await import('../SettingsDialog');
  return renderToStaticMarkup(createElement(SettingsDialog, { onClose: () => {} }));
}

/** The human-style row's markup, or null when there is none. */
function humanRow(html: string): string | null {
  const at = html.indexOf('settings-human-bots');
  if (at < 0) return null;
  return html.slice(at, html.indexOf('</div>', at));
}

const FAST: Caps = { localBots: true, evalsPerSecond: 60, humanModel: true };

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the human-style row', () => {
  it('before the answer: shown at once, greyed, saying the bots are starting', async () => {
    installBridge('pending');
    const row = humanRow(await settingsAfter({}, false));
    expect(row).not.toBeNull();
    expect(row).toMatch(/<input type="checkbox" disabled=""/);
    expect(row).toContain('Human-style bots</label>');
    expect(row).toContain('<p class="settings-note">Starting the bots…</p>');
  });

  it('before the answer it keeps the stored choice, greyed', async () => {
    installBridge('pending');
    expect(humanRow(await settingsAfter({ humanBots: true }, false))).toMatch(/<input type="checkbox" disabled="" checked=""/);
  });

  it('still starting after the wait for the answer gives up (the answer can come later)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    installBridge('pending');
    const caps = await import('../../store/capabilitiesStore');
    const waited = caps.whenBotRoutingKnown();
    await vi.advanceTimersByTimeAsync(caps.BOT_ROUTING_WAIT_MS);
    await waited;
    expect(caps.botRoutingKnown()).toBe(true);
    expect(humanRow(await settingsAfter({}, false))).toContain('Starting the bots…');
  });

  it('the answer has the human model and the device plays its own bots: open, no line', async () => {
    installBridge(FAST);
    const row = humanRow(await settingsAfter({ humanBots: true }));
    expect(row).toMatch(/<input type="checkbox" checked=""/);
    expect(row).not.toContain('disabled');
    expect(row).not.toContain('settings-note');
  });

  it('a device held to the online bots: greyed, off, saying so', async () => {
    installBridge({ localBots: false, evalsPerSecond: 3, humanModel: true });
    const row = humanRow(await settingsAfter({ humanBots: true }));
    expect(row).toMatch(/<input type="checkbox" disabled=""\/>/);
    expect(row).toContain('<p class="settings-note">This device plays the online bots.</p>');
  });

  for (const [name, caps] of [
    ['the answer has no human model', { localBots: true, evalsPerSecond: 60, humanModel: false }],
    ['the call fails', 'throw'],
    ['a bridge without the call', 'absent'],
  ] as const) {
    it(`${name}: greyed, off, not on this device`, async () => {
      installBridge(caps);
      const row = humanRow(await settingsAfter({ humanBots: true }));
      expect(row).toMatch(/<input type="checkbox" disabled=""\/>/);
      expect(row).toContain('<p class="settings-note">Not available on this device.</p>');
    });
  }

  it('the web: no row, as before', async () => {
    const html = await settingsAfter({ humanBots: true });
    expect(html).toContain('settings-cloud-bot');
    expect(humanRow(html)).toBeNull();
  });
});
