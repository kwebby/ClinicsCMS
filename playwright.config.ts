/* Author: ramanpal singh | URL: https://kwebby.com */
import { defineConfig, devices } from '@playwright/test';

/** Servers must already be running against an isolated, fictional test installation. */
export default defineConfig({
  testDir: './tests/web',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright-report.json' }]],
  use: {
    baseURL: process.env.WEB_BASE_URL || 'http://localhost:3000',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1050 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});
