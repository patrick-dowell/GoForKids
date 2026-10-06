/** The sentence a tap on the locked "Bot plays online" row shows. */
export const CLOUD_LOCKED_NOTE = 'The bot always plays online here.';

/** Under a bot-setting row while a game is played, when a change waits for
 *  the next game (a game keeps the bots it started with). */
export const NEXT_GAME_NOTE = 'Takes effect from your next game.';

/** A tap on the "Bot plays online" row. Locked (the web, or a device whose
 *  engine is too slow), it stores nothing and shows the note; otherwise it
 *  stores the person's choice. */
export function tapCloudBotRow(
  locked: boolean,
  checked: boolean,
  act: { setCloudBot: (v: boolean) => void; showNote: () => void },
): void {
  if (locked) act.showNote();
  else act.setCloudBot(checked);
}
