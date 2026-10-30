import { expect, test } from '@playwright/test';
import { DRAW_PER_ROUND, START_HAND } from '../src/logic/match';
import {
  collectErrors,
  DISCARD_BUTTON,
  fastForwardCombat,
  minionPoint,
  openGame,
  readState,
  setHand,
  tap,
  tapCard,
  tapLine,
  tapReady,
} from './helpers';

/** Mitte der Taste „Figur verkaufen“, Spiegel von `SELL_BUTTON` in `main-scene.ts`. */
const SELL_TAP = { x: 218, y: 44 };

test('Karte spielen, Figur verkaufen, Handkarte verkaufen und Runde beenden', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-minion', 'summon-archer', 'tower-hp'], 8);

  // Die erste Karte der Runde wird gespielt …
  await tapCard(page, 0);
  await tapLine(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  const played = await readState(page);
  expect(played.players[0].cardsPlayed).toBe(1);

  // … eine zweite Karte lehnt die Regel ab.
  await tapCard(page, 0);
  await tapLine(page, 0);
  expect((await readState(page)).players[0].minions).toHaveLength(1);
  expect((await readState(page)).players[0].hand).toHaveLength(2);

  // Die platzierte Figur antippen und für 1 Energie verkaufen: der Slot wird frei.
  const figure = played.players[0].minions[0]!;
  const energyBeforeSale = played.players[0].energy;
  const point = minionPoint(figure);
  await tap(page, point.x, point.y);
  await tap(page, SELL_TAP.x, SELL_TAP.y);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(0);
  expect((await readState(page)).players[0].energy).toBe(energyBeforeSale + 1);

  // Eine Handkarte wählen und für 1 Energie verkaufen.
  const energyBeforeCard = (await readState(page)).players[0].energy;
  await tapCard(page, 0);
  await tap(page, DISCARD_BUTTON.x, DISCARD_BUTTON.y);
  await expect.poll(async () => (await readState(page)).players[0].hand.length).toBe(1);
  expect((await readState(page)).players[0].energy).toBe(energyBeforeCard + 1);

  // Ende der Planung: die Resthand wird abgelegt, im nächsten Zug stehen fünf neue Karten bereit.
  await tapReady(page);
  await expect.poll(async () => (await readState(page)).phase).toBe('combat');
  await fastForwardCombat(page);
  await expect.poll(async () => (await readState(page)).round).toBe(2);
  const next = await readState(page);
  expect(next.phase).toBe('planning');
  expect(next.players[0].cardsPlayed).toBe(0);
  expect(next.players[0].hand).toHaveLength(DRAW_PER_ROUND);
  expect(next.players[0].hand).toEqual(next.deck.slice(START_HAND, START_HAND + DRAW_PER_ROUND));

  expect(errors).toEqual([]);
});
