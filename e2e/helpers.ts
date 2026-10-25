import { expect, type Page } from '@playwright/test';
import { getCardDef } from '../src/logic/cards';
import { cardAt, fanLayout, HAND_FAN, poseContains, sortHand } from '../src/logic/hand-layout';
import type { MatchState } from '../src/logic/match';
import { type LineGeometry, positionToY, slotPosition } from '../src/logic/placement';

/** Spielfläche in Spielkoordinaten (wie `VIEW` in der Szene). */
const VIEW = { width: 360, height: 640 };

/** Feste Seed für reproduzierbare Hände (per `?seed=`). */
export const SEED = 1;

/** Was die Tests von der Szene `main` lesen (nur Typ, der Code läuft im Browser). */
export interface MainSceneView {
  current: MatchState;
  selectedCard: number | null;
  update(time: number, deltaMs: number): void;
  children: { list: { type: string; visible: boolean; text?: string }[] };
}

/** Sammelt Konsolenfehler und Seitenfehler; am Testende `expect(errors).toEqual([])`. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Öffnet das Spiel mit festem Seed und wartet, bis die Szene läuft. */
export async function openGame(page: Page, seed: number = SEED): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => window.game?.scene.isActive('main') && window.game.loop.frame > 10);
}

/** Tippt auf eine Stelle in Spielkoordinaten (360x640). */
export async function tap(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#game canvas').boundingBox())!;
  await page.mouse.click(box.x + (x / VIEW.width) * box.width, box.y + (y / VIEW.height) * box.height);
}

/**
 * Ein Punkt, an dem die Handkarte mit Hand-Index `index` in Ruhelage sichtbar die oberste ist (Fächer aus
 * `src/logic/hand-layout.ts`). Gesucht wird der Punkt der sichtbaren Fläche, der der Kartenmitte am nächsten liegt.
 */
export function cardPoint(hand: readonly string[], index: number, exclusive = false): { x: number; y: number } {
  const order = sortHand(hand.map((id) => getCardDef(id).type));
  const poses = fanLayout(hand.length);
  const slot = order.indexOf(index);
  const pose = poses[slot]!;
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let dy = -HAND_FAN.cardHeight; dy <= HAND_FAN.cardHeight; dy += 2) {
    for (let dx = -HAND_FAN.cardWidth; dx <= HAND_FAN.cardWidth; dx += 2) {
      const x = pose.x + dx;
      const y = pose.y + dy;
      if (cardAt(poses, x, y) !== slot) continue;
      // `exclusive`: nur Punkte, auf denen keine andere Karte darunterliegt (wichtig für ausgeblendete Karten).
      if (exclusive && poses.some((other, otherSlot) => otherSlot !== slot && poseContains(other, x, y))) continue;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }
  if (!best) throw new Error(`Handkarte ${index} ist nicht sichtbar`);
  return best;
}

/** Punkt der Handkarte `index` im aktuellen Spielzustand. */
export async function cardPointOf(page: Page, index: number): Promise<{ x: number; y: number }> {
  return cardPoint((await readState(page)).players[0].hand, index);
}

export const LINE_X = [60, 180, 300];
const LINE_TAP_Y = 250;
export const READY_BUTTON = { x: 290, y: 612 };

/**
 * Spiegel von `GEOMETRY`/`FIELD` aus `src/scenes/field-view.ts`. Die Datei importiert Phaser und läuft nicht im
 * Node-Prozess der Tests; die Positionsberechnung selbst kommt aus `src/logic/placement.ts`.
 */
const GEOMETRY: LineGeometry = { lineCenters: LINE_X, lineHalfWidth: 50, ownTowerY: 400, enemyTowerY: 90 };

/** Schwelle der Szene, ab der eine Bewegung als Ziehen gilt (`DRAG_THRESHOLD` in `main-scene.ts`). */
export const DRAG_THRESHOLD = 8;

export interface Point {
  x: number;
  y: number;
}

/** Spielkoordinaten des Slots `slot` auf der Line `line` (Mitte der Line). */
export function slotPoint(line: number, slot: number): Point {
  return { x: LINE_X[line]!, y: positionToY(slotPosition(slot), GEOMETRY) };
}

/** Spielkoordinaten, an denen die Szene einen eigenen Minion zeichnet (greifbar, mit seitlichem Versatz je `id`). */
export function minionPoint(minion: { id: number; line: number; position: number }): Point {
  return { x: LINE_X[minion.line]! + (minion.id % 2 === 0 ? 8 : -8), y: positionToY(minion.position, GEOMETRY) };
}

/** Punkt zwischen zwei Lines, der zu keiner Line gehört. */
export function pointBetweenLines(): Point {
  return { x: (LINE_X[0]! + LINE_X[1]!) / 2, y: slotPoint(0, 1).y };
}

/**
 * Zieht mit gedrückter Maustaste von `from` nach `to` (Spielkoordinaten, gleiche Umrechnung wie `tap`).
 * Mehrere `steps`, sonst erzeugt Playwright nur ein einziges Move-Ereignis.
 */
export async function drag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  const box = (await page.locator('#game canvas').boundingBox())!;
  const toPage = (point: Point) => ({
    x: box.x + (point.x / VIEW.width) * box.width,
    y: box.y + (point.y / VIEW.height) * box.height,
  });
  const start = toPage(from);
  const end = toPage(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

export async function tapCard(page: Page, index: number): Promise<void> {
  const point = await cardPointOf(page, index);
  await tap(page, point.x, point.y);
}
export const tapLine = (page: Page, line: number) => tap(page, LINE_X[line]!, LINE_TAP_Y);
export const tapReady = (page: Page) => tap(page, READY_BUTTON.x, READY_BUTTON.y);

/** Kopie des aktuellen Spielzustands (aus `scene.current`, nicht aus Pixeln). */
export function readState(page: Page): Promise<MatchState> {
  return page.evaluate(() => (window.game!.scene.getScene('main') as unknown as MainSceneView).current);
}

export function readSelected(page: Page): Promise<number | null> {
  return page.evaluate(() => (window.game!.scene.getScene('main') as unknown as MainSceneView).selectedCard);
}

/**
 * Lässt die laufende Kampfphase in der Szene schneller ablaufen (ruft deren `update` mit großem `delta` auf),
 * bis sie endet. Die Regeln laufen unverändert, nur die Wartezeit von 20 s je Runde entfällt.
 */
export function fastForwardCombat(page: Page): Promise<void> {
  return page.evaluate(() => {
    const scene = window.game!.scene.getScene('main') as unknown as MainSceneView;
    for (let guard = 0; guard < 1000 && scene.current.phase === 'combat'; guard += 1) scene.update(0, 1000);
  });
}

/** Ob ein sichtbarer Text mit genau diesem Inhalt in der Szene steht. */
export function hasVisibleText(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    (wanted) =>
      (window.game!.scene.getScene('main') as unknown as MainSceneView).children.list.some(
        (child) => child.type === 'Text' && child.visible && child.text === wanted,
      ),
    text,
  );
}
