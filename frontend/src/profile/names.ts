/**
 * Generated player names (feature 32, revision 2). There is no free-text
 * name anywhere: a name is two list positions, `handle = [a, n]`, rendered
 * as `ADJECTIVES[a] + " " + NOUNS[n]`. Only the positions are stored and
 * synced, so nothing a player types reaches the server.
 *
 * The lists are APPEND-ONLY: a position never changes its word, or every
 * stored handle would silently rename its player.
 *
 * Names are unique across profiles (revision 6), and the server is what
 * enforces it: a name is still drawn here at random, and one another profile
 * holds is refused with a 409 `handle_taken`, after which sync draws again
 * (syncStore.ts). There are 64 × 64 = 4,096 names.
 */

export const ADJECTIVES: readonly string[] = [
  'Cosmic', 'Quiet', 'Bright', 'Swift', 'Gentle', 'Clever', 'Brave', 'Sunny', 'Lucky',
  'Mighty', 'Curious', 'Golden', 'Silver', 'Starry', 'Lunar', 'Solar', 'Misty', 'Frosty',
  'Breezy', 'Glowing', 'Sparkling', 'Shining', 'Twinkling', 'Floating', 'Drifting',
  'Soaring', 'Orbiting', 'Spinning', 'Dancing', 'Humming', 'Patient', 'Steady', 'Calm',
  'Kind', 'Jolly', 'Merry', 'Nimble', 'Bold', 'Daring', 'Sturdy', 'Wandering', 'Roaming',
  'Dreamy', 'Wise', 'Speedy', 'Mellow', 'Peppy', 'Zippy', 'Fuzzy', 'Velvet', 'Crystal',
  'Amber', 'Emerald', 'Sapphire', 'Ruby', 'Coral', 'Indigo', 'Violet', 'Scarlet', 'Copper',
  'Radiant', 'Electric', 'Stellar', 'Astral',
];

export const NOUNS: readonly string[] = [
  'Otter', 'Comet', 'Panda', 'Falcon', 'Fox', 'Owl', 'Turtle', 'Dolphin', 'Tiger', 'Koala',
  'Heron', 'Badger', 'Lynx', 'Raven', 'Sparrow', 'Penguin', 'Gecko', 'Dragon', 'Phoenix',
  'Griffin', 'Meteor', 'Nebula', 'Galaxy', 'Planet', 'Rocket', 'Satellite', 'Asteroid',
  'Quasar', 'Pulsar', 'Nova', 'Moon', 'Star', 'Orbit', 'Voyager', 'Explorer', 'Pilot',
  'Ranger', 'Captain', 'Wizard', 'Knight', 'Summit', 'Harbor', 'Mountain', 'River',
  'Forest', 'Meadow', 'Canyon', 'Glacier', 'Volcano', 'Thunder', 'Breeze', 'Tide',
  'Beacon', 'Spark', 'Lantern', 'Compass', 'Kite', 'Acorn', 'Maple', 'Willow', 'Lotus',
  'Bamboo', 'Crane', 'Whale',
];

/** Positions into ADJECTIVES and NOUNS. */
export type Handle = [number, number];

function isPosition(v: unknown, list: readonly string[]): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < list.length;
}

/** True for a two-integer array that points into both lists. */
export function isHandle(v: unknown): v is Handle {
  return Array.isArray(v) && v.length === 2 && isPosition(v[0], ADJECTIVES) && isPosition(v[1], NOUNS);
}

/** "Cosmic Otter". Empty string when there is no name yet. */
export function renderName(handle: Handle | null | undefined): string {
  return isHandle(handle) ? `${ADJECTIVES[handle[0]]} ${NOUNS[handle[1]]}` : '';
}

/** Two uniform random positions. Pass `avoid` to guarantee a different
 *  name (Shuffle should always change something, and a draw after the
 *  server refused a name as taken never draws that name again). */
export function randomHandle(avoid?: Handle | null, rand: () => number = Math.random): Handle {
  for (;;) {
    const h: Handle = [Math.floor(rand() * ADJECTIVES.length), Math.floor(rand() * NOUNS.length)];
    if (!avoid || h[0] !== avoid[0] || h[1] !== avoid[1]) return h;
  }
}
