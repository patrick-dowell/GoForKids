/**
 * The log-out confirm's words (feature 32). Log out saves everything online
 * first — except replays the server refused (413 / 422), which can't be
 * saved and are removed with the rest. The confirm has to say so when there
 * are any, so it never promises a game it is about to delete.
 */

/** Games in the library the server refused, i.e. ones log out will lose. */
export function unsavedGameCount(refusedGameIds: ReadonlyArray<string>, libraryIds: ReadonlyArray<string>): number {
  const refused = new Set(refusedGameIds);
  return libraryIds.filter((id) => refused.has(id)).length;
}

export function logOutConfirmText(unsavedGames: number): string {
  const back =
    "To get them back here you'll need a code from another device where you're logged in. " +
    "If this is your only device, you won't be able to get them back.";
  if (unsavedGames <= 0) {
    return (
      'Log out of this device? Your rank, lessons, games, avatar and name will be saved online, ' +
      `then removed from this device. ${back}`
    );
  }
  const lost =
    unsavedGames === 1
      ? "One of your games couldn't be saved online, so it will be removed for good."
      : `${unsavedGames} of your games couldn't be saved online, so they will be removed for good.`;
  return (
    'Log out of this device? Your rank, lessons, other games, avatar and name will be saved online, ' +
    `then removed from this device. ${lost} ${back}`
  );
}
