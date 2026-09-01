import { describe, it, expect, vi, beforeEach } from 'vitest';

// Project-wide vitest env is 'node' (no jsdom) — shim the minimal Web
// Storage surface the store graph touches, matching autoPlayStore's test.
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
import { Game } from '../../engine/Game';
import { Color } from '../../engine/types';
import { api } from '../../api/client';
import { clearSelectorLog, snapshotSelectorLog } from '../../ai/selectorLog';

/**
 * Timeout-recovery ladder tests (2026-09-01). A failed ai-move leaves the
 * client in one of three worlds — server completed the move (resync, never
 * retry), server never got it (one silent retry), or the link is down
 * (surface tap-to-retry). Before the ladder, the catch was console.warn +
 * aiThinking:false — a silently stuck game.
 */

function emptyGrid(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

/** A 9x9 AI game, player Black, one Black move played, bot (White) to move. */
function setupGame(): Game {
  const game = new Game(5.5, 9);
  game.playMove({ row: 0, col: 1 }); // player Black
  useGameStore.setState({
    _game: game,
    gameId: 'test-game',
    phase: 'playing',
    playerColor: Color.Black,
    targetRank: '6k',
    lessonContext: false,
    autoplayContext: false,
    aiThinking: false,
    scoreHistory: [],
    desyncReported: false,
    botJustPassed: false,
    botStuck: false,
  });
  return game;
}

function serverStateDTO(game: Game, overrides: Record<string, unknown> = {}) {
  return {
    game_id: 'test-game',
    board: emptyGrid(9),
    board_size: 9,
    komi: 5.5,
    current_color: 'black',
    move_number: game.moveHistory.length,
    captures: { black: 0, white: 0 },
    phase: 'playing',
    last_move: null,
    ko_point: null,
    result: null,
    sgf: null,
    score_lead: null,
    ...overrides,
  };
}

describe('gameStore — ai-move timeout recovery ladder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSelectorLog();
  });

  it('world (a): server completed the move — resyncs it, never retries', async () => {
    const game = setupGame();
    vi.mocked(api.getAIMove).mockRejectedValue(new Error('AbortError: timeout'));
    // Server is one move ahead: it committed W(4,4) after we gave up.
    const serverGrid = emptyGrid(9);
    serverGrid[0][1] = Color.Black;
    serverGrid[4][4] = Color.White;
    vi.mocked(api.getGame).mockResolvedValue(
      serverStateDTO(game, {
        move_number: game.moveHistory.length + 1,
        board: serverGrid,
        last_move: { row: 4, col: 4 },
      }) as never,
    );

    await useGameStore.getState().requestAIMove();

    // The lost move was recovered from state, not re-requested.
    expect(api.getAIMove).toHaveBeenCalledTimes(1);
    const last = game.moveHistory[game.moveHistory.length - 1];
    expect(last.point).toEqual({ row: 4, col: 4 });
    expect(last.color).toBe(Color.White);
    expect(useGameStore.getState().botStuck).toBe(false);
    expect(useGameStore.getState().aiThinking).toBe(false);
    expect(snapshotSelectorLog().join('\n')).toContain('server had committed');
  });

  it('world (a) pass variant: server committed a pass — mirrors it locally', async () => {
    const game = setupGame();
    vi.mocked(api.getAIMove).mockRejectedValue(new Error('AbortError: timeout'));
    vi.mocked(api.getGame).mockResolvedValue(
      serverStateDTO(game, {
        move_number: game.moveHistory.length + 1,
        last_move: null,
      }) as never,
    );

    await useGameStore.getState().requestAIMove();

    expect(api.getAIMove).toHaveBeenCalledTimes(1);
    expect(game.consecutivePasses).toBe(1);
    expect(useGameStore.getState().botJustPassed).toBe(true);
    expect(useGameStore.getState().botStuck).toBe(false);
  });

  it('world (b): server in sync — retries once silently, applies the retry', async () => {
    const game = setupGame();
    const serverGrid = emptyGrid(9);
    serverGrid[0][1] = Color.Black;
    serverGrid[4][4] = Color.White;
    vi.mocked(api.getAIMove)
      .mockRejectedValueOnce(new Error('AbortError: timeout'))
      .mockResolvedValueOnce({
        point: { row: 4, col: 4 },
        captures: [],
        score_lead: 2,
        board: serverGrid,
      } as never);
    vi.mocked(api.getGame).mockResolvedValue(serverStateDTO(game) as never);

    await useGameStore.getState().requestAIMove();

    expect(api.getAIMove).toHaveBeenCalledTimes(2);
    const last = game.moveHistory[game.moveHistory.length - 1];
    expect(last.point).toEqual({ row: 4, col: 4 });
    expect(useGameStore.getState().botStuck).toBe(false);
    expect(snapshotSelectorLog().join('\n')).toContain('retrying once');
  });

  it('world (b) then failure: retry also fails — surfaces botStuck', async () => {
    const game = setupGame();
    vi.mocked(api.getAIMove).mockRejectedValue(new Error('AbortError: timeout'));
    vi.mocked(api.getGame).mockResolvedValue(serverStateDTO(game) as never);

    await useGameStore.getState().requestAIMove();

    // Original + exactly one silent retry — never a storm.
    expect(api.getAIMove).toHaveBeenCalledTimes(2);
    expect(useGameStore.getState().botStuck).toBe(true);
    expect(useGameStore.getState().aiThinking).toBe(false);
    expect(snapshotSelectorLog().join('\n')).toContain('surfacing tap-to-retry');
  });

  it('world (c): state fetch fails too — surfaces immediately, no retry', async () => {
    setupGame();
    vi.mocked(api.getAIMove).mockRejectedValue(new Error('AbortError: timeout'));
    vi.mocked(api.getGame).mockRejectedValue(new Error('network down'));

    await useGameStore.getState().requestAIMove();

    expect(api.getAIMove).toHaveBeenCalledTimes(1); // no blind retry on a dead link
    expect(useGameStore.getState().botStuck).toBe(true);
    expect(snapshotSelectorLog().join('\n')).toContain('state fetch failed');
  });

  it('retryAIMove re-enters the ladder and recovers when the blip has passed', async () => {
    const game = setupGame();
    vi.mocked(api.getAIMove).mockRejectedValue(new Error('AbortError: timeout'));
    vi.mocked(api.getGame).mockResolvedValue(serverStateDTO(game) as never);
    await useGameStore.getState().requestAIMove();
    expect(useGameStore.getState().botStuck).toBe(true);

    // The blip clears; the kid taps.
    const serverGrid = emptyGrid(9);
    serverGrid[0][1] = Color.Black;
    serverGrid[4][4] = Color.White;
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: 2,
      board: serverGrid,
    } as never);

    useGameStore.getState().retryAIMove();
    // botStuck clears synchronously; the applied move is the async proof.
    await vi.waitFor(() => {
      const last = game.moveHistory[game.moveHistory.length - 1];
      expect(last.point).toEqual({ row: 4, col: 4 });
    });
    expect(useGameStore.getState().botStuck).toBe(false);
    expect(useGameStore.getState().aiThinking).toBe(false);
  });

  it('retryAIMove is single-flight while a request is in progress', async () => {
    setupGame();
    useGameStore.setState({ aiThinking: true, botStuck: true });

    useGameStore.getState().retryAIMove();

    expect(api.getAIMove).not.toHaveBeenCalled();
    expect(useGameStore.getState().botStuck).toBe(true); // untouched
  });
});
