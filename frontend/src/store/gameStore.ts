import { create } from 'zustand';
import { Game, type GamePhase } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, type Point, type GameResult, MoveResult, BOARD_SIZE } from '../engine/types';
import { api } from '../api/client';
import { toGtp } from '../api/nativeKataGo';
import { playPlaceSound, playCaptureSound, playPassSound, playGameEndSound, resumeAudio } from '../audio/SoundManager';
import { useLibraryStore, type SavedGame } from './libraryStore';
import { BOT_AVATARS, type PlayerAvatarType, type BotAvatarType } from '../components/Avatar';

function autoSaveGame(state: GameState, sgfOverride?: string) {
  if (state.phase !== 'finished' || !state.result) return;
  const sgf = sgfOverride || state._game.toSGF();
  const winner = state.result.winner === Color.Black ? 'Black' : 'White';
  const isResignation = state.result.blackScore === 0 && state.result.whiteScore === 0;
  const margin = Math.abs(state.result.blackScore - state.result.whiteScore);

  const isBotVsBot = state.gameMode === 'botvsbot';
  const opponentRank = isBotVsBot
    ? `${state.blackRank || '?'} vs ${state.whiteRank || '?'}`
    : state.targetRank;

  const saved: SavedGame = {
    id: state.gameId || `local-${Date.now()}`,
    sgf,
    date: new Date().toISOString(),
    playerColor: state.playerColor === Color.Black ? 'black' : 'white',
    opponentRank,
    result: isResignation
      ? `${winner} wins (resignation)`
      : `${winner} wins by ${margin.toFixed(1)}`,
    moveCount: state.moveCount,
    isRanked: state.isRanked,
    gameId: state.gameId,
    gameType: isBotVsBot ? 'bot-vs-bot' : 'human-vs-bot',
    blackRank: isBotVsBot ? (state.blackRank ?? undefined) : undefined,
    whiteRank: isBotVsBot ? (state.whiteRank ?? undefined) : undefined,
  };

  useLibraryStore.getState().saveGame(saved);
}

type GridSnapshot = number[];

/** Territory overlay: which intersections belong to which player */
interface TerritoryMap {
  black: Set<number>;  // indices
  white: Set<number>;
  neutral: Set<number>;
}

/** One sample for the live score graph: black lead at this move number. */
export interface ScorePoint {
  move: number;
  /** black_score - (white_score + komi). Positive = black ahead. */
  lead: number;
}

/** Compute the current black-lead from territory + captures + komi. */
function currentLead(game: Game): number {
  const { blackTerritory, whiteTerritory } = game.board.scoreTerritory();
  const black = blackTerritory.size + game.board.captures[Color.Black];
  const white = whiteTerritory.size + game.board.captures[Color.White] + game.komi;
  return black - white;
}

function appendScorePoint(history: ScorePoint[], game: Game): ScorePoint[] {
  return [...history, { move: game.moveHistory.length, lead: currentLead(game) }];
}

/** Replace the final history point with the rules-based result.black - result.white,
 *  so the graph's last point matches what's shown in the final tally (instead of
 *  the pre-scoring KataGo estimate, which differs by dead-stone cleanup). */
function appendFinalScore(history: ScorePoint[], moveNum: number, result: any): ScorePoint[] {
  if (!result) return history;
  const black = typeof result.black_score === 'number' ? result.black_score : 0;
  const white = typeof result.white_score === 'number' ? result.white_score : 0;
  return [...history, { move: moveNum, lead: black - white }];
}

export type GameMode = 'ai' | 'botvsbot' | 'local';

// Standard handicap stone positions (row, col), per board size.
// Mirrors backend/app/game/state.py — keep these in sync.
const HANDICAP_POSITIONS_19: Record<number, [number, number][]> = {
  2: [[15, 3], [3, 15]],
  3: [[15, 3], [3, 15], [15, 15]],
  4: [[15, 3], [3, 15], [3, 3], [15, 15]],
  5: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 9]],
  6: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15]],
  7: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [9, 9]],
  8: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [3, 9], [15, 9]],
  9: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [3, 9], [15, 9], [9, 9]],
};

const HANDICAP_POSITIONS_13: Record<number, [number, number][]> = {
  2: [[9, 3], [3, 9]],
  3: [[9, 3], [3, 9], [9, 9]],
  4: [[9, 3], [3, 9], [3, 3], [9, 9]],
  5: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 6]],
  6: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9]],
  7: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9], [6, 6]],
  8: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9], [3, 6], [9, 6]],
  9: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9], [3, 6], [9, 6], [6, 6]],
};

const HANDICAP_POSITIONS_9: Record<number, [number, number][]> = {
  2: [[6, 2], [2, 6]],
  3: [[6, 2], [2, 6], [6, 6]],
  4: [[6, 2], [2, 6], [2, 2], [6, 6]],
  5: [[6, 2], [2, 6], [2, 2], [6, 6], [4, 4]],
};

const HANDICAP_BY_SIZE: Record<number, Record<number, [number, number][]>> = {
  9: HANDICAP_POSITIONS_9,
  13: HANDICAP_POSITIONS_13,
  19: HANDICAP_POSITIONS_19,
};

export const MAX_HANDICAP_BY_SIZE: Record<number, number> = { 9: 5, 13: 9, 19: 9 };

function handicapPositions(size: number, n: number): [number, number][] {
  return HANDICAP_BY_SIZE[size]?.[n] ?? [];
}

