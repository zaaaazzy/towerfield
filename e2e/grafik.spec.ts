import { expect, test } from '@playwright/test';
import { getCardDef } from '../src/logic/cards';
import { cardPointOf, collectErrors, openGame, readState, tap, tapCard, tapLine, tapReady } from './helpers';

/** Was die Tests von den Darstellungsfeldern der Szene lesen (zur Laufzeit erreichbar). */
interface GraphicsSceneView {
  lifts: number[];
  update(time: number, deltaMs: number): void;
  children: { list: { type: string; visible: boolean; text?: string }[] };
}

const lifts = (page: Parameters<typeof openGame>[0]) =>
  page.evaluate(() => [...(window.game!.scene.getScene('main') as unknown as GraphicsSceneView).lifts]);

test('Hover hebt eine Karte an, Wegbewegen senkt sie wieder', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await openGame(page);
  const box = (await page.locator('#game canvas').boundingBox())!;
  const center = await cardPointOf(page, 1);
  await page.mouse.move(box.x + (center.x / 360) * box.width, box.y + (center.y / 640) * box.height);
  await expect.poll(async () => (await lifts(page))[1]).toBeGreaterThan(0.8);
  expect((await lifts(page))[0]).toBeLessThan(0.1);
  await page.screenshot({ path: testInfo.outputPath('hover.png') });

  await page.mouse.move(box.x + 5, box.y + 5);
  await expect.poll(async () => (await lifts(page))[1]).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test('eine ausgewählte Karte bleibt angehoben', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const state = await readState(page);
  const index = state.players[0].hand.findIndex((id) => getCardDef(id).target === 'line');
  await tapCard(page, index);
  await tap(page, 5, 5);
  await expect.poll(async () => (await lifts(page))[index]).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
});

test('Kampf zeigt Schadenszahlen und Effekte ohne Konsolenfehler', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await openGame(page);
  const state = await readState(page);
  // Alle bezahlbaren Beschwörungen auf Line 1 spielen, damit es Kämpfe gibt.
  const hand = state.players[0].hand;
  let energy = state.players[0].energy;
  for (let index = 0; index < hand.length; index += 1) {
    const def = getCardDef(hand[index]!);
    if (def.type !== 'summon' || def.cost > energy) continue;
    energy -= def.cost;
    await tapCard(page, index - (hand.length - (await readState(page)).players[0].hand.length));
    await tapLine(page, 1);
  }
  await tapReady(page);
  await expect.poll(async () => (await readState(page)).phase).toBe('combat');

  // In kleinen Schritten vorspulen; Tweens laufen in Echtzeit weiter, die Zahlen bleiben daher kurz sichtbar.
  const seen = await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as GraphicsSceneView & {
      current: { phase: string };
    };
    const numbers = new Set<string>();
    for (let step = 0; step < 400 && scene.current.phase === 'combat'; step += 1) {
      scene.update(0, 50);
      for (const child of scene.children.list) {
        if (child.type === 'Text' && child.visible && /^-\d+$/.test(child.text ?? '')) numbers.add(child.text!);
      }
    }
    return [...numbers];
  });
  expect(seen.length).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('combat.png') });
  expect(errors).toEqual([]);
});
