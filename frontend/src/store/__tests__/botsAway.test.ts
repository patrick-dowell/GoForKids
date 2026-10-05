/**
 * No bots, no frozen board.
 *
 * While the bots play online (the web, a device too slow for its own, or the
 * setting), the server's GET /health decides whether a game against them may
 * start: when it does not answer, ranked Play and Custom Match's bot modes
 * are greyed with one sentence and a "Try again", and lessons and play with
 * a friend stay open (serverReachStore.ts). A device that plays its own bots
 * never asks. And a game whose bot stops answering, on the server or on the
 * device, waits under a card with "Try again" and "Leave" instead of
 * freezing: nothing is ended, scored or recorded by the failure
 * (gameStore botTrouble).
 *
 * Runs the real stores and client against a fake server (fetch) and a fake
 * bridge, with fresh modules per test. vitest's env is 'node': localStorage,
 * window and document are shimmed, and components are server-rendered.
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
const SLOW: Caps = { localBots: false, evalsPerSecond: 3, humanModel: false };
const FAST: Caps = { localBots: true, evalsPerSecond: 60, humanModel: false };

const E5 = { candidates: [{ move: 'E5', visits: 16, winrate: 0.5, scoreLead: 0.5, prior: 0.95, order: 0 }], rootVisits: 16, kataGoPlayedMove: 'E5' };

/** `window` without a bridge (the web), or with a fake one whose engine
 *  answers E5 until `broken` is set. capabilities() answers `caps`, or
 *  answers when the test calls answer() ('late'). */
function installWindow(caps?: Caps | 'late') {
  const engine = { broken: false as boolean | 'hang', hung: [] as Array<(r: typeof E5) => void> };
  let answer: (c: Caps) => void = () => {};
  const analyze = vi.fn(() => {
    if (engine.broken === 'hang') return new Promise<typeof E5>((resolve) => engine.hung.push(resolve));
    return engine.broken ? Promise.reject(new Error('engine crashed')) : Promise.resolve(E5);
  });
  const kataGo = caps && {
    ping: async () => ({ pong: true }),
    analyze,
    capabilities: () => (caps === 'late' ? new Promise<Caps>((r) => (answer = r)) : Promise.resolve(caps)),
  };
  // The timer functions are looked up when called, so fake timers apply.
  const timers = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (t?: ReturnType<typeof setTimeout>) => clearTimeout(t),
  };
  (globalThis as { window?: unknown }).window = { ...(kataGo ? { kataGo } : {}), ...timers };
  return { engine, analyze, answer: (c: Caps) => answer(c) };
}

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: String(status), json: async () => body });

/** The server: /health and one game's routes. `down` makes /health fail to
 *  connect and every API route answer 503, `aiDown` only the bot's move;
 *  `hang` keeps /health waiting (until the request is aborted). The game counts moves as the server
 *  would; its bot plays down the first column. */
