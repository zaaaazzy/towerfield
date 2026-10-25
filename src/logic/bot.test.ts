import { describe, expect, it } from 'vitest';
import { botPlan } from './bot';
import { getCardDef } from './cards';
import {
  BASE_ENERGY,
  createMatch,
  lineCapacity,
  LINE_COUNT,
  MAX_LINE_LEVEL,
  type MatchState,
  type PlayerIndex,
} from './match';

const cost = (id: string) => getCardDef(id).cost;

/** Zustand mit gesetzter Hand und Energie für Spieler 1; alles andere bleibt wie von `createMatch`. */
function withHand(hand: string[], energy: number, seed = 4): MatchState {
  const state = createMatch(seed);
  state.players[1].hand = [...hand];
  state.players[1].energy = energy;
  return state;
}

/** Legt `count` Minions auf eine Line des Spielers 1 (Ids ab 100, damit sie nicht mit gespielten kollidieren). */
function addMinions(state: MatchState, line: number, count: number): void {
  const player = state.players[1];
  for (let index = 0; index < count; index += 1) {
    player.minions.push({ id: 100 + player.minions.length, line, position: index, hp: 30, damage: 6, speed: 10 });
  }
}

const minionCount = (state: MatchState, line: number) => state.players[1].minions.filter((m) => m.line === line).length;

