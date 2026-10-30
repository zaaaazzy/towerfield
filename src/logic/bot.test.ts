import { describe, expect, it } from 'vitest';
import { botPlan as planWith, botStep as stepWith, ECONOMY_ACTIONS, PRIORITY as BOT_PRIORITY } from './bot';
import {
  BASE_ENERGY,
  CARD_BALANCE,
  CARDS_PER_ROUND,
  DISCARD_ENERGY,
  DRAW_COST,
  LANE_COST,
  MAX_ENERGY,
  MAX_ROUNDS,
  START_FORTRESSES,
  TOWER_HP,
  UPGRADE_COST,
} from './balance-config';
import { buffGain } from './buff';
import { getCardDef } from './cards';
import { isLaneBuyable, MAX_FIELD_LEVEL } from './lanes';
import { LINE_COUNT, type MatchState, type PlayerIndex } from './match';
import { firstFreeSlot, validSlots } from './placement';
import { createMatchWithDeck, fullHand, handOf, unitOf } from './test-fixtures';

const cost = (id: string) => getCardDef(id).cost;

/** Karten des Start-Matches der Bot-Tests; der Bot liest nur die Hand, das Deck ist hier fest statt vom Seed abhängig. */
const STARTER_CARDS = ['summon-minion', 'summon-brute', 'tower-hp', 'summon-archer', 'minion-upgrade-line'];

/** Match mit festem Deck (`STARTER_CARDS`); der Seed bestimmt nur die Runden-Ereignisse. */
const startMatch = (seed = 4): MatchState => createMatchWithDeck(STARTER_CARDS, seed);

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

