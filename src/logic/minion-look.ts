/**
 * Reine Entscheidungen für das Aussehen der Minions: Form nach Rolle, Größe nach Max-HP, Blickrichtung, Wippen beim
 * Laufen und Trefferblitz. Ohne Phaser; die Szene (`field-view.ts`) zeichnet nur. Zeit kommt immer aus `delta`.
 */
import { effectiveRange, type Explosion, LINE_LENGTH, MINION_RANGE, type Minion } from './combat';
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

/** Dauer eines Wegzyklus (zwei Schritte) in ms. */
export const WALK_PERIOD_MS = 520;
/** Dauer der Angriffsbewegung (Schlag, Schuss, Zauber) in ms. */
export const ATTACK_MS = 280;
/** Dauer der Sterbeanimation in ms; danach verschwindet die Kopie der Einheit. */
export const DEATH_MS = 450;
/** Maximaler Fallwinkel der Sterbeanimation (rad, nach hinten). */
export const DEATH_FALL_ANGLE = Math.PI / 2;

export type MinionPhase = 'idle' | 'walk' | 'attack' | 'die';

/** Wegzyklus 0 bis 1 aus der Szenenzeit; je Minion phasenversetzt. Unabhängig von der Bildrate. */
export function walkCycle(timeMs: number, minionId: number): number {
  const t = timeMs / WALK_PERIOD_MS + minionId * 0.37;
  return t - Math.floor(t);
}

/** Schrittausschlag der Beine (-1 bis 1) zum Wegzyklus. */
export function strideSwing(cycle: number): number {
  return Math.sin(cycle * Math.PI * 2);
}

/** Phase einer lebenden Einheit: Angriff vor Laufen vor Stehen. Sterbende Einheiten sind Ghosts (`MinionGhost`). */
export function minionPhase(moving: boolean, attackRemainingMs: number): Exclude<MinionPhase, 'die'> {
  if (attackRemainingMs > 0) return 'attack';
  return moving ? 'walk' : 'idle';
}

/** Fortschritt der Angriffsbewegung: 0 = Beginn, 1 = vorbei (bei keiner Restzeit 1). */
export function attackProgress(remainingMs: number): number {
  return 1 - Math.min(1, Math.max(0, remainingMs / ATTACK_MS));
}

/** Fortschritt der Sterbeanimation: 0 = Beginn, 1 = fertig. */
export function deathProgress(ageMs: number): number {
  return Math.min(1, Math.max(0, ageMs / DEATH_MS));
}

/** Ausblenden beim Sterben: voll sichtbar, in der zweiten Hälfte der Animation ausgeblendet. */
export function deathAlpha(progress: number): number {
  return 1 - Math.min(1, Math.max(0, (progress - 0.5) * 2));
}

/** Fallwinkel (rad) beim Sterben: kippt zügig nach hinten und bleibt liegen. */
export function deathAngle(progress: number): number {
  const t = Math.min(1, Math.max(0, progress / 0.7));
  return DEATH_FALL_ANGLE * t * t;
}

/** Eine eben gestorbene Einheit, die die Szene noch kurz zeichnet (die Logik hat sie schon aus dem Zustand entfernt). */
export interface MinionGhost {
  owner: number;
  id: number;
  line: number;
  position: number;
  shape: MinionShape;
  radius: number;
  ageMs: number;
}

/** Zeit, Blitze, Angriffe und Sterbende der Minions; die Szenen halten sie und schreiben sie über `advanceMinionAnim` fort. */
export interface MinionAnim {
  timeMs: number;
  flashes: ReadonlyMap<string, number>;
  /** Restzeit der Angriffsbewegung je Minion (`flashKey`). */
  attacks: ReadonlyMap<string, number>;
  ghosts: readonly MinionGhost[];
}

export const newMinionAnim = (): MinionAnim => ({ timeMs: 0, flashes: new Map(), attacks: new Map(), ghosts: [] });

type Side = { minions: readonly Minion[] };

/** Toleranz in Positionen, weil der Zustand nach dem Tick etwas weiter ist als beim Treffer. */
const REACH_SLACK = 1.5;

/** Schlüssel der Minions, die den Treffer (`minion-damage`) oder die Heilung (`minion-heal`) ausgeführt haben dürften. */
export function attackerKeys(event: FxEvent, players: readonly Side[]): string[] {
  if (event.kind === 'minion-damage') {
    const enemy = players[1 - event.owner];
    if (!enemy) return [];
    return enemy.minions
      .filter(
        (other) =>
          other.line === event.line &&
          !other.heals &&
          other.hp > 0 &&
          LINE_LENGTH - other.position - event.position <= effectiveRange(other) + REACH_SLACK,
      )
      .map((other) => flashKey(1 - event.owner, other.id));
  }
  if (event.kind === 'minion-heal') {
    const allies = players[event.owner];
    if (!allies) return [];
    return allies.minions
      .filter(
        (other) =>
          other.heals === true &&
          other.id !== event.minionId &&
          other.line === event.line &&
          other.hp > 0 &&
          Math.abs(other.position - event.position) <= effectiveRange(other) + REACH_SLACK,
      )
      .map((other) => flashKey(event.owner, other.id));
  }
  return [];
}

/** Restzeit der Angriffsbewegungen: läuft mit `deltaMs` ab; jeder Treffer oder jede Heilung startet sie beim Täter neu. */
export function updateAttacks(
  attacks: ReadonlyMap<string, number>,
  events: readonly FxEvent[],
  players: readonly Side[],
  deltaMs: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [key, remaining] of attacks) {
    if (remaining - deltaMs > 0) next.set(key, remaining - deltaMs);
  }
  for (const event of events) {
    for (const key of attackerKeys(event, players)) next.set(key, ATTACK_MS);
  }
  return next;
}

/**
 * Sterbende Einheiten: Alter wächst mit `deltaMs`, fertige verschwinden; jedes `minion-death` legt eine Kopie an.
 * Form und Größe stammen aus `previous` (dem Zustand vor dem Tod), weil die Logik die Einheit schon gelöscht hat.
 */
export function updateGhosts(
  ghosts: readonly MinionGhost[],
  events: readonly FxEvent[],
  previous: readonly (Side | undefined)[],
  deltaMs: number,
): MinionGhost[] {
  const next = ghosts.map((ghost) => ({ ...ghost, ageMs: ghost.ageMs + deltaMs })).filter((ghost) => ghost.ageMs < DEATH_MS);
  for (const event of events) {
    if (event.kind !== 'minion-death') continue;
    const dead = previous[event.owner]?.minions.find((minion) => minion.id === event.minionId);
    if (!dead) continue;
    next.push({
      owner: event.owner,
      id: event.minionId,
      line: event.line,
      position: event.position,
      shape: minionShape(dead),
      radius: minionRadius(dead.maxHp ?? dead.hp),
      ageMs: 0,
    });
  }
  return next;
}

/**
 * Schreibt die Animationsdaten um `deltaMs` fort. `previous` ist der Zustand vor, `current` nach dem Schritt; `events`
 * kommen aus `diffFx(previous, current)`.
 */
export function advanceMinionAnim(
  anim: MinionAnim,
  events: readonly FxEvent[],
  previous: { players: readonly Side[] },
  current: { players: readonly Side[] },
  deltaMs: number,
): MinionAnim {
  return {
    timeMs: anim.timeMs + deltaMs,
    flashes: updateFlashes(anim.flashes, events, deltaMs),
    attacks: updateAttacks(anim.attacks, events, current.players, deltaMs),
    ghosts: updateGhosts(anim.ghosts, events, previous.players, deltaMs),
  };
}

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
