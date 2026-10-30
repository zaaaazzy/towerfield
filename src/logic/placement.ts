/**
 * Turm-Slots für die Platzierung beschworener Minions in der Planungsphase. Ohne Phaser.
 * Jeder lebende Tower einer Lane bietet genau zwei Slots, einen oben (Seite 0) und einen unten (Seite 1). Die Slot-Nummer
 * einer Lane ist `2 * Tower-Index + Seite`. Ein Slot fasst höchstens ein Minion; ein zerstörter Tower bietet keine Slots.
 * Ein Minion startet jede Runde auf der Position seines Towers (`Tower.offset`) und muss nicht neu gesetzt werden.
 * Dazu kommt je Lane ein Lane-Slot hinter dem eigenen Ende für eine Lane-Karte (höchstens eine aktive je Lane).
 */
import { LINE_LENGTH, type LaneEffect, type Minion, type Tower } from './combat';

/** Slots je Tower: oben und unten. */
export const SLOTS_PER_TOWER = 2;
/** Senkrechter Abstand der Slots zur Lane-Mitte in Spielpixeln (oben negativ, unten positiv). */
export const SLOT_DY = 28;
/** Loslassen näher als das (Spielpixel) rastet am Slot ein. */
export const SNAP_RADIUS = 34;
/** Ab dieser Entfernung (Spielpixel) hebt sich ein Slot-Punkt nicht mehr hervor. */
export const GLOW_RADIUS = 80;
/** Abstand des Lane-Slots vom Tower-Ende der Lane nach hinten (Spielpixel). */
export const LANE_SLOT_GAP = 18;

/** Tower-Index eines Slots. */
export function slotTower(slot: number): number {
  return Math.floor(slot / SLOTS_PER_TOWER);
}

/** Seite eines Slots: 0 oben, 1 unten. */
export function slotSide(slot: number): 0 | 1 {
  return (slot % SLOTS_PER_TOWER) as 0 | 1;
}

/** Slot-Nummer aus Tower-Index und Seite. */
export function makeSlot(tower: number, side: 0 | 1): number {
  return tower * SLOTS_PER_TOWER + side;
}

/** Anzeigename eines Slots, z. B. „Turm 2 oben“. */
export function describeSlot(slot: number): string {
  return `Turm ${slotTower(slot) + 1} ${slotSide(slot) === 0 ? 'oben' : 'unten'}`;
}

/** Gültig: ganzzahlig, nicht negativ und der zugehörige Tower lebt. */
export function isValidSlot(towers: readonly Tower[], slot: number): boolean {
  if (!Number.isInteger(slot) || slot < 0) return false;
  const tower = towers[slotTower(slot)];
  return tower !== undefined && tower.hp > 0;
}

/** Alle gültigen Slots der Lane, aufsteigend (zwei je lebendem Tower). */
export function validSlots(towers: readonly Tower[]): number[] {
  const slots: number[] = [];
  towers.forEach((tower, index) => {
    if (tower.hp <= 0) return;
    for (const side of [0, 1] as const) slots.push(makeSlot(index, side));
  });
  return slots;
}

/** Position auf der Lane, auf der ein Minion von diesem Slot aus startet: der Standort des Towers. */
export function slotPosition(towers: readonly Tower[], slot: number): number {
  return towers[slotTower(slot)]?.offset ?? 0;
}

/** Ein Slot ist belegt, wenn ein Minion der Lane diesen Slot trägt. */
export function isSlotFree(minions: readonly Minion[], line: number, slot: number): boolean {
  return !minions.some((m) => m.line === line && m.slot === slot);
}

/** Alle freien gültigen Slots der Lane, aufsteigend. */
export function freeSlots(minions: readonly Minion[], line: number, towers: readonly Tower[]): number[] {
  return validSlots(towers).filter((slot) => isSlotFree(minions, line, slot));
}

/** Niedrigster freier Slot der Lane, oder `undefined`, wenn keiner frei ist. */
export function firstFreeSlot(minions: readonly Minion[], line: number, towers: readonly Tower[]): number | undefined {
  return freeSlots(minions, line, towers)[0];
}

