/**
 * Smoke tests for the iPad Phase D local game router. Validates that the
 * DTO shape matches what the rest of the app expects, that mutations
 * persist across reloads, and that handicap stones survive undo.
 *
 * Project-wide vitest env is 'node'; we shim a minimal in-memory
 * `localStorage` for these tests rather than pull in jsdom for one file.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localGameRouter } from '../localGameRouter';

// Minimal localStorage shim — matches the Web Storage API surface our
// router actually uses (get / set / remove / clear).
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

function freshRouter() {
  localGameRouter._resetForTests();
  localStorage.clear();
}

describe('localGameRouter — basic lifecycle', () => {
  beforeEach(freshRouter);
  afterEach(freshRouter);

  it('creates a game with all required DTO fields', () => {
    const dto = localGameRouter.createGame({ board_size: 9, target_rank: '15k' });
    expect(dto.game_id).toMatch(/^[0-9a-f]{8}$/);
    expect(dto.board.length).toBe(9);
    expect(dto.board[0].length).toBe(9);
    expect(dto.current_color).toBe('black');
    expect(dto.move_number).toBe(1);
    expect(dto.phase).toBe('playing');
    expect(dto.last_move).toBeNull();
    expect(dto.ko_point).toBeNull();
    expect(dto.result).toBeNull();
    expect(dto.captures).toEqual({ black: 0, white: 0 });
  });

  it('playMove updates board, captures, current_color, last_move', () => {
    const { game_id } = localGameRouter.createGame({ board_size: 9 });
    const dto = localGameRouter.playMove(game_id, 4, 4);
    expect('error' in (dto as object)).toBe(false);
    const state = dto as ReturnType<typeof localGameRouter.getGame> & object;
    expect(state).not.toBeNull();
    expect(state!.board[4][4]).toBe(1); // Color.Black
    expect(state!.current_color).toBe('white');
    expect(state!.last_move).toEqual({ row: 4, col: 4 });
    expect(state!.move_number).toBe(2);
  });

  it('rejects illegal moves with an error', () => {
    const { game_id } = localGameRouter.createGame({ board_size: 9 });
    localGameRouter.playMove(game_id, 4, 4);
    const r = localGameRouter.playMove(game_id, 4, 4) as { error: string };
    expect(r.error).toMatch(/occupied/i);
  });

  it('two passes end the game and produce a result (raw territory, no Render call)', async () => {
    const { game_id } = localGameRouter.createGame({ board_size: 9 });
    // No renderScorePositionFn set in this test → falls through to raw scoring.
    await localGameRouter.pass(game_id);
    const final = await localGameRouter.pass(game_id);
    const state = final as Exclude<typeof final, { error: string }>;
    expect(state.phase).toBe('finished');
    expect(state.result).not.toBeNull();
    expect(state.result!.winner).toMatch(/black|white/);
    expect(state.sgf).toMatch(/^\(;GM\[1\]/);
  });

  it('resign credits the opponent of player_color', () => {
    const { game_id } = localGameRouter.createGame({ board_size: 9, player_color: 'black' });
    const final = localGameRouter.resign(game_id) as Exclude<
      ReturnType<typeof localGameRouter.resign>,
      { error: string }
    >;
    expect(final.phase).toBe('finished');
    expect(final.result!.winner).toBe('white');
  });
});

describe('localGameRouter — persistence', () => {
  beforeEach(freshRouter);
  afterEach(freshRouter);

  it('survives an in-memory reset by reloading from localStorage', () => {
    const { game_id } = localGameRouter.createGame({ board_size: 9 });
    localGameRouter.playMove(game_id, 4, 4);
    localGameRouter.playMove(game_id, 3, 3);
    // Wipe in-memory cache; the next getGame should still find it.
    localGameRouter._resetForTests();
    const restored = localGameRouter.getGame(game_id);
    expect(restored).not.toBeNull();
    expect(restored!.board[4][4]).toBe(1);
    expect(restored!.board[3][3]).toBe(2);
    expect(restored!.move_number).toBe(3);
  });
});

describe('localGameRouter — handicap', () => {
  beforeEach(freshRouter);
  afterEach(freshRouter);

  it('places handicap stones and gives White the first move', () => {
    const dto = localGameRouter.createGame({ board_size: 19, handicap: 4 });
    expect(dto.current_color).toBe('white');
    // 4-stone handicap: four black stones placed at the star points.
    let blackCount = 0;
    for (const row of dto.board) for (const c of row) if (c === 1) blackCount++;
    expect(blackCount).toBe(4);
  });

  it('handicap stones survive an undo', () => {
    const { game_id } = localGameRouter.createGame({ board_size: 19, handicap: 2 });
    // Verify initial 2 handicap stones.
    let before = localGameRouter.getGame(game_id)!;
    let blackBefore = before.board.flat().filter((c) => c === 1).length;
    expect(blackBefore).toBe(2);
    // White plays first under handicap.
    localGameRouter.playMove(game_id, 9, 9); // White at tengen
    // Now undo and verify handicap stones are still there.
    const after = localGameRouter.undo(game_id) as Exclude<
      ReturnType<typeof localGameRouter.undo>,
      { error: string }
    >;
    let blackAfter = after.board.flat().filter((c) => c === 1).length;
    expect(blackAfter).toBe(2);
    expect(after.current_color).toBe('white'); // still White-to-play after undo
  });
});
