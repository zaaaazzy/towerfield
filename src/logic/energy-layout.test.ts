import { describe, expect, it } from 'vitest';
import {
  ENERGY_BAR,
  ENERGY_CRYSTAL_CENTER,
  ENERGY_GLOW_RADIUS,
  ENERGY_INNER_SCALE,
  energyCrystalLayout,
} from './energy-layout';

describe('energyCrystalLayout', () => {
  it('liefert die bisherigen Eckpunkte der äußeren Raute', () => {
    const layout = energyCrystalLayout();
    expect(layout.outer).toEqual([
      { x: 22, y: 603 },
      { x: 28, y: 611 },
      { x: 22, y: 619 },
      { x: 16, y: 611 },
    ]);
    expect(layout.center).toEqual({ x: 22, y: 611 });
    expect(layout.glowRadius).toBe(ENERGY_GLOW_RADIUS);
  });

  it('skaliert die innere Raute um den Mittelpunkt', () => {
    const { outer, inner, center } = energyCrystalLayout();
    expect(inner).toHaveLength(4);
    inner.forEach((p, i) => {
      expect(p.x - center.x).toBeCloseTo((outer[i]!.x - center.x) * ENERGY_INNER_SCALE);
      expect(p.y - center.y).toBeCloseTo((outer[i]!.y - center.y) * ENERGY_INNER_SCALE);
    });
    expect(inner[0]).toEqual({ x: 22, y: 611 - 8 * 0.75 });
  });

  it('legt das Glanzdreieck an die obere Spitze', () => {
    const { shine } = energyCrystalLayout();
    expect(shine).toEqual([
      { x: 22, y: 603 },
      { x: 26, y: 610 },
      { x: 22, y: 611 },
    ]);
  });

  it('folgt einem verschobenen Mittelpunkt und verändert den Standard nicht', () => {
    const moved = energyCrystalLayout({ x: 100, y: 50 });
    expect(moved.outer[0]).toEqual({ x: 100, y: 42 });
    expect(moved.shine[2]).toEqual({ x: 100, y: 50 });
    expect(moved.center).not.toBe(ENERGY_CRYSTAL_CENTER);
    expect(energyCrystalLayout().center).toEqual(ENERGY_CRYSTAL_CENTER);
  });

  it('hält den Kristall innerhalb der Leiste', () => {
    for (const p of energyCrystalLayout().outer) {
      expect(p.x).toBeGreaterThan(ENERGY_BAR.x);
      expect(p.x).toBeLessThan(ENERGY_BAR.x + ENERGY_BAR.width);
      expect(p.y).toBeGreaterThan(ENERGY_BAR.y);
      expect(p.y).toBeLessThan(ENERGY_BAR.y + ENERGY_BAR.height);
    }
  });
});
