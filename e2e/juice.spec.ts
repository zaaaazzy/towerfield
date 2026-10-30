import { expect, type Page, test } from '@playwright/test';
import { MAX_ROUNDS } from '../src/logic/match';
import { collectErrors, fastForwardCombat, freezeGame, openGame, readState, stepFrames, tapReady } from './helpers';

/**
 * Visueller Feedback-Loop für Grafik-Politur (Auftrag „Juice“): Der Test startet das Spiel mit angehaltenem Loop,
 * löst einen Turm-Treffer aus und legt Screenshots und eine kurze Frame-Sequenz unter `test-results/` ab
 * (`testInfo.outputPath`, zusätzlich als Anhang im Bericht). Die Bilder bewertet man von Hand; der Test prüft nur, was sich
 * messen lässt: Kamera-Wackeln, Partikel, Vignette und die Schalter. Keine Referenzbilder, daher auch unter Linux grün.
 */

interface MeasureSceneView {
  state: { players: { minions: object[] }[] };
  cameras: { main: { scrollX: number; scrollY: number } };
  children: { list: { type: string; getAliveParticleCount?: () => number }[] };
}

interface Measured {
  maxShake: number;
  maxParticles: number;
  frames: number;
}

/** Ein Gegner, der den eigenen Tower der Start-Lane aus nächster Nähe angreift (Position 96, Reichweite 4). */
const ATTACKER = { id: 9001, line: 0, position: 96, hp: 1000, maxHp: 1000, damage: 60, range: 4, speed: 10 };

/** Beginnt die Kampfphase und setzt den Angreifer; ab hier laufen Treffer auf den Tower. */
async function startTowerAttack(page: Page): Promise<void> {
  await tapReady(page);
  await stepFrames(page, 2);
  expect((await readState(page)).phase).toBe('combat');
  await page.evaluate((attacker) => {
    const scene = window.game!.scene.getScene('main') as unknown as MeasureSceneView;
    scene.state.players[1]!.minions = [attacker];
  }, ATTACKER);
}

/** Lässt `frames` Bilder laufen und merkt sich den größten Kameraausschlag und die meisten lebenden Partikel. */
function measure(page: Page, frames: number, deltaMs = 16): Promise<Measured> {
  return page.evaluate(
    ([count, delta]) => {
      const game = window.game! as unknown as { step(time: number, delta: number): void; __time?: number };
      const scene = window.game!.scene.getScene('main') as unknown as MeasureSceneView;
      let maxShake = 0;
      let maxParticles = 0;
      for (let frame = 0; frame < (count as number); frame += 1) {
        game.__time = (game.__time ?? 0) + (delta as number);
        game.step(game.__time, delta as number);
        const { scrollX, scrollY } = scene.cameras.main;
        maxShake = Math.max(maxShake, Math.hypot(scrollX, scrollY));
        const alive = scene.children.list.reduce((sum, child) => sum + (child.getAliveParticleCount?.() ?? 0), 0);
        maxParticles = Math.max(maxParticles, alive);
      }
      return { maxShake, maxParticles, frames: count as number };
    },
    [frames, deltaMs] as const,
  );
}

/** Mittlere Helligkeit (0 bis 255) eines Bildausschnitts, im Browser aus einem Screenshot berechnet. */
async function meanBrightness(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) sum += (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
    return sum / (pixels.length / 4);
  }, png);
}

const isWebGl = (page: Page) => page.evaluate(() => window.game!.renderer.type === 2);

test.describe('Juice 360×640', () => {
  test.use({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });

  const SEED = 3;

  async function openFrozen(page: Page, extra = ''): Promise<string[]> {
    const errors = collectErrors(page);
    await openGame(page, SEED, extra);
    await freezeGame(page);
    await stepFrames(page, 20);
    return errors;
  }

  test('Turm-Treffer löst Screen-Shake und Partikel aus (Frame-Sequenz)', async ({ page }, testInfo) => {
    const errors = await openFrozen(page);
    await startTowerAttack(page);
    // Vier Bilder nach dem Einschlag als Sequenz ablegen, danach messen.
    let maxShake = 0;
    let maxParticles = 0;
    for (let shot = 0; shot < 4; shot += 1) {
      const step = await measure(page, 3);
      maxShake = Math.max(maxShake, step.maxShake);
      maxParticles = Math.max(maxParticles, step.maxParticles);
      const path = testInfo.outputPath(`turm-treffer-${shot}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`turm-treffer-${shot}`, { path, contentType: 'image/png' });
    }
    expect(maxShake, 'Kamera wackelt bei Turm-Treffern').toBeGreaterThan(0);
    expect(maxParticles, 'Partikel bei Turm-Treffern').toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('mit ?shake=0 wackelt die Kamera nicht, Partikel bleiben', async ({ page }) => {
    const errors = await openFrozen(page, 'shake=0');
    await startTowerAttack(page);
    const measured = await measure(page, 60);
    expect(measured.maxShake).toBe(0);
    expect(measured.maxParticles).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test.describe('prefers-reduced-motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('Shake ist standardmäßig aus und lässt sich mit ?shake=1 einschalten', async ({ page }) => {
      const errors = await openFrozen(page);
      await startTowerAttack(page);
      expect((await measure(page, 60)).maxShake).toBe(0);

      const forced = await openFrozen(page, 'shake=1');
      await startTowerAttack(page);
      expect((await measure(page, 60)).maxShake).toBeGreaterThan(0);
      expect([...errors, ...forced]).toEqual([]);
    });
  });

  test('Vignette und Farbkorrektur sind im Bild sichtbar (Ecke dunkler als mit ?postfx=0)', async ({ page }, testInfo) => {
    const errors = await openFrozen(page);
    test.skip(!(await isWebGl(page)), 'Post-Processing braucht WebGL');
    const corner = { x: 0, y: 0, width: 40, height: 40 };
    const withFx = await meanBrightness(page, corner);
    await page.screenshot({ path: testInfo.outputPath('mit-postfx.png') });

    await openFrozen(page, 'postfx=0');
    const without = await meanBrightness(page, corner);
    await page.screenshot({ path: testInfo.outputPath('ohne-postfx.png') });
    expect(withFx).toBeLessThan(without);
    expect(errors).toEqual([]);
  });

  test('Screenshot der Hauptszene im Kampf', async ({ page }, testInfo) => {
    const errors = await openFrozen(page);
    await startTowerAttack(page);
    await stepFrames(page, 30, 50);
    const path = testInfo.outputPath('kampf.png');
    await page.screenshot({ path });
    await testInfo.attach('kampf', { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('Screenshot beim Spielende', async ({ page }, testInfo) => {
    const errors = await openFrozen(page);
    for (let round = 0; round < MAX_ROUNDS && (await readState(page)).phase === 'planning'; round += 1) {
      await tapReady(page);
      await stepFrames(page, 2);
      await fastForwardCombat(page);
      await stepFrames(page, 2);
    }
    expect((await readState(page)).phase).toBe('over');
    await stepFrames(page, 20, 50);
    const path = testInfo.outputPath('spielende.png');
    await page.screenshot({ path });
    await testInfo.attach('spielende', { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
});
