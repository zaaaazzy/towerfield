import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assessSituation,
  BOT_LEVEL_NAMES,
  BOT_LEVELS,
  botPlan as planWith,
  botPlanFor,
  botSeed,
  botStep as stepWith,
  botStepFor,
  ECONOMY_ACTIONS,
  normalPriority,
  PRIORITY as BOT_PRIORITY,
  STRONG_LIMIT,
  THREAT_LIMIT,
} from './bot';
import { getCardDef } from './cards';
import { activeSynergies } from './synergies';
import { isLaneBuyable, MAX_FIELD_LEVEL } from './lanes';
import {
  BASE_ENERGY,
  createLaneTowers,
  createMatch,
  HAND_LIMIT,
  LANE_COST,
  LINE_COUNT,
  MAX_ENERGY,
  MAX_ROUNDS,
  type MatchState,
  openLanes,
  type PlayerIndex,
  UPGRADE_COST,
} from './match';
import { firstFreeSlot, validSlots } from './placement';

const cost = (id: string) => getCardDef(id).cost;

/**
 * Reihenfolge nur mit Karten (ohne Wirtschaftsaktionen), wie vor dem neuen Wirtschaftskonzept; das Upgrade als Karte
 * steht wieder hinter `tower-hp`. Die Karten-Tests laufen damit, die Wirtschaft prüft der Block „Wirtschaft“ unten.
 */
const CARD_PRIORITY: readonly string[] = BOT_PRIORITY.filter((id) => !(ECONOMY_ACTIONS as readonly string[]).includes(id)).flatMap(
  (id) => (id === 'tower-hp' ? [id, 'line-upgrade'] : [id]),
);
const botStep = (state: MatchState, player: PlayerIndex, priority: readonly string[] = CARD_PRIORITY) =>
  stepWith(state, player, priority);
const botPlan = (state: MatchState, player: PlayerIndex, priority: readonly string[] = CARD_PRIORITY) =>
  planWith(state, player, priority);

