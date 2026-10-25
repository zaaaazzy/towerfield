# Replay-Szene (`?replay=<seed>` und `?replay=<seed>&moves=<kodiert>`)

Die Replay-Szene spielt ein Match ohne jede Eingabe ab. Es gilt im Dev-Server und im Produktions-Build. Es gibt zwei
Quellen für die Züge:

| URL | Inhalt |
| --- | --- |
| `?replay=<seed>` | **Bot-Replay:** Beide Seiten spielt der Bot (wie bisher). |
| `?replay=<seed>&moves=<kodiert>` | **Aufgezeichnetes Match:** die Züge eines in der `MainScene` gespielten Matches, beider Seiten. |

## Ablauf

1. **Planung:** Blau (Spieler 0) und Orange (Spieler 1) führen pro 700 ms eine Aktion aus. Jede erscheint als Kommentar
   im Band unten, z. B. „Runde 2 · Blau spielt Minion auf Line 3“. Beim aufgezeichneten Match kommen „verschiebt …“,
   „nimmt … zurück“ und „ist bereit“ dazu, in genau der Reihenfolge, in der gespielt wurde.
2. **Kampf:** Läuft in Zeitlupe (`delta` × 0,35). Die Regeln und Ticks sind dieselben wie im normalen Match.
3. **Ende:** Die Szene zeigt das Ergebnis und die Teilen-URL. Ein Tastendruck oder Klick startet dasselbe Replay neu.
   Weitere Eingaben gibt es nicht (keine Pause, kein Spulen, keine Geschwindigkeitswahl).

## Aufzeichnen und Teilen

Die `MainScene` schreibt jede erfolgreiche Aktion beider Spieler mit (Karte spielen, Minion verschieben, Beschwörung
zurücknehmen, bereit). Die Aufzeichnung liegt außerhalb des Spielzustands; `match.ts` und die Regeln sind unverändert.
Nach Spielende zeigt das Ende-Bild (nach „Schließen“ der Statistik) die Teilen-URL, in Zeilen umgebrochen (bei sehr langen
Links gekürzt), und den Knopf **Link kopieren**, der die vollständige URL in die Zwischenablage legt. Die URL öffnet
dasselbe Match als Replay. Der Seed steht in `replay`, die Züge in `moves`.

Ein Seed bestimmt Deck und Zufall; ohne eigene Züge in `moves` ist `?replay=<seed>` weiterhin das Bot-Replay.

## Format von `moves` (Version 1)

Nur die Zeichen `0-9 a-z . -`, damit nichts maskiert werden muss. Aufbau: `v1` und dahinter jede Aktion mit einem `.`.

| Aktion | Token | Felder |
| --- | --- | --- |
| Karte spielen | `p<R><P>-<Karte>[-<Line>]` | Karte = Index in `CARD_DEFS`, Line 0–2 (bei Karten ohne Ziel weggelassen) |
| Minion verschieben | `m<R><P>-<Minion>-<Line>-<Slot>` | Minion-Id, Ziel-Line, Slot |
| Beschwörung zurücknehmen | `u<R><P>-<Minion>` | Minion-Id |
| Bereit | `r<R><P>` | – |

`<R>` ist die Runde (1–8), `<P>` der Spieler (0 Blau, 1 Orange). Beispiel: `v1.p10-3-1.m10-1-2-0.r10`. Ein Match mit
8 Runden bleibt weit unter 4000 Zeichen (Obergrenze beim Lesen: 4000 Zeichen, 800 Aktionen).

**Versionierung:** Ändern sich Regeln oder die Kartenliste, muss `RECORD_VERSION` in `src/logic/match-record.ts` steigen
(der Test `match-record.test.ts` hält die Kartenliste fest und erinnert daran). Links einer anderen Version gelten als
ungültig und werden wie unten beschrieben behandelt.

## Ungültige Daten

Nichts davon erzeugt einen Absturz oder `console.error`.

- **`?replay=abc` oder `?replay=`** (kein gültiger Seed): normale `MainScene`, wie bisher.
- **`moves` nicht lesbar** (leer, abgeschnitten, unbekannte Version, Zeichen oder Zahlen außerhalb des Formats, zu lang):
  Die Replay-Szene bleibt mit dem Hinweis „Replay gestoppt – Die Zugdaten sind ungültig.“ stehen.
- **`moves` lesbar, aber regelwidrig** (z. B. zu wenig Energie, Karte nicht auf der Hand, falsche Runde): Das Replay läuft
  bis zur letzten gültigen Aktion und bricht dann mit „Replay abgebrochen bei Zug N: <Grund>“ ab. Dasselbe gilt, wenn die
  Aufzeichnung vor dem Spielende aufhört oder danach noch Züge enthält.
