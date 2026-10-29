import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SMOKE_PORT ?? 4174);
const devPort = Number(process.env.SMOKE_DEV_PORT ?? 5181);

// Smoke-Test gegen den gebauten Stand (npm run test:smoke baut vorher).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Screenshot-Vergleiche (e2e/grafik.spec.ts) brauchen bei ausgelasteter Maschine mehr als die üblichen 5 s.
  expect: { timeout: 20_000 },
  // Die Specs laufen parallel gegen zwei Server und schlagen bei hoher Last vereinzelt zeitabhängig fehl.
  retries: process.env.CI ? 1 : 0,
  // In der CI schreibt der HTML-Bericht nach playwright-report/ (wird bei Fehlern als Artefakt hochgeladen).
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
