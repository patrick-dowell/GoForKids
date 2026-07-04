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
 * Regression tests for the 888P9NXK silent-pass bug (2026-07-03): when the
 * game server had committed a bot move but the local engine rejected it,
 * requestAIMove fell through to the "AI passed" block — an unlogged pass
 * that also desynced the boards further. The fix force-resyncs from the
 * server board instead, and logs everything.
 */

function emptyGrid(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

/** A 9x9 AI game, player Black, bot (White) to move, with a phantom local
 *  White stone at (4,4) the "server" never saw — a live desync. */
function setupDesyncedGame(): Game {
  const game = new Game(5.5, 9);
  game.playMove({ row: 0, col: 1 }); // player Black
  game.board.grid[4 * 9 + 4] = Color.White; // phantom stone = the desync
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
  });
  return game;
}

describe('gameStore — bot-move desync recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSelectorLog();
  });

  it('force-syncs a locally-rejected server move instead of passing', async () => {
    const game = setupDesyncedGame();
    // Server's board after its move: B(0,1) + the bot's W(4,4). Locally
    // (4,4) is occupied by the phantom stone, so playMove returns Occupied.
    const serverGrid = emptyGrid(9);
    serverGrid[0][1] = Color.Black;
    serverGrid[4][4] = Color.White;
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: 2,
      board: serverGrid,
    });

    await useGameStore.getState().requestAIMove();

    // The move was applied, not mutated into a pass.
    const last = game.moveHistory[game.moveHistory.length - 1];
    expect(last.point).toEqual({ row: 4, col: 4 });
    expect(last.color).toBe(Color.White);
    expect(game.consecutivePasses).toBe(0);
    expect(api.pass).not.toHaveBeenCalled();
    expect(useGameStore.getState().botJustPassed).toBe(false);

    // The local board now matches the server exactly.
    expect(game.board.get({ row: 4, col: 4 })).toBe(Color.White);
    expect(game.currentColor).toBe(Color.Black);

    // And the incident is visible in the selector log.
    const log = snapshotSelectorLog().join('\n');
    expect(log).toContain('LOCAL-REJECT');
  });

  it('falls back to api.getGame for the server board when the DTO lacks one', async () => {
    const game = setupDesyncedGame();
    const serverGrid = emptyGrid(9);
    serverGrid[0][1] = Color.Black;
    serverGrid[4][4] = Color.White;
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: 2,
      // no `board` — the HTTP AIMoveResponse doesn't carry it
    });
    vi.mocked(api.getGame).mockResolvedValue({
      board: serverGrid,
      board_size: 9,
    } as never);

    await useGameStore.getState().requestAIMove();

    expect(api.getGame).toHaveBeenCalledWith('test-game');
    expect(api.pass).not.toHaveBeenCalled();
    expect(game.board.get({ row: 4, col: 4 })).toBe(Color.White);
    expect(game.moveHistory[game.moveHistory.length - 1].point).toEqual({ row: 4, col: 4 });
  });

  it('syncs a single-move undo to the server (the handicap seed hole)', async () => {
    // Handicap shape: bot (White) moved first, history length 1. The old
    // code fell into the local-only branch and never called api.undo —
    // an instant silent desync, the suspected 888P9NXK seed class.
    const game = new Game(5.5, 9);
    game.setHandicap([{ row: 6, col: 2 }, { row: 2, col: 6 }]);
    game.playMove({ row: 4, col: 4 }); // bot White's opening move
    expect(game.moveHistory).toHaveLength(1);
    useGameStore.setState({
      _game: game,
      gameId: 'test-game',
      phase: 'playing',
      playerColor: Color.Black,
      aiThinking: false,
      autoplayContext: false,
      scoreHistory: [],
      desyncReported: false,
    });
    // Server's post-undo board: just the handicap stones.
    const serverGrid = emptyGrid(9);
    serverGrid[6][2] = Color.Black;
    serverGrid[2][6] = Color.Black;
    vi.mocked(api.undo).mockResolvedValue({ board: serverGrid } as never);

    const didUndo = useGameStore.getState().undo();
    await new Promise((r) => setTimeout(r, 0));

    expect(didUndo).toBe(true);
    expect(game.moveHistory).toHaveLength(0);
    expect(api.undo).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().desyncReported).toBe(false);
  });

  it('double undo still issues two server undos and verifies the result', async () => {
    const game = new Game(5.5, 9);
    game.playMove({ row: 0, col: 1 }); // player B
    game.playMove({ row: 8, col: 8 }); // bot W
    useGameStore.setState({
      _game: game,
      gameId: 'test-game',
      phase: 'playing',
      playerColor: Color.Black,
      aiThinking: false,
      autoplayContext: false,
      scoreHistory: [],
      desyncReported: false,
    });
    vi.mocked(api.undo).mockResolvedValue({ board: emptyGrid(9) } as never);

    useGameStore.getState().undo();
    await new Promise((r) => setTimeout(r, 0));

    expect(game.moveHistory).toHaveLength(0);
    expect(api.undo).toHaveBeenCalledTimes(2);
    expect(useGameStore.getState().desyncReported).toBe(false);
  });

  it('logs undo sync failures to the selector log', async () => {
    const game = new Game(5.5, 9);
    game.playMove({ row: 0, col: 1 });
    game.playMove({ row: 8, col: 8 });
    useGameStore.setState({
      _game: game,
      gameId: 'test-game',
      phase: 'playing',
      playerColor: Color.Black,
      aiThinking: false,
      autoplayContext: false,
      scoreHistory: [],
      desyncReported: false,
    });
    vi.mocked(api.undo).mockRejectedValue(new Error('boom'));

    useGameStore.getState().undo();
    await new Promise((r) => setTimeout(r, 0));

    expect(snapshotSelectorLog().join('\n')).toContain('undo server-sync FAILED');
  });

  it('logs a desync once when a synced move reveals mismatched boards', async () => {
    const game = new Game(5.5, 9);
    game.playMove({ row: 0, col: 1 }); // player Black; White to move
    useGameStore.setState({
      _game: game,
      gameId: 'test-game',
      phase: 'playing',
      playerColor: Color.Black,
      targetRank: '6k',
      lessonContext: false,
      aiThinking: false,
      scoreHistory: [],
      desyncReported: false,
    });
    // Bot move (4,4) is legal locally, but the server board carries an
    // extra stone the local board doesn't have.
    const serverGrid = emptyGrid(9);
    serverGrid[0][1] = Color.Black;
    serverGrid[4][4] = Color.White;
    serverGrid[8][8] = Color.Black; // the divergence
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: 2,
      board: serverGrid,
    });

    await useGameStore.getState().requestAIMove();

    expect(snapshotSelectorLog().join('\n')).toContain('[desync]');
    expect(useGameStore.getState().desyncReported).toBe(true);
  });
});
