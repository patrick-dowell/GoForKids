import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Project-wide vitest env is 'node' — the store schedules autoplay ticks via
// window.setTimeout, so alias window to globalThis.
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
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
    scorePosition: vi.fn().mockRejectedValue(new Error('offline')),
  },
}));

// Mock ONLY the bridge handle; the GTP coordinate codecs stay real.
const mockAnalyze = vi.fn();
let bridgePresent = true;
vi.mock('../../api/nativeKataGo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/nativeKataGo')>();
  return {
    ...actual,
    getKataGoBridge: () => (bridgePresent ? { analyze: mockAnalyze } : null),
  };
});

import { useReplayStore } from '../replayStore';
import { Game } from '../../engine/Game';
import { toGtp } from '../../api/nativeKataGo';

/**
 * "The good line" (S47): landing the replay cursor on a 'learn' highlight
 * that was the PLAYER's move asks on-device KataGo for the best move in the
 * position BEFORE the mistake, and pulses it on the board. Web (no bridge)
 * shows nothing; results are cached per move.
 */

/** A 9×9 game where the player (Black) blunders at move 3: B a1, W e5,
 *  B b1 (the "mistake"), W e4 — with a scoreHistory whose -9 swing lands
 *  on move 3, producing exactly one 'learn' highlight there. */
function loadMistakeGame() {
  const g = new Game(5.5, 9);
  g.playMove({ row: 8, col: 0 }); // B move 1
  g.playMove({ row: 4, col: 4 }); // W move 2
  g.playMove({ row: 8, col: 1 }); // B move 3 — the blunder
  g.playMove({ row: 5, col: 4 }); // W move 4
  useReplayStore.getState().loadGame(g.toSGF(), {
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

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('replayStore better-move hint', () => {
  beforeEach(() => {
    bridgePresent = true;
    mockAnalyze.mockReset();
    mockAnalyze.mockResolvedValue({
      rootVisits: 100,
      candidates: [
        { move: toGtp({ row: 2, col: 2 }, 9), visits: 60, winrate: 0.6, scoreLead: 3, prior: 0.4, order: 0 },
        { move: toGtp({ row: 3, col: 3 }, 9), visits: 20, winrate: 0.5, scoreLead: 1, prior: 0.2, order: 1 },
      ],
    });
    loadMistakeGame();
  });

  afterEach(() => {
    useReplayStore.getState().close();
  });

  it('analyzes the position BEFORE the mistake and stars the top candidate', async () => {
    expect(useReplayStore.getState().highlights.some((h) => h.moveNumber === 3 && h.kind === 'learn')).toBe(true);

    useReplayStore.getState().goToMove(3);
    await flush();

    expect(useReplayStore.getState().betterMove).toEqual({ row: 2, col: 2 });
    // The analysis must root at the position before move 3: two moves only.
    const params = mockAnalyze.mock.calls[0][0];
    expect(params.moves).toHaveLength(2);
    expect(params.color).toBe('B'); // the player was to move
  });

  it('clears the star when the cursor leaves the key move, restores from cache on return', async () => {
    useReplayStore.getState().goToMove(3);
    await flush();
    expect(useReplayStore.getState().betterMove).not.toBeNull();

    useReplayStore.getState().goToMove(4);
    expect(useReplayStore.getState().betterMove).toBeNull();

    useReplayStore.getState().goToMove(3);
    await flush();
    expect(useReplayStore.getState().betterMove).toEqual({ row: 2, col: 2 });
    expect(mockAnalyze).toHaveBeenCalledTimes(1); // cache hit, no re-analysis
  });

  it('shows nothing on the web (no bridge)', async () => {
    bridgePresent = false;
    useReplayStore.getState().goToMove(3);
    await flush();
    expect(useReplayStore.getState().betterMove).toBeNull();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('hides the star when KataGo agrees with the played move', async () => {
    mockAnalyze.mockResolvedValue({
      rootVisits: 100,
      candidates: [
        { move: toGtp({ row: 8, col: 1 }, 9), visits: 60, winrate: 0.6, scoreLead: 3, prior: 0.4, order: 0 },
      ],
    });
    useReplayStore.getState().goToMove(3);
    await flush();
    expect(useReplayStore.getState().betterMove).toBeNull();
  });

  it('does not analyze bot-move learn highlights', async () => {
    // Same game, but the player is WHITE — the move-3 'learn' swing now
    // belongs to the opponent (Black), so there is no "you should have
    // played" to show.
    useReplayStore.getState().close();
    const g = new Game(5.5, 9);
    g.playMove({ row: 8, col: 0 });
    g.playMove({ row: 4, col: 4 });
    g.playMove({ row: 8, col: 1 });
    g.playMove({ row: 5, col: 4 });
    useReplayStore.getState().loadGame(g.toSGF(), {
      playerColor: 'white',
      scoreHistory: [
        { move: 0, lead: 0 },
        { move: 1, lead: 0 },
        { move: 2, lead: 0 },
        { move: 3, lead: 9 }, // +9 for Black = against the White player
        { move: 4, lead: 9 },
      ],
    });
    useReplayStore.getState().goToMove(3);
    await flush();
    expect(useReplayStore.getState().betterMove).toBeNull();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });
});
