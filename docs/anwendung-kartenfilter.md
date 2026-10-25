# Kartenfilter für die Hand

Im Match gibt es links neben der Taste „Bereit“ eine Filtertaste. Sie blendet die Handkarten nach Kartentyp ein und aus.
Das hilft bei voller Hand (Handlimit 10). Es ist eine reine Darstellungs- und Eingabehilfe; die Spielregeln ändern sich
nicht.

## Bedienung

- Die Taste zeigt „Filter: <Name> (<Anzahl>)“, z. B. „Filter: Upgrade (3)“. Die Zahl ist die Anzahl der passenden
  Handkarten.
- Jeder Tipp schaltet weiter: **Alle → Beschwörung → Upgrade → Tower → Alle**.
- Nicht passende Karten sind stark abgedunkelt, ohne Text und reagieren nicht auf Tippen.
- Die Karten bleiben auf ihren festen Slots (`cardRect(index)`). Es gibt keine Neuanordnung, deshalb braucht es keine
  Abbildung von Anzeige-Slot auf Hand-Index. `selected`, `handleTap` und `playCard(state, HUMAN, handIndex, line)`
  arbeiten mit dem unveränderten Hand-Index.
- Wird die gewählte Karte (`selected`) durch den Filterwechsel ausgeblendet, wird sie abgewählt (`selected = null`).
- Beim Start eines Matches (`create()`) steht der Filter auf „Alle“. Er wird nicht gespeichert.

## Zuordnung Kartentyp → Filter

| Filter | `CardType` |
| --- | --- |
| Beschwörung | `summon` |
| Upgrade | `line-upgrade`, `minion-upgrade` |
| Tower | `tower-upgrade`, `tower-specialize` |
| Alle | alle Typen |

## Für Entwickler

| Datei | Inhalt |
| --- | --- |
| `src/logic/hand-filter.ts` | `HandFilter`, `HAND_FILTERS`, `HAND_FILTER_NAMES`, `nextHandFilter`, `isCardVisible(type, filter)` (rein, ohne Phaser) |
| `src/logic/hand-filter.test.ts` | Jede Kombination aus `CardType` und Filter sowie die Umschaltreihenfolge (17 Tests) |
| `src/scenes/main-scene.ts` | `LAYOUT.filterButton` (x 122, y 592, 102 × 40), Feld `handFilter`, `isVisibleInHand`, Tipp-Handler, Handzeichnung |
| `e2e/smoke.spec.ts` | Fall „Kartenfilter“: Tastenreihenfolge, Abwahl, tote Karten, echter Hand-Index |

Die Filtertaste liegt unterhalb der Handkarten (bis ca. y = 572) und überdeckt weder diese noch die Taste bei
`LAYOUT.button` (230/592).

## Worauf zu achten ist

- **Feldname:** Der Auftrag nennt `selectedCard`, das Szenenfeld heißt `selected`.
- **Nur Darstellung und Eingabe:** `match.ts`, `combat.ts`, `bot.ts` und `cards.ts` sind nicht geändert. Bot,
  Match-Ablauf und Statistik-Overlay sind unberührt. Der Filter betrifft nur die eigene Hand.
- **Filterwechsel nur in der Planung:** `handleTap` kehrt außerhalb der Planungsphase vor der Filtertaste zurück
  (`main-scene.ts`, Prüfung `phase !== 'planning'`). In Kampf und Ende lässt sich der Filter also nicht ändern. Der
  Reviewer ging von einem Wechsel auch dort aus; der Code zeigt das Gegenteil. Der gewählte Filter bleibt in der
  Kampfphase aktiv und gilt für die Darstellung der Hand.
- **Meldungstext:** `this.message` (unten, Größe 10) hat keine Breitenbegrenzung. Ein sehr langer Text könnte unter die
  Filtertaste ragen. Karten und die Taste bei 230/592 sind davon nicht betroffen.
- **Tastentext:** „Filter: Beschwörung (10)“ bricht in zwei Zeilen um und passt in die 40 px Höhe.
- **Neue Kartentypen:** Wird `CardType` erweitert, muss `GROUPS` in `hand-filter.ts` ergänzt werden. Der Typ
  `Record<CardType, …>` meldet das beim Build.