function installServer() {
  const s = { down: false, aiDown: false, hang: false, moves: 0, lastMove: null as null | { row: number; col: number }, aiMoves: 0 };
  const log: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.endsWith('/health')) {
      log.push('GET /health');
      if (s.hang) {
        return new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      }
      if (s.down) throw new TypeError('Failed to fetch');
      return json({ status: 'ok' });
    }
    const path = u.replace(/^.*\/api/, '');
    log.push(`${method} ${path}`);
    if (s.down) return json({ detail: 'down' }, 503);
    // move_number is the next move's number, as the server sends it
    const state = () => ({ game_id: 'srv00001', board_size: 9, move_number: s.moves + 1, last_move: s.lastMove, phase: 'playing' });
    if (path === '/games') return json(state());
    if (path === '/games/srv00001' && method === 'GET') return json(state());
    if (path === '/games/srv00001/move' || path === '/games/srv00001/pass') {
      s.moves++;
      s.lastMove = path.endsWith('/move') ? JSON.parse(String(init?.body)) : null;
      return json(state());
    }
    if (path === '/games/srv00001/ai-move') {
      if (s.aiDown) return json({ detail: 'busy' }, 503);
      s.moves++;
      s.lastMove = { row: s.aiMoves++, col: 0 };
      return json({ point: s.lastMove, captures: [], score_lead: 0 });
    }
    return json({ detail: 'no route' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { s, log, fetchMock, health: () => log.filter((l) => l === 'GET /health').length };
}

/** Seed the stored settings, then load the app's modules fresh, starting the
 *  capabilities read as main.tsx does. */
async function boot(stored: { cloudBot?: boolean } = {}) {
  localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', ...stored }));
  const caps = await import('../capabilitiesStore');
  void caps.readDeviceCapabilities();
  const reach = await import('../serverReachStore');
  const { useGameStore } = await import('../gameStore');
  const { useSettingsStore } = await import('../settingsStore');
  const { useAutoPlayStore } = await import('../autoPlayStore');
  const { useLibraryStore } = await import('../libraryStore');
  const client = await import('../../api/client');
  return { caps, reach, useGameStore, useSettingsStore, useAutoPlayStore, useLibraryStore, client };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A button by its text in server-rendered markup: whether it is disabled. */
function button(html: string, label: string) {
  for (const seg of html.split('<button').slice(1)) {
    const inner = seg.split('</button>')[0];
    const open = inner.slice(0, inner.indexOf('>'));
    if (inner.slice(inner.indexOf('>') + 1).replace(/<[^>]+>/g, '') === label) {
      return { disabled: open.includes(' disabled=""'), selected: /class="[^"]*\bselected\b/.test(open) };
    }
  }
  throw new Error(`no button "${label}"`);
}

async function render(name: 'HomePage' | 'AutoPlayView' | 'NewGameDialog' | 'BotsAwayNote') {
  const noop = () => {};
  if (name === 'HomePage') {
    const { HomePage } = await import('../../components/HomePage');
    const p = { onAutoPlay: noop, onCustomMatch: noop, onLibrary: noop, onLearn: noop, onProfile: noop, onFriends: noop };
    return renderToStaticMarkup(createElement(HomePage, p));
  }
  if (name === 'AutoPlayView') {
    const { AutoPlayView } = await import('../../components/AutoPlayView');
    return renderToStaticMarkup(createElement(AutoPlayView, { onExit: noop, onStart: noop }));
  }
  if (name === 'NewGameDialog') {
    const { NewGameDialog } = await import('../../components/NewGameDialog');
    return renderToStaticMarkup(createElement(NewGameDialog, { onClose: noop }));
  }
  const { BotsAwayNote } = await import('../../components/BotsAwayNote');
  return renderToStaticMarkup(createElement(BotsAwayNote));
}

const BOTS_AWAY = "The bots can&#x27;t play right now. You can still do lessons, or play with a friend next to you.";

/** A fake `document` the foreground listener can hear. */
function installDocument() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
  (globalThis as { document?: unknown }).document = doc;
  return {
    show: () => ((doc.visibilityState = 'visible'), doc.dispatchEvent(new Event('visibilitychange'))),
    hide: () => ((doc.visibilityState = 'hidden'), doc.dispatchEvent(new Event('visibilitychange'))),
  };
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the check', () => {
  it('asks GET /health, outside /api: an answer is up; no connection, or a refusal, is down', async () => {
    installWindow();
    const server = installServer();
    const { reach } = await boot();
    await reach.checkServer();
    expect(server.fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/health');
    expect(reach.useServerReachStore.getState()).toEqual({ reach: 'up', checking: false });
    expect(reach.cloudBotsOut()).toBe(false);

    server.s.down = true;
    await reach.checkServer();
    expect(reach.useServerReachStore.getState().reach).toBe('down');
    expect(reach.cloudBotsOut()).toBe(true);

    server.fetchMock.mockResolvedValueOnce(json({ detail: 'deploying' }, 502) as never);
    server.s.down = false;
    await reach.checkServer();
    expect(reach.useServerReachStore.getState().reach).toBe('down');
  });

  it(`waits ${5}s at most, then says down`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    installWindow();
    const server = installServer();
    server.s.hang = true;
    const { reach } = await boot();
    expect(reach.HEALTH_TIMEOUT_MS).toBe(5_000);
    const done = reach.checkServer();
    await vi.advanceTimersByTimeAsync(reach.HEALTH_TIMEOUT_MS - 1);
    expect(reach.useServerReachStore.getState()).toEqual({ reach: 'unknown', checking: true });
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(reach.useServerReachStore.getState()).toEqual({ reach: 'down', checking: false });
  });

  it('checks asked for while one waits share it', async () => {
    installWindow();
    const server = installServer();
    const { reach } = await boot();
    await Promise.all([reach.checkServer(), reach.checkServer(), reach.checkServerIfNeeded()]);
    expect(server.health()).toBe(1);
    await reach.checkServer();
    expect(server.health()).toBe(2);
  });

  it('before the first answer nothing is greyed, and Try again says it is checking', async () => {
    installWindow();
    const server = installServer();
    server.s.hang = true;
    const { reach } = await boot();
    void reach.checkServer();
    expect(reach.cloudBotsOut()).toBe(false);
    expect(button(await render('HomePage'), '▶Play').disabled).toBe(false);
    expect(button(await render('BotsAwayNote'), 'Checking…').disabled).toBe(true);
  });
});

