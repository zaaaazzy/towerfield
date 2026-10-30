import { expect, type Page, test } from '@playwright/test';
import { buffGain } from '../src/logic/buff';
import { type CardDef, getCardDef } from '../src/logic/cards';
import {
  combatTick,
  LIGHTNING_FACTOR,
  type Minion,
  SHIELD_REFLECT,
  TICK_SECONDS,
  TOWER_RANGE,
  towerDistance,
} from '../src/logic/combat';
import {
  DISCARD_ENERGY,
  DRAW_PER_ROUND,
  energyForRound,
  HAND_LIMIT,
  MAX_ENERGY,
  MAX_ROUNDS,
  type MatchState,
  MOVE_COST,
  START_HAND,
} from '../src/logic/match';
import {
  cardPointOf,
  collectErrors,
  DISCARD_BUTTON,
  DRAG_THRESHOLD,
  drag,
  dragCard,
  dragMinion,
  fastForwardCombat,
  hasVisibleText,
  laneSlot,
  minionPoint,
  openGame,
  pointBetweenLines,
  pointerDown,
  pointerMove,
  pointerUp,
  readDots,
  readSelected,
  readState,
  sampleCombat,
  setHand,
  slotPoint,
  specializeTower,
  tap,
  UPGRADE_TAP,
  DRAW_TAP,
  unlockField,
  tapCard,
  tapLine,
  tapReady,
} from './helpers';

const defOf = (state: MatchState, index: number): CardDef => getCardDef(state.players[0].hand[index]!);

/** Index der ersten Handkarte, die `accept` erfüllt (Karten nach Eigenschaft suchen, nicht nach festem Index). */
function findCard(state: MatchState, accept: (def: CardDef) => boolean): number {
  return state.players[0].hand.findIndex((id) => accept(getCardDef(id)));
}

/** Tippt „Bereit“ und wartet, bis die Kampfphase läuft (der Bot plant in `update` selbst). */
async function startCombat(page: Parameters<typeof tapReady>[0]): Promise<void> {
  await tapReady(page);
  await expect.poll(async () => (await readState(page)).phase).toBe('combat');
}

test('Karte mit Ziel Line antippen wählt sie aus, erneutes Antippen hebt die Auswahl auf', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const state = await readState(page);
  const index = findCard(state, (def) => def.target === 'line');
  expect(index).toBeGreaterThanOrEqual(0);
  expect(await readSelected(page)).toBeNull();

  await tapCard(page, index);
  await expect.poll(() => readSelected(page)).toBe(index);
  expect(await readState(page)).toEqual(state);

  await tapCard(page, index);
  await expect.poll(() => readSelected(page)).toBeNull();

  expect(errors).toEqual([]);
});

test('Karte und danach Lane antippen spielt die Karte: Hand -1, Energie -Kosten, Lane verändert', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const before = await readState(page);
  // Spezialisierungen brauchen ein Lane-Level und haben ihren eigenen Test (unten).
  const index = findCard(
    before,
    (def) => def.target === 'line' && def.type !== 'tower-specialize' && def.cost <= before.players[0].energy,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const def = defOf(before, index);

  await tapCard(page, index);
  await tapLine(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(before.players[0].hand.length - 1);

  const after = await readState(page);
  expect(after.players[0].energy).toBe(before.players[0].energy - def.cost);
  expect(await readSelected(page)).toBeNull();
  const lineBefore = before.players[0].lines[0]!;
  const lineAfter = after.players[0].lines[0]!;
  const sum = (towers: { maxHp: number; damage: number }[], key: 'maxHp' | 'damage') =>
    towers.reduce((total, tower) => total + tower[key], 0);
  switch (def.type) {
    case 'summon':
      expect(after.players[0].minions.filter((m) => m.line === 0)).toHaveLength(1);
      break;
    case 'tower-upgrade':
      expect(sum(lineAfter.towers, 'maxHp')).toBe(sum(lineBefore.towers, 'maxHp') + def.hp);
      expect(sum(lineAfter.towers, 'damage')).toBe(sum(lineBefore.towers, 'damage') + def.damage);
      break;
    case 'minion-upgrade':
      expect(lineAfter.bonus.hp).toBe(lineBefore.bonus.hp + def.hp);
      expect(lineAfter.bonus.damage).toBe(lineBefore.bonus.damage + def.damage);
      break;
  }

  expect(errors).toEqual([]);
});

test('Spezialisierungskarte auf der Start-Lane wird mit Hinweis abgelehnt, auf einer Lvl-2-Lane markiert sie den Tower', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await unlockField(page, 2);
  // Die Szene liest ihren Zustand aus `state`; die Karte kommt vorn auf die Hand, die frei geschaltete Lane bekommt ihren Tower.
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as {
      state: { players: { hand: string[]; lines: { towers: object[] }[] }[] };
    };
    const me = scene.state.players[0]!;
    me.hand.unshift('tower-lightning');
    me.lines[1]!.towers = [{ offset: 0, hp: 100, maxHp: 100, damage: 8 }];
  });
  const before = await readState(page);
  const energy = before.players[0].energy;

  await tapCard(page, 0);
  await tapLine(page, 0);
  await expect.poll(() => hasVisibleText(page, 'Feldstufe zu niedrig')).toBe(true);
  const rejected = await readState(page);
  expect(rejected.players[0].hand).toEqual(before.players[0].hand);
  expect(rejected.players[0].energy).toBe(energy);
  expect(rejected.players[0].lines[0]!.towers.some((tower) => tower.specialization)).toBe(false);

  await tapCard(page, 0);
  await tapLine(page, 1);
  await expect
    .poll(async () => (await readState(page)).players[0].lines[1]!.towers[0]?.specialization)
    .toBe('lightning');
  const played = await readState(page);
  expect(played.players[0].energy).toBe(energy - getCardDef('tower-lightning').cost);
  expect(played.players[0].hand).toHaveLength(before.players[0].hand.length - 1);

  expect(errors).toEqual([]);
});