/**
 * Build the GTP move list to feed KataGo via the iPad bridge.
 *
 * Why this exists: the original `boardToMoves` helper sent the bridge
 * only the CURRENT stone layout (sorted black-stones-first, then white).
 * KataGo replayed those out-of-order plays and ended up with the right
 * stones on the board but the WRONG move history — in particular no
 * notion of which point was just captured, so positional superko (ko)
 * was invisible. KataGo then routinely suggested re-taking a ko stone
 * the kid had just captured, our engine rejected the move as illegal,
 * and the selector fell back to passing. User-visible symptom: bot
 * passes the turn after a ko capture instead of playing a ko threat.
 *
 * This helper produces the actual sequence: handicap stones placed
 * first (as Black "moves" — KataGo's GTP accepts consecutive plays of
 * the same color), then the real moveHistory in order including
 * passes ('pass' in GTP). Captures unfold naturally as KataGo replays
 * each play.
 */
export function buildBridgeMovesFromGame(
  game: Game,
  handicap: number,
  size: number,
): Array<{ color: 'B' | 'W'; point: string }> {
  const moves: Array<{ color: 'B' | 'W'; point: string }> = [];
  if (handicap > 0) {
    for (const [r, c] of handicapPositions(size, handicap)) {
      moves.push({ color: 'B', point: toGtp({ row: r, col: c }, size) });
    }
  }
  for (const m of game.moveHistory) {
    moves.push({
      color: m.color === Color.Black ? 'B' : 'W',
      point: m.point ? toGtp(m.point, size) : 'pass',
    });
  }
  return moves;
}

interface NewGameOptions {
  komi?: number;
  playerColor?: Color;
  targetRank?: string;
  isRanked?: boolean;
  useBackend?: boolean;
  playerAvatar?: PlayerAvatarType;
  gameMode?: GameMode;
  handicap?: number;
  blackRank?: string;  // For bot-vs-bot
  whiteRank?: string;  // For bot-vs-bot
  boardSize?: number;  // 9, 13, or 19
  /** Marks this game as the lesson 5 first-game flow — game UI should swap
   *  the analytical ScoreGraph for a simpler "Who's winning" bar. */
  lessonContext?: boolean;
  /** Marks this game as launched from the auto-play match-picker
   *  (feature 22). App.tsx watches for this + phase='finished' to call
   *  `autoPlayStore.recordResult` exactly once when the game ends. */
  autoplayContext?: boolean;
}

interface GameState {
  grid: GridSnapshot;
  boardSize: number;
  phase: GamePhase;
  currentColor: Color;
  moveCount: number;
  lastMove: Point | null;
  lastCaptures: Point[];
  result: GameResult | null;
  atariGroups: { color: Color; stones: Point[]; liberty: Point }[];
  blackCaptures: number;
  whiteCaptures: number;
  komi: number;
  playerColor: Color;
  targetRank: string;
  isRanked: boolean;
  aiThinking: boolean;
  gameId: string | null;
  territory: TerritoryMap | null;
  playerAvatar: PlayerAvatarType;
  botAvatar: BotAvatarType;
  botName: string;
  gameMode: GameMode;
  handicap: number;
  blackRank: string | null;
  whiteRank: string | null;
  botVsBotSpeed: number;  // ms delay between moves
  botVsBotPaused: boolean;
  autoCompleting: boolean;
  /** True when this game was launched from the Learn flow (lesson 5 first-game).
   *  Game UI uses this to swap analytical widgets for kid-friendly explainers. */
  lessonContext: boolean;
  /** True when this game was launched from the auto-play match-picker
   *  (feature 22). The post-game modal + rank-up celebration key off this. */
  autoplayContext: boolean;
  /** Set to true the moment the AI passes mid-game. UI watches this to surface
   *  a "what just happened" modal so newcomers don't think the game silently
   *  ended. Cleared by either the user passing back or dismissing. */
  botJustPassed: boolean;
  /** When true, the lesson 5 game-end modal is hidden (collapsed to the right
   *  side panel). Player can re-open it from the panel. */
  lessonGameEndDismissed: boolean;
  /** When true, the regular (non-lesson) game-end modal is hidden. Mirrors
   *  lessonGameEndDismissed but for the generic GameEndModal — pops up once
   *  on phase=finished, can be dismissed back to the board and re-opened
   *  from the GameEndPanel "See results" button. */
  gameEndDismissed: boolean;
  deadStones: { row: number; col: number; color: Color }[];  // Stones marked dead at scoring
  /** True while the backend is computing the final score with dead-stone
   *  detection (~5-10 s). UI shows a "Calculating final score…" modal and
   *  hides the placeholder score until the real values arrive. */
  scoringInProgress: boolean;
  scoreHistory: ScorePoint[];  // Live score per move (for the score graph)
  /** Stones merged by the most recent move (or empty). Renderer reads this
   *  to fire a connection pulse, then it gets cleared on the next move. */
  lastMerged: { color: Color; stones: Point[] };
  /** Set when the player's most recent click was rejected by a *rule*
   *  (ko, suicide). Drives a kid-friendly modal that explains why the
   *  move wasn't allowed. Null = no violation to surface (or already
   *  dismissed). Occupied isn't included — it's self-evident and we
   *  let the existing "stones can't be moved" feedback handle it. */
  ruleViolation: 'ko' | 'suicide' | null;

  _game: Game;
  _botVsBotTimer: number | null;