describe('offline at start (the web)', () => {
  it('ranked Play and the bot modes are greyed with why; lessons and a friend on this device stay open', async () => {
    installWindow();
    const server = installServer();
    server.s.down = true;
    const { reach, useGameStore } = await boot();
    reach.watchServer();
    await vi.waitFor(() => expect(reach.useServerReachStore.getState().reach).toBe('down'));
    expect(server.health()).toBe(1);

    const home = await render('HomePage');
    expect(button(home, '▶Play').disabled).toBe(true);
    expect(button(home, '✨Learn to Play').disabled).toBe(false);
    expect(button(home, '⚙Custom Match').disabled).toBe(false);
    expect(home).toContain(BOTS_AWAY);
    expect(button(home, 'Try again').disabled).toBe(false);
    expect(home).not.toContain('Choose your opponent');

    const picker = await render('AutoPlayView');
    expect(button(picker, '▶Play').disabled).toBe(true);
    expect(picker).toContain(BOTS_AWAY);

    const dialog = await render('NewGameDialog');
    expect(button(dialog, 'Play vs AI').disabled).toBe(true);
    expect(button(dialog, 'Bot vs Bot').disabled).toBe(true);
    expect(button(dialog, 'Local')).toEqual({ disabled: false, selected: true });
    expect(button(dialog, 'Start Game').disabled).toBe(false);
    expect(dialog).toContain(BOTS_AWAY);

    // play with a friend: no server needed
    await useGameStore.getState().newGame({ gameMode: 'local', boardSize: 9 });
    expect(useGameStore.getState().gameMode).toBe('local');
    expect(useGameStore.getState().botTrouble).toBeNull();
    expect(server.log.filter((l) => l !== 'GET /health')).toEqual([]);
  });

  it('with the server up nothing is greyed and the roster shows', async () => {
    installWindow();
    installServer();
    const { reach } = await boot();
    reach.watchServer();
    await vi.waitFor(() => expect(reach.useServerReachStore.getState().reach).toBe('up'));
    const home = await render('HomePage');
    expect(button(home, '▶Play').disabled).toBe(false);
    expect(home).toContain('Choose your opponent');
    expect(home).not.toContain(BOTS_AWAY);
    expect(button(await render('AutoPlayView'), '▶Play').disabled).toBe(false);
    const dialog = await render('NewGameDialog');
    expect(button(dialog, 'Play vs AI')).toEqual({ disabled: false, selected: true });
    expect(dialog).not.toContain(BOTS_AWAY);
  });
});

describe('the server coming back', () => {
  async function offline() {
    installWindow();
    const server = installServer();
    server.s.down = true;
    const booted = await boot();
    const doc = installDocument();
    booted.reach.watchServer();
    await vi.waitFor(() => expect(booted.reach.cloudBotsOut()).toBe(true));
    server.s.down = false;
    return { server, doc, ...booted };
  }

  it('a tap of Try again asks again and un-greys', async () => {
    const { reach, server } = await offline();
    // the note's button calls checkServer
    await reach.checkServer();
    expect(server.health()).toBe(2);
    expect(reach.cloudBotsOut()).toBe(false);
    expect(button(await render('HomePage'), '▶Play').disabled).toBe(false);
  });

  it('the return to the foreground asks again and un-greys; going to the background does not ask', async () => {
    const { reach, server, doc } = await offline();
    doc.hide();
    await flush();
    expect(server.health()).toBe(1);
    doc.show();
    await vi.waitFor(() => expect(reach.cloudBotsOut()).toBe(false));
    expect(server.health()).toBe(2);
  });

  it('a stopped watch no longer listens', async () => {
    installWindow();
    const server = installServer();
    const { reach, useSettingsStore } = await boot({ cloudBot: false });
    const doc = installDocument();
    const stop = reach.watchServer();
    await flush();
    stop();
    doc.show();
    useSettingsStore.getState().setCloudBot(true);
    await flush();
    expect(server.health()).toBe(1);
  });
});

describe('when the bots turn online after start', () => {
  it("a slow device's late answer asks; until then nothing was asked", async () => {
    const w = installWindow('late');
    const server = installServer();
    server.s.down = true;
    const { reach } = await boot();
    reach.watchServer();
    await flush();
    expect(server.health()).toBe(0);
    w.answer(SLOW);
    await vi.waitFor(() => expect(reach.cloudBotsOut()).toBe(true));
    expect(server.health()).toBe(1);
  });

  it('turning "Bot plays online" on asks; turning it off un-greys without asking', async () => {
    installWindow(FAST);
    const server = installServer();
    server.s.down = true;
    const { caps, reach, useSettingsStore } = await boot({ cloudBot: false });
    await caps.whenBotRoutingKnown();
    reach.watchServer();
    await flush();
    expect(server.health()).toBe(0);
    useSettingsStore.getState().setCloudBot(true);
    await vi.waitFor(() => expect(reach.cloudBotsOut()).toBe(true));
    expect(server.health()).toBe(1);
    useSettingsStore.getState().setCloudBot(false);
    expect(reach.cloudBotsOut()).toBe(false);
    useSettingsStore.getState().setCloudBot(false);
    await flush();
    expect(server.health()).toBe(1);
  });
});

