import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Project-wide vitest env is 'node' (no jsdom) — shim the minimal Web
// Storage surface the store graph touches, as gameStore.savedGameId.test.ts does.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

vi.mock('../../audio/SoundManager', () => ({
  playPlaceSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playPassSound: vi.fn(),
  playGameEndSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    createGame: vi.fn(),
    getGame: vi.fn(),
    playMove: vi.fn(),
    pass: vi.fn(),
    resign: vi.fn(),
    undo: vi.fn(),
    getAIMove: vi.fn(),
    finishMove: vi.fn(),
  },
  abortPendingRequests: vi.fn(),
}));

import { useGameStore } from '../gameStore';
import { useSettingsStore } from '../settingsStore';
import { _resetDeviceCapabilities, readDeviceCapabilities, useCapabilitiesStore } from '../capabilitiesStore';
import { clearSelectorLog, snapshotSelectorLog } from '../../ai/selectorLog';
import { Color } from '../../engine/types';
import { api } from '../../api/client';

/**
 * Every game's first log line stamps the bot's knobs; it also says which
 * profile set plays: `set=human` with the human rung's knobs ahead of the
 * b28.yaml knobs (its fallback), or `set=standard`.
 */
describe("the game log's start line names the bot's profile set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    (globalThis as { window?: unknown }).window = { kataGo: { ping: async () => ({ pong: true }) } };
    useCapabilitiesStore.setState({ capabilities: { localBots: true, evalsPerSecond: 40, humanModel: true } });
    useSettingsStore.getState().setCloudBot(false);
    useSettingsStore.getState().setHumanBots(true);
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    useCapabilitiesStore.setState({ capabilities: null });
    useSettingsStore.getState().setHumanBots(false);
  });

  const start = async (o: { rank?: string; size?: number; gameMode?: 'ai' | 'botvsbot'; lessonContext?: boolean } = {}) => {
    await useGameStore.getState().newGame({
      boardSize: o.size ?? 9,
      targetRank: o.rank ?? '15k',
      useBackend: true,
      gameMode: o.gameMode ?? 'ai',
      playerColor: Color.Black,
      lessonContext: o.lessonContext,
    });
    return snapshotSelectorLog().find((l) => l.includes('[game] start'))!;
  };

  it('the human set: its rung knobs, then the standard knobs it falls back to', async () => {
    const line = await start();
    expect(line).toContain(
      'bridge=yes set=human sl=rank_20k tilt=-8 from=12 cap=10 sv=4 margin=0.5 rr=0.05 temp=2.6 lapse=0.45 mf=0.75 v=16',
    );
  });

  it('the standard set otherwise', async () => {
    const standard = ' set=standard rr=0.05 temp=2.6 lapse=0.45 mf=0.75 v=16';
    useSettingsStore.getState().setHumanBots(false);
    expect(await start()).toContain(`bridge=yes${standard}`);
    useSettingsStore.getState().setHumanBots(true);
    useCapabilitiesStore.setState({ capabilities: { localBots: true, evalsPerSecond: 40, humanModel: false } });
    expect(await start()).toContain(`bridge=yes${standard}`);
    useCapabilitiesStore.setState({ capabilities: { localBots: true, evalsPerSecond: 40, humanModel: true } });
    expect(await start({ lessonContext: true })).toContain(`bridge=yes${standard}`);
    expect(await start({ gameMode: 'botvsbot' })).toContain(' set=standard');
    expect(await start({ rank: '3k' })).toContain(' set=standard rr=0.24');
  });
});

/**
 * The start line stamps the device rung's knobs only when the device picks
 * the moves. A game the server plays says so, and why: the web, a device
 * whose capabilities said localBots: false, or the stored setting. A
 * pass-and-play game has no bot moves at all.
 */
