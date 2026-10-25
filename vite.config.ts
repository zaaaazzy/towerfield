import { defineConfig } from 'vitest/config';

// Der Review-Container von AIdeation setzt REVIEW_HOST und REVIEW_FRONTEND_PORT; lokal gelten die Vite-Standards.
const previewPort = Number(process.env.REVIEW_FRONTEND_PORT ?? 4173);
// 5180 statt Vites 5173, damit das Spiel nicht mit anderen Vite-Projekten kollidiert. Die Vorschau-Adresse in
// AIdeation zeigt auf diesen Port; wer GAME_DEV_PORT ändert, passt sie unter Einstellungen → Visuelle Prüfung an.
const devPort = Number(process.env.GAME_DEV_PORT ?? 5180);

export default defineConfig({
  // Relative Asset-Pfade: GitHub Pages liefert das Spiel unter /towerfield/ aus.
  base: './',
  // host: true – auch im Netzwerk erreichbar (Handy, Tablet: http://<IP des Rechners>:5180). Namen wie
  // rechner.local zusätzlich freigeben; IP-Adressen und localhost erlaubt Vite ohnehin.
  server: { host: true, port: devPort, strictPort: true, allowedHosts: ['.local'] },
  preview: { host: process.env.REVIEW_HOST ?? 'localhost', port: previewPort, strictPort: true },
  build: {
    // Phaser allein ist gut 1 MB gross; die Warnung ab 500 kB wäre bei jedem Build da.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Nur mit `npm run test:coverage` (vitest run --coverage) aktiv; `npm test` misst nichts.
    coverage: {
      provider: 'v8',
      include: ['src/logic/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