describe('a device that plays its own bots (localBots true, "Bot plays online" off)', () => {
  it('never asks the server, is never greyed, and plays ranked and custom bot games with no server at all', async () => {
    const w = installWindow(FAST);
    const server = installServer();
    server.s.down = true;
    const { caps, reach, useGameStore } = await boot({ cloudBot: false });
    await caps.whenBotRoutingKnown();
    const doc = installDocument();
    reach.watchServer();
    doc.show();
    await reach.checkServerIfNeeded();
    expect(server.health()).toBe(0);

    // even a "down" answer left over from elsewhere greys nothing here
    reach.useServerReachStore.setState({ reach: 'down' });
    expect(reach.cloudBotsOut()).toBe(false);
    expect(button(await render('HomePage'), '▶Play').disabled).toBe(false);
    expect(button(await render('NewGameDialog'), 'Play vs AI').disabled).toBe(false);

    for (const opts of [{ autoplayContext: true }, { gameMode: 'botvsbot' as const, blackRank: '15k', whiteRank: '15k' }]) {
      await useGameStore.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: true, ...opts });
      expect(useGameStore.getState().gameId).toMatch(/^[0-9a-f]{8}$/);
      expect(useGameStore.getState().botTrouble).toBeNull();
    }
    await vi.waitFor(() => expect(w.analyze).toHaveBeenCalled()); // the bot-vs-bot game plays on the device
    useGameStore.getState().toggleBotVsBotPause();
    expect(server.fetchMock).not.toHaveBeenCalled();
  });
});

/** A ranked 9×9 game on the server, the player Black. */
async function serverGame() {
  installWindow();
  const server = installServer();
  const booted = await boot();
  await booted.useGameStore.getState().newGame({
    boardSize: 9,
    targetRank: '15k',
    useBackend: true,
    gameMode: 'ai',
    autoplayContext: true,
  });
  booted.useAutoPlayStore.getState().setGamePending(true);
  expect(booted.useGameStore.getState().gameId).toBe('srv00001');
  return { server, ...booted };
}

const stones = (g: { getState: () => { getBoard: () => { grid: number[] } } }) =>
  g.getState().getBoard().grid.filter((c) => c !== 0).length;