  newGame: (options?: NewGameOptions) => void;
  playMove: (point: Point) => MoveResult;
  pass: () => void;
  resign: () => void;
  undo: () => boolean;
  requestAIMove: () => Promise<void>;
  requestBotVsBotMove: () => Promise<void>;
  setBotVsBotSpeed: (ms: number) => void;
  toggleBotVsBotPause: () => void;
  finishGame: () => Promise<void>;
  getBoard: () => Board;
  /** Clear the rule-violation modal (ko / suicide explainer). */
  dismissRuleViolation: () => void;
  /** Dismiss the bot-passed modal without taking action (player keeps playing). */
  dismissBotPassed: () => void;
  /** Restart the current game with the same config (used by the lesson 5
   *  game-end modal's Play Again button). */
  replayGame: () => void;
  /** Collapse the lesson game-end modal so the player can see the board. */
  dismissLessonGameEnd: () => void;
  /** Re-open the lesson game-end modal from the side-panel re-open button. */
  reopenLessonGameEnd: () => void;
  /** Collapse the regular game-end modal back to the side-panel "See
   *  results" pill. */
  dismissGameEnd: () => void;
  /** Re-open the regular game-end modal from the side-panel pill. */
  reopenGameEnd: () => void;
}

function snapshot(game: Game, extras?: Partial<GameState>): Partial<GameState> {
  // Compute territory when the game is finished
  let territory: TerritoryMap | null = null;
  if (game.phase === 'finished' || game.phase === 'scoring') {
    const { blackTerritory, whiteTerritory, neutral } = game.board.scoreTerritory();
    territory = { black: blackTerritory, white: whiteTerritory, neutral };
  }

  return {
    grid: [...game.board.grid],
    boardSize: game.board.size,
    phase: game.phase,
    currentColor: game.currentColor,
    moveCount: game.moveHistory.length,
    lastMove: extras?.lastMove ?? null,
    lastCaptures: extras?.lastCaptures ?? [],
    result: game.result,
    atariGroups: game.board.getAtariGroups(),
    blackCaptures: game.board.captures[Color.Black],
    whiteCaptures: game.board.captures[Color.White],
    komi: game.komi,
    territory,
  };
}

/**
 * Sync server scoring result onto the local game.
 * Returns dead stones for visual overlay.
 */
function syncServerScoring(
  game: Game,
  serverState: { board: number[][]; result?: any },
): { row: number; col: number; color: Color }[] {
  const deadStones: { row: number; col: number; color: Color }[] = [];
  const size = game.board.size;

  // Identify dead stones: stones that exist locally but are empty on the server = dead
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const localColor = game.board.grid[r * size + c];
      const serverColor = serverState.board[r][c];
      if (localColor !== Color.Empty && serverColor === Color.Empty) {
        deadStones.push({ row: r, col: c, color: localColor as Color });
      }
    }
  }

  // Now sync the board
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      game.board.grid[r * size + c] = serverState.board[r][c];
    }
  }

  if (serverState.result) {
    const winner = serverState.result.winner === 'black' ? Color.Black : Color.White;
    game.result = {
      winner,
      blackScore: serverState.result.black_score ?? 0,
      whiteScore: serverState.result.white_score ?? 0,
      blackTerritory: serverState.result.black_territory ?? 0,
      whiteTerritory: serverState.result.white_territory ?? 0,
      blackCaptures: serverState.result.black_captures ?? 0,
      whiteCaptures: serverState.result.white_captures ?? 0,
      komi: game.komi,
    };
  }

  game.phase = 'finished';
  return deadStones;
}

/**
 * In tutorial games (lessonContext), auto-pass on behalf of the current
 * player when they have no legal moves. Recurses, so if the new current
 * color also can't play, they auto-pass too — two consecutive passes
 * trigger the pass-pass scoring path and the game ends gracefully
 * without the kid having to find the Pass button.
 *
 * No-op outside lesson context. No-op if the current player has at least
 * one legal move. Bookkeeping mirrors gameStore.pass() but skips the
 * player-turn guard since we may be passing on the bot's behalf.
 */
function lessonAutoPass(
  get: () => GameState,
  set: (partial: Partial<GameState> | ((s: GameState) => Partial<GameState>)) => void,
): void {
  const s = get();
  if (!s.lessonContext) return;
  if (s.phase !== 'playing') return;
  // currentColor in a playing game is never Empty — narrow the type for
  // hasLegalMove() which only accepts Stone (Black | White).
  const stone = s.currentColor as Color.Black | Color.White;
  if (s._game.board.hasLegalMove(stone)) return;

  s._game.pass();
  playPassSound();

  const prevHistory = s.scoreHistory;
  const lastLead = prevHistory.length > 0 ? prevHistory[prevHistory.length - 1].lead : 0;
  const passHistory = [...prevHistory, { move: s._game.moveHistory.length, lead: lastLead }];

  if (s._game.phase === 'finished') {
    // Pass-pass ended the game — kick off the same scoring sync as the
    // human-driven pass() finished-branch.
    playGameEndSound();
    set({
      deadStones: [],
      scoringInProgress: !!s.gameId,
      ...snapshot(s._game),
      scoreHistory: passHistory,
    });
    if (s.gameId) {
      api.pass(s.gameId).then((serverState) => {
        if (serverState.result) {
          const dead = syncServerScoring(s._game, serverState);
          const finalHistory = appendFinalScore(passHistory, s._game.moveHistory.length + 1, serverState.result);
          set({
            deadStones: dead,
            scoringInProgress: false,
            ...snapshot(s._game),
            scoreHistory: finalHistory,
          });
          autoSaveGame(get());
        } else {
          set({ scoringInProgress: false });
        }
      }).catch((e) => {
        console.warn('Auto-pass scoring sync failed:', e);
        set({ scoringInProgress: false });
        autoSaveGame(get());
      });
    } else {
      autoSaveGame(get());
    }
    return;
  }

  // Pass didn't end the game — commit state, sync the backend, and recurse
  // to check whether the OTHER side also has no legal moves.
  set({ ...snapshot(s._game), scoreHistory: passHistory });
  if (s.gameId) {
    api.pass(s.gameId).catch((e) => console.warn('Auto-pass sync failed:', e));
  }
  lessonAutoPass(get, set);
}

