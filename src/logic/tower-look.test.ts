import { describe, expect, it } from 'vitest';
import {
  DAMAGED_ABOVE,
  EMBER_PERIOD_MS,
  emberFlicker,
  INTACT_ABOVE,
  SMOKE_PERIOD_MS,
  smokePuff,
  smokePuffCount,
  TOWER_LOOKS,
  type TowerStage,
  towerDamageStage,
  towerLook,
  towerSeed,
} from './tower-look';

const ORDER: TowerStage[] = ['intact', 'damaged', 'burning', 'ruin'];

describe('towerDamageStage', () => {
  it('liefert die Stufen an typischen Werten', () => {
    expect(towerDamageStage(100, 100)).toBe('intact');
    expect(towerDamageStage(50, 100)).toBe('damaged');
    expect(towerDamageStage(20, 100)).toBe('burning');
    expect(towerDamageStage(0, 100)).toBe('ruin');
    expect(towerDamageStage(-5, 100)).toBe('ruin');
  });

  it('fängt Randfälle ab', () => {
    expect(towerDamageStage(10, 0)).toBe('ruin');
    expect(towerDamageStage(10, -4)).toBe('ruin');
    expect(towerDamageStage(Number.NaN, 100)).toBe('ruin');
    expect(towerDamageStage(10, Number.NaN)).toBe('ruin');
    expect(towerDamageStage(150, 100)).toBe('intact');
  });

  it('legt die Schwellen fest', () => {
    const max = 1000;
    expect(towerDamageStage(INTACT_ABOVE * max + 1, max)).toBe('intact');
    expect(towerDamageStage(INTACT_ABOVE * max, max)).toBe('damaged');
    expect(towerDamageStage(DAMAGED_ABOVE * max + 1, max)).toBe('damaged');
    expect(towerDamageStage(DAMAGED_ABOVE * max, max)).toBe('burning');
    expect(towerDamageStage(1, max)).toBe('burning');
    expect(towerDamageStage(0, max)).toBe('ruin');
  });

  it('fällt mit sinkenden HP nie zurück', () => {
    const max = 120;
    let last = 0;
    for (let hp = max; hp >= 0; hp -= 1) {
      const index = ORDER.indexOf(towerDamageStage(hp, max));
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
    expect(last).toBe(3);
  });
});

describe('Darstellungsdaten', () => {
  it('nehmen von intact bis burning nicht ab', () => {
    for (let i = 1; i < 3; i += 1) {
      const before = TOWER_LOOKS[ORDER[i - 1]!];
      const after = TOWER_LOOKS[ORDER[i]!];
      expect(after.cracks).toBeGreaterThanOrEqual(before.cracks);
      expect(after.missingMerlons).toBeGreaterThanOrEqual(before.missingMerlons);
      expect(after.smoke).toBeGreaterThanOrEqual(before.smoke);
      expect(after.ember).toBeGreaterThanOrEqual(before.ember);
    }
  });

  it('intakt ohne Rauch und Glut, Ruine mit schwachem Rauch und Glut', () => {
    expect(TOWER_LOOKS.intact.smoke).toBe(0);
    expect(TOWER_LOOKS.intact.ember).toBe(0);
    expect(TOWER_LOOKS.damaged.missingMerlons).toBeGreaterThanOrEqual(1);
    expect(TOWER_LOOKS.ruin.collapsed).toBe(true);
    expect(TOWER_LOOKS.ruin.smoke).toBeGreaterThan(0);
    expect(TOWER_LOOKS.ruin.smoke).toBeLessThan(TOWER_LOOKS.burning.smoke);
    expect(TOWER_LOOKS.ruin.ember).toBeLessThan(TOWER_LOOKS.burning.ember);
  });

  it('sind für gleiche Eingaben gleich', () => {
    expect(towerLook(40, 100)).toEqual(towerLook(40, 100));
    expect(towerLook(40, 100)).toBe(TOWER_LOOKS.damaged);
  });
});

describe('Bewegung', () => {
  it('zählt Rauchwolken nach Intensität', () => {
    expect(smokePuffCount(0)).toBe(0);
    expect(smokePuffCount(0.1)).toBe(1);
    expect(smokePuffCount(0.7)).toBe(2);
    expect(smokePuffCount(1)).toBe(3);
  });

  it('Rauch steigt mit der Zeit auf und wiederholt sich', () => {
    const a = smokePuff(0, 0, 0);
    const b = smokePuff(SMOKE_PERIOD_MS / 2, 0, 0);
    expect(b.rise).toBeGreaterThan(a.rise);
    expect(smokePuff(SMOKE_PERIOD_MS * 3, 0, 0).rise).toBeCloseTo(a.rise);
    expect(smokePuff(500, 1, 2)).toEqual(smokePuff(500, 1, 2));
    expect(smokePuff(500, 1, 2).rise).not.toBe(smokePuff(500, 0, 2).rise);
  });

  it('Glut flackert zwischen 0,4 und 1 und ist periodisch', () => {
    for (let t = 0; t < 2000; t += 37) {
      const value = emberFlicker(t, 1, 3);
      expect(value).toBeGreaterThanOrEqual(0.4);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(emberFlicker(EMBER_PERIOD_MS, 0, 0)).toBeCloseTo(emberFlicker(0, 0, 0));
  });

  it('Seed ist deterministisch und begrenzt', () => {
    expect(towerSeed(30, 232)).toBe(towerSeed(30, 232));
    expect(towerSeed(-300, -20)).toBeGreaterThanOrEqual(0);
    expect(towerSeed(330, 162)).toBeLessThan(17);
  });
});