/** Baut das Feld von Spieler 1 auf `level` aus und kauft die damit freien Lanes (die Tower stehen schon). */
function grow(state: MatchState, level: number): MatchState {
  const player = state.players[1];
  player.level = level;
  player.lines.forEach((lane, index) => {
    if (isLaneBuyable(level, index)) lane.bought = true;
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
  const state = startMatch(seed);
  state.players[1].hand = [...hand];
  state.players[1].energy = energy;
  return state;
}

/** Legt `count` Minions auf eine Line des Spielers 1 (Ids ab 100, damit sie nicht mit gespielten kollidieren). */
function addMinions(state: MatchState, line: number, count: number): void {
  const player = state.players[1];
  for (let index = 0; index < count; index += 1) {
    const slot = firstFreeSlot(player.minions, line, player.lines[line]!.towers);
    const minion = unitOf('summon-minion', {
      id: 100 + player.minions.length,
      line,
      position: index,
    });
    // Ohne maxHp, wie der Bot es von Altzuständen kennt; ohne freien Slot auch ohne `slot`.
    delete minion.maxHp;
    if (slot === undefined) delete minion.slot;
    else minion.slot = slot;
    player.minions.push(minion);
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
  /** Eine Abwerf-Energie unter den Kosten des Brockens: erst das Abwerfen macht ihn bezahlbar. */
  const justShort = cost('summon-brute') - DISCARD_ENERGY;

  it('wirft eine nutzlose Karte ab, wenn die Energie danach eine bevorzugte Karte bezahlbar macht', () => {
    const state = withHand(['buff-minion', 'summon-brute'], justShort);
    const first = botStep(state, 1)!;
    expect(first).toMatchObject({ cardId: 'buff-minion', discard: true, line: undefined });
    expect(first.state.players[1].energy).toBe(cost('summon-brute'));
    const after = botPlan(state, 1);
    expect(after.players[1].hand).toEqual([]);
    expect(after.players[1].energy).toBe(0);
    expect(after.players[1].minions).toHaveLength(1);
  });

  it('wirft Karten ab, die gar nicht in der Prioritätenliste stehen', () => {
    const move = botStep(withHand(['summon-brute', 'tower-hp'], justShort), 1, ['summon-brute']);
    expect(move).toMatchObject({ cardId: 'tower-hp', discard: true });
  });

  it('wirft nichts ab, wenn auch die zusätzliche Energie keine Karte spielbar macht', () => {
    expect(botStep(withHand(['buff-minion', 'summon-brute'], justShort - DISCARD_ENERGY), 1)).toBeNull();
  });

  it('wirft nichts ab, wenn die Energie schon voll ist', () => {
    const state = withHand(['buff-minion'], MAX_ENERGY);
    expect(botStep(state, 1)).toBeNull();
    expect(botPlan(state, 1).players[1].hand).toEqual(['buff-minion']);
  });

  it('wirft keine Karte ab, die er selbst spielen würde', () => {
    expect(botStep(withHand(['summon-brute', 'summon-brute'], justShort), 1)).toBeNull();
  });

  it('wirft nichts ab, solange er noch eine Karte spielen kann', () => {
    const move = botStep(withHand(['buff-minion', 'summon-minion'], cost('summon-minion')), 1)!;
    expect(move.discard).toBeUndefined();
    expect(move.cardId).toBe('summon-minion');
  });
});

describe('Bot: Lane-Karten und neue Karten', () => {
  it('legt eine Lane-Karte auf die Lane mit den meisten eigenen Minions', () => {
    const state = grow(withHand(['lane-buff'], cost('lane-buff')), 2);
    addMinions(state, 1, 1);
    addMinions(state, 2, 2);
    const move = botStep(state, 1)!;
    expect(move).toMatchObject({ cardId: 'lane-buff', line: 2 });
    expect(move.state.players[1].lines[2]).toMatchObject({ laneCard: 'lane-buff', laneEffect: 'buff' });
  });

  it('spielt eine Lane-Karte nicht auf eine Lane ohne Minions', () => {
    expect(botStep(withHand(['lane-shield'], cost('lane-shield')), 1)).toBeNull();
  });

  it('legt höchstens eine Lane-Karte auf dieselbe Lane', () => {
    const state = withHand(['lane-buff', 'lane-shield'], cost('lane-buff') + cost('lane-shield'));
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
    const before = startMatch();
    const after = botPlan(before, 1);
    expect(after.ready[1]).toBe(true);
    expect(after.players[1].hand.length).toBeLessThan(before.players[1].hand.length);
    expect(after.players[1].energy).toBeLessThan(before.players[1].energy);
    expect(after.players[0]).toEqual(before.players[0]);
  });

  it('entscheidet deterministisch', () => {
    expect(botPlan(startMatch(), 1)).toEqual(botPlan(startMatch(), 1));
  });

  it('verteilt Minions zuerst auf Lanes ohne Minions', () => {
    const state: MatchState = grow(startMatch(), 2);
    state.players[1].hand = handOf('summon-minion', 3);
    state.players[1].energy = 3 * cost('summon-minion');
    const after = botPlan(state, 1);
    expect(after.players[1].minions.map((m) => m.line).sort()).toEqual([0, 1, 2]);
  });

  it('gibt nicht mehr Energie aus, als vorhanden ist, und wirkt nicht auf den Gegner', () => {
    const state = startMatch();
    state.players[1].energy = cost('summon-minion');
    const after = botPlan(state, 1);
    expect(after.players[1].energy).toBeGreaterThanOrEqual(0);
    expect(after.players[0]).toEqual(state.players[0]);
  });

  it('spielt im Vergleich der Spielerseiten spiegelgleich', () => {
    const state = startMatch(8);
    const asSecond = botPlan(state, 1).players[1];
    const asFirst = botPlan(state, 0).players[0];
    expect(asFirst).toEqual(asSecond);
  });

  describe('botStep', () => {
    it('spielt genau eine Karte und lässt den Eingabezustand unverändert', () => {
      const before = withHand(['summon-minion', 'summon-minion'], MAX_ENERGY);
      const snapshot = structuredClone(before);
      const move = botStep(before, 1);
      expect(move).not.toBeNull();
      expect(move!.cardId).toBe('summon-minion');
      expect(move!.state.players[1].hand).toEqual(['summon-minion']);
      expect(move!.state.players[1].energy).toBe(MAX_ENERGY - cost('summon-minion'));
      expect(before).toEqual(snapshot);
    });

    it('liefert die Zielline für Karten mit Ziel und undefined ohne Ziel', () => {
      const move = botStep(withHand(['summon-minion'], MAX_ENERGY), 1);
      expect(move!.line).toBeGreaterThanOrEqual(0);
      expect(move!.line).toBeLessThan(LINE_COUNT);
    });

    it('gibt null zurück, wenn keine Karte spielbar ist', () => {
      expect(botStep(withHand(['summon-minion'], 0), 1)).toBeNull();
      expect(botStep(withHand([], MAX_ENERGY), 1)).toBeNull();
      expect(botStep(withHand(['summon-minion'], MAX_ENERGY), 1, [])).toBeNull();
    });

    it('wiederholt angewendet ergibt dasselbe wie botPlan ohne Bereit-Meldung', () => {
      const start = startMatch();
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

    it('beschwört einen Heiler mit seiner Reichweite und Heiler-Merkmal, andere Minions ohne', () => {
      const after = botPlan(withHand(['summon-healer', 'summon-minion'], cost('summon-healer') + cost('summon-minion')), 1);
      const minions = after.players[1].minions;
      expect(minions).toHaveLength(2);
      expect(minions.filter((m) => m.heals)).toHaveLength(1);
      expect(minions.find((m) => m.heals)).toMatchObject({
        range: CARD_BALANCE['summon-healer'].range,
        maxHp: CARD_BALANCE['summon-healer'].hp,
      });
      expect(minions.find((m) => !m.heals)!.heals).toBeUndefined();
    });

    it('beschwört einen Zerstörer mit Explosionswerten, andere Minions ohne', () => {
      const after = botPlan(
        withHand(['summon-destroyer', 'summon-minion'], cost('summon-destroyer') + cost('summon-minion')),
        1,
      );
      const minions = after.players[1].minions;
      expect(minions).toHaveLength(2);
      expect(minions.find((m) => m.explodes)).toMatchObject({
        explodes: CARD_BALANCE['summon-destroyer'].explosion,
        maxHp: CARD_BALANCE['summon-destroyer'].hp,
      });
      expect(minions.filter((m) => m.explodes)).toHaveLength(1);
      expect(minions.some((m) => m.heals)).toBe(false);
    });

    it('beschwört einen Bogenschützen mit seiner Reichweite und seinem Tempo', () => {
      const after = botPlan(withHand(['summon-archer'], cost('summon-archer')), 1);
      expect(after.players[1].minions).toHaveLength(1);
      expect(after.players[1].minions[0]).toMatchObject({
        range: CARD_BALANCE['summon-archer'].range,
        speed: CARD_BALANCE['summon-archer'].speed,
      });
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
      // Genug für jede der beiden Karten, aber nicht für beide.
      const scarce = Math.max(cost('summon-minion'), cost('tower-hp'));
      expect(scarce).toBeLessThan(cost('summon-minion') + cost('tower-hp'));
      const byDefault = botPlan(withHand(hand, scarce), 1);
      const reordered = botPlan(withHand(hand, scarce), 1, ['tower-hp', 'summon-minion']);
      expect(byDefault.players[1].hand).toEqual(['tower-hp']);
      expect(reordered.players[1].hand).toEqual(['summon-minion']);
    });

    it('verhält sich mit der exportierten Standardreihenfolge wie ohne Parameter', () => {
      const state = startMatch();
      expect(planWith(state, 1, BOT_PRIORITY)).toEqual(planWith(state, 1));
      expect(stepWith(state, 1, BOT_PRIORITY)).toEqual(stepWith(state, 1));
    });

    it('spielt Karten nicht, die in der Reihenfolge fehlen', () => {
      const after = botPlan(withHand(['summon-minion', 'tower-hp'], MAX_ENERGY), 1, ['tower-hp']);
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
      // Knapp unter den Kosten der teuren Karte, aber genug für den Tower.
      const energy = cost('minion-upgrade-all') - 1;
      const state = withHand(['minion-upgrade-all', 'tower-hp'], energy);
      expect(energy).toBeGreaterThanOrEqual(cost('tower-hp'));
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['minion-upgrade-all']);
      expect(after.players[1].energy).toBe(energy - cost('tower-hp'));
    });

    it('senkt die Energie genau um die Kosten der gespielten Karten', () => {
      const hand = ['minion-upgrade-all', 'tower-damage', 'summon-minion', 'tower-hp'];
      const played = ['summon-minion', 'tower-hp', 'tower-damage'];
      const spent = played.reduce((sum, id) => sum + cost(id), 0);
      const leftover = 1;
      const energy = spent + leftover;
      expect(cost('minion-upgrade-all')).toBeGreaterThan(leftover);
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
      const state = withHand(hand, Math.min(...hand.map(cost)) - 1);
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
      const gain = CARD_BALANCE['tower-hp'].hp;
      // Lane 1 ist die schwächste, Lane 2 liegt knapp darüber (unter Lane 1 nach deren erstem Upgrade), Lane 0 ist heil.
      const start = [TOWER_HP, TOWER_HP - 2 * gain, TOWER_HP - 2 * gain + gain / 2];
      start.forEach((hp, lane) => setLaneHp(state, lane, hp));
      const after = botPlan(state, 1);
      // Reihenfolge der Wahl: Lane 1, dann Lane 2, dann wieder die dann schwächste.
      const hp = [0, 1, 2].map((lane) => laneHp(after, lane));
      expect(hp.reduce((a, b) => a + b, 0)).toBe(start.reduce((a, b) => a + b, 0) + 3 * gain);
      expect(hp[1]).toBeGreaterThan(start[1]!);
      expect(hp[2]).toBeGreaterThan(start[2]!);
      expect(after.players[1].hand).toEqual([]);
    });

    it('spielt bei leerer Hand nichts, terminiert und setzt ready', () => {
      const state = withHand([], MAX_ENERGY);
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
      expect(after.players[1].level).toBe(START_FORTRESSES + 1);
    });
  });

  describe('Lane-Wahl', () => {
    it('summon: wählt die Lane mit den wenigsten Minions', () => {
      const state = grow(withHand(['summon-minion'], cost('summon-minion')), 2);
      addMinions(state, 0, 2);
      addMinions(state, 1, 1);
      addMinions(state, 2, 1);
      const after = botPlan(state, 1);
      expect([0, 1, 2].map((line) => minionCount(after, line))).toEqual([2, 2, 1]);
    });

    it('summon: wählt bei gleich vielen Minions die niedrigste Lane', () => {
      const after = botPlan(grow(withHand(['summon-minion'], cost('summon-minion')), 3), 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0]);
    });

    it('summon: nutzt nur freie Lanes, auf Lvl 1 also nur die Start-Lane', () => {
      const state = withHand(handOf('summon-minion', 3), 3 * cost('summon-minion'));
      const after = botPlan(state, 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0, 0, 0]);
      for (const lane of [1, 2, 3, 4]) expect(minionCount(after, lane)).toBe(0);
    });

    it('summon: weicht auf eine freie Lane aus, wenn andere Lanes voll sind', () => {
      const state = grow(withHand(['summon-minion'], cost('summon-minion')), 2);
      const full0 = fillLane(state, 0);
      const full1 = fillLane(state, 1);
      const after = botPlan(state, 1);
      expect(minionCount(after, 2)).toBe(1);
      expect(minionCount(after, 0)).toBe(full0);
      expect(minionCount(after, 1)).toBe(full1);
    });

    it('summon: überspringt eine volle Lane und nimmt bei Gleichstand die niedrigste freie', () => {
      const state = grow(withHand(['summon-minion'], cost('summon-minion')), 2);
      const full0 = fillLane(state, 0);
      addMinions(state, 1, 1);
      addMinions(state, 2, 1);
      const after = botPlan(state, 1);
      expect(minionCount(after, 0)).toBe(full0);
      expect(minionCount(after, 1)).toBe(2);
      expect(minionCount(after, 2)).toBe(1);
    });

    it('summon: setzt auf einen freien Turm-Slot und nie auf einen belegten', () => {
      const state = withHand(handOf('summon-minion', 3), 3 * cost('summon-minion'));
      const after = botPlan(state, 1);
      expect(after.players[1].minions.map((m) => m.slot)).toEqual([0, 1, 2]);
    });

    it('summon: meidet Lanes, deren Tower alle zerstört sind', () => {
      const state = grow(withHand(['summon-minion'], cost('summon-minion')), 2);
      for (const tower of state.players[1].lines[0]!.towers) tower.hp = 0;
      const after = botPlan(state, 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([1]);
    });

    it('summon: lässt die Karte auf der Hand, wenn alle freien Lanes voll sind', () => {
      const energy = cost('summon-minion');
      const state = grow(withHand(['summon-minion'], energy), 2);
      for (const line of [0, 1, 2]) fillLane(state, line);
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['summon-minion']);
      expect(after.players[1].energy).toBe(energy);
      expect(after.players[1].minions).toEqual(state.players[1].minions);
      expect(after.ready[1]).toBe(true);
    });

    it('line-upgrade: spielt die Karte ohne Zielline und hebt nur die Feldstufe (Lanes kauft man separat)', () => {
      const move = botStep(withHand(['line-upgrade'], cost('line-upgrade')), 1);
      expect(move!.cardId).toBe('line-upgrade');
      expect(move!.line).toBeUndefined();
      expect(move!.state.players[1].level).toBe(START_FORTRESSES + 1);
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
      next.players[1].hand = handOf('summon-minion', 3);
      next.players[1].energy = 3 * cost('summon-minion');
      const after = botPlan(next, 1);
      expect(after.players[1].minions.map((m) => m.line)).toEqual([0, 1, 2]);
    });

    it('tower-hp: wählt die Lane mit den wenigsten Tower-Lebenspunkten', () => {
      const state = grow(withHand(['tower-hp'], cost('tower-hp')), 2);
      const gain = CARD_BALANCE['tower-hp'].hp;
      // Lane 1 ist die schwächste, Lane 2 liegt dazwischen, Lane 0 ist heil.
      const start = [TOWER_HP, TOWER_HP - 2 * gain, TOWER_HP - gain];
      start.forEach((hp, lane) => setLaneHp(state, lane, hp));
      const after = botPlan(state, 1);
      expect([0, 1, 2].map((lane) => laneHp(after, lane))).toEqual([start[0], start[1]! + gain, start[2]]);
    });

    it('minion-upgrade-line: wählt die Lane mit dem höchsten bonus.hp', () => {
      const state = grow(withHand(['minion-upgrade-line'], cost('minion-upgrade-line')), 2);
      const gain = CARD_BALANCE['minion-upgrade-line'].hp;
      // Lane 1 hat den höchsten Bonus, Lane 2 einen kleineren, Lane 0 keinen.
      const bonus = [0, 2 * gain, gain];
      bonus.forEach((hp, line) => (state.players[1].lines[line]!.bonus.hp = hp));
      const after = botPlan(state, 1);
      expect(after.players[1].lines.map((line) => line.bonus.hp)).toEqual([0, 2 * gain + gain, gain, 0, 0]);
    });
  });

  describe('buff-minion', () => {
    it('stärkt den lebenden Minion mit dem größten maxHp (bei Gleichstand die kleinste Id) und meldet seine Id', () => {
      const state = withHand(['buff-minion'], cost('buff-minion'));
      addMinions(state, 0, 3);
      const unit = CARD_BALANCE['summon-minion'];
      // Erster Minion am größten, aber tot; die beiden lebenden gleich groß und größer als der Standard.
      const big = unit.hp + 2 * buffGain(unit.hp);
      const biggest = big + unit.hp;
      state.players[1].minions[1]!.maxHp = big;
      state.players[1].minions[2]!.maxHp = big;
      state.players[1].minions[0]!.maxHp = biggest;
      state.players[1].minions[0]!.hp = 0;
      const move = botStep(state, 1);
      expect(move).toMatchObject({ cardId: 'buff-minion', line: undefined, minionId: 101 });
      expect(move!.state.players[1].minions.find((m) => m.id === 101)).toMatchObject({
        maxHp: big + buffGain(big),
        damage: unit.damage + buffGain(unit.damage),
      });
      expect(move!.state.players[1].minions.find((m) => m.id === 102)).toMatchObject({ maxHp: big, damage: unit.damage });
    });

    it('nimmt hp als Größe, wenn ein Minion kein maxHp hat', () => {
      const state = withHand(['buff-minion'], cost('buff-minion'));
      addMinions(state, 0, 2);
      state.players[1].minions[1]!.hp = CARD_BALANCE['summon-minion'].hp + 1;
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
      const unit = CARD_BALANCE['summon-minion'];
      const hp = unit.hp + buffGain(unit.hp);
      expect(after.players[1].minions[0]).toMatchObject({ maxHp: hp, hp, damage: unit.damage + buffGain(unit.damage) });
    });
  });

  describe('Determinismus und Isolation', () => {
    const seeds = [1, 4, 8, 42, 1234];
    const sides: PlayerIndex[] = [0, 1];

    it('liefert für mehrere Seeds und beide Seiten bei gleichem Zustand gleiche Ergebnisse', () => {
      for (const seed of seeds) {
        for (const side of sides) {
          expect(botPlan(startMatch(seed), side)).toEqual(botPlan(startMatch(seed), side));
          const state = startMatch(seed);
          expect(botPlan(state, side)).toEqual(botPlan(state, side));
        }
      }
    });

    it('verändert den übergebenen Eingabezustand nicht', () => {
      for (const seed of seeds) {
        for (const side of sides) {
          const state = startMatch(seed);
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
          const state = startMatch(seed);
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
      const state = withHand(['summon-minion', 'tower-hp', 'minion-upgrade-all'], MAX_ENERGY);
      state.ready[1] = true;
      const after = botPlan(state, 1);
      expect(after.players[1]).toEqual(state.players[1]);
      expect(after.ready[1]).toBe(true);
    });

    it('terminiert, wenn playCard wegen der Phase ablehnt (not-planning)', () => {
      const state = withHand(['summon-minion', 'tower-hp'], MAX_ENERGY);
      state.phase = 'combat';
      const after = botPlan(state, 1);
      expect(after.players[1].hand).toEqual(['summon-minion', 'tower-hp']);
      expect(after.players[1].energy).toBe(MAX_ENERGY);
    });

    it('terminiert, wenn nach einigen Karten keine mehr spielbar ist', () => {
      const energy = 2 * cost('summon-minion');
      expect(energy).toBeLessThan(cost('minion-upgrade-all'));
      const after = botPlan(withHand(['summon-minion', 'summon-minion', 'minion-upgrade-all'], energy), 1);
      expect(after.players[1].hand).toEqual(['minion-upgrade-all']);
      expect(after.players[1].energy).toBe(0);
      expect(after.ready[1]).toBe(true);
    });
  });

  describe('Spezialisierung', () => {
    const hand = ['tower-lightning', 'tower-shield', 'tower-lightning', 'tower-shield', 'tower-lightning'];

    it('spielt sie auf Lanes mit dem höchsten Level zuerst, bei Gleichstand die niedrigste Lane', () => {
      let state = grow(withHand(hand, MAX_ENERGY), MAX_FIELD_LEVEL);
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
      expect(botStep(withHand(hand, MAX_ENERGY), 1)).toBeNull();
      const after = botPlan(withHand(hand, MAX_ENERGY), 1);
      expect(after.players[1].hand).toEqual(hand);
      expect(after.players[1].energy).toBe(MAX_ENERGY);
    });

    it('überspringt Lanes ohne lebenden, unspezialisierten Tower', () => {
      const state = grow(withHand(['tower-shield'], cost('tower-shield')), MAX_FIELD_LEVEL);
      for (const lane of [3, 4, 1]) state.players[1].lines[lane]!.towers[0]!.hp = 0;
      expect(botStep(state, 1)?.line).toBe(2);
    });

    describe('Vorrang vor Beschwörungen', () => {
      const order = ['summon-minion', 'tower-lightning'];

      it('spielt die Spezialisierung zuerst, auch wenn die Beschwörung in der Reihenfolge davor steht', () => {
        const state = grow(withHand(['summon-minion', 'tower-lightning'], cost('summon-minion') + cost('tower-lightning')), 2);
        const first = botStep(state, 1, order);
        expect(first).toMatchObject({ cardId: 'tower-lightning', line: 1 });
        // Die übrige Energie reicht danach noch für die Beschwörung.
        expect(botStep(first!.state, 1, order)).toMatchObject({ cardId: 'summon-minion' });
      });

      it('spielt zuerst die Beschwörung, wenn keine Lane das Mindest-Level hat (kein passendes Ziel)', () => {
        const state = withHand(['tower-lightning', 'summon-minion'], MAX_ENERGY);
        expect(botStep(state, 1, order)).toMatchObject({ cardId: 'summon-minion' });
      });

      it('spielt zuerst die Beschwörung, wenn alle Tower der hohen Lanes schon spezialisiert sind', () => {
        const state = grow(withHand(['tower-shield', 'summon-minion'], MAX_ENERGY), MAX_FIELD_LEVEL);
        for (const lane of [1, 2, 3, 4]) {
          for (const tower of state.players[1].lines[lane]!.towers) tower.specialization = 'lightning';
        }
        expect(botStep(state, 1, ['summon-minion', 'tower-shield'])).toMatchObject({ cardId: 'summon-minion' });
      });

      it('spielt eine Spezialisierung nicht, die nicht in der Reihenfolge steht', () => {
        const state = grow(withHand(['tower-lightning', 'summon-minion'], MAX_ENERGY), 2);
        const after = botPlan(state, 1, ['summon-minion']);
        expect(after.players[1].hand).toEqual(['tower-lightning']);
      });

      it('zieht die Spezialisierung nicht vor, wenn die Energie nicht reicht', () => {
        const energy = cost('summon-minion');
        expect(energy).toBeLessThan(cost('tower-lightning'));
        const state = grow(withHand(['tower-lightning', 'summon-minion'], energy), 2);
        expect(botStep(state, 1, order)).toMatchObject({ cardId: 'summon-minion' });
      });
    });

    it('verursacht nie einen Fehler in playCard', () => {
      for (let seed = 1; seed <= 20; seed += 1) {
        const state = grow(withHand(hand, MAX_ENERGY, seed), START_FORTRESSES + (seed % MAX_FIELD_LEVEL));
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
    expect(move!.state.players[1].level).toBe(START_FORTRESSES + 1);
    expect(move!.state.players[1].energy).toBe(BASE_ENERGY - UPGRADE_COST);
  });

  it('kauft eine Lane (die niedrigste kaufbare) erst ab Feldstufe 2 und mit LANE_COST Energie', () => {
    const level1 = withHand([], MAX_ENERGY);
    // Auf Stufe 1 bleibt nur das Upgrade, bis die Stufe 2 steht; danach folgt der Lane-Kauf.
    const priority = ['buy-lane'];
    expect(stepWith(level1, 1, priority)).toBeNull();
    const level2 = grow(withHand([], MAX_ENERGY), 2);
    for (const lane of [1, 2]) level2.players[1].lines[lane] = { bought: false, towers: [], bonus: { hp: 0, damage: 0 } };
    const first = stepWith(level2, 1, priority);
    expect(first).toMatchObject({ economy: 'buy-lane', line: 1 });
    expect(first!.state.players[1].energy).toBe(MAX_ENERGY - LANE_COST);
    expect(stepWith(first!.state, 1, priority)).toMatchObject({ economy: 'buy-lane', line: 2 });
    const poor = grow(withHand([], LANE_COST - 1), 2);
    poor.players[1].lines[1] = { bought: false, towers: [], bonus: { hp: 0, damage: 0 } };
    expect(stepWith(poor, 1, priority)).toBeNull();
  });

  it('kauft Upgrade und Lane nicht mehr, wenn sich der Preis bis zum Spielende nicht amortisiert', () => {
    const late = withHand([], MAX_ENERGY);
    late.round = MAX_ROUNDS;
    expect(stepWith(late, 1, ['upgrade'])).toBeNull();
    const lateLane = grow(withHand([], MAX_ENERGY), 2);
    lateLane.round = MAX_ROUNDS;
    lateLane.players[1].lines[1] = { bought: false, towers: [], bonus: { hp: 0, damage: 0 } };
    expect(stepWith(lateLane, 1, ['buy-lane'])).toBeNull();
  });

  it('zieht nur als Rückfall, wenn nichts anderes spielbar ist, und lässt 1 Energie übrig', () => {
    const state = withHand(['summon-minion'], BASE_ENERGY);
    expect(stepWith(state, 1, ['draw', 'summon-minion'])).toMatchObject({ cardId: 'summon-minion' });
    // Knapp zu wenig für die Karte, aber mehr als das Ziehen kostet.
    const energy = cost('summon-mage') - 1;
    expect(energy).toBeGreaterThan(DRAW_COST);
    const stuck = withHand(['summon-mage'], energy);
    const drawn = stepWith(stuck, 1, ['draw', 'summon-mage']);
    expect(drawn).toMatchObject({ economy: 'draw' });
    expect(drawn!.state.players[1].hand).toHaveLength(stuck.players[1].hand.length + 1);
    expect(drawn!.state.players[1].energy).toBe(energy - DRAW_COST);
    // Danach bleibt nichts zum Spielen übrig: der Bot zieht nicht mehr.
    expect(drawn!.state.players[1].energy).toBeLessThan(cost('summon-mage'));
    expect(stepWith(drawn!.state, 1, ['draw', 'summon-mage'])).toBeNull();
  });

  it('zieht nicht über das Handlimit hinaus und nicht, wenn „draw“ fehlt', () => {
    const full = withHand(fullHand('summon-mage'), MAX_ENERGY);
    expect(stepWith(full, 1, ['draw'])).toBeNull();
    expect(stepWith(withHand([], MAX_ENERGY), 1, ['upgrade'])).toMatchObject({ economy: 'upgrade' });
    expect(stepWith(withHand([], cost('summon-minion')), 1, ['summon-minion'])).toBeNull();
  });

  it('endet mit jeder Reihenfolge, auch wenn Ziehen und Abwerfen einander abwechseln könnten', () => {
    const order = ['draw', 'summon-guard', 'upgrade', 'buy-lane'];
    const state = withHand(['summon-minion', 'summon-minion', 'summon-guard'], BASE_ENERGY);
    const after = economyPlan(state, order);
    expect(after.ready[1]).toBe(true);
    expect(after.players[1].energy).toBeGreaterThanOrEqual(0);
  });

  it('plant mit der Standardreihenfolge ein ganzes Match ohne Fehler und wächst mit dem Einkommen', () => {
    let state = startMatch(3);
    state = economyPlan(state);
    expect(state.players[1].level).toBeGreaterThanOrEqual(START_FORTRESSES + 1);
    expect(state.players[1].energy).toBeLessThanOrEqual(MAX_ENERGY);
  });
});

describe('Eine Karte pro Runde', () => {
  it('spielt höchstens eine Karte aus der Hand und meldet sich danach bereit', () => {
    const state = withHand(['summon-minion', 'summon-minion', 'tower-hp'], MAX_ENERGY);
    let current = state;
    let played = 0;
    for (let move = stepWith(current, 1); move; move = stepWith(current, 1)) {
      if (move.cardId !== '' && !move.discard) played += 1;
      current = move.state;
    }
    expect(played).toBe(CARDS_PER_ROUND);
    expect(current.players[1].cardsPlayed).toBe(CARDS_PER_ROUND);
    expect(botPlan(state, 1).ready[1]).toBe(true);
  });

  it('zieht keine Karte mehr, wenn die Karte der Runde schon gespielt ist', () => {
    const state = withHand(['summon-minion', 'summon-mage'], MAX_ENERGY);
    const first = stepWith(state, 1, ['summon-minion', 'draw'])!;
    expect(first.cardId).toBe('summon-minion');
    expect(stepWith(first.state, 1, ['summon-minion', 'draw'])).toBeNull();
  });
});
