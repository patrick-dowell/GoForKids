/**
 * The home screen asks the server again each time it appears (while the
 * bots play online), so a server that came back un-greys ranked Play; a
 * device that plays its own bots asks nothing.
 *
 * Server rendering skips effects, so `useEffect` is swapped for one that
 * runs at render, as mounting would; its cleanups run after each render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cleanups: Array<() => void> = [];
vi.mock('react', async (importOriginal) => {
  const React = await importOriginal<typeof import('react')>();
  const useEffect = (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  };
  return { ...React, default: React, useEffect };
});

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

/** The server's /health: down or up; every other request is refused. */
function installServer() {
  const s = { down: true, health: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!String(url).endsWith('/health')) throw new TypeError('Failed to fetch');
      s.health++;
      if (s.down) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }),
  );
  return s;
}

async function showHome() {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HomePage } = await import('../HomePage');
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(HomePage, { onAutoPlay: noop, onCustomMatch: noop, onLibrary: noop, onLearn: noop, onProfile: noop, onFriends: noop }),
  );
  cleanups.splice(0).forEach((c) => c());
  return html;
}

const playGreyed = (html: string) => /<button class="home-btn home-btn-primary" disabled="">/.test(html);

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the home screen appearing', () => {
  it('asks the server; when it is back, Play is no longer greyed', async () => {
    const server = installServer();
    const { useServerReachStore } = await import('../../store/serverReachStore');
    await showHome();
    expect(server.health).toBe(1);
    await vi.waitFor(() => expect(useServerReachStore.getState().reach).toBe('down'));
    expect(playGreyed(await showHome())).toBe(true);
    expect(server.health).toBe(2);

    await vi.waitFor(() => expect(useServerReachStore.getState().checking).toBe(false));
    server.down = false;
    await showHome();
    expect(server.health).toBe(3);
    await vi.waitFor(() => expect(useServerReachStore.getState().reach).toBe('up'));
    expect(playGreyed(await showHome())).toBe(false);
  });

  it('on a device that plays its own bots, asks nothing', async () => {
    const server = installServer();
    (globalThis as { window?: unknown }).window = {
      kataGo: { ping: async () => ({ pong: true }), capabilities: async () => ({ localBots: true, evalsPerSecond: 60, humanModel: false }) },
    };
    const caps = await import('../../store/capabilitiesStore');
    await caps.readDeviceCapabilities();
    expect(playGreyed(await showHome())).toBe(false);
    expect(server.health).toBe(0);
  });
});
