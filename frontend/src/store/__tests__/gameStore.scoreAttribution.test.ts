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
import { Color, type Stone } from '../../engine/types';
import { api } from '../../api/client';
import { buildReview } from '../../learn/gameReview';

/**
 * §4a attribution fix (DEVJOURNAL S45): on-device, the only KataGo analysis
 * per turn roots at the position AFTER the player's move — its root eval
 * describes the player's move, not the bot's reply. It used to be recorded
 * at the bot's move number, so Play-of-the-Game credited every player
 * blunder to the bot ("The bot found a strong move here"). The AI-move DTO
 * now carries both reads (`score_lead_before` = root, `score_lead` = chosen
 * candidate) and gameStore merges them one move apart.
 */

/** A 9x9 AI game, player Black who just played move 1; bot (White) to move. */
function setupGame(scoreHistory: Array<{ move: number; lead: number }>): Game {
  const game = new Game(5.5, 9);
  game.playMove({ row: 0, col: 1 }); // player Black, move 1
  useGameStore.setState({
    _game: game,
    gameId: 'test-game',
    phase: 'playing',
    playerColor: Color.Black,
    targetRank: '6k',
    lessonContext: false,
    autoplayContext: false,
    aiThinking: false,
    scoreHistory,
    desyncReported: false,
    botJustPassed: false,
  });
  return game;
}

describe('score attribution (two points per analysis)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the root eval on the PLAYER move and the chosen-move eval on the bot move', async () => {
    setupGame([{ move: 0, lead: 0 }]);
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: -7.5, // after the bot's actual move
      score_lead_before: -8, // root eval = after the player's move 1
    });

    await useGameStore.getState().requestAIMove();

    expect(useGameStore.getState().scoreHistory).toEqual([
      { move: 0, lead: 0 },
      { move: 1, lead: -8 },
      { move: 2, lead: -7.5 },
    ]);
  });

  it('replaces a stale carried entry for the player move (pass-path carry)', async () => {
    // Player pass paths append a carried lead at the player's move number;
    // the fresh root eval must replace it, not duplicate it.
    setupGame([
      { move: 0, lead: 0 },
      { move: 1, lead: 0 }, // stale carry
    ]);
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: -7.5,
      score_lead_before: -8,
    });

    await useGameStore.getState().requestAIMove();

    expect(useGameStore.getState().scoreHistory).toEqual([
      { move: 0, lead: 0 },
      { move: 1, lead: -8 },
      { move: 2, lead: -7.5 },
    ]);
  });

  it('keeps the old single-entry behavior for HTTP responses (no score_lead_before)', async () => {
    setupGame([{ move: 0, lead: 0 }]);
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: 4, col: 4 },
      captures: [],
      score_lead: -7.5,
    });

    await useGameStore.getState().requestAIMove();

    expect(useGameStore.getState().scoreHistory).toEqual([
      { move: 0, lead: 0 },
      { move: 2, lead: -7.5 },
    ]);
  });

  it('attributes both points when the bot passes', async () => {
    setupGame([{ move: 0, lead: 0 }]);
    vi.mocked(api.getAIMove).mockResolvedValue({
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: -3, // carried root eval (pass leaves the board unchanged)
      score_lead_before: -3.2,
    });

    await useGameStore.getState().requestAIMove();

    expect(useGameStore.getState().scoreHistory).toEqual([
      { move: 0, lead: 0 },
      { move: 1, lead: -3.2 },
      { move: 2, lead: -3 },
    ]);
  });

  it('undo trims the history by move number, not array index', () => {
    // Bridge-style sparse history: only the bot's move has an entry beyond
    // the seed. Index-based slice(0, len+1) used to keep the move-2 entry
    // after undoing to move 1.
    const game = new Game(5.5, 9);
    game.playMove({ row: 0, col: 1 }); // Black, move 1
    game.playMove({ row: 4, col: 4 }); // White, move 2
    useGameStore.setState({
      _game: game,
      gameId: null, // local game → single-undo branch, no server sync
      phase: 'playing',
      playerColor: Color.Black,
      lessonContext: false,
      autoplayContext: false,
      aiThinking: false,
      undosThisGame: 0,
      scoreHistory: [
        { move: 0, lead: 0 },
        { move: 2, lead: -7.5 },
      ],
    });

    const didUndo = useGameStore.getState().undo();

    expect(didUndo).toBe(true);
    expect(useGameStore.getState()._game.moveHistory.length).toBe(1);
    expect(useGameStore.getState().scoreHistory).toEqual([{ move: 0, lead: 0 }]);
  });
});

describe('buildReview attribution with per-move history', () => {
  it('pins a player blunder on the player move with the backfired headline', () => {
    // B(0,0), W(2,2), B(1,1) = the blunder, W(3,3). With the fixed history
    // the -9 swing lands on move 3 (the player's move) — before the fix it
    // arrived one move late and read "The bot found a strong move here."
    const mk = (color: Stone, row: number, col: number, n: number) => ({
      color,
      point: { row, col },
      captures: [],
      moveNumber: n,
    });
    const moves = [
      mk(Color.Black, 0, 0, 1),
      mk(Color.White, 2, 2, 2),
      mk(Color.Black, 1, 1, 3),
      mk(Color.White, 3, 3, 4),
    ];
    const history = [
      { move: 0, lead: 0 },
      { move: 1, lead: 0 },
      { move: 2, lead: 0 },
      { move: 3, lead: -9 }, // the blunder's eval, ON the blunder
      { move: 4, lead: -9 },
    ];

    const highlights = buildReview(moves, history, Color.Black, 9);

    expect(highlights).toHaveLength(1);
    expect(highlights[0].moveNumber).toBe(3);
    expect(highlights[0].kind).toBe('learn');
    expect(highlights[0].headline).toContain('This move backfired');
  });
});