const DUEL_TICKS = 10;
const DUEL_SECONDS = DUEL_TICKS * TICK_SECONDS;

/** Gegnerischer Minion mit vielen HP (überlebt die Messung); `position` zählt vom Gegnerende, Tower steht bei Offset 0. */
const enemyMinion = (id: number, position: number, damage = 10): Minion => ({
  id,
  line: 1,
  position,
  hp: 1000,
  maxHp: 1000,
  damage,
  range: 4,
  speed: 10,
});

/**
 * Lane 1 freischalten, einen Tower setzen und ihn mit `specializeTower` spezialisieren. Prüft die Energie, der Gegner
 * ohne Karten und Energie plant nichts. Danach läuft die Kampfphase.
 */
async function playSpecializationAndFight(page: Page, kind: 'lightning' | 'shield'): Promise<void> {
  await unlockField(page, 2);
  // Eine Runde endet, sobald kein Minion lebt: ein Platzhalter hält sie offen, bis `sampleCombat` die Messminions setzt.
  await page.evaluate((placeholder) => {
    const scene = window.game!.scene.getScene('main') as unknown as {
      state: { players: { lines: { towers: object[] }[]; hand: string[]; energy: number; minions: object[] }[] };
    };
    const [me, bot] = scene.state.players as [(typeof scene.state.players)[0], (typeof scene.state.players)[0]];
    me.lines[1]!.towers = [{ offset: 0, hp: 1000, maxHp: 1000, damage: 10 }];
    bot.hand = [];
    bot.energy = 0;
    bot.minions = [placeholder];
  }, enemyMinion(9000, 50));

  const before = (await readState(page)).players[0];
  await specializeTower(page, 1, kind);
  const played = (await readState(page)).players[0];
  expect(played.lines[1]!.towers[0]?.specialization).toBe(kind);
  expect(played.energy).toBe(Math.max(before.energy, getCardDef(`tower-${kind}`).cost) - getCardDef(`tower-${kind}`).cost);
  expect(played.hand).toEqual(before.hand);

  await startCombat(page);
}

/** Lebenspunkte der Minions des Gegners, in der Reihenfolge der Minions. */
const enemyHp = (state: MatchState) => state.players[1].minions.map((minion) => minion.hp);

/** Spielt `ticks` Ticks auf einer Kopie ohne Spezialisierung (reine Logik) und liefert deren Gegner-HP. */
function controlHp(before: MatchState, ticks: number): number[] {
  const control = structuredClone(before);
  for (const tower of control.players[0].lines[1]!.towers) delete tower.specialization;
  for (let tick = 0; tick < ticks; tick += 1) combatTick(control.players);
  return enemyHp(control);
}

test('Blitz-Turm: nach dem Ausspielen per Tippen nehmen mehrere gegnerische Minions in Reichweite Schaden', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await playSpecializationAndFight(page, 'lightning');
  await expect
    .poll(async () => (await readState(page)).players[0].lines[1]!.towers[0]?.specialization)
    .toBe('lightning');

  // Beide Minions stehen in TOWER_RANGE (Abstand 15 und 20), sie laufen im Messfenster nur näher heran.
  const { before, after } = await sampleCombat(page, [enemyMinion(9001, 85), enemyMinion(9002, 80)], DUEL_TICKS);
  const tower = before.players[0].lines[1]!.towers[0]!;
  expect(tower.specialization).toBe('lightning');
  for (const minion of before.players[1].minions) expect(towerDistance(tower, minion.position)).toBeLessThanOrEqual(TOWER_RANGE);

  const expected = tower.damage * DUEL_SECONDS * LIGHTNING_FACTOR;
  const lost = enemyHp(before).map((hp, index) => hp - enemyHp(after)[index]!);
  expect(lost).toHaveLength(2);
  for (const amount of lost) expect(amount).toBeCloseTo(expected, 6);

  // Ohne Spezialisierung trifft der Tower nur den vordersten Minion.
  const withoutLost = enemyHp(before).map((hp, index) => hp - controlHp(before, DUEL_TICKS)[index]!);
  expect(withoutLost.filter((amount) => amount > 1e-9)).toHaveLength(1);
  expect(withoutLost[0]).toBeCloseTo(tower.damage * DUEL_SECONDS, 6);
  expect(withoutLost[1]).toBeCloseTo(0, 6);

  expect(errors).toEqual([]);
});