/** Baut das Feld von Spieler 1 auf `level` aus (mit den Towern der frisch freien Lanes). */
function grow(state: MatchState, level: number): MatchState {
  const player = state.players[1];
  player.level = level;
  player.lines.forEach((lane, index) => {
    if (isLaneBuyable(level, index) && lane.towers.length === 0) {
      lane.bought = true;
      lane.towers = createLaneTowers(index);
    }
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
    const slot = firstFreeSlot(player.minions, line, player.lines[line]!.towers);
    player.minions.push({
      id: 100 + player.minions.length,
      line,
      ...(slot === undefined ? {} : { slot }),
      position: index,
      hp: 30,
      damage: 6,
      range: 4,
      speed: 10,
    });
  }
}

/** Belegt alle Turm-Slots der Lane von Spieler 1; gibt ihre Zahl zurück. */
function fillLane(state: MatchState, line: number): number {
  const count = validSlots(state.players[1].lines[line]!.towers).length;
  addMinions(state, line, count);
  return count;
}

const minionCount = (state: MatchState, line: number) => state.players[1].minions.filter((m) => m.line === line).length;

describe('Bot: Abwerfen', () => {
  it('wirft eine nutzlose Karte ab, wenn die Energie danach eine bevorzugte Karte bezahlbar macht', () => {
    const state = withHand(['buff-minion', 'summon-brute'], 1);
    const first = botStep(state, 1)!;
    expect(first).toMatchObject({ cardId: 'buff-minion', discard: true, line: undefined });
    expect(first.state.players[1].energy).toBe(2);
    const after = botPlan(state, 1);
    expect(after.players[1].hand).toEqual([]);
    expect(after.players[1].energy).toBe(0);
    expect(after.players[1].minions).toHaveLength(1);
  });

  it('wirft Karten ab, die gar nicht in der Prioritätenliste stehen', () => {
    const move = botStep(withHand(['summon-brute', 'tower-hp'], 1), 1, ['summon-brute']);
    expect(move).toMatchObject({ cardId: 'tower-hp', discard: true });
  });

  it('wirft nichts ab, wenn auch die zusätzliche Energie keine Karte spielbar macht', () => {
    expect(botStep(withHand(['buff-minion', 'summon-brute'], 0), 1)).toBeNull();
  });

  it('wirft nichts ab, wenn die Energie schon voll ist', () => {
    const state = withHand(['buff-minion'], MAX_ENERGY);
    expect(botStep(state, 1)).toBeNull();
    expect(botPlan(state, 1).players[1].hand).toEqual(['buff-minion']);
  });

  it('wirft keine Karte ab, die er selbst spielen würde', () => {
    expect(botStep(withHand(['summon-brute', 'summon-brute'], 1), 1)).toBeNull();
  });

  it('wirft nichts ab, solange er noch eine Karte spielen kann', () => {
    const move = botStep(withHand(['buff-minion', 'summon-minion'], 1), 1)!;
    expect(move.discard).toBeUndefined();
    expect(move.cardId).toBe('summon-minion');
  });
});

describe('Bot: Lane-Karten und neue Karten', () => {
  it('legt eine Lane-Karte auf die Lane mit den meisten eigenen Minions', () => {
    const state = grow(withHand(['lane-buff'], 2), 2);
    addMinions(state, 1, 1);
    addMinions(state, 2, 2);
    const move = botStep(state, 1)!;
    expect(move).toMatchObject({ cardId: 'lane-buff', line: 2 });
    expect(move.state.players[1].lines[2]).toMatchObject({ laneCard: 'lane-buff', laneEffect: 'buff' });
  });

  it('spielt eine Lane-Karte nicht auf eine Lane ohne Minions', () => {
    expect(botStep(withHand(['lane-shield'], 5), 1)).toBeNull();
  });

  it('legt höchstens eine Lane-Karte auf dieselbe Lane', () => {
    const state = withHand(['lane-buff', 'lane-shield'], 6);
    addMinions(state, 0, 1);
    const after = botPlan(state, 1);
    expect(after.players[1].lines[0]!.laneCard).toBe('lane-buff');
    expect(after.players[1].hand).toEqual(['lane-shield']);
  });

  it('spielt Späher, Wächter, Magier, Panzer und Drill', () => {
    for (const id of ['summon-scout', 'summon-guard', 'summon-mage', 'tower-armor', 'minion-upgrade-elite']) {
      const state = withHand([id], MAX_ENERGY);
      addMinions(state, 0, 1);
      expect(botStep(state, 1)?.cardId).toBe(id);
    }
  });
});

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

    it('verhält sich mit der exportierten Standardreihenfolge wie ohne Parameter', () => {
      const state = createMatch(4);
      expect(planWith(state, 1, BOT_PRIORITY)).toEqual(planWith(state, 1));
      expect(stepWith(state, 1, BOT_PRIORITY)).toEqual(stepWith(state, 1));
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
      const full0 = fillLane(state, 0);
      const full1 = fillLane(state, 1);
      const after = botPlan(state, 1);
      expect(minionCount(after, 2)).toBe(1);
      expect(minionCount(after, 0)).toBe(full0);
      expect(minionCount(after, 1)).toBe(full1);
    });

    it('summon: überspringt eine volle Lane und nimmt bei Gleichstand die niedrigste freie', () => {
      const state = grow(withHand(['summon-minion'], 1), 2);
      const full0 = fillLane(state, 0);
      addMinions(state, 1, 1);
      addMinions(state, 2, 1);
      const after = botPlan(state, 1);
      expect(minionCount(after, 0)).toBe(full0);
      expect(minionCount(after, 1)).toBe(2);
      expect(minionCount(after, 2)).toBe(1);
    });

    it('summon: setzt auf einen freien Turm-Slot und nie auf einen belegten', () => {
      const state = withHand(['summon-minion', 'summon-minion', 'summon-minion'], 3);
      const after = botPlan(state, 1);
      expect(after.players[1].minions.map((m) => m.slot)).toEqual([0, 1, 2]);
    });

    it('summon: meidet Lanes, deren Tower alle zerstört sind', () => {
      const state = grow(withHand(['summon-minion'], 1), 2);
      for (const tower of state.players[1].lines[0]!.towers) tower.hp = 0;
      const after = botPlan(state, 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([1]);
    });

    it('summon: lässt die Karte auf der Hand, wenn alle freien Lanes voll sind', () => {
      const state = grow(withHand(['summon-minion'], 3), 2);
      for (const line of [0, 1, 2]) fillLane(state, line);
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['summon-minion']);
      expect(after.players[1].energy).toBe(3);
      expect(after.players[1].minions).toEqual(state.players[1].minions);
      expect(after.ready[1]).toBe(true);
    });

    it('line-upgrade: spielt die Karte ohne Zielline und hebt nur die Feldstufe (Lanes kauft man separat)', () => {
      const move = botStep(withHand(['line-upgrade'], cost('line-upgrade')), 1);
      expect(move!.cardId).toBe('line-upgrade');
      expect(move!.line).toBeUndefined();
      expect(move!.state.players[1].level).toBe(2);
      expect(move!.state.players[1].lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
    });

    it('line-upgrade: baut Lvl 1 → 2 → 3 aus und lässt danach die Karte auf der Hand', () => {
      const state = withHand(['line-upgrade', 'line-upgrade', 'line-upgrade'], 3 * cost('line-upgrade'));
      const after = botPlan(state, 1);
      expect(after.players[1].level).toBe(MAX_FIELD_LEVEL);
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

    it('nutzt nach dem Kauf der neuen Lanes diese für Beschwörungen', () => {
      const next = structuredClone(grow(withHand([], 0), 2));
      next.players[1].hand = [];
      next.players[1].energy = 0;
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

  describe('buff-minion', () => {
    it('stärkt den lebenden Minion mit dem größten maxHp (bei Gleichstand die kleinste Id) und meldet seine Id', () => {
      const state = withHand(['buff-minion'], cost('buff-minion'));
      addMinions(state, 0, 3);
      state.players[1].minions[1]!.maxHp = 50;
      state.players[1].minions[2]!.maxHp = 50;
      state.players[1].minions[0]!.maxHp = 80;
      state.players[1].minions[0]!.hp = 0;
      const move = botStep(state, 1);
      expect(move).toMatchObject({ cardId: 'buff-minion', line: undefined, minionId: 101 });
      expect(move!.state.players[1].minions.find((m) => m.id === 101)).toMatchObject({ maxHp: 75, damage: 9 });
      expect(move!.state.players[1].minions.find((m) => m.id === 102)).toMatchObject({ maxHp: 50, damage: 6 });
    });

    it('nimmt hp als Größe, wenn ein Minion kein maxHp hat', () => {
      const state = withHand(['buff-minion'], cost('buff-minion'));
      addMinions(state, 0, 2);
      state.players[1].minions[1]!.hp = 40;
      expect(botStep(state, 1)).toMatchObject({ minionId: 101 });
    });

    it('spielt die Karte nicht, wenn kein lebender eigener Minion existiert', () => {
      const state = withHand(['buff-minion'], cost('buff-minion'));
      expect(botStep(state, 1)).toBeNull();
      addMinions(state, 0, 1);
      state.players[1].minions[0]!.hp = 0;
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['buff-minion']);
      expect(after.players[1].energy).toBe(cost('buff-minion'));
      expect(after.ready[1]).toBe(true);
    });

    it('beschwört erst und stärkt dann den neuen Minion, weil die Beschwörung höher priorisiert ist', () => {
      const state = withHand(['buff-minion', 'summon-minion'], cost('buff-minion') + cost('summon-minion'));
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual([]);
      expect(after.players[1].minions).toHaveLength(1);
      expect(after.players[1].minions[0]).toMatchObject({ maxHp: 45, hp: 45, damage: 9 });
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

  describe('Spezialisierung', () => {
    const hand = ['tower-lightning', 'tower-shield', 'tower-lightning', 'tower-shield', 'tower-lightning'];

    it('spielt sie auf Lanes mit dem höchsten Level zuerst, bei Gleichstand die niedrigste Lane', () => {
      let state = grow(withHand(hand, 20), MAX_FIELD_LEVEL);
      const lanes: (number | undefined)[] = [];
      for (let move = botStep(state, 1); move; move = botStep(state, 1)) {
        lanes.push(move.line);
        state = move.state;
      }
      // Lane 3 und 4 haben Level 3, Lane 1 und 2 Level 2; die Start-Lane (Level 1) bleibt außen vor.
      expect(lanes).toEqual([3, 4, 1, 2]);
      expect(state.players[1].hand).toHaveLength(1);
      expect(state.players[1].lines[0]!.towers.some((tower) => tower.specialization)).toBe(false);
    });

    it('spielt sie nicht, wenn keine Lane das Mindest-Level hat', () => {
      expect(botStep(withHand(hand, 20), 1)).toBeNull();
      const after = botPlan(withHand(hand, 20), 1);
      expect(after.players[1].hand).toEqual(hand);
      expect(after.players[1].energy).toBe(20);
    });

    it('überspringt Lanes ohne lebenden, unspezialisierten Tower', () => {
      const state = grow(withHand(['tower-shield'], 5), MAX_FIELD_LEVEL);
      for (const lane of [3, 4, 1]) state.players[1].lines[lane]!.towers[0]!.hp = 0;
      expect(botStep(state, 1)?.line).toBe(2);
    });

    it('verursacht nie einen Fehler in playCard', () => {
      for (let seed = 1; seed <= 20; seed += 1) {
        const state = grow(withHand(hand, MAX_ENERGY, seed), 1 + (seed % MAX_FIELD_LEVEL));
        const after = botPlan(state, 1);
        const left = after.players[1].hand.filter((id) => getCardDef(id).type === 'tower-specialize');
        // Was übrig bleibt, hat entweder keine zulässige Lane oder nicht mehr genug Energie.
        for (const id of left) {
          const result = botStep(after, 1, [id]);
          expect(result === null || after.players[1].energy >= cost(id)).toBe(true);
        }
      }
    });
  });
});

describe('Bot: Wirtschaft', () => {
  const economyPlan = (state: MatchState, priority: readonly string[] = BOT_PRIORITY) => planWith(state, 1, priority);

  it('kauft in Runde 1 mit den Startenergie zuerst das Upgrade', () => {
    const move = stepWith(withHand([], BASE_ENERGY), 1);
    expect(move).toMatchObject({ economy: 'upgrade', cardId: '' });
    expect(move!.state.players[1].level).toBe(2);
    expect(move!.state.players[1].energy).toBe(BASE_ENERGY - UPGRADE_COST);
  });

  it('kauft eine Lane (die niedrigste kaufbare) erst ab Feldstufe 2 und mit 5 Energie', () => {
    const level1 = withHand([], 20);
    // Auf Stufe 1 bleibt nur das Upgrade, bis die Stufe 2 steht; danach folgt der Lane-Kauf.
    const priority = ['buy-lane'];
    expect(stepWith(level1, 1, priority)).toBeNull();
    const level2 = grow(withHand([], 20), 2);
    for (const lane of [1, 2]) level2.players[1].lines[lane] = { bought: false, towers: [], bonus: { hp: 0, damage: 0 } };
    const first = stepWith(level2, 1, priority);
    expect(first).toMatchObject({ economy: 'buy-lane', line: 1 });
    expect(first!.state.players[1].energy).toBe(20 - LANE_COST);
    expect(stepWith(first!.state, 1, priority)).toMatchObject({ economy: 'buy-lane', line: 2 });
    const poor = grow(withHand([], LANE_COST - 1), 2);
    poor.players[1].lines[1] = { bought: false, towers: [], bonus: { hp: 0, damage: 0 } };
    expect(stepWith(poor, 1, priority)).toBeNull();
  });

  it('kauft Upgrade und Lane nicht mehr, wenn sich der Preis bis zum Spielende nicht amortisiert', () => {
    const late = withHand([], 20);
    late.round = MAX_ROUNDS;
    expect(stepWith(late, 1, ['upgrade'])).toBeNull();
    const lateLane = grow(withHand([], 20), 2);
    lateLane.round = MAX_ROUNDS;
    lateLane.players[1].lines[1] = { bought: false, towers: [], bonus: { hp: 0, damage: 0 } };
    expect(stepWith(lateLane, 1, ['buy-lane'])).toBeNull();
  });

  it('zieht nur als Rückfall, wenn nichts anderes spielbar ist, und lässt 1 Energie übrig', () => {
    const state = withHand(['summon-minion'], 3);
    expect(stepWith(state, 1, ['draw', 'summon-minion'])).toMatchObject({ cardId: 'summon-minion' });
    const stuck = withHand(['summon-mage'], 2);
    const drawn = stepWith(stuck, 1, ['draw', 'summon-mage']);
    expect(drawn).toMatchObject({ economy: 'draw' });
    expect(drawn!.state.players[1].hand).toHaveLength(2);
    expect(drawn!.state.players[1].energy).toBe(1);
    // Mit 1 Energie bleibt nichts zum Spielen übrig: der Bot zieht nicht mehr.
    expect(stepWith(drawn!.state, 1, ['draw', 'summon-mage'])).toBeNull();
  });

  it('zieht nicht über das Handlimit hinaus und nicht, wenn „draw“ fehlt', () => {
    const full = withHand(Array(HAND_LIMIT).fill('summon-mage'), 5);
    expect(stepWith(full, 1, ['draw'])).toBeNull();
    expect(stepWith(withHand([], 5), 1, ['upgrade'])).toMatchObject({ economy: 'upgrade' });
    expect(stepWith(withHand([], 1), 1, ['summon-minion'])).toBeNull();
  });

  it('endet mit jeder Reihenfolge, auch wenn Ziehen und Abwerfen einander abwechseln könnten', () => {
    const order = ['draw', 'summon-guard', 'upgrade', 'buy-lane'];
    const state = withHand(['summon-minion', 'summon-minion', 'summon-guard'], 3);
    const after = economyPlan(state, order);
    expect(after.ready[1]).toBe(true);
    expect(after.players[1].energy).toBeGreaterThanOrEqual(0);
  });

  it('plant mit der Standardreihenfolge ein ganzes Match ohne Fehler und wächst mit dem Einkommen', () => {
    let state = createMatch(3);
    state = economyPlan(state);
    expect(state.players[1].level).toBeGreaterThanOrEqual(2);
    expect(state.players[1].energy).toBeLessThanOrEqual(MAX_ENERGY);
  });
});

/** Legt `count` lebende Minions des Spielers 0 (Gegner des Bots) auf die Lane `line` (Ids ab 500). */
function addFoes(state: MatchState, line: number, count: number, hp = 30): void {
  const enemy = state.players[0];
  for (let index = 0; index < count; index += 1) {
    enemy.minions.push({ id: 500 + enemy.minions.length, line, position: index, hp, damage: 6, range: 4, speed: 10 });
  }
}

/** Zustand mit gesetzter Hand und Energie; das Feld ist auf Stufe 2 ausgebaut (Lanes 0 bis 2 offen). */
function normalState(hand: string[], energy = 6, seed = 4): MatchState {
  const state = grow(withHand(hand, energy, seed), 2);
  expect(openLanes(state.players[1])).toEqual([0, 1, 2]);
  // Letzte Runde: Upgrade und Lane-Kauf lohnen sich nicht mehr, der Bot spielt dann nur Karten.
  state.round = MAX_ROUNDS;
  return state;
}

/** Karten der Prioritätsliste „Normal“ in ihrer Reihenfolge, ohne Wirtschaftsaktionen. */
const cardOrder = (state: MatchState, seed: number): string[] =>
  normalPriority(state, 1, seed).filter((id) => state.players[1].hand.includes(id));

describe('Bot-Stufen', () => {
  it('kennt die Stufen Leicht und Normal', () => {
    expect(BOT_LEVELS).toEqual(['easy', 'normal']);
    expect(BOT_LEVEL_NAMES).toEqual({ easy: 'Leicht', normal: 'Normal' });
  });

  it('botStepFor("easy") liefert denselben Zug wie botStep, auch mit eigener Reihenfolge', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const state = createMatch(seed);
      expect(botStepFor('easy', state, 1)).toEqual(stepWith(state, 1, BOT_PRIORITY));
      expect(botStepFor('easy', state, 1, CARD_PRIORITY)).toEqual(stepWith(state, 1, CARD_PRIORITY));
    }
  });

  it('botPlanFor("easy") liefert denselben Zustand wie botPlan', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const state = createMatch(seed);
      expect(botPlanFor('easy', state, 1)).toEqual(planWith(state, 1, BOT_PRIORITY));
    }
  });

  it('botPlanFor("normal") meldet bereit, bleibt im Energierahmen und ist reproduzierbar', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const state = createMatch(seed);
      const planned = botPlanFor('normal', state, 1);
      expect(planned.ready[1]).toBe(true);
      expect(planned.players[1].energy).toBeGreaterThanOrEqual(0);
      expect(botPlanFor('normal', state, 1)).toEqual(planned);
    }
  });

  it('bot.ts nutzt weder Phaser noch DOM und keinen anderen Zufall als nextRandom', () => {
    const source = readFileSync(fileURLToPath(new URL('./bot.ts', import.meta.url)), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from 'phaser'|\bwindow\b|\bdocument\b|\bcanvas\b|Math\.random|Date\.now/i);
    expect(code).toContain('nextRandom');
  });
});

describe('assessSituation', () => {
  it('markiert eine Lane erst als gefährdet, wenn die gegnerischen Minions die Schwelle überschreiten', () => {
    const state = normalState([]);
    addFoes(state, 0, 2);
    const two = assessSituation(state, 1).lanes[0]!;
    expect(two).toMatchObject({ open: true, enemyMinions: 2, endangered: false });
    expect(two.threat).toBeLessThan(THREAT_LIMIT);
    addFoes(state, 0, 1);
    const three = assessSituation(state, 1).lanes[0]!;
    expect(three).toMatchObject({ enemyMinions: 3, endangered: true });
    expect(three.threat).toBeGreaterThanOrEqual(THREAT_LIMIT);
    expect(three.danger).toBe(three.threat - three.towerHp);
  });

  it('gefährdet auch, wenn die Bedrohung die Tower-HP übersteigt, obwohl sie unter der Schwelle liegt', () => {
    const state = normalState([]);
    addFoes(state, 0, 2);
    setLaneHp(state, 0, 50);
    const lane = assessSituation(state, 1).lanes[0]!;
    expect(lane.threat).toBeLessThan(THREAT_LIMIT);
    expect(lane).toMatchObject({ towerHp: 50, endangered: true });
  });

  it('gefährdet nichts ohne Gegner, ignoriert Tote und fremde Lanes, zählt Schild zu den HP', () => {
    const state = normalState([]);
    setLaneHp(state, 0, 5);
    expect(assessSituation(state, 1).lanes[0]).toMatchObject({ towerHp: 5, enemyMinions: 0, endangered: false });
    addFoes(state, 0, 4, 0);
    addFoes(state, 1, 1);
    const lanes = assessSituation(state, 1).lanes;
    expect(lanes[0]).toMatchObject({ enemyMinions: 0, endangered: false });
    expect(lanes[1]).toMatchObject({ enemyMinions: 1, endangered: false });
    state.players[1].lines[1]!.towers[0]!.shield = 25;
    expect(assessSituation(state, 1).lanes[1]!.towerHp).toBe(laneHp(state, 1) + 25);
  });

  it('meldet gesperrte Lanes als nicht offen und nie als gefährdet', () => {
    const state = withHand([], 3);
    addFoes(state, 1, 5);
    const lane = assessSituation(state, 1).lanes[1]!;
    expect(lane).toMatchObject({ open: false, endangered: false, strong: false });
  });

  it('erkennt eine starke eigene Lane, aber nicht bei Gefährdung oder zu wenig Stärke', () => {
    const state = normalState([]);
    addMinions(state, 0, 1);
    expect(assessSituation(state, 1).lanes[0]).toMatchObject({ ownMinions: 1, strong: false });
    addMinions(state, 0, 1);
    const strong = assessSituation(state, 1).lanes[0]!;
    expect(strong).toMatchObject({ ownMinions: 2, strong: true });
    expect(strong.ownPower).toBeGreaterThanOrEqual(STRONG_LIMIT);
    addFoes(state, 0, 3);
    expect(assessSituation(state, 1).lanes[0]).toMatchObject({ endangered: true, strong: false });
  });

  it('liest die Synergien: Auslöser, Erhalt und aktive Synergien aus player.played und player.synergies', () => {
    const state = normalState([]);
    expect(assessSituation(state, 1)).toMatchObject({ synergies: [], triggers: [], keeps: [] });
    const player = state.players[1];
    player.played = [{ cardId: 'summon-archer', line: 0 }];
    expect(assessSituation(state, 1).triggers).toEqual(['line-upgrade']);
    player.played = [{ cardId: 'line-upgrade' }];
    expect(assessSituation(state, 1).triggers).toEqual(['summon-archer']);
    player.played = [{ cardId: 'summon-archer', line: 0 }, { cardId: 'line-upgrade' }];
    player.synergies = activeSynergies(player.played);
    const situation = assessSituation(state, 1);
    expect(situation.synergies).toEqual(player.synergies);
    expect(situation.triggers).toEqual([]);
    expect([...situation.keeps].sort()).toEqual(['line-upgrade', 'summon-archer']);
  });

  it('verändert den Zustand nicht', () => {
    const state = normalState(['tower-hp']);
    addFoes(state, 0, 3);
    const before = structuredClone(state);
    assessSituation(state, 1);
    expect(state).toEqual(before);
  });
});

describe('Bot „Normal“: Kartenwahl nach Lage', () => {
  it('spielt bei gefährdeter Lane eine Verteidigungskarte vor einer Angriffskarte', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const state = normalState(['tower-damage', 'tower-hp']);
      addFoes(state, 0, 3);
      expect(cardOrder(state, seed)).toEqual(['tower-hp', 'tower-damage']);
      expect(botStepFor('normal', state, 1)?.cardId).toBe('tower-hp');
    }
  });

  it('zählt Beschwörungen und Schilde zur Verteidigung', () => {
    const state = normalState(['lane-buff', 'summon-minion', 'lane-shield', 'tower-damage']);
    addFoes(state, 0, 3);
    const order = cardOrder(state, 3);
    expect(order.slice(0, 2).sort()).toEqual(['lane-shield', 'summon-minion']);
    expect(order.slice(2).sort()).toEqual(['lane-buff', 'tower-damage']);
  });

  it('spielt bei starker eigener Lane Angriffs- und Buff-Karten vor Verteidigung', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const state = normalState(['tower-hp', 'tower-damage', 'lane-buff']);
      addMinions(state, 0, 2);
      const order = cardOrder(state, seed);
      expect(order.indexOf('tower-hp')).toBe(2);
      expect(order.slice(0, 2).sort()).toEqual(['lane-buff', 'tower-damage']);
    }
  });

  it('bevorzugt bei gleichen Karten die, die eine Synergie auslöst', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const state = normalState(['summon-minion', 'summon-archer']);
      state.players[1].played = [{ cardId: 'line-upgrade' }];
      expect(cardOrder(state, seed)).toEqual(['summon-archer', 'summon-minion']);
    }
    const state = normalState(['summon-minion', 'summon-archer'], 2);
    state.players[1].played = [{ cardId: 'line-upgrade' }];
    expect(botStepFor('normal', state, 1)).toMatchObject({ cardId: 'summon-archer' });
  });

  it('gibt Karten bereits aktiver Synergien einen kleinen Bonus', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const state = normalState(['summon-minion', 'summon-archer']);
      state.players[1].played = [{ cardId: 'summon-archer', line: 0 }, { cardId: 'line-upgrade' }];
      state.players[1].synergies = activeSynergies(state.players[1].played);
      expect(cardOrder(state, seed)).toEqual(['summon-archer', 'summon-minion']);
    }
  });

  it('lässt Wirtschaftsaktionen in der Liste: Upgrade vor neutralen Karten, Ziehen zuletzt', () => {
    const state = normalState(['summon-minion', 'tower-hp', 'summon-minion']);
    const order = normalPriority(state, 1, 9);
    expect(order[0]).toBe('upgrade');
    expect(order.at(-1)).toBe('draw');
    expect(order.filter((id) => id === 'summon-minion')).toHaveLength(1);
    expect(order).toContain('buy-lane');
  });

  it('führt Wirtschaftsaktionen über die bestehenden Regeln aus', () => {
    const state = normalState([], 3);
    state.round = 1;
    const move = botStepFor('normal', state, 1);
    expect(move).toMatchObject({ economy: 'upgrade', cardId: '' });
    expect(move!.state.players[1].energy).toBe(3 - UPGRADE_COST);
  });

  it('wirft nutzlose Karten wie „Leicht“ ab, wenn die Energie dadurch eine Karte bezahlbar macht', () => {
    const state = withHand(['buff-minion', 'summon-brute'], 1);
    const move = botStepFor('normal', state, 1)!;
    expect(move).toMatchObject({ cardId: 'buff-minion', discard: true, line: undefined });
    expect(move.state.players[1].energy).toBe(2);
    // Mit der Energie baut „Normal“ danach das Feld aus (Upgrade steht vor neutralen Karten).
    const planned = botPlanFor('normal', state, 1);
    expect(planned.players[1].hand).toEqual(['summon-brute']);
    expect(planned.players[1].level).toBe(2);
  });
});

