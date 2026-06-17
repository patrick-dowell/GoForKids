import { create } from 'zustand';

/**
 * Visibility toggle for the post-game "Play of the Game" review overlay
 * (fp 28). The overlay itself reads the finished game from gameStore when it
 * opens, so this store only tracks open/closed — mirrors glossaryStore.
 */
interface GameReviewState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useGameReviewStore = create<GameReviewState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