test('Schild-Turm: nach dem Ausspielen per Tippen erleidet der angreifende Minion SHIELD_REFLECT seines Schadens zurück', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await playSpecializationAndFight(page, 'shield');
  await expect
    .poll(async () => (await readState(page)).players[0].lines[1]!.towers[0]?.specialization)
    .toBe('shield');

  // Der Minion steht in seiner Reichweite zum Tower und greift ihn an, ohne sich zu bewegen.
  const attacker = enemyMinion(9001, 96);
  const { before, after } = await sampleCombat(page, [attacker], DUEL_TICKS);
  const tower = before.players[0].lines[1]!.towers[0]!;
  expect(tower.specialization).toBe('shield');
  expect(towerDistance(tower, attacker.position)).toBeLessThanOrEqual(attacker.range);

  const lost = enemyHp(before)[0]! - enemyHp(after)[0]!;
  const lostWithout = enemyHp(before)[0]! - controlHp(before, DUEL_TICKS)[0]!;
  // Der Tower selbst schießt in beiden Fällen gleich; die Differenz ist der Rückwurf.
  expect(lostWithout).toBeGreaterThan(0);
  expect(lost - lostWithout).toBeCloseTo(attacker.damage * DUEL_SECONDS * SHIELD_REFLECT, 6);
  expect(lost).toBeGreaterThan(lostWithout);

  expect(errors).toEqual([]);
});

test('Wirtschaft: Start mit einer Lane, „Upgrade“ hebt die Feldstufe, gesperrte Lanes lassen sich per Tippen kaufen, „Ziehen“ kostet 1', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  const player = async () => (await readState(page)).players[0];
  // Gekaufte Lanes als 1/0; die Tower stehen auf allen Lanes schon von Beginn an (siehe Prüfung unten).
  const towerCounts = async () => (await player()).lines.map((line) => (line.bought ? line.towers.length : 0));
  const setEnergy = (energy: number) =>
    page.evaluate((value) => {
      const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { energy: number }[] } };
      scene.state.players[0]!.energy = value;
    }, energy);

  // Start: eine Lane, 3 Energie, Einkommen 3 (nächste Runde 4); die anderen Lanes nennen ihre Bedingung.
  expect(await towerCounts()).toEqual([3, 0, 0, 0, 0]);
  expect((await player()).lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 1, 1]);
  expect((await player()).energy).toBe(3);
  expect(await hasVisibleText(page, 'Start-Lane')).toBe(true);
  expect(await hasVisibleText(page, 'Feld Lvl 1 · Einkommen 3, nächste Runde 4')).toBe(true);
  expect(await hasVisibleText(page, 'Lvl 2 oben · ab Feld Lvl 2 kaufbar')).toBe(true);
  expect(await hasVisibleText(page, 'Upgrade -2')).toBe(true);
  expect(await hasVisibleText(page, 'Ziehen -1')).toBe(true);

  // Auf Feldstufe 1 lehnt der Lane-Kauf ab.
  await setEnergy(20);
  await tapLine(page, 1);
  await expect.poll(() => hasVisibleText(page, 'Feldstufe zu niedrig')).toBe(true);
  expect(await towerCounts()).toEqual([3, 0, 0, 0, 0]);

  // Upgrade: Feldstufe 2, 2 Energie weniger, Einkommen +1; die Lanes zeigen jetzt ihren Preis.
  await tap(page, UPGRADE_TAP.x, UPGRADE_TAP.y);
  await expect.poll(async () => (await player()).level).toBe(2);
  expect((await player()).energy).toBe(18);
  await expect.poll(() => hasVisibleText(page, 'Feld Lvl 2 · Einkommen 4, nächste Runde 5')).toBe(true);
  await expect.poll(() => hasVisibleText(page, 'Lvl 2 oben · tippen zum Kaufen (5 Energie)')).toBe(true);

  // Obere und untere Lane einzeln kaufen: je 5 Energie, +1 Einkommen.
  await tapLine(page, 1);
  await expect.poll(towerCounts).toEqual([3, 1, 0, 0, 0]);
  expect((await player()).energy).toBe(13);
  await tapLine(page, 2);
  await expect.poll(towerCounts).toEqual([3, 1, 1, 0, 0]);
  expect((await player()).energy).toBe(8);
  await expect.poll(() => hasVisibleText(page, 'Feld Lvl 2 · Einkommen 6, nächste Runde 7')).toBe(true);

  // Zweite Ausbaustufe: Lane 3 und 4 werden kaufbar.
  await tap(page, UPGRADE_TAP.x, UPGRADE_TAP.y);
  await expect.poll(async () => (await player()).level).toBe(3);
  await expect.poll(() => hasVisibleText(page, 'Lvl 3 oben · tippen zum Kaufen (5 Energie)')).toBe(true);
  await tapLine(page, 3);
  await expect.poll(towerCounts).toEqual([3, 1, 1, 1, 0]);

  // Ziehen kostet 1 Energie und bringt eine Karte; bei 0 Energie lehnt es ab.
  await setEnergy(1);
  const handSize = (await player()).hand.length;
  await tap(page, DRAW_TAP.x, DRAW_TAP.y);
  await expect.poll(async () => (await player()).hand.length).toBe(handSize + 1);
  expect((await player()).energy).toBe(0);
  await tap(page, DRAW_TAP.x, DRAW_TAP.y);
  await expect.poll(() => hasVisibleText(page, 'Nicht genug Energie')).toBe(true);
  expect((await player()).hand).toHaveLength(handSize + 1);

  // Der Gegner (Bot) hat seine eigene Wirtschaft: mit 3 Startenergie reicht es für das Upgrade, nicht für eine Lane.
  const enemy = (await readState(page)).players[1];
  expect(enemy.lines.map((line) => line.bought)).toEqual([true, false, false, false, false]);
  expect(errors).toEqual([]);
});

