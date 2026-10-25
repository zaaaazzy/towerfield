# TowerField – Technisches Handbuch

Stand: Auftrag „Handbuch: Spielregeln und Kartenwerte abgleichen“ (Version 0.1.0). Der Stand baut auf den
Aufträgen „Replay gespielter Matches per URL-Parameter“, „Grafische Überarbeitung im Fantasy-Kartenspiel-Stil“, „Heiler-Karte“, „Kartenfilter für die Hand im Match“, „Replay-Szene“, „Minion-Statistik-Overlay nach Match-Ende“, „Fernkämpfer Bogenschütze“, „Start- und Zieh-Konstanten“, „E2E-Tests“, „Dev-Szene mit Balancing-Statistik“,
„Minion-Tempo“, „Tower-Reichweite 20“, „Energie-Maximum 8“, „Bot-Strategie“, „Handlimit“, „Drag-and-Drop“,
„Designkonzept“ und „Kern-Logik“ auf.

> **Quellenlage**
> - Geprüft gegen den Code: `package.json` (Skripte), `src/logic/combat.ts`, `src/logic/match.ts` (Kopf, Konstanten,
>   Typen), `src/logic/match-stats.ts`, `src/logic/replay.ts`, `src/logic/seed.ts`, `src/scenes/replay-scene.ts`,
>   `src/main.ts`, `src/logic/hand-filter.ts`, die Filter-Stellen in `src/scenes/main-scene.ts`. `bot.ts` nur an den
>   Schnittstellen (`botStep`, `botPlan`).
> - Abgleich dieses Stands, gegen den Code geprüft: Kartenwerte und Kopienzahlen (`src/logic/cards.ts`), die Regeltabelle,
>   der Rundenablauf und die Siegbedingungen (`src/logic/match.ts`: `startRound`, `respawnSurvivors`, `advance`,
>   `destroyedOutcome`, `hpOutcome`), das Kampfmodell und die Heilung (`src/logic/combat.ts`), die Kartenpriorität
>   (`src/logic/bot.ts`, `PRIORITY`), die Konstanten in Abschnitt 4 sowie die Platzierungsformel (`lineCapacity`,
>   `playCard`). Soll-Werte aus `docs/designkonzept.md` sind verglichen; Abweichungen stehen in „Abweichungen zum
>   Designkonzept“ (Abschnitt 2).
> - Weiterhin nicht neu gegen den Code geprüft: `src/logic/placement.ts` (Slotpositionen, `PLACEMENT_ZONE_END`),
>   `main-scene.ts` (außer den Filter-Stellen) und die Testbeschreibungen in Abschnitt 6. Die Balance-Szene und
>   `balance-sim` sind nicht neu bewertet.
> - Heiler: gegen `cards.ts`, `combat.ts` (Felder `maxHp`, `heals`, Heilformel) und `match.ts` (Beschwören) geprüft sowie
>   gegen `docs/anwendung-heiler.md`.
> - Grafik: gegen `docs/grafik-stil.md`, `docs/anwendung-grafik-ueberarbeitung.md`, die Dateiliste der Szenen und die
>   Exporte von `field-view.ts`, `labels.ts`, `effects.ts`, `card-view.ts`, `textures.ts` geprüft. Das Innenleben der
>   Zeichenfunktionen habe ich nicht neu gelesen.
> - Ich habe keine Tests und keinen Build ausgeführt. Laut Tester: Typecheck grün, Unit-Tests zu `card-style` und
>   `fx-events` (11) grün, Smoke 17 bestanden; Screenshots wurden nicht geprüft. Der Review war freigegeben.
> - Teilen und Abspielen von Matches: gegen `docs/anwendung-replay.md` (vom Dokumentierer mit dem Code abgeglichen) und die
>   Berichte von Entwickler und Reviewer. `match-record.ts`, `share.ts` und die Szenen habe ich nicht selbst neu gelesen.
>   Laut Tester: Typecheck, 43 Unit-Tests der betroffenen Dateien und 20 Smoke-Fälle grün; der Review war freigegeben.
> - Nichts committet. Zeilenangaben für `main-scene.ts` sind ungefähr.

## Änderungen in diesem Stand

Dieser Stand ändert nur das Handbuch (`docs/handbuch.md`), keinen Code:

| Thema | Vorher | Jetzt |
|---|---|---|
| Überlebende Minions | „bleiben stehen“ | werden zu Rundenbeginn auf die niedrigsten freien Slots zurückgesetzt (`respawnSurvivors`) |
| Siegbedingung | Tower-Zerstörung und Wertung kurz | genauer: Prüfung nach jedem Tick, beide ohne Tower = Unentschieden, Wertung nur nach Runde 8 |
| Deck | „26 Karten“ | Zusammensetzung beschrieben (ein voller Durchgang plus 9 Karten) |
| Kampfmodell | ohne Tie-Break und Tower-Bedingung | Zielwahl, Gleichstand, zerstörte Tower, Heiler ohne Ziel ergänzt |
| Designkonzept | ohne Vergleich | Abschnitt „Abweichungen zum Designkonzept“ |
| Offene Punkte | veraltete Smoke-Angaben | korrigiert, möglicher Code-Fehler beim Tower-Upgrade vermerkt |
| Kartenwerte, Konstanten | – | unverändert, stimmen mit dem Code überein |

Frühere Änderung (Replay gespielter Matches):

| Thema | Vorher | Jetzt | Datei |
|---|---|---|---|
| Aufzeichnung | keine | `MainScene` zeichnet jede erfolgreiche Aktion beider Spieler auf (außerhalb von `MatchState`) | `match-record.ts`, `main-scene.ts` |
| Format | – | kompakter String `v2…` aus Seed und Aktionen, `encodeMatch`/`decodeMatch` mit Versionskennung | `match-record.ts` |
| URL | `?replay=<seed>` (nur Bot) | zusätzlich `?replay=<seed>&moves=<kodiert>`; ohne `moves` weiter Bot-Replay | `seed.ts`, `replay-scene.ts` |
| Replay-Quelle | nur Bots | Bots oder vorgegebene Aktionen; `ReplayEvent` kennt Verschieben, Zurücknehmen, Bereit | `replay.ts` |
| Ende-Bild | Statistik, Tippen = neues Spiel | zeigt zusätzlich Teilen-URL und Knopf „Link kopieren“ | `main-scene.ts`, `share.ts` |
| Ungültige Links | – | Hinweis „Replay gestoppt“ bzw. „Replay abgebrochen bei Zug N“, kein `console.error` | `replay.ts`, `replay-scene.ts` |
| Smoke | 17 Fälle | 20 Fälle (gültige Züge, ungültige Zugdaten, Teilen-URL) | `e2e/smoke.spec.ts` |

Nicht geändert (Teilen): `match.ts` und alle Regeln, `MatchState`, `main.ts`, Bot-Replay ohne `moves`, `parseReplaySeed`.
Details: `docs/anwendung-replay.md`.

Frühere Änderung (Grafik):