describe('a drop in the middle of a game on the server', () => {
  it("the player's move does not reach it: the card, nothing else; Try again sends it once the server is back, and the bot answers", async () => {
    const { server, useGameStore } = await serverGame();
    server.s.down = true;
    useGameStore.getState().playMove({ row: 4, col: 4 });
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    let st = useGameStore.getState();
    expect(st.aiThinking).toBe(false);
    expect(st.phase).toBe('playing');
    expect(st.result).toBeNull();
    expect(stones(useGameStore)).toBe(1);
    // nothing on the board changes while the card is up
    expect(useGameStore.getState().playMove({ row: 0, col: 0 })).toBe('game_over');
    useGameStore.getState().pass();
    expect(stones(useGameStore)).toBe(1);
    expect(useGameStore.getState().moveCount).toBe(1);

    // still down: the card again
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    expect(useGameStore.getState().aiThinking).toBe(false);

    server.s.down = false;
    server.log.length = 0;
    useGameStore.getState().retryBot();
    expect(useGameStore.getState().botTrouble).toBeNull();
    await vi.waitFor(() => expect(stones(useGameStore)).toBe(2));
    st = useGameStore.getState();
    expect(st.botTrouble).toBeNull();
    expect(st.aiThinking).toBe(false);
    expect(st.lastMove).toEqual({ row: 0, col: 0 });
    expect(server.log).toEqual(['GET /games/srv00001', 'POST /games/srv00001/move', 'POST /games/srv00001/ai-move']);
    expect(server.s.moves).toBe(2);
  });

  it("the move reached it and only the answer was lost: Try again does not send it twice", async () => {
    const { server, useGameStore } = await serverGame();
    server.fetchMock.mockImplementationOnce(async () => {
      server.s.moves++; // the server took the move, then the answer was lost
      throw new DOMException('aborted', 'AbortError');
    });
    useGameStore.getState().playMove({ row: 4, col: 4 });
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    server.log.length = 0;
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(stones(useGameStore)).toBe(2));
    expect(server.log).toEqual(['GET /games/srv00001', 'POST /games/srv00001/ai-move']);
  });

  it("a pass that does not reach it: the card; Try again sends the pass, and the bot answers", async () => {
    const { server, useGameStore } = await serverGame();
    server.s.down = true;
    useGameStore.getState().pass();
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    expect(useGameStore.getState().phase).toBe('playing');
    server.s.down = false;
    server.log.length = 0;
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(stones(useGameStore)).toBe(1));
    expect(server.log).toEqual(['GET /games/srv00001', 'POST /games/srv00001/pass', 'POST /games/srv00001/ai-move']);
  });

  it("the bot's move does not come: the card after the recovery ladder; Try again once the server is back plays it", async () => {
    const { server, useGameStore } = await serverGame();
    server.s.aiDown = true;
    useGameStore.getState().playMove({ row: 4, col: 4 });
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'), { timeout: 2000 });
    expect(stones(useGameStore)).toBe(1);
    expect(server.log.filter((l) => l.endsWith('/ai-move'))).toHaveLength(2); // asked, then one silent retry
    server.s.aiDown = false;
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(stones(useGameStore)).toBe(2));
    expect(useGameStore.getState().botTrouble).toBeNull();
  });

  it('leave: the game is neither ended nor scored, and no loss is recorded', async () => {
    const { server, useGameStore, useAutoPlayStore, useLibraryStore } = await serverGame();
    const before = useAutoPlayStore.getState().rungState;
    server.s.down = true;
    useGameStore.getState().playMove({ row: 4, col: 4 });
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    useGameStore.getState().leaveGame(); // App's goHome
    await new Promise((r) => setTimeout(r, 500));
    const st = useGameStore.getState();
    expect(st.botTrouble).toBeNull();
    expect(st._unsynced).toBeNull();
    expect(st.phase).toBe('playing');
    expect(st.result).toBeNull();
    expect(useAutoPlayStore.getState().history).toEqual([]);
    expect(useAutoPlayStore.getState().rungState).toEqual(before);
    expect(useLibraryStore.getState().games).toEqual([]);
    // Try again after leaving asks nothing
    server.log.length = 0;
    useGameStore.getState().retryBot();
    await flush();
    expect(server.log).toEqual([]);
  });
});

describe('a game that cannot start', () => {
  it('the card instead of a board that waits forever; the board takes nothing; Try again starts it once the server is back', async () => {
    installWindow();
    const server = installServer();
    server.s.down = true;
    const { useGameStore, useAutoPlayStore } = await boot();
    const opts = { boardSize: 9, targetRank: '15k', useBackend: true, gameMode: 'ai' as const, autoplayContext: true };
    await useGameStore.getState().newGame(opts);
    let st = useGameStore.getState();
    expect(st.botTrouble).toBe('start');
    expect(st._retryNewGame).toEqual(opts);
    expect(st.gameId).toBeNull();
    expect(st.boardSize).toBe(9);
    expect(st.autoplayContext).toBe(true);
    expect(useGameStore.getState().playMove({ row: 4, col: 4 })).toBe('game_over');
    expect(stones(useGameStore)).toBe(0);

    server.s.down = false;
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(useGameStore.getState().gameId).toBe('srv00001'));
    st = useGameStore.getState();
    expect(st.botTrouble).toBeNull();
    expect(st._retryNewGame).toBeNull();
    expect(st.autoplayContext).toBe(true);
    expect(st.targetRank).toBe('15k');
    expect(useAutoPlayStore.getState().history).toEqual([]);
  });
});

/** A ranked 9×9 game on the device, the player Black, one move played. */
async function deviceGame() {
  const w = installWindow(FAST);
  const server = installServer();
  const booted = await boot({ cloudBot: false });
  await booted.caps.whenBotRoutingKnown();
  const { useGameStore } = booted;
  await useGameStore.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: true, gameMode: 'ai', autoplayContext: true });
  booted.useAutoPlayStore.getState().setGamePending(true);
  expect(useGameStore.getState().gameId).toMatch(/^[0-9a-f]{8}$/);
  return { w, server, ...booted };
}

