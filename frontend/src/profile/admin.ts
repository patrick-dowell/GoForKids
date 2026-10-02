/**
 * The Admin section's rules (feature 32, revision 3), kept free of React and
 * of the stores so each one is tested on its own: the code expiry a grown-up
 * may pick, how a profile's ranks read, which buttons a row offers, and the
 * state document a new player starts with.
 */

import type { AdminBoard, AdminDevice, AdminPlayer, SyncStateDoc } from '../api/sync';
import { resolveRung, startingRung, type BoardSize } from '../autoplay/matchmaker';
import type { Handle } from './names';

/* ------------------------------------------------------------------------- *
 * Code expiry.
 * ------------------------------------------------------------------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Nothing later than this far ahead is offered (the server allows a minute
 *  more, for clock skew). */
export const CODE_MAX_AHEAD_MS = 24 * HOUR;

/** The picker's steps after the default: every half hour on the clock. */
export const CODE_STEP_MS = 30 * MINUTE;

/** A step closer than this to now is left out (it would lapse while the
 *  code is read out). The default is always offered. */
export const CODE_MIN_AHEAD_MS = 5 * MINUTE;

/** 4:30 pm today in this device's time zone when that is still ahead,
 *  otherwise one hour from now. */
export function defaultCodeExpiry(now: Date): Date {
  const halfPastFour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 30, 0, 0);
  return halfPastFour.getTime() > now.getTime() ? halfPastFour : new Date(now.getTime() + HOUR);
}

/** True for an expiry an admin may set: after now, and at most 24 hours
 *  ahead. */
export function isAllowedCodeExpiry(at: Date, now: Date): boolean {
  const ahead = at.getTime() - now.getTime();
  return ahead > 0 && ahead <= CODE_MAX_AHEAD_MS;
}

/** The times offered, earliest first: the default, and each half hour on
 *  the clock from a few minutes ahead up to 24 hours ahead. */
export function codeExpiryOptions(now: Date): Date[] {
  const byTime = new Map<number, Date>();
  const def = defaultCodeExpiry(now);
  byTime.set(def.getTime(), def);
  const step = new Date(now.getTime());
  step.setSeconds(0, 0);
  step.setMinutes(now.getMinutes() < 30 ? 30 : 60);
  for (let t = step; isAllowedCodeExpiry(t, now); t = new Date(t.getTime() + CODE_STEP_MS)) {
    if (t.getTime() - now.getTime() >= CODE_MIN_AHEAD_MS) byTime.set(t.getTime(), t);
  }
  return [...byTime.values()].sort((a, b) => a.getTime() - b.getTime());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "4:30 PM today", "9:00 AM tomorrow". */
export function expiryLabel(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay(at, now)) return `${time} today`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(at, tomorrow)) return `${time} tomorrow`;
  return `${time}, ${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

/* ------------------------------------------------------------------------- *
 * A profile's row.
 * ------------------------------------------------------------------------- */

export interface BoardRank {
  /** "9×9", as the Profile page heads its rank card. */
  board: string;
  /** The rank as the Profile page would show it for this profile. */
  rank: string;
  games: number;
}

function startOf(size: number): string | null {
  try {
    return startingRung(size as BoardSize);
  } catch {
    return null;
  }
}

/** Each board's rank, smallest board first, read the way the Profile page
 *  reads it: a rung from an older ladder moves to its nearest current rung,
 *  and a board with no rung shows the board's starting rung. */
export function boardRanks(boards: Record<string, AdminBoard> | null | undefined): BoardRank[] {
  if (!boards) return [];
  return Object.entries(boards)
    .map(([key, b]) => {
      const size = parseInt(key, 10);
      const stored = b?.rung;
      const rank = stored ? resolveRung(stored, size as BoardSize) : (startOf(size) ?? '—');
      const games = b && typeof b.games === 'number' ? b.games : 0;
      return { size, board: Number.isNaN(size) ? key : `${size}×${size}`, rank, games };
    })
    .sort((a, b) => a.size - b.size)
    .map(({ board, rank, games }) => ({ board, rank, games }));
}

/** "1 day left", "12 days left" (the server sends whole days, never below 0). */
export function daysLeftText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

/** Who this device is: its profile and its own device id (from GET /state). */
export interface SelfIds {
  playerId: string | null;
  deviceId: string | null;
}

/** This device's own row in the list. */
export function isThisDevice(device: AdminDevice, self: SelfIds): boolean {
  return device.device_id === self.deviceId;
}

/** The profile this device is logged into. */
export function isOwnProfile(player: AdminPlayer, self: SelfIds): boolean {
  return player.player_id === self.playerId || player.devices.some((d) => isThisDevice(d, self));
}

/** "Remove" sits beside every device but this one. */
export function canRemoveDevice(device: AdminDevice, self: SelfIds): boolean {
  return !isThisDevice(device, self);
}

/** "Sign out this player's devices" is offered for a profile with a device
 *  to sign out, and never for this device's own profile. */
export function canSignOutPlayer(player: AdminPlayer, self: SelfIds): boolean {
  return player.devices.length > 0 && !isOwnProfile(player, self);
}

/* ------------------------------------------------------------------------- *
 * New player.
 * ------------------------------------------------------------------------- */

/** The state a profile made by an admin starts with: no rank yet, no
 *  lessons, the default avatar, and the generated name. */
export function freshPlayerState(handle: Handle): SyncStateDoc {
  return {
    schema: 1,
    ladder: { byBoardSize: {} },
    lessons: [],
    avatar: 'blackhole',
    avatarPicked: false,
    handle: [handle[0], handle[1]],
  };
}


// ── The device lines ─────────────────────────────────────────────────

function timeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayOf(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** "today at 3:05 PM", "Sep 30 at 9:12 AM". */
function whenText(iso: string, now: Date): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return `today at ${timeOfDay(d)}`;
  return `${dayOf(d)} at ${timeOfDay(d)}`;
}

/** "iPad · added Oct 2 · last used today at 3:05 PM". A row with no
 *  last-seen stamp that predates the server's stamping was in use before it
 *  ("last used before Oct 2"); one made since then simply hasn't been used.
 *  `now` is for tests. */
export function deviceLineText(
  d: AdminDevice,
  lastSeenSince: string | null,
  now: Date = new Date(),
): string {
  const what = d.kind === 'web' ? 'Browser' : (d.kind ?? 'Device');
  let used: string;
  if (d.last_seen_at) used = `last used ${whenText(d.last_seen_at, now)}`;
  else if (lastSeenSince && d.created_at < lastSeenSince) {
    used = `last used before ${dayOf(new Date(lastSeenSince))}`;
  } else used = 'not used yet';
  return `${what} · added ${dayOf(new Date(d.created_at))} · ${used}`;
}

/** "Installed on 2 devices". */
export function installedOnText(count: number): string {
  return `Installed on ${count} ${count === 1 ? 'device' : 'devices'}`;
}
