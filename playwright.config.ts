import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// Chromium needs system libs extracted to ~/.local/lib/chromium-deps (no root required)
const CHROMIUM_DEPS = path.join(process.env['HOME'] ?? '/home/dev', '.local/lib/chromium-deps');
const ldPath = process.env['LD_LIBRARY_PATH']
  ? `${CHROMIUM_DEPS}:${process.env['LD_LIBRARY_PATH']}`
  : CHROMIUM_DEPS;
process.env['LD_LIBRARY_PATH'] = ldPath;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:65432',
    headless: true,
    launchOptions: {
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