describe('a device engine failure in a device game', () => {
  it('no guessed move: the card; Try again plays once the engine is back; leave records nothing', async () => {
    const { w, server, useGameStore, useAutoPlayStore, useLibraryStore } = await deviceGame();
    w.engine.broken = true;
    useGameStore.getState().playMove({ row: 0, col: 8 });
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    expect(stones(useGameStore)).toBe(1); // no random move in its place
    expect(w.analyze).toHaveBeenCalledTimes(2); // asked, then one silent retry

    w.engine.broken = false;
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(stones(useGameStore)).toBe(2));
    expect(useGameStore.getState().lastMove).toEqual({ row: 4, col: 4 }); // E5
    expect(useGameStore.getState().botTrouble).toBeNull();

    w.engine.broken = true;
    useGameStore.getState().playMove({ row: 0, col: 7 });
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('move'));
    useGameStore.getState().leaveGame();
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useAutoPlayStore.getState().history).toEqual([]);
    expect(useLibraryStore.getState().games).toEqual([]);
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it(`an engine that hangs fails the move at the deadline, and its late answer commits nothing`, async () => {
    const { w, client, useGameStore } = await deviceGame();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(client.DEVICE_MOVE_DEADLINE_MS).toBe(90_000);
    const id = useGameStore.getState().gameId!;
    await client.api.playMove(id, 0, 8);
    w.engine.broken = 'hang';
    let failed: unknown = null;
    const move = client.api.getAIMove(id, '15k', { movesForBridge: [{ color: 'B', point: 'J9' }], handicap: 0 }).catch((e) => (failed = e));
    await vi.advanceTimersByTimeAsync(client.DEVICE_MOVE_DEADLINE_MS - 1);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await move;
    expect(String(failed)).toContain('did not answer in 90000ms');
    w.engine.hung.forEach((resolve) => resolve(E5));
    await vi.advanceTimersByTimeAsync(0);
    const state = await client.api.getGame(id);
    expect(state.move_number).toBe(2); // the next move is the bot's, still
    expect(state.board.flat().filter((c) => c !== 0)).toHaveLength(1);
  });

  it('a move that answers in time clears its deadline', async () => {
    const { client, useGameStore } = await deviceGame();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const id = useGameStore.getState().gameId!;
    await client.api.playMove(id, 0, 8);
    await client.api.getAIMove(id, '15k', { movesForBridge: [{ color: 'B', point: 'J9' }], handicap: 0 });
    await client.api.finishMove(id, { movesForBridge: [] }).catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Finish Game that stops: the card; Try again goes on finishing', async () => {
    const { w, useGameStore } = await deviceGame();
    w.engine.broken = true;
    await useGameStore.getState().finishGame();
    await vi.waitFor(() => expect(useGameStore.getState().botTrouble).toBe('finish'));
    let st = useGameStore.getState();
    expect(st.autoCompleting).toBe(false);
    expect(st.aiThinking).toBe(false);
    expect(st.phase).toBe('playing');
    w.engine.broken = false;
    useGameStore.getState().retryBot();
    await vi.waitFor(() => expect(stones(useGameStore)).toBeGreaterThan(0));
    st = useGameStore.getState();
    expect(st.botTrouble).toBeNull();
  });

  it('leaving during Finish Game: the step in flight is dropped, its failure raises no card, and no step follows', async () => {
    const { w, useGameStore } = await deviceGame();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    w.engine.broken = 'hang';
    await useGameStore.getState().finishGame();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.engine.hung).toHaveLength(1);
    useGameStore.getState().leaveGame();
    expect(useGameStore.getState().autoCompleting).toBe(false);
    w.engine.hung[0](E5);
    await vi.advanceTimersByTimeAsync(0);
    expect(stones(useGameStore)).toBe(0);
    expect(w.analyze).toHaveBeenCalledTimes(1);

    // a step that fails after leaving (a new device game, left mid-step)
    await useGameStore.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: true, gameMode: 'ai' });
    await useGameStore.getState().finishGame();
    await vi.advanceTimersByTimeAsync(0);
    useGameStore.getState().leaveGame();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(useGameStore.getState().botTrouble).toBeNull();
  });

  it('Try again is one request at a time', async () => {
    const { useGameStore } = await deviceGame();
    useGameStore.setState({ botTrouble: 'finish', autoCompleting: true });
    useGameStore.getState().retryBot();
    expect(useGameStore.getState().botTrouble).toBe('finish');
  });
});