| Thema | Vorher | Jetzt | Datei |
|---|---|---|---|
| Stil | Farben verstreut (`COLORS` in `main-scene.ts`) | zentral: Palette, Schriften, Rahmen, Panel/Balken/Knopf | `theme.ts` |
| Hintergrund, Boden, Partikel | einfarbige Flächen | Texturen zur Laufzeit (Verlauf, Vignette, Wege, Holztisch) | `textures.ts` |
| Handkarten | einfache Rechtecke | Rahmen, Name, Kosten-Kristall, Bild, Text, Banner; Typ durch Farbe und Symbol | `card-view.ts`, `card-style.ts` |
| Hover/Auswahl | – | Anheben (bis 110 %), Schatten, Leuchten; Ausspielen animiert | `card-view.ts`, `main-scene.ts` |
| Feld | flach | Tower, Minions, Bauplätze mit Schatten, Leuchten, Teamfarben | `field-view.ts` |
| Effekte | keine | Partikel, Ringe, Schadenszahlen, Kamerawackeln; Ereignisse aus `diffFx` | `effects.ts`, `fx-events.ts` |
| Hilfsmodule | `LabelPool`, `drawBoard`, `drawMinions` in `main-scene.ts` | `labels.ts` und `field-view.ts` | `src/scenes/` |
| E2E | – | `e2e/grafik.spec.ts` liest das Feld `lifts` der Szene | `e2e/grafik.spec.ts` |

Nicht geändert (Grafik): Regeln, Kartenwerte, Bot, Seed, alle bestehenden Unit-Tests. Keine Fremdassets,
`public/assets/` bleibt leer. Details: `docs/grafik-stil.md`, `docs/anwendung-grafik-ueberarbeitung.md`.

Frühere Änderung (Heiler):

| Thema | Vorher | Jetzt | Datei |
|---|---|---|---|
| Heiler-Karte | keine | `summon-healer`: Kosten 2, 20 LP, 5 Heilung/s, Reichweite 10, 1 Kopie im Deck | `cards.ts` |
| Heilung im Kampf | keine | `combatTick` heilt pro Tick einen verwundeten Verbündeten derselben Line | `combat.ts` |
| `Minion` | ohne `maxHp`, `heals` | optionale Felder `maxHp` und `heals`; `match.ts` setzt sie beim Beschwören | `combat.ts`, `match.ts` |
| Bot | Prioritätsliste ohne Heiler | `summon-healer` direkt hinter `summon-archer` | `bot.ts` |
| Anzeige | – | Heiler mit grünem Punkt in der Mitte | `main-scene.ts` |

Nicht geändert (Heiler): `match-stats.ts` und `DamageCollector` (Heilung zählt nicht als Schaden), Tower-Regeln,
Szenen, Smoke-Test. Details: `docs/anwendung-heiler.md`.

Frühere Änderung (Kartenfilter):

| Thema | Vorher | Jetzt | Datei |
|---|---|---|---|
| Kartenfilter | keiner | Taste schaltet Alle → Beschwörung → Upgrade → Tower; nicht passende Karten abgedunkelt und tot | `hand-filter.ts`, `main-scene.ts` |
| Smoke-Test | – | Fall „Kartenfilter“ (Reihenfolge, Abwahl, tote Karten, echter Hand-Index) | `e2e/smoke.spec.ts` |

Nicht geändert (Kartenfilter): `match.ts`, `combat.ts`, `bot.ts`, `cards.ts`, Bot, Match-Ablauf, Statistik-Overlay.
(Gilt für den Stand vor dem Heiler.)

Frühere Änderung (Replay):

| Thema | Vorher | Jetzt | Datei |
|---|---|---|---|
| Replay | keine | `?replay=<seed>`: Bot gegen Bot, Zeitlupe, Kommentare | `replay.ts`, `replay-scene.ts` |
| Seed-Parser | `parseSeed` | zusätzlich `parseReplaySeed` | `src/logic/seed.ts` |
| Bot | `botPlan` mit eigener Schleife | neu `botStep` (ein Zug); `botPlan` ruft es auf, Verhalten gleich | `src/logic/bot.ts` |
| Zeichnen | privat in `MainScene` | `LabelPool`, `drawBoard`, `drawMinions`, `drawTower` exportiert | `src/scenes/main-scene.ts` |
| Szenenauswahl | `MainScene` / Dev: `?scene=balance` | gültiges `?replay=` startet `ReplayScene` zuerst (Dev und Produktion) | `src/main.ts` |

Frühere Änderung (Minion-Statistik):

| Thema | Vorher | Jetzt | Datei |
|---|---|---|---|
| Statistik | keine | `MatchState.stats` (nur Spieler 0) | `src/logic/match-stats.ts`, `match.ts` |
| `combatTick` | `(players, deltaSeconds)` | optionaler dritter Parameter `collector` | `src/logic/combat.ts` |
| Match-Ende | Ergebnistext, Tippen startet neu | Overlay mit zwei Tabellen, erst „Schließen“, dann Tippen | `src/scenes/main-scene.ts` |
| E2E-Neustart | tippt direkt | prüft Overlay, tippt daneben, schließt, startet neu | `e2e/gameplay.spec.ts` |

Nicht geändert: Balance, Regeln, Kampfablauf, `MatchState`, Balance-Szene. Details: `docs/anwendung-kartenfilter.md`,
`docs/anwendung-replay.md` und `docs/anwendung-minion-statistik.md`.

## 1. Zweck

Mobiles 1-gegen-1-Tower-Defense-Spiel mit Karten im Browser (Phaser 3, TypeScript, Vite).

- Hochformat 360 × 640, Touch und Maus, `Phaser.Scale.FIT`.
- Lokal gegen einen deterministischen Bot. Kein Online-Spiel, keine Accounts, keine Töne. Die Grafik entsteht komplett im Code (Abschnitt „Grafik“).
- Kampf ohne Zufall. Der Seed legt die Kartenreihenfolge und (über einen eigenen Event-Seed) die Runden-Ereignisse
  der Runden 3 und 6 fest (`src/logic/round-events.ts`, siehe `anwendung-rundenereignisse.md`); beide Spieler erhalten
  dieselben Karten und dasselbe Ereignis.
