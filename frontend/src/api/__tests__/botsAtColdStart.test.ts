/**
 * Where the bots play, decided once at cold start from the device's
 * capabilities() answer (capabilitiesStore.ts botsPlayOnline).
 *
 * The web, and a device whose answer says `localBots: false`, play only the
 * online bots: "Bot plays online" is effectively on, the row cannot turn it
 * off, and nothing reaches the device engine. A bridge without the call, or
 * whose call throws, plays as before (`localBots: true`); so does a device
 * whose answer allows its own bots, where the stored choice stands. A bot
 * move or a new game asked before the answer waits for it, up to
 * BOT_ROUTING_WAIT_MS, then plays as before.
 *
 * Runs through client.ts and replayStore against a fake bridge, with fresh
 * modules per test. vitest's env is 'node': localStorage, window and fetch
 * are shimmed as in cloudBot.test.ts.
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
const SLOW: Caps = { localBots: false, evalsPerSecond: 3, humanModel: true };
const FAST: Caps = { localBots: true, evalsPerSecond: 60, humanModel: true };

/** Fake `window.kataGo`. capabilities(): absent, answering `caps`, throwing,
 *  or 'late' (answers when the test calls answer()). The engine methods are
 *  spies so a test can say none was asked. */
function installBridge(caps: Caps | 'absent' | 'throw' | 'late') {
  let answer: (c: Caps) => void = () => {};
  const analyze = vi.fn(async (params: Record<string, unknown>) => ({
    candidates: [{ move: 'E5', visits: 16, winrate: 0.5, scoreLead: 0.5, prior: 0.95, order: 0 }],
    rootVisits: Number(params.maxVisits),
    kataGoPlayedMove: 'E5',
  }));
  const humanPolicy = vi.fn(async () => ({ humanPolicy: null, policy: null, scoreLead: 0 }));
  const scoreAfter = vi.fn(async () => ({ scoreLead: 0, winrate: 0.5 }));
  const capabilities = vi.fn(() => {
    if (caps === 'throw') return Promise.reject(new Error('no probe'));
    if (caps === 'late') return new Promise<Caps>((resolve) => (answer = resolve));
    return Promise.resolve(caps as Caps);
  });
  const shareSGF = vi.fn(async () => ({ ok: true }));
  const bridge: Record<string, unknown> = { ping: async () => ({ pong: true }), analyze, humanPolicy, scoreAfter, shareSGF };
  if (caps !== 'absent') bridge.capabilities = capabilities;
  (globalThis as { window?: unknown }).window = { kataGo: bridge, setTimeout, clearTimeout };
  return { analyze, humanPolicy, scoreAfter, shareSGF, capabilities, answer: (c: Caps) => answer(c) };
}