describe('bot vs bot', () => {
  async function bvb() {
    installWindow();
    const server = installServer();
    const booted = await boot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await booted.useGameStore.getState().newGame({ boardSize: 9, gameMode: 'botvsbot', blackRank: '15k', whiteRank: '15k' });
    return { server, ...booted };
  }

  it('a move that does not come: the card; Try again goes on', async () => {
    const { server, useGameStore } = await bvb();
    server.s.down = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(useGameStore.getState().botTrouble).toBe('move');
    expect(useGameStore.getState().aiThinking).toBe(false);
    expect(stones(useGameStore)).toBe(0);
    server.s.down = false;
    useGameStore.getState().retryBot();
    await vi.advanceTimersByTimeAsync(0);
    expect(stones(useGameStore)).toBe(1);
    expect(useGameStore.getState().botTrouble).toBeNull();
    await vi.advanceTimersByTimeAsync(800); // and on
    expect(stones(useGameStore)).toBe(2);
    useGameStore.getState().toggleBotVsBotPause();
  });

  it('a move the server made whose answer was lost is shown, not asked for again', async () => {
    const { server, useGameStore } = await bvb();
    server.fetchMock.mockImplementationOnce(async () => {
      server.s.moves++;
      server.s.lastMove = { row: 3, col: 3 };
      throw new DOMException('aborted', 'AbortError');
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(useGameStore.getState().botTrouble).toBeNull();
    expect(useGameStore.getState().lastMove).toEqual({ row: 3, col: 3 });
    expect(server.log.filter((l) => l.endsWith('/ai-move'))).toHaveLength(0);
    useGameStore.getState().toggleBotVsBotPause();
  });

  it('a server that is ahead by a pass: the pass is shown', async () => {
    const { server, useGameStore } = await bvb();
    server.fetchMock.mockImplementationOnce(async () => {
      server.s.moves++;
      server.s.lastMove = null;
      throw new DOMException('aborted', 'AbortError');
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(useGameStore.getState().moveCount).toBe(1);
    expect(stones(useGameStore)).toBe(0);
    expect(useGameStore.getState().botTrouble).toBeNull();
    useGameStore.getState().toggleBotVsBotPause();
  });

  it('leaving stops it: no further move is asked, and an answer or a failure in flight changes nothing', async () => {
    const { server, useGameStore } = await bvb();
    await vi.advanceTimersByTimeAsync(500);
    expect(stones(useGameStore)).toBe(1);
    useGameStore.getState().leaveGame();
    server.log.length = 0;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.log).toEqual([]);
  });

  it('an answer that lands after leaving is dropped; a failure raises no card', async () => {
    const { server, useGameStore } = await bvb();
    let ai = holdNext(server, '/ai-move');
    await vi.advanceTimersByTimeAsync(500);
    expect(ai.arrived()).toBe(true);
    useGameStore.getState().leaveGame();
    ai.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(stones(useGameStore)).toBe(0);

    useGameStore.setState({ _game: new (await import('../../engine/Game')).Game(6.5, 9), phase: 'playing' });
    ai = holdNext(server, '/ai-move');
    void useGameStore.getState().requestBotVsBotMove();
    await vi.advanceTimersByTimeAsync(0);
    useGameStore.getState().leaveGame();
    server.s.moves = 0; // the server is not ahead: nothing to show instead
    ai.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(useGameStore.getState().botTrouble).toBeNull();
  });

  it('an answer it cannot read: the card, not a stop', async () => {
    const { server, useGameStore } = await bvb();
    server.fetchMock.mockResolvedValueOnce(json({}) as never);
    await vi.advanceTimersByTimeAsync(500);
    expect(useGameStore.getState().botTrouble).toBe('move');
    expect(useGameStore.getState().aiThinking).toBe(false);
  });
});

/** One request held until the test answers it: resolve with the server's
 *  own answer, or fail as an aborted request does (no retry). */
function holdNext(server: ReturnType<typeof installServer>, path: string) {
  let settle: (ok: boolean) => void = () => {};
  let arrived = false;
  const impl = server.fetchMock.getMockImplementation()!;
  server.fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith(path)) return impl(url, init);
    server.fetchMock.mockImplementation(impl);
    arrived = true;
    const ok = await new Promise<boolean>((r) => (settle = r));
    if (!ok) throw new DOMException('aborted', 'AbortError');
    return impl(url, init);
  });
  return { answer: () => settle(true), fail: () => settle(false), arrived: () => arrived };
}

