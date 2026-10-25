import { describe, expect, it } from 'vitest';
import { botPlan, botStep } from './bot';
import { getCardDef } from './cards';
import { isLaneUnlocked, MAX_FIELD_LEVEL, unlockedLanes } from './lanes';
import {
  BASE_ENERGY,
  createLaneTowers,
  createMatch,
  lineCapacity,
  LINE_COUNT,
  type MatchState,
  type PlayerIndex,
} from './match';

const cost = (id: string) => getCardDef(id).cost;

/** Baut das Feld von Spieler 1 auf `level` aus (mit den Towern der frisch freien Lanes). */
function grow(state: MatchState, level: number): MatchState {
  const player = state.players[1];
  player.level = level;
  player.lines.forEach((lane, index) => {
    if (isLaneUnlocked(level, index) && lane.towers.length === 0) lane.towers = createLaneTowers(index);
  });
  return state;
}

/** Setzt die Lebenspunkte einer Lane von Spieler 1: der erste Tower bekommt `hp`, weitere Tower sind zerstört. */
function setLaneHp(state: MatchState, lane: number, hp: number): void {
  state.players[1].lines[lane]!.towers.forEach((tower, index) => (tower.hp = index === 0 ? hp : 0));
}

const laneHp = (state: MatchState, lane: number) =>
  state.players[1].lines[lane]!.towers.reduce((sum, tower) => sum + tower.hp, 0);

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
    player.minions.push({ id: 100 + player.minions.length, line, position: index, hp: 30, damage: 6, range: 4, speed: 10 });
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

  it('verteilt Minions zuerst auf Lanes ohne Minions', () => {
    const state: MatchState = grow(createMatch(4), 2);
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

  describe('botStep', () => {
    it('spielt genau eine Karte und lässt den Eingabezustand unverändert', () => {
      const before = withHand(['summon-minion', 'summon-minion'], 5);
      const snapshot = structuredClone(before);
      const move = botStep(before, 1);
      expect(move).not.toBeNull();
      expect(move!.cardId).toBe('summon-minion');
      expect(move!.state.players[1].hand).toEqual(['summon-minion']);
      expect(move!.state.players[1].energy).toBe(5 - cost('summon-minion'));
      expect(before).toEqual(snapshot);
    });

    it('liefert die Zielline für Karten mit Ziel und undefined ohne Ziel', () => {
      const move = botStep(withHand(['summon-minion'], 5), 1);
      expect(move!.line).toBeGreaterThanOrEqual(0);
      expect(move!.line).toBeLessThan(LINE_COUNT);
    });

    it('gibt null zurück, wenn keine Karte spielbar ist', () => {
      expect(botStep(withHand(['summon-minion'], 0), 1)).toBeNull();
      expect(botStep(withHand([], 5), 1)).toBeNull();
      expect(botStep(withHand(['summon-minion'], 5), 1, [])).toBeNull();
    });

    it('wiederholt angewendet ergibt dasselbe wie botPlan ohne Bereit-Meldung', () => {
      const start = createMatch(4);
      let current = start;
      for (let move = botStep(current, 1); move; move = botStep(current, 1)) current = move.state;
      expect({ ...botPlan(start, 1), ready: current.ready }).toEqual(current);
    });
  });

  describe('Priorisierung', () => {
    const PRIORITY = [
      'summon-minion',
      'summon-archer',
      'summon-healer',
      'tower-hp',
      'line-upgrade',
      'minion-upgrade-line',
      'summon-brute',
      'tower-damage',
      'minion-upgrade-all',
    ];

    it('beschwört einen Heiler mit Reichweite 10 und Heiler-Merkmal, andere Minions ohne', () => {
      const after = botPlan(withHand(['summon-healer', 'summon-minion'], cost('summon-healer') + cost('summon-minion')), 1);
      const minions = after.players[1].minions;
      expect(minions).toHaveLength(2);
      expect(minions.filter((m) => m.heals)).toHaveLength(1);
      expect(minions.find((m) => m.heals)).toMatchObject({ range: 10, maxHp: 20 });
      expect(minions.find((m) => !m.heals)!.heals).toBeUndefined();
    });

    it('beschwört einen Zerstörer mit Explosionswerten, andere Minions ohne', () => {
      const after = botPlan(
        withHand(['summon-destroyer', 'summon-minion'], cost('summon-destroyer') + cost('summon-minion')),
        1,
      );
      const minions = after.players[1].minions;
      expect(minions).toHaveLength(2);
      expect(minions.find((m) => m.explodes)).toMatchObject({ explodes: { radius: 10, damage: 15 }, maxHp: 40 });
      expect(minions.filter((m) => m.explodes)).toHaveLength(1);
      expect(minions.some((m) => m.heals)).toBe(false);
    });

    it('beschwört einen Bogenschützen mit Reichweite 14', () => {
      const after = botPlan(withHand(['summon-archer'], cost('summon-archer')), 1);
      expect(after.players[1].minions).toHaveLength(1);
      expect(after.players[1].minions[0]).toMatchObject({ range: 14, speed: 10 });
    });

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

  describe('Eigene Kartenreihenfolge', () => {
    it('ändert die Auswahl bei knapper Energie nachweisbar', () => {
      const hand = ['summon-minion', 'tower-hp'];
      const byDefault = botPlan(withHand(hand, 1), 1);
      const reordered = botPlan(withHand(hand, 1), 1, ['tower-hp', 'summon-minion']);
      expect(byDefault.players[1].hand).toEqual(['tower-hp']);
      expect(reordered.players[1].hand).toEqual(['summon-minion']);
    });

    it('verhält sich mit der Standardreihenfolge wie ohne Parameter', () => {
      const state = createMatch(4);
      expect(botPlan(state, 1, ['summon-minion', 'summon-archer', 'tower-hp', 'line-upgrade', 'minion-upgrade-line', 'summon-brute', 'tower-damage', 'minion-upgrade-all'])).toEqual(botPlan(state, 1));
    });

    it('spielt Karten nicht, die in der Reihenfolge fehlen', () => {
      const after = botPlan(withHand(['summon-minion', 'tower-hp'], 5), 1, ['tower-hp']);
      expect(after.players[1].hand).toEqual(['summon-minion']);
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

    it('spielt mehrere gleiche Karten und wählt die Lane nach jeder Karte neu', () => {
      const state = grow(withHand(['tower-hp', 'tower-hp', 'tower-hp'], 3 * cost('tower-hp')), 2);
      setLaneHp(state, 0, 100);
      setLaneHp(state, 1, 60);
      setLaneHp(state, 2, 80);
      const gain = (getCardDef('tower-hp') as { hp: number }).hp;
      const after = botPlan(state, 1);
      // Reihenfolge der Wahl: Lane 1 (60), dann Lane 2 (80), dann wieder die dann schwächste.
      const hp = [0, 1, 2].map((lane) => laneHp(after, lane));
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
      expect(after.players[1].level).toBe(2);
    });
  });

  describe('Lane-Wahl', () => {
    it('summon: wählt die Lane mit den wenigsten Minions', () => {
      const state = grow(withHand(['summon-minion'], 1), 2);
      addMinions(state, 0, 2);
      addMinions(state, 1, 1);
      addMinions(state, 2, 1);
      const after = botPlan(state, 1);
      expect([0, 1, 2].map((line) => minionCount(after, line))).toEqual([2, 2, 1]);
    });

    it('summon: wählt bei gleich vielen Minions die niedrigste Lane', () => {
      const after = botPlan(grow(withHand(['summon-minion'], 1), 3), 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0]);
    });

    it('summon: nutzt nur freie Lanes, auf Lvl 1 also nur die Start-Lane', () => {
      const state = withHand(['summon-minion', 'summon-minion', 'summon-minion'], 3);
      const after = botPlan(state, 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0, 0, 0]);
      for (const lane of [1, 2, 3, 4]) expect(minionCount(after, lane)).toBe(0);
    });

    it('summon: weicht auf eine freie Lane aus, wenn andere Lanes voll sind', () => {
      const state = grow(withHand(['summon-minion'], 1), 2);
      const capacity = lineCapacity(state.players[1].level);
      addMinions(state, 0, capacity);
      addMinions(state, 1, capacity);
      const after = botPlan(state, 1);
      expect(minionCount(after, 2)).toBe(1);
      expect(minionCount(after, 0)).toBe(capacity);
      expect(minionCount(after, 1)).toBe(capacity);
    });

    it('summon: überspringt eine volle Lane und nimmt bei Gleichstand die niedrigste freie', () => {
      const state = grow(withHand(['summon-minion'], 1), 2);
      const capacity = lineCapacity(state.players[1].level);
      addMinions(state, 0, capacity);
      addMinions(state, 1, 2);
      addMinions(state, 2, 2);
      const after = botPlan(state, 1);
      expect(minionCount(after, 0)).toBe(capacity);
      expect(minionCount(after, 1)).toBe(3);
      expect(minionCount(after, 2)).toBe(2);
    });

    it('summon: lässt die Karte auf der Hand, wenn alle freien Lanes voll sind', () => {
      const state = grow(withHand(['summon-minion'], 3), 2);
      for (const line of unlockedLanes(2)) addMinions(state, line, lineCapacity(state.players[1].level));
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['summon-minion']);
      expect(after.players[1].energy).toBe(3);
      expect(after.players[1].minions).toEqual(state.players[1].minions);
      expect(after.ready[1]).toBe(true);
    });

    it('line-upgrade: spielt die Karte ohne Zielline und schaltet die nächsten Lanes frei', () => {
      const move = botStep(withHand(['line-upgrade'], cost('line-upgrade')), 1);
      expect(move!.cardId).toBe('line-upgrade');
      expect(move!.line).toBeUndefined();
      expect(move!.state.players[1].level).toBe(2);
      expect(move!.state.players[1].lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 0, 0]);
    });

    it('line-upgrade: baut Lvl 1 → 2 → 3 aus und lässt danach die Karte auf der Hand', () => {
      const state = withHand(['line-upgrade', 'line-upgrade', 'line-upgrade'], 3 * cost('line-upgrade'));
      const after = botPlan(state, 1);
      expect(after.players[1].level).toBe(MAX_FIELD_LEVEL);
      expect(after.players[1].lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 1, 1]);
      expect(after.players[1].hand).toEqual(['line-upgrade']);
      expect(after.players[1].energy).toBe(cost('line-upgrade'));
      expect(after.ready[1]).toBe(true);
    });

    it('line-upgrade: bleibt auf der Hand, wenn das Feld schon auf MAX_FIELD_LEVEL steht', () => {
      const state = grow(withHand(['line-upgrade'], cost('line-upgrade')), MAX_FIELD_LEVEL);
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('nutzt nach dem Ausbau die neuen Lanes für Beschwörungen', () => {
      const next = structuredClone(botPlan(withHand(['line-upgrade'], cost('line-upgrade')), 1));
      expect(next.players[1].level).toBe(2);
      next.ready[1] = false;
      next.players[1].hand = ['summon-minion', 'summon-minion', 'summon-minion'];
      next.players[1].energy = 3;
      const after = botPlan(next, 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0, 1, 2]);
    });

    it('tower-hp: wählt die Lane mit den wenigsten Tower-Lebenspunkten', () => {
      const state = grow(withHand(['tower-hp'], cost('tower-hp')), 2);
      [100, 55, 80].forEach((hp, lane) => setLaneHp(state, lane, hp));
      const after = botPlan(state, 1);
      const gain = (getCardDef('tower-hp') as { hp: number }).hp;
      expect([0, 1, 2].map((lane) => laneHp(after, lane))).toEqual([100, 55 + gain, 80]);
    });

    it('minion-upgrade-line: wählt die Lane mit dem höchsten bonus.hp', () => {
      const state = grow(withHand(['minion-upgrade-line'], cost('minion-upgrade-line')), 2);
      [0, 10, 5].forEach((hp, line) => (state.players[1].lines[line]!.bonus.hp = hp));
      const gain = (getCardDef('minion-upgrade-line') as { hp: number }).hp;
      const after = botPlan(state, 1);
      expect(after.players[1].lines.map((line) => line.bonus.hp)).toEqual([0, 10 + gain, 5, 0, 0]);
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
