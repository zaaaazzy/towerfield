import { describe, expect, it } from 'vitest';
import { applyMinionBuff, BUFF_RATIO, buffGain } from './buff';
import type { Minion } from './combat';

const minion = (hp: number, damage: number, maxHp: number | undefined = hp): Minion => ({
  id: 1,
  line: 0,
  position: 0,
  hp,
  damage,
  range: 4,
  speed: 10,
  ...(maxHp === undefined ? {} : { maxHp }),
});

describe('Minion-Buff', () => {
  it('beträgt 50 %', () => {
    expect(BUFF_RATIO).toBe(0.5);
  });

  it('rundet kaufmännisch: gerade Werte genau, ungerade ab .5 auf', () => {
    expect(buffGain(30)).toBe(15);
    expect(buffGain(6)).toBe(3);
    expect(buffGain(5)).toBe(3);
    expect(buffGain(7)).toBe(4);
    expect(buffGain(1)).toBe(1);
    expect(buffGain(0)).toBe(0);
  });

  it('erhöht maxHp und hp um denselben Zuwachs und damage um 50 %', () => {
    const target = minion(30, 6);
    applyMinionBuff(target);
    expect(target).toMatchObject({ hp: 45, maxHp: 45, damage: 9 });
  });

  it('rechnet mit dem aktuellen maxHp, nicht mit hp: ein verletzter Minion behält den Abstand', () => {
    const target = minion(10, 7, 30);
    applyMinionBuff(target);
    expect(target).toMatchObject({ hp: 25, maxHp: 45, damage: 11 });
  });

  it('nimmt hp als maxHp, wenn der Minion kein maxHp hat', () => {
    const target = minion(20, 4, undefined);
    applyMinionBuff(target);
    expect(target).toMatchObject({ hp: 30, maxHp: 30, damage: 6 });
  });

  it('wirkt bei mehreren Buffs nacheinander auf die jeweils aktuellen Werte, immer gleich', () => {
    const run = () => {
      const target = minion(30, 6);
      for (let count = 0; count < 3; count += 1) applyMinionBuff(target);
      return target;
    };
    // 30 → 45 → 68 (67,5 aufgerundet) → 102; 6 → 9 → 14 (13,5) → 21
    expect(run()).toMatchObject({ hp: 102, maxHp: 102, damage: 21 });
    expect(run()).toEqual(run());
  });
});