describe('leaving, or a new game, while a bot is still at work', () => {
  it("a player's move in flight when the player leaves: its failure raises no card", async () => {
    const { server, useGameStore } = await serverGame();
    const move = holdNext(server, '/move');
    useGameStore.getState().playMove({ row: 4, col: 4 });
    expect(useGameStore.getState().aiThinking).toBe(true);
    useGameStore.getState().leaveGame();
    expect(useGameStore.getState().aiThinking).toBe(false);
    move.fail();
    await new Promise((r) => setTimeout(r, 50));
    expect(useGameStore.getState().botTrouble).toBeNull();
  });

  it('a pass in flight when the player leaves: its failure raises no card', async () => {
    const { server, useGameStore } = await serverGame();
    const pass = holdNext(server, '/pass');
    useGameStore.getState().pass();
    useGameStore.getState().leaveGame();
    pass.fail();
    await new Promise((r) => setTimeout(r, 50));
    expect(useGameStore.getState().botTrouble).toBeNull();
  });

  it("the bot's move for a game the player left is dropped, and a game left asks the bot nothing more", async () => {
    const { server, useGameStore, useAutoPlayStore } = await serverGame();
    useGameStore.getState().playMove({ row: 4, col: 4 });
    await vi.waitFor(() => expect(server.s.moves).toBe(1));
    const ai = holdNext(server, '/ai-move');
    await vi.waitFor(() => expect(ai.arrived()).toBe(true));
    useGameStore.getState().leaveGame();
    ai.answer();
    await new Promise((r) => setTimeout(r, 50));
    expect(stones(useGameStore)).toBe(1);
    expect(useGameStore.getState().aiThinking).toBe(false);
    expect(useAutoPlayStore.getState().history).toEqual([]);

    // a game left asks the bot nothing more
    server.log.length = 0;
    await useGameStore.getState().requestAIMove();
    expect(server.log).toEqual([]);
  });

  it("a bot move that fails after the player left raises no card and starts no recovery", async () => {
    const { server, useGameStore } = await serverGame();
    useGameStore.getState().playMove({ row: 4, col: 4 });
    const ai = holdNext(server, '/ai-move');
    await vi.waitFor(() => expect(ai.arrived()).toBe(true));
    useGameStore.getState().leaveGame();
    server.log.length = 0;
    ai.fail();
    await new Promise((r) => setTimeout(r, 50));
    expect(useGameStore.getState().botTrouble).toBeNull();
    expect(server.log).toEqual([]);
  });

  it("an answer for the game a new one replaced does not touch the new one", async () => {
    const { server, useGameStore } = await serverGame();
    useGameStore.getState().playMove({ row: 4, col: 4 });
    const ai = holdNext(server, '/ai-move');
    await vi.waitFor(() => expect(ai.arrived()).toBe(true));
    await useGameStore.getState().newGame({ gameMode: 'local', boardSize: 9 });
    ai.answer();
    await new Promise((r) => setTimeout(r, 50));
    expect(stones(useGameStore)).toBe(0);
    expect(useGameStore.getState().gameMode).toBe('local');
  });

  it("a failed bot move for a game a new one replaced raises no card on the new one", async () => {
    const { server, useGameStore } = await serverGame();
    useGameStore.getState().playMove({ row: 4, col: 4 });
    const ai = holdNext(server, '/ai-move');
    await vi.waitFor(() => expect(ai.arrived()).toBe(true));
    await useGameStore.getState().newGame({ gameMode: 'local', boardSize: 9 });
    ai.fail();
    await new Promise((r) => setTimeout(r, 50));
    expect(useGameStore.getState().botTrouble).toBeNull();
    expect(server.log.filter((l) => l.startsWith('GET'))).toEqual([]); // no recovery for it either
  });
});

describe('Finish Game follows where the game lives', () => {
  it('a device game keeps it after "Bot plays online" is turned on; a server game never gets it', async () => {
    installWindow(FAST);
    installServer();
    const { caps, client, useGameStore, useSettingsStore } = await boot({ cloudBot: false });
    await caps.whenBotRoutingKnown();
    const onDevice = (await client.api.createGame({ board_size: 9 })).game_id;
    useSettingsStore.getState().setCloudBot(true);
    const onServer = (await client.api.createGame({ board_size: 9 })).game_id;
    expect(onServer).toBe('srv00001');
    expect(client.gameLivesOnDevice(onDevice)).toBe(true);
    expect(client.gameLivesOnDevice(onServer)).toBe(false);
    useSettingsStore.getState().setCloudBot(false);
    expect(client.gameLivesOnDevice(onServer)).toBe(false);
    expect(client.gameLivesOnDevice(onDevice)).toBe(true);
    expect(client.gameLivesOnDevice(null)).toBe(false);
    expect(useGameStore.getState().gameId).toBeNull();
  });

  it('on the web no game lives on the device', async () => {
    installWindow();
    installServer();
    const { client } = await boot();
    expect(client.gameLivesOnDevice('srv00001')).toBe(false);
  });
});

describe('the card', () => {
  it('says what happened and offers Try again and Leave', async () => {
    const { BotTroubleView } = await import('../../components/BotTroubleCard');
    const html = renderToStaticMarkup(createElement(BotTroubleView, { onRetry: () => {}, onLeave: () => {} }));
    expect(html).toContain('The bot isn&#x27;t answering');
    expect(html).toContain('You can try again, or leave. Leaving won&#x27;t count as a loss.');
    expect(button(html, 'Try again').disabled).toBe(false);
    expect(button(html, 'Leave').disabled).toBe(false);
  });
});
