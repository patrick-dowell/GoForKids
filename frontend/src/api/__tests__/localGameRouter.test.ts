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

describe('localGameRouter — bridge ownership for end-of-game scoring', () => {
  beforeEach(freshRouter);
  afterEach(() => {
    freshRouter();
    // Tear down the bridge stub between tests.
    delete (globalThis as { window?: { kataGo?: unknown } }).window?.kataGo;
  });

  // Sets up a fake `window.kataGo` whose analyze() returns a canned ownership
  // grid. Mirrors what the Swift bridge returns when ownership:true is set.
  function stubBridge(ownership: number[]) {
    if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
      (globalThis as { window: object }).window = {};
    }
    (globalThis as { window: { kataGo?: unknown } }).window.kataGo = {
      ping: () => Promise.resolve({ pong: true }),
      analyze: () =>
        Promise.resolve({
          candidates: [],
          rootVisits: 200,
          kataGoPlayedMove: 'pass',
          ownership,
        }),
    };
  }

  it('removes dead stones using bridge ownership when two passes end the game', async () => {
    // 5×5 board where we'll play a white stone deep in black territory.
    // After two passes, the white stone should be marked dead and Black
    // should win territory + 1 captured stone.
    const { game_id } = localGameRouter.createGame({ board_size: 5 });
    // Build the position: Black surrounds, White isolated.
    //   . . . . .
    //   . B B B .
    //   . B W B .
    //   . B B B .
    //   . . . . .
    localGameRouter.playMove(game_id, 1, 1); // B
    localGameRouter.playMove(game_id, 2, 2); // W
    localGameRouter.playMove(game_id, 1, 2); // B
    localGameRouter.playMove(game_id, 0, 0); // W far away
    localGameRouter.playMove(game_id, 1, 3); // B
    localGameRouter.playMove(game_id, 0, 1); // W
    localGameRouter.playMove(game_id, 2, 1); // B
    localGameRouter.playMove(game_id, 0, 2); // W
    localGameRouter.playMove(game_id, 2, 3); // B
    localGameRouter.playMove(game_id, 0, 3); // W
    localGameRouter.playMove(game_id, 3, 1); // B
    localGameRouter.playMove(game_id, 0, 4); // W
    localGameRouter.playMove(game_id, 3, 2); // B
    localGameRouter.playMove(game_id, 4, 4); // W
    localGameRouter.playMove(game_id, 3, 3); // B
    // 5×5 = 25 ownership values, row-major. Bridge emits in GTP convention
    // ("+1 = player-to-move owns"). 15 real moves + 2 passes leaves
    // currentColor = White at scoring time, so we send color: 'W' and the
    // router negates the values before thresholding. To simulate a
    // Black-dominant board we therefore return all -0.9 values (which the
    // router will flip to +0.9 = Black-owns). The pla=B branch is covered
    // by the next test.
    const own = new Array(25).fill(-0.9); // Black-controlled everywhere (pla=W frame)
    stubBridge(own);

    // Two consecutive passes triggers scoring.
    await localGameRouter.pass(game_id);
    const final = (await localGameRouter.pass(game_id)) as Exclude<
      Awaited<ReturnType<typeof localGameRouter.pass>>,
      { error: string }
    >;
    expect(final.phase).toBe('finished');
    // All white stones should be marked dead — none left on board.
    const whiteLeft = final.board.flat().filter((c) => c === 2).length;
    expect(whiteLeft).toBe(0);
    // Captures should reflect the killed whites (6 white stones on board
    // before scoring, all dead).
    expect(final.captures.black).toBeGreaterThanOrEqual(6);
  });

  it('removes dead stones correctly when scoring pla is Black (regression: 19x19scoring.log)', async () => {
    // Mirror image of the previous test: 14 real moves instead of 15, so
    // currentColor at scoring time is Black (B passes first, then W). The
    // bridge therefore receives color: 'B' and the router MUST NOT negate
    // the ownership values — KataGo's GTP layer already returned them in
    // the "+1 = Black owns" frame.
    //
    // Before the 2026-05-12 fix the router negated unconditionally, which
    // inverted the sign in this branch and caused 238 Black stones to be
    // mass-marked as dead on a real 19×19 game (see 19x19scoring.log:
    // "removing 238 dead stones, rescoring → winner=white"). This test
    // pins the conditional-negate logic.
    const { game_id } = localGameRouter.createGame({ board_size: 5 });
    // Same opening as the pla=W test, but stop one move short. Black's
    // move 13 at (3,2) closes the last liberty of the central W(2,2), so
    // it's captured before the passes — leaving the 6 isolated W stones
    // on the edges, which should all be ruled dead by ownership.
    localGameRouter.playMove(game_id, 1, 1); // B
    localGameRouter.playMove(game_id, 2, 2); // W (will be captured at move 13)
    localGameRouter.playMove(game_id, 1, 2); // B
    localGameRouter.playMove(game_id, 0, 0); // W
    localGameRouter.playMove(game_id, 1, 3); // B
    localGameRouter.playMove(game_id, 0, 1); // W
    localGameRouter.playMove(game_id, 2, 1); // B
    localGameRouter.playMove(game_id, 0, 2); // W
    localGameRouter.playMove(game_id, 2, 3); // B
    localGameRouter.playMove(game_id, 0, 3); // W
    localGameRouter.playMove(game_id, 3, 1); // B
    localGameRouter.playMove(game_id, 0, 4); // W
    localGameRouter.playMove(game_id, 3, 2); // B — captures W(2,2)
    localGameRouter.playMove(game_id, 4, 4); // W
    // 14 moves played → currentColor = Black at scoring time → pla = 'B'.
    // GTP convention with pla=B: positive = Black owns. So a Black-dominant
    // board is simulated by all +0.9 values (NO negation by the stub).
    const own = new Array(25).fill(0.9);
    stubBridge(own);

    await localGameRouter.pass(game_id);
    const final = (await localGameRouter.pass(game_id)) as Exclude<
      Awaited<ReturnType<typeof localGameRouter.pass>>,
      { error: string }
    >;
    expect(final.phase).toBe('finished');
    // All 6 surviving white stones (top row + 4,4) should be marked dead.
    const whiteLeft = final.board.flat().filter((c) => c === 2).length;
    expect(whiteLeft).toBe(0);
    // Black should win — would be flipped to White with the old buggy
    // unconditional-negate (every Black stone would have been marked dead).
    expect(final.result!.winner).toBe('black');
  });

  it('keeps raw-territory score when bridge returns no ownership', async () => {
    stubBridge([]); // empty → length mismatch → applyOwnership returns []
    const { game_id } = localGameRouter.createGame({ board_size: 5 });
    localGameRouter.playMove(game_id, 2, 2); // B
    localGameRouter.playMove(game_id, 0, 0); // W
    await localGameRouter.pass(game_id);
    const final = (await localGameRouter.pass(game_id)) as Exclude<
      Awaited<ReturnType<typeof localGameRouter.pass>>,
      { error: string }
    >;
    expect(final.phase).toBe('finished');
    // White stone still present — no dead-stone removal because ownership
    // size mismatched and there's no Render fallback in tests.
    const whiteLeft = final.board.flat().filter((c) => c === 2).length;
    expect(whiteLeft).toBe(1);
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
