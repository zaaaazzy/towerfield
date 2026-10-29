# Anwendung: Balance-Bericht per CLI mit Leitplanken

`npm run balance` führt `runSimulation` im Node-Prozess aus (ohne Browser, Vite und Dev-Szene) und gibt den
`BalanceReport` als Tabelle oder JSON aus. Der Test `src/logic/balance-guardrails.test.ts` prüft grobe Leitplanken.
Es ändert sich keine Spielregel und kein Kartenwert.

## Aufruf

```
npm run balance                                  # Tabelle
npm run balance -- --json                        # JSON des BalanceReport
npm run balance -- --seed 5000 --count 2000
```

| Parameter | Vorgabe | Bedeutung                                |
| --------- | ------- | ---------------------------------------- |
| `--seed`  | 1       | Startseed, ganze Zahl 0 bis 4294967295   |
| `--count` | 1000    | Anzahl Matches, ganze Zahl 1 bis 1000000 |
| `--json`  | aus     | JSON statt Tabelle                       |

- Die Tabelle zeigt zuerst die Kopfwerte (`totalMatches`, `winRatePlayer0`, `winRatePlayer1`, `drawRate`, `avgRounds`,
  `baselineWinRate` u. a.), dann je Karte `cardId`, `matchesWithCard`, `plays`, `winRate`, `deltaToBaseline`
  (absteigend nach Betrag), zuletzt die Ereigniszähler.
- Gleicher `--seed` und gleiches `--count` liefern identische Ausgabe (nur Seed, kein `Math.random`, keine Uhrzeit).
- Ungültige Werte oder unbekannte Argumente: Fehlermeldung auf stderr, Exit-Code 1.

## Aufbau

- `src/logic/balance-format.ts`: Tabelle, Prozentwerte, Sortierung und Argument-Auswertung (Test daneben).
- `src/logic/balance-guardrails.ts`: Leitplanken-Konstanten und `checkGuardrails(report)` (Test daneben).
- `tools/balance.mjs`: dünner Wrapper (Argumente lesen, `runSimulation` aufrufen, ausgeben).
- `tools/register-ts.mjs` und `tools/ts-resolve-hook.mjs`: laden die TypeScript-Quellen. Node ≥ 22.18 führt `.ts` ohne
  Zusatzpaket aus, kennt aber keine Importe ohne Endung; der kleine Hook ergänzt `.ts`. Keine neue Abhängigkeit.
  Die geladene Logik darf keine TypeScript-Syntax nutzen, die sich nicht nur streichen lässt (`enum`, Parameter-Properties).

## Leitplanken

| Konstante | Wert | Bedeutung |
| --- | --- | --- |
| `MIN_SIDE_WIN_RATE` / `MAX_SIDE_WIN_RATE` | 0,40 / 0,60 | Siegquote je Seite |
| `MAX_CARD_DELTA` | 0,15 | höchstens ±15 Punkte `deltaToBaseline` je Karte |
| `MIN_CARD_MATCHES` | 30 | darunter (auch 0 Einsätze) kein Verstoss, die Streuung ist zu gross |
| `KNOWN_CARD_DEVIATIONS` | s. u. | gemeldete, noch nicht behobene Abweichungen |

`checkGuardrails` liefert die Verstösse als Klartext mit Seite oder Karte samt Wert. Der Test
`balance-guardrails.test.ts` simuliert Seed 1 mit 200 Matches (rund 2 s, unter dem Vitest-Timeout von 5 s; 500 Matches
brauchten 4,5 s) und schlägt bei einem Verstoss fehl. Den Dauerlauf mit 1000 Matches macht `npm run balance`.

Nach einer gewollten Änderung: `npm run balance` lesen. Ist die Abweichung gewollt, den Auftraggeber fragen, bevor
eine Grenze angehoben wird; ist sie es nicht, die Karte korrigieren, nicht die Grenze.

## Offener Befund: tower-shield und tower-lightning

Messlauf Seed 1, 1000 Matches: Siegquote Spieler 0 51,4 %, Spieler 1 48,6 % (im Rahmen). Die meisten Karten liegen unter
±3 Punkten. **Aber:** `tower-shield` (−29,1 %, 263 Matches) und `tower-lightning` (−28,9 %, 256 Matches) liegen weit
ausserhalb der ±15 Punkte. Vermutlich spielt die Prioritätsliste des Bots sie erst spät; das ist nicht belegt. Der
Auftrag gleicht das nicht aus. Beide stehen in `KNOWN_CARD_DEVIATIONS`, sonst wäre `npm test` dauerhaft rot. Wird das
Ungleichgewicht behoben, die Einträge entfernen. `line-upgrade` und `minion-upgrade-elite` werden nie gespielt (0
Matches) und zählen nicht als Verstoss.
