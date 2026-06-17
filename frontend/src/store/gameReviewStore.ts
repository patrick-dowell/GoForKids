import { create } from 'zustand';

/**
 * Visibility toggle for the post-game "Play of the Game" review overlay
 * (fp 28). The overlay itself reads the finished game from gameStore when it
 * opens, so this store only tracks open/closed — mirrors glossaryStore.
 */
interface GameReviewState {
  isOpen: boolean;
  /** QA/demo mode (?review=demo): build from a fixture game, not gameStore. */
  demo: boolean;
  open: () => void;
  openDemo: () => void;
  close: () => void;
}

export const useGameReviewStore = create<GameReviewState>((set) => ({
  isOpen: false,
  demo: false,
  open: () => set({ isOpen: true, demo: false }),
  openDemo: () => set({ isOpen: true, demo: true }),
  close: () => set({ isOpen: false, demo: false }),
}));
