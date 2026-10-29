import { expect, test } from '@playwright/test';
import { getCardDef } from '../src/logic/cards';
import { MAX_ROUNDS } from '../src/logic/match';
import {
  cardPointOf,
  collectErrors,
  fastForwardCombat,
  freezeGame,
  openGame,
  pointerDown,
  pointerMove,
  pointerUp,
  readSelected,
  readState,
  setHand,
  stepFrames,
  tap,
  tapCard,
  tapLine,
  tapReady,
} from './helpers';

/** Was die Tests von den Darstellungsfeldern der Szene lesen (zur Laufzeit erreichbar). */
interface GraphicsSceneView {
  lifts: number[];
  update(time: number, deltaMs: number): void;
  children: { list: { type: string; visible: boolean; text?: string }[] };
}

const detailCard = (page: Parameters<typeof openGame>[0]) =>
  page.evaluate(() => (window.game!.scene.getScene('main') as unknown as { detailCard: number | null }).detailCard);

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

test('Langdruck öffnet die Detailansicht, Ziehen und Tippen nicht', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const state = await readState(page);
  const index = state.players[0].hand.findIndex((id) => getCardDef(id).type === 'summon');
  const point = await cardPointOf(page, index);

  // Kurzer Tipp: Auswahl wie bisher, keine Detailansicht.
  await tap(page, point.x, point.y);
  await expect.poll(() => readSelected(page)).toBe(index);
  await page.waitForTimeout(600);
  expect(await detailCard(page)).toBeNull();
  await tap(page, 5, 5);

  // Ziehen über die Toleranz hinaus und lange halten: keine Detailansicht.
  await pointerDown(page, point);
  await pointerMove(page, { x: point.x, y: point.y - 60 });
  await page.waitForTimeout(600);
  expect(await detailCard(page)).toBeNull();
  await pointerUp(page);

  // Lange halten ohne Bewegung: Detailansicht, Loslassen schließt sie ohne Spielzug.
  const before = (await readState(page)).players[0];
  await pointerDown(page, point);
  await expect.poll(() => detailCard(page)).toBe(index);
  await pointerUp(page);
  await expect.poll(() => detailCard(page)).toBeNull();
  const after = (await readState(page)).players[0];
  expect(after.hand).toEqual(before.hand);
  expect(after.energy).toBe(before.energy);
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
  // Alle bezahlbaren Beschwörungen auf die Start-Lane spielen, damit es Kämpfe gibt.
  const hand = state.players[0].hand;
  let energy = state.players[0].energy;
  for (let index = 0; index < hand.length; index += 1) {
    const def = getCardDef(hand[index]!);
    if (def.type !== 'summon' || def.cost > energy) continue;
    energy -= def.cost;
    await tapCard(page, index - (hand.length - (await readState(page)).players[0].hand.length));
    await tapLine(page, 0);
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

/**
 * Screenshot-Vergleiche im Handyformat 360×640. Der Loop steht still (`freezeGame`), die Zeit läuft nur über
 * `stepFrames`; so sind Licht, Nebel und Glanz in jedem Lauf gleich. Die Referenzbilder unter
 * `e2e/grafik.spec.ts-snapshots/` entstehen mit Chromium unter macOS (Dateisuffix `-chromium-darwin`). Der Vergleich
 * läuft nur dort (Variante B, siehe docs/anwendung-ci-gate.md); in der Linux-CI entfällt er, alle übrigen
 * Prüfungen der Tests laufen weiter.
 */
const HAT_BASISBILDER = process.platform === 'darwin';

async function vergleiche(page: Parameters<typeof openGame>[0], name: string): Promise<void> {
  if (!HAT_BASISBILDER) return;
  await expect(page).toHaveScreenshot(name);
}

test.describe('Screenshots 360×640', () => {
  test.use({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });

  const SHOT_SEED = 3;

  async function openFrozen(page: Parameters<typeof openGame>[0]): Promise<string[]> {
    const errors = collectErrors(page);
    await openGame(page, SHOT_SEED);
    await freezeGame(page);
    await stepFrames(page, 20);
    return errors;
  }

  /** Spielt alle bezahlbaren Beschwörungen auf die Start-Lane; jede Eingabe wird einzeln verarbeitet. */
  async function playSummons(page: Parameters<typeof openGame>[0]): Promise<void> {
    const state = await readState(page);
    let energy = state.players[0].energy;
    const hand = state.players[0].hand;
    for (let index = 0; index < hand.length; index += 1) {
      const def = getCardDef(hand[index]!);
      if (def.type !== 'summon' || def.cost > energy) continue;
      energy -= def.cost;
      await tapCard(page, index - (hand.length - (await readState(page)).players[0].hand.length));
      await stepFrames(page, 2);
      await tapLine(page, 0);
      await stepFrames(page, 2);
    }
  }

  test('Planung', async ({ page }) => {
    const errors = await openFrozen(page);
    await vergleiche(page, 'planung.png');
    expect(errors).toEqual([]);
  });

  test('Hand mit den neuen Kartenbildern', async ({ page }) => {
    const errors = await openFrozen(page);
    await setHand(page, ['tower-lightning', 'summon-guard', 'lane-shield', 'tower-armor', 'minion-upgrade-elite'], 10);
    await stepFrames(page, 5);
    await vergleiche(page, 'hand-neue-karten.png');
    expect(errors).toEqual([]);
  });

  test('Kampf', async ({ page }) => {
    const errors = await openFrozen(page);
    await playSummons(page);
    await tapReady(page);
    await stepFrames(page, 2);
    expect((await readState(page)).phase).toBe('combat');
    await stepFrames(page, 30, 50);
    await vergleiche(page, 'kampf.png');
    expect(errors).toEqual([]);
  });

  test('Spielende', async ({ page }) => {
    const errors = await openFrozen(page);
    for (let round = 0; round < MAX_ROUNDS && (await readState(page)).phase === 'planning'; round += 1) {
      await tapReady(page);
      await stepFrames(page, 2);
      await fastForwardCombat(page);
      await stepFrames(page, 2);
    }
    expect((await readState(page)).phase).toBe('over');
    // Partikel der letzten Treffer streuen zufällig (Phaser-Zufall, kein Seed): warten, bis sie verschwunden sind.
    await stepFrames(page, 60, 50);
    await vergleiche(page, 'spielende-statistik.png');
    await tap(page, 180, 524);
    await stepFrames(page, 3);
    await vergleiche(page, 'spielende-teilen.png');
    expect(errors).toEqual([]);
  });

  test('Detailansicht per Langdruck', async ({ page }) => {
    const errors = await openFrozen(page);
    const before = await readState(page);
    const index = before.players[0].hand.findIndex((id) => getCardDef(id).type === 'summon');
    expect(index).toBeGreaterThanOrEqual(0);
    await pointerDown(page, await cardPointOf(page, index));
    // Knapp unter der Schwelle ist noch keine Detailansicht da.
    await stepFrames(page, 20);
    expect(await detailCard(page)).toBeNull();
    // Schwelle überschritten (ab dem 25. Bild), dazu ein Teil des Glanzdurchlaufs.
    await stepFrames(page, 30);
    expect(await detailCard(page)).toBe(index);
    await vergleiche(page, 'detailansicht.png');

    // Loslassen schließt die Ansicht; die Karte wird weder gespielt noch gewählt.
    await pointerUp(page);
    await stepFrames(page, 3);
    expect(await detailCard(page)).toBeNull();
    expect(await readSelected(page)).toBeNull();
    expect((await readState(page)).players[0].hand).toEqual(before.players[0].hand);
    expect(errors).toEqual([]);
  });
});
