import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceKind } from '../sync';

// The native shell injects window.kataGo on every iOS build; a browser has
// none. The kind rides in X-Device-Kind so the admin list can tell an iPad
// row from a browser row. Nothing personal is in it.
// Project-wide vitest env is 'node': shim `window` and `navigator` here, as
// cloudBot.test.ts does, rather than pull in jsdom.
const g = globalThis as { window?: { kataGo?: unknown } };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'; // iPadOS reports a Mac

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function withUserAgent(ua: string) {
  // Node's `navigator` is a getter-only global; redefine it for the test.
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true });
}

describe('deviceKind', () => {
  afterEach(() => {
    delete g.window;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    vi.unstubAllGlobals();
  });

  it('is web without the native bridge, whatever the user agent says', () => {
    withUserAgent(IPHONE);
    g.window = {};
    expect(deviceKind()).toBe('web');
    delete g.window;
    expect(deviceKind()).toBe('web');
  });

  it('is iPhone or iPad with the native bridge, by the user agent', () => {
    g.window = { kataGo: {} };
    withUserAgent(IPHONE);
    expect(deviceKind()).toBe('iPhone');
    withUserAgent(IPAD);
    expect(deviceKind()).toBe('iPad');
  });
});

describe('the kind rides on every request that makes or uses a device row', () => {
  it('is sent as X-Device-Kind on create, redeem and an authenticated call', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push((init.headers as Record<string, string>)['X-Device-Kind'] ?? '(none)');
      return new Response(JSON.stringify({ player_id: 'p', device_token: 't', rev: 1, state: {}, games: [] }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const { syncApi } = await import('../sync');
    await syncApi.createPlayer({ schema: 1 } as never, 'k'.repeat(32));
    await syncApi.redeemPairingCode('ABCDEFGH');
    await syncApi.getState('tok');
    expect(seen).toEqual(['web', 'web', 'web']);
    vi.unstubAllGlobals();
  });
});
