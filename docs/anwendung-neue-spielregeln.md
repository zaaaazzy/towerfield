# Anwendung: Neue Spielregeln (Turm-Spawn, Verkaufen, Türme auf allen Lanes, eine Karte pro Runde)

Auftrag 08c089ba. Die Regeln stehen in `src/logic/`, die Szenen zeigen sie nur an.

## Regeln und Fundstellen

| Regel | Konstante / Funktion | Datei |
|---|---|---|
| Jeder lebende Tower spawnt alle 1000 ms einen Minion (`source: 'tower'`) | `TOWER_SPAWN_MS`, `TOWER_SPAWN_HP/DAMAGE/RANGE/SPEED`, `spawnTowerMinions` | `balance-config.ts`, `combat.ts`; `advance` ruft sie nach jedem Tick (`match.ts`) |
| Spawn-Minions leben nur eine Runde | `respawnSurvivors` verwirft sie | `match.ts` |
| Platzierte Figuren bleiben bis Spielende | `respawnSurvivors` setzt sie auf ihren Slot, bei zerstörtem Tower auf den ersten freien Slot der Lane | `match.ts` |
| Figur verkaufen (+1 Energie, Slot frei) | `sellMinion`, `SELL_MINION_ENERGY` | `match.ts` |
| Handkarte verkaufen (+1 Energie) | `discardCard`, `DISCARD_ENERGY` (deckt die Anforderung bereits ab) | `match.ts` |
| Tower auf allen Lanes | `createPlayer` stellt Tower auf alle Lanes; `buyLane` ändert sie nicht mehr | `match.ts` |
| Eine Karte pro Runde | `CARDS_PER_ROUND`, `PlayerState.cardsPlayed`, Fehler `card-limit` | `match.ts` |
| Resthand ablegen, 5 neue Karten | `setReady` zieht `DRAW_PER_ROUND` aus dem Deck | `match.ts` |

## Entscheidungen

- **Annahme zur offenen Frage:** Jede Karte aus der Hand zählt zum Limit (Figuren, Zauber, Upgrade-Karten, Lane-Karten).
  `upgradeField`, `buyLane`, `drawCard`, `moveMinion`, `sellMinion` und `discardCard` zählen nicht. Mit dem Auftraggeber
  noch nicht bestätigt.
- **Spawn getrennt vom Schadenstick:** `combatTick` bleibt unverändert, `advance` ruft nach jedem Tick
  `spawnTowerMinions(player, TICK_MS)`. Die Uhr liegt je Tower in `spawnMs`; das Ergebnis hängt nur von der Summe der Zeit ab.
- **Undo und Verkauf:** `undoSummon` nimmt eine Beschwörung der laufenden Planung voll zurück (Energie, Karte, Karte der
  Runde wieder frei). `sellMinion` gilt für jede platzierte Figur, auch aus früheren Runden, bringt nur 1 Energie und gibt
  die Karte nicht zurück.
- **Rundenende:** Mit spawnenden Towern lebt immer ein Minion nach der ersten Sekunde; die Kampfphase läuft daher bis
  `COMBAT_TICKS` (`combatActive`). Das ersetzt die Regel aus [anwendung-runde-endet-bei-toten-einheiten.md](anwendung-runde-endet-bei-toten-einheiten.md).
- **Sieg:** `destroyedOutcome` und `hpOutcome` zählen die Tower aller Lanes (7 je Spieler zu Beginn: 3 + 4 × 1).
- **Replay:** Aufzeichnungsformat Version 8; neue Aktion `s<R><P>-<Minion>` (Verkauf).
- **Bot:** Spielt höchstens eine Karte und zieht danach nicht mehr nach. Er verkauft keine Figuren.
- **Simulation:** `held` meldet die Karten, die in der letzten Runde vor dem Ablegen ungespielt blieben.

## Anzeige

- `field-view.ts`: Tower auch auf nicht gekauften Lanes; Spawn-Minions blasser (Alpha 0,65).
- `main-scene.ts`: Figur antippen wählt sie, die Taste „Figur verkaufen +1“ verkauft sie; „Verkaufen +1“ wirft die
  gewählte Handkarte ab; der Hinweis „Karte gespielt“ erscheint nach der Karte der Runde, die Hand ist dann ausgegraut.
- Slot-Punkte und Lane-Slots erscheinen nur auf gekauften Lanes (`SlotLane.bought`).

## Tests

- Logik: `combat.test.ts` (Turm-Spawn), `match.test.ts` (Eine Karte pro Runde, Verkaufen, Turm-Spawn im Kampf, Türme auf
  allen Lanes, Karten verkaufen), `bot.test.ts`, `match-record.test.ts`, `replay.test.ts`.
- E2E: `e2e/karte-verkaufen.spec.ts` (Karte spielen, Figur verkaufen, Handkarte verkaufen, Runde beenden).

## Offen

- Die Balance-Regression (`balance-regression.test.ts`) wurde nicht neu gemessen. Die Spawn-Werte (12 HP, 3 Schaden)
  sind Startwerte. Vor dem Festlegen neuer Grenzen `npm run balance` laufen lassen und
  [anwendung-balance-cli.md](anwendung-balance-cli.md) befolgen.
- Ältere Dokumente zu Handlimit und Ziehen ([anwendung-handlimit.md](anwendung-handlimit.md),
  [anwendung-start-zieh-konstanten.md](anwendung-start-zieh-konstanten.md)) beschreiben den Stand davor.
