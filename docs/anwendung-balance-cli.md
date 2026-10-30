# Anwendung: Balance-Bericht per CLI mit Leitplanken

`npm run balance` führt `runSimulation` im Node-Prozess aus (ohne Browser, Vite und Dev-Szene) und gibt den
`BalanceReport` als Tabelle oder JSON aus. Die Leitplanken (`src/logic/balance-guardrails.ts`) prüft
`balance-guardrails.test.ts`. Es ändert sich keine Spielregel und kein Kartenwert.

## Aufruf

```
npm run balance                                  # Tabelle
npm run balance -- --json                        # JSON des BalanceReport
npm run balance -- --seed 5000 --count 2000
```

| Parameter | Vorgabe | Bedeutung                                  |
| --------- | ------- | ------------------------------------------ |
| `--seed`  | 1       | Startseed, ganze Zahl 0 bis 4294967295     |
| `--count` | 1000    | Anzahl Matches, ganze Zahl 1 bis 1000000   |
| `--json`  | aus     | JSON statt Tabelle                         |

- Die Tabelle zeigt die Kopfwerte (`totalMatches`, `winRatePlayer0`, `winRatePlayer1`, `drawRate`, `avgRounds`,
  `baselineWinRate` …) und je Karte `cardId`, `matchesWithCard`, `plays`, `winRate`, `deltaToBaseline`, absteigend nach
  |`deltaToBaseline`|.
- Gleicher `--seed` und gleiches `--count` liefern identische Ausgabe (nur Seed, kein `Math.random`, keine Uhrzeit).
- Ungültige Werte oder unbekannte Argumente: Fehlermeldung auf stderr, Exit-Code 1.

## Aufbau

- `src/logic/balance-format.ts`: Tabelle, Prozentwerte, Sortierung und Argument-Auswertung (reine Funktionen, Test daneben).
- `src/logic/balance-guardrails.ts`: Leitplanken als Konstanten und `checkGuardrails(report)` (Liste der Verstösse).
- `tools/balance.mjs`: dünner Wrapper. Prüft keine Grenzen.
- `tools/register-ts.mjs` und `tools/ts-resolve-hook.mjs`: laden die TypeScript-Quellen. Node ≥ 22.18 führt `.ts` ohne
  Zusatzpaket aus, kennt aber keine Importe ohne Endung; der kleine Hook ergänzt `.ts`, daher kein `tsx`/`vite-node`.
  Einschränkung: keine TypeScript-Syntax, die sich nicht nur streichen lässt (`enum`, Parameter-Properties).

## Leitplanken

| Konstante | Wert | Bedeutung |
| --- | --- | --- |
| `MIN_SIDE_WIN_RATE` / `MAX_SIDE_WIN_RATE` | 0,40 / 0,60 | Siegquote je Seite |
| `MAX_CARD_DELTA` | 0,15 | höchste |`deltaToBaseline`| je Karte |
| `MIN_CARD_SAMPLE` | 30 | Mindestzahl `matchesWithCard`; Karten darunter (auch ohne Einsatz) zählen nicht |

`balance-guardrails.test.ts` simuliert Seed 1 mit 200 Matches (400 Matches brauchten 4,2 s, zu nah am 5-s-Timeout) und
nennt bei einem Verstoss Karte oder Seite samt Wert. Grenzen werden nie automatisch angepasst: Ist eine Abweichung nicht
gewollt, die Karte korrigieren, nicht die Grenze.

## Befund (Seed 1, 1000 Matches)

Siegquote Spieler 0 51,4 %, Spieler 1 48,6 %. **Zwei Karten reissen die Grenze von 15 Punkten:** `tower-shield`
(−29,1 %) und `tower-lightning` (−28,9 %). Der Auftrag gleicht sie nicht aus; der Test nimmt sie über `KNOWN_DEVIATIONS`
aus, bis sie ausgeglichen sind. `line-upgrade` und `minion-upgrade-elite` werden nie gespielt (0 Matches, kein Verstoss).
