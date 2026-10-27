/**
 * Lane-Layout des horizontalen Spielfelds: Start-Lane in der Mitte, pro Ausbaustufe je eine Lane oberhalb und
 * unterhalb. Ohne Phaser, DOM und Canvas. Eine „Line“ im Rest der Logik ist eine Lane (Index in `PlayerState.lines`).
 *
 * Lane-Index → Anordnung (Reihe 0 = Start-Lane, negativ = oberhalb, positiv = unterhalb):
 *   0 Start (Reihe 0) · 1 Lvl 2 oben (−1) · 2 Lvl 2 unten (+1) · 3 Lvl 3 oben (−2) · 4 Lvl 3 unten (+2)
 */

/** Höchste Ausbaustufe des Feldes (Lvl 3 = Start-Lane plus zwei Lanes pro Seite). */
export const MAX_FIELD_LEVEL = 3;

interface LaneDef {
  /** Reihe im Feld von oben nach unten: 0 Start, negativ oberhalb, positiv unterhalb. */
  row: number;
  /** Ab dieser Ausbaustufe ist die Lane frei. */
  level: number;
  /** Positionen der Tower auf der Lane, vom eigenen Ende aus. */
  towerOffsets: readonly number[];
}

/** Abstand der drei Tower der Start-Lane (Line-Einheiten), sie stehen nebeneinander am eigenen Ende. */
export const TOWER_SPACING = 8;

const LANES: readonly LaneDef[] = [
  { row: 0, level: 1, towerOffsets: [0, TOWER_SPACING, 2 * TOWER_SPACING] },
  { row: -1, level: 2, towerOffsets: [0] },
  { row: 1, level: 2, towerOffsets: [0] },
  { row: -2, level: 3, towerOffsets: [0] },
  { row: 2, level: 3, towerOffsets: [0] },
];

export const LANE_COUNT = LANES.length;

function laneDef(lane: number): LaneDef {
  const def = LANES[lane];
  if (!def) throw new Error(`Unbekannte Lane: ${lane}`);
  return def;
}

export function isLane(lane: number): boolean {
  return Number.isInteger(lane) && lane >= 0 && lane < LANE_COUNT;
}

/** Reihe der Lane im Feld (0 Start, negativ oberhalb, positiv unterhalb). */
export function laneRow(lane: number): number {
  return laneDef(lane).row;
}

/** Ausbaustufe, ab der sich die Lane kaufen lässt (gekauft wird sie in `match.ts`, siehe `buyLane`). */
export function laneUnlockLevel(lane: number): number {
  return laneDef(lane).level;
}

/** Lässt sich die Lane bei Ausbaustufe `level` kaufen? Ungültige Lane-Indizes nie. */
export function isLaneBuyable(level: number, lane: number): boolean {
  return isLane(lane) && laneDef(lane).level <= level;
}

/** Anzeigename der Lane, z. B. „Start-Lane“ oder „Lvl 2 oben“. */
export function laneName(lane: number): string {
  const { row, level } = laneDef(lane);
  return row === 0 ? 'Start-Lane' : `Lvl ${level} ${row < 0 ? 'oben' : 'unten'}`;
}

/** Kurzname für enge Tabellen: „Start“, „O2“ (Lvl 2 oben), „U3“ (Lvl 3 unten). */
export function laneShortName(lane: number): string {
  const { row, level } = laneDef(lane);
  return row === 0 ? 'Start' : `${row < 0 ? 'O' : 'U'}${level}`;
}

/** Positionen der Tower der Lane, vom eigenen Ende aus (aufsteigend). */
export function laneTowerOffsets(lane: number): readonly number[] {
  return laneDef(lane).towerOffsets;
}
