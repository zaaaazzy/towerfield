import { expect, test } from '@playwright/test';
import {
  cardPointOf,
  collectErrors,
  openGame,
  pointBetweenLines,
  pointerDown,
  pointerMove,
  pointerUp,
  readState,
  setHand,
  slotPoint,
  tapCard,
  tapLine,
} from './helpers';

test('Ziehen einer Karte über besetzte und freie Slots zeichnet ohne Konsolenfehler und lässt den Zustand bis zum Loslassen unberührt', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-minion', 'summon-archer', 'lane-buff', 'summon-guard'], 8);
  await tapCard(page, 0);
  await tapLine(page, 0);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(1);
  const before = await readState(page);

  await pointerDown(page, await cardPointOf(page, 0));
  const target = slotPoint(0, 3);
  await pointerMove(page, { x: target.x + 6, y: target.y + 4 });
  await pointerMove(page, pointBetweenLines());
  await pointerMove(page, { x: target.x, y: target.y });
  expect((await page.screenshot()).byteLength).toBeGreaterThan(1000);
  expect(await readState(page)).toEqual(before);
  await pointerUp(page);
  await expect.poll(async () => (await readState(page)).players[0].minions.length).toBe(2);

  expect(errors).toEqual([]);
});
