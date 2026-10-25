# Turm-Slots, Lane-Karten und Abwerfen (Aufzeichnungsformat Version 6)

## Regeln

| Thema | Regel | Code |
| --- | --- | --- |
| Turm-Slots | Jeder lebende Tower bietet zwei Slots, oben (Seite 0) und unten (Seite 1); Slot-Nummer = `2 · Tower-Index + Seite`. Je Slot höchstens eine Einheit. Ein zerstörter Tower bietet keine Slots. | `placement.ts` (`validSlots`, `isSlotFree`, `firstFreeSlot`) |
| Start der Einheit | Sie startet auf der Position ihres Towers (`Tower.offset`) und kämpft jede Runde von dort aus, ohne neu gesetzt zu werden. Einheiten auf zerstörten Towern entfallen beim Rundenwechsel. | `match.ts` (`respawnSurvivors`) |
| Verschieben | Auf einen freien Slot einer beliebigen freien Lane, kostet `MOVE_COST` = 1 Energie, nur vor „Bereit“. Zu wenig Energie: abgelehnt, Einheit bleibt. | `match.ts` (`moveMinion`) |
| Abwerfen | Eine Handkarte fällt weg, der Spieler erhält `DISCARD_ENERGY` = 1 Energie, höchstens bis `MAX_ENERGY`. Der Bot wirft nutzlose Karten ab, wenn die Energie danach eine bevorzugte Karte bezahlbar macht. | `match.ts` (`discardCard`), `bot.ts` |
| Lane-Karten | Neuer Kartentyp `lane-card` (`lane-buff`: +25 % Schaden, `lane-shield`: −30 % erlittener Schaden) für alle Minions der Lane. Sie liegt im Lane-Slot hinter den Towern, je Lane höchstens eine (`lane-slot-taken`), und gilt nur für die laufende Runde. | `combat.ts`, `match.ts` (`LineState.laneCard`) |
| Neue Karten | Späher, Wächter, Magier, Lane-Buff, Lane-Schild, Tower Panzer, Elite-Drill (am Ende von `CARD_DEFS`, alle im Deck). | `cards.ts` |
| Lanes je Spieler | `PlayerState.level` und die Tower der Lanes gelten je Spieler; „Lane +1“ schaltet nur die eigenen Lanes frei, auch für den Bot. | `match.ts` |
| Spielende | Sobald ein Spieler keinen lebenden Tower mehr hat (`towersAlive === 0`), siehe `destroyedOutcome`. | `match.ts` |

## Bedienung

- **Karte ziehen** (Beschwörung oder Lane-Karte): An jedem freien, gültigen Slot erscheint ein grüner Punkt. Je näher der
  Zeiger, desto größer und heller der Punkt (`slotProximity`); der nächste Punkt in `SNAP_RADIUS` ist voll hervorgehoben,
  die Kartenfigur gleitet dorthin. Loslassen in Reichweite setzt die Einheit, sonst fliegt die Karte zurück in die Hand.
- **Karte antippen, dann Lane oder Punkt antippen** setzt wie bisher auf den ersten freien Slot bzw. den getippten Punkt.
- **Einheit ziehen** verschiebt sie (−1 Energie). Am Slot zeigt ein Ring in der Kartenfarbe die Einheit, eine Linie führt
  zum Tower, das Kürzel (z. B. „T2u“) nennt Turm und Seite.
- **Abwerfen:** Karte wählen und „Abwerfen +1“ tippen oder die Karte auf die Taste ziehen.

## Aufzeichnung (Version 6)

Neu gegenüber Version 5: `p<R><P>-<Karte>-<Lane>-<Slot>` (Slot nur bei gewähltem Slot, sonst erster freier),
`d<R><P>-<Karte>` (Abwerfen) und die Kartenliste mit sieben neuen Karten. Ältere Links werden abgelehnt
(`RECORD_VERSION`); das Bot-Replay spielt das Abwerfen des Bots als Ereignis ab.

## Tests

`placement.test.ts`, `match.test.ts`, `combat.test.ts`, `bot.test.ts`, `match-record.test.ts`, `replay.test.ts`,
`cards.test.ts` und die E2E-Tests in `e2e/gameplay.spec.ts` (Drag auf Slots, grüne Punkte, Verschieben, Abwerfen,
Lane-Karte). `e2e/turm-slots.spec.ts` prüft das Ziehen über besetzte und freie Slots ohne Konsolenfehler.
