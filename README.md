# TowerField

Browser-Spiel mit [Phaser 3](https://phaser.io/), TypeScript und Vite: ein mobiles 1-gegen-1-Tower-Defense mit
Karten (Hochformat, Touch, `Scale.FIT`). Aktuell spielt man lokal gegen einen deterministischen Bot.

## Spielkonzept

- Waagrechte Lanes: Das Feld startet mit einer Start-Lane (links der Mensch, rechts der Bot, je 3 Tower
  nebeneinander). Pro Ausbaustufe (Lvl 2, Lvl 3) kommen je eine Lane oberhalb und unterhalb dazu, siehe
  [`docs/anwendung-horizontale-lane.md`](docs/anwendung-horizontale-lane.md).
- Beide Spieler ziehen aus derselben, per Seed gemischten Kartenreihenfolge: 5 Startkarten, ab Runde 2 je 3 neue
  Karten (identisch für beide). Kein Zufall im Kampf, keine Trefferchancen. In Runde 3 und 6 wirkt ein seedbasiertes Runden-Ereignis für beide
  Spieler (Energie +1, früherer Respawn oder Tower-Schild), siehe
  [`docs/anwendung-rundenereignisse.md`](docs/anwendung-rundenereignisse.md).
- Eine Runde = Planung (beide spielen gleichzeitig Karten, begrenzt durch Energie) und Kampf (Minions und Tower,
  Zeit nur über `delta`).
- Kartentypen: Lane ausbauen (Feld +1 Stufe, ohne Ziel), Tower ausbauen, Minion beschwören, Minion verbessern (wirkt nur auf künftige Minions).
- Sieg: alle drei gegnerischen Tower zerstört, oder nach der Rundengrenze (8) mehr Tower-Lebenspunkte. Gleichstand =
  Unentschieden.

### Basiswerte

Alle Basiswerte stehen in `src/logic/balance-config.ts` (nur Startwerte, kein Balancing); `match.ts` und `combat.ts`
führen die Namen per Re-Export weiter. Die Tabelle gibt den Stand der Konfiguration wieder, `balance-config.test.ts`
vergleicht sie Zeile für Zeile mit den Konstanten. Die Werte je Karte (Kosten, HP, Schaden, Kopien) stehen als Tabelle
`CARD_BALANCE` in derselben Datei.

| Wert | Konstante | Zahl |
|---|---|---|
| Startkarten in Runde 1 | `START_HAND` | 5 |
| Neue Karten ab Runde 2 | `DRAW_PER_ROUND` | 3 |
| Handlimit | `HAND_LIMIT` | 10 |
| Rundengrenze | `MAX_ROUNDS` | 8 |
| Kampfphase in Ticks | `COMBAT_TICKS` | 400 |
| Energie in Runde 1 | `BASE_ENERGY` | 3 |
| Energie mehr je Runde | `ENERGY_PER_ROUND` | 1 |
| Einkommen je Festung über Start | `INCOME_PER_FORTRESS` | 1 |
| Einkommen je Lane über Start | `INCOME_PER_LANE` | 1 |
| Festungen zu Spielbeginn | `START_FORTRESSES` | 1 |
| Lanes zu Spielbeginn | `START_LANES` | 1 |
| Kosten Feld-Upgrade | `UPGRADE_COST` | 2 |
| Kosten Lane-Kauf | `LANE_COST` | 5 |
| Kosten Karte ziehen | `DRAW_COST` | 1 |
| Kosten Minion verschieben | `MOVE_COST` | 1 |
| Energie fürs Abwerfen | `DISCARD_ENERGY` | 1 |
| Bonus Energieschub | `EVENT_ENERGY_BONUS` | 1 |
| Feld-Höchststufe | `MAX_FIELD_LEVEL` | 3 |
| Lanes des vollen Feldes | `FIELD_LANE_COUNT` | 5 |
| Mindest-Level Spezialisierung | `SPECIALIZE_MIN_LEVEL` | 2 |
| Energie-Obergrenze (abgeleitet) | `MAX_ENERGY` | 17 |
| Tower-HP | `TOWER_HP` | 100 |
| Tower-Schaden | `TOWER_DAMAGE` | 8 |
| Tower-Reichweite | `TOWER_RANGE` | 20 |
| Blitz-Turm: Schadensanteil | `LIGHTNING_FACTOR` | 0.6 |
| Schild-Turm: Rückwurf | `SHIELD_REFLECT` | 0.5 |
| Länge einer Lane | `LINE_LENGTH` | 100 |
| Tick-Dauer in ms | `TICK_MS` | 50 |
| Lane-Buff: Schadensfaktor | `LANE_BUFF_FACTOR` | 1.25 |
| Lane-Schild: Schadensfaktor | `LANE_SHIELD_FACTOR` | 0.7 |
| Minion-HP (Standard) | `MINION_HP` | 30 |
| Minion-Schaden (Standard) | `MINION_DAMAGE` | 6 |
| Minion-Reichweite (Standard) | `MINION_RANGE` | 4 |
| Minion-Tempo (Standard) | `MINION_SPEED` | 10 |

Das Handlimit (bestätigt) greift erst in Runde 3: 5 + 3 = 8, dann 11; überzählige Karten verfallen am Ende der Hand, es
gilt die Reihenfolge der Ankunft. Die Slots je Lane ergeben sich aus den lebenden Towern (zwei je Tower, `laneSlotCounts`).

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

## Ton

Soundeffekte für Kampf und Aktionen (Treffer, Pfeil, Blitz, Schild, Heilung, Beschwörung, Tod, Karte, Runde, Sieg,
Niederlage) und eine Tavernen-Musikschleife, die nach der ersten Eingabe startet. Oben links schaltet „Ton an / Stumm“
alles um, oben rechts stellen zwei Regler Musik und Effekte getrennt ein; die Werte bleiben im `localStorage`. Das
Replay spielt die Effekte mit leiserer Musik. Dateien, Quellen und Lizenzen:
[`docs/anwendung-audio.md`](docs/anwendung-audio.md). Als Musik wechseln sich zwei gemeinfreie (CC0) Tavernen-Stücke
ab.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload auf http://localhost:5180 (anderer Port: `GAME_DEV_PORT`) |
| `npm run build` | Typprüfung und Produktions-Build nach `dist/` |
| `npm test` | Unit-Tests der Spiellogik (Vitest, ohne Browser) |
| `npm run test:coverage` | Unit-Tests mit Coverage-Messung für `src/logic/` (Konsolentabelle, HTML-Bericht in `coverage/`) |
| `npm run test:smoke` | Baut und prüft im Browser (Playwright), dass der Canvas zeichnet und keine Konsolenfehler auftreten |
| `npm run audio:sfx` | Erzeugt die Soundeffekte (WAV) unter `public/assets/audio/` neu (siehe [Ton](docs/anwendung-audio.md)) |
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
| `cards.ts` | 100 % | 100 % | 100 % | 100 % |
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

Alle Dateien liegen über dem Schwellenwert-Vorschlag; der niedrigste Branch-Wert ist `fx-events.ts` (87,5 %, Zeilen 46–53).

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
    balance-config.ts  alle Basiswerte an einer Stelle (von match.ts, combat.ts, cards.ts und lanes.ts gelesen)
    match.ts   Zustand, Runden, Hand, Energie, Karten ausspielen, Siegbedingung (Basiswerte aus balance-config.ts)
    combat.ts  Minion-Bewegung und Tower-Schaden (feste Ticks aus delta; Basiswerte aus balance-config.ts)
    bot.ts     deterministischer Gegner (Kartenreihenfolge optional einstellbar)
    balance-sim.ts  simulierte Bot-Matches und Kennzahlen (Dev-Szene)
    game-state.ts  nextRandom (Seed-Zufall); der alte „Sterne“-Code darin ist ungenutzt
  scenes/      Phaser-Szenen: Eingabe lesen, Logik aufrufen, Ergebnis zeichnen (balance-scene.ts nur im Dev-Server)
  main.ts      Phaser.Game mit Grösse, Skalierung und Szenen
e2e/           Playwright-Smoke-Test
```

Regeln für Änderungen (auch für die KI-Agents) stehen in [AGENTS.md](AGENTS.md).
