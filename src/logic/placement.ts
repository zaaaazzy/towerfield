/**
 * Slots für die Platzierung beschworener Minions in der Planungsphase. Ohne Phaser.
 * Jede freie Lane hat am eigenen Ende (Position 0 bis `PLACEMENT_ZONE_END`) feste Slots mit gleichem Abstand. Die Zone
 * umschließt die Tower der Lane (Start-Lane: Tower bei 0, 8 und 16): Slots liegen zwischen, neben und vor den Towern.
 * Wie viele Slots frei sind, bestimmt die Lane-Kapazität.
 */
import { LINE_LENGTH, type Minion } from './combat';

/** Position von Slot 0 (Abstand zum eigenen Ende der Lane). */
export const SLOT_START = 2;
/** Abstand zweier Slots; größer als die Hälfte der Minion-Reichweite, damit Minions nicht stapeln. */
export const SLOT_SPACING = 4;
/** Ende der eigenen Platzierungszone: Minions dürfen nie weiter als das aufgestellt werden. */
export const PLACEMENT_ZONE_END = 30;

/** Position auf der Lane für Slot `slot`. */
export function slotPosition(slot: number): number {
  return SLOT_START + slot * SLOT_SPACING;
}

/** Gültig: ganzzahlig, nicht negativ, kleiner als `slotCount` und innerhalb der Platzierungszone. */
export function isValidSlot(slot: number, slotCount: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < slotCount && slotPosition(slot) <= PLACEMENT_ZONE_END;
}

/** Ein Slot ist belegt, wenn ein eigener Minion der Lane näher als der halbe Slotabstand an seiner Position steht. */
export function isSlotFree(minions: readonly Minion[], line: number, slot: number): boolean {
  const position = slotPosition(slot);
  return !minions.some((m) => m.line === line && Math.abs(m.position - position) < SLOT_SPACING / 2);
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

/** Ziel unter dem Zeiger: eine Lane, optional mit Slot (`null`, wenn dort kein Slot liegt). */
export interface DropTarget {
  line: number;
  slot: number | null;
}

/** Anzeige-x einer Position auf der Lane des eigenen Spielers. */
export function positionToX(position: number, geometry: LineGeometry): number {
  return geometry.ownTowerX + (position / LINE_LENGTH) * (geometry.enemyTowerX - geometry.ownTowerX);
}

/** Umkehrung von `positionToX`. */
export function xToPosition(x: number, geometry: LineGeometry): number {
  return ((x - geometry.ownTowerX) / (geometry.enemyTowerX - geometry.ownTowerX)) * LINE_LENGTH;
}

/**
 * Slot bei `position`: der nächste gültige Slot, solange `position` höchstens einen halben Slotabstand von ihm
 * entfernt ist; sonst `null`. `slotCount` ist die Slot-Zahl der Lane.
 */
export function slotAtPosition(position: number, slotCount: number): number | null {
  const slot = Math.round((position - SLOT_START) / SLOT_SPACING);
  if (!isValidSlot(slot, slotCount)) return null;
  return Math.abs(position - slotPosition(slot)) <= SLOT_SPACING / 2 ? slot : null;
}

/**
 * Ordnet einen Zeigerpunkt Lane und Slot zu; `null`, wenn er außerhalb aller freien Lanes liegt. Eine Lane ohne Slots
 * (`slotCounts[lane]` ist 0, also nicht frei) trifft der Zeiger nicht.
 */
export function dropTargetAt(
  x: number,
  y: number,
  geometry: LineGeometry,
  slotCounts: readonly number[],
): DropTarget | null {
  const line = geometry.laneCenters.findIndex(
    (center, lane) => (slotCounts[lane] ?? 0) > 0 && Math.abs(y - center) <= geometry.laneHalfHeight,
  );
  if (line < 0) return null;
  if (x < geometry.ownTowerX - 30 || x > geometry.enemyTowerX + 30) return null;
  return { line, slot: slotAtPosition(xToPosition(x, geometry), slotCounts[line]!) };
}

/** Niedrigster freier Slot der Lane, oder `undefined`, wenn keiner frei ist. */
export function firstFreeSlot(minions: readonly Minion[], line: number, slotCount: number): number | undefined {
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (isValidSlot(slot, slotCount) && isSlotFree(minions, line, slot)) return slot;
  }
  return undefined;
}
