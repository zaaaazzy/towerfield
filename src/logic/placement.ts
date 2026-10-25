/**
 * Slots für die Platzierung beschworener Minions in der Planungsphase. Ohne Phaser.
 * Jede Line hat in der eigenen Hälfte (Position 0 bis `PLACEMENT_ZONE_END`) feste Slots mit gleichem Abstand.
 * Slot 0 liegt am eigenen Tower, höhere Slots weiter vorn. Wie viele Slots frei sind, bestimmt die Line-Kapazität.
 */
import type { Minion } from './combat';

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

/** Niedrigster freier Slot der Line, oder `undefined`, wenn keiner frei ist. */
export function firstFreeSlot(minions: readonly Minion[], line: number, slotCount: number): number | undefined {
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (isValidSlot(slot, slotCount) && isSlotFree(minions, line, slot)) return slot;
  }
  return undefined;
}
