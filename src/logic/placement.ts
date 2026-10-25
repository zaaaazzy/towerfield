/**
 * Slots für die Platzierung beschworener Minions in der Planungsphase. Ohne Phaser.
 * Jede Line hat in der eigenen Hälfte (Position 0 bis `PLACEMENT_ZONE_END`) feste Slots mit gleichem Abstand.
 * Slot 0 liegt am eigenen Tower, höhere Slots weiter vorn. Wie viele Slots frei sind, bestimmt die Line-Kapazität.
 */
import { LINE_LENGTH, type Minion } from './combat';

/** Position von Slot 0 (Abstand zum eigenen Tower). */
export const SLOT_START = 2;
/** Abstand zweier Slots; größer als die Hälfte der Minion-Reichweite, damit Minions nicht stapeln. */
export const SLOT_SPACING = 4;
/** Ende der eigenen Platzierungszone: Minions dürfen nie weiter als das aufgestellt werden. */
export const PLACEMENT_ZONE_END = 30;

/** Position auf der Line für Slot `slot`. */
export function slotPosition(slot: number): number {
  return SLOT_START + slot * SLOT_SPACING;
}

/** Gültig: ganzzahlig, nicht negativ, kleiner als `slotCount` und innerhalb der Platzierungszone. */
export function isValidSlot(slot: number, slotCount: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < slotCount && slotPosition(slot) <= PLACEMENT_ZONE_END;
}

/** Ein Slot ist belegt, wenn ein eigener Minion der Line näher als der halbe Slotabstand an seiner Position steht. */
export function isSlotFree(minions: readonly Minion[], line: number, slot: number): boolean {
  const position = slotPosition(slot);
  return !minions.some((m) => m.line === line && Math.abs(m.position - position) < SLOT_SPACING / 2);
}

/** Geometrie der Anzeige für die Zuordnung von Zeigerkoordinaten (y wächst nach unten). */
export interface LineGeometry {
  /** x-Mitte jeder Line. */
  lineCenters: readonly number[];
  /** Halbe Breite der Trefferfläche einer Line. */
  lineHalfWidth: number;
  /** y des eigenen Towers (Position 0). */
  ownTowerY: number;
  /** y des gegnerischen Towers (Position `LINE_LENGTH`). */
  enemyTowerY: number;
}

/** Ziel unter dem Zeiger: eine Line, optional mit Slot (`null`, wenn dort kein Slot liegt). */
export interface DropTarget {
  line: number;
  slot: number | null;
}

/** Anzeige-y einer Position auf der Line des eigenen Spielers. */
export function positionToY(position: number, geometry: LineGeometry): number {
  return geometry.ownTowerY - (position / LINE_LENGTH) * (geometry.ownTowerY - geometry.enemyTowerY);
}

/** Umkehrung von `positionToY`. */
export function yToPosition(y: number, geometry: LineGeometry): number {
  return ((geometry.ownTowerY - y) / (geometry.ownTowerY - geometry.enemyTowerY)) * LINE_LENGTH;
}

/**
 * Slot bei `position`: der nächste gültige Slot, solange `position` höchstens einen halben Slotabstand von ihm
 * entfernt ist; sonst `null`. `slotCount` ist die Slot-Zahl der Line.
 */
export function slotAtPosition(position: number, slotCount: number): number | null {
  const slot = Math.round((position - SLOT_START) / SLOT_SPACING);
  if (!isValidSlot(slot, slotCount)) return null;
  return Math.abs(position - slotPosition(slot)) <= SLOT_SPACING / 2 ? slot : null;
}

/** Ordnet einen Zeigerpunkt Line und Slot zu; `null`, wenn er außerhalb aller Lines liegt. */
export function dropTargetAt(
  x: number,
  y: number,
  geometry: LineGeometry,
  slotCounts: readonly number[],
): DropTarget | null {
  const line = geometry.lineCenters.findIndex((center) => Math.abs(x - center) <= geometry.lineHalfWidth);
  if (line < 0) return null;
  if (y < geometry.enemyTowerY - 30 || y > geometry.ownTowerY + 12) return null;
  return { line, slot: slotAtPosition(yToPosition(y, geometry), slotCounts[line] ?? 0) };
}

/** Niedrigster freier Slot der Line, oder `undefined`, wenn keiner frei ist. */
export function firstFreeSlot(minions: readonly Minion[], line: number, slotCount: number): number | undefined {
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (isValidSlot(slot, slotCount) && isSlotFree(minions, line, slot)) return slot;
  }
  return undefined;
}
