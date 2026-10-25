# Minion-Statistik nach Match-Ende

Nach Match-Ende zeigt ein Overlay die eigene Partie (Spieler 0): gespielte Karten pro Line und den verursachten
Schaden je Minion-Typ. Die Daten des Gegners werden weder erfasst noch angezeigt.

## Logik

- `src/logic/match-stats.ts` (rein, ohne Phaser): `MatchStats` mit
  - `played`: Karten-ID → Anzahl je Line,
  - `damage`: Karten-ID → `minionDamage` und `towerDamage`,
  - `cardByMinion`: Minion-ID → Karten-ID. Bleibt über Runden erhalten, weil `PlayerState.placements` pro Planungsphase
    geleert wird.
- `MatchState.stats` wird von `createMatch` angelegt.
- `playCard` zählt eine Beschwörung, `undoSummon` zieht sie ab, `moveMinion` verschiebt die Zählung auf die neue Line.
- `advance` übergibt `combatTick` einen Sammler (`DamageCollector`); nur Treffer von Spieler 0 werden gespeichert.

## Schadenszählung

- Der Typ eines Minions ist die Karten-ID, die ihn beschworen hat. Tower-Schaden an Minions zählt nicht.
- Der gemeldete Schaden ist auf die Rest-HP des Ziels gedeckelt (Minion oder Tower). Treffen mehrere Angreifer
  gleichzeitig, auch Tower, wird der Rest anteilig verteilt. Die Summe entspricht so dem echten Schaden.
- Ohne Sammler verhält sich `combatTick` unverändert.

## Overlay

`src/scenes/main-scene.ts` liest bei `phase === 'over'` nur `state.stats` und zeigt zwei Tabellen (Karten pro Line,
Schaden je Typ) mit Kartennamen aus `cards.ts`. „Schließen“ blendet das Overlay aus; danach gilt wie bisher: Tippen
startet ein neues Spiel. Das Overlay startet nichts von sich aus.

## Abgrenzung

Keine Gegner-Statistik, keine Speicherung über das Match hinaus, keine Änderung an Balance, Regeln oder Kampfablauf.
