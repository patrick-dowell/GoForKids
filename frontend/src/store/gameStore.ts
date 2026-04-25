import { create } from 'zustand';
import { Game, type GamePhase } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, type Point, type MoveRecord, type GameResult, MoveResult, BOARD_SIZE } from '../engine/types';
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
    blackRank: isBotVsBot ? state.blackRank : undefined,
    whiteRank: isBotVsBot ? state.whiteRank : undefined,
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
  deadStones: { row: number; col: number; color: Color }[];  // Stones marked dead at scoring
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
  deadStones: [],
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
    const boardSize = [9, 13, 19].includes(requestedSize) ? requestedSize : BOARD_SIZE;
    const maxHandicap = MAX_HANDICAP_BY_SIZE[boardSize] ?? 0;
    const handicap = Math.max(0, Math.min(maxHandicap, options?.handicap ?? 0));
    // Smaller boards traditionally use 7 komi (Japanese); 19x19 uses 7.5.
    const defaultKomi = boardSize === 19 ? 7.5 : 7;
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
          black_rank: blackRank,
          white_rank: whiteRank,
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
      deadStones: [],
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
      });

      // Sync with backend and request AI response
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
          })
          .catch(console.warn);
        // Small delay so the player sees their stone land before AI responds
        setTimeout(() => get().requestAIMove(), 400);
      }
    }
    return result;
  },

  pass: () => {
    const { _game, gameId, aiThinking } = get();
    if (aiThinking) return;

    _game.pass();
    playPassSound();

    if (gameId) {
      api.pass(gameId).catch(console.warn);
    }

    const passHistory = appendScorePoint(get().scoreHistory, _game);
    if (_game.phase === 'finished') {
      playGameEndSound();
      if (gameId) {
        api.getGame(gameId).then((serverState) => {
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            set({ deadStones: dead, ...snapshot(_game), scoreHistory: passHistory });
            autoSaveGame(get());
          }
        }).catch((e) => {
          console.warn('Failed to sync scoring:', e);
          set({ deadStones: [], ...snapshot(_game), scoreHistory: passHistory });
          autoSaveGame(get());
        });
      } else {
        set({ deadStones: [], ...snapshot(_game), scoreHistory: passHistory });
        autoSaveGame(get());
      }
    } else {
      set({ ...snapshot(_game), scoreHistory: passHistory });
      if (gameId && _game.phase === 'playing') {
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

      // AI passed
      _game.pass();
      playPassSound();
      const aiPassHistory = appendScorePoint(get().scoreHistory, _game);
      if (_game.phase === 'finished') {
        playGameEndSound();
        try {
          const serverState = await api.getGame(gameId);
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            set({ aiThinking: false, deadStones: dead, ...snapshot(_game), scoreHistory: aiPassHistory });
            autoSaveGame(get());
            return;
          }
        } catch (e) {
          console.warn('Failed to sync scoring from backend:', e);
        }
        set({ aiThinking: false, deadStones: [], ...snapshot(_game), scoreHistory: aiPassHistory });
        autoSaveGame(get());
      } else {
        set({ aiThinking: false, ...snapshot(_game), scoreHistory: aiPassHistory });
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

      // Bot passed
      _game.pass();
      playPassSound();
      const bvbPassHistory = appendScorePoint(get().scoreHistory, _game);
      if (_game.phase === 'finished') {
        playGameEndSound();
        try {
          const serverState = await api.getGame(gameId);
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            set({ aiThinking: false, deadStones: dead, ...snapshot(_game), scoreHistory: bvbPassHistory });
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
}));