/** The server: a game, a bot move and a finish move, each its own DTO. */
function installServer() {
  const fetchMock = vi.fn(async (url: string) => {
    const path = String(url).replace(/^.*\/api/, '');
    const body =
      path === '/games'
        ? { game_id: 'srv00001', board: [], phase: 'playing' }
        : { point: { row: 2, col: 3 }, captures: [], score_lead: 1, via: path };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  const paths = () => fetchMock.mock.calls.map(([u]) => String(u).replace(/^.*\/api/, ''));
  return { fetchMock, paths };
}

/** Seed the stored settings, then load the app's modules fresh, starting the
 *  capabilities read as main.tsx does (not awaited). */
async function boot(stored: { cloudBot?: boolean; humanBots?: boolean } = {}) {
  localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', ...stored }));
  const caps = await import('../../store/capabilitiesStore');
  void caps.readDeviceCapabilities();
  const { useSettingsStore } = await import('../../store/settingsStore');
  const native = await import('../nativeKataGo');
  const { api } = await import('../client');
  return { caps, useSettingsStore, native, api };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const LOCAL_ID = /^[0-9a-f]{8}$/;
const storedCloudBot = () => JSON.parse(localStorage.getItem('goforkids_settings') ?? '{}').cloudBot;

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('no bridge (the web)', () => {
  it('the online bots are the only bots, and the stored choice is left alone', async () => {
    const server = installServer();
    const { caps, useSettingsStore, native, api } = await boot({ cloudBot: false });
    expect(caps.botRoutingKnown()).toBe(true);
    expect(caps.onlineBotsOnly()).toBe(true);
    expect(caps.botsPlayOnline()).toBe(true);
    expect(native.getKataGoBridge()).toBeNull();
    expect(useSettingsStore.getState().cloudBot).toBe(false);

    const game = await api.createGame({ board_size: 9, target_rank: '15k' });
    expect(game.game_id).toBe('srv00001');
    await api.getAIMove(game.game_id, '15k');
    expect(server.paths()).toEqual(['/games', '/games/srv00001/ai-move']);
    expect(storedCloudBot()).toBe(false);
  });

  it('nothing to wait for: known before any read, and no timer is set', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const caps = await import('../../store/capabilitiesStore');
    expect(caps.botRoutingKnown()).toBe(true);
    const known = caps.whenBotRoutingKnown();
    expect(vi.getTimerCount()).toBe(0);
    await known;
  });

  it('the Settings row shows on and locked, labelled without "(for older iPads)"', async () => {
    await boot({ cloudBot: false });
    const { SettingsDialog } = await import('../../components/SettingsDialog');
    const html = renderToStaticMarkup(createElement(SettingsDialog, { onClose: () => {} }));
    const row = html.slice(html.indexOf('settings-cloud-bot'));
    expect(html).toContain('dialog-field settings-cloud-bot locked');
    expect(row).toMatch(/^[^>]*><label><input type="checkbox" checked=""/);
    expect(row).toContain('Bot plays online</label>');
    expect(html).not.toContain('older iPads');
  });
});

describe('a bridge whose capabilities say localBots: false', () => {
  it('"Bot plays online" is effectively on; the stored choice is not overwritten', async () => {
    installBridge(SLOW);
    const { caps, useSettingsStore, native } = await boot({ cloudBot: false });
    await caps.whenBotRoutingKnown();
    expect(caps.onlineBotsOnly()).toBe(true);
    expect(caps.botsPlayOnline()).toBe(true);
    expect(native.getKataGoBridge()).toBeNull();
    expect(native.getNativeBridge()).not.toBeNull(); // the share sheet stays
    expect(useSettingsStore.getState().cloudBot).toBe(false);
    expect(storedCloudBot()).toBe(false);
  });

  it('the row cannot turn it off: a tap stores nothing and shows the sentence', async () => {
    installBridge(SLOW);
    const { caps } = await boot({ cloudBot: false });
    await caps.whenBotRoutingKnown();
    const { tapCloudBotRow, CLOUD_LOCKED_NOTE } = await import('../../components/cloudBotRow');
    const { CloudBotRow } = await import('../../components/SettingsDialog');
    const setCloudBot = vi.fn();
    const showNote = vi.fn();
    tapCloudBotRow(caps.onlineBotsOnly(), false, { setCloudBot, showNote });
    expect(setCloudBot).not.toHaveBeenCalled();
    expect(showNote).toHaveBeenCalledTimes(1);
    expect(caps.botsPlayOnline()).toBe(true);

    const row = (noteShown: boolean) =>
      renderToStaticMarkup(createElement(CloudBotRow, { checked: true, locked: true, noteShown, onToggle: () => {} }));
    expect(row(false)).not.toContain(CLOUD_LOCKED_NOTE);
    expect(row(true)).toContain(`<p class="settings-note">${CLOUD_LOCKED_NOTE}</p>`);
    expect(row(true)).toContain('settings-cloud-bot locked');
  });

  it('nothing reaches the engine: new game, bot move, finish, the review, the human path', async () => {
    const b = installBridge(SLOW);
    const server = installServer();
    const { caps, native, api } = await boot({ cloudBot: false, humanBots: true });
    const game = await api.createGame({ board_size: 9, target_rank: '15k' });
    expect(game.game_id).toBe('srv00001');
    await api.getAIMove(game.game_id, '15k', { movesForBridge: [], handicap: 0 });
    await api.finishMove(game.game_id, { movesForBridge: [] });
    expect(native.getHumanRung('15k', 9)).toBeUndefined();
    expect(caps.hasHumanModel()).toBe(true); // reported, but not used

    const { useReplayStore } = await import('../../store/replayStore');
    await loadMistakeGame(useReplayStore);
    useReplayStore.getState().goToMove(3);
    await flush();
    expect(useReplayStore.getState().betterMove).toBeNull();

    expect(server.paths()).toEqual(['/games', '/games/srv00001/ai-move', '/games/srv00001/finish-move']);
    expect(b.analyze).not.toHaveBeenCalled();
    expect(b.humanPolicy).not.toHaveBeenCalled();
    expect(b.scoreAfter).not.toHaveBeenCalled();
    expect(b.capabilities).toHaveBeenCalledTimes(1);
  });

  it('the review still shares through the share sheet, which is not the engine', async () => {
    const b = installBridge(SLOW);
    const { caps } = await boot();
    await caps.whenBotRoutingKnown();
    const { useReplayStore } = await import('../../store/replayStore');
    await loadMistakeGame(useReplayStore);
    useReplayStore.getState().downloadSGF();
    expect(b.shareSGF).toHaveBeenCalledTimes(1);
    expect(b.analyze).not.toHaveBeenCalled();
  });

  it('a later launch whose answer allows the device bots keeps the stored choice', async () => {
    installBridge(SLOW);
    const first = await boot({ cloudBot: false });
    await first.caps.whenBotRoutingKnown();
    expect(first.caps.botsPlayOnline()).toBe(true);

    vi.resetModules();
    installBridge(FAST);
    const caps = await import('../../store/capabilitiesStore');
    await caps.whenBotRoutingKnown();
    const { getKataGoBridge } = await import('../nativeKataGo');
    expect(caps.botsPlayOnline()).toBe(false);
    expect(getKataGoBridge()).not.toBeNull();
  });
});

describe('builds and answers that keep today\'s behaviour (localBots true)', () => {
  for (const [name, caps] of [
    ['a bridge without capabilities()', 'absent'],
    ['a bridge whose capabilities() throws', 'throw'],
  ] as const) {
    it(`${name}: the device plays, as today`, async () => {
      const b = installBridge(caps);
      const server = installServer();
      const { caps: store, api } = await boot();
      const game = await api.createGame({ board_size: 9, target_rank: '15k' });
      expect(game.game_id).toMatch(LOCAL_ID);
      await api.getAIMove(game.game_id, '15k', { movesForBridge: [], handicap: 0 });
      expect(b.analyze).toHaveBeenCalledTimes(1);
      expect(server.fetchMock).not.toHaveBeenCalled();
      expect(store.botRoutingKnown()).toBe(true);
      expect(store.botsPlayOnline()).toBe(false);
      expect(store.useCapabilitiesStore.getState().gaveUp).toBe(false);
      if (caps === 'throw') expect(console.warn).toHaveBeenCalledWith('[capabilities] the bridge could not report them:', expect.any(Error));
    });
  }

  it('localBots true, stored choice off: the device plays, and the row stores a tap', async () => {
    const b = installBridge(FAST);
    const server = installServer();
    const { caps, useSettingsStore, api } = await boot({ cloudBot: false });
    const game = await api.createGame({ board_size: 9, target_rank: '15k' });
    expect(game.game_id).toMatch(LOCAL_ID);
    await api.getAIMove(game.game_id, '15k', { movesForBridge: [], handicap: 0 });
    expect(b.analyze).toHaveBeenCalledTimes(1);
    expect(server.fetchMock).not.toHaveBeenCalled();

    const { tapCloudBotRow } = await import('../../components/cloudBotRow');
    const showNote = vi.fn();
    tapCloudBotRow(caps.onlineBotsOnly(), true, { setCloudBot: useSettingsStore.getState().setCloudBot, showNote });
    expect(showNote).not.toHaveBeenCalled();
    expect(storedCloudBot()).toBe(true);
    expect(caps.botsPlayOnline()).toBe(true);
  });

  it('localBots true, stored choice on: the server plays, and the row turns it off', async () => {
    const b = installBridge(FAST);
    const server = installServer();
    const { caps, useSettingsStore, api } = await boot({ cloudBot: true });
    const game = await api.createGame({ board_size: 9, target_rank: '15k' });
    expect(game.game_id).toBe('srv00001');
    await api.getAIMove(game.game_id, '15k');
    expect(server.paths()).toEqual(['/games', '/games/srv00001/ai-move']);
    expect(b.analyze).not.toHaveBeenCalled();

    const { tapCloudBotRow } = await import('../../components/cloudBotRow');
    tapCloudBotRow(caps.onlineBotsOnly(), false, { setCloudBot: useSettingsStore.getState().setCloudBot, showNote: vi.fn() });
    expect(storedCloudBot()).toBe(false);
    expect(caps.botsPlayOnline()).toBe(false);
  });

  it('the Settings row on such a device: the stored choice, not locked', async () => {
    installBridge(FAST);
    for (const cloudBot of [false, true]) {
      vi.resetModules();
      await boot({ cloudBot });
      const { SettingsDialog } = await import('../../components/SettingsDialog');
      const html = renderToStaticMarkup(createElement(SettingsDialog, { onClose: () => {} }));
      const row = html.slice(html.indexOf('settings-cloud-bot'));
      expect(row).toMatch(/^settings-cloud-bot"><label>/);
      expect(/^[^>]*><label><input type="checkbox" checked=""/.test(row)).toBe(cloudBot);
    }
  });
});

describe('the effective value as components read it (useBotsPlayOnline)', () => {
  // Server rendering reads each store's state at creation: the stored
  // settings, and no capabilities answer yet (a locked device's row is the
  // layout suite's).
  const probe = async () => {
    const { useBotsPlayOnline } = await import('../../store/capabilitiesStore');
    return renderToStaticMarkup(createElement(() => String(useBotsPlayOnline())));
  };

  it('the web: on, whatever is stored', async () => {
    await boot({ cloudBot: false });
    expect(await probe()).toBe('true');
  });

  it('a device that may play its own bots: the stored choice', async () => {
    installBridge(FAST);
    await boot({ cloudBot: false });
    expect(await probe()).toBe('false');
    vi.resetModules();
    await boot({ cloudBot: true });
    expect(await probe()).toBe('true');
  });
});

describe('asked before the answer arrives', () => {
  it('a new game waits, then lives on the server when the answer locks the device', async () => {
    const b = installBridge('late');
    const server = installServer();
    const { caps, api } = await boot();
    let done = false;
    const pending = api.createGame({ board_size: 9, target_rank: '15k' }).then((g) => ((done = true), g));
    await flush();
    expect(done).toBe(false);
    expect(server.fetchMock).not.toHaveBeenCalled();
    expect(caps.botRoutingKnown()).toBe(false);

    b.answer(SLOW);
    expect((await pending).game_id).toBe('srv00001');
    await api.getAIMove('srv00001', '15k', { movesForBridge: [], handicap: 0 });
    expect(server.paths()).toEqual(['/games', '/games/srv00001/ai-move']);
    expect(b.analyze).not.toHaveBeenCalled();
  });

  it('a new game waits, then lives on the device when the answer allows it', async () => {
    const b = installBridge('late');
    const server = installServer();
    const { api } = await boot();
    const pending = api.createGame({ board_size: 9, target_rank: '15k' });
    await flush();
    b.answer(FAST);
    const game = await pending;
    expect(game.game_id).toMatch(LOCAL_ID);
    await api.getAIMove(game.game_id, '15k', { movesForBridge: [], handicap: 0 });
    expect(b.analyze).toHaveBeenCalledTimes(1);
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it('a bot move and a finish move wait too', async () => {
    const b = installBridge('late');
    const server = installServer();
    const { api } = await boot();
    const move = api.getAIMove('srv00001', '15k', { movesForBridge: [], handicap: 0 });
    const finish = api.finishMove('srv00001', { movesForBridge: [] });
    await flush();
    expect(server.fetchMock).not.toHaveBeenCalled();
    expect(b.analyze).not.toHaveBeenCalled();
    b.answer(SLOW);
    await Promise.all([move, finish]);
    expect(server.paths()).toEqual(['/games/srv00001/ai-move', '/games/srv00001/finish-move']);
    expect(b.analyze).not.toHaveBeenCalled();
  });

  it('the review waits, then asks the device engine when the answer allows it', async () => {
    const b = installBridge('late');
    installServer();
    await boot();
    const { useReplayStore } = await import('../../store/replayStore');
    await loadMistakeGame(useReplayStore);
    useReplayStore.getState().goToMove(3);
    await flush();
    expect(b.analyze).not.toHaveBeenCalled();
    b.answer(FAST);
    await flush();
    expect(b.analyze).toHaveBeenCalledTimes(1);
    expect(useReplayStore.getState().betterMove).toEqual({ row: 4, col: 4 }); // E5
  });

  it('the review asks nothing once the answer comes if the cursor has moved on', async () => {
    const b = installBridge('late');
    installServer();
    await boot();
    const { useReplayStore } = await import('../../store/replayStore');
    await loadMistakeGame(useReplayStore);
    useReplayStore.getState().goToMove(3);
    await flush();
    useReplayStore.getState().goToMove(2);
    b.answer(FAST);
    await flush();
    await flush();
    expect(b.analyze).not.toHaveBeenCalled();
  });

  it('the review waits, then asks nothing when the answer locks the device', async () => {
    const b = installBridge('late');
    installServer();
    await boot();
    const { useReplayStore } = await import('../../store/replayStore');
    await loadMistakeGame(useReplayStore);
    useReplayStore.getState().goToMove(3);
    await flush();
    b.answer(SLOW);
    await flush();
    await flush();
    expect(b.analyze).not.toHaveBeenCalled();
    expect(useReplayStore.getState().betterMove).toBeNull();
  });

  it(`the wait is bounded: after the bound the device plays as today, and a later answer does not move it`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = installBridge('late');
    const server = installServer();
    const { caps, api } = await boot();
    expect(caps.BOT_ROUTING_WAIT_MS).toBe(10_000);
    let done = false;
    const pending = api.createGame({ board_size: 9, target_rank: '15k' }).then((g) => ((done = true), g));
    await vi.advanceTimersByTimeAsync(caps.BOT_ROUTING_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect((await pending).game_id).toMatch(LOCAL_ID);
    expect(caps.useCapabilitiesStore.getState().gaveUp).toBe(true);
    expect(caps.botRoutingKnown()).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no answer in 10000ms'));

    b.answer(SLOW); // too late: this launch stays on the device
    await vi.advanceTimersByTimeAsync(0);
    expect(caps.useCapabilitiesStore.getState().capabilities).toEqual(SLOW);
    expect(caps.botsPlayOnline()).toBe(false);
    await api.getAIMove((await pending).game_id, '15k', { movesForBridge: [], handicap: 0 });
    expect(b.analyze).toHaveBeenCalledTimes(1);
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it('an answer inside the bound cancels the give-up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = installBridge('late');
    installServer();
    const { caps, api } = await boot();
    const pending = api.createGame({ board_size: 9, target_rank: '15k' });
    await vi.advanceTimersByTimeAsync(caps.BOT_ROUTING_WAIT_MS - 1);
    b.answer(SLOW);
    expect((await pending).game_id).toBe('srv00001');
    await vi.advanceTimersByTimeAsync(caps.BOT_ROUTING_WAIT_MS);
    expect(caps.useCapabilitiesStore.getState().gaveUp).toBe(false);
    expect(caps.botsPlayOnline()).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

/** A 9×9 game where the player (Black) blunders at move 3, as in
 *  replayStore.betterMove.test.ts: one 'learn' highlight there. */
async function loadMistakeGame(store: typeof import('../../store/replayStore').useReplayStore) {
  const { Game } = await import('../../engine/Game');
  const g = new Game(5.5, 9);
  for (const [row, col] of [[8, 0], [4, 4], [8, 1], [5, 4]]) g.playMove({ row, col });
  store.getState().loadGame(g.toSGF(), {
    playerColor: 'black',
    scoreHistory: [
      { move: 0, lead: 0 },
      { move: 1, lead: 0 },
      { move: 2, lead: 0 },
      { move: 3, lead: -9 },
      { move: 4, lead: -9 },
    ],
  });
}
