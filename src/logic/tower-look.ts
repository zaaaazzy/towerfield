/**
 * Reine Entscheidungen für das Aussehen der Tower nach Zustand: Schadensstufe aus dem HP-Anteil, Darstellungsdaten je
 * Stufe (Risse, Zinnen, Rauch, Glut) und zeitabhängige Bewegung von Rauch und Glut. Ohne Phaser; die Szene
 * (`field-view.ts`) zeichnet nur. Zeit kommt immer aus `delta`, Zufall nie aus `Math.random()`.
 */

export type TowerStage = 'intact' | 'damaged' | 'burning' | 'ruin';

/** Anteil `hp / maxHp`, ab dem eine Stufe gilt (streng darüber): über 66 % intakt, über 33 % angeschlagen, sonst brennend. */
export const INTACT_ABOVE = 0.66;
export const DAMAGED_ABOVE = 0.33;

/** Schadensstufe. `maxHp <= 0`, `NaN` und `hp <= 0` ergeben die Ruine, HP über `maxHp` gelten als intakt. */
export function towerDamageStage(hp: number, maxHp: number): TowerStage {
  if (Number.isNaN(hp) || Number.isNaN(maxHp) || maxHp <= 0 || hp <= 0) return 'ruin';
  const ratio = hp / maxHp;
  if (ratio > INTACT_ABOVE) return 'intact';
  if (ratio > DAMAGED_ABOVE) return 'damaged';
  return 'burning';
}

/** Darstellungsdaten einer Stufe. Rauch und Glut von 0 (keine) bis 1 (stark). */
export interface TowerLook {
  /** Anzahl der Risse im Mauerwerk. */
  cracks: number;
  /** Anzahl der abgebrochenen Zinnen (von 3). */
  missingMerlons: number;
  smoke: number;
  ember: number;
  /** Mauer ist zu niedrigen Resten zerbrochen. */
  collapsed: boolean;
}

export const TOWER_LOOKS: Readonly<Record<TowerStage, TowerLook>> = {
  intact: { cracks: 0, missingMerlons: 0, smoke: 0, ember: 0, collapsed: false },
  damaged: { cracks: 2, missingMerlons: 1, smoke: 0, ember: 0, collapsed: false },
  burning: { cracks: 4, missingMerlons: 2, smoke: 0.7, ember: 0.8, collapsed: false },
  ruin: { cracks: 3, missingMerlons: 3, smoke: 0.3, ember: 0.3, collapsed: true },
};

export const towerLook = (hp: number, maxHp: number): TowerLook => TOWER_LOOKS[towerDamageStage(hp, maxHp)];

/** Dauer, in der eine Rauchwolke von der Bruchstelle aufsteigt, in ms; Höhe des Aufstiegs in Pixeln (bleibt kompakt). */
export const SMOKE_PERIOD_MS = 1800;
export const SMOKE_RISE = 14;
/** Dauer eines Glut-Flackerns in ms. */
export const EMBER_PERIOD_MS = 420;

/** Anzahl der Rauchwolken je Rauchintensität (0 = keine). */
export function smokePuffCount(smoke: number): number {
  return smoke <= 0 ? 0 : Math.max(1, Math.round(smoke * 3));
}

export interface SmokePuff {
  /** Aufstieg 0 (unten) bis 1 (oben, ausgeblendet). */
  rise: number;
  /** Seitlicher Versatz in Pixeln. */
  drift: number;
}

/** Rauchwolke `index` zur Szenenzeit; `seed` (z. B. aus der Position) versetzt die Phase je Tower. */
export function smokePuff(timeMs: number, index: number, seed: number): SmokePuff {
  const t = timeMs / SMOKE_PERIOD_MS + index * 0.37 + seed * 0.61;
  const rise = t - Math.floor(t);
  return { rise, drift: Math.sin((t + index) * Math.PI * 2) * 2 * rise };
}

/** Flackern der Glut (0,4 bis 1) zur Szenenzeit, je Glutpunkt `index` und Tower `seed` phasenversetzt. */
export function emberFlicker(timeMs: number, index: number, seed: number): number {
  const phase = (timeMs / EMBER_PERIOD_MS + index * 0.29 + seed * 0.53) * Math.PI * 2;
  return 0.7 + 0.3 * Math.sin(phase);
}

/** Ganzzahliger Seed für die Phase eines Towers aus seiner Position (deterministisch). */
export function towerSeed(x: number, y: number): number {
  return Math.abs(Math.round(x) * 7 + Math.round(y) * 3) % 17;
}
