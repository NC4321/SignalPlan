import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env['PW_PORT'] ?? 4173)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    // Tests start as a returning visitor who has seen the guided first run
    // (D90); guide.e2e.ts starts from a fresh browser instead.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [{ name: 'signalplan:guide', value: 'seen' }],
        },
      ],
    },
    trace: 'retain-on-failure',
    // Locally, point CHROMIUM_PATH at a system Chromium to skip the download.
    ...(process.env['CHROMIUM_PATH']
      ? { launchOptions: { executablePath: process.env['CHROMIUM_PATH'] } }
      : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/*.phone.e2e.ts',
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      testMatch: '**/*.phone.e2e.ts',
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
  },
})
