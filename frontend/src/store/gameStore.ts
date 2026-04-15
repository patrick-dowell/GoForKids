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

  const saved: SavedGame = {
    id: state.gameId || `local-${Date.now()}`,
    sgf,
    date: new Date().toISOString(),
    playerColor: state.playerColor === Color.Black ? 'black' : 'white',
    opponentRank: state.targetRank,
    result: isResignation
      ? `${winner} wins (resignation)`
      : `${winner} wins by ${margin.toFixed(1)}`,
    moveCount: state.moveCount,
    isRanked: state.isRanked,
    gameId: state.gameId,
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

export type GameMode = 'ai' | 'botvsbot' | 'local';

// Standard handicap stone positions (row, col)
const HANDICAP_POSITIONS: Record<number, [number, number][]> = {
  2: [[15, 3], [3, 15]],
  3: [[15, 3], [3, 15], [15, 15]],
  4: [[15, 3], [3, 15], [3, 3], [15, 15]],
  5: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 9]],
  6: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15]],
  7: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [9, 9]],
  8: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [3, 9], [15, 9]],
  9: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [3, 9], [15, 9], [9, 9]],
};

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
}

interface GameState {
  grid: GridSnapshot;
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

  // Identify dead stones: compare server board to local board
  // Stones that exist locally but are empty on the server = dead
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const localColor = game.board.grid[r * BOARD_SIZE + c];
      const serverColor = serverState.board[r][c];
      if (localColor !== Color.Empty && serverColor === Color.Empty) {
        deadStones.push({ row: r, col: c, color: localColor as Color });
      }
    }
  }

  // Now sync the board
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      game.board.grid[r * BOARD_SIZE + c] = serverState.board[r][c];
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
  _game: new Game(),
  _botVsBotTimer: null,

  newGame: async (options) => {
    // Clear any running bot-vs-bot timer
    const prevTimer = get()._botVsBotTimer;
    if (prevTimer) clearTimeout(prevTimer);

    const gameMode = options?.gameMode ?? 'ai';
    const handicap = options?.handicap ?? 0;
    const komi = handicap > 0 ? 0.5 : (options?.komi ?? 7.5);
    const game = new Game(komi);
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
    if (handicap >= 2 && HANDICAP_POSITIONS[handicap]) {
      for (const [r, c] of HANDICAP_POSITIONS[handicap]) {
        game.board.grid[r * BOARD_SIZE + c] = Color.Black;
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

    const { result, captures } = _game.playMove(point);
    if (result === MoveResult.Ok) {
      playPlaceSound(point.row, point.col);
      if (captures.length > 0) {
        setTimeout(() => playCaptureSound(captures.length), 100);
      }
      set(snapshot(_game, { lastMove: point, lastCaptures: captures }));

      // Sync with backend and request AI response
      if (gameId && _game.phase === 'playing') {
        api.playMove(gameId, point.row, point.col).catch(console.warn);
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

    if (_game.phase === 'finished') {
      playGameEndSound();
      if (gameId) {
        api.getGame(gameId).then((serverState) => {
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            set({ deadStones: dead, ...snapshot(_game) });
            autoSaveGame(get());
          }
        }).catch((e) => {
          console.warn('Failed to sync scoring:', e);
          set({ deadStones: [], ...snapshot(_game) });
          autoSaveGame(get());
        });
      } else {
        set({ deadStones: [], ...snapshot(_game) });
        autoSaveGame(get());
      }
    } else {
      set(snapshot(_game));
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
      set(snapshot(_game, { lastMove: lastRecord?.point ?? null }));
      api.undo(gameId).then(() => api.undo(gameId!)).catch(console.warn);
      return true;
    }

    // Local game: single undo
    const success = _game.undo();
    if (success) {
      const lastRecord = _game.moveHistory[_game.moveHistory.length - 1];
      set(snapshot(_game, { lastMove: lastRecord?.point ?? null }));
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
        const { result, captures } = _game.playMove(point);
        if (result === MoveResult.Ok) {
          playPlaceSound(point.row, point.col);
          if (captures.length > 0) {
            setTimeout(() => playCaptureSound(captures.length), 100);
          }
          set({
            aiThinking: false,
            ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
          });
          return;
        }
      }

      // AI passed
      _game.pass();
      playPassSound();
      if (_game.phase === 'finished') {
        playGameEndSound();
        try {
          const serverState = await api.getGame(gameId);
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            set({ aiThinking: false, deadStones: dead, ...snapshot(_game) });
            autoSaveGame(get());
            return;
          }
        } catch (e) {
          console.warn('Failed to sync scoring from backend:', e);
        }
        set({ aiThinking: false, deadStones: [], ...snapshot(_game) });
        autoSaveGame(get());
      } else {
        set({ aiThinking: false, ...snapshot(_game) });
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
        const { result, captures } = _game.playMove(point);
        if (result === MoveResult.Ok) {
          playPlaceSound(point.row, point.col);
          if (captures.length > 0) {
            setTimeout(() => playCaptureSound(captures.length), 100);
          }
          set({
            aiThinking: false,
            ...snapshot(_game, { lastMove: point, lastCaptures: captures }),
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
      if (_game.phase === 'finished') {
        playGameEndSound();
        try {
          const serverState = await api.getGame(gameId);
          if (serverState.result) {
            const dead = syncServerScoring(_game, serverState);
            set({ aiThinking: false, deadStones: dead, ...snapshot(_game) });
            autoSaveGame(get());
            return;
          }
        } catch (e) {
          console.warn('Failed to sync scoring:', e);
        }
        set({ aiThinking: false, deadStones: [], ...snapshot(_game) });
        autoSaveGame(get());
      } else {
        set({ aiThinking: false, ...snapshot(_game) });
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