describe('Bot', () => {
  it('spielt Karten, verbraucht Energie und meldet sich bereit', () => {
    const before = createMatch(4);
    const after = botPlan(before, 1);
    expect(after.ready[1]).toBe(true);
    expect(after.players[1].hand.length).toBeLessThan(before.players[1].hand.length);
    expect(after.players[1].energy).toBeLessThan(before.players[1].energy);
    expect(after.players[0]).toEqual(before.players[0]);
  });

  it('entscheidet deterministisch', () => {
    expect(botPlan(createMatch(4), 1)).toEqual(botPlan(createMatch(4), 1));
  });

  it('verteilt Minions zuerst auf Lines ohne Minions', () => {
    const state: MatchState = createMatch(4);
    state.players[1].hand = ['summon-minion', 'summon-minion', 'summon-minion'];
    state.players[1].energy = 3;
    const after = botPlan(state, 1);
    expect(after.players[1].minions.map((m) => m.line).sort()).toEqual([0, 1, 2]);
  });

  it('gibt nicht mehr Energie aus, als vorhanden ist, und wirkt nicht auf den Gegner', () => {
    const state = createMatch(4);
    state.players[1].energy = 1;
    const after = botPlan(state, 1);
    expect(after.players[1].energy).toBeGreaterThanOrEqual(0);
    expect(after.players[0]).toEqual(state.players[0]);
  });

  it('spielt im Vergleich der Spielerseiten spiegelgleich', () => {
    const state = createMatch(8);
    const asSecond = botPlan(state, 1).players[1];
    const asFirst = botPlan(state, 0).players[0];
    expect(asFirst).toEqual(asSecond);
  });

  describe('Priorisierung', () => {
    const PRIORITY = [
      'summon-minion',
      'tower-hp',
      'line-upgrade',
      'minion-upgrade-line',
      'summon-brute',
      'tower-damage',
      'minion-upgrade-all',
    ];

    it('spielt summon-minion vor tower-hp, auch wenn tower-hp zuerst auf der Hand steht', () => {
      const state = withHand(['tower-hp', 'summon-minion'], cost('summon-minion'));
      const after = botPlan(state, 1);
      expect(after.players[1].minions).toHaveLength(1);
      expect(after.players[1].hand).toEqual(['tower-hp']);
    });

    it('bevorzugt bei knapper Energie jeweils die frühere Karte aus PRIORITY, unabhängig von der Handreihenfolge', () => {
      for (let index = 0; index < PRIORITY.length - 1; index += 1) {
        const first = PRIORITY[index]!;
        const second = PRIORITY[index + 1]!;
        const after = botPlan(withHand([second, first], cost(first)), 1);
        expect(after.players[1].hand, `${first} vor ${second}`).toEqual([second]);
        expect(after.players[1].energy).toBe(0);
      }
    });

    it('spielt bei genug Energie alle Karten, egal in welcher Reihenfolge sie auf der Hand liegen', () => {
      const total = PRIORITY.reduce((sum, id) => sum + cost(id), 0);
      const reversed = botPlan(withHand([...PRIORITY].reverse(), total), 1).players[1];
      const forward = botPlan(withHand(PRIORITY, total), 1).players[1];
      expect(reversed.hand).toEqual([]);
      expect(reversed.energy).toBe(0);
      expect(reversed).toEqual(forward);
    });
  });

  describe('Energie', () => {
    it('spielt bei 0 Energie nichts und meldet sich nur bereit', () => {
      const state = withHand(['summon-minion', 'tower-hp', 'line-upgrade'], 0);
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('lässt eine zu teure Karte günstigere nicht blockieren', () => {
      const state = withHand(['minion-upgrade-all', 'tower-hp'], 2);
      expect(cost('minion-upgrade-all')).toBeGreaterThan(2);
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['minion-upgrade-all']);
      expect(after.players[1].energy).toBe(2 - cost('tower-hp'));
    });

    it('senkt die Energie genau um die Kosten der gespielten Karten', () => {
      const hand = ['minion-upgrade-all', 'tower-damage', 'summon-minion', 'tower-hp'];
      const played = ['summon-minion', 'tower-hp', 'tower-damage'];
      const spent = played.reduce((sum, id) => sum + cost(id), 0);
      const energy = spent + 1;
      expect(cost('minion-upgrade-all')).toBeGreaterThan(1);
      const after = botPlan(withHand(hand, energy), 1);
      expect(after.players[1].hand).toEqual(['minion-upgrade-all']);
      expect(after.players[1].energy).toBe(energy - spent);
    });

    it('nutzt die Start-Energie der ersten Runde ohne Überschreitung', () => {
      const state = withHand(['summon-brute', 'summon-brute', 'summon-minion'], BASE_ENERGY);
      const after = botPlan(state, 1);
      expect(after.players[1].energy).toBeGreaterThanOrEqual(0);
      expect(after.players[1].energy).toBe(BASE_ENERGY - cost('summon-minion') - cost('summon-brute'));
      expect(after.players[1].hand).toEqual(['summon-brute']);
    });
  });

  describe('Kartenkombinationen', () => {
    it('spielt nichts, wenn nur zu teure Karten auf der Hand sind', () => {
      const hand = ['minion-upgrade-all', 'line-upgrade', 'summon-brute'];
      const state = withHand(hand, 1);
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('spielt minion-upgrade-all ohne Linienziel auf alle Lines', () => {
      const after = botPlan(withHand(['minion-upgrade-all'], cost('minion-upgrade-all')), 1);
      const lines = after.players[1].lines;
      expect(after.players[1].hand).toEqual([]);
      expect(after.players[1].energy).toBe(0);
      expect(lines).toHaveLength(LINE_COUNT);
      for (const line of lines) expect(line.bonus.hp).toBeGreaterThan(0);
      expect(new Set(lines.map((line) => line.bonus.hp)).size).toBe(1);
    });

    it('spielt mehrere gleiche Karten und wählt die Line nach jeder Karte neu', () => {
      const state = withHand(['tower-hp', 'tower-hp', 'tower-hp'], 3 * cost('tower-hp'));
      state.players[1].lines[0]!.tower.hp = 100;
      state.players[1].lines[1]!.tower.hp = 60;
      state.players[1].lines[2]!.tower.hp = 80;
      const gain = (getCardDef('tower-hp') as { hp: number }).hp;
      const after = botPlan(state, 1);
      // Reihenfolge der Wahl: Line 1 (60), dann Line 2 (80), dann wieder die dann schwächste.
      const hp = after.players[1].lines.map((line) => line.tower.hp);
      expect(hp.reduce((a, b) => a + b, 0)).toBe(100 + 60 + 80 + 3 * gain);
      expect(hp[1]).toBeGreaterThan(60);
      expect(hp[2]).toBeGreaterThan(80);
      expect(after.players[1].hand).toEqual([]);
    });

    it('spielt bei leerer Hand nichts, terminiert und setzt ready', () => {
      const state = withHand([], 5);
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('begrenzt eine gemischte Hand durch die Energie', () => {
      const hand = ['summon-brute', 'minion-upgrade-all', 'line-upgrade', 'summon-minion', 'tower-damage'];
      const energy = cost('summon-minion') + cost('line-upgrade');
      const after = botPlan(withHand(hand, energy), 1);
      expect(after.players[1].energy).toBe(0);
      expect(after.players[1].hand).toEqual(['summon-brute', 'minion-upgrade-all', 'tower-damage']);
      expect(after.players[1].minions).toHaveLength(1);
      expect(after.players[1].lines.reduce((sum, line) => sum + line.level, 0)).toBe(LINE_COUNT + 1);
    });
  });

  describe('Linienwahl', () => {
    it('summon: wählt die Line mit den wenigsten Minions', () => {
      const state = withHand(['summon-minion'], 1);
      addMinions(state, 0, 2);
      addMinions(state, 1, 1);
      addMinions(state, 2, 1);
      const after = botPlan(state, 1);
      expect([0, 1, 2].map((line) => minionCount(after, line))).toEqual([2, 2, 1]);
    });

    it('summon: wählt bei gleich vielen Minions die niedrigste Line', () => {
      const after = botPlan(withHand(['summon-minion'], 1), 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0]);
    });

    it('summon: weicht auf eine freie Line aus, wenn andere Lines voll sind', () => {
      const state = withHand(['summon-minion'], 1);
      const capacity = lineCapacity(state.players[1].lines[0]!.level);
      addMinions(state, 0, capacity);
      addMinions(state, 1, capacity);
      const after = botPlan(state, 1);
      expect(minionCount(after, 2)).toBe(1);
      expect(minionCount(after, 0)).toBe(capacity);
      expect(minionCount(after, 1)).toBe(capacity);
    });

    it('summon: überspringt eine volle Line und nimmt bei Gleichstand die niedrigste freie', () => {
      const state = withHand(['summon-minion'], 1);
      const capacity = lineCapacity(state.players[1].lines[0]!.level);
      addMinions(state, 0, capacity);
      addMinions(state, 1, 2);
      addMinions(state, 2, 2);
      const after = botPlan(state, 1);
      expect(minionCount(after, 0)).toBe(capacity);
      expect(minionCount(after, 1)).toBe(3);
      expect(minionCount(after, 2)).toBe(2);
    });

    it('summon: lässt die Karte auf der Hand, wenn alle Lines voll sind', () => {
      const state = withHand(['summon-minion'], 3);
      for (let line = 0; line < LINE_COUNT; line += 1) {
        addMinions(state, line, lineCapacity(state.players[1].lines[line]!.level));
      }
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['summon-minion']);
      expect(after.players[1].energy).toBe(3);
      expect(after.players[1].minions).toEqual(state.players[1].minions);
      expect(after.ready[1]).toBe(true);
    });

    it('line-upgrade: wählt die Line mit dem niedrigsten Level', () => {
      const state = withHand(['line-upgrade'], cost('line-upgrade'));
      [3, 2, 4].forEach((level, line) => (state.players[1].lines[line]!.level = level));
      const after = botPlan(state, 1);
      expect(after.players[1].lines.map((line) => line.level)).toEqual([3, 3, 4]);
    });

    it('line-upgrade: lässt Lines auf MAX_LINE_LEVEL aus', () => {
      const state = withHand(['line-upgrade'], cost('line-upgrade'));
      [MAX_LINE_LEVEL, MAX_LINE_LEVEL, MAX_LINE_LEVEL - 1].forEach(
        (level, line) => (state.players[1].lines[line]!.level = level),
      );
      const after = botPlan(state, 1);
      expect(after.players[1].lines.map((line) => line.level)).toEqual([MAX_LINE_LEVEL, MAX_LINE_LEVEL, MAX_LINE_LEVEL]);
      expect(after.players[1].hand).toEqual([]);
    });

    it('line-upgrade: bleibt auf der Hand, wenn alle Lines auf MAX_LINE_LEVEL stehen', () => {
      const state = withHand(['line-upgrade'], cost('line-upgrade'));
      for (const line of state.players[1].lines) line.level = MAX_LINE_LEVEL;
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('tower-hp: wählt die Line mit dem niedrigsten Tower-HP', () => {
      const state = withHand(['tower-hp'], cost('tower-hp'));
      [100, 55, 80].forEach((hp, line) => (state.players[1].lines[line]!.tower.hp = hp));
      const after = botPlan(state, 1);
      const gain = (getCardDef('tower-hp') as { hp: number }).hp;
      expect(after.players[1].lines.map((line) => line.tower.hp)).toEqual([100, 55 + gain, 80]);
    });

    it('minion-upgrade-line: wählt die Line mit dem höchsten bonus.hp', () => {
      const state = withHand(['minion-upgrade-line'], cost('minion-upgrade-line'));
      [0, 10, 5].forEach((hp, line) => (state.players[1].lines[line]!.bonus.hp = hp));
      const gain = (getCardDef('minion-upgrade-line') as { hp: number }).hp;
      const after = botPlan(state, 1);
      expect(after.players[1].lines.map((line) => line.bonus.hp)).toEqual([0, 10 + gain, 5]);
    });
  });

  describe('Determinismus und Isolation', () => {
    const seeds = [1, 4, 8, 42, 1234];
    const sides: PlayerIndex[] = [0, 1];

    it('liefert für mehrere Seeds und beide Seiten bei gleichem Zustand gleiche Ergebnisse', () => {
      for (const seed of seeds) {
        for (const side of sides) {
          expect(botPlan(createMatch(seed), side)).toEqual(botPlan(createMatch(seed), side));
          const state = createMatch(seed);
          expect(botPlan(state, side)).toEqual(botPlan(state, side));
        }
      }
    });

    it('verändert den übergebenen Eingabezustand nicht', () => {
      for (const seed of seeds) {
        for (const side of sides) {
          const state = createMatch(seed);
          const copy = structuredClone(state);
          const after = botPlan(state, side);
          expect(state).toEqual(copy);
          expect(after).not.toBe(state);
        }
      }
    });

    it('lässt den Gegner unverändert und setzt nur das eigene ready', () => {
      for (const seed of seeds) {
        for (const side of sides) {
          const other: PlayerIndex = side === 0 ? 1 : 0;
          const state = createMatch(seed);
          const after = botPlan(state, side);
          expect(after.players[other]).toEqual(state.players[other]);
          expect(after.ready[side]).toBe(true);
          expect(after.ready[other]).toBe(state.ready[other]);
        }
      }
    });
  });

  describe('Abbruch', () => {
    it('terminiert und setzt ready, auch wenn playCard jede Karte ablehnt (already-ready)', () => {
      const state = withHand(['summon-minion', 'tower-hp', 'minion-upgrade-all'], 5);
      state.ready[1] = true;
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('terminiert, wenn playCard wegen der Phase ablehnt (not-planning)', () => {
      const state = withHand(['summon-minion', 'tower-hp'], 5);
      state.phase = 'combat';
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['summon-minion', 'tower-hp']);
      expect(after.players[1].energy).toBe(5);
    });

    it('terminiert, wenn nach einigen Karten keine mehr spielbar ist', () => {
      const after = botPlan(withHand(['summon-minion', 'summon-minion', 'minion-upgrade-all'], 2), 1);
      expect(after.players[1].hand).toEqual(['minion-upgrade-all']);
      expect(after.players[1].energy).toBe(0);
      expect(after.ready[1]).toBe(true);
    });
  });
});
