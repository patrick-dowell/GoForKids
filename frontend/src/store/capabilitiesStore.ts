import { create } from 'zustand';
import type { KataGoBridge } from '../api/nativeKataGo';
import { useSettingsStore } from './settingsStore';

/**
 * What the native shell reports about this device's engine, read once at
 * app start from `window.kataGo.capabilities()`.
 *
 * It describes the device, not the routing, so it is read from the injected
 * bridge directly (not through getKataGoBridge(), which hides the bridge
 * while "Bot plays online" is on). `capabilities` stays null on the web, on a
 * native build without the call, when the call fails, and until it answers:
 * every reader then sees no human model, and the app plays as it always has.
 *
 * It also decides where the bots play (botsPlayOnline below): the web, and a
 * device whose answer says `localBots: false`, play only the online bots.
 */
export type DeviceCapabilities = Awaited<ReturnType<NonNullable<KataGoBridge['capabilities']>>>;

interface CapabilitiesState {
  capabilities: DeviceCapabilities | null;
  /** The start-up read is over: the bridge answered, failed, lacks the call,
   *  or the wait for it ran out. */
  settled: boolean;
  /** The wait ran out before the answer (whenBotRoutingKnown): this launch's
   *  bots play on the device as before, whatever answers later, so a game
   *  already on the device is never moved mid-game. */
  gaveUp: boolean;
}

export const useCapabilitiesStore = create<CapabilitiesState>(() => ({
  capabilities: null,
  settled: false,
  gaveUp: false,
}));

function injectedBridge(): KataGoBridge | undefined {
  return typeof window !== 'undefined' ? window.kataGo : undefined;
}

let reading: Promise<void> | null = null;

/** Ask the bridge once; later calls return the first call's promise. */
export function readDeviceCapabilities(): Promise<void> {
  if (!reading) {
    reading = (async () => {
      try {
        const bridge = injectedBridge();
        if (!bridge || typeof bridge.capabilities !== 'function') return;
        try {
          const caps = await bridge.capabilities();
          useCapabilitiesStore.setState({ capabilities: caps ?? null });
        } catch (e) {
          console.warn('[capabilities] the bridge could not report them:', e);
        }
      } finally {
        useCapabilitiesStore.setState({ settled: true });
      }
    })();
  }
  return reading;
}

/** The bridge reported the human SL model loaded. */
export function hasHumanModel(): boolean {
  return useCapabilitiesStore.getState().capabilities?.humanModel === true;
}

/** Only an explicit `localBots: false` locks a device; a bridge without the
 *  call, a failed call, a malformed answer, or a wait that ran out keep its
 *  bots on the device. */
function onlineOnly(s: CapabilitiesState): boolean {
  if (!injectedBridge()) return true;
  return !s.gaveUp && s.capabilities?.localBots === false;
}

/** This device plays only the online bots: the web, or the native shell said
 *  its engine is too slow. The stored "Bot plays online" choice is left as
 *  the person set it; it applies again on a device that may play its own. */
export function onlineBotsOnly(): boolean {
  return onlineOnly(useCapabilitiesStore.getState());
}

export function useOnlineBotsOnly(): boolean {
  return useCapabilitiesStore(onlineOnly);
}

/** The effective "Bot plays online": the device's lock, or the stored choice. */
export function botsPlayOnline(): boolean {
  return onlineBotsOnly() || useSettingsStore.getState().cloudBot;
}

export function useBotsPlayOnline(): boolean {
  const locked = useOnlineBotsOnly();
  const chosen = useSettingsStore((s) => s.cloudBot);
  return locked || chosen;
}

/** Whether the bots' home is known yet: no bridge, or the read is over. */
export function botRoutingKnown(): boolean {
  return !injectedBridge() || useCapabilitiesStore.getState().settled;
}

/** How long a bot move or engine call asked before the answer waits for it.
 *  Generous because the native shell answers only after starting its engine
 *  and timing a search, slowest on exactly the devices it would lock. */
export const BOT_ROUTING_WAIT_MS = 10_000;

let waiting: Promise<void> | null = null;

/** Resolves once botRoutingKnown(): at once when it is, else when the answer
 *  arrives, or after BOT_ROUTING_WAIT_MS, when this launch gives up and plays
 *  on the device as before. Every waiter shares the one bound. */
export function whenBotRoutingKnown(): Promise<void> {
  if (botRoutingKnown()) return Promise.resolve();
  if (!waiting) {
    waiting = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[capabilities] no answer in ${BOT_ROUTING_WAIT_MS}ms: this launch plays the device's bots`);
        useCapabilitiesStore.setState({ settled: true, gaveUp: true });
        resolve();
      }, BOT_ROUTING_WAIT_MS);
      void readDeviceCapabilities().then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return waiting;
}

/** Tests only: forget the answer so the next read asks again. */
export function _resetDeviceCapabilities(): void {
  reading = null;
  waiting = null;
  useCapabilitiesStore.setState({ capabilities: null, settled: false, gaveUp: false });
}