describe('Bot „Normal“: Zielwahl', () => {
  it('platziert Beschwörungen in der gefährdetsten Lane', () => {
    const state = normalState(['summon-minion']);
    addFoes(state, 1, 3);
    addFoes(state, 0, 1);
    expect(botStepFor('normal', state, 1)).toMatchObject({ cardId: 'summon-minion', line: 1 });
    const other = normalState(['summon-minion']);
    // Gleiche Tower-HP in beiden Lanes, damit nur die Zahl der Gegner entscheidet.
    setLaneHp(other, 0, 100);
    setLaneHp(other, 1, 100);
    addFoes(other, 0, 4);
    addFoes(other, 1, 3);
    expect(botStepFor('normal', other, 1)).toMatchObject({ cardId: 'summon-minion', line: 0 });
  });

  it('wählt ohne Gegner die Lane mit den wenigsten Tower-HP und bei Gleichstand die mit weniger Minions', () => {
    const state = normalState(['summon-minion']);
    setLaneHp(state, 1, 60);
    expect(botStepFor('normal', state, 1)).toMatchObject({ line: 1 });
    const even = normalState(['summon-minion']);
    addMinions(even, 0, 1);
    expect(botStepFor('normal', even, 1)).toMatchObject({ line: 1 });
  });

  it('setzt Tower-Upgrades in die gefährdetste Lane', () => {
    const state = normalState(['tower-hp']);
    addFoes(state, 1, 3);
    expect(botStepFor('normal', state, 1)).toMatchObject({ cardId: 'tower-hp', line: 1 });
  });

  it('legt ein Lane-Schild auf die gefährdetste Lane mit eigenen Minions, einen Buff auf die stärkste', () => {
    const shield = normalState(['lane-shield']);
    addMinions(shield, 0, 1);
    addMinions(shield, 1, 1);
    addFoes(shield, 1, 3);
    expect(botStepFor('normal', shield, 1)).toMatchObject({ cardId: 'lane-shield', line: 1 });

    const buff = normalState(['lane-buff']);
    addMinions(buff, 0, 1);
    addMinions(buff, 1, 2);
    expect(botStepFor('normal', buff, 1)).toMatchObject({ cardId: 'lane-buff', line: 1 });
  });

  it('behält bei Spezialisierungen und Minion-Upgrades die Regeln von „Leicht“', () => {
    const upgrade = normalState(['minion-upgrade-line']);
    addFoes(upgrade, 1, 3);
    expect(botStepFor('normal', upgrade, 1)).toMatchObject({ cardId: 'minion-upgrade-line', line: 0 });
    const special = grow(withHand(['tower-shield'], 4), 3);
    special.round = MAX_ROUNDS;
    expect(botStepFor('normal', special, 1)).toEqual(stepWith(special, 1, ['tower-shield']));
  });
});

