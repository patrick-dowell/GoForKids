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
  api: { scorePosition: vi.fn().mockRejectedValue(new Error('offline')) },
}));

import { useReplayStore } from '../replayStore';

/**
 * Feature 32, revision 8: a friend's game opens playing from the first move
 * at the viewer's playback speed, and carries where its Close goes (back to
 * Friends, with the card that was open). A Library replay opens paused and
 * carries no target, so Close goes home as before; the target never outlives
 * the replay.
 */
const SGF = '(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]RE[B+5.5];B[ee];W[cc];B[gc];W[])';
const FRIENDS = { page: 'friends' as const, cardFor: 'p-friend' };

describe("replayStore — a friend's game", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useReplayStore.setState({ autoPlaySpeed: 600 });
  });

  afterEach(() => {
    useReplayStore.getState().close();
    vi.useRealTimers();
  });

  it('a Library replay opens paused on the first move, with no return target', () => {
    useReplayStore.getState().loadGame(SGF, { playerColor: 'black', libraryId: 'g1' });
    const s = useReplayStore.getState();
    expect(s.active).toBe(true);
    expect(s.autoPlaying).toBe(false);
    expect(s.currentMove).toBe(0);
    expect(s.returnTo).toBeNull();
    vi.advanceTimersByTime(600 * 3);
    expect(useReplayStore.getState().currentMove).toBe(0);
  });

  it('autoPlay: plays from the first move at the playback speed, and ⏸ pauses it', () => {
    useReplayStore.getState().loadGame(SGF, { playerColor: 'black', autoPlay: true, returnTo: FRIENDS });
    expect(useReplayStore.getState().autoPlaying).toBe(true);
    expect(useReplayStore.getState().currentMove).toBe(0);
    vi.advanceTimersByTime(599);
    expect(useReplayStore.getState().currentMove).toBe(0);
    vi.advanceTimersByTime(1);
    expect(useReplayStore.getState().currentMove).toBe(1);
    vi.advanceTimersByTime(600);
    expect(useReplayStore.getState().currentMove).toBe(2);
    useReplayStore.getState().toggleAutoPlay(); // the usual control
    vi.advanceTimersByTime(600 * 3);
    expect(useReplayStore.getState().autoPlaying).toBe(false);
    expect(useReplayStore.getState().currentMove).toBe(2);
  });

  it('autoPlay keeps the speed the viewer is set to', () => {
    useReplayStore.getState().setAutoPlaySpeed(1200);
    useReplayStore.getState().loadGame(SGF, { autoPlay: true, returnTo: FRIENDS });
    vi.advanceTimersByTime(600);
    expect(useReplayStore.getState().currentMove).toBe(0);
    vi.advanceTimersByTime(600);
    expect(useReplayStore.getState().currentMove).toBe(1);
  });

  it('plays to the end and stops there', () => {
    useReplayStore.getState().loadGame(SGF, { autoPlay: true, returnTo: FRIENDS });
    vi.advanceTimersByTime(600 * 10);
    const s = useReplayStore.getState();
    expect(s.currentMove).toBe(s.totalMoves);
    expect(s.autoPlaying).toBe(false);
  });

  it('a game with no moves opens, not playing', () => {
    useReplayStore.getState().loadGame('(;GM[1]FF[4]CA[UTF-8]SZ[9]RU[Japanese])', { autoPlay: true, returnTo: FRIENDS });
    expect(useReplayStore.getState().active).toBe(true);
    expect(useReplayStore.getState().autoPlaying).toBe(false);
  });

  it('the return target is carried by the replay, and goes with it', () => {
    useReplayStore.getState().loadGame(SGF, { autoPlay: true, returnTo: FRIENDS });
    expect(useReplayStore.getState().returnTo).toEqual(FRIENDS);
    useReplayStore.getState().close();
    expect(useReplayStore.getState().returnTo).toBeNull();
    expect(useReplayStore.getState().autoPlaying).toBe(false);
  });

  it("a Library replay opened over a friend's game drops the target and stops the playing", () => {
    useReplayStore.getState().loadGame(SGF, { autoPlay: true, returnTo: FRIENDS });
    vi.advanceTimersByTime(600);
    useReplayStore.getState().loadGame(SGF, { libraryId: 'g1' });
    const s = useReplayStore.getState();
    expect(s.returnTo).toBeNull();
    expect(s.autoPlaying).toBe(false);
    expect(s.currentMove).toBe(0);
    vi.advanceTimersByTime(600 * 3);
    expect(useReplayStore.getState().currentMove).toBe(0);
  });
});
