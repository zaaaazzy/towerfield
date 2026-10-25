import { describe, expect, it } from 'vitest';
import {
  isLane,
  isLaneUnlocked,
  LANE_COUNT,
  laneName,
  laneRow,
  laneShortName,
  laneTowerOffsets,
  laneUnlockLevel,
  MAX_FIELD_LEVEL,
  TOWER_SPACING,
  unlockedLanes,
} from './lanes';

describe('Lane-Layout', () => {
  it('hat fünf Lanes für drei Ausbaustufen', () => {
    expect(LANE_COUNT).toBe(5);
    expect(MAX_FIELD_LEVEL).toBe(3);
  });

  it('startet (Lvl 1) mit genau einer Lane, der Start-Lane', () => {
    expect(unlockedLanes(1)).toEqual([0]);
    expect(laneRow(0)).toBe(0);
    expect(laneUnlockLevel(0)).toBe(1);
  });

  it('gibt bei Lvl 2 je eine Lane oberhalb und unterhalb der Start-Lane frei', () => {
    const lanes = unlockedLanes(2);
    expect(lanes).toHaveLength(3);
    // Von oben nach unten: Lane oben, Start-Lane, Lane unten.
    expect(lanes.map(laneRow)).toEqual([-1, 0, 1]);
    expect(lanes).toEqual([1, 0, 2]);
  });

  it('gibt bei Lvl 3 je eine weitere Lane oberhalb und unterhalb frei, symmetrisch um die Start-Lane', () => {
    const lanes = unlockedLanes(3);
    expect(lanes).toHaveLength(5);
    expect(lanes.map(laneRow)).toEqual([-2, -1, 0, 1, 2]);
    expect(lanes).toEqual([3, 1, 0, 2, 4]);
    const rows = lanes.map(laneRow);
    expect(rows.map((row, index) => row + rows[rows.length - 1 - index]!)).toEqual([0, 0, 0, 0, 0]);
  });

  it('schaltet über Lvl 3 hinaus nichts weiter frei und unter Lvl 1 nichts', () => {
    expect(unlockedLanes(4)).toEqual(unlockedLanes(3));
    expect(unlockedLanes(0)).toEqual([]);
  });

  it('erkennt freie und gesperrte Lanes je Stufe', () => {
    expect([0, 1, 2, 3, 4].map((lane) => isLaneUnlocked(1, lane))).toEqual([true, false, false, false, false]);
    expect([0, 1, 2, 3, 4].map((lane) => isLaneUnlocked(2, lane))).toEqual([true, true, true, false, false]);
    expect([0, 1, 2, 3, 4].map((lane) => isLaneUnlocked(3, lane))).toEqual([true, true, true, true, true]);
    expect([1, 2].map(laneUnlockLevel)).toEqual([2, 2]);
    expect([3, 4].map(laneUnlockLevel)).toEqual([3, 3]);
  });

  it('kennt ungültige Lane-Indizes nie als frei', () => {
    for (const lane of [-1, 5, 0.5, Number.NaN, Infinity]) {
      expect(isLane(lane)).toBe(false);
      expect(isLaneUnlocked(3, lane)).toBe(false);
    }
    expect(isLane(0)).toBe(true);
    expect(isLane(4)).toBe(true);
  });

  it('wirft bei einer unbekannten Lane, wenn man nach Reihe, Stufe, Namen oder Towern fragt', () => {
    expect(() => laneRow(9)).toThrow('Unbekannte Lane');
    expect(() => laneUnlockLevel(-1)).toThrow('Unbekannte Lane');
    expect(() => laneName(5)).toThrow('Unbekannte Lane');
    expect(() => laneShortName(5)).toThrow('Unbekannte Lane');
    expect(() => laneTowerOffsets(5)).toThrow('Unbekannte Lane');
  });

  it('stellt drei Tower nebeneinander auf die Start-Lane und einen Tower auf jede weitere Lane', () => {
    expect(laneTowerOffsets(0)).toEqual([0, TOWER_SPACING, 2 * TOWER_SPACING]);
    for (const lane of [1, 2, 3, 4]) expect(laneTowerOffsets(lane)).toEqual([0]);
  });

  it('benennt die Lanes für Anzeige und Tabellen', () => {
    expect([0, 1, 2, 3, 4].map(laneName)).toEqual(['Start-Lane', 'Lvl 2 oben', 'Lvl 2 unten', 'Lvl 3 oben', 'Lvl 3 unten']);
    expect([0, 1, 2, 3, 4].map(laneShortName)).toEqual(['Start', 'O2', 'U2', 'O3', 'U3']);
  });
});
