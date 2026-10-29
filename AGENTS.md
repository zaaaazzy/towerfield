# Richtlinien für Agents

Dieses Projekt ist ein Browser-Spiel mit Phaser 3, TypeScript und Vite.

## Aufbau

- **Spiellogik von Phaser-Szenen trennen.** Regeln, Zustand, Kollisionen, Punkte und Zeit gehören in `src/logic/` als
  reine Funktionen ohne `import 'phaser'`, ohne DOM und ohne Canvas. So sind sie mit Vitest im Node-Prozess testbar.
- Szenen (`src/scenes/`) lesen nur die Eingabe, rufen die Logik auf und zeichnen das Ergebnis. Keine Spielregeln in
  `update()` verstecken.
- Zufall über einen Seed (siehe `nextRandom` in `src/logic/game-state.ts`), damit Tests reproduzierbar sind.
- Zeit immer über `delta` aus `update(time, delta)` rechnen, nie in Frames – das Spiel läuft sonst je nach
  Bildwiederholrate verschieden schnell.
- Grafiken und Töne unter `public/assets/` ablegen und im `preload()` der Szene laden; Pfade ohne führenden Ordner
  `public/` (z. B. `assets/player.png`).
- Phaser 3 bleiben (kein Wechsel auf Phaser 4 ohne eigenen Auftrag); die API-Doku steht unter
  https://newdocs.phaser.io/docs/3.90.0.

## Tests

- Jede neue Regel bekommt einen Unit-Test neben der Datei (`src/logic/<name>.test.ts`).
- Vor Abgabe neuer Regeln `npm run test:coverage` ausführen. Der Befehl prüft selbst die Grenzen aus `vite.config.ts`
  (`test.coverage.thresholds`: Zeilen 99,5 %, Zweige 99 %, Funktionen 100 %, Anweisungen 99,5 %). Ein roter Lauf
  (Exit-Code 1, die verletzte Metrik steht in der Ausgabe) blockiert die Abgabe: Lücken mit Tests in
  `src/logic/*.test.ts` schliessen, die Grenzen nicht senken. `npm test` misst keine Abdeckung.
- Maschinenlesbare Werte stehen nach dem Lauf in `coverage/coverage-summary.json` (`lines`, `branches`, `functions`,
  `statements`).
- `npm run build` (Typprüfung + Build), `npm test` und `npm run test:smoke` müssen grün sein.

### Bereichsnamen

Berichte und Doku verwenden nur diese drei Namen:

| Bereich | Ort | Messung / Befehl |
| --- | --- | --- |
| **Logik** | `src/logic/` | Vitest-Coverage mit Grenzen: `npm run test:coverage`; Tests ohne Messung: `npm test` bzw. `npx vitest run <datei>` |
| **Szenen-E2E** | Playwright-Specs unter `e2e/` mit Szenenabläufen | Playwright, keine Coverage; läuft über `npm run test:smoke` bzw. `npx playwright test`, nie über `vitest run` („No test files found", Exit-Code 1) |
| **Smoke** | `e2e/smoke.spec.ts` | Canvas zeichnet, keine Konsolenfehler; `npm run test:smoke`. Neue Szenen dort aufnehmen, wenn sie ohne Eingabe erreichbar sind |

- Keine Konsolenausgaben mit `console.error` für erwartete Fälle – der Smoke-Test wertet sie als Fehler.
