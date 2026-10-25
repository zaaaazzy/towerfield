import { expect, test } from '@playwright/test';

/** Was der Test von der Szene liest (nur Typ, der Code läuft im Browser). */
interface MainSceneView {
  current: { phase: string; players: { lines: unknown[]; hand: unknown[] }[] };
}

test('das Spiel startet, zeichnet in den Canvas und meldet keine Fehler', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  // Die Szene läuft und hat schon einige Frames gezeichnet.
  await page.waitForFunction(() => window.game?.scene.isActive('main') && window.game.loop.frame > 10);

  // Bild über Phaser holen (funktioniert mit WebGL und Canvas) und zählen, wie viele Farben darin vorkommen.
  const colors = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        window.game!.renderer.snapshot((image) => {
          const source = image as HTMLImageElement;
          const canvas = document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = source.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(source, 0, 0);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          const seen = new Set<number>();
          for (let index = 0; index < data.length; index += 4 * 97) {
            seen.add((data[index]! << 16) | (data[index + 1]! << 8) | data[index + 2]!);
          }
          resolve(seen.size);
        });
      }),
  );
  // Hintergrund, Raster, Figur, Stern und Text: ein leerer oder einfarbiger Canvas fällt hier auf.
  expect(colors).toBeGreaterThan(3);

  // Ohne Eingabe: 3 Lines je Spieler mit Tower, 7 Handkarten, Planungsphase.
  const view = () =>
    page.evaluate(() => {
      const state = (window.game!.scene.getScene('main') as unknown as MainSceneView).current;
      return {
        phase: state.phase,
        lines: state.players.map((player) => player.lines.length),
        hands: state.players.map((player) => player.hand.length),
      };
    });
  const start = await view();
  expect(start.phase).toBe('planning');
  expect(start.lines).toEqual([3, 3]);
  expect(start.hands[0]).toBe(7);

  // Tippen auf „Bereit“ (unten rechts; Spielkoordinaten 360x640) startet die Kampfphase.
  await page.mouse.click(box!.x + (290 / 360) * box!.width, box!.y + (612 / 640) * box!.height);
  await expect.poll(async () => (await view()).phase).not.toBe('planning');

  expect(errors).toEqual([]);
});

/** Was der Drag-Test von der Szene liest. */
interface DragSceneView {
  current: { players: { minions: { id: number; line: number; position: number }[] }[] };
}

test('ein beschworener Minion lässt sich in der Planung ziehen, danach nicht mehr', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => window.game?.scene.isActive('main') && window.game.loop.frame > 10);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + (x / 360) * box.width, y: box.y + (y / 640) * box.height });
  const humanMinions = () =>
    page.evaluate(() => (window.game!.scene.getScene('main') as unknown as DragSceneView).current.players[0]!.minions);
  const cardPoint = (index: number) => at(7 + (index % 5) * 70 + 33, 440 + Math.floor(index / 5) * 66 + 31);
  const click = (point: { x: number; y: number }) => page.mouse.click(point.x, point.y);

  // Karten der Reihe nach auf Line 0 spielen, bis ein Minion auf dem Feld steht.
  for (let attempt = 0; attempt < 7 && (await humanMinions()).length === 0; attempt += 1) {
    await click(cardPoint(attempt % 3));
    await click(at(60, 300));
  }
  const placed = await humanMinions();
  test.skip(placed.length === 0, 'Die Starthand enthält keinen Minion.');
  const minion = placed[0]!;
  const yOf = (position: number) => 400 - (position / 100) * 310;
  const offset = minion.id % 2 === 0 ? 8 : -8;
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  };

  // Loslassen außerhalb aller Lines (zwischen Line 0 und 1): Minion bleibt.
  await drag(at(60 + offset, yOf(minion.position)), at(120, 250));
  expect(await humanMinions()).toEqual([minion]);

  // Ziehen auf Slot 1 (Position 6) von Line 1.
  await drag(at(60 + offset, yOf(minion.position)), at(180, yOf(6)));
  const moved = (await humanMinions()).find((m) => m.id === minion.id)!;
  expect(moved.line).toBe(1);
  expect(moved.position).toBe(6);

  // Nach „Bereit“ lässt sich nichts mehr ziehen.
  await click(at(290, 612));
  await drag(at(180 + offset, yOf(6)), at(300, yOf(10)));
  const after = (await humanMinions()).find((m) => m.id === minion.id);
  expect(after?.line).not.toBe(2);

  expect(errors).toEqual([]);
});
