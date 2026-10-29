# Anwendung: Balance-Bericht per CLI mit Regressionsgrenzen

`npm run balance` führt `runSimulation` im Node-Prozess aus (ohne Browser, Vite und Dev-Szene) und gibt den
`BalanceReport` als Tabelle und/oder JSON aus. Der Regressionstest `src/logic/balance-regression.test.ts` prüft weite
Grenzen. Es ändert sich keine Spielregel und kein Kartenwert.

## Aufruf

```
npm run balance                                  # Tabelle auf stderr, JSON auf stdout
npm run balance -- --format json                 # nur JSON auf stdout
npm run balance -- --format table                # nur Tabelle auf stdout
npm run balance -- --seed 5000 --count 2000
```

| Parameter  | Vorgabe | Bedeutung                                        |
| ---------- | ------- | ------------------------------------------------ |
| `--seed`   | 1       | Startseed, ganze Zahl 0 bis 4294967295           |
| `--count`  | 1000    | Anzahl Matches, ganze Zahl 1 bis 1000000         |
| `--format` | `both`  | `table`, `json` oder `both` (Tabelle auf stderr) |

- Gleicher `--seed` und gleiches `--count` liefern identische Ausgabe (nur Seed, kein `Math.random`, keine Uhrzeit).
- Ungültige Werte oder unbekannte Argumente: Fehlermeldung auf stderr, Exit-Code 1.
- Vorgabe 1000 Matches: Untergrenze aus dem Bug „Balance-Simulation auf 1000 Matches erhöhen“. Der Lauf dauert einige
  Sekunden.

## Aufbau

- `src/logic/balance-format.ts`: Tabelle, Prozentwerte, Sortierung nach |deltaToBaseline| und Argument-Auswertung
  (reine Funktionen, Test daneben). Die Vorgaben stehen dort als `DEFAULT_BALANCE_SEED` und `DEFAULT_BALANCE_COUNT`.
- `tools/balance.mjs`: dünner Wrapper (Argumente lesen, `runSimulation` aufrufen, ausgeben). Prüft keine Grenzen.
- `tools/register-ts.mjs` und `tools/ts-resolve-hook.mjs`: laden die TypeScript-Quellen.

**Warum Node-Type-Stripping mit kleinem Resolve-Hook:** Node ≥ 22.18 führt `.ts` ohne Zusatzpaket aus, kennt aber keine
Importe ohne Endung (`./bot`), wie sie in `src/logic/` stehen. Der 8-Zeilen-Hook ergänzt `.ts`. So braucht es weder
`tsx` noch `vite-node` und damit keine neue Abhängigkeit. Einschränkung: Die geladene Logik darf keine
TypeScript-Syntax nutzen, die sich nicht nur streichen lässt (`enum`, Parameter-Properties).

## Regressionstest und Grenzen anpassen

Der Test simuliert Seed 1 mit 1000 Matches und prüft:

- `winRatePlayer0` und `winRatePlayer1` je zwischen 0,40 und 0,60 (`MIN_SIDE_WIN_RATE`, `MAX_SIDE_WIN_RATE`),
- jede Karte mit |deltaToBaseline| ≤ `MAX_CARD_DELTA` (0,40).

Die Fehlermeldung nennt Seite oder Karte samt Messwert. Nach einer gewollten Änderung:

1. `npm run balance -- --format table` ausführen und die Wirkung der Änderung lesen.
2. Ist die Abweichung gewollt, die Konstante in `balance-regression.test.ts` mit Reserve anheben und den neuen
   Messlauf im Kommentar vermerken. Die Grenzen werden nie automatisch angepasst.
3. Ist sie nicht gewollt, die Karte oder den Wert korrigieren, nicht die Grenze.

## Messlauf (Stand dieses Auftrags)

Seed 1, 1000 Matches: Siegquote Spieler 0 51,4 %, Spieler 1 48,6 %. Die meisten Karten liegen unter ±3 %.
**Auffällig:** `tower-shield` (−29,1 %) und `tower-lightning` (−28,9 %) liegen weit unter der Basis. Vermutlich spielt die
Prioritätsliste des Bots sie erst spät, etwa wenn er schon zurückliegt; das ist nicht belegt. Der Auftrag ändert daran
nichts. `line-upgrade` und `minion-upgrade-elite` werden im Messlauf nie gespielt (0 Matches).