test('Bogenschütze und „Lane +1“ auf derselben Line zeigen die Synergie an der Lane, Spielen und Zustand bleiben bedienbar', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { hand: string[]; energy: number }[] } };
    scene.state.players[0]!.hand = ['summon-archer', 'line-upgrade'];
    scene.state.players[0]!.energy = 10;
  });
  const label = 'Fernkampf-Ausbau · Reichweite +2';
  expect(await hasVisibleText(page, label)).toBe(false);

  await tapCard(page, 0);
  await tapLine(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  expect(await hasVisibleText(page, label)).toBe(false);

  await tapCard(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].synergies.length).toBe(1);
  await expect.poll(() => hasVisibleText(page, label)).toBe(true);
  const player = (await readState(page)).players[0];
  expect(player.minions[0]).toMatchObject({ rangeBonus: 2 });
  expect(player.lines[0]!.bonus).toEqual({ hp: 0, damage: 0 });

  expect(errors).toEqual([]);
});

test('eine nicht bezahlbare Karte auf eine Line zu spielen ändert den Zustand nicht', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);

  // Energie mit anderen Karten aufbrauchen, bis eine Karte mit Ziel Line übrig bleibt, die zu teuer ist.
  let state = await readState(page);
  const target = state.players[0].hand.find((id) => getCardDef(id).target === 'line' && getCardDef(id).cost >= 2);
  expect(target).toBeDefined();
  const cost = getCardDef(target!).cost;
  while (state.players[0].energy >= cost) {
    const filler = findCard(
      state,
      (def) => def.target === 'line' && def.id !== target && def.cost <= state.players[0].energy,
    );
    expect(filler, 'Es gibt keine Füllkarte, um die Energie aufzubrauchen').toBeGreaterThanOrEqual(0);
    const handSize = state.players[0].hand.length;
    await tapCard(page, filler);
    await tapLine(page, 0);
    await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(handSize - 1);
    state = await readState(page);
  }

  const index = state.players[0].hand.indexOf(target!);
  await tapCard(page, index);
  await expect.poll(() => readSelected(page)).toBe(index);
  await tapLine(page, 0);
  // Die Auswahl endet mit dem Versuch; der Zustand bleibt gleich.
  await expect.poll(() => readSelected(page)).toBeNull();
  expect(await readState(page)).toEqual(state);

  expect(errors).toEqual([]);
});

test('nach „Bereit“ bewegen sich die gespielten Minions im Zustand', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const before = await readState(page);
  const index = findCard(before, (def) => def.type === 'summon' && def.cost <= before.players[0].energy);
  expect(index).toBeGreaterThanOrEqual(0);

  await tapCard(page, index);
  await tapLine(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  const placed = (await readState(page)).players[0].minions[0]!;

  await startCombat(page);
  await expect
    .poll(async () => (await readState(page)).players[0].minions.find((m) => m.id === placed.id)?.position ?? null)
    .not.toBe(placed.position);

  expect(errors).toEqual([]);
});