describe('Bot „Normal“: Zufall nur für Gleichstände', () => {
  it('liefert für denselben Zustand denselben Zug und dieselbe Liste', () => {
    const state = normalState(['summon-minion', 'summon-brute', 'summon-scout'], 5);
    addFoes(state, 0, 3);
    expect(botStepFor('normal', state, 1)).toEqual(botStepFor('normal', structuredClone(state), 1));
    expect(normalPriority(state, 1, 77)).toEqual(normalPriority(state, 1, 77));
    expect(botSeed(state, 1)).toBe(botSeed(structuredClone(state), 1));
  });

  it('löst Gleichstände je nach Seed verschieden auf, ohne die Reihenfolge nach Punkten zu ändern', () => {
    const state = normalState(['summon-minion', 'summon-brute', 'tower-damage']);
    addFoes(state, 0, 3);
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const order = cardOrder(state, seed);
      firsts.add(order[0]!);
      expect(order.at(-1)).toBe('tower-damage');
    }
    expect([...firsts].sort()).toEqual(['summon-brute', 'summon-minion']);
  });

  it('leitet den Seed aus dem Zustand ab: Energie, Hand und Runde ändern ihn', () => {
    const state = normalState(['summon-minion'], 4);
    const base = botSeed(state, 1);
    const less = structuredClone(state);
    less.players[1].energy -= 1;
    const later = structuredClone(state);
    later.round += 1;
    expect(botSeed(less, 1)).not.toBe(base);
    expect(botSeed(later, 1)).not.toBe(base);
    expect(botSeed(state, 0)).not.toBe(base);
    expect(Number.isInteger(base) && base >= 0).toBe(true);
  });
});
