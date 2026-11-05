import { defineConfig } from '@playwright/test';

/**
 * Integration tests run in a branded Chromium (Edge by default, or Chrome) because the open-source
 * Chromium build lacks the H.264/AAC encoders that export relies on.
 * Override with PW_CHANNEL=chrome.
 */
export default defineConfig({
  testDir: 'tests/integration',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5179',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    headless: true,
  },
  webServer: [
    {
      // Dev server: lets tests import the harness module directly.
      command: 'pnpm --filter @viditor/web exec vite --port 5179 --strictPort',
      url: 'http://localhost:5179',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Production build served with the production security headers (run `pnpm build` first).
      command: 'pnpm --filter @viditor/web exec vite preview --port 5180 --strictPort',
      url: 'http://localhost:5180',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
