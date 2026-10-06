/**
 * The line under a bot-setting row whose change does not reach the game in
 * progress: "Bot plays online" governs where the next game's bots play (a
 * game keeps the bots it started with, see the mid-game test in
 * store/__tests__/gameStore.midGameBotSetting.test.ts). It shows only while
 * a game is being played. "Human-style bots" is read on every bot move, so
 * its row has no such line.
 *
 * Server rendering reads a store's initial state, so the state a render
 * shows is written there too (seed).
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

function installBridge(localBots = true) {
  (globalThis as { window?: unknown }).window = {
    kataGo: {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots, evalsPerSecond: 60, humanModel: true }),
    },
    setTimeout,
    clearTimeout,
  };
}

/** The online bots' server: a new game, and nothing else is asked here. */
function installServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ game_id: 'srv00001', phase: 'playing' }) })),
  );
}

const NOTE = 'Takes effect from your next game.';

async function load(stored: { cloudBot?: boolean } = {}) {
  localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', ...stored }));
  const caps = await import('../../store/capabilitiesStore');
  await caps.readDeviceCapabilities();
  const { useGameStore } = await import('../../store/gameStore');
  const { Color } = await import('../../engine/types');
  const { SettingsDialog } = await import('../SettingsDialog');
  const start = (gameMode: 'ai' | 'local' = 'ai') =>
    useGameStore.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: gameMode === 'ai', gameMode, playerColor: Color.Black });
  const settings = () => {
    Object.assign(caps.useCapabilitiesStore.getInitialState(), caps.useCapabilitiesStore.getState());
    Object.assign(useGameStore.getInitialState(), useGameStore.getState());
    return renderToStaticMarkup(createElement(SettingsDialog, { onClose: () => {} }));
  };
  const row = (html: string, cls: string) => {
    const at = html.indexOf(cls);
    return at < 0 ? null : html.slice(at, html.indexOf('</div>', at));
  };
  return { useGameStore, start, settings, row };
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('"Takes effect from your next game."', () => {
  for (const cloudBot of [false, true]) {
    it(`under "Bot plays online" while a game is being played (setting ${cloudBot ? 'on' : 'off'})`, async () => {
      installBridge();
      installServer();
      const { start, settings, row } = await load({ cloudBot });
      await start();
      const html = settings();
      expect(row(html, 'settings-cloud-bot')).toContain(`<p class="settings-note">${NOTE}</p>`);
      expect(row(html, 'settings-human-bots')).not.toContain(NOTE);
      expect(html.split(NOTE)).toHaveLength(2);
    });
  }

  it('not before any game', async () => {
    installBridge();
    const { settings } = await load();
    expect(settings()).not.toContain(NOTE);
  });

  it('not once the game is over', async () => {
    installBridge();
    const { start, settings, useGameStore } = await load();
    await start();
    useGameStore.getState().resign();
    expect(useGameStore.getState().phase).toBe('finished');
    expect(settings()).not.toContain(NOTE);
  });

  it('not once the game was left for home', async () => {
    installBridge();
    const { start, settings, useGameStore } = await load();
    await start();
    useGameStore.getState().leaveGame();
    expect(settings()).not.toContain(NOTE);
  });

  it('not in a game with no bot (two players on one device)', async () => {
    installBridge();
    const { start, settings } = await load();
    await start('local');
    expect(settings()).not.toContain(NOTE);
  });

  it('not where the row cannot be changed (the web, or a device held to the online bots)', async () => {
    for (const where of ['web', 'held'] as const) {
      vi.resetModules();
      if (where === 'held') installBridge(false);
      else delete (globalThis as { window?: unknown }).window;
      installServer();
      const { start, settings, useGameStore } = await load();
      await start();
      expect(useGameStore.getState().gameId).toBe('srv00001');
      expect(settings()).not.toContain(NOTE);
    }
  });
});
