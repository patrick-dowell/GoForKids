/**
 * The capabilities answer in the game log (selectorLog, the log a shared
 * game carries): the probe's evals a second and how long after the app
 * started the answer came. Written when the answer comes, and again under
 * each game's start line, since a game start clears the log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/SoundManager', () => ({
  playPlaceSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playPassSound: vi.fn(),
  playGameEndSound: vi.fn(),
  playTwoEyesSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    createGame: vi.fn(async () => ({ game_id: 'abcd1234' })),
    getGame: vi.fn(),
    playMove: vi.fn(() => new Promise(() => {})),
    pass: vi.fn(),
    resign: vi.fn(),
    undo: vi.fn(),
    getAIMove: vi.fn(),
    finishMove: vi.fn(),
  },
  abortPendingRequests: vi.fn(),
  gameLivesOnDevice: () => false,
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

/** A fake bridge; capabilities() answers when the test calls answer(). */
function installBridge(withCall = true) {
  let answer: (c: Caps) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const bridge: Record<string, unknown> = { ping: async () => ({ pong: true }) };
  if (withCall) {
    bridge.capabilities = () =>
      new Promise<Caps>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      });
  }
  (globalThis as { window?: unknown }).window = { kataGo: bridge, setTimeout, clearTimeout };
  return { answer: (c: Caps) => answer(c), fail: (e: Error) => fail(e) };
}

/** The page's clock (ms since the app started), as the test sets it. */
let now = 0;
const flush = () => new Promise((r) => setTimeout(r, 0));

async function load() {
  const caps = await import('../capabilitiesStore');
  const log = await import('../../ai/selectorLog');
  const { useGameStore } = await import('../gameStore');
  const { Color } = await import('../../engine/types');
  const lines = () => log.snapshotSelectorLog().map((l) => l.replace(/^\S+ /, ''));
  const startGame = () =>
    useGameStore.getState().newGame({ boardSize: 9, targetRank: '15k', useBackend: true, gameMode: 'ai', playerColor: Color.Black });
  return { caps, log, lines, startGame };
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ANSWER = '[capabilities] evalsPerSecond=63.5 localBots=true humanModel=true answered=31240ms after app start (asked at 412ms)';

describe('the capabilities answer in the game log', () => {
  it('the answer writes the probe reading and the time since the app started', async () => {
    const b = installBridge();
    const { caps, lines } = await load();
    now = 412;
    const read = caps.readDeviceCapabilities();
    now = 31240;
    b.answer({ localBots: true, evalsPerSecond: 63.5, humanModel: true });
    await read;
    expect(lines()).toEqual([ANSWER]);
  });

  it('every game started later carries it under its start line', async () => {
    const b = installBridge();
    const { caps, lines, startGame } = await load();
    now = 412;
    const read = caps.readDeviceCapabilities();
    now = 31240;
    b.answer({ localBots: true, evalsPerSecond: 63.5, humanModel: true });
    await read;
    for (let i = 0; i < 2; i++) {
      await startGame();
      expect(lines()[0]).toMatch(/^\[game\] start /);
      expect(lines()[1]).toBe(ANSWER);
    }
  });

  it('a game started before the answer says so, and the late answer lands in that game', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = installBridge();
    const { caps, lines, startGame } = await load();
    now = 412;
    void caps.readDeviceCapabilities();
    const started = startGame();
    await vi.advanceTimersByTimeAsync(caps.BOT_ROUTING_WAIT_MS);
    await started;
    expect(lines()[1]).toBe('[capabilities] no answer yet (asked at 412ms)');
    now = 31240;
    b.answer({ localBots: true, evalsPerSecond: 63.5, humanModel: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toContain(ANSWER);
  });

  it('a failed call is logged with when it failed', async () => {
    const b = installBridge();
    const { caps, lines } = await load();
    now = 412;
    const read = caps.readDeviceCapabilities();
    now = 5000;
    b.fail(new Error('probe failed'));
    await read;
    expect(lines()).toEqual(['[capabilities] failed at 5000ms after app start (asked at 412ms): probe failed']);
  });

  it("a bridge without the call: one line saying so", async () => {
    installBridge(false);
    const { caps, lines, startGame } = await load();
    await caps.readDeviceCapabilities();
    await startGame();
    expect(lines()[1]).toBe('[capabilities] none: this build has no capabilities()');
  });

  it('the web: no line', async () => {
    const { caps, lines, startGame } = await load();
    await caps.readDeviceCapabilities();
    expect(lines()).toEqual([]);
    await startGame();
    await flush();
    expect(lines().some((l) => l.startsWith('[capabilities]'))).toBe(false);
  });
});