export const useGameStore = create<GameState>((set, get) => ({
  grid: new Array(BOARD_SIZE * BOARD_SIZE).fill(Color.Empty),
  boardSize: BOARD_SIZE,
  phase: 'playing',
  currentColor: Color.Black,
  moveCount: 0,
  lastMove: null,
  lastCaptures: [],
  result: null,
  atariGroups: [],
  blackCaptures: 0,
  whiteCaptures: 0,
  komi: 7.5,
  playerColor: Color.Black,
  targetRank: '15k',
  isRanked: false,
  aiThinking: false,
  gameId: null,
  territory: null,
  playerAvatar: 'blackhole',
  botAvatar: 'pebble',
  botName: 'Pebble',
  gameMode: 'ai',
  handicap: 0,
  blackRank: null,
  whiteRank: null,
  botVsBotSpeed: 800,
  botVsBotPaused: false,
  autoCompleting: false,
  lessonContext: false,
  autoplayContext: false,
  botJustPassed: false,
  lessonGameEndDismissed: false,
  gameEndDismissed: false,
  deadStones: [],
  scoringInProgress: false,
  scoreHistory: [{ move: 0, lead: 0 }],
  lastMerged: { color: Color.Empty, stones: [] },
      ruleViolation: null,
  _game: new Game(),
  _botVsBotTimer: null,

  newGame: async (options) => {
    // Clear any running bot-vs-bot timer
    const prevTimer = get()._botVsBotTimer;
    if (prevTimer) clearTimeout(prevTimer);

    const gameMode = options?.gameMode ?? 'ai';
    const requestedSize = options?.boardSize ?? BOARD_SIZE;
    // 5 is supported for the lesson 5 first-game flow; the rest are full-game sizes.
    const boardSize = [5, 9, 13, 19].includes(requestedSize) ? requestedSize : BOARD_SIZE;
    const maxHandicap = MAX_HANDICAP_BY_SIZE[boardSize] ?? 0;
    const handicap = Math.max(0, Math.min(maxHandicap, options?.handicap ?? 0));
    // 5x5 (the lesson 5 first-game flow): no komi, so Black's first-move
    // advantage feels real and the kid can win straight up.
    // 9x9/13x13 use 6.5, 19x19 uses 7.5.
    const defaultKomi = boardSize === 5 ? 0 : boardSize === 19 ? 7.5 : 6.5;
    const komi = handicap > 0 ? 0.5 : (options?.komi ?? defaultKomi);
    const game = new Game(komi, boardSize);
    const playerColor = options?.playerColor ?? Color.Black;
    const targetRank = options?.targetRank ?? '15k';
    const isRanked = options?.isRanked ?? false;
    const playerAvatar = options?.playerAvatar ?? 'blackhole';
    const blackRank = options?.blackRank ?? null;
    const whiteRank = options?.whiteRank ?? null;

    // Determine bot avatar (use target rank for AI mode, white rank for bot-vs-bot)
    const botRank = gameMode === 'botvsbot' ? (whiteRank || '15k') : targetRank;
    const botInfo = BOT_AVATARS[botRank] || BOT_AVATARS['15k'];

    // Place handicap stones on the local board
    const handiPoints = handicapPositions(boardSize, handicap);
    if (handiPoints.length > 0) {
      for (const [r, c] of handiPoints) {
        game.board.grid[r * boardSize + c] = Color.Black;
      }
      game.currentColor = Color.White; // White moves first after handicap
    }

    let gameId: string | null = null;

    const useBackend = options?.useBackend || gameMode === 'botvsbot';
    if (useBackend) {
      try {
        const res = await api.createGame({
          target_rank: targetRank,
          mode: isRanked ? 'ranked' : 'casual',
          komi,
          player_color: playerColor === Color.Black ? 'black' : 'white',
          handicap,
          black_rank: blackRank ?? undefined,
          white_rank: whiteRank ?? undefined,
          board_size: boardSize,
        });
        gameId = res.game_id;
      } catch (e) {
        console.warn('Backend unavailable, falling back to local play', e);
      }
    }

    set({
      _game: game,
      ...snapshot(game),
      playerColor,
      targetRank,
      isRanked,
      gameId,
      aiThinking: false,
      playerAvatar,
      botAvatar: botInfo.type,
      botName: botInfo.name,
      gameMode,
      handicap,
      blackRank,
      whiteRank,
      botVsBotPaused: false,
      _botVsBotTimer: null,
      autoCompleting: false,
      lessonContext: !!options?.lessonContext,
      autoplayContext: !!options?.autoplayContext,
      botJustPassed: false,
      lessonGameEndDismissed: false,
      gameEndDismissed: false,
      deadStones: [],
      scoringInProgress: false,
      scoreHistory: [{ move: 0, lead: currentLead(game) }],
      lastMerged: { color: Color.Empty, stones: [] },
      ruleViolation: null,
    });

    // Bot vs Bot: start the auto-play loop
    if (gameMode === 'botvsbot' && gameId) {
      setTimeout(() => get().requestBotVsBotMove(), 500);
      return;
    }

    // AI plays first if: player is White (normal), or player is Black with handicap (White goes first)
    const currentIsAI = game.currentColor !== playerColor;
    if (gameId && currentIsAI) {
      setTimeout(() => get().requestAIMove(), 300);
    }
  },

  playMove: (point: Point) => {
    resumeAudio();
    const { _game, gameId, aiThinking, playerColor, currentColor } = get();

    // Block input while AI is thinking
    if (aiThinking) return MoveResult.GameOver;

    // Block if it's not the player's turn (in AI games)
    if (gameId && currentColor !== playerColor) return MoveResult.GameOver;

    const merged = _game.board.detectMergedGroups(currentColor, point);
    const { result, captures } = _game.playMove(point);
    // Surface the rule that rejected the move so the UI can explain it.
    // Occupied is intuitive (you can see the stone there) and stays silent;
    // ko and suicide both look legal-but-aren't to a new player.
    if (result === MoveResult.Ko) {
      set({ ruleViolation: 'ko' });
    } else if (result === MoveResult.Suicide) {
      set({ ruleViolation: 'suicide' });
    }
    if (result === MoveResult.Ok) {
      playPlaceSound(point.row, point.col);
      if (captures.length > 0) {
        setTimeout(() => playCaptureSound(captures.length), 100);
      }
      // Optimistic snapshot. For local-only games we also push a local score
      // estimate; for backend games we'll replace that with KataGo's estimate
      // once the server response arrives.
      const localScored = !gameId;
      // Set aiThinking synchronously when we know the AI is about to be
      // asked for a move. This gates Pass / further taps starting the
      // instant the local stone lands, instead of leaving a ~400ms +
      // network-RTT window where the player can fire off off-turn actions
      // (rapidly tapping Pass during that window used to flip the bot to
      // playing the player's color).
      const willTriggerAI = !!gameId && _game.phase === 'playing';
      set({
        ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
        ...(localScored ? { scoreHistory: appendScorePoint(get().scoreHistory, _game) } : {}),
        lastMerged: merged.length > 0
          ? { color: currentColor, stones: [...merged, point] }
          : { color: Color.Empty, stones: [] },
        // Player chose to keep playing — clear any leftover bot-passed flag.
        botJustPassed: false,
        ...(willTriggerAI ? { aiThinking: true } : {}),
      });

      // Sync with backend, then request AI response. The two calls MUST be
      // sequenced — firing them in parallel races the backend's persistence
      // layer (the AI handler can read the game from disk before /move has
      // saved the user's stone, and end up analyzing an empty board).
      if (willTriggerAI) {
        api.playMove(gameId, point.row, point.col)
          .then((serverState) => {
            // Replace local scoreTerritory-based estimate with KataGo's.
            if (typeof serverState.score_lead === 'number') {
              set((s) => ({
                scoreHistory: [
                  ...s.scoreHistory,
                  { move: _game.moveHistory.length, lead: serverState.score_lead as number },
                ],
              }));
            }
            // Small delay so the player sees their stone land before AI responds.
            setTimeout(() => get().requestAIMove(), 400);
          })
          .catch((e) => {
            console.warn('playMove sync failed:', e);
            // Unstick the UI — without this aiThinking would stay true forever.
            set({ aiThinking: false });
          });
      }
    }
    return result;
  },

  pass: () => {
    const { _game, gameId, aiThinking, playerColor, currentColor } = get();
    if (aiThinking) return;
    // In AI games, only the player should pass via this action — guard
    // against off-turn calls (e.g. the player rapidly taps Pass right after
    // playing a stone, before aiThinking has been set). Mirrors the same
    // check in playMove().
    if (gameId && currentColor !== playerColor) return;

    _game.pass();
    playPassSound();
    // Player chose Pass — clear the bot-passed flag (modal would dismiss anyway).
    set({ botJustPassed: false });

    // Pass doesn't change the board, so the prior KataGo lead is still
    // valid for backend games. Carry it forward instead of recomputing
    // (the local fallback would otherwise overwrite a real ~+65 with the
    // flood-fill ~0 territory count).
    const prevHistory = get().scoreHistory;
    const lastLead = prevHistory.length > 0 ? prevHistory[prevHistory.length - 1].lead : 0;
    const passHistory = gameId
      ? [...prevHistory, { move: _game.moveHistory.length, lead: lastLead }]
      : appendScorePoint(prevHistory, _game);
    if (_game.phase === 'finished') {
      playGameEndSound();
      // Always commit the local "finished" state first so the UI flips
      // immediately (Pass button hides, result block shows). The backend
      // sync on top fills in dead-stone overlay + final score values when
      // it returns; if it fails or lags, the player still sees that the
      // game has ended instead of a stuck Pass button.
      // scoringInProgress masks the placeholder local-territory score
      // (which jumps wildly because dead stones aren't yet identified)
      // behind a "Calculating final score…" modal until the backend
      // ownership analysis returns.
      set({
        deadStones: [],
        scoringInProgress: !!gameId,
        ...snapshot(_game),
        scoreHistory: passHistory,
      });
      if (gameId) {
        // Use the api.pass RESPONSE directly (it already contains the scored
        // board with dead stones removed + the final result). The previous
        // fire-and-forget pass + parallel getGame raced the backend and
        // sometimes saw the pre-pass board, missing the dead-stone overlay.
        api.pass(gameId).then((serverState) => {
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            const finalHistory = appendFinalScore(passHistory, _game.moveHistory.length + 1, serverState.result);
            set({
              deadStones: dead,
              scoringInProgress: false,
              ...snapshot(_game),
              scoreHistory: finalHistory,
            });
            autoSaveGame(get());
          } else {
            set({ scoringInProgress: false });
          }
        }).catch((e) => {
          console.warn('Failed to sync scoring:', e);
          set({ scoringInProgress: false });
          autoSaveGame(get());
        });
      } else {
        autoSaveGame(get());
      }
    } else {
      // Same gating story as playMove(): set aiThinking synchronously so
      // that subsequent input is blocked while /pass is in flight.
      const willTriggerAI = !!gameId && _game.phase === 'playing';
      set({
        ...snapshot(_game),
        scoreHistory: passHistory,
        ...(willTriggerAI ? { aiThinking: true } : {}),
      });
      // Sequence the pass + AI response the same way as playMove — firing
      // /pass and /ai-move in parallel races the backend's persistence,
      // letting the AI analyze the pre-pass game state.
      if (gameId) {
        api.pass(gameId)
          .then(() => {
            if (_game.phase === 'playing') {
              setTimeout(() => get().requestAIMove(), 400);
            } else {
              // Server-side pass ended the game in some path we didn't
              // detect locally; clear aiThinking so the UI isn't stuck.
              set({ aiThinking: false });
            }
          })
          .catch((e) => {
            console.warn('pass sync failed:', e);
            set({ aiThinking: false });
          });
      } else if (_game.phase === 'playing') {
        setTimeout(() => get().requestAIMove(), 400);
      }
    }
  },

  resign: () => {
    const { _game, gameId, gameMode, playerColor } = get();
    // In AI games, the only side that can click Resign is the human.
    // Pass playerColor explicitly — the previous heuristic of
    // oppositeColor(currentColor) credited the wrong side as winner whenever
    // the player resigned during the bot's turn (~5s think time on iPad
    // makes that the common case). Bot-vs-bot doesn't expose Resign in the
    // UI; local hot-seat falls back to "current color resigns".
    const isAIGame = !!gameId && gameMode === 'ai';
    _game.resign(isAIGame ? playerColor : undefined);
    playGameEndSound();
    set(snapshot(_game));
    autoSaveGame(get());
    if (gameId) {
      api.resign(gameId).catch(console.warn);
    }
  },

  undo: () => {
    const { _game, gameId, aiThinking } = get();
    if (aiThinking) return false;

    // In AI games, undo both the AI's last move and the player's last move
    if (gameId && _game.moveHistory.length >= 2) {
      _game.undo(); // undo AI's move
      _game.undo(); // undo player's move
      const lastRecord = _game.moveHistory[_game.moveHistory.length - 1];
      const trimmed = get().scoreHistory.slice(0, _game.moveHistory.length + 1);
      set({ ...snapshot(_game, { lastMove: lastRecord?.point ?? null }), scoreHistory: trimmed });
      api.undo(gameId).then(() => api.undo(gameId!)).catch(console.warn);
      return true;
    }

    // Local game: single undo
    const success = _game.undo();
    if (success) {
      const lastRecord = _game.moveHistory[_game.moveHistory.length - 1];
      const trimmed = get().scoreHistory.slice(0, _game.moveHistory.length + 1);
      set({ ...snapshot(_game, { lastMove: lastRecord?.point ?? null }), scoreHistory: trimmed });
    }
    return success;
  },

  requestAIMove: async () => {
    const { gameId, _game, phase, targetRank, lessonContext, playerColor } = get();
    if (!gameId || phase !== 'playing') return;

    // Tutorial auto-pass: before fetching a bot move, check whether the
    // current side (= the bot, since we're in requestAIMove) has any legal
    // moves. If not, pass on its behalf; recurse handles the player side
    // if they also can't play. Two consecutive auto-passes terminate the
    // game cleanly via the existing pass-pass scoring path.
    if (lessonContext) {
      lessonAutoPass(get, set);
      const after = get();
      if (after.phase !== 'playing') return;            // game ended via auto-passes
      if (after.currentColor === playerColor) return;   // player's turn now, no AI move needed
    }

    set({ aiThinking: true });

    try {
      // Pass targetRank so the iPad bridge path can apply rank-calibrated
      // selection. Web (HTTP) path ignores it — backend reads target_rank
      // from the active-game record.
      //
      // neverPass keeps the bot playing as long as the kid is still
      // placing stones — only applied in tutorial games (5x5 is reachable
      // only via lesson 5, so lessonContext is sufficient scope).
      // Gated on `consecutivePasses === 0` so that once the player passes
      // (cons=1), the bot reverts to its normal pass-logic and can pass
      // back to end the game — matches the user's spec "should pass if
      // the player passes assuming it thinks the game is in fact over."
      const neverPass = lessonContext && _game.consecutivePasses === 0;
      // Pass the real move history (handicap + plays in order) so the
      // iPad bridge's KataGo sees the ko / superko bans. Without this,
      // KataGo replays just the stone layout and routinely suggests
      // recapturing a freshly-taken ko stone; our engine rejects the
      // illegal move and the selector falls back to passing — visible
      // as "bot passes the turn after the player takes a ko."
      const movesForBridge = buildBridgeMovesFromGame(
        _game,
        get().handicap,
        _game.board.size,
      );
      const aiMove = await api.getAIMove(gameId, targetRank, {
        neverPass,
        movesForBridge,
      });
      // Re-check state hasn't changed (e.g., user resigned while AI was thinking)
      if (get().phase !== 'playing') {
        set({ aiThinking: false });
        return;
      }

      if (aiMove.point.row >= 0 && aiMove.point.col >= 0) {
        const point = { row: aiMove.point.row, col: aiMove.point.col };
        const aiColor = _game.currentColor;
        const merged = _game.board.detectMergedGroups(aiColor, point);
        const { result, captures } = _game.playMove(point);
        if (result === MoveResult.Ok) {
          playPlaceSound(point.row, point.col);
          if (captures.length > 0) {
            setTimeout(() => playCaptureSound(captures.length), 100);
          }
          // Prefer KataGo's estimate from the server; fall back to local
          // territory-count if the server didn't return one.
          const nextHistory = typeof aiMove.score_lead === 'number'
            ? [
                ...get().scoreHistory,
                { move: _game.moveHistory.length, lead: aiMove.score_lead as number },
              ]
            : appendScorePoint(get().scoreHistory, _game);
          set({
            aiThinking: false,
            ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
            scoreHistory: nextHistory,
            lastMerged: merged.length > 0
              ? { color: aiColor, stones: [...merged, point] }
              : { color: Color.Empty, stones: [] },
          });
          // Tutorial auto-pass: if the player now has no legal moves, pass
          // on their behalf. If the bot can also not play, the recursive
          // chain inside lessonAutoPass will end the game on pass-pass.
          if (lessonContext) lessonAutoPass(get, set);
          return;
        }
      }

      // AI passed — carry the prior KataGo lead forward (board unchanged).
      // Server's AIMoveResponse for a pass also includes its prior score_lead.
      const wasPlayingBeforePass = _game.phase === 'playing';
      _game.pass();
      playPassSound();
      const prevAi = get().scoreHistory;
      const lastAiLead = typeof aiMove.score_lead === 'number'
        ? aiMove.score_lead
        : (prevAi.length > 0 ? prevAi[prevAi.length - 1].lead : 0);
      const aiPassHistory = [...prevAi, { move: _game.moveHistory.length, lead: lastAiLead }];
      if (_game.phase === 'finished') {
        playGameEndSound();
        // Prefer the inline final_state from the AI-pass response. The active
        // game is deleted by _persist_finished_game right after scoring, so
        // a follow-up getGame would 404 — that's why dead stones used to go
        // uncounted on bot-passes-second.
        const serverState = aiMove.final_state ?? null;
        if (serverState && serverState.result) {
          const dead = syncServerScoring(_game, serverState);
          const finalHistory = appendFinalScore(aiPassHistory, _game.moveHistory.length + 1, serverState.result);
          set({ aiThinking: false, deadStones: dead, ...snapshot(_game), scoreHistory: finalHistory });
          autoSaveGame(get());
          return;
        }
        set({ aiThinking: false, deadStones: [], ...snapshot(_game), scoreHistory: aiPassHistory });
        autoSaveGame(get());
      } else {
        // The bot passed and the game is still on. Surface a modal so the
        // player understands what just happened and can choose to keep
        // playing or pass back to end the game.
        set({
          aiThinking: false,
          ...snapshot(_game),
          scoreHistory: aiPassHistory,
          botJustPassed: wasPlayingBeforePass,
        });
      }
    } catch (e) {
      console.warn('AI move failed:', e);
      set({ aiThinking: false });
    }
  },

  requestBotVsBotMove: async () => {
    const { gameId, _game, phase, botVsBotPaused, botVsBotSpeed, blackRank, whiteRank } = get();
    if (!gameId || phase !== 'playing' || botVsBotPaused) return;

    set({ aiThinking: true });

    try {
      // Bot-vs-bot: pick the rank for whoever's turn it is. iPad bridge path
      // uses this to apply per-bot calibration; HTTP path ignores it.
      const sideRank = _game.currentColor === Color.Black ? blackRank : whiteRank;
      const aiMove = await api.getAIMove(gameId, sideRank ?? '15k');
      if (get().phase !== 'playing') {
        set({ aiThinking: false });
        return;
      }

      if (aiMove.point.row >= 0 && aiMove.point.col >= 0) {
        const point = { row: aiMove.point.row, col: aiMove.point.col };
        const botColor = _game.currentColor;
        const merged = _game.board.detectMergedGroups(botColor, point);
        const { result, captures } = _game.playMove(point);
        if (result === MoveResult.Ok) {
          playPlaceSound(point.row, point.col);
          if (captures.length > 0) {
            setTimeout(() => playCaptureSound(captures.length), 100);
          }
          const nextHistory = typeof aiMove.score_lead === 'number'
            ? [
                ...get().scoreHistory,
                { move: _game.moveHistory.length, lead: aiMove.score_lead as number },
              ]
            : appendScorePoint(get().scoreHistory, _game);
          set({
            aiThinking: false,
            ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
            scoreHistory: nextHistory,
            lastMerged: merged.length > 0
              ? { color: botColor, stones: [...merged, point] }
              : { color: Color.Empty, stones: [] },
          });
          // Schedule next move
          const timer = window.setTimeout(() => get().requestBotVsBotMove(), botVsBotSpeed);
          set({ _botVsBotTimer: timer });
          return;
        }
      }

      // Bot passed — carry the prior lead forward (board unchanged).
      _game.pass();
      playPassSound();
      const prevBvb = get().scoreHistory;
      const lastBvbLead = typeof aiMove.score_lead === 'number'
        ? aiMove.score_lead
        : (prevBvb.length > 0 ? prevBvb[prevBvb.length - 1].lead : 0);
      const bvbPassHistory = [...prevBvb, { move: _game.moveHistory.length, lead: lastBvbLead }];
      if (_game.phase === 'finished') {
        playGameEndSound();
        // Prefer the inline final_state from the AI-pass response. The active
        // game is deleted by _persist_finished_game right after scoring, so
        // a follow-up getGame would 404 and dead stones would go uncounted.
        const serverState = aiMove.final_state ?? null;
        if (serverState && serverState.result) {
          const dead = syncServerScoring(_game, serverState);
          const finalHistory = appendFinalScore(bvbPassHistory, _game.moveHistory.length + 1, serverState.result);
          set({ aiThinking: false, deadStones: dead, ...snapshot(_game), scoreHistory: finalHistory });
          autoSaveGame(get());
          return;
        }
        set({ aiThinking: false, deadStones: [], ...snapshot(_game), scoreHistory: bvbPassHistory });
        autoSaveGame(get());
      } else {
        set({ aiThinking: false, ...snapshot(_game), scoreHistory: bvbPassHistory });
        const timer = window.setTimeout(() => get().requestBotVsBotMove(), botVsBotSpeed);
        set({ _botVsBotTimer: timer });
      }
    } catch (e) {
      console.warn('Bot-vs-bot move failed:', e);
      set({ aiThinking: false });
    }
  },

  setBotVsBotSpeed: (ms: number) => {
    set({ botVsBotSpeed: ms });
  },

  toggleBotVsBotPause: () => {
    const { botVsBotPaused, _botVsBotTimer } = get();
    if (botVsBotPaused) {
      // Resume
      set({ botVsBotPaused: false });
      setTimeout(() => get().requestBotVsBotMove(), 300);
    } else {
      // Pause
      if (_botVsBotTimer) clearTimeout(_botVsBotTimer);
      set({ botVsBotPaused: true, _botVsBotTimer: null });
    }
  },

  finishGame: async () => {
    const { gameId, phase, autoCompleting } = get();
    if (!gameId || phase !== 'playing' || autoCompleting) return;
    set({ autoCompleting: true, aiThinking: true });

    // Self-recursive loop calling /finish-move at full speed. Each iteration
    // yields to the event loop via setTimeout(0) so React can render the move
    // before the next request fires. KataGo analysis (~0.5–2s on Render with
    // 500 visits) provides natural pacing — no artificial delay needed.
    const stepOnce = async () => {
      const { gameId: gid, _game, autoCompleting: stillFinishing } = get();
      // Read phase into a local so the narrowing doesn't pin _game.phase
      // for the rest of the closure (we mutate it via _game.pass() later).
      const startPhase: GamePhase = _game.phase;
      if (!gid || !stillFinishing || startPhase !== 'playing') return;

      let aiMove;
      try {
        // Same ko-tracking story as requestAIMove: pass real history so
        // KataGo's bridge replay sees ko bans correctly. The original
        // TODO in api/client.ts:321 is now addressed.
        const movesForBridge = buildBridgeMovesFromGame(
          _game,
          get().handicap,
          _game.board.size,
        );
        aiMove = await api.finishMove(gid, { movesForBridge });
      } catch (e) {
        console.warn('finish-move failed:', e);
        set({ autoCompleting: false, aiThinking: false });
        return;
      }

      // Played a move (point >= 0).
      if (aiMove.point.row >= 0 && aiMove.point.col >= 0) {
        const point = { row: aiMove.point.row, col: aiMove.point.col };
        const moverColor = _game.currentColor;
        const merged = _game.board.detectMergedGroups(moverColor, point);
        const { result, captures } = _game.playMove(point);
        if (result === MoveResult.Ok) {
          playPlaceSound(point.row, point.col);
          if (captures.length > 0) {
            setTimeout(() => playCaptureSound(captures.length), 100);
          }
          const nextHistory = typeof aiMove.score_lead === 'number'
            ? [
                ...get().scoreHistory,
                { move: _game.moveHistory.length, lead: aiMove.score_lead as number },
              ]
            : appendScorePoint(get().scoreHistory, _game);
          set({
            ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
            scoreHistory: nextHistory,
            lastMerged: merged.length > 0
              ? { color: moverColor, stones: [...merged, point] }
              : { color: Color.Empty, stones: [] },
          });
        }
        setTimeout(stepOnce, 0);
        return;
      }

      // Pass — board unchanged, carry the prior lead forward.
      _game.pass();
      playPassSound();
      const prevHistory = get().scoreHistory;
      const lastLead = typeof aiMove.score_lead === 'number'
        ? aiMove.score_lead
        : (prevHistory.length > 0 ? prevHistory[prevHistory.length - 1].lead : 0);
      const passHistory = [...prevHistory, { move: _game.moveHistory.length, lead: lastLead }];

      if (_game.phase === 'finished') {
        // Two passes ended the game — apply final_state from the inline
        // AI-pass response (same dodge bot-vs-bot uses; the active row is
        // deleted by _persist_finished_game right after scoring).
        playGameEndSound();
        const serverState = aiMove.final_state ?? null;
        if (serverState && serverState.result) {
          const dead = syncServerScoring(_game, serverState);
          const finalHistory = appendFinalScore(passHistory, _game.moveHistory.length + 1, serverState.result);
          set({
            autoCompleting: false,
            aiThinking: false,
            deadStones: dead,
            ...snapshot(_game),
            scoreHistory: finalHistory,
          });
          autoSaveGame(get());
        } else {
          set({
            autoCompleting: false,
            aiThinking: false,
            deadStones: [],
            ...snapshot(_game),
            scoreHistory: passHistory,
          });
          autoSaveGame(get());
        }
        return;
      }

      // Single pass — keep going.
      set({ ...snapshot(_game), scoreHistory: passHistory });
      setTimeout(stepOnce, 0);
    };

    setTimeout(stepOnce, 0);
  },

  getBoard: () => get()._game.board,

  dismissRuleViolation: () => set({ ruleViolation: null }),

  dismissBotPassed: () => set({ botJustPassed: false }),

  dismissLessonGameEnd: () => set({ lessonGameEndDismissed: true }),
  reopenLessonGameEnd: () => set({ lessonGameEndDismissed: false }),

  dismissGameEnd: () => set({ gameEndDismissed: true }),
  reopenGameEnd: () => set({ gameEndDismissed: false }),

  replayGame: () => {
    const s = get();
    get().newGame({
      boardSize: s.boardSize,
      targetRank: s.targetRank,
      playerColor: s.playerColor,
      useBackend: !!s.gameId,
      isRanked: s.isRanked,
      gameMode: s.gameMode,
      handicap: s.handicap,
      blackRank: s.blackRank ?? undefined,
      whiteRank: s.whiteRank ?? undefined,
      lessonContext: s.lessonContext,
      playerAvatar: s.playerAvatar,
    });
  },
}));

// Dev convenience: expose gameStore on `window.__gameStore` to mirror
// the shims for autoPlayStore + profileStore. Gated by Vite's DEV flag.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __gameStore: typeof useGameStore }).__gameStore = useGameStore;
}