/** Geometrie der Anzeige für die Zuordnung von Zeigerkoordinaten (x wächst nach rechts, y nach unten). */
export interface LineGeometry {
  /** y-Mitte jeder Lane (nach Lane-Index). */
  laneCenters: readonly number[];
  /** Halbe Höhe der Trefferfläche einer Lane. */
  laneHalfHeight: number;
  /** x des eigenen Endes (Position 0, links). */
  ownTowerX: number;
  /** x des gegnerischen Endes (Position `LINE_LENGTH`, rechts). */
  enemyTowerX: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Ein Turm-Slot in Bildschirmkoordinaten. */
export interface SlotPoint extends Point {
  line: number;
  slot: number;
}

/** Anzeige-x einer Position auf der Lane des eigenen Spielers. */
export function positionToX(position: number, geometry: LineGeometry): number {
  return geometry.ownTowerX + (position / LINE_LENGTH) * (geometry.enemyTowerX - geometry.ownTowerX);
}

/** Umkehrung von `positionToX`. */
export function xToPosition(x: number, geometry: LineGeometry): number {
  return ((x - geometry.ownTowerX) / (geometry.enemyTowerX - geometry.ownTowerX)) * LINE_LENGTH;
}

/** Bildschirmpunkt des Slots `slot` der Lane `line` des eigenen Spielers (oben über, unten unter der Lane-Mitte). */
export function slotPoint(line: number, towers: readonly Tower[], slot: number, geometry: LineGeometry): SlotPoint {
  const sign = slotSide(slot) === 0 ? -1 : 1;
  return {
    line,
    slot,
    x: positionToX(slotPosition(towers, slot), geometry),
    y: geometry.laneCenters[line]! + sign * SLOT_DY,
  };
}

/** Eine Lane für die Slot-Suche: ihre Tower und die aktive Lane-Wirkung. */
export interface SlotLane {
  towers: readonly Tower[];
  laneEffect?: LaneEffect;
  /** `false`: Lane noch nicht gekauft; ihre Tower stehen, bieten aber keine Slots an. Fehlt das Feld, gilt die Lane als frei. */
  bought?: boolean;
}

/**
 * Alle freien, gültigen Turm-Slots des eigenen Spielers in Bildschirmkoordinaten (die Ziele für grüne Punkte). Belegte
 * Slots und Slots zerstörter oder fehlender Tower fehlen. Der Slot eines gezogenen Minions bleibt belegt, er ist kein Ziel.
 */
export function freeSlotPoints(
  lanes: readonly SlotLane[],
  minions: readonly Minion[],
  geometry: LineGeometry,
): SlotPoint[] {
  return lanes.flatMap((lane, line) =>
    lane.bought === false
      ? []
      : freeSlots(minions, line, lane.towers).map((slot) => slotPoint(line, lane.towers, slot, geometry)),
  );
}

/** Bildschirmpunkt des Lane-Slots der Lane `line`: hinter dem eigenen Ende (links neben dem ersten Tower). */
export function laneSlotPoint(line: number, geometry: LineGeometry): Point {
  return { x: geometry.ownTowerX - LANE_SLOT_GAP, y: geometry.laneCenters[line]! };
}

/** Ein Lane-Slot in Bildschirmkoordinaten. */
export interface LaneSlotPoint extends Point {
  line: number;
}

/** Lane-Slots aller freien Lanes (mindestens ein lebender Tower), die noch keine Lane-Karte tragen. */
export function freeLaneSlotPoints(lanes: readonly SlotLane[], geometry: LineGeometry): LaneSlotPoint[] {
  const points: LaneSlotPoint[] = [];
  lanes.forEach((lane, line) => {
    if (lane.bought === false || lane.laneEffect !== undefined || !lane.towers.some((tower) => tower.hp > 0)) return;
    points.push({ line, ...laneSlotPoint(line, geometry) });
  });
  return points;
}

/** Der Punkt, der `(x, y)` am nächsten liegt, mit seinem Abstand; `null` ohne Punkte. Bei Gleichstand der erste. */
export function nearestPoint<T extends Point>(points: readonly T[], x: number, y: number): { point: T; distance: number } | null {
  let best: { point: T; distance: number } | null = null;
  for (const point of points) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (best === null || distance < best.distance) best = { point, distance };
  }
  return best;
}

/** Der Punkt, an dem eine Karte beim Loslassen auf `(x, y)` einrastet: der nächste in `SNAP_RADIUS`, sonst `null`. */
export function snapTarget<T extends Point>(points: readonly T[], x: number, y: number, radius = SNAP_RADIUS): T | null {
  const near = nearestPoint(points, x, y);
  return near !== null && near.distance <= radius ? near.point : null;
}

/** Hervorhebung eines Punkts nach Zeigerabstand: 1 direkt darauf, 0 ab `GLOW_RADIUS`, dazwischen weich (Ease-out). */
export function slotProximity(distance: number): number {
  if (!(distance < GLOW_RADIUS)) return 0;
  const t = 1 - Math.max(0, distance) / GLOW_RADIUS;
  return t * t * (3 - 2 * t);
}
