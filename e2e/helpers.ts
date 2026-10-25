import { expect, type Page } from '@playwright/test';
import { getCardDef } from '../src/logic/cards';
import { cardAt, fanLayout, HAND_FAN, poseContains, sortHand } from '../src/logic/hand-layout';
import type { MatchState } from '../src/logic/match';
import { laneStagger } from '../src/logic/minion-look';
import { laneTowerOffsets } from '../src/logic/lanes';
import { laneSlotPoint, type LineGeometry, positionToX, slotPoint as logicSlotPoint } from '../src/logic/placement';

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

/** y-Mitte der Lane `Lane-Index` (Start-Lane 232, Reihen im Abstand 70), Spiegel von `FIELD` in `field-view.ts`. */
export const LANE_Y = [232, 162, 302, 92, 372];
const LANE_TAP_X = 180;
export const READY_BUTTON = { x: 290, y: 612 };

/**
 * Spiegel von `GEOMETRY`/`FIELD` aus `src/scenes/field-view.ts`. Die Datei importiert Phaser und läuft nicht im
 * Node-Prozess der Tests; die Positionsberechnung selbst kommt aus `src/logic/placement.ts`.
 */
const GEOMETRY: LineGeometry = { laneCenters: LANE_Y, laneHalfHeight: 33, ownTowerX: 30, enemyTowerX: 330 };

/** Schwelle der Szene, ab der eine Bewegung als Ziehen gilt (`DRAG_THRESHOLD` in `main-scene.ts`). */
export const DRAG_THRESHOLD = 8;

export interface Point {
  x: number;
  y: number;
}

/** Die Tower einer frisch ausgebauten Lane (nur ihre Standorte zählen für die Slot-Punkte). */
const laneTowers = (line: number) =>
  laneTowerOffsets(line).map((offset) => ({ offset, hp: 100, maxHp: 100, damage: 8 }));

/** Spielkoordinaten des Turm-Slots `slot` (2 · Tower + Seite, 0 oben / 1 unten) auf der Lane `line`. */
export function slotPoint(line: number, slot: number): Point {
  const { x, y } = logicSlotPoint(line, laneTowers(line), slot, GEOMETRY);
  return { x, y };
}

/** Spielkoordinaten des Lane-Slots der Lane `line` (hinter den Türmen). */
export function laneSlot(line: number): Point {
  return laneSlotPoint(line, GEOMETRY);
}

/** Taste „Abwerfen“ (Mitte), Spiegel von `DISCARD_BUTTON` in `main-scene.ts`. */
export const DISCARD_BUTTON = { x: 54, y: 44 };

/**
 * Spielkoordinaten, an denen die Szene einen eigenen Minion zeichnet (greifbar): auf seinem Turm-Slot, solange er
 * dort steht (Planung), sonst auf der Lane mit Querversatz je `id`.
 */
export function minionPoint(minion: { id: number; line: number; position: number; slot?: number }): Point {
  const offsets = laneTowerOffsets(minion.line);
  const onSlot = minion.slot !== undefined && offsets[Math.floor(minion.slot / 2)] === minion.position;
  if (onSlot) return slotPoint(minion.line, minion.slot!);
  return { x: positionToX(minion.position, GEOMETRY), y: LANE_Y[minion.line]! + laneStagger(minion.id) };
}

/** Punkt zwischen der Start-Lane und der Lane darüber, weit von allen Turm-Slots, der zu keiner Lane gehört. */
export function pointBetweenLines(): Point {
  return { x: 200, y: (LANE_Y[0]! + LANE_Y[1]!) / 2 };
}

/** Ziele, die die Szene gerade als grüne Punkte zeigt (Spiegel von `MainScene.slotDots`). */
export interface SlotDotView {
  line: number;
  slot: number | null;
  x: number;
  y: number;
  proximity: number;
}

export function readDots(page: Page): Promise<SlotDotView[]> {
  return page.evaluate(() => (window.game!.scene.getScene('main') as unknown as { slotDots: SlotDotView[] }).slotDots);
}

/** Maus in Spielkoordinaten bewegen / drücken / loslassen, für Ziehen in mehreren Schritten mit Zwischenprüfung. */
async function toPage(page: Page, point: Point): Promise<Point> {
  const box = (await page.locator('#game canvas').boundingBox())!;
  return { x: box.x + (point.x / VIEW.width) * box.width, y: box.y + (point.y / VIEW.height) * box.height };
}

export async function pointerDown(page: Page, point: Point): Promise<void> {
  const p = await toPage(page, point);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
}

export async function pointerMove(page: Page, point: Point, steps = 6): Promise<void> {
  const p = await toPage(page, point);
  await page.mouse.move(p.x, p.y, { steps });
}

export async function pointerUp(page: Page): Promise<void> {
  await page.mouse.up();
}

/** Zieht die Handkarte `index` (am Fächer gegriffen) auf den Punkt `to`. */
export async function dragCard(page: Page, index: number, to: Point, steps = 8): Promise<void> {
  await drag(page, await cardPointOf(page, index), to, steps);
}

/** Stellt eine Hand mit diesen Karten und Energie her (nur im Szenenzustand der Tests, die Regeln laufen unverändert). */
export function setHand(page: Page, hand: string[], energy: number): Promise<void> {
  return page.evaluate(
    ([cards, points]) => {
      const scene = window.game!.scene.getScene('main') as unknown as {
        state: { players: { hand: string[]; energy: number }[] };
      };
      scene.state.players[0]!.hand = cards as string[];
      scene.state.players[0]!.energy = points as number;
    },
    [hand, energy] as const,
  );
}

/** Schaltet die Lanes der Ausbaustufe `level` für den Menschen frei (setzt nur `level` im Szenenzustand der Tests). */
export function unlockField(page: Page, level = 2): Promise<void> {
  return page.evaluate((wanted) => {
    const scene = window.game!.scene.getScene('main') as unknown as { state: { players: { level: number }[] } };
    scene.state.players[0]!.level = wanted;
  }, level);
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
export const tapLine = (page: Page, line: number) => tap(page, LANE_TAP_X, LANE_Y[line]!);
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
