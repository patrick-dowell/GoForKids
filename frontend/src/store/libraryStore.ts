import { create } from 'zustand';
import type { ScorePoint } from '../learn/gameReview';

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
  /** Per-move KataGo score lead, for the replay's Play-of-the-Game highlights.
   *  Undefined for older saves or games played without scoring (stub AI). */
  scoreHistory?: ScorePoint[];
  /** Dead stones from the live game's end-of-game scoring, so the replay can
   *  reproduce the same accurate territory instead of re-detecting them (the
   *  replay's heuristic / Render call can't reach the on-device engine).
   *  Undefined for older saves and games that ended by resignation. */
  deadStones?: Array<{ row: number; col: number; color: number }>;
  /** Bot-selector diagnostic lines from this game (pass reasons, superko
   *  fallbacks — see ai/selectorLog.ts). Rides the upload payload so a field
   *  repro of a bad bot pass carries its own diagnosis. */
  selectorLog?: string[];
  /** Share code from a previous upload of this game, so re-sharing shows the
   *  existing code instead of storing a duplicate. */
  sharedId?: string;
}

interface LibraryState {
  games: SavedGame[];
  saveGame: (game: SavedGame) => void;
  deleteGame: (id: string) => void;
  /** Stamp (or clear, with undefined) a game's share code after upload —
   *  cleared when the server no longer has the code so Share reappears. */
  setSharedId: (id: string, sharedId: string | undefined) => void;
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

  setSharedId: (id: string, sharedId: string | undefined) => {
    const games = get().games.map((g) => (g.id === id ? { ...g, sharedId } : g));
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
