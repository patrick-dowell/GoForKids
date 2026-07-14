import { defineConfig } from '@playwright/test';

/**
 * Layout-regression tests (e2e/layout.spec.ts): resize through the device
 * matrix and assert nothing critical is cut off. Runs against the vite DEV
 * server (not a built preview) because the specs drive app state through the
 * dev-only store hooks (window.__gameStore etc.) and deep links.
 *
 * Run: npm run test:layout
 *
 * The suite always boots its OWN dev server on a dedicated port and refuses
 * to attach to anything already listening there. With the old config
 * (port 5173 + reuseExistingServer: true) the gate silently attached to any
 * dev server on 5173 — including one left running in a DIFFERENT
 * checkout/worktree — and tested that tree's code instead of this one
 * (bit us 2026-07-14). Hence:
 *  - reuseExistingServer: false → Playwright hard-errors if GATE_PORT is
 *    busy rather than testing an unknown server. Kill the stale process
 *    and rerun; never flip this back to true.
 *  - GATE_PORT is not 5173 (nor 5174+, vite's busy-port fallback range),
 *    so a manually-started `npm run dev` never collides with the gate.
 *  - --strictPort → vite exits instead of drifting to another port.
 */
const GATE_PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // Layout probes are deterministic; one retry only papers over flaky
  // dev-server startup, not real failures.
  retries: 0,
  use: {
    baseURL: `http://localhost:${GATE_PORT}`,
  },
  webServer: {
    command: `npm run dev -- --port ${GATE_PORT} --strictPort`,
    port: GATE_PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