- In beiden Fällen startet ein Tastendruck oder Klick ein neues Spiel (`MainScene`).

## Für Entwickler

| Datei | Inhalt |
| --- | --- |
| `src/logic/seed.ts` | `parseReplaySeed(search)`, `parseReplayMoves(search)` (roher Wert oder `null`) |
| `src/logic/match-record.ts` | Aufzeichnung (`createRecord`, `performAction`, `botPlanRecorded`), `applyAction`, `encodeMatch`/`decodeMatch`, `shareQuery`, `replayRecorded` (Nachspielen ohne Zeitlupe, mit Prüfung) |
| `src/logic/replay.ts` | `createReplay` (Bot), `createRecordedReplay`, `createInvalidReplay`, `stepReplay`, `describeEvent`, `describeAbort`, `SLOWMO_FACTOR`, `PLAY_PAUSE_MS` |
| `src/logic/bot.ts` | `botStep` (ein Zug des Bots); `botPlan` nutzt es, Verhalten unverändert |
| `src/scenes/replay-scene.ts` | Szene `replay`: liest `replay` und `moves`, ruft `stepReplay`, zeichnet Feld, Kommentare, Hinweis |
| `src/scenes/main-scene.ts` | Läuft über `performAction`/`botPlanRecorded`, zeigt die Teilen-URL im Ende-Bild |
| `src/scenes/share.ts` | Teilen-URL bauen, umbrechen, in die Zwischenablage kopieren |

Bot-Pfad und aufgezeichneter Pfad teilen sich `stepReplay`, den Takt, die Zeitlupe und `describeEvent`. `ReplayEvent` hat
das optionale Feld `action` (`move`, `undo`, `ready`; ohne Angabe eine gespielte Karte). Karten werden beim Nachspielen über
ihre ID in der Hand gefunden, nicht über den Handindex.

Tests: `src/logic/match-record.test.ts` (Aufzeichnung, Round-Trip, Gleichheit des `MatchState`, ungültige Daten,
regelwidrige Aktion), `src/logic/replay.test.ts`, `src/logic/seed.test.ts`, `src/logic/bot.test.ts`; Smoke-Tests in
`e2e/smoke.spec.ts` (gültige Züge, ungültige Zugdaten, Teilen-URL der `MainScene`). `src/logic/match-record-fixture.ts` ist
nur eine Testhilfe (spielt ein Match mit Verschieben und Zurücknehmen).

`src/main.ts` startet die Replay-Szene als erste Szene, sobald `parseReplaySeed` einen gültigen Wert liefert (Dev und
Produktion); `moves` liest die Szene selbst. Ohne gültigen Parameter bleibt alles beim Alten (`MainScene`, `?seed=`,
`?scene=balance`).

## Worauf zu achten ist

- **Dauer:** Ein Replay über alle Runden dauert in echter Zeit lange (bis etwa 450 s), weil die Kampfphase mit Faktor
  0,35 läuft. Eine Geschwindigkeitswahl oder Pause gibt es bewusst nicht.
- **Alte Links:** Nach einer Regeländerung sind aufgezeichnete Links nur mit erhöhter Version erkennbar ungültig; ohne
  Versionssprung brechen sie an der ersten abweichenden Aktion ab oder enden anders.
- **Lange Seeds:** `decodeMatch` kürzt Seeds mit bis zu 15 Ziffern auf 32 Bit (`0xffffffff`). Das geschieht beim
  Aufzeichnen und Nachspielen gleich, das Replay bleibt also konsistent (Test in `match-record.test.ts`).
- **Handbuch:** `docs/handbuch.md` beschreibt das Teilen für Spieler; diese Datei ist die technische Anwendungsdoku.
- **Keine neuen Regeln:** `MatchState` und die Spielregeln sind unverändert; das Replay nutzt `createMatch`, `playCard`,
  `moveMinion`, `undoSummon`, `setReady` und `advance`. Gespeichert wird nur in der URL.
- **`MainScene` und Undo:** Die `MainScene` bietet „Beschwörung zurücknehmen“ noch nicht an; das Format und das Replay
  kennen die Aktion trotzdem (Tests).
- **Teilen-URL:** Sie wird aus `window.location.origin` und `pathname` plus `shareQuery` gebaut. Auf der Leinwand lässt
  sich Text nicht markieren, deshalb gibt es „Link kopieren“.
- **Zeichenhelfer:** `LabelPool`, `drawBoard`, `drawMinions` und `drawTower` werden von `MainScene` und `ReplayScene`
  gemeinsam genutzt. Bei Änderungen daran beide Szenen prüfen.