test('mehrere Runden: Runde steigt, Energie folgt energyForRound, es werden Karten gezogen', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const start = await readState(page);
  expect(start.round).toBe(1);
  expect(start.players[0].energy).toBe(energyForRound(1));

  await startCombat(page);
  const handBefore = (await readState(page)).players[0].hand.length;
  await fastForwardCombat(page);

  const next = await readState(page);
  expect(next.phase).toBe('planning');
  expect(next.round).toBe(2);
  expect(next.players[0].energy).toBe(energyForRound(2));
  expect(next.drawn).toBe(start.drawn + DRAW_PER_ROUND);
  // „Ende der Planung“ legt die Resthand ab und zieht DRAW_PER_ROUND neue Karten.
  expect(handBefore).toBe(DRAW_PER_ROUND);
  expect(next.players[0].hand).toHaveLength(Math.min(HAND_LIMIT, DRAW_PER_ROUND));

  expect(errors).toEqual([]);
});

test('das Spiel endet spätestens nach MAX_ROUNDS Runden mit Ergebnis und Overlay, Tippen startet ein neues Match', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);

  let rounds = 0;
  while ((await readState(page)).phase === 'planning' && rounds < MAX_ROUNDS) {
    rounds += 1;
    await startCombat(page);
    await fastForwardCombat(page);
  }
  const over = await readState(page);
  expect(over.phase).toBe('over');
  expect(over.outcome).not.toBeNull();
  expect(rounds).toBeLessThanOrEqual(MAX_ROUNDS);
  // Zuerst das Statistik-Overlay; Tippen daneben startet nichts, „Schließen“ blendet es aus.
  await expect.poll(() => hasVisibleText(page, 'Karten pro Lane')).toBe(true);
  await expect.poll(() => hasVisibleText(page, 'Schaden je Typ')).toBe(true);
  await tap(page, 180, 30);
  expect((await readState(page)).phase).toBe('over');
  await tap(page, 180, 524);
  await expect.poll(() => hasVisibleText(page, 'Karten pro Lane')).toBe(false);
  expect((await readState(page)).phase).toBe('over');
  await expect.poll(() => hasVisibleText(page, 'Tippen für ein neues Spiel')).toBe(true);

  // Neustart per Tippen.
  await tap(page, 180, 100);
  await expect.poll(async () => (await readState(page)).phase).toBe('planning');
  const fresh = await readState(page);
  expect(fresh.round).toBe(1);
  expect(fresh.outcome).toBeNull();
  expect(fresh.players[0].hand).toHaveLength(START_HAND);
  await expect.poll(() => hasVisibleText(page, 'Tippen für ein neues Spiel')).toBe(false);

  expect(errors).toEqual([]);
});

/** Beschwört mit der ersten bezahlbaren Summon-Karte einen Minion auf `line` und liefert ihn zurück. */
async function summonOn(page: Page, line: number): Promise<Minion> {
  const before = await readState(page);
  const index = findCard(before, (def) => def.type === 'summon' && def.cost <= before.players[0].energy);
  expect(index, `Keine bezahlbare Summon-Karte: ${JSON.stringify(before.players[0])}`).toBeGreaterThanOrEqual(0);
  const known = before.players[0].minions;
  await tapCard(page, index);
  await tapLine(page, line);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(known.length + 1);
  return (await readState(page)).players[0].minions.find((m) => !known.some((old) => old.id === m.id))!;
}

const minionById = (state: MatchState, id: number) => state.players[0].minions.find((m) => m.id === id);

test('buff-minion: Karte und danach eigenen Minion antippen stärkt nur diesen Minion um 50 %', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const placed = await summonOn(page, 0);
  // Der Test legt die Karte gezielt in die Hand (Zustand der Szene), die Regeln laufen unverändert.
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as {
      state: { players: { hand: string[]; energy: number }[] };
    };
    scene.state.players[0]!.hand[0] = 'buff-minion';
    scene.state.players[0]!.energy = 10;
  });
  const before = await readState(page);
  const cost = getCardDef('buff-minion').cost;

  await tapCard(page, 0);
  await expect.poll(() => readSelected(page)).toBe(0);
  await tap(page, minionPoint(placed).x, minionPoint(placed).y);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(before.players[0].hand.length - 1);

  const after = await readState(page);
  const buffed = minionById(after, placed.id)!;
  const maxHp = placed.maxHp ?? placed.hp;
  expect(buffed.maxHp).toBe(maxHp + buffGain(maxHp));
  expect(buffed.hp).toBe(placed.hp + buffGain(maxHp));
  expect(buffed.damage).toBe(placed.damage + buffGain(placed.damage));
  expect(after.players[0].energy).toBe(before.players[0].energy - cost);
  expect(after.players[0].lines).toEqual(before.players[0].lines);
  expect(await readSelected(page)).toBeNull();

  expect(errors).toEqual([]);
});

