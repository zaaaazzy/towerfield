import { describe, expect, it } from 'vitest';
import type { FxEvent } from './fx-events';
import {
  BOB_AMPLITUDE,
  BOB_PERIOD_MS,
  FLASH_MS,
  MAX_RADIUS,
  MIN_RADIUS,
  bobOffset,
  facing,
  flashKey,
  flashStrength,
  laneStagger,
  minionRadius,
  minionShape,
  STAGGER_STEP,
  updateFlashes,
} from './minion-look';

describe('minionShape', () => {
  it('ordnet Rollen Formen zu', () => {
    expect(minionShape({ range: 4 })).toBe('melee');
    expect(minionShape({ range: 14 })).toBe('ranged');
    expect(minionShape({ range: 10, heals: true })).toBe('healer');
    expect(minionShape({ range: 4, explodes: { radius: 10, damage: 15 } })).toBe('destroyer');
  });

  it('erkennt den Zerstörer unabhängig von seiner Reichweite und lässt den Heiler Vorrang', () => {
    const explodes = { radius: 10, damage: 15 };
    expect(minionShape({ range: 14, explodes })).toBe('destroyer');
    expect(minionShape({ range: 10, heals: true, explodes })).toBe('healer');
  });
});

describe('minionRadius', () => {
  it('wächst mit Max-HP und ist begrenzt', () => {
    expect(minionRadius(0)).toBe(MIN_RADIUS);
    expect(minionRadius(20)).toBe(MIN_RADIUS);
    expect(minionRadius(30)).toBeLessThan(minionRadius(80));
    expect(minionRadius(80)).toBe(MAX_RADIUS);
    expect(minionRadius(500)).toBe(MAX_RADIUS);
  });
  it('macht große Einheiten sichtbar größer', () => {
    expect(minionRadius(80) - minionRadius(30)).toBeGreaterThanOrEqual(3);
  });
});

describe('facing', () => {
  it('Spieler schaut nach rechts, Bot nach links (die Lane läuft waagrecht)', () => {
    expect(facing(0)).toBe(1);
    expect(facing(1)).toBe(-1);
  });
});

describe('laneStagger', () => {
  it('verteilt Minions nach ID auf drei Bahnen quer zur Lane', () => {
    expect([3, 1, 2].map(laneStagger)).toEqual([-STAGGER_STEP, 0, STAGGER_STEP].map((v) => v));
    expect(laneStagger(3)).toBe(laneStagger(0));
  });

  it('ist stabil: dieselbe ID ergibt immer denselben Versatz, benachbarte IDs verschiedene', () => {
    expect(laneStagger(7)).toBe(laneStagger(7));
    expect(new Set([1, 2, 3].map(laneStagger)).size).toBe(3);
    for (const id of [1, 2, 3, 50]) expect(Math.abs(laneStagger(id))).toBeLessThanOrEqual(STAGGER_STEP);
  });
});

describe('bobOffset', () => {
  it('steht still ohne Bewegung', () => {
    expect(bobOffset(123, 1, false)).toBe(0);
  });
  it('bleibt im Ausschlag und wiederholt sich nach einer Periode', () => {
    for (let t = 0; t < 1000; t += 37) expect(Math.abs(bobOffset(t, 3, true))).toBeLessThanOrEqual(BOB_AMPLITUDE);
    expect(bobOffset(50 + BOB_PERIOD_MS, 3, true)).toBeCloseTo(bobOffset(50, 3, true), 9);
  });
  it('hängt nur von der Zeit ab, nicht von der Zahl der Schritte', () => {
    expect(bobOffset(1000, 2, true)).toBe(bobOffset(1000, 2, true));
  });
  it('versetzt die Phase je Minion', () => {
    expect(bobOffset(0, 1, true)).not.toBe(bobOffset(0, 2, true));
  });
});

describe('flashStrength', () => {
  it('läuft von 1 auf 0', () => {
    expect(flashStrength(FLASH_MS)).toBe(1);
    expect(flashStrength(FLASH_MS / 2)).toBeCloseTo(0.5);
    expect(flashStrength(0)).toBe(0);
    expect(flashStrength(-5)).toBe(0);
    expect(flashStrength(FLASH_MS * 3)).toBe(1);
  });
});

describe('updateFlashes', () => {
  const damage = (owner: number, minionId: number): FxEvent => ({
    kind: 'minion-damage',
    owner,
    minionId,
    line: 0,
    position: 10,
    amount: 3,
    source: 'melee',
  });

  it('startet einen Blitz bei Schaden', () => {
    const next = updateFlashes(new Map(), [damage(0, 5)], 16);
    expect(next.get(flashKey(0, 5))).toBe(FLASH_MS);
  });
  it('ignoriert andere Ereignisse', () => {
    const events: FxEvent[] = [{ kind: 'tower-damage', owner: 0, line: 0, tower: 0, amount: 2 }];
    expect(updateFlashes(new Map(), events, 16).size).toBe(0);
  });
  it('lässt Blitze mit der Zeit ablaufen und entfernt sie', () => {
    const start = new Map([[flashKey(1, 2), 100]]);
    expect(updateFlashes(start, [], 40).get(flashKey(1, 2))).toBe(60);
    expect(updateFlashes(start, [], 100).has(flashKey(1, 2))).toBe(false);
  });
  it('verändert die Eingabe nicht und startet bei erneutem Schaden neu', () => {
    const start = new Map([[flashKey(0, 5), 20]]);
    const next = updateFlashes(start, [damage(0, 5)], 10);
    expect(start.get(flashKey(0, 5))).toBe(20);
    expect(next.get(flashKey(0, 5))).toBe(FLASH_MS);
  });
});
