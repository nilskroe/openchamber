import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Worktree tests need sequential execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for worktree tests
  reporter: 'html',
  timeout: 60000, // 60s timeout for worktree operations
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3030',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Run dev server before tests if not already running
  // Skip starting webServer if PLAYWRIGHT_BASE_URL is set or in CI
  webServer: process.env.CI || process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'bun run dev:web:full',
        url: 'http://localhost:3030',
        reuseExistingServer: true,
        timeout: 120000,
      },
});