test('Drag: ein Minion auf einen freien Turm-Slot einer anderen Lane gezogen kostet genau 1 Energie', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await unlockField(page);
  await ensureTower(page, 1);
  const placed = await summonOn(page, 0);
  const before = await readState(page);

  await dragMinion(page, placed.id, slotPoint(1, 1));
  await expect.poll(async () => minionById(await readState(page), placed.id)?.line).toBe(1);

  const after = await readState(page);
  expect(minionById(after, placed.id)).toEqual({ ...placed, line: 1, slot: 1, position: 0 });
  expect(after.players[0].energy).toBe(before.players[0].energy - MOVE_COST);
  expect(after.players[0].hand).toEqual(before.players[0].hand);
  expect(await hasVisibleText(page, 'Turm-Slot ist belegt')).toBe(false);
  expect(await readState(page).then((s) => s.players[0].lines[0]!.towers.length)).toBe(3);

  expect(errors).toEqual([]);
});

test('Drag: ein Minion auf einen anderen Turm-Slot derselben Lane gezogen ändert slot und position für 1 Energie', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  const placed = await summonOn(page, 0);
  const before = await readState(page);
  expect(placed.slot).toBe(0);

  await dragMinion(page, placed.id, slotPoint(0, 3));
  await expect.poll(async () => minionById(await readState(page), placed.id)?.slot).toBe(3);

  const after = await readState(page);
  expect(minionById(after, placed.id)).toEqual({ ...placed, line: 0, slot: 3, position: 8 });
  expect(after.players[0].energy).toBe(before.players[0].energy - MOVE_COST);

  expect(errors).toEqual([]);
});

test('Drag: bei zu wenig Energie wird das Verschieben abgelehnt, die Einheit bleibt auf ihrem Slot', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const placed = await summonOn(page, 0);
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { energy: number }[] } };
    scene.state.players[0]!.energy = 0;
  });
  const before = await readState(page);

  await drag(page, minionPoint(placed), slotPoint(0, 3));
  await expect.poll(() => hasVisibleText(page, 'Nicht genug Energie')).toBe(true);
  const after = await readState(page);
  expect(after).toEqual(before);
  expect(minionById(after, placed.id)).toMatchObject({ slot: 0, position: 0 });

  expect(errors).toEqual([]);
});

test('Drag: belegte Turm-Slots sind kein Ziel, ausserhalb der Reichweite bleibt der Zustand unverändert', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const first = await summonOn(page, 0);
  // Mit Seed 1 reicht die Energie nur für eine der beiden Summon-Karten der Starthand; für die zweite aufstocken.
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { energy: number }[] } };
    scene.state.players[0]!.energy += 2;
  });
  const second = await summonOn(page, 0);
  expect(second.slot).toBe(1);
  const before = await readState(page);

  // Der erste Minion wird über den Slot des zweiten gezogen: Beide Slots tragen keinen Punkt.
  await pointerDown(page, minionPoint(first));
  await pointerMove(page, minionPoint(second));
  await expect.poll(async () => (await readDots(page)).length).toBe(4);
  expect((await readDots(page)).some((dot) => dot.slot === 0 || dot.slot === 1)).toBe(false);
  // Loslassen weit weg von allen Slots verschiebt nichts und kostet nichts.
  await pointerMove(page, pointBetweenLines());
  await pointerUp(page);
  expect(await readState(page)).toEqual(before);

  expect(errors).toEqual([]);
});

/** Gibt der Lane `line` des Menschen im Szenenzustand einen Tower (wie nach dem Kauf der Lane). */
async function ensureTower(page: Page, line: number): Promise<void> {
  await page.evaluate((index) => {
    const scene = window.game!.scene.getScene('main') as unknown as {
      state: { players: { lines: { bought: boolean; towers: object[] }[] }[] };
    };
    const lane = scene.state.players[0]!.lines[index]!;
    lane.bought = true;
    if (lane.towers.length === 0) lane.towers = [{ offset: 0, hp: 100, maxHp: 100, damage: 8 }];
  }, line);
}

