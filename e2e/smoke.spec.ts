import { expect, type Page, test } from '@playwright/test';
import { START_HAND, MAX_ROUNDS } from '../src/logic/match';
import { decodeMatch, encodeMatch, type RecordedMatch, replayRecorded } from '../src/logic/match-record';
import { playScriptedMatch } from '../src/logic/match-record-fixture';
import { createRecordedReplay, describeEvent, PLAY_PAUSE_MS, stepReplay } from '../src/logic/replay';
import { collectErrors, fastForwardCombat, openGame, readState, tap, tapReady } from './helpers';

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
  // Zwei Läufe mit je 1000 Matches, blockweise über Frames verteilt.
  test.setTimeout(100_000);
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
  await expect.poll(report, { timeout: 40_000 }).not.toBeNull();
  const first = (await report())!;
  expect(first.totalMatches).toBe(1000);
  expect(first.cards.length).toBeGreaterThan(0);

  const box = (await page.locator('#game canvas').boundingBox())!;
  const click = (x: number, y: number) =>
    page.mouse.click(box.x + (x / 360) * box.width, box.y + (y / 640) * box.height);

  // „Neu simulieren“: anderer Seed-Bereich.
  await click(90, 612);
  await expect.poll(async () => (await report())?.startSeed, { timeout: 40_000 }).toBe(first.startSeed + 1000);

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

/** Was die Tests zu aufgezeichneten Replays von der Szene lesen. */
interface RecordedReplayView {
  current: { events: unknown[]; aborted: { reason: string; index: number } | null; script: unknown[] | null };
  children: { list: { type: string; visible: boolean; text?: string }[] };
}

const visibleTexts = (page: Page) =>
  page.evaluate(() =>
    (window.game!.scene.getScene('replay') as unknown as RecordedReplayView).children.list
      .filter((c) => c.type === 'Text' && c.visible)
      .map((c) => c.text ?? ''),
  );

test('?replay=<seed>&moves=<gültig>: die Replay-Szene spielt die aufgezeichneten Züge der Reihe nach, ohne Konsolenfehler', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const { record } = playScriptedMatch(7);
  // Die ersten vier Kommentare, wie die Logik sie in dieser Reihenfolge erzeugt.
  let expected = createRecordedReplay(record);
  while (expected.events.length < 4) expected = stepReplay(expected, PLAY_PAUSE_MS);
  const wanted = expected.events.slice(0, 4).map(describeEvent);

  await page.goto(`/?replay=7&moves=${encodeMatch(record)}`);
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 10);
  expect(await page.evaluate(() => window.game!.scene.isActive('main'))).toBeFalsy();

  await page.waitForFunction(
    () => (window.game!.scene.getScene('replay') as unknown as RecordedReplayView).current.events.length >= 4,
    undefined,
    { timeout: 15_000 },
  );
  const state = await page.evaluate(() => {
    const view = window.game!.scene.getScene('replay') as unknown as RecordedReplayView;
    return { aborted: view.current.aborted, scripted: view.current.script !== null };
  });
  expect(state).toEqual({ aborted: null, scripted: true });
  const texts = await visibleTexts(page);
  for (const text of wanted) expect(texts).toContain(text);
  expect(texts).toContain('Line 1 · Stufe 1');
  expect(errors).toEqual([]);
});