describe("the start line says who picks the moves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    _resetDeviceCapabilities();
    useSettingsStore.getState().setCloudBot(false);
    useSettingsStore.getState().setHumanBots(false);
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    _resetDeviceCapabilities();
    useSettingsStore.getState().setCloudBot(false);
  });

  const bridge = () => {
    (globalThis as { window?: unknown }).window = { kataGo: { ping: async () => ({ pong: true }) } };
  };
  const caps = (localBots: boolean) =>
    useCapabilitiesStore.setState({ capabilities: { localBots, evalsPerSecond: 40, humanModel: false } });
  const start = async (gameMode: 'ai' | 'local' = 'ai') => {
    await useGameStore.getState().newGame({
      boardSize: 9,
      targetRank: '15k',
      useBackend: gameMode !== 'local',
      gameMode,
      playerColor: Color.Black,
    });
    return snapshotSelectorLog().find((l) => l.includes('[game] start'))!;
  };
  const tail = (line: string) => line.slice(line.indexOf(' bridge='));

  it('the device picks them: the rung knobs, as before', async () => {
    bridge();
    caps(true);
    expect(tail(await start())).toBe(' bridge=yes set=standard rr=0.05 temp=2.6 lapse=0.45 mf=0.75 v=16');
  });

  it('the web: the server picks them, no device knobs', async () => {
    expect(tail(await start())).toBe(' bridge=no moves=server why=web');
  });

  it('a device whose engine is too slow: the server, and why', async () => {
    bridge();
    caps(false);
    expect(tail(await start())).toBe(' bridge=no moves=server why=device');
  });

  it('the stored setting on a device that may play its own: the server, and why', async () => {
    bridge();
    caps(true);
    useSettingsStore.getState().setCloudBot(true);
    expect(tail(await start())).toBe(' bridge=no moves=server why=setting');
  });

  it('a game started before the answer waits for it, then names the side that plays', async () => {
    let answer: (c: { localBots: boolean; evalsPerSecond: number; humanModel: boolean }) => void = () => {};
    (globalThis as { window?: unknown }).window = {
      kataGo: { ping: async () => ({ pong: true }), capabilities: () => new Promise((r) => (answer = r)) },
    };
    void readDeviceCapabilities();
    clearSelectorLog();
    const line = start();
    await new Promise((r) => setTimeout(r, 0));
    expect(snapshotSelectorLog().some((l) => l.includes('[game] start'))).toBe(false);
    expect(api.createGame).not.toHaveBeenCalled();
    answer({ localBots: false, evalsPerSecond: 3, humanModel: false });
    expect(tail(await line)).toBe(' bridge=no moves=server why=device');
  });

  it('pass-and-play: no bot moves to stamp', async () => {
    expect(tail(await start('local'))).toBe(' bridge=no moves=none');
    bridge();
    caps(true);
    expect(tail(await start('local'))).toBe(' bridge=yes moves=none');
  });
});

describe('a bot move tells the bridge path how many handicap stones lead the move list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    vi.mocked(api.getAIMove).mockResolvedValue({ point: { row: -1, col: -1 }, captures: [] } as never);
  });

  // A handicap of 1 places no stone (the server's _handicap_positions(9, 1)
  // is empty too): the count is of stones placed, not the handicap number.
  for (const [handicap, stones] of [[0, 0], [1, 0], [2, 2]]) {
    it(`handicap ${handicap}: ${stones} stones lead the list, and the count says ${stones}`, async () => {
      await useGameStore.getState().newGame({
        boardSize: 9,
        targetRank: '15k',
        useBackend: true,
        gameMode: 'ai',
        playerColor: Color.Black,
        handicap,
      });
      await useGameStore.getState().requestAIMove();
      const [, rank, opts] = vi.mocked(api.getAIMove).mock.calls[0];
      expect(rank).toBe('15k');
      expect(opts?.handicap).toBe(stones);
      expect(opts?.movesForBridge).toHaveLength(stones);
      expect(opts?.movesForBridge?.every((m) => m.color === 'B')).toBe(true);
    });
  }
});

describe('the game log follows the set a bot move actually plays from', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    vi.mocked(api.getAIMove).mockResolvedValue({ point: { row: -1, col: -1 }, captures: [] } as never);
    (globalThis as { window?: unknown }).window = { kataGo: { ping: async () => ({ pong: true }) } };
    useCapabilitiesStore.setState({ capabilities: null });
    useSettingsStore.getState().setCloudBot(false);
    useSettingsStore.getState().setHumanBots(true);
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    useCapabilitiesStore.setState({ capabilities: null });
    useSettingsStore.getState().setHumanBots(false);
  });

  it('a game started before the capabilities answered gets a line when its bot moves turn human', async () => {
    await useGameStore.getState().newGame({
      boardSize: 9,
      targetRank: '15k',
      useBackend: true,
      gameMode: 'ai',
      playerColor: Color.Black,
    });
    expect(snapshotSelectorLog().find((l) => l.includes('[game] start'))).toContain(' set=standard ');
    // the bridge answers after the start line
    useCapabilitiesStore.setState({ capabilities: { localBots: true, evalsPerSecond: 40, humanModel: true } });
    await useGameStore.getState().requestAIMove();
    await useGameStore.getState().requestAIMove();
    const changes = snapshotSelectorLog().filter((l) => l.includes('[game] set changed'));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('[game] set changed at move 1: set=human sl=rank_20k tilt=-8 from=12 cap=10 sv=4 margin=0.5');
  });

  it('no line while the moves play from the set the start line named', async () => {
    useCapabilitiesStore.setState({ capabilities: { localBots: true, evalsPerSecond: 40, humanModel: true } });
    await useGameStore.getState().newGame({
      boardSize: 9,
      targetRank: '15k',
      useBackend: true,
      gameMode: 'ai',
      playerColor: Color.Black,
    });
    await useGameStore.getState().requestAIMove();
    expect(snapshotSelectorLog().some((l) => l.includes('[game] set changed'))).toBe(false);
  });
});