test('Karte ziehen: grüne Punkte an allen freien Turm-Slots, der nächste ist hervorgehoben', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const state = await readState(page);
  const index = findCard(state, (def) => def.type === 'summon' && def.cost <= state.players[0].energy);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(await readDots(page)).toEqual([]);

  await pointerDown(page, await cardPointOf(page, index));
  await pointerMove(page, { x: 200, y: 330 });
  await expect.poll(async () => (await readDots(page)).length).toBe(6);
  expect((await readDots(page)).map((dot) => [dot.line, dot.slot])).toEqual([
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
  ]);

  // Näherung: Der Zeiger über Slot 3 (Turm 2, unten) hebt genau diesen Punkt hervor.
  const target = slotPoint(0, 3);
  await pointerMove(page, { x: target.x + 3, y: target.y + 2 });
  await expect
    .poll(async () => {
      const dots = await readDots(page);
      const best = dots.reduce((a, b) => (b.proximity > a.proximity ? b : a));
      const others = dots.filter((d) => d !== best);
      return { slot: best.slot, strong: best.proximity > 0.9, others: others.every((d) => d.proximity < best.proximity - 0.2) };
    })
    .toEqual({ slot: 3, strong: true, others: true });

  await pointerUp(page);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  expect(await readDots(page)).toEqual([]);

  expect(errors).toEqual([]);
});

test('Karte auf einen Turm-Slot ziehen und loslassen rastet dort ein und kostet die Kartenenergie', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const before = await readState(page);
  const index = findCard(before, (def) => def.type === 'summon' && def.cost <= before.players[0].energy);
  const def = defOf(before, index);

  // Loslassen etwas neben dem Slot, aber in Reichweite.
  const slot = slotPoint(0, 4);
  await dragCard(page, index, { x: slot.x + 10, y: slot.y - 8 });
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);

  const after = await readState(page);
  expect(after.players[0].minions[0]).toMatchObject({ line: 0, slot: 4, position: 16 });
  expect(after.players[0].energy).toBe(before.players[0].energy - def.cost);
  expect(after.players[0].hand).toHaveLength(before.players[0].hand.length - 1);
  // Die Aufzeichnung kennt den gewählten Slot.
  const record = await page.evaluate(
    () => (window.game!.scene.getScene('main') as unknown as { currentRecord: { actions: { type: string; slot?: number }[] } }).currentRecord,
  );
  expect(record.actions.some((action) => action.type === 'play' && action.slot === 4)).toBe(true);

  expect(errors).toEqual([]);
});

test('Karte ausserhalb der Reichweite loslassen bringt sie zurück in die Hand, ohne Energie zu verbrauchen', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  const before = await readState(page);
  const index = findCard(before, (def) => def.type === 'summon' && def.cost <= before.players[0].energy);

  await dragCard(page, index, pointBetweenLines());
  // Die Karte fliegt zurück; danach ist alles wie vorher.
  await expect.poll(async () => (await readDots(page)).length).toBe(0);
  expect(await readState(page)).toEqual(before);
  expect(await readSelected(page)).toBeNull();

  expect(errors).toEqual([]);
});

test('Belegte Turm-Slots und Slots zerstörter Türme zeigen beim Ziehen keinen Punkt', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-minion', 'summon-minion', 'summon-minion'], 8);
  await tapCard(page, 0);
  await tapLine(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  // Der mittlere Tower fällt: Slot 2 und 3 verschwinden, Slot 0 ist belegt.
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as {
      state: { players: { lines: { towers: { hp: number }[] }[] }[] };
    };
    scene.state.players[0]!.lines[0]!.towers[1]!.hp = 0;
  });

  await pointerDown(page, await cardPointOf(page, 0));
  await pointerMove(page, { x: 200, y: 330 });
  await expect.poll(async () => (await readDots(page)).map((dot) => dot.slot)).toEqual([1, 4, 5]);
  await pointerUp(page);

  expect(errors).toEqual([]);
});

test('Lane-Karte ziehen: Punkt im Lane-Slot hinter dem Turm, höchstens eine Lane-Karte je Lane', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['lane-buff', 'lane-shield'], 8);

  await pointerDown(page, await cardPointOf(page, 0));
  await pointerMove(page, { x: 200, y: 330 });
  await expect.poll(async () => (await readDots(page)).length).toBe(1);
  const [dot] = await readDots(page);
  expect(dot).toMatchObject({ line: 0, slot: null });
  expect(dot!.x).toBeLessThan(slotPoint(0, 0).x);
  await pointerMove(page, laneSlot(0));
  await pointerUp(page);

  await expect.poll(async () => (await readState(page)).players[0].lines[0]!.laneEffect).toBe('buff');
  const placed = await readState(page);
  expect(placed.players[0].lines[0]!.laneCard).toBe('lane-buff');
  expect(placed.players[0].energy).toBe(8 - getCardDef('lane-buff').cost);

  // Die Lane trägt schon eine Lane-Karte: kein Punkt mehr, die zweite Karte bleibt auf der Hand.
  await pointerDown(page, await cardPointOf(page, 0));
  await pointerMove(page, { x: 200, y: 330 });
  await pointerMove(page, laneSlot(0));
  expect(await readDots(page)).toEqual([]);
  await pointerUp(page);
  expect((await readState(page)).players[0].hand).toEqual(['lane-shield']);

  expect(errors).toEqual([]);
});