test('?replay=<seed>&moves=<ungültig>: kein Konsolenfehler, das Replay bleibt mit Hinweis stehen', async ({ page }) => {
  const errors = collectErrors(page);

  // Nicht lesbare Daten: sofort ein Hinweis, Tippen führt zu einem neuen Spiel.
  await page.goto('/?replay=7&moves=v9.kaputt');
  await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 10);
  await expect.poll(async () => (await visibleTexts(page)).includes('Replay gestoppt')).toBe(true);
  expect(await visibleTexts(page)).toContain('Replay nicht möglich: Die Zugdaten sind ungültig.');
  await page.locator('#game canvas').click();
  await page.waitForFunction(() => window.game?.scene.isActive('main') && !window.game.scene.isActive('replay'));

  // Lesbar, aber regelwidrig (sechsmal dieselbe Karte): das Replay bricht an der ersten ungültigen Aktion ab.
  await page.goto('/?replay=7&moves=v1.p10-0.p10-0.p10-0.p10-0.p10-0.p10-0.p10-0.p10-0');
  await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 10);
  await page.waitForFunction(
    () => (window.game!.scene.getScene('replay') as unknown as RecordedReplayView).current.aborted !== null,
    undefined,
    { timeout: 15_000 },
  );
  await expect.poll(async () => (await visibleTexts(page)).includes('Replay gestoppt')).toBe(true);
  expect((await visibleTexts(page)).some((text) => text.startsWith('Replay abgebrochen bei Zug'))).toBe(true);

  // Leerer Wert und Quatsch ohne Punkte und Ziffern.
  for (const moves of ['', '%00%FF', 'v1.p10-']) {
    await page.goto(`/?replay=7&moves=${moves}`);
    await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 5);
    await expect.poll(async () => (await visibleTexts(page)).includes('Replay gestoppt')).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('Nach Spielende zeigt die MainScene eine Teilen-URL, die dasselbe Match als Replay öffnet', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, 7);
  // Alle Runden ohne eigene Karten, nur „Bereit“; das Match endet nach höchstens MAX_ROUNDS Runden.
  for (let round = 0; round < MAX_ROUNDS && (await readState(page)).phase === 'planning'; round += 1) {
    await tapReady(page);
    await expect.poll(async () => (await readState(page)).phase).toBe('combat');
    await fastForwardCombat(page);
  }
  expect((await readState(page)).phase).toBe('over');
  const record = await page.evaluate(
    () => (window.game!.scene.getScene('main') as unknown as { currentRecord: unknown }).currentRecord,
  );
  const url = new URL(`/?replay=7&moves=${encodeMatch(record as RecordedMatch)}`, page.url());

  // Schließen der Statistik, dann steht die URL (in Zeilen umbrochen) im Ende-Bild.
  await tap(page, 180, 524);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.game!.scene.getScene('main') as unknown as RecordedReplayView).children.list
          .filter((c) => c.type === 'Text' && c.visible)
          .map((c) => c.text ?? '')
          .join('\n')
          .replace(/\n/g, ''),
      ),
    )
    .toContain(url.search);

  // Der Link spielt dasselbe Match nach und endet mit demselben Ergebnis.
  const finished = replayRecorded(decodeMatch(7, encodeMatch(record as RecordedMatch))!);
  expect(finished.ok && finished.state.outcome).toBe((await readState(page)).outcome);
  await page.goto(url.toString());
  await page.waitForFunction(() => window.game?.scene.isActive('replay') && window.game.loop.frame > 10);
  await page.waitForFunction(
    () => (window.game!.scene.getScene('replay') as unknown as RecordedReplayView).current.events.length >= 2,
    undefined,
    { timeout: 15_000 },
  );
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

/** Was der Filter-Test von der Szene liest und setzt (Felder sind zur Laufzeit erreichbar). */
interface FilterSceneView {
  state: { players: { hand: string[]; energy: number }[] };
  handFilter: string;
  selected: number | null;
}

test('Kartenfilter: Tasten-Reihenfolge, Abwahl, nicht passende Karten tot, echter Hand-Index', async ({ page }) => {
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
  const click = (point: { x: number; y: number }) => page.mouse.click(point.x, point.y);
  const cardPoint = (index: number) => at(7 + (index % 5) * 70 + 33, 440 + Math.floor(index / 5) * 66 + 31);
  const filterButton = at(173, 612);
  const read = () =>
    page.evaluate(() => {
      const scene = window.game!.scene.getScene('main') as unknown as FilterSceneView;
      return { filter: scene.handFilter, selected: scene.selected, hand: [...scene.state.players[0]!.hand] };
    });

  // Start: Filter „Alle“.
  expect((await read()).filter).toBe('all');

  // Feste Hand und genug Energie, damit das Ergebnis nicht vom Zufall abhängt.
  await page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as FilterSceneView;
    const human = scene.state.players[0]!;
    human.hand = ['tower-hp', 'summon-minion', 'line-upgrade', 'summon-brute'];
    human.energy = 10;
  });

  // Minion wählen, auf „Beschwörung“ schalten: Auswahl bleibt, Karte ist sichtbar.
  await click(cardPoint(1));
  expect((await read()).selected).toBe(1);
  await click(filterButton);
  expect(await read()).toMatchObject({ filter: 'summon', selected: 1 });

  // „Upgrade“: Minion wird ausgeblendet, Auswahl ist null.
  await click(filterButton);
  expect(await read()).toMatchObject({ filter: 'upgrade', selected: null });

  // Abgedunkelte Karte (Tower Leben, Index 0) reagiert nicht, Upgrade-Karte (Index 2) schon.
  await click(cardPoint(0));
  expect((await read()).selected).toBeNull();
  await click(cardPoint(2));
  expect((await read()).selected).toBe(2);

  // Tower → Alle → Beschwörung.
  await click(filterButton);
  expect((await read()).filter).toBe('tower');
  await click(filterButton);
  expect((await read()).filter).toBe('all');
  await click(filterButton);
  expect((await read()).filter).toBe('summon');

  // Bei „Beschwörung“ wird der Brocken mit dem echten Hand-Index 3 gespielt.
  await click(cardPoint(3));
  await click(at(60, 300));
  const after = await read();
  expect(after.hand).toEqual(['tower-hp', 'summon-minion', 'line-upgrade']);
  expect(after.selected).toBeNull();

  expect(errors).toEqual([]);
});
