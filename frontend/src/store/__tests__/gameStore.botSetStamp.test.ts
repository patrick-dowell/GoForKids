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
import { useCapabilitiesStore } from '../capabilitiesStore';
import { snapshotSelectorLog } from '../../ai/selectorLog';
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
    expect(await start({ rank: '9k' })).toContain(' set=standard rr=0.08');
    useSettingsStore.getState().setCloudBot(true);
    expect(await start()).toContain(`bridge=no${standard}`);
  });
});

describe('a bot move tells the bridge path how many handicap stones lead the move list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createGame).mockResolvedValue({ game_id: 'abcd1234' } as never);
    vi.mocked(api.getAIMove).mockResolvedValue({ point: { row: -1, col: -1 }, captures: [] } as never);
  });

  it('passes the game handicap beside the move list', async () => {
    await useGameStore.getState().newGame({
      boardSize: 9,
      targetRank: '15k',
      useBackend: true,
      gameMode: 'ai',
      playerColor: Color.Black,
      handicap: 2,
    });
    await useGameStore.getState().requestAIMove();
    const [, rank, opts] = vi.mocked(api.getAIMove).mock.calls[0];
    expect(rank).toBe('15k');
    expect(opts?.handicap).toBe(2);
    // the two stones head the list as Black moves
    expect(opts?.movesForBridge?.slice(0, 2).every((m) => m.color === 'B')).toBe(true);
    expect(opts?.movesForBridge).toHaveLength(2);
  });
});
