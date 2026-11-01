import { defineConfig, devices } from '@playwright/test';

// Browser checks on the FINISHED build (release gate rows FUNC-XBROWSER-01, FE-CONSOLE-01, FUNC-STATES-01, A11Y-AUTO-01, PERF-CWV-01,
// SA-NETWORK-01). Run `npm run build` first, then:  npm run test:browsers
// The pages are served by scripts/dev/pages-server.mjs, which answers like GitHub Pages (clean addresses from .html files, 404.html with
// status 404, no security headers). Every request to the database host is answered by the tests themselves (tests/browser/fixtures.ts),
// so nothing here touches the dev or the production database.
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 45_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'node scripts/dev/pages-server.mjs 4173',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'phone-android', use: { ...devices['Pixel 7'] } },
    { name: 'phone-iphone', use: { ...devices['iPhone 14'] } },
  ],
});
