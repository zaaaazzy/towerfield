# Replay-Szene (`?replay=<seed>`)

Die URL `?replay=<seed>` zeigt ein vollständig vom Bot gespieltes Match ohne jede Eingabe. Es gilt im Dev-Server und im
Produktions-Build.

## Ablauf

1. **Planung:** Blau (Spieler 0) und Orange (Spieler 1) spielen abwechselnd je eine Karte pro 700 ms. Jede Karte
   erscheint als Kommentar im Band unten, z. B. „Runde 2 · Blau spielt Minion auf Line 3“.
2. **Kampf:** Läuft in Zeitlupe (`delta` × 0,35). Die Regeln und Ticks sind dieselben wie im normalen Match, nur die
   echte Zeit dehnt sich.
3. **Ende:** Die Szene zeigt das Ergebnis und die URL zum Teilen. Ein Tastendruck oder Klick startet dasselbe Replay
   neu. Weitere Eingaben gibt es nicht.

## Was „Replay“ hier heißt

Ein Seed legt Deck und die Strategien beider Bots fest (`strategiesForSeed`), keine menschlichen Züge. Gleicher Seed
ergibt immer dasselbe Match. Aufgezeichnete Partien von Spielern gibt es nicht.

## Ungültiger Wert

Nur 1–15 Ziffern gelten (wie bei `?seed=`). Bei `?replay=abc` oder `?replay=` startet die normale `MainScene`, ohne
Konsolenfehler.

## Für Entwickler

| Datei | Inhalt |
| --- | --- |
| `src/logic/seed.ts` | `parseReplaySeed(search)` |
| `src/logic/replay.ts` | `createReplay`, `stepReplay`, `describeEvent`, `SLOWMO_FACTOR`, `PLAY_PAUSE_MS` |
| `src/logic/bot.ts` | `botStep` (ein Zug des Bots); `botPlan` nutzt es, Verhalten unverändert |
| `src/scenes/replay-scene.ts` | Szene `replay`: ruft `stepReplay`, zeichnet Feld und Kommentare |
| `src/scenes/main-scene.ts` | Gemeinsame Zeichenhelfer: `LabelPool`, `drawBoard`, `drawMinions`, `drawTower` |

Tests: `src/logic/replay.test.ts`, `src/logic/seed.test.ts`, `src/logic/bot.test.ts`, Smoke-Test in
`e2e/smoke.spec.ts`.

`src/main.ts` startet die Replay-Szene als erste Szene, sobald `parseReplaySeed` einen gültigen Wert liefert (Dev und
Produktion). Ohne gültigen Parameter bleibt alles beim Alten (`MainScene`, `?seed=`, `?scene=balance`).

## Worauf zu achten ist

- **Dauer:** Ein Replay über alle Runden dauert in echter Zeit lange (bis etwa 450 s), weil die Kampfphase mit Faktor
  0,35 läuft. Eine Geschwindigkeitswahl oder Pause gibt es bewusst nicht.
- **Refactoring über den Auftrag hinaus:** `botPlan` ruft jetzt `botStep` in einer Schleife auf (Verhalten
  unverändert). Die Zeichenhelfer `LabelPool`, `drawBoard`, `drawMinions` und `drawTower` sind aus `main-scene.ts`
  exportiert und werden von `MainScene` und `ReplayScene` gemeinsam genutzt. Bei Änderungen daran beide Szenen prüfen.
- **Keine neuen Regeln:** `MatchState` und die Spielregeln sind unverändert; das Replay nutzt `createMatch`, `playCard`,
  `setReady` und `advance`.
- **Teilen-URL:** Sie wird aus `window.location.origin` und `pathname` plus `?replay=<seed>` gebaut.