test('Abwerfen: gewählte Karte mit „Abwerfen“ abwerfen bringt 1 Energie, Energie über dem Maximum verfällt', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-brute', 'tower-hp', 'summon-minion'], 3);

  await tapCard(page, 1);
  await expect.poll(() => readSelected(page)).toBe(1);
  await expect.poll(() => hasVisibleText(page, `Abwerfen +${DISCARD_ENERGY}`)).toBe(true);
  await tap(page, DISCARD_BUTTON.x, DISCARD_BUTTON.y);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(2);
  expect((await readState(page)).players[0].energy).toBe(3 + DISCARD_ENERGY);
  expect(await readSelected(page)).toBeNull();

  await setHand(page, ['summon-brute', 'tower-hp'], MAX_ENERGY);
  await tapCard(page, 0);
  await tap(page, DISCARD_BUTTON.x, DISCARD_BUTTON.y);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(1);
  expect((await readState(page)).players[0].energy).toBe(MAX_ENERGY);

  expect(errors).toEqual([]);
});

test('Abwerfen: eine Karte auf die Taste „Abwerfen“ ziehen wirft sie ab', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-minion', 'tower-hp'], 2);

  await dragCard(page, 0, DISCARD_BUTTON);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(1);
  const after = await readState(page);
  expect(after.players[0].energy).toBe(2 + DISCARD_ENERGY);
  expect(after.players[0].minions).toHaveLength(0);

  expect(errors).toEqual([]);
});

test('Einheit auf dem Turm-Slot kämpft in der nächsten Runde vom selben Tower aus, ohne neu gesetzt zu werden', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-guard'], 8);
  const slot = slotPoint(0, 5);
  await dragCard(page, 0, slot);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  const placed = (await readState(page)).players[0].minions[0]!;
  // Der Wächter soll die Runde sicher überstehen (der Bot kämpft wie immer mit).
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as {
      state: { players: { minions: { hp: number; maxHp: number }[] }[] };
    };
    for (const minion of scene.state.players[0]!.minions) minion.hp = minion.maxHp = 100000;
  });

  await startCombat(page);
  await fastForwardCombat(page);
  const next = await readState(page);
  expect(next.round).toBe(2);
  expect(minionById(next, placed.id)).toMatchObject({ slot: 5, line: 0, position: 16 });
  expect(next.players[0].placements).toEqual([]);

  expect(errors).toEqual([]);
});

test('Drag: Loslassen außerhalb aller Lines lässt den Zustand unverändert und zeigt keine Meldung', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const placed = await summonOn(page, 0);
  const before = await readState(page);

  await drag(page, minionPoint(placed), pointBetweenLines());
  expect(await readState(page)).toEqual(before);
  expect(await hasVisibleText(page, 'Platz ist belegt')).toBe(false);
  expect(await hasVisibleText(page, 'Hier ist kein Platz')).toBe(false);

  expect(errors).toEqual([]);
});

test('Drag: eine Bewegung unter DRAG_THRESHOLD verschiebt den Minion nicht, die Kartenauswahl bleibt bedienbar', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  const placed = await summonOn(page, 0);
  const before = await readState(page);

  const from = minionPoint(placed);
  await drag(page, from, { x: from.x + DRAG_THRESHOLD - 3, y: from.y }, 4);
  expect(await readState(page)).toEqual(before);

  const index = findCard(before, (def) => def.target === 'line');
  expect(index).toBeGreaterThanOrEqual(0);
  await tapCard(page, index);
  await expect.poll(() => readSelected(page)).toBe(index);
  await tapCard(page, index);
  await expect.poll(() => readSelected(page)).toBeNull();
  expect(await readState(page)).toEqual(before);

  expect(errors).toEqual([]);
});

test('Drag: nach „Bereit“ und in der Kampfphase lässt sich kein Minion mehr ziehen', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await unlockField(page, 3);
  const placed = await summonOn(page, 0);

  await tapReady(page);
  const ready = await readState(page);
  await drag(page, minionPoint(placed), slotPoint(1, 1));
  const afterReady = await readState(page);
  expect(minionById(afterReady, placed.id)?.line).toBe(0);
  expect(afterReady.players[0].energy).toBe(ready.players[0].energy);
  expect(afterReady.players[0].minions).toHaveLength(1);

  await expect.poll(async () => (await readState(page)).phase).toBe('combat');
  const inCombat = (await readState(page)).players[0].minions.find((m) => m.id === placed.id)!;
  await drag(page, minionPoint(inCombat), slotPoint(2, 1));
  const afterCombatDrag = await readState(page);
  expect(minionById(afterCombatDrag, placed.id)?.line).toBe(0);
  expect(await hasVisibleText(page, 'Platz ist belegt')).toBe(false);

  expect(errors).toEqual([]);
});
