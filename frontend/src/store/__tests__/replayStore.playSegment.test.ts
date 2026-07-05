import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Project-wide vitest env is 'node' — the store schedules autoplay ticks via
// window.setTimeout, so alias window to globalThis (fake timers patch both).
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
    // Final-move settle path — reject so the heuristic territory stands.
    scorePosition: vi.fn().mockRejectedValue(new Error('offline')),
  },
}));

import { useReplayStore } from '../replayStore';
import { demoReplay } from '../../learn/gameReview';

/**
 * §4a quick replay: tapping a highlight card seeks a few moves before the
 * moment and autoplays INTO it, stopping on the key move (where the note and
 * the graph dot are). playSegment carries that; a manual ▶ afterwards must
 * still play to the end (the stop target is segment-scoped).
 */
describe('replayStore.playSegment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const d = demoReplay();
    useReplayStore.getState().loadGame(d.sgf, {
      playerColor: d.playerColor,
      scoreHistory: d.scoreHistory,
      returnToReview: 'game',
    });
  });

  afterEach(() => {
    useReplayStore.getState().close();
    vi.useRealTimers();
  });

  it('seeks to the segment start and stops on the target move', () => {
    useReplayStore.getState().playSegment(5, 8);
    expect(useReplayStore.getState().currentMove).toBe(5);
    expect(useReplayStore.getState().autoPlaying).toBe(true);

    vi.advanceTimersByTime(600 * 5);

    const s = useReplayStore.getState();
    expect(s.currentMove).toBe(8); // stopped ON the key move, not past it
    expect(s.autoPlaying).toBe(false);
    expect(s._autoPlayStopAt).toBeNull();
  });

  it('clamps a negative segment start to move 0', () => {
    useReplayStore.getState().playSegment(-2, 2);
    expect(useReplayStore.getState().currentMove).toBe(0);
    vi.advanceTimersByTime(600 * 3);
    expect(useReplayStore.getState().currentMove).toBe(2);
  });

  it('manual autoplay after a segment plays to the end (stop target cleared)', () => {
    useReplayStore.getState().playSegment(2, 5);
    vi.advanceTimersByTime(600 * 4);
    expect(useReplayStore.getState().currentMove).toBe(5);

    useReplayStore.getState().toggleAutoPlay();
    vi.advanceTimersByTime(600 * 10);
    expect(useReplayStore.getState().currentMove).toBe(useReplayStore.getState().totalMoves);
  });

  it('carries returnToReview from loadGame and clears it on close', () => {
    expect(useReplayStore.getState().returnToReview).toBe('game');
    useReplayStore.getState().close();
    expect(useReplayStore.getState().returnToReview).toBeNull();
  });
});
