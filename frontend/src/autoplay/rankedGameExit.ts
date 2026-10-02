/**
 * Ends the sync hold (feature 32) however a ranked game stops being played:
 * it finishes, another game replaces it (New Game, a lesson game), or a
 * replay takes the screen (Library). Home ends it too, through App's goHome;
 * a recorded result ends it first thing in `recordResult`.
 *
 * Without this a ranked game left through New Game or Library kept the hold
 * on, and every pass after it held instead of syncing until Home or the next
 * ranked Play.
 */

import { useGameStore } from '../store/gameStore';
import { useReplayStore } from '../store/replayStore';
import { endRankedGame, noteRankedGameOnBoard } from '../store/syncStore';

/** Start watching. Returns a function that stops. */
export function watchRankedGameExit(): () => void {
  const stopGame = useGameStore.subscribe((s, prev) => {
    if (s.autoplayContext === prev.autoplayContext && s.phase === prev.phase && s.gameId === prev.gameId) return;
    noteRankedGameOnBoard(s.autoplayContext && s.phase === 'playing');
  });
  const stopReplay = useReplayStore.subscribe((s, prev) => {
    if (s.active && !prev.active) endRankedGame();
  });
  return () => {
    stopGame();
    stopReplay();
  };
}
