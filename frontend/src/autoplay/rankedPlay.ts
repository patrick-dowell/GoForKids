/**
 * The ranked Play button's wiring (feature 32), kept out of the component so
 * it can be tested without a DOM.
 *
 * Logged in: pull before the game, bounded at 2 s, re-read the matchup (the
 * pull may have moved the rung), then start whatever the pull's outcome.
 * From the moment the game starts until it ends, a pass still running holds
 * anything that would move the rank (see `beginRankedGame`).
 *
 * Not logged in (a profile still being created): start at once — creating
 * never blocks play — and nudge the create to retry.
 */

import { gameMatchup, type Matchup } from './matchmaker';
import { useAutoPlayStore } from '../store/autoPlayStore';
import {
  beginRankedGame,
  endRankedGame,
  isLoggedIn,
  requestSync,
  syncBeforePlay,
} from '../store/syncStore';

/** The matchup the picker shows for the next game, from the store as it is
 *  now. */
export function currentMatchup(): Matchup {
  const s = useAutoPlayStore.getState();
  const gamesAtRung = s.history.filter((h) => h.rung === s.rungState.currentRung).length;
  return gameMatchup(s.rungState.currentRung, s.rungState.lossStreak, gamesAtRung, s.boardSize);
}

export interface RankedPlayHooks {
  /** Start the game (App's handler). */
  start: (matchup: Matchup) => void;
  /** False once the player has left the picker while waiting: don't start. */
  stillHere?: () => boolean;
}

/**
 * Press Play. Resolves true when the game was started. When not logged in
 * the game starts synchronously, before this returns its promise.
 */
export async function playRanked(hooks: RankedPlayHooks): Promise<boolean> {
  // Anything held from an earlier game that ended without a result lands now,
  // before this game's matchup is read.
  endRankedGame();
  if (!isLoggedIn()) {
    void requestSync();
    return launch(hooks);
  }
  await syncBeforePlay();
  if (hooks.stillHere && !hooks.stillHere()) return false;
  return launch(hooks);
}

function launch(hooks: RankedPlayHooks): boolean {
  const matchup = currentMatchup();
  if (!matchup.validated) return false;
  beginRankedGame();
  hooks.start(matchup);
  return true;
}
