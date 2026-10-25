/**
 * Reine Entscheidungen für das Aussehen der Minions: Form nach Rolle, Größe nach Max-HP, Blickrichtung, Wippen beim
 * Laufen und Trefferblitz. Ohne Phaser; die Szene (`field-view.ts`) zeichnet nur. Zeit kommt immer aus `delta`.
 */
import { type Explosion, MINION_RANGE } from './combat';
import type { FxEvent } from './fx-events';

export type MinionShape = 'melee' | 'ranged' | 'healer' | 'destroyer';

/** Kleinster und größter gezeichneter Radius in Spielpixeln. */
export const MIN_RADIUS = 6;
export const MAX_RADIUS = 11;
/** Max-HP, bis zu der die Größe wächst: ab `RADIUS_HP_MIN` wird sie größer, ab `RADIUS_HP_MAX` bleibt sie gleich. */
const RADIUS_HP_MIN = 20;
const RADIUS_HP_MAX = 80;

/** Dauer des Trefferblitzes in ms. */
export const FLASH_MS = 180;
/** Dauer eines Wipp-Zyklus in ms und Höhe des Ausschlags in Pixeln. */
export const BOB_PERIOD_MS = 360;
export const BOB_AMPLITUDE = 1.4;

/** Heiler zuerst, dann Zerstörer (hat `explodes`), danach Reichweite über der Nahkampf-Reichweite = Fernkämpfer, sonst Nahkämpfer. */
export function minionShape(minion: { heals?: boolean; explodes?: Explosion; range: number }): MinionShape {
  if (minion.heals) return 'healer';
  if (minion.explodes) return 'destroyer';
  return minion.range > MINION_RANGE ? 'ranged' : 'melee';
}

/** Gezeichneter Radius, wächst linear mit Max-HP zwischen `MIN_RADIUS` und `MAX_RADIUS`. */
export function minionRadius(maxHp: number): number {
  const t = (maxHp - RADIUS_HP_MIN) / (RADIUS_HP_MAX - RADIUS_HP_MIN);
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.min(1, Math.max(0, t));
}

/** Blickrichtung in x: Spielereinheiten laufen nach rechts (1), Bot-Einheiten nach links (-1). */
export function facing(owner: number): -1 | 1 {
  return owner === 0 ? 1 : -1;
}

/** Abstand in Pixeln, um den benachbarte Minions quer zur Lane gegeneinander versetzt gezeichnet werden. */
export const STAGGER_STEP = 9;

/**
 * Querversatz (y) eines Minions auf seiner Lane: drei feste Bahnen (oberhalb, auf, unterhalb der Lane-Mitte) nach
 * Minion-ID. So stehen Minions auf engen Slots nicht aufeinander und rücken auch beim Laufen nicht um. Reine Darstellung.
 */
export function laneStagger(minionId: number): number {
  return ((minionId % 3) - 1) * STAGGER_STEP;
}

/** Senkrechter Versatz (Wippen) beim Laufen; von der Zeit abhängig, nicht von Frames. Jeder Minion hat eine eigene Phase. */
export function bobOffset(timeMs: number, minionId: number, moving: boolean): number {
  if (!moving) return 0;
  const phase = (timeMs / BOB_PERIOD_MS + minionId * 0.37) * Math.PI * 2;
  return Math.sin(phase) * BOB_AMPLITUDE;
}

/** Stärke des Trefferblitzes (1 = frisch, 0 = vorbei) bei verbleibender Zeit `remainingMs`. */
export function flashStrength(remainingMs: number): number {
  return Math.min(1, Math.max(0, remainingMs / FLASH_MS));
}

export const flashKey = (owner: number, minionId: number): string => `${owner}:${minionId}`;

/** Restzeit der Blitze je Minion: Zeit läuft mit `deltaMs` ab, neue `minion-damage`-Ereignisse starten sie neu. */
export function updateFlashes(
  flashes: ReadonlyMap<string, number>,
  events: readonly FxEvent[],
  deltaMs: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [key, remaining] of flashes) {
    if (remaining - deltaMs > 0) next.set(key, remaining - deltaMs);
  }
  for (const event of events) {
    if (event.kind === 'minion-damage') next.set(flashKey(event.owner, event.minionId), FLASH_MS);
  }
  return next;
}
