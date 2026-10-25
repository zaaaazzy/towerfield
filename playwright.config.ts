import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SMOKE_PORT ?? 4174);
const devPort = Number(process.env.SMOKE_DEV_PORT ?? 5181);

// Smoke-Test gegen den gebauten Stand (npm run test:smoke baut vorher).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: `http://localhost:${port}` },  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // Dev-Server nur für die Dev-Szene `balance`; sie ist im gebauten Stand nicht enthalten.
    {
      command: `npx vite --port ${devPort} --strictPort`,
      url: `http://localhost:${devPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
