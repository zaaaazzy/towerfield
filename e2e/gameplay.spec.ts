import { expect, type Page, test } from '@playwright/test';
import { type CardDef, getCardDef } from '../src/logic/cards';
import type { Minion } from '../src/logic/combat';
import { slotPosition } from '../src/logic/placement';
import {
  DRAW_PER_ROUND,
  energyForRound,
  HAND_LIMIT,
  MAX_ROUNDS,
  type MatchState,
  START_HAND,
} from '../src/logic/match';
import {
  collectErrors,
  DRAG_THRESHOLD,
  drag,
  fastForwardCombat,
  hasVisibleText,
  minionPoint,
  openGame,
  pointBetweenLines,
  readSelected,
  readState,
  slotPoint,
  tap,
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
  const index = findCard(before, (def) => def.target === 'line' && def.cost <= before.players[0].energy);
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

test('das Feld startet mit einer Lane; „Lane +1“ schaltet je eine Lane oben und unten frei (Lvl 2, dann Lvl 3)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  const towerCounts = async () => (await readState(page)).players[0].lines.map((line) => line.towers.length);
  expect(await towerCounts()).toEqual([3, 0, 0, 0, 0]);
  expect(await hasVisibleText(page, 'Start-Lane')).toBe(true);
  expect(await hasVisibleText(page, 'Lvl 2 oben · mit Lane +1 (Lvl 2)')).toBe(true);
  expect(await hasVisibleText(page, 'Lvl 2 oben')).toBe(false);

  for (const [level, towers, shown] of [
    [2, [3, 1, 1, 0, 0], 'Lvl 2 unten'],
    [3, [3, 1, 1, 1, 1], 'Lvl 3 oben'],
  ] as const) {
    await page.evaluate(() => {
      const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { hand: string[]; energy: number }[] } };
      scene.state.players[0]!.hand = ['line-upgrade'];
      scene.state.players[0]!.energy = 10;
    });
    await tapCard(page, 0);
    await expect.poll(async () => (await readState(page)).players[0].level).toBe(level);
    expect(await towerCounts()).toEqual(towers);
    await expect.poll(() => hasVisibleText(page, shown)).toBe(true);
  }
  expect((await readState(page)).players[1].level).toBe(1);
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
  expect(next.players[0].hand).toHaveLength(Math.min(HAND_LIMIT, handBefore + DRAW_PER_ROUND));

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
  expect(buffed.maxHp).toBe(placed.maxHp + Math.round(placed.maxHp * 0.5));
  expect(buffed.hp).toBe(placed.hp + Math.round(placed.maxHp * 0.5));
  expect(buffed.damage).toBe(placed.damage + Math.round(placed.damage * 0.5));
  expect(after.players[0].energy).toBe(before.players[0].energy - cost);
  expect(after.players[0].lines).toEqual(before.players[0].lines);
  expect(await readSelected(page)).toBeNull();

  expect(errors).toEqual([]);
});

test('Drag: ein Minion auf einen freien Slot einer anderen Lane gezogen setzt line und position, Energie bleibt', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await unlockField(page);
  const placed = await summonOn(page, 0);
  const before = await readState(page);

  await drag(page, minionPoint(placed), slotPoint(1, 1));
  await expect.poll(async () => minionById(await readState(page), placed.id)?.line).toBe(1);

  const after = await readState(page);
  expect(minionById(after, placed.id)).toEqual({ ...placed, line: 1, position: slotPosition(1) });
  expect(after.players[0].energy).toBe(before.players[0].energy);
  expect(after.players[0].hand).toEqual(before.players[0].hand);
  expect(await hasVisibleText(page, 'Platz ist belegt')).toBe(false);

  expect(errors).toEqual([]);
});

test('Drag: ein Minion auf einen anderen freien Slot derselben Line gezogen ändert nur die position', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  const placed = await summonOn(page, 0);
  const before = await readState(page);

  await drag(page, minionPoint(placed), slotPoint(0, 1));
  await expect.poll(async () => minionById(await readState(page), placed.id)?.position).toBe(slotPosition(1));

  const after = await readState(page);
  expect(minionById(after, placed.id)).toEqual({ ...placed, line: 0, position: slotPosition(1) });
  expect(after.players[0].energy).toBe(before.players[0].energy);

  expect(errors).toEqual([]);
});

test('Drag: ein belegter Slot lässt den Zustand unverändert und zeigt „Platz ist belegt“', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await unlockField(page);
  const first = await summonOn(page, 0);
  // Mit Seed 1 reicht die Energie nur für eine der beiden Summon-Karten der Starthand; für die zweite aufstocken.
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { energy: number }[] } };
    scene.state.players[0]!.energy += 2;
  });
  await summonOn(page, 1);
  const before = await readState(page);

  // Der zweite Minion steht auf Slot 0 von Lane 1; der erste wird darauf gezogen.
  await drag(page, minionPoint(first), slotPoint(1, 0));
  await expect.poll(() => hasVisibleText(page, 'Platz ist belegt')).toBe(true);
  expect(await readState(page)).toEqual(before);

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
