import { expect, test } from '@playwright/test';
import { START_HAND } from '../src/logic/match';

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

  // Ohne Eingabe: 3 Lines je Spieler mit Tower, START_HAND Handkarten, Planungsphase.
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
  expect(start.hands[0]).toBe(START_HAND);

  // Tippen auf „Bereit“ (unten rechts; Spielkoordinaten 360x640) startet die Kampfphase.
  await page.mouse.click(box!.x + (290 / 360) * box!.width, box!.y + (612 / 640) * box!.height);
  await expect.poll(async () => (await view()).phase).not.toBe('planning');

  expect(errors).toEqual([]);
});

/** Was der Balance-Test von der Szene liest. */
interface BalanceSceneView {
  current: { totalMatches: number; startSeed: number; cards: unknown[] } | null;
}

const devUrl = `http://localhost:${Number(process.env.SMOKE_DEV_PORT ?? 5181)}`;

test('Dev-Szene balance: zeigt den Bericht, simuliert neu und kehrt zurück, ohne Konsolenfehler', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${devUrl}/?scene=balance`);
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => window.game?.scene.isActive('balance'));
  const report = () =>
    page.evaluate(() => (window.game!.scene.getScene('balance') as unknown as BalanceSceneView).current);
  await expect.poll(report, { timeout: 20_000 }).not.toBeNull();
  const first = (await report())!;
  expect(first.totalMatches).toBe(200);
  expect(first.cards.length).toBeGreaterThan(0);

  const box = (await page.locator('#game canvas').boundingBox())!;
  const click = (x: number, y: number) =>
    page.mouse.click(box.x + (x / 360) * box.width, box.y + (y / 640) * box.height);

  // „Neu simulieren“: anderer Seed-Bereich.
  await click(90, 612);
  await expect.poll(async () => (await report())?.startSeed, { timeout: 20_000 }).toBe(first.startSeed + 200);

  // „Zurück“ startet die main-Szene.
  await click(270, 612);
  await page.waitForFunction(() => window.game?.scene.isActive('main'));

  expect(errors).toEqual([]);
});

test('Produktions-Build: die Szene balance ist nicht registriert und startet nicht', async ({ page }) => {
  await page.goto('/?scene=balance');
  await page.waitForFunction(() => window.game?.scene.isActive('main') && window.game.loop.frame > 5);
  const state = await page.evaluate(() => ({
    keys: window.game!.scene.scenes.map((scene) => scene.scene.key),
    balanceActive: window.game!.scene.isActive('balance'),
  }));
  expect(state.keys).toEqual(['main']);
  // Phaser liefert für einen unbekannten Key `null`, nicht `false`.
  expect(state.balanceActive).toBeFalsy();
});

/** Was der Replay-Test von der Szene liest. */
interface ReplaySceneView {
  comments: string[];
  current: { match: { phase: string; round: number }; events: unknown[] };
  children: { list: { type: string; visible: boolean; text?: string }[] };
}

test('?replay=<seed>: die Replay-Szene startet ohne Eingabe, zeigt Spielfeld und Kommentare, ohne Konsolenfehler', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?replay=42');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 10);
  expect(await page.evaluate(() => window.game!.scene.isActive('main'))).toBeFalsy();

  const scene = () =>
    page.evaluate(() => {
      const view = window.game!.scene.getScene('replay') as unknown as ReplaySceneView;
      const texts = view.children.list.filter((c) => c.type === 'Text' && c.visible).map((c) => c.text ?? '');
      return { comments: view.comments, phase: view.current.match.phase, texts };
    });

  // Nach einigen Sekunden steht mindestens ein Kommentar im Band, und das Spielfeld ist gezeichnet.
  await expect.poll(async () => (await scene()).comments.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const state = await scene();
  expect(state.texts.some((text) => text.includes('spielt'))).toBe(true);
  expect(state.texts).toContain('Line 1 · Stufe 1');

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
  expect(colors).toBeGreaterThan(3);

  expect(errors).toEqual([]);
});

test('?replay: am Ende erscheinen Ergebnis und Teilen-URL, ein Tastendruck startet dasselbe Replay neu', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?replay=42');
  await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 10);
  await page.waitForFunction(() => {
    const view = window.game!.scene.getScene('replay') as unknown as ReplaySceneView;
    return view.current.events.length > 0;
  });

  // Ein echtes Match dauert minutenlang: das Ende wird direkt im Szenenzustand gesetzt.
  await page.evaluate(() => {
    const view = window.game!.scene.getScene('replay') as unknown as { replay: { match: Record<string, unknown> } };
    view.replay.match = { ...view.replay.match, phase: 'over', outcome: 'player0' };
  });
  await page.waitForFunction(() => {
    const view = window.game!.scene.getScene('replay') as unknown as ReplaySceneView;
    return view.children.list.some((c) => c.type === 'Text' && c.visible && c.text === 'Blau gewinnt');
  });
  const texts = await page.evaluate(() => {
    const view = window.game!.scene.getScene('replay') as unknown as ReplaySceneView;
    return view.children.list.filter((c) => c.type === 'Text' && c.visible).map((c) => c.text ?? '');
  });
  expect(texts.some((text) => text.endsWith('?replay=42'))).toBe(true);

  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const view = window.game!.scene.getScene('replay') as unknown as ReplaySceneView;
    return view.current.match.phase === 'planning' && view.current.events.length <= 1;
  });
  expect(errors).toEqual([]);
});

test('?replay mit ungültigem Wert fällt auf die MainScene zurück, ohne Konsolenfehler', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?replay=abc');
  await page.waitForFunction(() => window.game?.scene.isActive('main') && window.game.loop.frame > 5);
  expect(await page.evaluate(() => window.game!.scene.scenes.map((scene) => scene.scene.key))).toEqual(['main']);
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
