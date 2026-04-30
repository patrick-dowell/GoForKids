import { create } from 'zustand';
import { Game, type GamePhase } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, type Point, type GameResult, MoveResult, BOARD_SIZE } from '../engine/types';
import { api } from '../api/client';
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
  /** Set to true the moment the AI passes mid-game. UI watches this to surface
   *  a "what just happened" modal so newcomers don't think the game silently
   *  ended. Cleared by either the user passing back or dismissing. */
  botJustPassed: boolean;
  /** When true, the lesson 5 game-end modal is hidden (collapsed to the right
   *  side panel). Player can re-open it from the panel. */
  lessonGameEndDismissed: boolean;
  deadStones: { row: number; col: number; color: Color }[];  // Stones marked dead at scoring
  /** True while the backend is computing the final score with dead-stone
   *  detection (~5-10 s). UI shows a "Calculating final score…" modal and
   *  hides the placeholder score until the real values arrive. */
  scoringInProgress: boolean;
  scoreHistory: ScorePoint[];  // Live score per move (for the score graph)
  /** Stones merged by the most recent move (or empty). Renderer reads this
   *  to fire a connection pulse, then it gets cleared on the next move. */
  lastMerged: { color: Color; stones: Point[] };

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
  autoComplete: () => Promise<void>;
  getBoard: () => Board;
  /** Dismiss the bot-passed modal without taking action (player keeps playing). */
  dismissBotPassed: () => void;
  /** Restart the current game with the same config (used by the lesson 5
   *  game-end modal's Play Again button). */
  replayGame: () => void;
  /** Collapse the lesson game-end modal so the player can see the board. */
  dismissLessonGameEnd: () => void;
  /** Re-open the lesson game-end modal from the side-panel re-open button. */
  reopenLessonGameEnd: () => void;
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
  botJustPassed: false,
  lessonGameEndDismissed: false,
  deadStones: [],
  scoringInProgress: false,
  scoreHistory: [{ move: 0, lead: 0 }],
  lastMerged: { color: Color.Empty, stones: [] },
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
      lessonContext: !!options?.lessonContext,
      botJustPassed: false,
      lessonGameEndDismissed: false,
      deadStones: [],
      scoringInProgress: false,
      scoreHistory: [{ move: 0, lead: currentLead(game) }],
      lastMerged: { color: Color.Empty, stones: [] },
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
    if (result === MoveResult.Ok) {
      playPlaceSound(point.row, point.col);
      if (captures.length > 0) {
        setTimeout(() => playCaptureSound(captures.length), 100);
      }
      // Optimistic snapshot. For local-only games we also push a local score
      // estimate; for backend games we'll replace that with KataGo's estimate
      // once the server response arrives.
      const localScored = !gameId;
      set({
        ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
        ...(localScored ? { scoreHistory: appendScorePoint(get().scoreHistory, _game) } : {}),
        lastMerged: merged.length > 0
          ? { color: currentColor, stones: [...merged, point] }
          : { color: Color.Empty, stones: [] },
        // Player chose to keep playing — clear any leftover bot-passed flag.
        botJustPassed: false,
      });

      // Sync with backend, then request AI response. The two calls MUST be
      // sequenced — firing them in parallel races the backend's persistence
      // layer (the AI handler can read the game from disk before /move has
      // saved the user's stone, and end up analyzing an empty board).
      if (gameId && _game.phase === 'playing') {
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
          .catch(console.warn);
      }
    }
    return result;
  },

  pass: () => {
    const { _game, gameId, aiThinking } = get();
    if (aiThinking) return;

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
      set({ ...snapshot(_game), scoreHistory: passHistory });
      // Sequence the pass + AI response the same way as playMove — firing
      // /pass and /ai-move in parallel races the backend's persistence,
      // letting the AI analyze the pre-pass game state.
      if (gameId) {
        api.pass(gameId)
          .then(() => {
            if (_game.phase === 'playing') {
              setTimeout(() => get().requestAIMove(), 400);
            }
          })
          .catch(console.warn);
      } else if (_game.phase === 'playing') {
        setTimeout(() => get().requestAIMove(), 400);
      }
    }
  },

  resign: () => {
    const { _game, gameId } = get();
    _game.resign();
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
    const { gameId, _game, phase } = get();
    if (!gameId || phase !== 'playing') return;

    set({ aiThinking: true });

    try {
      const aiMove = await api.getAIMove(gameId);
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
    const { gameId, _game, phase, botVsBotPaused, botVsBotSpeed } = get();
    if (!gameId || phase !== 'playing' || botVsBotPaused) return;

    set({ aiThinking: true });

    try {
      const aiMove = await api.getAIMove(gameId);
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
        try {
          const serverState = await api.getGame(gameId);
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            const finalHistory = appendFinalScore(bvbPassHistory, _game.moveHistory.length + 1, serverState.result);
            set({ aiThinking: false, deadStones: dead, ...snapshot(_game), scoreHistory: finalHistory });
            autoSaveGame(get());
            return;
          }
        } catch (e) {
          console.warn('Failed to sync scoring:', e);
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

  autoComplete: async () => {
    const { gameId, _game, phase } = get();
    if (!gameId || phase !== 'playing') return;

    set({ autoCompleting: true, aiThinking: true });

    try {
      const serverState = await api.autoComplete(gameId);
      const dead = syncServerScoring(_game, serverState);

      playGameEndSound();
      set({ autoCompleting: false, aiThinking: false, deadStones: dead, ...snapshot(_game) });
      // Use server's SGF which includes all auto-complete moves
      autoSaveGame(get(), serverState.sgf ?? undefined);
    } catch (e) {
      console.warn('Auto-complete failed:', e);
      set({ autoCompleting: false, aiThinking: false });
    }
  },

  getBoard: () => get()._game.board,

  dismissBotPassed: () => set({ botJustPassed: false }),

  dismissLessonGameEnd: () => set({ lessonGameEndDismissed: true }),
  reopenLessonGameEnd: () => set({ lessonGameEndDismissed: false }),

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
