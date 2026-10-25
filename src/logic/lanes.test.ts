import { describe, expect, it } from 'vitest';
import {
  isLane,
  isLaneBuyable,
  LANE_COUNT,
  laneName,
  laneRow,
  laneShortName,
  laneTowerOffsets,
  laneUnlockLevel,
  MAX_FIELD_LEVEL,
  TOWER_SPACING,
} from './lanes';

describe('Lane-Layout', () => {
  it('hat fünf Lanes für drei Ausbaustufen', () => {
    expect(LANE_COUNT).toBe(5);
    expect(MAX_FIELD_LEVEL).toBe(3);
  });

  it('hat als Start-Lane die mittlere Lane der Stufe 1', () => {
    expect(laneRow(0)).toBe(0);
    expect(laneUnlockLevel(0)).toBe(1);
  });

  it('ordnet je Stufe eine Lane oberhalb und eine unterhalb der Start-Lane an, symmetrisch', () => {
    expect([1, 2].map(laneRow)).toEqual([-1, 1]);
    expect([3, 4].map(laneRow)).toEqual([-2, 2]);
  });

  it('erkennt je Stufe, welche Lanes sich kaufen lassen', () => {
    expect([0, 1, 2, 3, 4].map((lane) => isLaneBuyable(1, lane))).toEqual([true, false, false, false, false]);
    expect([0, 1, 2, 3, 4].map((lane) => isLaneBuyable(2, lane))).toEqual([true, true, true, false, false]);
    expect([0, 1, 2, 3, 4].map((lane) => isLaneBuyable(3, lane))).toEqual([true, true, true, true, true]);
    expect([0, 1, 2, 3, 4].map((lane) => isLaneBuyable(0, lane))).toEqual([false, false, false, false, false]);
    expect([1, 2].map(laneUnlockLevel)).toEqual([2, 2]);
    expect([3, 4].map(laneUnlockLevel)).toEqual([3, 3]);
  });

  it('kennt ungültige Lane-Indizes nie als kaufbar', () => {
    for (const lane of [-1, 5, 0.5, Number.NaN, Infinity]) {
      expect(isLane(lane)).toBe(false);
      expect(isLaneBuyable(3, lane)).toBe(false);
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
