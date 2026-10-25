# Anwendung: Handlimit-Regel mit Tests

Diese Seite beschreibt, was der Auftrag „Handlimit-Regel mit Tests absichern und dokumentieren“ umgesetzt hat und worauf
zu achten ist. Die Regel steht im [Designkonzept](designkonzept.md), Abschnitt 3 „Kartenhandling“.

## Die Regel

`HAND_LIMIT = 10` ist **bestätigt** (`src/logic/match.ts`). `startRound` hängt die neu gezogenen Karten ans Ende der Hand
und kürzt die Hand danach auf `HAND_LIMIT`:

- Es gilt die **Reihenfolge der Ankunft**: Die ersten 10 Karten bleiben, die zuletzt gezogenen verfallen.
- Verfallene Karten zählen als gezogen (`state.drawn` steigt um `DRAW_PER_ROUND`). Die nächste Runde zieht die nächsten
  Deckkarten, nicht die verfallenen noch einmal.
- Das Limit gilt **pro Spieler**. Wer weniger Karten hat, wird nicht gekappt.
- Es gibt keine Ablage für verfallene Karten. Die Ablage enthält nur gespielte Karten.

```mermaid
flowchart TD
    A[Runde n beginnt: startRound] --> B{Runde 1?}
    B -- ja --> C[5 Karten ziehen]
    B -- nein --> D[3 Karten ziehen]
    C --> E[state.drawn erhöhen]
    D --> E
    E --> F[Karten ans Ende der Hand]
    F --> G{Hand > HAND_LIMIT?}
    G -- ja --> H[Hand auf 10 kürzen: letzte Karten verfallen]
    G -- nein --> I[Hand unverändert]
```

Mit den Werten `START_HAND = 5` und `DRAW_PER_ROUND = 3` (Soll-Werte des Designkonzepts) hat die Hand in Runde 1 5 und in
Runde 2 8 Karten; es verfällt nichts. Erst in Runde 3 greift das Limit: 8 + 3 = 11, davon bleiben 10. Das Deck hat
`START_HAND + DRAW_PER_ROUND * (MAX_ROUNDS - 1)` = 26 Karten.

## Ergebnis des Auftrags

`startRound` war richtig und blieb **unverändert**; alle neuen Tests waren auf Anhieb grün.

| Datei | Änderung |
| --- | --- |
| `src/logic/match.test.ts` | Neuer `describe`-Block „Handlimit“ mit neun Tests |
| `src/logic/match.ts` | Kommentar zu `HAND_LIMIT`: „bestätigt“ statt „noch zu bestätigen“ |
| `README.md` | `HAND_LIMIT = 10` als bestätigt; Karten verfallen am Ende der Hand, es gilt die Ankunftsreihenfolge |
| `docs/designkonzept.md` | „wandern in die Ablage“ ersetzt durch „verfallen“; die Ablage-Zeile nennt nur gespielte Karten |

Die Zeile zur Ablage im Designkonzept wurde zusätzlich angepasst, weil sie sonst dem neuen Text widersprochen hätte.
`src/scenes/main-scene.ts` (`human.hand.slice(0, HAND_LIMIT)`) ist reine Darstellung und blieb unberührt.

## Die Tests (`src/logic/match.test.ts`, Block „Handlimit“)

Alle Tests nutzen feste Seeds und rechnen die Zeit über `advance(state, COMBAT_TICKS * TICK_MS)`; es gibt weder
Zufallswerte noch Frame-Zählung.

| Test | Prüft |
| --- | --- |
| Runde 1 | 5 Startkarten liegen unter dem Limit, nichts verfällt |
| Runde 2 | Beide Spieler halten 8 Karten, keine verfällt |
| Runde 3 | Die ersten 10 in Ankunftsreihenfolge bleiben, die letzte (11.) verfällt |
| Genau am Limit | Bei 7 Handkarten vor dem Ziehen (7 + 3 = 10) verfällt nichts |
| Unter dem Limit | Bei weniger als 7 Handkarten kommen alle neuen Karten auf die Hand |
| `drawn` | `state.drawn` steigt auch bei verfallenen Karten um `DRAW_PER_ROUND`; die nächste Runde zieht die nächsten Deckkarten |
| Pro Spieler | Ein Spieler mit weniger Handkarten wird nicht auf 10 gekappt |
| Alle Runden | Bis `MAX_ROUNDS` überschreitet keine Hand `HAND_LIMIT` |
| Reproduzierbarkeit | Gleicher Seed ergibt dieselbe Hand nach dem Verfall |

Hilfsfunktionen im Block: `nextRound(state)` (beide „Bereit“, dann der ganze Kampf) und
`withPlayerHand(state, player, count)` (setzt die Hand eines Spielers auf die ersten `count` Deckkarten).

Testlauf: `npm run typecheck`, `npx vitest run src/logic/match.test.ts` und `npm run test:smoke` waren grün. Der Review
war freigegeben, ohne blockierende Befunde.

## Worauf zu achten ist

- **Abdeckung nicht messbar:** `@vitest/coverage-v8` ist nicht installiert, Prozentwerte liegen deshalb nicht vor.
- **Schwacher Test Runde 1:** Er prüft nur `createMatch`, nicht den Weg über `startRound`. Das genügt, weil
  `createMatch` die Runde 1 aufbaut.
- **Verfallene Karten indirekt geprüft:** Der Reihenfolge-Test prüft die Länge der verfallenen Karten und die
  verbleibende Hand per `toEqual`, nicht ausdrücklich „nicht auf der Hand“.
- **Formatierung:** Im Test „genau `HAND_LIMIT`“ ist die Zeile mit `withPlayerHand(withPlayerHand(...))` sehr lang.
- **Soll-Werte umgesetzt:** `START_HAND` 5 und `DRAW_PER_ROUND` 3 entsprechen der Tabelle „Soll-Änderungen an
  Konstanten“ (Abschnitt 3 des Designkonzepts). Das Limit greift dadurch erst in Runde 3. Bei einer weiteren Änderung
  der Konstanten sind die Tests für Runde 2 und 3 zu prüfen.
- **Folgeauftrag, falls gewünscht:** Eine Ablage für verfallene Karten gehört nicht zu diesem Auftrag. Sie müsste als
  eigener Auftrag mit Zustandsfeld, Tests und Anzeige umgesetzt werden.
