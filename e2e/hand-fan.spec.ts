import { expect, test } from '@playwright/test';
import { getCardDef } from '../src/logic/cards';
import { cardPoint, collectErrors, openGame, readSelected, readState, tap } from './helpers';

/** Gemischte Hand in der Reihenfolge, in der sie gezogen wurde (nicht nach Typ sortiert). */
const MIXED_HAND = [
  'tower-hp',
  'summon-minion',
  'line-upgrade',
  'summon-brute',
  'summon-archer',
  'minion-upgrade-line',
  'tower-damage',
  'summon-healer',
  'minion-upgrade-line',
  'summon-minion',
];

interface HandSceneView {
  state: { players: { hand: string[]; energy: number }[] };
}

async function setHand(page: Parameters<typeof openGame>[0], hand: string[]): Promise<void> {
  await page.evaluate((cards) => {
    const scene = window.game!.scene.getScene('main') as unknown as HandSceneView;
    scene.state.players[0]!.hand = cards;
    scene.state.players[0]!.energy = 10;
  }, hand);
}

test('Fächer: ein Tipp auf eine überlappende Karte wählt genau die sichtbar getroffene Karte', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  // Jede Karte wird an ihrer sichtbaren Stelle angetippt. Eine Karte mit Ziel Lane muss mit ihrem echten Hand-Index
  // gewählt sein; eine ohne Ziel („Lane +1“) wird sofort gespielt, und genau diese Karte verlässt die Hand.
  for (let index = 0; index < MIXED_HAND.length; index += 1) {
    await setHand(page, MIXED_HAND);
    const point = cardPoint(MIXED_HAND, index);
    await page.mouse.move(5, 5);
    await tap(page, point.x, point.y);
    if (getCardDef(MIXED_HAND[index]!).target === 'none') {
      await expect
        .poll(async () => (await readState(page)).players[0].hand, `Hand-Index ${index}`)
        .toEqual(MIXED_HAND.filter((_, other) => other !== index));
    } else {
      expect(await readSelected(page), `Hand-Index ${index}`).toBe(index);
    }
    await page.evaluate(() => {
      (window.game!.scene.getScene('main') as unknown as { selected: number | null }).selected = null;
    });
  }
  expect(errors).toEqual([]);
});

test('Fächer: gespielte Karte verlässt die Hand, die übrigen bleiben in derselben Reihenfolge', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await setHand(page, ['summon-brute', 'tower-hp', 'summon-minion']);
  const point = cardPoint(['summon-brute', 'tower-hp', 'summon-minion'], 1);
  await tap(page, point.x, point.y);
  expect(await readSelected(page)).toBe(1);
  await tap(page, 180, 250);
  await expect.poll(async () => (await readState(page)).players[0].hand).toEqual(['summon-brute', 'summon-minion']);
  expect(errors).toEqual([]);
});
