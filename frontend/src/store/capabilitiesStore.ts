import { create } from 'zustand';
import type { KataGoBridge } from '../api/nativeKataGo';

/**
 * What the native shell reports about this device's engine, read once at
 * app start from `window.kataGo.capabilities()`.
 *
 * It describes the device, not the routing, so it is read from the injected
 * bridge directly (not through getKataGoBridge(), which hides the bridge
 * while "Bot plays online" is on). `capabilities` stays null on the web, on a
 * native build without the call, when the call fails, and until it answers:
 * every reader then sees no human model, and the app plays as it always has.
 */
export type DeviceCapabilities = Awaited<ReturnType<NonNullable<KataGoBridge['capabilities']>>>;

interface CapabilitiesState {
  capabilities: DeviceCapabilities | null;
}

export const useCapabilitiesStore = create<CapabilitiesState>(() => ({ capabilities: null }));

let reading: Promise<void> | null = null;

/** Ask the bridge once; later calls return the first call's promise. */
export function readDeviceCapabilities(): Promise<void> {
  if (!reading) {
    reading = (async () => {
      const bridge = typeof window !== 'undefined' ? window.kataGo : undefined;
      if (!bridge || typeof bridge.capabilities !== 'function') return;
      try {
        const caps = await bridge.capabilities();
        useCapabilitiesStore.setState({ capabilities: caps ?? null });
      } catch (e) {
        console.warn('[capabilities] the bridge could not report them:', e);
      }
    })();
  }
  return reading;
}

/** The bridge reported the human SL model loaded. */
export function hasHumanModel(): boolean {
  return useCapabilitiesStore.getState().capabilities?.humanModel === true;
}

/** Tests only: forget the answer so the next read asks again. */
export function _resetDeviceCapabilities(): void {
  reading = null;
  useCapabilitiesStore.setState({ capabilities: null });
}
