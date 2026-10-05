import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { serverAnswers } from '../api/client';
import { botsPlayOnline, useCapabilitiesStore } from './capabilitiesStore';
import { useSettingsStore } from './settingsStore';

/**
 * Whether the online bots can be reached, for the screens that start a game
 * against them (ranked Play, Custom Match's bot modes, a lesson's game).
 *
 * It matters only while the bots play online (capabilitiesStore
 * botsPlayOnline): the web, a device too slow for its own bots, or the
 * setting. A device that plays its own bots never asks and is never greyed.
 * The server's `GET /health` is asked at cold start (and again when the
 * bots turn online after it: the device's late answer, or the setting),
 * when the home screen appears, when the app comes back to the foreground,
 * and on a tap of "Try again". Until the first answer nothing is greyed: a
 * game asked for meanwhile meets an unreachable server at its own start,
 * and says so there (gameStore botTrouble 'start').
 */

/** How long one check waits for an answer. The route does no work, so a
 *  server that is up answers well inside it; it bounds the wait after a tap
 *  of "Try again" when it is not. */
export const HEALTH_TIMEOUT_MS = 5_000;

export type Reach = 'unknown' | 'up' | 'down';

interface ServerReachState {
  /** The last check's answer; 'unknown' before the first. */
  reach: Reach;
  /** A check is waiting for its answer. */
  checking: boolean;
}

export const useServerReachStore = create<ServerReachState>(() => ({
  reach: 'unknown',
  checking: false,
}));

let inFlight: Promise<void> | null = null;

/** Ask the server now. Calls made while a check waits share it. */
export function checkServer(): Promise<void> {
  if (!inFlight) {
    useServerReachStore.setState({ checking: true });
    inFlight = serverAnswers(HEALTH_TIMEOUT_MS).then((ok) => {
      inFlight = null;
      useServerReachStore.setState({ reach: ok ? 'up' : 'down', checking: false });
    });
  }
  return inFlight;
}

/** Ask the server, if the bots play online here. */
export function checkServerIfNeeded(): Promise<void> {
  return botsPlayOnline() ? checkServer() : Promise.resolve();
}

/** The bots here play online, and the server did not answer the last check. */
export function cloudBotsOut(): boolean {
  return botsPlayOnline() && useServerReachStore.getState().reach === 'down';
}

/** The cold-start check, and the ones that follow it: the foreground, and
 *  the bots turning online. Returns a function that stops watching. */
export function watchServer(): () => void {
  void checkServerIfNeeded();
  const doc = typeof document !== 'undefined' ? document : undefined;
  const onVisible = () => {
    if (doc?.visibilityState === 'visible') void checkServerIfNeeded();
  };
  doc?.addEventListener('visibilitychange', onVisible);
  let online = botsPlayOnline();
  const onRouting = () => {
    const now = botsPlayOnline();
    if (now && !online) void checkServer();
    online = now;
  };
  const stops = [useCapabilitiesStore.subscribe(onRouting), useSettingsStore.subscribe(onRouting)];
  return () => {
    doc?.removeEventListener('visibilitychange', onVisible);
    stops.forEach((stop) => stop());
  };
}

/** What the hooks below read changes with the reach and with the setting;
 *  a capabilities answer that turns the bots online starts a check, which
 *  changes the reach. */
function subscribe(onChange: () => void): () => void {
  const stops = [useServerReachStore.subscribe(onChange), useSettingsStore.subscribe(onChange)];
  return () => stops.forEach((stop) => stop());
}

const isChecking = () => useServerReachStore.getState().checking;

// Server rendering (the tests) reads the live values, as the client does.

/** cloudBotsOut, for components. */
export function useCloudBotsOut(): boolean {
  return useSyncExternalStore(subscribe, cloudBotsOut, cloudBotsOut);
}

/** A check is waiting for its answer, for components. */
export function useServerChecking(): boolean {
  return useSyncExternalStore(subscribe, isChecking, isChecking);
}
