/**
 * Regel der Karte „Minion stärken“ (`buff-minion`): ein einzelner Minion wächst um einen festen Anteil seiner
 * aktuellen Werte. Ohne Phaser, DOM und Canvas.
 */
import type { Minion } from './combat';

/** Anteil von `maxHp` und `damage`, um den ein Buff den Minion stärkt (50 %). */
export const BUFF_RATIO = 0.5;

/** Zuwachs für `value`: `BUFF_RATIO` davon, kaufmännisch gerundet (ab .5 auf), z. B. 5 → 3. */
export function buffGain(value: number): number {
  return Math.round(value * BUFF_RATIO);
}

/**
 * Stärkt `minion` (verändert ihn): `maxHp` und `hp` steigen um denselben Zuwachs aus dem aktuellen `maxHp`, `damage`
 * um den Zuwachs aus dem aktuellen `damage`. Mehrere Buffs wirken nacheinander auf die jeweils aktuellen Werte.
 */
export function applyMinionBuff(minion: Minion): void {
  const maxHp = minion.maxHp ?? minion.hp;
  const hpGain = buffGain(maxHp);
  minion.maxHp = maxHp + hpGain;
  minion.hp += hpGain;
  minion.damage += buffGain(minion.damage);
}
