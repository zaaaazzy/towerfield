# TowerField

Browser-Spiel mit [Phaser 3](https://phaser.io/), TypeScript und Vite: ein mobiles 1-gegen-1-Tower-Defense mit
Karten (Hochformat, Touch, `Scale.FIT`). Aktuell spielt man lokal gegen einen deterministischen Bot.

## Spielkonzept

- 3 Lines, jede gehört je zur Hälfte beiden Spielern; pro Spieler und Line genau 1 Tower.
- Beide Spieler ziehen aus derselben, per Seed gemischten Kartenreihenfolge: 5 Startkarten, ab Runde 2 je 3 neue
  Karten (identisch für beide). Kein Zufall im Kampf, keine Trefferchancen.
- Eine Runde = Planung (beide spielen gleichzeitig Karten, begrenzt durch Energie) und Kampf (Minions und Tower,
  Zeit nur über `delta`).
- Kartentypen: Line ausbauen, Tower ausbauen, Minion beschwören, Minion verbessern (wirkt nur auf künftige Minions).
- Sieg: alle drei gegnerischen Tower zerstört, oder nach der Rundengrenze (8) mehr Tower-Lebenspunkte. Gleichstand =
  Unentschieden.

Basiswerte (in `src/logic/match.ts` und `combat.ts`, nur Startwerte, kein Balancing): `HAND_LIMIT = 10`
(bestätigt, greift erst in Runde 3: 5 + 3 = 8, dann 11; überzählige Karten verfallen am Ende der Hand; es gilt die
Reihenfolge der Ankunft), `MAX_ROUNDS = 8`,
Energie 3 + 1 pro Runde (max. 8), Line-Höchststufe 5, Kapazität 2 + Stufe, Tower 100 HP / 8 Schaden.

Das verbindliche Designkonzept (Karten, Minions, Slot-Platzierung, Iso-Karte, Mobile-Layout, Folgeaufträge) steht in
[`docs/designkonzept.md`](docs/designkonzept.md). Die Anwendung der Iso-Umrechnung, der Kamera-Begrenzung und der
Slot-Platzierung beschreibt [`docs/anwendung-iso-platzierung.md`](docs/anwendung-iso-platzierung.md), das Verschieben
von Minions [`docs/anwendung-minion-drag-and-drop.md`](docs/anwendung-minion-drag-and-drop.md) und die Handlimit-Regel
mit ihren Tests [`docs/anwendung-handlimit.md`](docs/anwendung-handlimit.md). Die Tests der Bot-Strategie beschreibt
[`docs/anwendung-bot-tests.md`](docs/anwendung-bot-tests.md). Die Tower-Reichweite (20) beschreibt
[`docs/anwendung-tower-reichweite.md`](docs/anwendung-tower-reichweite.md). Das Minion-Tempo (`speed`, Brocken 8)
beschreibt [`docs/anwendung-minion-tempo.md`](docs/anwendung-minion-tempo.md). Die E2E-Tests für vollständige
Spielabläufe (fester Seed per `?seed=`, Hilfen, Schnellvorlauf) beschreibt
[`docs/anwendung-e2e-gameplay.md`](docs/anwendung-e2e-gameplay.md). Den Kartenfilter für die Hand im Match beschreibt
[`docs/anwendung-kartenfilter.md`](docs/anwendung-kartenfilter.md).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload auf http://localhost:5180 (anderer Port: `GAME_DEV_PORT`) |
| `npm run build` | Typprüfung und Produktions-Build nach `dist/` |
| `npm test` | Unit-Tests der Spiellogik (Vitest, ohne Browser) |
| `npm run test:coverage` | Unit-Tests mit Coverage-Messung für `src/logic/` (Konsolentabelle, HTML-Bericht in `coverage/`) |
| `npm run test:smoke` | Baut und prüft im Browser (Playwright), dass der Canvas zeichnet und keine Konsolenfehler auftreten |
| `npm run review` | Baut und liefert den Stand aus (Review-Container von AIdeation, Port aus `REVIEW_FRONTEND_PORT`) |

### Testabdeckung

`npm run test:coverage` misst mit `@vitest/coverage-v8` nur `src/logic/**/*.ts` (ohne `*.test.ts`) und gibt
Statements, Branches, Functions und Lines pro Datei aus. Den HTML-Bericht öffnet man mit `open coverage/index.html`
(macOS; sonst die Datei im Browser öffnen). `coverage/` ist von Git ignoriert. Es gibt keine erzwungenen Schwellenwerte;
Vorschlag für später: 80 % bei Statements, Lines und Functions, 70 % bei Branches.

Gemessene Werte (Stand 25.10.2026, 16 Testdateien, 291 Tests, Lauf ca. 14 s – `balance-sim.test.ts` mit 1000 Matches
braucht kein höheres Timeout). Die Konsolentabelle blendet Dateien mit durchgehend 100 % aus; vollständig steht alles in
`coverage/coverage-summary.json`.

| Datei (`src/logic/`) | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| **Gesamt** | 98,79 % | 95,49 % | 100 % | 99,85 % |
| `balance-sim.ts` | 98,61 % | 96,42 % | 100 % | 98,27 % |
| `bot.ts` | 100 % | 100 % | 100 % | 100 % |
| `card-style.ts` | 92,85 % | 91,66 % | 100 % | 100 % |
| `cards.ts` | 100 % | 75 % | 100 % | 100 % |
| `combat.ts` | 100 % | 97,95 % | 100 % | 100 % |
| `fx-events.ts` | 96,66 % | 87,5 % | 100 % | 100 % |
| `game-state.ts` | 100 % | 100 % | 100 % | 100 % |
| `hand-filter.ts` | 100 % | 100 % | 100 % | 100 % |
| `hand-layout.ts` | 100 % | 100 % | 100 % | 100 % |
| `iso.ts` | 100 % | 100 % | 100 % | 100 % |
| `match-record-fixture.ts` | 100 % | 100 % | 100 % | 100 % |
| `match-record.ts` | 97,41 % | 96,66 % | 100 % | 100 % |
| `match-stats.ts` | 100 % | 100 % | 100 % | 100 % |
| `match.ts` | 98,02 % | 94,01 % | 100 % | 100 % |
| `placement.ts` | 100 % | 90,9 % | 100 % | 100 % |
| `replay.ts` | 100 % | 94,23 % | 100 % | 100 % |
| `seed.ts` | 100 % | 100 % | 100 % | 100 % |

Alle Dateien liegen über dem Schwellenwert-Vorschlag; die niedrigsten Branch-Werte haben `cards.ts` (75 %, Zeile 81)
und `fx-events.ts` (87,5 %, Zeilen 46–53).

### Dev-Szene Balancing

Mit `npm run dev` zeigt http://localhost:5180/?scene=balance eine Tabelle aus 1.000 simulierten Bot-gegen-Bot-Matches
(Siegquote, Unentschieden und Niederlage pro Karte, Abweichung von der Basisquote, Rundenzahl, Ende durch Tower oder
Rundengrenze). „Neu simulieren“ nimmt den nächsten Seed-Bereich, „Sieg“ in der Kopfzeile kehrt die Sortierung um,
„Zurück“ öffnet das Spiel. Die Szene ist nur im Dev-Server registriert, nicht im Produktions-Build.

Aussagekraft: Es sind Bot-Statistiken, kein Spielerverhalten. Beide Seiten nutzen denselben Bot, nur mit je Match
zufällig gewürfelter Kartenreihenfolge (`botPlan(state, player, priority)`); Karten kommen aus demselben Deck, die
Werte sind daher korreliert. Die Logik steht in `src/logic/balance-sim.ts`.

Der Smoke-Test braucht Chromium für Playwright: `npx playwright install chromium` (unter Linux einmalig zusätzlich
`npx playwright install-deps chromium`).

## Aufbau

```
src/
  logic/       Spiellogik ohne Phaser – mit Unit-Tests daneben (*.test.ts)
    cards.ts   Kartendefinitionen, Deck-Reihenfolge per Seed
    match.ts   Zustand, Runden, Hand, Energie, Karten ausspielen, Siegbedingung
    combat.ts  Minion-Bewegung und Tower-Schaden (feste Ticks aus delta)
    bot.ts     deterministischer Gegner (Kartenreihenfolge optional einstellbar)
    balance-sim.ts  simulierte Bot-Matches und Kennzahlen (Dev-Szene)
    game-state.ts  nextRandom (Seed-Zufall); der alte „Sterne“-Code darin ist ungenutzt
  scenes/      Phaser-Szenen: Eingabe lesen, Logik aufrufen, Ergebnis zeichnen (balance-scene.ts nur im Dev-Server)
  main.ts      Phaser.Game mit Grösse, Skalierung und Szenen
e2e/           Playwright-Smoke-Test
```

Regeln für Änderungen (auch für die KI-Agents) stehen in [AGENTS.md](AGENTS.md).
