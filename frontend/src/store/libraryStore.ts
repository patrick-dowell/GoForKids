import { create } from 'zustand';

export type GameType = 'human-vs-bot' | 'bot-vs-bot';

export interface SavedGame {
  id: string;
  sgf: string;
  date: string;           // ISO string
  playerColor: 'black' | 'white';
  opponentRank: string;
  result: string;          // e.g. "Black wins by 5.5" or "White wins (resignation)"
  moveCount: number;
  isRanked: boolean;
  gameId: string | null;   // Backend game ID for study mode
  gameType?: GameType;     // Undefined for older saves — treated as human-vs-bot
  blackRank?: string;      // For bot-vs-bot, which bot played black
  whiteRank?: string;      // For bot-vs-bot, which bot played white
}

interface LibraryState {
  games: SavedGame[];
  saveGame: (game: SavedGame) => void;
  deleteGame: (id: string) => void;
  clearAll: () => void;
  loadFromStorage: () => void;
}

const STORAGE_KEY = 'goforkids_library';

function persistGames(games: SavedGame[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  } catch (e) {
    console.warn('Failed to save game library:', e);
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  games: [],

  saveGame: (game: SavedGame) => {
    const games = [game, ...get().games].slice(0, 100);
    set({ games });
    persistGames(games);
  },

  deleteGame: (id: string) => {
    const games = get().games.filter((g) => g.id !== id);
    set({ games });
    persistGames(games);
  },

  clearAll: () => {
    set({ games: [] });
    persistGames([]);
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const games = JSON.parse(raw) as SavedGame[];
        set({ games });
      }
    } catch (e) {
      console.warn('Failed to load game library:', e);
    }
  },
}));
