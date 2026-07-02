import { defineConfig } from '@playwright/test';

/**
 * Layout-regression tests (e2e/layout.spec.ts): resize through the device
 * matrix and assert nothing critical is cut off. Runs against the vite DEV
 * server (not a built preview) because the specs drive app state through the
 * dev-only store hooks (window.__gameStore etc.) and deep links.
 *
 * Run: npm run test:layout
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // Layout probes are deterministic; one retry only papers over flaky
  // dev-server startup, not real failures.
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