- Phaser bleibt auf Version 3 (API-Doku: https://newdocs.phaser.io/docs/3.90.0).

Weiterführend unter `docs/`: `designkonzept.md` (Soll-Regeln) und die `anwendung-*.md` je Auftrag (Bogenschütze,
Start-/Zieh-Konstanten, Handlimit, Iso-Platzierung, Drag-and-Drop, Bot-Tests, Energie-Maximum, Tower-Reichweite,
Minion-Tempo, Balance-Szene, E2E, Minion-Statistik, Replay, Kartenfilter, Heiler, Grafik-Überarbeitung; Stil und Lizenzen: `grafik-stil.md`).

### Umsetzungsstand

| Bereich | Stand |
|---|---|
| Kernlogik (Karten, Runden, Kampf, Bot) | fertig, getestet |
| **Grafik im Fantasy-Kartenspiel-Stil** | **umgesetzt, getestet (ohne Screenshot-Prüfung)** |
| Reichweite je Minion, Bogenschütze | umgesetzt |
| **Heiler (`summon-healer`)** | **umgesetzt, getestet** |
| Start 5 / Ziehen 3, Handlimit 10, Energie-Max. 8, Tower-Reichweite 20, Minion-Tempo | umgesetzt |
| Minion-Statistik und Overlay nach Match-Ende | umgesetzt, getestet |
| Replay-Szene `?replay=<seed>` | umgesetzt, getestet |
| **Teilen und Abspielen gespielter Matches (`&moves=`)** | **umgesetzt, getestet; „Zurücknehmen“ in der `MainScene` nicht bedienbar** |
| **Kartenfilter für die Hand** | **umgesetzt, getestet** |
| **Handbuch-Abgleich: Kartenwerte, Regeln, Siegbedingungen, Rollen** | **gegen den Code geprüft (dieser Stand)** |
| Balance-Szene `balance` | nur im Dev-Server, nicht neu bewertet |
| Drag-and-Drop von Minions | umgesetzt |
| `iso.ts` (Iso-Umrechnung, Kamera) | fertig, von der Szene nicht genutzt |
| Iso-Szene, Hand-UI, Ablage, Undo-Knopf, Projektile, Tempo-Anzeige | offen |
| Balance Tower 20 gegen Reichweite 14 | offen |

## 2. Spielregeln

| Thema | Regel |
|---|---|
| Spielfeld | Waagrechte Lanes (`src/logic/lanes.ts`, Details in [anwendung-horizontale-lane.md](anwendung-horizontale-lane.md)): Lvl 1 nur die Start-Lane mit 3 Towern je Spieler, Lvl 2 je eine Lane oben und unten (1 Tower), Lvl 3 je eine weitere. Spieler 0 (Mensch) links, Spieler 1 (Bot) rechts. `PlayerState.lines` hat immer 5 Einträge, gesperrte Lanes haben keine Tower. |
| Start | 5 identische Handkarten (`START_HAND`). |
| Ziehen | Ab Runde 2 dieselben 3 Karten für beide (`DRAW_PER_ROUND`). |
| Handlimit | `HAND_LIMIT = 10`; nach dem Ziehen werden die zuletzt gezogenen Karten am Ende der Hand abgeschnitten (keine Ablage). Sie zählen als gezogen. |
| Runden | Planung, dann Kampf, höchstens `MAX_ROUNDS = 8`. |
| Energie | `min(MAX_ENERGY, BASE_ENERGY + (Runde - 1) * ENERGY_PER_ROUND)` = `min(8, 3 + (Runde - 1))`: 3, 4, 5, 6, 7, 8, 8, 8. Wird je Runde neu gesetzt; Unverbrauchtes verfällt. |
| Kampf | `COMBAT_TICKS = 400` Ticks à `TICK_MS = 50` ms (20 s), über `delta` in festen Ticks. |
| Überlebende | Zu Rundenbeginn (`respawnSurvivors`) auf die niedrigsten freien Slots ihrer Lane gesetzt, nach `id` aufsteigend; HP, Werte und Lane bleiben, Tote entfallen. Sie zählen zur Lane-Kapazität, aber nicht zu `placements` (nicht verschieb- oder zurücknehmbar). |
| Sieg | Nach jedem Kampf-Tick: hat ein Spieler keinen lebenden Tower mehr, endet das Match sofort; der andere gewinnt. Haben beide in demselben Tick keinen mehr, ist es unentschieden. Nach den 400 Ticks von Runde 8 gewinnt, wer mehr Tower-LP (Summe aller Tower aller freien Lanes) hat; gleiche Summe ist unentschieden. Vor Runde 8 zählt der Tower-LP-Vergleich nie. |

Deck-Länge: `START_HAND + DRAW_PER_ROUND * (MAX_ROUNDS - 1)` = 26 Karten, Mischung per Seed (Fisher-Yates). Der Vorrat
besteht aus Durchgängen der Kopienzahlen (je 18 Karten); die 26 Karten sind ein voller Durchgang plus die ersten 8
Karten des zweiten (Minion ×4, Brocken ×2, Bogenschütze ×2). Im Deck stecken daher Minion 8, Brocken 4,
Bogenschütze 4, Heiler 1, Zerstörer 1, die übrigen Karten wie in der Tabelle. Beide Spieler ziehen dieselben Karten.

### Karten (`src/logic/cards.ts`)

| ID | Name | Kosten | Wirkung | Reichw. | Tempo | Kopien je Durchgang |
|---|---|---|---|---|---|---|
| `summon-minion` | Minion | 1 | 30 LP, 6 Schaden/s | 4 | 10 | 4 |
| `summon-brute` | Brocken | 2 | 80 LP, 12 Schaden/s | 4 | 8 | 2 |
| `summon-archer` | Bogenschütze | 2 | 20 LP, 7 Schaden/s | 14 | 10 | 2 |
| `summon-healer` | Heiler | 2 | 20 LP, heilt 5 LP/s (`damage`), greift nie an | 10 | 10 | 1 |
| `summon-destroyer` | Zerstörer | 2 | 40 LP, 8 Schaden/s; bei Tod Explosion (Radius 10, 15 Schaden an gegnerische Minions der Lane), siehe [Zerstörer](anwendung-zerstoerer.md) | 4 | 8 | 1 |
| `line-upgrade` | Lane +1 | 2 | Feld-Stufe +1 (max. 3, ohne Ziel): je eine neue Lane oben und unten, ein Slot mehr je Lane | – | – | 2 |
| `tower-hp` | Tower Leben | 1 | +30 max. LP und +30 LP | – | – | 2 |
| `tower-damage` | Tower Schaden | 2 | +4 Schaden/s | – | – | 1 |
| `minion-upgrade-line` | Minions Line | 1 | +10 LP, +2 Schaden für künftige Minions der Line | – | – | 2 |
| `minion-upgrade-all` | Minions alle | 3 | +5 LP, +1 Schaden für künftige Minions aller Lines | – | – | 1 |
| `buff-minion` | Minion stärken | 2 | +50 % `maxHp`, `hp` und `damage` eines eigenen lebenden Minions (Ziel `minion`, Rundung `Math.round`) | – | – | 1 |

Upgrades ändern nur `hp` und `damage`, wirken nur auf später beschworene Minions und sind nicht rücknehmbar.
`buff-minion` wirkt dagegen sofort auf einen Minion: `playCard(state, player, handIndex, line?, slot?, targetMinionId?)`
prüft Phase, Bereit-Status, Karte, Energie und Ziel (eigener Minion mit `hp > 0`, sonst `invalid-target`). Der Zuwachs
ist `buffGain(Wert) = Math.round(Wert × BUFF_RATIO)` aus `buff.ts`; mehrere Buffs wirken nacheinander auf die aktuellen
Werte. `line.bonus` bleibt unberührt, `respawnSurvivors` behält die Werte. Der Bot stärkt den lebenden Minion mit dem
größten `maxHp` oder spielt die Karte nicht. In der Aufzeichnung steht die Ziel-ID anstelle der Lane (`p<R><P>-10-<Id>`,
Format Version 4; ältere Links sind ungültig, weil das Deck sich ändert). In der UI wählt der Spieler die Karte und tippt
dann einen eigenen Minion (grüner Ring).
Eine abgelehnte Karte lässt den Zustand unverändert (`PlayResult.ok === false`, mit `reason`).

Rollen (Werte aus `CARD_DEFS`; ohne eigenes `range` gilt `MINION_RANGE = 4`, ohne `speed` `MINION_SPEED = 10`):
Nahkampf Minion (Reichweite 4, Tempo 10), Tank Brocken (4, Tempo 8), Fernkampf Bogenschütze (Reichweite 14, Tempo 10),
Heiler (`role: 'healer'`, Reichweite 10, Tempo 10; `damage` 5 ist dort Heilung pro Sekunde), Zerstörer
(`role: 'destroyer'`, `explodes`, Reichweite 4, Tempo 8; Kettenreaktion im selben Tick in Wellen). Die Bot-Priorität
(`PRIORITY` in `bot.ts`) lautet: Minion, Bogenschütze, Heiler, Zerstörer, Tower Leben, Line +1, Minions Line, Brocken, Tower
Schaden, Minions alle.

#### Synergien (`src/logic/synergies.ts`)

`SYNERGY_DEFS` listet Paare (`id`, `name`, `cards`, `condition` `sameLine`/`anyLine`, `modifier` `{ stat: 'range', amount }`).
Umgesetzt: `archer-line-upgrade` (`summon-archer` + `line-upgrade`, `sameLine`, Reichweite +2).

- `activeSynergies(played, defs?)` wertet `PlayedCard[]` (`cardId`, `line?`, `minionId?`) reihenfolgeunabhängig aus: je
  Definition und Line höchstens ein Treffer, sortiert nach Definition und Line (`line: null` bei `anyLine`). Eine Karte
  ohne Lane (`line-upgrade`) passt zur Line der anderen Karte; zwei Karten ohne Lane ergeben nichts.
- `PlayerState.played` (in der Runde gespielte Karten) und `PlayerState.synergies` (aktive Synergien) füllt `playCard`
  nach erfolgreichem Spielen; ein Fehler lässt den Zustand unverändert. `undoSummon` und `moveMinion` halten beide aktuell.
  `startRound` leert `played` und entfernt `Minion.rangeBonus`.
- Der Bonus liegt als `Minion.rangeBonus` an allen Minions der betroffenen Line (auch an später beschworenen); der Kampf
  nutzt `effectiveRange(minion)` = `range + rangeBonus` (`combat.ts`). `LineState.bonus` und Basiswerte bleiben unberührt.
- Anzeige: `drawBoard` schreibt `describeSynergy` an die Lane (z. B. „Fernkampf-Ausbau · Reichweite +2“). `balance-sim.ts`
  und Replay laufen über `playCard`/`advance` und berücksichtigen Synergien automatisch; der Bot bleibt unverändert.

#### Abweichungen zum Designkonzept

Maßgeblich ist der Code; `docs/designkonzept.md` bleibt unverändert und ist an diesen Stellen veraltet:

| Stelle im Designkonzept | Designkonzept | Ist (Code) |
|---|---|---|
| Abschnitt 3, Kartenliste | nur 7 Karten, ohne Bogenschütze und Heiler | 9 Karten (Tabelle oben); Abschnitt 4 des Designkonzepts nennt beide |
| Abschnitt 3, „Soll-Änderungen“ | `START_HAND` Ist 7 / Soll 5, `DRAW_PER_ROUND` Ist 5 / Soll 3; Abschnitt 10: „noch nicht geändert“ | im Code 5 und 3 (umgesetzt) |
| Abschnitt 3, Ablage | Ablage als Datenfeld in Folgeauftrag 4 | keine Ablage im Code; verfallene und gespielte Karten werden nicht gespeichert |
| Abschnitt 8, Frage 7 | „Überlebende bleiben stehen“ | werden in der nächsten Runde auf freie Slots zurückgesetzt (`respawnSurvivors`; Abschnitt 2 des Designkonzepts beschreibt das richtig) |
| Abschnitt 3, Deck | keine Zusammensetzung | siehe „Deck-Länge“ oben: Die Spalte „Im Deck“ bzw. „Kopien“ gilt je Durchgang; im 26-Karten-Deck kommen Minion, Brocken, Bogenschütze und Heiler doppelt so oft vor |
| Abschnitt 4, Heiler/Bogenschütze | LP 20, Schaden 7 bzw. Heilung 5, Reichweite 14 bzw. 10, Tempo 10, Kopien 2 bzw. 1 | stimmt (Kopien je Durchgang) |

Kartenwerte, Reichweiten und Tempo stimmen sonst mit dem Designkonzept überein.

### Kampfmodell (`src/logic/combat.ts`)

- Lane-Länge `LINE_LENGTH = 100` (waagrecht); Position 0 am eigenen (linken) Ende, 100 am gegnerischen (rechten). Ein
  `Tower` hat optional `offset` (Standort vom eigenen Ende, Start-Lane 0/8/16); `lines[i].towers` ist die Tower-Liste der
  Lane (leer = nicht frei). Statt `100 − Position` gilt für Tower `towerDistance = 100 − Position − offset`, ein Minion
  greift den **nächsten lebenden** Tower seiner Lane an.
- Pflichtfelder eines `Minion`: `id`, `line`, `position`, `hp`, `damage`, `range`, `speed`. Standardwerte
  `MINION_RANGE = 4`, `MINION_SPEED = 10`. Neue `Minion`-Literale in Tests brauchen `range` und `speed`.
- Abstand zweier gegnerischer Minions: `gap = 100 − Position(a) − Position(b)`.
- Ein Minion (kein Heiler) greift einen gegnerischen Minion auf derselben Line an, wenn der Abstand (`gap`) höchstens
  `range` ist (kleinster Abstand zuerst, bei Gleichstand der kleinere Index). Sonst greift er den Tower seiner Line an,
  wenn dieser noch lebt und `100 − Position <= range` gilt. Sonst läuft er `speed * deltaSeconds` weiter, höchstens bis
  `LINE_LENGTH`. Hat er ein Ziel, bleibt er stehen. Fernkampf ist nur eine größere `range` (Bogenschütze 14).
- Tower (100 LP, 8 Schaden/s, durch Upgrades änderbar) treffen den am weitesten vorgerückten Gegner (höchste Position,
  bei Gleichstand der kleinere Index) der eigenen Line, dessen `100 − Position <= TOWER_RANGE = 20` ist. Zerstörte
  Tower (`hp <= 0`) greifen nicht an.
- Beide Seiten werden pro Tick aus demselben Zustand berechnet und gleichzeitig angewendet.
- Minions mit `hp <= 1e-9` werden nach dem Tick entfernt.
- Optionale Felder: `maxHp` (fehlt es, gilt `hp` als Maximum) und `heals` (Heiler-Merkmal). Literale in Tests brauchen
  beide nicht.

#### Heilung

- `CardDef` für `summon` hat das optionale Feld `role?: 'healer'`. Beim Beschwören setzt `playCard` `maxHp = def.hp +
  Line-Bonus` und bei `role === 'healer'` zusätzlich `heals: true`.
- Ein Heiler heilt pro Tick `damage * deltaSeconds` auf **einen** Verbündeten: gleiche Line, Abstand
  `|position − heiler.position| <= range`, lebend, verwundet (`hp < maxHp`), nicht er selbst. Gewählt wird der niedrigste
  HP-Anteil, bei Gleichstand der kleinere Index (kein Zufall).
- Der Heiler greift nie an, weder Minion noch Tower, auch ohne Ziel. Er läuft immer mit seinem Tempo weiter (bis
  `LINE_LENGTH`), auch während er heilt; er bleibt nicht stehen.
- Heilung wird wie Schaden aus dem Zustand vor dem Tick berechnet und danach angewendet:
  `hp = min(maxHp, hp − Schaden + Heilung)`. Wer im selben Tick auf `hp <= 1e-9` fällt, wird entfernt; Heilung belebt
  nicht wieder. Das Ergebnis hängt nicht von der Spielerreihenfolge ab.
- Minion-Upgrades wirken nur über den Line-Bonus beim Beschwören; bereits stehende Minions und ihr `maxHp` ändern sich
  nicht. Einzige Ausnahme ist `buff-minion`, der `maxHp`, `hp` und `damage` eines Minions sofort anhebt.
- Heilung erscheint nicht in `DamageCollector` und `match-stats.ts`. Eine Heilstatistik wäre eine eigene Änderung.
- Mehrere Heiler wirken gleichzeitig aus demselben Vorzustand und können dasselbe Ziel gemeinsam heilen.
- Das Deck hat eine Karte mehr im Pool, die Kartenreihenfolge je Seed ändert sich (bleibt deterministisch).

### Platzierung

Slot `n` liegt bei `2 + 4n`, gültig bis `PLACEMENT_ZONE_END = 30`. Slot-Zahl = `lineCapacity(Stufe) = 2 + Stufe`.
Ohne Slot-Angabe gilt der erste freie Slot. `moveMinion` und `undoSummon` gehen nur für Minions der aktuellen Planung
(`placements`), kostenlos und vor „Bereit“.

## 3. Architektur

```
src/
  logic/   reine Funktionen, kein Phaser/DOM/Canvas, mit Vitest testbar
    cards.ts       Kartendefinitionen, Deck
    combat.ts      combatTick, Tower, Minion
    match.ts       MatchState, playCard, moveMinion, undoSummon, setReady, advance
    match-stats.ts Statistik des eigenen Spielers
    hand-filter.ts Kartenfilter der Hand (Sichtbarkeit je Kartentyp)
    replay.ts      Replay (Bots oder aufgezeichnete Züge), Zeitlupe, Kommentartexte
    match-record.ts Aufzeichnen, encodeMatch/decodeMatch, Nachspielen mit Prüfung
    seed.ts        parseSeed, parseReplaySeed, parseReplayMoves
    card-style.ts  Kartentyp → Farbe, Symbol, Banner; describeCard (Darstellung, rein)
    fx-events.ts   diffFx: Effekt-Ereignisse aus zwei Spielzuständen (rein)
    placement.ts, iso.ts, bot.ts, balance-sim.ts
  scenes/  main-scene.ts (Spiel), replay-scene.ts (Replay), balance-scene.ts (Dev), share.ts (Teilen-URL)
           theme.ts, textures.ts, card-view.ts, field-view.ts, effects.ts, labels.ts (Phaser-Code, nicht in logic/)
  main.ts  wählt die Start-Szene
e2e/       smoke.spec.ts, gameplay.spec.ts, grafik.spec.ts (Playwright)
docs/      designkonzept.md, grafik-stil.md, anwendung-*.md, handbuch.md
```

Grundsätze (aus `AGENTS.md`):

- Regeln, Zustand, Kollisionen, Punkte, Zeit gehören nach `src/logic/`. Szenen lesen Eingaben, rufen die Logik auf und
  zeichnen. Keine Regeln in `update()`.
- Alle Logikfunktionen liefern einen neuen Zustand; der alte bleibt unverändert.
- Zeit nur über `delta`, Zufall nur über den Seed (`nextRandom` in `game-state.ts`).
- Assets unter `public/assets/`, im `preload()` ohne führendes `public/` laden.
- Keine `console.error` für erwartete Fälle (der Smoke-Test wertet sie als Fehler).

### Replay (`?replay=<seed>`)

```mermaid
flowchart TD
  A[URL ?replay=seed] --> B{parseReplaySeed gültig?}
  B -- nein --> M[MainScene wie bisher]
  B -- ja --> C[ReplayScene]
  C --> D[createReplay: createMatch + strategiesForSeed]
  D --> E[Planung: botStep, abwechselnd alle PLAY_PAUSE_MS]
  E --> F[ReplayEvent je Karte, describeEvent]
  E --> G[Kampf: advance mit delta x SLOWMO_FACTOR]
  G --> H{Phase over?}
  H -- nein --> E
  H -- ja --> I[Ergebnis + Teilen-URL, Taste oder Klick = Neustart]
```

Ein Seed legt Deck und Bot-Strategien fest, keine menschlichen Züge. `?replay=<seed>` ohne `moves` ist ein
Bot-gegen-Bot-Match zum Seed; gleicher Seed ergibt denselben Endzustand und dieselbe Ereignisliste. Mit
`&moves=<kodiert>` spielt die Szene stattdessen die aufgezeichneten Züge eines in der `MainScene` gespielten Matches nach
(Abschnitt „Teilen und Abspielen gespielter Matches“ unten).

**Logik (`src/logic/replay.ts`)**, rein, ohne Phaser/DOM/Canvas:

| Name | Aufgabe |
|---|---|
| `createReplay(seed)` | `ReplayState`: `match`, `strategies`, `events`, `pauseMs`, `turn` |
| `stepReplay(replay, deltaMs)` | neuer Zustand nach `deltaMs`; Ende oder `deltaMs <= 0` liefern den Zustand unverändert |
| `isReplayOver(replay)` | `match.phase === 'over'` |
| `combatDelta(deltaMs)` | `deltaMs * SLOWMO_FACTOR`, Spielzeit der Kampfphase |
| `describeEvent(event)` | Text, z. B. „Runde 2 · Blau spielt Minion auf Lvl 2 oben“ (Lane-Name aus `laneName`) |
| `playerName(player)` | `Blau` (0), `Orange` (1) |

- **Planung:** Sobald `pauseMs` den Wert `PLAY_PAUSE_MS` erreicht, zieht der Spieler am Zug mit `botStep`. Gibt es
  keinen Zug mehr, wird er mit `setReady` bereit gemeldet. Jede gespielte Karte erzeugt genau ein `ReplayEvent`
  (`round`, `player`, `cardId`, `line | null`).
- **Kampf:** `advance(match, combatDelta(deltaMs))`. Beim Wechsel zurück in die Planung werden `pauseMs` und `turn`
  zurückgesetzt (Spieler 0 beginnt).
- Keine neue Regel: Karten, Energie und Kampf kommen unverändert aus `match.ts`; `botStep` kommt aus `bot.ts`.
  `botPlan` ruft `botStep` in einer Schleife auf und verhält sich wie zuvor.

**Szene (`src/scenes/replay-scene.ts`, Key `replay`):** `update` ruft nur `stepReplay`, dann zeichnet `render()` mit
`drawBoard`, `drawMinions` (`field-view.ts`) und `LabelPool` (`labels.ts`). Das Kommentarband zeigt die letzten 6 Ereignisse
(Blau blau, Orange orange). Bei `over` erscheinen Ergebnis und Teilen-URL (`origin` + `pathname` + `?replay=<seed>`).
Taste oder Klick starten das Replay nur nach `over` neu (`scene.restart`); sonst gibt es keine Eingabe. Für Tests
liefern die Getter `current` und `comments` den Zustand.

**Szenenauswahl (`src/main.ts`):** Bei gültigem `?replay=` ist `ReplayScene` die erste Szene, im Dev-Build vor
`MainScene` und `BalanceScene`, im Produktions-Build vor `MainScene`. Sonst unverändert (`MainScene`,
`?scene=balance` im Dev-Server). Ungültige Werte (`abc`, leer) fallen ohne Konsolenfehler auf `MainScene` zurück.

**Auf einen Blick:**
- Ein Replay über alle Runden kann in echter Zeit bis etwa 450 s dauern. Pause, Spulen und Geschwindigkeitswahl gibt es
  bewusst nicht.
- `LabelPool` (`labels.ts`) sowie `drawBoard`, `drawMinions` und `drawTower` (`field-view.ts`) nutzen `MainScene` und `ReplayScene` gemeinsam. Bei
  Änderungen beide Szenen prüfen (Smoke-Tests Gameplay, Drag, Replay).
- `ReplayScene.create` fällt bei ungültigem Wert auf Seed 1 zurück; das ist nur eine Absicherung, `main.ts` startet die
  Szene nur bei gültigem Wert.
- Eine neue Szene, die ohne Eingabe erreichbar ist, gehört in `e2e/smoke.spec.ts`.

### Teilen und Abspielen gespielter Matches (`&moves=`)

```mermaid
flowchart LR
  A[MainScene: Spieler spielt] -->|performAction| B[Aufzeichnung]
  B --> C[encodeMatch: Seed + Züge]
  C --> D[Ende-Bild: Teilen-URL, Link kopieren]
  D --> E[ReplayScene liest replay und moves]
  E --> F{decodeMatch gültig?}
  F -- ja --> G[stepReplay: createMatch, playCard, moveMinion, undoSummon, setReady, advance]
  F -- nein --> H[Hinweis Replay gestoppt, Taste = neues Spiel]
  G -- regelwidrig --> I[Hinweis Replay abgebrochen bei Zug N]
```

**Für Spieler:** Nach Spielende zeigt die `MainScene` (nach „Schließen“ der Statistik) die Teilen-URL, umgebrochen und bei
sehr langen Links gekürzt. Der Knopf **Link kopieren** legt die vollständige URL in die Zwischenablage. Öffnet jemand
sie, spielt die Replay-Szene beide Seiten Zug für Zug nach, mit Kommentaren („Runde 2 · Blau spielt Minion auf Line 3“,
dazu „verschiebt …“, „nimmt … zurück“, „ist bereit“). Takt `PLAY_PAUSE_MS`, Kampf mit `SLOWMO_FACTOR`; Pause, Spulen und
Geschwindigkeitswahl gibt es nicht.

**Format `moves` (Version 3, seit der Karte Zerstörer; Links der Version 1 und 2 sind ungültig):** Nur die Zeichen `0-9 a-z . -`. Aufbau `v3` und je Aktion ein Token mit `.` davor.

| Aktion | Token | Felder |
|---|---|---|
| Karte spielen | `p<R><P>-<Karte>[-<Lane>]` | Karte = Index in `CARD_DEFS`, Lane 0–4 (bei Karten ohne Ziel weggelassen, auch bei „Lane +1“) |
| Minion verschieben | `m<R><P>-<Minion>-<Lane>-<Slot>` | Minion-Id, Ziel-Lane, Slot |
| Beschwörung zurücknehmen | `u<R><P>-<Minion>` | Minion-Id |
| Bereit | `r<R><P>` | – |

`<R>` ist die Runde (1–8), `<P>` der Spieler (0 Blau, 1 Orange). Beispiel: `v3.p10-3-0.m10-1-0-2.r10`. Grenzen beim
Lesen: 4000 Zeichen und 800 Aktionen.

**Ungültige Links** führen nie zu Absturz oder `console.error`:

| Fall | Verhalten |
|---|---|
| `?replay=abc` oder leer (kein gültiger Seed) | normale `MainScene` |
| `moves` unlesbar (leer, abgeschnitten, unbekannte Version, Zeichen oder Zahlen außerhalb des Formats, zu lang) | Hinweis „Replay gestoppt – Die Zugdaten sind ungültig.“ |
| `moves` lesbar, aber regelwidrig (zu wenig Energie, Karte nicht auf der Hand, falsche Runde), Aufzeichnung endet vor Spielende oder enthält danach noch Züge | Replay läuft bis zur letzten gültigen Aktion, dann „Replay abgebrochen bei Zug N: <Grund>“ |

In beiden Hinweisfällen startet eine Taste oder ein Klick ein neues Spiel (`MainScene`).

**Logik (`src/logic/match-record.ts`)**, rein, ohne Phaser/DOM/Canvas: `createRecord`, `performAction` und `botPlanRecorded`
(Aufzeichnen), `applyAction`, `encodeMatch`/`decodeMatch`, `shareQuery`, `replayRecorded` (Nachspielen mit Prüfung, ohne
Zeitlupe). `replay.ts` ergänzt `createRecordedReplay`, `createInvalidReplay` und `describeAbort`; Bot-Pfad und
aufgezeichneter Pfad teilen sich `stepReplay`, den Takt und `describeEvent`. `ReplayEvent` hat das optionale Feld
`action` (`move`, `undo`, `ready`; ohne Angabe eine gespielte Karte). Karten werden beim Nachspielen über ihre ID in der
Hand gefunden, nicht über den Handindex. `match.ts` ist unverändert; die Aufzeichnung liegt außerhalb des `MatchState`.

**Auf einen Blick:**
- **Versionierung:** Ändern sich Regeln oder Kartenliste, muss `RECORD_VERSION` steigen. `match-record.test.ts` hält die
  Kartenliste fest und erinnert daran. Ohne Versionssprung brechen alte Links an der ersten abweichenden Aktion ab oder
  enden anders.
- **Lange Seeds:** `decodeMatch` kürzt Seeds mit bis zu 15 Ziffern auf 32 Bit; Aufzeichnen und Nachspielen verhalten sich
  gleich, das Replay bleibt konsistent.
- **Teilen-URL:** aus `window.location.origin` und `pathname` plus `shareQuery` (`src/scenes/share.ts`). Text auf der
  Leinwand lässt sich nicht markieren, daher der Knopf „Link kopieren“.
- **Zurücknehmen:** Format und Replay kennen die Aktion (Tests auf Logikebene), die `MainScene` bietet sie noch nicht an.
- Gespeichert wird nur in der URL, nicht auf einem Server.

### Grafik

Reine Darstellung; Regeln, Werte und Seed bleiben unverändert. Ausführlich: `docs/grafik-stil.md`.

```mermaid
flowchart LR
  Logic["src/logic"] --> Scene["main-scene.ts"]
  Logic --> FxE["fx-events.ts diffFx"] --> Effects["effects.ts"]
  Logic --> CS["card-style.ts"] --> Cards["card-view.ts"]
  Theme["theme.ts"] --> Scene
  Theme --> Cards
  Theme --> Other["balance-scene / replay-scene"]
  Tex["textures.ts"] --> Scene
  Scene --> Field["field-view.ts"]
  Scene --> Effects
```

| Modul | Aufgabe |
|---|---|
| `theme.ts` | `PALETTE`, `TEXT`, `FONTS`, `FRAME`; `fillGradient`, `drawPanel`, `drawBar`, `drawButton`. Einzige Quelle für Farben und Schriften. |
| `textures.ts` | `ensureTextures`, `addBackdrop`: Hintergrund, Vignette, Boden, Wege, Partikeltexturen (`backdrop`, `spark`, `glow`) per Canvas-Textur; eigener fester Zeichen-Zufall, nicht der Spiel-Seed. |
| `card-view.ts` | `drawCard`: Rahmen, Kopfzeile, Kosten-Kristall, Bildfläche mit Symbol, Textfeld, Typ-Banner. |
| `field-view.ts` | `drawBoard`, `drawMinions`, `drawTower`, `drawMinionBody`; Blau = du, Orange = Gegner. Minion-Form nach Rolle: Kreis, Raute (Fernkämpfer), Kreuz (Heiler), Stachelkugel (Zerstörer). |
| `effects.ts` | Klasse `Effects`: Partikel, Leuchtringe, Schadenszahlen, Kamerawackeln beim Tower-Fall, Animation beim Ausspielen. |
| `card-style.ts` | `cardTypeStyle` (Typ → Rahmenfarbe, Symbol, Banner) und `describeCard` (Kurztext); mit Test. |
| `fx-events.ts` | `diffFx` leitet Treffer, Tod, Beschwörung und Turmschaden aus zwei Zuständen ab; mit Test. |

Kartentypen: `summon` Rot/Schwert, `tower-upgrade` Blau/Turm, `line-upgrade` Grün/Pfeil, `minion-upgrade` Violett/Edelstein.

**Regeln für Änderungen:**
- Farben und Schriften nur aus `theme.ts`. Neue Szenen nutzen `ensureTextures`/`addBackdrop`.
- Bewegung, Anheben und Effekte über `delta` bzw. Phaser-Tweens, nie über Frames. Bei Zeitsprüngen über 500 ms
  (Tab im Hintergrund) entfallen Effekte.
- Obergrenzen: höchstens 20 Schadenszahlen und 150 lebende Partikel je Emitter gleichzeitig.
- Neue Effekt-Auslöser gehören als reine Regel nach `fx-events.ts` mit Test, nicht in `update()`.
- Schriften sind Systemschriften mit Fallback (Georgia/Palatino für Überschriften, Trebuchet/Segoe UI/Verdana für Text),
  kein Webfont; Labels werden mit doppelter Auflösung gerendert.
- Assets: keine Fremddateien, `public/assets/` bleibt leer. Kommen Dateien hinzu, im `preload()` ohne `public/` laden und
  in `grafik-stil.md` mit Quelle und Lizenz eintragen. Keine Originalgrafiken oder Logos von MTG, Hearthstone oder HotS.
- `e2e/grafik.spec.ts` liest das Szenenfeld `lifts`; bei Umbenennung den Test anpassen. Die Felder `state`,
  `handFilter` und `selected` bleiben für die E2E-Tests stabil.

### Kartenfilter (`src/logic/hand-filter.ts`)

Reine Darstellungs- und Eingabehilfe für die Hand des Menschen (Handlimit 10). Keine Regel ändert sich.

| Name | Aufgabe |
|---|---|
| `HandFilter` | `'all'`, `'summon'`, `'upgrade'`, `'tower'` |
| `HAND_FILTERS`, `HAND_FILTER_NAMES` | Reihenfolge und Anzeigenamen (Alle, Beschwörung, Upgrade, Tower) |
| `nextHandFilter(filter)` | nächster Filter, nach Tower wieder Alle |
| `isCardVisible(type, filter)` | ist eine Karte dieses `CardType` beim Filter sichtbar |

Zuordnung: `summon` → Beschwörung; `line-upgrade`, `minion-upgrade` und `minion-buff` → Upgrade; `tower-upgrade` → Tower.

**Szene (`main-scene.ts`):**
- `LAYOUT.filterButton`: x 122, y 592, 102 × 40, links neben der Taste bei 230/592 und unter den Handkarten (bis ca.
  y 572). Beschriftung „Filter: X (n)“, `n` ist die Zahl der passenden Handkarten.
- Feld `handFilter`, in `create()` auf `'all'` gesetzt, nicht gespeichert.
- Die Karten bleiben auf ihren festen Slots (`cardRect(index)`). Eine Abbildung Anzeige-Slot → Hand-Index gibt es
  nicht; `handleTap` und `playCard` nutzen den echten Hand-Index. Nicht passende Karten sind abgedunkelt, ohne Text und
  nicht antippbar.
- Wird die gewählte Karte durch den Wechsel ausgeblendet, ist `selected` danach `null`. Das Feld heißt `selected`, nicht
  `selectedCard`.
- Die Taste reagiert nur in der Planung (`handleTap` kehrt sonst vorher zurück). Ein gesetzter Filter bleibt im Kampf
  aktiv.

**Auf einen Blick:**
- Neuer `CardType` in `cards.ts`: die Zuordnung `GROUPS` in `hand-filter.ts` ergänzen. Der Typ `Record<CardType, …>`
  meldet das Fehlen beim Typecheck.
- Der Meldungstext unten (`this.message`) hat keine Breitenbegrenzung; ein sehr langer Text kann unter die Filtertaste
  ragen.

### Minion-Statistik

```mermaid
flowchart LR
  A[playCard / undoSummon / moveMinion] --> S[(MatchState.stats)]
  B[advance] --> C[combatTick mit collector]
  C --> S
  S -->|phase = over| O[Overlay in main-scene]
```

`MatchStats` (`src/logic/match-stats.ts`) ist rein und serialisierbar:

| Feld | Inhalt |
|---|---|
| `played` | Karten-ID → Anzahl je Line (Index = Line) |
| `damage` | Karten-ID → `{ minionDamage, towerDamage }` |
| `cardByMinion` | Minion-ID → Karten-ID, bleibt über Runden erhalten |

Funktionen: `createStats`, `recordSummon`, `recordUndo`, `recordMove`, `recordDamage`.

- **Nur Spieler 0.** `match.ts` filtert über `STATS_PLAYER = 0`. Minion-IDs sind je Spieler vergeben, daher würde eine
  Vermischung mit dem Gegner IDs kollidieren lassen.
- **Zuordnung:** `cardByMinion` darf nicht aus `PlayerState.placements` abgeleitet werden; das wird pro Planung geleert.
- **Zählung:** `playCard` +1, `undoSummon` −1 (Line vor dem Entfernen), `moveMinion` −1 alte und +1 neue Line.
  `addPlayed` begrenzt auf mindestens 0.
- **Sammler:** `type DamageCollector = (side, minionId, kind: 'minion' | 'tower', amount) => void`, dritter Parameter von
  `combatTick`. Ohne Sammler ändert sich nichts.
- **Deckelung:** Pro Ziel wird der eingehende Gesamtschaden mit der Rest-HP verglichen. Übersteigt er sie, wird jeder
  Treffer mit `remaining / incoming` skaliert. Das gilt auch, wenn ein Tower mit trifft. So ist die Summe der
  gezählten Treffer nie größer als der echte Schaden.
- **Zurechnung:** Tower-Schaden an Minions zählt nirgends. Minion-Schaden an einem Tower zählt als `towerDamage` des
  Kartentyps.
- **Neue Schadensquelle** in `combatTick`: den Sammler mit dem gedeckelten Wert aufrufen, sonst stimmt die Summe nicht.

### Overlay (`src/scenes/main-scene.ts`)

- Bei `phase === 'over'` zeigt `renderStats` zwei Tabellen (Karten pro Line, Schaden je Typ). Namen aus
  `getCardDef(...).name`. Die Szene rechnet nichts.
- „Schließen“ (ca. x 180, y 524) blendet das Overlay aus; danach startet Tippen wie bisher ein neues Spiel. Tippen
  neben den Button startet nichts.
- `statsClosed` wird in `create()` zurückgesetzt.
- Das Panel hat feste Höhe. Ab etwa 10 Kartentypen können Zeilen den Button überlappen.

## 4. Konfiguration

| Konstante | Wert | Datei |
|---|---|---|
| `START_HAND`, `DRAW_PER_ROUND`, `HAND_LIMIT` | 5, 3, 10 | `match.ts` |
| `MAX_ROUNDS`, `BASE_ENERGY`, `ENERGY_PER_ROUND`, `MAX_ENERGY` | 8, 3, 1, 8 | `match.ts` |
| `LINE_COUNT`, `MAX_LINE_LEVEL`, `BASE_CAPACITY` | 3, 5, 2 | `match.ts` |
| `TOWER_HP`, `TOWER_DAMAGE`, `COMBAT_TICKS` | 100, 8, 400 | `match.ts` |
| `LINE_LENGTH`, `TICK_MS`, `MINION_RANGE`, `MINION_SPEED`, `TOWER_RANGE` | 100, 50, 4, 10, 20 | `combat.ts` |
| `SLOWMO_FACTOR`, `PLAY_PAUSE_MS` | 0,35, 700 | `replay.ts` |

- URL-Parameter `?seed=<1–15 Ziffern>` legt den Seed fest (genutzt von den E2E-Tests).
- URL-Parameter `?replay=<1–15 Ziffern>` startet die Replay-Szene (Dev und Produktion). Beide Parameter werden mit
  `>>> 0` auf 32 Bit gekürzt; ungültige Werte ergeben `null`.
- URL-Parameter `&moves=<kodiert>` (zusammen mit `replay`) spielt aufgezeichnete Züge ab; Format und Grenzen siehe
  „Teilen und Abspielen gespielter Matches“. `main.ts` liest nur `replay`, `moves` liest die Szene.
- `RECORD_VERSION` (`match-record.ts`): Formatversion der Aufzeichnung, aktuell 2.
- Die Szene `balance` ist nur im Dev-Server registriert, nicht im Produktions-Build.

## 5. Betrieb und Entwicklung

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server (Vite) |
| `npm run build` | Typprüfung und Produktions-Build |
| `npm run preview` | gebauten Stand lokal ansehen |
| `npm run review` | Build, dann Preview |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run test:smoke` | Build, dann Playwright (Smoke und Gameplay) |

Vor jeder Übergabe müssen `npm run build`, `npm test` und `npm run test:smoke` grün sein.

## 6. Tests

- Jede neue Regel bekommt einen Unit-Test neben der Datei (`src/logic/<name>.test.ts`).
- Statistik: `match-stats.test.ts` (Zählen, Zurücknehmen, Verschieben, Deckelung), `match.test.ts` (nur Spieler 0,
  gleicher Seed gleiche `stats`), `combat.test.ts` (Sammler, Tower-Schaden, Ergebnis mit und ohne Sammler gleich).
- `e2e/gameplay.spec.ts`: vollständige Spielabläufe. Nach Match-Ende zuerst Overlay prüfen, daneben tippen (kein
  Neustart), „Schließen“, dann Neustart. Tests, die direkt neu starten, scheitern sonst.
- Kartenfilter: `hand-filter.test.ts` (jeder `CardType` gegen jeden Filter, Umschaltreihenfolge). Smoke-Fall
  „Kartenfilter“: Tastenreihenfolge, Abwahl der gewählten Karte, tote Karten, Spielen mit echtem Hand-Index.
- Replay: `replay.test.ts` (gleicher Seed gleiches Ergebnis, verschiedene Seeds verschiedene Ereignisse, ein Ereignis
  je Karte, `describeEvent` nicht leer, Kampf verbraucht weniger Spielzeit, Ende in `over` mit gültigem `Outcome`),
  `seed.test.ts` (`parseReplaySeed`), `bot.test.ts` (`botPlan` nach dem `botStep`-Umbau unverändert).
- Teilen: `match-record.test.ts` (Aufzeichnen ändert `MatchState` nicht, `encode`/`decode` Round-Trip mit Seeds von 1 und
  15 Ziffern, nachgespieltes Match endet im identischen `MatchState`, leere/abgeschnittene/manipulierte Daten und unbekannte
  Version ergeben `null` oder Fehlerwert, regelwidrige Aktion bricht kontrolliert ab), `replay.test.ts` und `seed.test.ts`
  (`parseReplayMoves`). Smoke: gültige Züge, ungültige Zugdaten, Teilen-URL der `MainScene` öffnet dasselbe Match.
  `match-record-fixture.ts` ist nur eine Testhilfe.
- Grafik: `card-style.test.ts` (vier Typen unterscheidbar), `fx-events.test.ts` (6 Fälle für `diffFx`),
  `e2e/grafik.spec.ts` (Hover/Auswahl über `lifts`). Smoke gesamt laut letztem Lauf: 20 Fälle.
- `e2e/smoke.spec.ts`: Canvas zeichnet, keine Konsolenfehler, Dev-Szene `balance`, Drag eines Minions, `?replay=`
  (Canvas, Kommentar, Ende mit Ergebnis und Teilen-URL, Neustart per Taste) und ungültiges `?replay=` fällt auf
  `MainScene` zurück.
- Heiler: `combat.test.ts` (Heilung pro Tick, Reichweite, Line, Gegner, `maxHp`-Grenze, keine Selbstheilung, Zielwahl,
  kein Schaden, vertauschte Spielerreihenfolge), `cards.test.ts` (Karte, Deck), `match.test.ts` (`maxHp` mit Line-Bonus),
  `bot.test.ts` (Heiler nach `PRIORITY`, `botPlan` deterministisch).
- Fixtures mit `Minion`-Literalen brauchen `range` und `speed`. Das Deck ändert sich bei neuen Karten, feste
  Kartenreihenfolgen in Tests müssen dann angepasst werden.

## 7. Offene Punkte

- Balance Tower (Reichweite 20) gegen Bogenschütze (14) und `balance-sim` mit den aktuellen Werten neu bewerten.
- Panelhöhe des Overlays an die Zahl der Kartentypen anpassen, falls Karten dazukommen.
- Test „volle Line“ im Browser (in Runde 1 ist keine vierte Beschwörung bezahlbar).
- Replay: sehr lange Laufzeit (bis etwa 450 s) bei vollen Runden; falls gewünscht, später Geschwindigkeitswahl
  (laut Auftrag ausgeschlossen).
- Teilen: „Zurücknehmen“ ist in der `MainScene` nicht bedienbar. Nach jeder Regeländerung `RECORD_VERSION` prüfen, sonst
  geben alte Links ein anderes Match wieder oder brechen ab.
- Smoke-Test „Drag eines beschworenen Minions“: überspringt sich per `test.skip`, wenn die Starthand keinen Minion
  enthält (`smoke.spec.ts`, ca. Zeile 384).
- Möglicher Code-Fehler (nicht geändert): `playCard` prüft bei `tower-upgrade` nicht, ob der Tower der Line noch lebt
  (`hp > 0`). `tower-hp` auf einen zerstörten Tower setzt dessen `hp` wieder auf 30; der Tower greift dann wieder an,
  und `towersAlive` zählt ihn erneut. Das betrifft nur Lines, deren Tower gefallen ist, während die anderen noch
  stehen (fällt der letzte, endet das Match sofort). Ob diese Wiederbelebung gewollt ist, ist offen.
- Ablage (Designkonzept Abschnitt 3) und Hand-/Iso-Folgeaufträge sind im Code nicht vorhanden; siehe „Abweichungen zum
  Designkonzept“.
- Heiler: Balance (Werte sind Startwerte) und Stehenbleiben hinter Verbündeten sind nicht Teil des Auftrags. Der Panel-
  und Filtertext der Szene enthält keine Heiler-Sonderfälle; der Typ `summon` fällt unter „Beschwörung“.
- Grafik: Karten sind klein (66×62 px), der Text hat etwa 6,5 px und ist auf zwei kurze Zeilen gekürzt. Lesbarkeit auf
  echten Geräten, Rahmen und Effekte sind nicht per Screenshot geprüft.
- Grafik (Review): einzelne Farben und Maße in `card-view.ts` (z. B. `0x3a3068`) nach `theme.ts`; der Energie-Kristall in
  `main-scene.ts` ist mit Pixelkoordinaten verdrahtet.
- Hand-UI, Undo-Knopf, Iso-Szene, Projektile, Tempo-Anzeige auf Karten.
- Reviewer-Hinweise: lange `hits.push(...)`-Zeilen in `combat.ts` ggf. mit Hilfstyp lesbarer machen; fehlendes
  Leerzeichen in `this.graphics =this.add.graphics();` in `main-scene.ts`.
