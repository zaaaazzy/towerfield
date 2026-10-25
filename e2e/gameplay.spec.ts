import { expect, test } from '@playwright/test';
import { type CardDef, getCardDef } from '../src/logic/cards';
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
  fastForwardCombat,
  hasVisibleText,
  openGame,
  readSelected,
  readState,
  tap,
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

test('Karte und danach Line antippen spielt die Karte: Hand -1, Energie -Kosten, Line verändert', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const before = await readState(page);
  const index = findCard(before, (def) => def.target === 'line' && def.cost <= before.players[0].energy);
  expect(index).toBeGreaterThanOrEqual(0);
  const def = defOf(before, index);

  await tapCard(page, index);
  await tapLine(page, 1);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(before.players[0].hand.length - 1);

  const after = await readState(page);
  expect(after.players[0].energy).toBe(before.players[0].energy - def.cost);
  expect(await readSelected(page)).toBeNull();
  const lineBefore = before.players[0].lines[1]!;
  const lineAfter = after.players[0].lines[1]!;
  switch (def.type) {
    case 'summon':
      expect(after.players[0].minions.filter((m) => m.line === 1)).toHaveLength(1);
      break;
    case 'line-upgrade':
      expect(lineAfter.level).toBe(lineBefore.level + 1);
      break;
    case 'tower-upgrade':
      expect(lineAfter.tower.maxHp).toBe(lineBefore.tower.maxHp + def.hp);
      expect(lineAfter.tower.damage).toBe(lineBefore.tower.damage + def.damage);
      break;
    case 'minion-upgrade':
      expect(lineAfter.bonus.hp).toBe(lineBefore.bonus.hp + def.hp);
      expect(lineAfter.bonus.damage).toBe(lineBefore.bonus.damage + def.damage);
      break;
  }

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
  await tapLine(page, 2);
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
  await expect.poll(() => hasVisibleText(page, 'Karten pro Line')).toBe(true);
  await expect.poll(() => hasVisibleText(page, 'Schaden je Typ')).toBe(true);
  await tap(page, 180, 30);
  expect((await readState(page)).phase).toBe('over');
  await tap(page, 180, 524);
  await expect.poll(() => hasVisibleText(page, 'Karten pro Line')).toBe(false);
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
