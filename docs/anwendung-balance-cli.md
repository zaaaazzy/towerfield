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

## Zeitpunkt je Karte (Runde und Level)

`MatchResult.log` hält jeden Einsatz und Abwurf mit Runde, Feldstufe und Lane-Level (`laneUnlockLevel` der Ziel-Lane;
fehlt bei Karten ohne Lane-Ziel) fest, `MatchResult.held` die Handreste am Matchende. `CardStats.timing` verdichtet das
je Karte: `playsByRound` (R1…R8), `playsByLaneLevel` (L1…L3), `playsByFieldLevel`, `avgPlayRound`, `discards`,
`discardsByRound`, `held`. Die Tabelle zeigt einen Block `timing` für `tower-lightning`, `tower-shield`, `line-upgrade`
und `minion-upgrade-elite` (`TIMING_CARD_IDS` in `balance-format.ts`); das JSON enthält `timing` für alle Karten.

`line-upgrade` hat 0 Kopien im Deck; das Feld-Upgrade (`upgradeField`) ist eine Aktion. Die Messung zählt jede
`upgrade`-Aktion des Bots als Einsatz von `line-upgrade`, wie es `match.ts` für die Synergien schon tut. Ihr Lane-Level
bleibt leer, die Feldstufe steht vor dem Zug.

## Messlauf (Seed 1, 1000 Matches)

Siegquote Spieler 0 51,4 %, Spieler 1 48,6 %. Die meisten Karten liegen unter ±4 %.

| Stand | tower-shield | tower-lightning | line-upgrade | minion-upgrade-elite |
| --- | --- | --- | --- | --- |
| Vorher (Bot ohne Vorrang, ohne Messung) | −29,1 % | −28,9 % | 0 Matches (nicht gezählt) | 0 Matches |
| Nachher (Vorrang der Spezialisierungen, Messung) | −28,6 % | −27,6 % | 1913 Matches, +0,5 % | 0 Matches |

Zeitpunkt der Spezialisierungen (Stand nachher, Einsätze über 1000 Matches und beide Spieler):

| Karte | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | Lane-Lvl 1 / 2 / 3 | Ø Runde | Abwürfe | am Ende auf der Hand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tower-lightning | 0 | 0 | 61 | 85 | 35 | 42 | 34 | 6 | 0 / 263 / 0 | 4,70 | 870 | 966 |
| tower-shield | 0 | 0 | 69 | 75 | 36 | 55 | 32 | 5 | 0 / 272 / 0 | 4,71 | 852 | 966 |
| line-upgrade (Feld-Upgrade) | 647 | 1058 | 688 | 599 | 426 | 312 | 0 | 0 | – | 3,01 | – | – |

Vor dem Vorrang lagen die Karten bei Ø Runde 5,09 (`tower-lightning`) und 5,04 (`tower-shield`), sonst gleich.

## Ursache der Abweichung

Die Vermutung „zu spät gespielt“ ist **widerlegt**. Gemessen:

1. **Lane-Level, nicht Runde, begrenzt die Karten.** Beide Karten verlangen eine Lane ab Lvl 2 (`SPECIALIZE_MIN_LEVEL`).
   Sie wurden nur auf Lvl-2-Lanes gespielt (0 auf Lvl 1, 0 auf Lvl 3), frühestens in Runde 3. Ein Spieler kauft eine
   solche Lane (5 Energie) nur in Runde 2 oder 3 (`roundsLeft ≥ LANE_COST`); 1530 von 2000 Spieler-Matches (76,5 %)
   kaufen nie eine. Die Karte wird dort abgeworfen (rund 860 Mal je Karte) oder liegt am Ende auf der Hand (rund 966 Mal)
   und kommt in nur rund 13 % der Spieler-Matches zum Einsatz.
2. **Die Abweichung kommt vom Lane-Kauf, nicht von der Karte.** Spieler mit gekaufter Lane ab Lvl 2 gewinnen 25,1 % (470
   Spieler-Matches), alle anderen 57,6 % (1530). Wer die Spezialisierung spielt, hat die Lane gekauft: 453 Spieler-Matches,
   23,2 % Siege. Wer die Lane kauft und nicht spezialisiert, gewinnt 76,5 % (nur 17 Spieler-Matches, wenig Aussage). Die
   Karte misst also den Preis von 5 Energie plus 2 Energie für die Karte in Runde 2/3, in denen der Spieler sonst
   Minions beschwört (Auswahleffekt). Der Test `balance-diagnose.test.ts` hält Punkt 1 und 2 fest.
3. **Früher spielen hilft nicht.** Der Vorrang in `botStep` senkte die mittlere Runde von 5,1 auf 4,7, die Abweichung
   blieb. Ein weiterer Versuch (Lane nur kaufen, wenn eine Spezialisierung auf der Hand ist und die Energie für beide
   reicht; Spezialisierung sofort danach) spielte beide Karten in Runde 3 und nur noch rund 45 Mal, doch sie blieben bei
   −20 % bis −24 %. Er wurde verworfen, weil er den Lane-Kauf für alle anderen Fälle abschaltet. Ein Versuch, den
   Lane-Kauf ans Ende der Reihenfolge zu stellen (nur mit übriger Energie), ließ die Karten nie zum Einsatz kommen.

**Ergebnis:** Das Ziel |`deltaToBaseline`| ≤ 0,15 ist ohne Änderung von Kartenwerten oder Wirtschaft nicht erreichbar.
Der Bot kann die Karten nur über den Lane-Kauf nutzen, und dieser kostet in Runde 2/3 mehr, als er bringt. Eine
Ausnahmeliste für die Karten gab es nicht (`KNOWN_CARD_DEVIATIONS` existiert im Repo nicht); es war also nichts zu
streichen. Der Regressionstest sichert die Karten mit der engeren Grenze 0,35 (`MAX_SPECIALIZE_DELTA`) ab; das Ziel 0,15
bleibt für einen Folgeauftrag (z. B. günstigerer Lane-Kauf oder Spezialisierung ab Lvl 1; das sind Kartenwert- bzw.
Regeländerungen und waren hier ausgeschlossen).

## minion-upgrade-elite und line-upgrade

- **`line-upgrade`:** wird jetzt gemessen (Feld-Upgrade, siehe oben), 1913 Matches. Eine Karte im Deck ist es weiterhin
  nicht (0 Kopien).
- **`minion-upgrade-elite`: weiter 0 Matches, Ursache im Kartenpool, nicht im Bot.** `DECK_CYCLE` beträgt 27 Karten
  (Summe der Kopien in `CARD_BALANCE`), das Match-Deck aber nur `START_HAND + DRAW_PER_ROUND · (MAX_ROUNDS − 1)` = 26.
  `buildDeck` kürzt den Pool vor dem Mischen mit `pool.length = length`; die letzte Karte in `CARD_DEFS` (die
  Elite-Drill) fällt dabei immer weg. Der Bot kann sie nie ziehen. Das zu ändern verschiebt die Decks aller Seeds (und
  damit Replays und Fixtures) und gehört nicht in einen reinen Bot-Auftrag. **Vorschlag für einen eigenen Auftrag:**
  Deck-Länge oder Kürzung so ändern, dass jede Karte des Zyklus vorkommt (z. B. erst mischen, dann kürzen), danach
  Messlauf, Fixtures und `balance-regression.test.ts` neu abgleichen.
