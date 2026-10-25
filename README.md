# TowerField

Browser-Spiel mit [Phaser 3](https://phaser.io/), TypeScript und Vite: ein mobiles 1-gegen-1-Tower-Defense mit
Karten (Hochformat, Touch, `Scale.FIT`). Aktuell spielt man lokal gegen einen deterministischen Bot.

## Spielkonzept

- 3 Lines, jede gehört je zur Hälfte beiden Spielern; pro Spieler und Line genau 1 Tower.
- Beide Spieler ziehen aus derselben, per Seed gemischten Kartenreihenfolge: 7 Startkarten, ab Runde 2 je 5 neue
  Karten (identisch für beide). Kein Zufall im Kampf, keine Trefferchancen.
- Eine Runde = Planung (beide spielen gleichzeitig Karten, begrenzt durch Energie) und Kampf (Minions und Tower,
  Zeit nur über `delta`).
- Kartentypen: Line ausbauen, Tower ausbauen, Minion beschwören, Minion verbessern (wirkt nur auf künftige Minions).
- Sieg: alle drei gegnerischen Tower zerstört, oder nach der Rundengrenze (8) mehr Tower-Lebenspunkte. Gleichstand =
  Unentschieden.

Basiswerte (in `src/logic/match.ts` und `combat.ts`, nur Startwerte, kein Balancing): `HAND_LIMIT = 10`
(bestätigt, greift schon in Runde 2: 7 + 5 = 12, überzählige Karten verfallen am Ende der Hand; es gilt die
Reihenfolge der Ankunft), `MAX_ROUNDS = 8`,
Energie 3 + 1 pro Runde (max. 10), Line-Höchststufe 5, Kapazität 2 + Stufe, Tower 100 HP / 8 Schaden.

Das verbindliche Designkonzept (Karten, Minions, Slot-Platzierung, Iso-Karte, Mobile-Layout, Folgeaufträge) steht in
[`docs/designkonzept.md`](docs/designkonzept.md). Die Anwendung der Iso-Umrechnung, der Kamera-Begrenzung und der
Slot-Platzierung beschreibt [`docs/anwendung-iso-platzierung.md`](docs/anwendung-iso-platzierung.md), das Verschieben
von Minions [`docs/anwendung-minion-drag-and-drop.md`](docs/anwendung-minion-drag-and-drop.md) und die Handlimit-Regel
mit ihren Tests [`docs/anwendung-handlimit.md`](docs/anwendung-handlimit.md).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload auf http://localhost:5180 (anderer Port: `GAME_DEV_PORT`) |
| `npm run build` | Typprüfung und Produktions-Build nach `dist/` |
| `npm test` | Unit-Tests der Spiellogik (Vitest, ohne Browser) |
| `npm run test:smoke` | Baut und prüft im Browser (Playwright), dass der Canvas zeichnet und keine Konsolenfehler auftreten |
| `npm run review` | Baut und liefert den Stand aus (Review-Container von AIdeation, Port aus `REVIEW_FRONTEND_PORT`) |

Der Smoke-Test braucht Chromium für Playwright: `npx playwright install chromium` (unter Linux einmalig zusätzlich
`npx playwright install-deps chromium`).

## Aufbau

```
src/
  logic/       Spiellogik ohne Phaser – mit Unit-Tests daneben (*.test.ts)
    cards.ts   Kartendefinitionen, Deck-Reihenfolge per Seed
    match.ts   Zustand, Runden, Hand, Energie, Karten ausspielen, Siegbedingung
    combat.ts  Minion-Bewegung und Tower-Schaden (feste Ticks aus delta)
    bot.ts     deterministischer Gegner
    game-state.ts  nextRandom (Seed-Zufall); der alte „Sterne“-Code darin ist ungenutzt
  scenes/      Phaser-Szenen: Eingabe lesen, Logik aufrufen, Ergebnis zeichnen
  main.ts      Phaser.Game mit Grösse, Skalierung und Szenen
e2e/           Playwright-Smoke-Test
```

Regeln für Änderungen (auch für die KI-Agents) stehen in [AGENTS.md](AGENTS.md).
