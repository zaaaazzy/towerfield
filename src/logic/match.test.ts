import { describe, expect, it } from 'vitest';
import { botPlan } from './bot';
import { getCardDef } from './cards';
import {
  advance,
  BASE_ENERGY,
  boughtLaneCount,
  buyLane,
  COMBAT_TICKS,
  createMatch,
  destroyedOutcome,
  DISCARD_ENERGY,
  discardCard,
  DRAW_COST,
  DRAW_PER_ROUND,
  drawCard,
  energyForRound,
  HAND_LIMIT,
  hpOutcome,
  incomeForRound,
  createLaneTowers,
  LANE_COST,
  laneSlotCounts,
  LINE_COUNT,
  MAX_ENERGY,
  MAX_ROUNDS,
  type MatchState,
  moveMinion,
  type PlayerIndex,
  playCard,
  respawnSurvivors,
  roundEnergy,
  setReady,
  SPECIALIZE_MIN_LEVEL,
  specializeTarget,
  START_HAND,
  TOWER_HP,
  undoSummon,
  UPGRADE_COST,
  upgradeField,
} from './match';
import {
  effectiveRange,
  LANE_BUFF_FACTOR,
  LANE_SHIELD_FACTOR,
  LINE_LENGTH,
  MINION_RANGE,
  TICK_MS,
  TICK_SECONDS,
  towersAlive,
} from './combat';
import { deriveEventSeed, EARLY_RESPAWN_TICKS, pickRoundEvent, type RoundEventId, TOWER_SHIELD } from './round-events';
import { isLaneBuyable, LANE_COUNT, MAX_FIELD_LEVEL } from './lanes';
import { isSlotFree, validSlots } from './placement';

/** Minion, der steht und nichts trifft: hält die Kampfphase am Leben, ohne den Ausgang zu ändern. */
function idleMinion(id: number): MatchState['players'][0]['minions'][0] {
  return { id, line: 0, position: 0, slot: 0, hp: 30, maxHp: 30, damage: 0, range: 0, speed: 0 };
}

/** Zustand in Runde `round`, Spieler 0 hat `summon-archer` auf Hand 0 und genug Energie. */
function archerState(round: number): MatchState {
  const state = createMatch(3);
  state.round = round;
  state.players[0].hand = ['summon-archer'];
  state.players[0].energy = 8;
  return state;
}

describe('Runde endet bei toten Einheiten', () => {
  it('beginnt im selben Tick die nächste Runde, wenn keine Minions leben', () => {
    const state = advance(setReady(setReady(createMatch(3), 0), 1), TICK_MS);
    expect(state.phase).toBe('planning');
    expect(state.round).toBe(2);
    expect(state.combatTicks).toBe(0);
  });

  it('läuft weiter, solange ein Minion lebt', () => {
    const start = createMatch(3);
    start.players[1].minions.push(idleMinion(1));
    const state = advance(setReady(setReady(start, 0), 1), 10 * TICK_MS);
    expect(state.phase).toBe('combat');
    expect(state.combatTicks).toBe(10);
  });

  it('zählt nur Minions mit hp > 0', () => {
    const start = createMatch(3);
    start.players[0].minions.push({ ...idleMinion(1), hp: 0 });
    const state = advance(setReady(setReady(start, 0), 1), TICK_MS);
    expect(state.round).toBe(2);
  });

  it('endet in der letzten Runde per hpOutcome', () => {
    const start = createMatch(3);
    start.round = MAX_ROUNDS;
    start.players[1].lines[0]!.towers[0]!.hp -= 5;
    const state = advance(setReady(setReady(start, 0), 1), TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe(hpOutcome(state));
    expect(state.outcome).toBe('player0');
  });

  it('lässt zerstörte Tower vor dem Rundenwechsel gewinnen', () => {
    const start = createMatch(3);
    for (const line of start.players[1].lines) for (const tower of line.towers) tower.hp = 0;
    const state = advance(setReady(setReady(start, 0), 1), TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('player0');
  });
});

describe('Bogenschützen wachsen mit der Runde', () => {
  it('beschwört in Runde 1 einen und in Runde 3 drei Bogenschützen für eine Karte', () => {
    const one = playCard(archerState(1), 0, 0, 0);
    const three = playCard(archerState(3), 0, 0, 0);
    expect(one.ok && one.state.players[0].minions).toHaveLength(1);
    if (!three.ok) throw new Error('abgelehnt');
    const player = three.state.players[0];
    expect(player.minions).toHaveLength(3);
    expect(new Set(player.minions.map((m) => m.slot)).size).toBe(3);
    expect(player.energy).toBe(8 - getCardDef('summon-archer').cost);
    expect(player.hand).toEqual([]);
    expect(player.played).toHaveLength(1);
  });

  it('beginnt bei gewünschtem Slot dort und füllt mit den niedrigsten freien auf', () => {
    const result = playCard(archerState(2), 0, 0, 0, 3);
    if (!result.ok) throw new Error('abgelehnt');
    expect(result.state.players[0].minions.map((m) => m.slot)).toEqual([3, 0]);
  });

  it('begrenzt auf die freien Slots, wenn die Lane nicht für N Einheiten reicht', () => {
    const state = archerState(8);
    const slots = validSlots(state.players[0].lines[0]!.towers);
    expect(slots.length).toBeLessThan(8);
    const result = playCard(state, 0, 0, 0);
    if (!result.ok) throw new Error('abgelehnt');
    expect(result.state.players[0].minions.map((m) => m.slot)).toEqual(slots);
  });

  it('lehnt ab, wenn kein Slot frei ist, und ändert nichts', () => {
    const state = archerState(2);
    const slots = validSlots(state.players[0].lines[0]!.towers);
    slots.forEach((slot, index) => state.players[0].minions.push({ ...idleMinion(index + 1), slot }));
    expect(playCard(state, 0, 0, 0)).toEqual({ ok: false, state, reason: 'line-full' });
  });

  it('belegt nie einen Slot doppelt', () => {
    const state = archerState(2);
    state.players[0].hand = ['summon-archer', 'summon-archer'];
    const first = playCard(state, 0, 0, 0);
    if (!first.ok) throw new Error('abgelehnt');
    const second = playCard(first.state, 0, 0, 0);
    if (second.ok) {
      const slots = second.state.players[0].minions.map((m) => `${m.line}:${m.slot}`);
      expect(new Set(slots).size).toBe(slots.length);
    } else {
      expect(second.reason).toBe('line-full');
    }
  });

  it('nimmt beim Undo alle N Einheiten zurück und erstattet genau einmal', () => {
    const start = archerState(3);
    const played = playCard(start, 0, 0, 0);
    if (!played.ok) throw new Error('abgelehnt');
    const ids = played.state.players[0].minions.map((m) => m.id);
    const undone = undoSummon(played.state, 0, ids[1]!);
    if (!undone.ok) throw new Error('abgelehnt');
    const player = undone.state.players[0];
    expect(player.minions).toEqual([]);
    expect(player.placements).toEqual([]);
    expect(player.played).toEqual([]);
    expect(player.energy).toBe(start.players[0].energy);
    expect(player.hand).toEqual(['summon-archer']);
    expect(undone.state.stats.played['summon-archer']?.[0]).toBe(0);
  });

  it('lässt andere Karten bei einer Einheit', () => {
    const state = createMatch(3);
    state.round = 4;
    state.players[0].hand = ['summon-minion'];
    const result = playCard(state, 0, 0, 0);
    expect(result.ok && result.state.players[0].minions).toHaveLength(1);
  });
});

describe('Runden-Ereignisse', () => {
  function seedWith(event: RoundEventId): number {
    for (let seed = 0; seed < 1000; seed += 1) {
      if (pickRoundEvent(deriveEventSeed(seed), 3).event === event) return seed;
    }
    throw new Error(`Kein Seed mit ${event}`);
  }
  function toRound(seed: number, round: number): MatchState {
    let state = createMatch(seed);
    while (state.round < round) state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    return state;
  }

  it('Energie +1: beide Spieler haben genau 1 mehr als ohne Ereignis, höchstens MAX_ENERGY', () => {
    const state = toRound(seedWith('energy'), 3);
    expect(state.event).toBe('energy');
    for (const player of state.players) expect(player.energy).toBe(energyForRound(3) + 1);
    const player = createMatch(1).players[0];
    expect(roundEnergy(player, 3, null)).toBe(energyForRound(3));
    expect(roundEnergy(player, 3, 'energy')).toBe(energyForRound(3) + 1);
    // Auch mit Ereignis und vollem Ausbau bleibt die Energie höchstens MAX_ENERGY.
    const grown = withLevel(createMatch(1), MAX_FIELD_LEVEL).players[0];
    expect(roundEnergy(grown, MAX_ROUNDS, 'energy')).toBe(MAX_ENERGY);
  });

  it('Runden ohne Ereignis verhalten sich wie bisher', () => {
    const state = toRound(seedWith('energy'), 4);
    expect(state.event).toBeNull();
    expect(state.players[0].energy).toBe(energyForRound(4));
  });

  it('Früher Aufbruch: Überlebende starten in der Kampfphase weiter vorn als ohne Ereignis', () => {
    const base = toRound(seedWith('early-respawn'), 3);
    expect(base.event).toBe('early-respawn');
    const withSurvivor = structuredClone(base);
    withSurvivor.players[0].minions.push({
      id: 50,
      line: 0,
      slot: 0,
      position: 0,
      hp: 30,
      damage: 6,
      range: MINION_RANGE,
      speed: 10,
    });
    const without = structuredClone(withSurvivor);
    without.event = null;
    const early = setReady(setReady(withSurvivor, 0), 1);
    const normal = setReady(setReady(without, 0), 1);
    expect(early.phase).toBe('combat');
    expect(early.players[0].minions[0]!.position).toBe(10 * EARLY_RESPAWN_TICKS * TICK_SECONDS);
    expect(normal.players[0].minions[0]!.position).toBe(0);
  });

  it('Früher Aufbruch: frisch beschworene Minions bekommen keinen Vorsprung und der Weg endet an der Lane', () => {
    const state = toRound(seedWith('early-respawn'), 3);
    state.players[0].minions.push(
      { id: 1, line: 0, slot: 0, position: 0, hp: 30, damage: 6, range: MINION_RANGE, speed: 10 },
      { id: 2, line: 0, position: LINE_LENGTH - 1, hp: 30, damage: 6, range: MINION_RANGE, speed: 10 },
    );
    state.players[0].placements.push({ minionId: 1, cardId: 'x', group: 1 });
    const combat = setReady(setReady(state, 0), 1);
    expect(combat.players[0].minions[0]!.position).toBe(0);
    expect(combat.players[0].minions[1]!.position).toBe(LINE_LENGTH);
  });

  it('Tower-Schild: alle Tower haben den Schild in der Planung und verlieren ihn nach der Kampfphase', () => {
    const state = toRound(seedWith('tower-shield'), 3);
    expect(state.event).toBe('tower-shield');
    const towers = state.players.flatMap((p) => p.lines.flatMap((l) => l.towers));
    expect(towers.length).toBeGreaterThan(0);
    for (const tower of towers) expect(tower.shield).toBe(TOWER_SHIELD);
    const next = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(next.round).toBe(4);
    for (const tower of next.players.flatMap((p) => p.lines.flatMap((l) => l.towers))) {
      expect(tower.shield).toBeUndefined();
    }
  });

  it('Tower-Schild: fällt ein Tower-Satz, ist der Schild am Ende des Matches entfernt', () => {
    const state = toRound(seedWith('tower-shield'), 3);
    for (const line of state.players[1].lines) for (const tower of line.towers) tower.hp = 0;
    const last = state.players[1].lines[0]!.towers[0]!;
    last.hp = 1;
    last.shield = 1;
    state.players[0].minions.push({ id: 1, line: 0, position: 96, hp: 30, damage: 6, range: MINION_RANGE, speed: 10 });
    const done = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(done.phase).toBe('over');
    expect(done.outcome).toBe('player0');
    for (const tower of done.players.flatMap((p) => p.lines.flatMap((l) => l.towers))) {
      expect(tower.shield).toBeUndefined();
    }
  });
});

/** Index der ersten Handkarte mit dieser ID, im Test garantiert vorhanden (sonst Testfehler). */
function find(state: MatchState, player: PlayerIndex, id: string): number {
  const index = state.players[player].hand.indexOf(id);
  if (index < 0) throw new Error(`Karte ${id} nicht auf der Hand`);
  return index;
}

/** Zustand mit einer bestimmten Karte auf der Hand beider Spieler (Hand überschrieben). */
function withHand(state: MatchState, hand: string[], energy = MAX_ENERGY): MatchState {
  const copy = structuredClone(state);
  for (const player of copy.players) {
    player.hand = [...hand];
    player.energy = energy;
  }
  return copy;
}

/** Zustand, in dem beide Spieler das Feld auf `level` ausgebaut haben (mit den Towern der frisch freien Lanes). */
function withLevel(state: MatchState, level: number): MatchState {
  const copy = structuredClone(state);
  for (const player of copy.players) {
    player.level = level;
    player.lines.forEach((lane, index) => {
      if (isLaneBuyable(level, index) && lane.towers.length === 0) {
        lane.bought = true;
        lane.towers = createLaneTowers(index);
      }
    });
  }
  return copy;
}

describe('Statistik', () => {
  const start = () => withLevel(withHand(createMatch(3), ['summon-minion', 'summon-archer', 'summon-minion']), 3);

  it('zählt eine Beschwörung für Karte und Line', () => {
    const result = playCard(start(), 0, 0, 1);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.stats.played['summon-minion']).toEqual([0, 1]);
  });

  it('zieht eine zurückgenommene Beschwörung wieder ab', () => {
    const played = playCard(start(), 0, 0, 1);
    if (!played.ok) throw new Error(played.reason);
    const undone = undoSummon(played.state, 0, played.state.players[0].minions[0]!.id);
    expect(undone.ok).toBe(true);
    expect(undone.state.stats.played['summon-minion']).toEqual([0, 0]);
  });

  it('zählt einen verschobenen Minion auf der neuen Line', () => {
    const played = playCard(start(), 0, 0, 1);
    if (!played.ok) throw new Error(played.reason);
    const moved = moveMinion(played.state, 0, played.state.players[0].minions[0]!.id, 2, 0);
    expect(moved.ok).toBe(true);
    expect(moved.state.stats.played['summon-minion']).toEqual([0, 0, 1]);
  });

  it('erfasst nur den eigenen Spieler', () => {
    const result = playCard(start(), 1, 0, 0);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.stats.played).toEqual({});
  });

  it('ordnet Schaden über Runden hinweg dem Kartentyp zu und deckelt ihn auf die Tower-HP', () => {
    let state = start();
    const played = playCard(state, 0, 0, 0);
    if (!played.ok) throw new Error(played.reason);
    state = setReady(setReady(played.state, 0), 1);
    for (let i = 0; i < COMBAT_TICKS * 3 && state.phase !== 'over'; i += 1) {
      state = advance(state, TICK_MS);
      if (state.phase === 'planning') state = setReady(setReady(state, 0), 1);
    }
    expect(state.round).toBeGreaterThan(1);
    const damage = state.stats.damage['summon-minion']!;
    expect(damage.towerDamage).toBeGreaterThan(0);
    const startLaneHp = state.players[1].lines[0]!.towers.reduce((sum, tower) => sum + tower.maxHp, 0);
    expect(damage.towerDamage).toBeLessThanOrEqual(startLaneHp + 1e-6);
    expect(Object.keys(state.stats.damage)).toEqual(['summon-minion']);
  });

  it('liefert bei gleichem Seed und gleichen Aktionen identische Statistik', () => {
    const run = () => {
      const state = playMatch(5, TICK_MS, 'bot');
      return state.stats;
    };
    expect(run()).toEqual(run());
  });
});

/** Spielt ein ganzes Match; Spieler 0 per `human`, Spieler 1 als Bot. Schrittgröße in Millisekunden. */
function playMatch(seed: number, stepMs: number, human: 'bot' | 'pass'): MatchState {
  let state = createMatch(seed);
  let guard = 0;
  while (state.phase !== 'over' && guard < 1_000_000) {
    guard += 1;
    if (state.phase === 'planning') {
      state = botPlan(state, 1);
      state = human === 'bot' ? botPlan(state, 0) : setReady(state, 0);
    } else {
      state = advance(state, stepMs);
    }
  }
  return state;
}

describe('Spielstart', () => {
  it('hat für beide Spieler genau eine freie Lane (die Start-Lane) mit drei Towern, die übrigen Lanes sind leer', () => {
    const state = createMatch(42);
    for (const player of state.players) {
      expect(player.level).toBe(1);
      expect(player.lines).toHaveLength(LINE_COUNT);
      expect(LINE_COUNT).toBe(5);
      expect(player.lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
      expect(player.lines[0]!.towers.map((tower) => tower.offset)).toEqual([0, 8, 16]);
      for (const tower of player.lines[0]!.towers) expect(tower.hp).toBe(TOWER_HP);
    }
  });

  it('zählt zu Spielbeginn drei lebende Tower je Spieler', () => {
    const state = createMatch(42);
    expect(towersAlive(state.players[0])).toBe(3);
    expect(towersAlive(state.players[1])).toBe(3);
  });

  it('gibt beiden Spielern exakt START_HAND identische Karten und gleiche Energie', () => {
    const state = createMatch(42);
    expect(state.players[0].hand).toHaveLength(START_HAND);
    expect(START_HAND).toBe(5);
    expect(DRAW_PER_ROUND).toBe(3);
    expect(state.deck).toHaveLength(START_HAND + DRAW_PER_ROUND * (MAX_ROUNDS - 1));
    expect(state.deck).toHaveLength(26);
    expect(state.players[1].hand).toEqual(state.players[0].hand);
    expect(state.players[0].energy).toBe(BASE_ENERGY);
    expect(state.players[1].energy).toBe(BASE_ENERGY);
    expect(state.phase).toBe('planning');
    expect(state.round).toBe(1);
  });

  it('zieht mit demselben Seed dieselbe Hand', () => {
    expect(createMatch(9).players[0].hand).toEqual(createMatch(9).players[0].hand);
  });

  it('beginnt das Spiel nach dem Bereit beider Spieler mit der Kampfphase', () => {
    let state = createMatch(1);
    state = setReady(state, 0);
    expect(state.phase).toBe('planning');
    state = setReady(state, 1);
    expect(state.phase).toBe('combat');
  });
});

describe('Runden und Ziehen', () => {
  it('zieht zu Beginn jeder weiteren Runde DRAW_PER_ROUND identische Karten pro Spieler und erhöht die Energie gleich', () => {
    let state = createMatch(3);
    // Alle Karten ausspielen, damit das Handlimit nicht mitspielt: Hand direkt leeren.
    state = structuredClone(state);
    state.players[0].hand = [];
    state.players[1].hand = [];
    const expected = state.deck.slice(state.drawn, state.drawn + DRAW_PER_ROUND);
    state = setReady(setReady(state, 0), 1);
    state = advance(state, COMBAT_TICKS * TICK_MS);
    expect(state.round).toBe(2);
    expect(state.phase).toBe('planning');
    expect(state.players[0].hand).toEqual(expected);
    expect(state.players[1].hand).toEqual(expected);
    expect(state.players[0].hand).toHaveLength(DRAW_PER_ROUND);
    expect(state.players[0].energy).toBe(energyForRound(2));
    expect(state.players[1].energy).toBe(energyForRound(2));
    expect(energyForRound(2)).toBeGreaterThan(energyForRound(1));
  });

  it('lässt in Runde 2 noch keine Karte über dem Handlimit verfallen', () => {
    let state = createMatch(3);
    expect(state.players[0].hand).toHaveLength(START_HAND);
    state = setReady(setReady(state, 0), 1);
    state = advance(state, COMBAT_TICKS * TICK_MS);
    expect(state.round).toBe(2);
    expect(state.players[0].hand).toHaveLength(8);
    expect(state.players[1].hand).toHaveLength(8);
    expect(state.drawn).toBe(START_HAND + DRAW_PER_ROUND);
  });

  it('kürzt die Hand in Runde 3 auf das Handlimit', () => {
    let state = createMatch(3);
    for (let i = 0; i < 2; i += 1) {
      state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    }
    expect(state.round).toBe(3);
    expect(state.drawn).toBe(START_HAND + 2 * DRAW_PER_ROUND);
    expect(state.players[0].hand).toHaveLength(HAND_LIMIT);
    expect(state.players[1].hand).toHaveLength(HAND_LIMIT);
  });

  it('wächst das Einkommen je Runde um 1, ohne Deckel', () => {
    expect([1, 2, 3, 4, 5, 6].map(energyForRound)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(energyForRound(100)).toBe(102);
  });

  it('legt MAX_ENERGY so, dass es das höchste Einkommen nicht abschneidet', () => {
    // Letzte Runde, voll ausgebaut (Feldstufe und alle Lanes) plus Energieschub: 3 + 7 + 2 + 4 + 1.
    expect(MAX_ENERGY).toBe(17);
    const income = incomeForRound(MAX_ROUNDS, MAX_FIELD_LEVEL, LANE_COUNT);
    expect(income + 1).toBe(MAX_ENERGY);
  });

  it('gibt in keiner Runde eines Matches mehr als MAX_ENERGY Energie', () => {
    let state = createMatch(3);
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      expect(state.round).toBe(round);
      for (const player of state.players) expect(player.energy).toBeLessThanOrEqual(MAX_ENERGY);
      state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
      if (state.phase === 'over') break;
    }
  });

  it('beendet die Kampfphase erst nach der Rundendauer', () => {
    let state = createMatch(3);
    // Ein untätiger Minion hält die Kampfphase am Leben (ohne Minions endet sie sofort).
    state.players[0].minions.push(idleMinion(1));
    state = setReady(setReady(state, 0), 1);
    state = advance(state, (COMBAT_TICKS - 2) * TICK_MS);
    expect(state.phase).toBe('combat');
    expect(state.round).toBe(1);
  });
});

describe('Handlimit', () => {
  /** Beendet die laufende Kampfphase und beginnt die nächste Runde. */
  function nextRound(state: MatchState): MatchState {
    return advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
  }

  /** Zustand mit `count` Handkarten für Spieler `player` (die ersten Deckkarten), der andere bleibt unverändert. */
  function withPlayerHand(state: MatchState, player: PlayerIndex, count: number): MatchState {
    const copy = structuredClone(state);
    copy.players[player].hand = copy.deck.slice(0, count);
    return copy;
  }

  it('lässt in Runde 1 mit den Startkarten nichts verfallen', () => {
    const state = createMatch(3);
    expect(START_HAND).toBeLessThan(HAND_LIMIT);
    expect(state.players[0].hand).toEqual(state.deck.slice(0, START_HAND));
    expect(state.players[1].hand).toEqual(state.deck.slice(0, START_HAND));
  });

  it('gibt beiden Spielern in Runde 2 alle Karten ohne Verfall', () => {
    const initial = createMatch(3);
    const state = nextRound(initial);
    expect(state.round).toBe(2);
    const arrived = initial.deck.slice(0, START_HAND + DRAW_PER_ROUND);
    expect(state.players[0].hand).toEqual(arrived);
    expect(state.players[1].hand).toEqual(arrived);
  });

  it('behält in Runde 3 die ersten 10 Karten in Ankunftsreihenfolge und lässt die letzte verfallen', () => {
    const initial = createMatch(3);
    const state = nextRound(nextRound(initial));
    expect(state.round).toBe(3);
    const arrived = initial.deck.slice(0, START_HAND + 2 * DRAW_PER_ROUND);
    expect(state.players[0].hand).toEqual(arrived.slice(0, HAND_LIMIT));
    expect(state.players[1].hand).toEqual(arrived.slice(0, HAND_LIMIT));
    expect(arrived.slice(HAND_LIMIT)).toHaveLength(START_HAND + 2 * DRAW_PER_ROUND - HAND_LIMIT);
  });

  it('lässt bei genau HAND_LIMIT nach dem Ziehen (7 + 3) nichts verfallen', () => {
    const initial = withPlayerHand(withPlayerHand(createMatch(3), 0, HAND_LIMIT - DRAW_PER_ROUND), 1, HAND_LIMIT - DRAW_PER_ROUND);
    const state = nextRound(initial);
    const drawn = initial.deck.slice(initial.drawn, initial.drawn + DRAW_PER_ROUND);
    expect(state.players[0].hand).toEqual([...initial.players[0].hand, ...drawn]);
    expect(state.players[0].hand).toHaveLength(HAND_LIMIT);
  });

  it('nimmt unter dem Limit alle neuen Karten auf die Hand', () => {
    const initial = withPlayerHand(createMatch(3), 0, 2);
    const state = nextRound(initial);
    const drawn = initial.deck.slice(initial.drawn, initial.drawn + DRAW_PER_ROUND);
    expect(state.players[0].hand).toEqual([...initial.players[0].hand, ...drawn]);
    expect(state.players[0].hand).toHaveLength(2 + DRAW_PER_ROUND);
  });

  it('zählt verfallene Karten als gezogen, die nächste Runde zieht die nächsten Deckkarten', () => {
    const initial = createMatch(3);
    const round2 = nextRound(initial);
    expect(round2.drawn).toBe(START_HAND + DRAW_PER_ROUND);
    const next = initial.deck.slice(round2.drawn, round2.drawn + DRAW_PER_ROUND);
    // Hand leeren, damit die gezogenen Karten der nächsten Runde direkt sichtbar sind.
    const cleared = structuredClone(round2);
    cleared.players[0].hand = [];
    cleared.players[1].hand = [];
    const round3 = nextRound(cleared);
    expect(round3.drawn).toBe(START_HAND + 2 * DRAW_PER_ROUND);
    expect(round3.players[0].hand).toEqual(next);
  });

  it('wendet das Limit pro Spieler an: wer weniger Karten hat, wird nicht gekappt', () => {
    const initial = withPlayerHand(withPlayerHand(createMatch(3), 0, 3), 1, HAND_LIMIT);
    const state = nextRound(initial);
    expect(state.players[0].hand).toHaveLength(3 + DRAW_PER_ROUND);
    expect(state.players[1].hand).toHaveLength(HAND_LIMIT);
    expect(state.players[0].hand.length).toBeLessThan(state.players[1].hand.length);
  });

  it('überschreitet über alle Runden bis MAX_ROUNDS nie das Limit', () => {
    let state = createMatch(5);
    while (state.round < MAX_ROUNDS) {
      state = nextRound(state);
      for (const player of state.players) expect(player.hand.length).toBeLessThanOrEqual(HAND_LIMIT);
    }
    expect(state.round).toBe(MAX_ROUNDS);
    expect(state.players[0].hand).toHaveLength(HAND_LIMIT);
  });

  it('ergibt mit gleichem Seed dieselbe Hand nach dem Verfall', () => {
    expect(nextRound(createMatch(11)).players[0].hand).toEqual(nextRound(createMatch(11)).players[0].hand);
  });
});

describe('Karten ausspielen', () => {
  it('lehnt eine Karte ohne ausreichende Energie ab und ändert den Zustand nicht', () => {
    const state = withHand(createMatch(1), ['summon-brute'], 1);
    const before = structuredClone(state);
    const result = playCard(state, 0, 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-enough-energy');
    expect(result.state).toBe(state);
    expect(state).toEqual(before);
  });

  it('lehnt unbekannte Handindizes, fehlende Line und falsche Phase ab', () => {
    const state = withHand(createMatch(1), ['summon-minion']);
    expect(playCard(state, 0, 5, 0)).toMatchObject({ ok: false, reason: 'no-such-card' });
    expect(playCard(state, 0, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(state, 0, 0, 3)).toMatchObject({ ok: false, reason: 'invalid-line' });
    const combat = setReady(setReady(state, 0), 1);
    expect(playCard(combat, 0, 0, 0)).toMatchObject({ ok: false, reason: 'not-planning' });
  });

  it('lehnt Karten ab, wenn der Spieler schon bereit ist', () => {
    const state = setReady(withHand(createMatch(1), ['summon-minion']), 0);
    expect(playCard(state, 0, 0, 0)).toMatchObject({ ok: false, reason: 'already-ready' });
  });

  it('hebt mit der Karte „Lane ausbauen“ nur die Feldstufe, Lanes kauft man mit buyLane', () => {
    const state = withHand(createMatch(1), ['line-upgrade', 'summon-minion']);
    const result = playCard(state, 0, 0);
    expect(result.ok).toBe(true);
    const player = result.state.players[0];
    expect(player.level).toBe(2);
    expect(player.lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
    expect(player.hand).toEqual(['summon-minion']);
    expect(player.energy).toBe(MAX_ENERGY - getCardDef('line-upgrade').cost);
    expect(state.players[0].level).toBe(1);
  });

  it('ignoriert bei „Lane ausbauen“ eine mitgegebene Lane, denn die Karte hat kein Ziel', () => {
    const state = withHand(createMatch(1), ['line-upgrade']);
    const result = playCard(state, 0, 0, 3);
    expect(result.ok).toBe(true);
    expect(result.state.players[0].level).toBe(2);
  });

  it('lässt Beschwörungen nur auf freien Lanes zu', () => {
    const state = withHand(createMatch(1), ['summon-minion', 'summon-minion']);
    expect(playCard(state, 0, 0, 1)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(state, 0, 0, 4)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(state, 0, 0, 0).ok).toBe(true);
    const grown = withLevel(state, 2);
    expect(playCard(grown, 0, 0, 1).ok).toBe(true);
    expect(playCard(grown, 0, 0, 2).ok).toBe(true);
    expect(playCard(grown, 0, 0, 3)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(withLevel(state, 3), 0, 0, 4).ok).toBe(true);
  });

  it('liefert die Slot-Zahlen je Lane: zwei je lebendem Tower, gesperrte Lanes haben keine', () => {
    expect(laneSlotCounts(withLevel(createMatch(1), 1).players[0])).toEqual([6, 0, 0, 0, 0]);
    expect(laneSlotCounts(withLevel(createMatch(1), 2).players[0])).toEqual([6, 2, 2, 0, 0]);
    expect(laneSlotCounts(withLevel(createMatch(1), 3).players[0])).toEqual([6, 2, 2, 2, 2]);
    const hurt = withLevel(createMatch(1), 2);
    hurt.players[0].lines[0]!.towers[2]!.hp = 0;
    hurt.players[0].lines[1]!.towers[0]!.hp = 0;
    expect(laneSlotCounts(hurt.players[0])).toEqual([4, 0, 2, 0, 0]);
  });

  it('baut mit „Tower ausbauen“ Leben oder Schaden eines Towers der gewählten Lane aus', () => {
    const base = withLevel(withHand(createMatch(1), ['tower-hp', 'tower-damage']), 2);
    const hp = playCard(base, 0, 0, 1);
    if (!hp.ok) throw new Error(hp.reason);
    const [single] = hp.state.players[0].lines[1]!.towers;
    expect(single!.hp).toBeGreaterThan(base.players[0].lines[1]!.towers[0]!.hp);
    expect(single!.maxHp).toBe(single!.hp);
    const damage = playCard(base, 0, 1, 1);
    if (!damage.ok) throw new Error(damage.reason);
    expect(damage.state.players[0].lines[1]!.towers[0]!.damage).toBeGreaterThan(base.players[0].lines[1]!.towers[0]!.damage);
    expect(damage.state.players[0].lines[0]!.towers).toEqual(base.players[0].lines[0]!.towers);
  });

  it('verstärkt auf der Start-Lane den lebenden Tower mit den wenigsten Lebenspunkten, sonst den ersten', () => {
    const base = withHand(createMatch(1), ['tower-hp', 'tower-hp']);
    base.players[0].lines[0]!.towers[1]!.hp = 40;
    const hurt = playCard(base, 0, 0, 0);
    if (!hurt.ok) throw new Error(hurt.reason);
    expect(hurt.state.players[0].lines[0]!.towers.map((tower) => tower.hp)).toEqual([TOWER_HP, 70, TOWER_HP]);
    expect(hurt.state.players[0].lines[0]!.towers.map((tower) => tower.maxHp)).toEqual([TOWER_HP, TOWER_HP + 30, TOWER_HP]);
    // Sind alle Tower der Lane zerstört, trifft das Upgrade den ersten.
    const dead = structuredClone(base);
    for (const tower of dead.players[0].lines[0]!.towers) tower.hp = 0;
    const revived = playCard(dead, 0, 0, 0);
    if (!revived.ok) throw new Error(revived.reason);
    expect(revived.state.players[0].lines[0]!.towers.map((tower) => tower.hp)).toEqual([30, 0, 0]);
  });

  it('beschwört ein Minion auf der gewählten Lane und lehnt es bei vollen Turm-Slots ab', () => {
    let state = withLevel(withHand(createMatch(1), Array(3).fill('summon-minion'), 100), 2);
    for (let index = 0; index < 2; index += 1) {
      const result = playCard(state, 0, 0, 1);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    // Lane 1 hat einen Tower, also genau zwei Slots, beide jetzt belegt.
    expect(state.players[0].minions.filter((m) => m.line === 1).map((m) => m.slot)).toEqual([0, 1]);
    expect(state.players[1].minions).toHaveLength(0);
    expect(playCard(state, 0, 0, 1)).toMatchObject({ ok: false, reason: 'line-full' });
    // Eine andere Lane ist frei.
    expect(playCard(state, 0, 0, 0).ok).toBe(true);
  });

  it('wirkt „Minion verbessern“ nur auf später beschworene Minions', () => {
    let state = withHand(createMatch(1), ['summon-minion', 'minion-upgrade-line', 'summon-minion'], 10);
    const first = playCard(state, 0, 0, 0);
    if (!first.ok) throw new Error(first.reason);
    state = first.state;
    const oldMinion = structuredClone(state.players[0].minions[0]!);
    const upgrade = playCard(state, 0, find(state, 0, 'minion-upgrade-line'), 0);
    if (!upgrade.ok) throw new Error(upgrade.reason);
    state = upgrade.state;
    const second = playCard(state, 0, find(state, 0, 'summon-minion'), 0);
    if (!second.ok) throw new Error(second.reason);
    const [older, newer] = second.state.players[0].minions;
    expect(older).toEqual(oldMinion);
    expect(newer!.hp).toBeGreaterThan(older!.hp);
    expect(newer!.damage).toBeGreaterThan(older!.damage);
  });

  it('übernimmt das Tempo der Karte und lässt es durch Upgrades unverändert', () => {
    let state = withHand(createMatch(1), ['summon-brute', 'summon-minion', 'minion-upgrade-all', 'minion-upgrade-line'], 20);
    const brute = playCard(state, 0, find(state, 0, 'summon-brute'), 0);
    if (!brute.ok) throw new Error(brute.reason);
    state = brute.state;
    const minion = playCard(state, 0, find(state, 0, 'summon-minion'), 0);
    if (!minion.ok) throw new Error(minion.reason);
    state = minion.state;
    expect(state.players[0].minions.map((m) => m.speed)).toEqual([8, 10]);
    for (const id of ['minion-upgrade-all', 'minion-upgrade-line']) {
      const upgrade = playCard(state, 0, find(state, 0, id), 0);
      if (!upgrade.ok) throw new Error(upgrade.reason);
      state = upgrade.state;
    }
    expect(state.players[0].minions.map((m) => m.speed)).toEqual([8, 10]);
    state = withHand(state, ['summon-brute'], 20);
    const later = playCard(state, 0, 0, 0);
    if (!later.ok) throw new Error(later.reason);
    expect(later.state.players[0].minions.at(-1)!.speed).toBe(8);
  });

  it('übernimmt die Reichweite der Karte: Bogenschütze 14, Minion und Brocken 4', () => {
    let state = withHand(createMatch(1), ['summon-archer', 'summon-minion', 'summon-brute'], 20);
    for (const id of ['summon-archer', 'summon-minion', 'summon-brute']) {
      const result = playCard(state, 0, find(state, 0, id), 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.players[0].minions.map((m) => m.range)).toEqual([14, 4, 4]);
  });

  it('setzt beim Beschwören maxHp = hp inklusive Line-Bonus und das Heiler-Merkmal nur beim Heiler', () => {
    let state = withHand(createMatch(1), ['minion-upgrade-line', 'summon-healer', 'summon-minion'], 20);
    for (const id of ['minion-upgrade-line', 'summon-healer', 'summon-minion']) {
      const result = playCard(state, 0, find(state, 0, id), 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    const [healer, other] = state.players[0].minions;
    expect(healer!.heals).toBe(true);
    expect(other!.heals).toBeUndefined();
    expect(healer!.maxHp).toBe(healer!.hp);
    expect(healer!.hp).toBe(20 +state.players[0].lines[0]!.bonus.hp);
    expect(other!.maxHp).toBe(other!.hp);
  });

  it('gibt nur dem Zerstörer das Explosions-Merkmal, als eigene Kopie der Kartenwerte', () => {
    let state = withHand(createMatch(1), ['summon-destroyer', 'summon-minion'], 20);
    for (const id of ['summon-destroyer', 'summon-minion']) {
      const result = playCard(state, 0, find(state, 0, id), 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    const [destroyer, other] = state.players[0].minions;
    expect(destroyer!.explodes).toEqual({ radius: 10, damage: 15 });
    expect(destroyer!.explodes).not.toBe((getCardDef('summon-destroyer') as { explodes: object }).explodes);
    expect(destroyer).toMatchObject({ hp: 40, damage: 8, speed: 8, range: 4 });
    expect(destroyer!.heals).toBeUndefined();
    expect(other!.explodes).toBeUndefined();
  });

  it('rechnet den Explosionsschaden in der Statistik dem Zerstörer zu', () => {
    let state = withHand(createMatch(1), ['summon-destroyer'], 20);
    const result = playCard(state, 0, 0, 0);
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
    const destroyer = state.players[0].minions[0]!;
    destroyer.position = 50;
    destroyer.hp = 0.2; // fällt im ersten Tick (Gegner macht 0,3)
    destroyer.maxHp = 0.2;
    state.players[1].minions.push({ id: 900, line: 0, position: 50, hp: 100, damage: 6, range: 4, speed: 0 });
    state.players[1].minions.push({ id: 901, line: 0, position: 42, hp: 100, damage: 0, range: 4, speed: 0 });
    state.phase = 'combat';
    state.ready = [true, true];
    const after = advance(state, 50);
    expect(after.players[0].minions).toHaveLength(0);
    expect(after.players[1].minions.find((m) => m.id === 901)!.hp).toBe(85);
    // Kampfschaden 0,4 an Minion 900 plus Explosion: 15 auf 900 und 15 auf 901.
    expect(after.stats.damage['summon-destroyer']!.minionDamage).toBeCloseTo(0.4 + 30, 6);
    expect(after.stats.damage['summon-destroyer']!.towerDamage).toBe(0);
  });

  it('wirkt „Minion verbessern“ je nach Umfang auf eine oder alle Lanes', () => {
    const base = withLevel(withHand(createMatch(1), ['minion-upgrade-line', 'minion-upgrade-all'], 10), 2);
    const one = playCard(base, 0, 0, 2);
    if (!one.ok) throw new Error(one.reason);
    expect(one.state.players[0].lines.map((l) => l.bonus.hp > 0)).toEqual([false, false, true, false, false]);
    const all = playCard(base, 0, 1);
    if (!all.ok) throw new Error(all.reason);
    expect(all.state.players[0].lines.map((l) => l.bonus.hp > 0)).toEqual([true, true, true, true, true]);
    expect(all.state.players[1].lines.every((l) => l.bonus.hp === 0)).toBe(true);
  });

  it('löst gleichzeitige Züge unabhängig von der Spielerreihenfolge auf', () => {
    const base = withLevel(withHand(createMatch(1), ['summon-minion', 'line-upgrade', 'tower-hp']), 2);
    const run = (order: PlayerIndex[]) => {
      let state = base;
      for (const player of order) {
        for (const [index, line] of [
          [0, 0],
          [0, 1],
          [0, 2],
        ] as const) {
          const result = playCard(state, player, index, line);
          if (!result.ok) throw new Error(result.reason);
          state = result.state;
        }
      }
      return state;
    };
    expect(run([0, 1])).toEqual(run([1, 0]));
  });
});

describe('Karte Minion stärken', () => {
  /** Spieler 0 beschwört zwei Minions (Ids 1 und 2) auf Lane 0 und hält danach `buff-minion` auf der Hand. */
  function withTwoMinions(hand: string[] = ['buff-minion', 'buff-minion', 'buff-minion']): MatchState {
    let state = withHand(createMatch(3), ['summon-minion', 'summon-brute', ...hand], 20);
    for (const index of [0, 0]) {
      const result = playCard(state, 0, index, 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    return state;
  }
  const minionOf = (state: MatchState, id: number, player: PlayerIndex = 0) =>
    state.players[player].minions.find((m) => m.id === id)!;

  it('erhöht maxHp, hp und damage des Ziels um 50 %, zieht Karte und Kosten ab', () => {
    const state = withTwoMinions();
    const before = minionOf(state, 2);
    const result = playCard(state, 0, 0, undefined, undefined, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(minionOf(result.state, 2)).toEqual({
      ...before,
      maxHp: 120,
      hp: 120,
      damage: 18,
    });
    expect(before).toMatchObject({ maxHp: 80, damage: 12 });
    expect(result.state.players[0].energy).toBe(state.players[0].energy - getCardDef('buff-minion').cost);
    expect(result.state.players[0].hand).toEqual(['buff-minion', 'buff-minion']);
    // Der Ausgangszustand bleibt unverändert.
    expect(minionOf(state, 2)).toEqual(before);
  });

  it('ändert weder line.bonus noch andere Minions noch den Gegner', () => {
    const state = withTwoMinions();
    const result = playCard(state, 0, 0, undefined, undefined, 2);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.players[0].lines.map((l) => l.bonus)).toEqual(state.players[0].lines.map((l) => l.bonus));
    expect(minionOf(result.state, 1)).toEqual(minionOf(state, 1));
    expect(result.state.players[1]).toEqual(state.players[1]);
  });

  it('wirkt nicht auf später beschworene Minions derselben Lane', () => {
    let state = withTwoMinions(['buff-minion', 'summon-brute']);
    state = (playCard(state, 0, 0, undefined, undefined, 2) as { state: MatchState }).state;
    const summoned = playCard(state, 0, 0, 0);
    if (!summoned.ok) throw new Error(summoned.reason);
    expect(minionOf(summoned.state, 3)).toMatchObject({ hp: 80, maxHp: 80, damage: 12 });
  });

  it('stapelt mehrere Buffs nacheinander auf die aktuellen Werte, immer gleich', () => {
    const run = () => {
      let state = withTwoMinions();
      for (let count = 0; count < 3; count += 1) {
        const result = playCard(state, 0, 0, undefined, undefined, 1);
        if (!result.ok) throw new Error(result.reason);
        state = result.state;
      }
      return state;
    };
    // Minion 1: 30 LP, 6 Schaden → 45/9 → 68/14 (aufgerundet) → 102/21.
    expect(minionOf(run(), 1)).toMatchObject({ hp: 102, maxHp: 102, damage: 21 });
    expect(run()).toEqual(run());
  });

  it('lehnt fehlendes, unbekanntes, gegnerisches und totes Ziel mit invalid-target ab', () => {
    const state = withTwoMinions();
    state.players[1].minions.push({ id: 50, line: 1, position: 10, hp: 30, maxHp: 30, damage: 6, range: 4, speed: 10 });
    const dead = structuredClone(state);
    minionOf(dead, 1).hp = 0;
    const cases: [MatchState, number | undefined][] = [
      [state, undefined],
      [state, 99],
      [state, 50],
      [dead, 1],
    ];
    for (const [from, target] of cases) {
      const result = playCard(from, 0, 0, undefined, undefined, target);
      expect(result).toEqual({ ok: false, state: from, reason: 'invalid-target' });
    }
  });

  it('lehnt zu wenig Energie, falsche Phase und „Bereit“ mit den bekannten Gründen ab', () => {
    const state = withTwoMinions();
    const poor = structuredClone(state);
    poor.players[0].energy = 1;
    expect(playCard(poor, 0, 0, undefined, undefined, 1)).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    expect(playCard(setReady(state, 0), 0, 0, undefined, undefined, 1)).toMatchObject({
      ok: false,
      reason: 'already-ready',
    });
    const combat = setReady(setReady(state, 0), 1);
    expect(playCard(combat, 0, 0, undefined, undefined, 1)).toMatchObject({ ok: false, reason: 'not-planning' });
    expect(playCard(state, 0, 9, undefined, undefined, 1)).toMatchObject({ ok: false, reason: 'no-such-card' });
  });

  it('bleibt nach dem Kampf erhalten: Überlebende behalten ihre gestärkten Werte', () => {
    const state = withTwoMinions();
    const buffed = playCard(state, 0, 0, undefined, undefined, 2);
    if (!buffed.ok) throw new Error(buffed.reason);
    const survivor = { ...minionOf(buffed.state, 2) };
    const player = structuredClone(buffed.state.players[0]);
    player.minions = [survivor];
    respawnSurvivors(player);
    expect(player.minions[0]).toMatchObject({ id: 2, hp: 120, maxHp: 120, damage: 18 });
  });
});

describe('Sieg', () => {
  /** Alle Tower beider Spieler zerstört, bis auf die mit den angegebenen (Lane, Tower)-Indizes, die 0,1 LP behalten. */
  function lastTowers(state: MatchState, survivors: [number, number][]): void {
    state.players.forEach((player, index) => {
      player.lines.forEach((line, lane) =>
        line.towers.forEach((tower, towerIndex) => {
          const [wantedLane, wantedTower] = survivors[index]!;
          tower.hp = lane === wantedLane && towerIndex === wantedTower ? 0.1 : 0;
        }),
      );
    });
  }
  const attacker = (line: number, position: number) => ({
    id: 1,
    line,
    position,
    hp: 50,
    damage: 20,
    range: MINION_RANGE,
    speed: 10,
  });

  it('lässt den Spieler verlieren, dessen Tower alle zerstört sind', () => {
    const state = createMatch(1);
    for (const line of state.players[0].lines) for (const tower of line.towers) tower.hp = 0;
    expect(destroyedOutcome(state)).toBe('player1');
    const other = createMatch(1);
    for (const line of other.players[1].lines) for (const tower of line.towers) tower.hp = 0;
    expect(destroyedOutcome(other)).toBe('player0');
    const partial = createMatch(1);
    partial.players[0].lines[0]!.towers[0]!.hp = 0;
    expect(destroyedOutcome(partial)).toBeNull();
  });

  it('wertet gleichzeitige Zerstörung aller Tower als Unentschieden', () => {
    let state = setReady(setReady(withLevel(createMatch(1), 2), 0), 1);
    // Letzter Tower: Spieler 0 der vordere der Start-Lane, Spieler 1 der Tower der Lane 1; je ein Minion kurz davor.
    lastTowers(state, [
      [0, 2],
      [1, 0],
    ]);
    state.players[0].minions.push(attacker(1, LINE_LENGTH - MINION_RANGE));
    state.players[1].minions.push(attacker(0, LINE_LENGTH - 16 - MINION_RANGE));
    state = advance(state, TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('draw');
  });

  it('beendet das Spiel mit Sieg, sobald nur ein Spieler keine Tower mehr hat', () => {
    let state = setReady(setReady(withLevel(createMatch(1), 2), 0), 1);
    lastTowers(state, [
      [0, 0],
      [1, 0],
    ]);
    state.players[0].minions.push(attacker(1, LINE_LENGTH - MINION_RANGE));
    state = advance(state, TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('player0');
  });

  it('vergleicht nach der letzten Runde die Tower-Lebenspunkte, bei Gleichstand Unentschieden', () => {
    const state = createMatch(1);
    expect(hpOutcome(state)).toBe('draw');
    state.players[0].lines[0]!.towers[0]!.hp -= 1;
    expect(hpOutcome(state)).toBe('player1');
    state.players[1].lines[0]!.towers[1]!.hp -= 5;
    expect(hpOutcome(state)).toBe('player0');
  });

  it('endet nach der letzten Runde', () => {
    const final = playMatch(11, 1000 / 60, 'pass');
    expect(final.phase).toBe('over');
    expect(final.outcome).not.toBeNull();
    expect(final.round).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it('ändert nach Spielende nichts mehr', () => {
    const final = playMatch(11, 1000 / 60, 'pass');
    expect(advance(final, 1000)).toBe(final);
    expect(playCard(final, 0, 0, 0).ok).toBe(false);
  });
});

describe('Tower-Spezialisierung', () => {
  const lightning = ['tower-lightning'];

  it('hält SPECIALIZE_MIN_LEVEL im Bereich der Ausbaustufen', () => {
    expect(SPECIALIZE_MIN_LEVEL).toBeGreaterThanOrEqual(1);
    expect(SPECIALIZE_MIN_LEVEL).toBeLessThanOrEqual(MAX_FIELD_LEVEL);
  });

  it('setzt den Pfad der Karte, zieht die Kosten ab und entfernt die Karte aus der Hand', () => {
    for (const [cardId, path] of [['tower-lightning', 'lightning'], ['tower-shield', 'shield']] as const) {
      const state = withLevel(withHand(createMatch(1), [cardId, 'summon-minion']), 2);
      const result = playCard(state, 0, 0, 1);
      expect(result.ok).toBe(true);
      const player = result.state.players[0];
      expect(player.lines[1]!.towers[0]!.specialization).toBe(path);
      expect(player.energy).toBe(MAX_ENERGY - getCardDef(cardId).cost);
      expect(player.hand).toEqual(['summon-minion']);
      // Der alte Zustand und der Gegner bleiben unberührt.
      expect(state.players[0].lines[1]!.towers[0]!.specialization).toBeUndefined();
      expect(result.state.players[1].lines[1]!.towers[0]!.specialization).toBeUndefined();
    }
  });

  it('lehnt eine Lane unter SPECIALIZE_MIN_LEVEL mit level-too-low ab und lässt den Zustand unverändert', () => {
    const state = withLevel(withHand(createMatch(1), lightning), 3);
    const result = playCard(state, 0, 0, 0);
    expect(result).toEqual({ ok: false, state, reason: 'level-too-low' });
    expect(result.state).toBe(state);
    expect(state.players[0].energy).toBe(MAX_ENERGY);
  });

  it('lehnt einen bereits spezialisierten Tower mit already-specialized ab, ohne Energie abzuziehen', () => {
    const first = playCard(withLevel(withHand(createMatch(1), ['tower-lightning', 'tower-shield']), 2), 0, 0, 1);
    expect(first.ok).toBe(true);
    const second = playCard(first.state, 0, 0, 1);
    expect(second).toEqual({ ok: false, state: first.state, reason: 'already-specialized' });
    expect(second.state).toBe(first.state);
    // Eine andere Lane bleibt frei.
    expect(playCard(first.state, 0, 0, 2).ok).toBe(true);
  });

  it('liefert weiter invalid-line und not-enough-energy', () => {
    const state = withLevel(withHand(createMatch(1), lightning), 2);
    const reasonOf = (result: ReturnType<typeof playCard>) => (result.ok ? null : result.reason);
    expect(reasonOf(playCard(state, 0, 0))).toBe('invalid-line');
    expect(reasonOf(playCard(state, 0, 0, 3))).toBe('invalid-line');
    const poor = withLevel(withHand(createMatch(1), lightning, 1), 2);
    expect(reasonOf(playCard(poor, 0, 0, 1))).toBe('not-enough-energy');
  });

  it('bleibt über Runden, Klonen und den Gegner-Kampf erhalten', () => {
    const played = playCard(withLevel(withHand(createMatch(1), lightning), 2), 0, 0, 1);
    const ready = setReady(setReady(played.state, 0), 1);
    const next = advance(ready, COMBAT_TICKS * TICK_MS);
    expect(next.round).toBe(2);
    expect(next.players[0].lines[1]!.towers[0]!.specialization).toBe('lightning');
    expect(structuredClone(next).players[0].lines[1]!.towers[0]!.specialization).toBe('lightning');
    expect(JSON.parse(JSON.stringify(next)).players[0].lines[1]!.towers[0].specialization).toBe('lightning');
  });

  describe('specializeTarget', () => {
    const tower = (offset: number | undefined, hp = 100, specialization?: 'lightning') => ({
      ...(offset === undefined ? {} : { offset }),
      hp,
      maxHp: 100,
      damage: 8,
      ...(specialization ? { specialization } : {}),
    });

    it('wählt den vordersten lebenden Tower ohne Spezialisierung', () => {
      const towers = [tower(0), tower(8), tower(16)];
      expect(specializeTarget(towers)).toBe(towers[2]);
      towers[2]!.hp = 0;
      expect(specializeTarget(towers)).toBe(towers[1]);
      towers[1]!.specialization = 'lightning';
      expect(specializeTarget(towers)).toBe(towers[0]);
    });

    it('behandelt einen fehlenden Standort als 0', () => {
      const towers = [tower(undefined), tower(0), tower(8)];
      expect(specializeTarget(towers)).toBe(towers[2]);
      expect(specializeTarget([towers[0]!, towers[1]!])).toBe(towers[0]);
      expect(specializeTarget([towers[1]!, towers[0]!])).toBe(towers[1]);
    });

    it('liefert undefined, wenn kein Tower übrig ist', () => {
      expect(specializeTarget([])).toBeUndefined();
      expect(specializeTarget([tower(0, 0), tower(8, 100, 'lightning')])).toBeUndefined();
    });
  });
});

describe('Determinismus', () => {
  it('endet bei gleichem Seed und gleicher Eingabefolge im identischen Zustand', () => {
    expect(playMatch(77, 1000 / 60, 'bot')).toEqual(playMatch(77, 1000 / 60, 'bot'));
  });

  it('liefert bei 30, 60 und 144 FPS dasselbe Ergebnis', () => {
    for (const human of ['bot', 'pass'] as const) {
      const at30 = playMatch(5, 1000 / 30, human);
      expect(playMatch(5, 1000 / 144, human)).toEqual(at30);
      expect(playMatch(5, 1000 / 60, human)).toEqual(at30);
    }
    // Sechs volle Matches: auf den GitHub-Runnern knapp über Vitests Standard von 5 s.
  }, 30_000);

  it('ist symmetrisch: dieselben Entscheidungen führen zu einem Unentschieden', () => {
    for (const seed of [1, 2, 3, 99]) {
      const final = playMatch(seed, 1000 / 60, 'bot');
      expect(final.outcome).toBe('draw');
      expect(final.players[0].lines).toEqual(final.players[1].lines);
    }
  });

  it('gibt dem Bot gegen einen Spieler, der nichts spielt, einen Vorteil', () => {
    expect(playMatch(5, 1000 / 60, 'pass').outcome).toBe('player1');
  });
});

describe('Respawn der Überlebenden', () => {
  const minion = (id: number, line: number, position: number, hp = 20, slot?: number) => ({
    id,
    line,
    ...(slot === undefined ? {} : { slot }),
    position,
    hp,
    maxHp: 30,
    damage: 7,
    range: MINION_RANGE,
    speed: 5,
  });

  function withMinions(minions: ReturnType<typeof minion>[]): MatchState {
    const state = withLevel(createMatch(3), MAX_FIELD_LEVEL);
    state.players[0].minions = minions;
    state.players[0].placements = minions.map((m) => ({ minionId: m.id, cardId: 'summon-minion', group: m.id }));
    return state;
  }

  it('setzt Überlebende auf allen freien Lanes mit unveränderten Werten in die nächste Planung, Tote entfallen', () => {
    // Nur Spieler 0 hat das Feld ausgebaut; der Gegner hat auf diesen Lanes keine Tower, die Überlebenden bleiben heil.
    const state = createMatch(3);
    state.players[0].level = MAX_FIELD_LEVEL;
    state.players[0].lines.forEach((lane, index) => {
      if (lane.towers.length === 0) lane.towers = createLaneTowers(index);
    });
    const survivors = [minion(4, 1, 50, 20, 0), minion(2, 2, 50, 20, 1), minion(7, 4, 50, 20, 0), minion(8, 3, 50, 20, 1)];
    state.players[0].minions = [...survivors, minion(9, 1, 50, 0, 1)];
    const ready = setReady(setReady(state, 0), 1);
    const next = advance(ready, COMBAT_TICKS * TICK_MS);
    expect(next.phase).toBe('planning');
    expect(next.round).toBe(2);
    expect(next.players[0].minions.map((m) => m.id)).toEqual([4, 2, 7, 8]);
    for (const original of survivors) {
      const back = next.players[0].minions.find((m) => m.id === original.id)!;
      expect(back).toEqual({ ...original, position: 0 });
    }
    expect(next.players[0].minions.some((m) => m.id === 9)).toBe(false);
    expect(next.players[0].placements).toEqual([]);
  });

  it('stellt Überlebende auf ihren Turm-Slot zurück: Position des Towers, Slot und Lane bleiben', () => {
    const state = withMinions([minion(5, 0, 40, 20, 3), minion(2, 0, 33, 20, 4), minion(9, 1, 12, 20, 1)]);
    respawnSurvivors(state.players[0]);
    const byId = (id: number) => state.players[0].minions.find((m) => m.id === id)!;
    expect(byId(5)).toMatchObject({ line: 0, slot: 3, position: 8 });
    expect(byId(2)).toMatchObject({ line: 0, slot: 4, position: 16 });
    expect(byId(9)).toMatchObject({ line: 1, slot: 1, position: 0 });
    expect(state.players[0].minions.map((m) => m.id)).toEqual([5, 2, 9]);
  });

  it('lässt Einheiten auf zerstörten Türmen wegfallen', () => {
    const state = withMinions([minion(1, 0, 40, 20, 0), minion(2, 0, 40, 20, 3), minion(3, 0, 40, 20, 5)]);
    state.players[0].lines[0]!.towers[1]!.hp = 0;
    respawnSurvivors(state.players[0]);
    expect(state.players[0].minions.map((m) => m.id)).toEqual([1, 3]);
    // Auf dem zerstörten Tower lässt sich nichts mehr setzen.
    state.players[0].hand = ['summon-minion'];
    state.players[0].energy = 5;
    expect(playCard(state, 0, 0, 0, 3)).toMatchObject({ ok: false, reason: 'invalid-slot' });
  });

  it('weist Minions ohne Slot den ersten freien Slot ihrer Lane zu und entfernt sie, wenn keiner frei ist', () => {
    const state = withMinions([
      minion(1, 0, 40, 20, 0),
      minion(2, 0, 41),
      minion(3, 1, 42),
      ...Array.from({ length: 6 }, (_, i) => minion(10 + i, 2, 43)),
    ]);
    respawnSurvivors(state.players[0]);
    const byId = (id: number) => state.players[0].minions.find((m) => m.id === id);
    expect(byId(1)).toMatchObject({ slot: 0 });
    expect(byId(2)).toMatchObject({ slot: 1, position: 0 });
    expect(byId(3)).toMatchObject({ slot: 0 });
    // Lane 2 hat nur zwei Slots (ein Tower): vier der sechs Einheiten fallen weg.
    expect(state.players[0].minions.filter((m) => m.line === 2).map((m) => m.slot)).toEqual([0, 1]);
  });

  it('entfernt Tote', () => {
    const state = withMinions([minion(1, 2, 45, 20, 0), minion(2, 2, 10, 0, 1)]);
    respawnSurvivors(state.players[0]);
    expect(state.players[0].minions).toEqual([{ ...minion(1, 2, 45, 20, 0), position: 0 }]);
  });

  it('leert in Runde 2 placements und setzt Überlebende beider Spieler auf ihren Slot zurück', () => {
    let state = withMinions([minion(1, 0, 20, 20, 2)]);
    state.players[1].minions = [minion(1, 0, 20, 20, 5)];
    state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(state.round).toBe(2);
    expect(state.players[0].placements).toEqual([]);
    for (const player of state.players) {
      for (const m of player.minions) expect(m.position).toBe(player.lines[m.line]!.towers[Math.floor(m.slot! / 2)]!.offset);
    }
  });

  it('liefert bei gleichem Seed nach Runde 2 identische Positionen', () => {
    const run = () => {
      let state = createMatch(7);
      state = botPlan(botPlan(state, 0), 1);
      state = advance(state, COMBAT_TICKS * TICK_MS);
      return state.players.map((p) => p.minions.map((m) => [m.id, m.line, m.slot, m.position]));
    };
    expect(run()).toEqual(run());
  });

  it('belegt nach Runde 2 in echten Matches keinen Turm-Slot doppelt und nur Slots lebender Tower', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = createMatch(seed);
      state = botPlan(botPlan(state, 0), 1);
      state = advance(state, COMBAT_TICKS * TICK_MS);
      for (const player of state.players) {
        const keys = player.minions.map((m) => `${m.line}:${m.slot}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const m of player.minions) {
          expect(validSlots(player.lines[m.line]!.towers)).toContain(m.slot);
        }
      }
    }
  });

  it('lässt eine Einheit auf dem Turm-Slot jede Runde vom selben Tower aus kämpfen, ohne sie neu zu setzen', () => {
    let state = withMinions([]);
    state.players[0].hand = ['summon-guard'];
    state.players[0].energy = 8;
    state = playCard(state, 0, 0, 0, 4).state;
    const id = state.players[0].minions[0]!.id;
    state.players[1].lines.forEach((lane) => lane.towers.forEach((tower) => (tower.damage = 0)));
    for (let round = 1; round <= 3; round += 1) {
      if (round > 1) expect(state.players[0].minions[0]).toMatchObject({ id, line: 0, slot: 4, position: 16 });
      state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
      expect(state.round).toBe(round + 1);
    }
    expect(state.players[0].minions[0]).toMatchObject({ id, line: 0, slot: 4, position: 16 });
  });

  it('gibt einen freigewordenen Slot nach dem Tod der Einheit wieder frei', () => {
    let state = withMinions([minion(1, 0, 40, 20, 0)]);
    state.players[0].minions[0]!.hp = 0;
    respawnSurvivors(state.players[0]);
    state = structuredClone(state);
    expect(isSlotFree(state.players[0].minions, 0, 0)).toBe(true);
  });
});

describe('Abwerfen gegen Energie', () => {
  it('wirft eine Handkarte ab und gibt dafür DISCARD_ENERGY Energie', () => {
    const state = withHand(createMatch(1), ['summon-brute', 'tower-hp'], 3);
    const result = discardCard(state, 0, 0);
    expect(result.ok).toBe(true);
    expect(result.state.players[0].hand).toEqual(['tower-hp']);
    expect(result.state.players[0].energy).toBe(3 + DISCARD_ENERGY);
    expect(DISCARD_ENERGY).toBe(1);
    // Die Karte ist weg (nicht im Stapel), der Gegner und der Ausgangszustand bleiben unberührt.
    expect(result.state.players[1]).toEqual(state.players[1]);
    expect(state.players[0].hand).toEqual(['summon-brute', 'tower-hp']);
  });

  it('lässt Energie über MAX_ENERGY verfallen', () => {
    const state = withHand(createMatch(1), ['summon-brute'], MAX_ENERGY);
    expect(discardCard(state, 0, 0).state.players[0].energy).toBe(MAX_ENERGY);
    const nearly = withHand(createMatch(1), ['summon-brute'], MAX_ENERGY - 1);
    expect(discardCard(nearly, 0, 0).state.players[0].energy).toBe(MAX_ENERGY);
  });

  it('gilt für jeden Spieler und lehnt unbekannte Karten, falsche Phase und „bereit“ ab', () => {
    const state = withHand(createMatch(1), ['summon-brute'], 2);
    expect(discardCard(state, 1, 0).state.players[1].energy).toBe(3);
    expect(discardCard(state, 0, 4)).toMatchObject({ ok: false, reason: 'no-such-card' });
    expect(discardCard(state, 0, -1)).toMatchObject({ ok: false, reason: 'no-such-card' });
    const ready = setReady(state, 0);
    expect(discardCard(ready, 0, 0)).toMatchObject({ ok: false, reason: 'already-ready' });
    const combat = setReady(setReady(state, 0), 1);
    const rejected = discardCard(combat, 1, 0);
    expect(rejected).toMatchObject({ ok: false, reason: 'not-planning' });
    expect(rejected.state).toBe(combat);
  });

  it('macht eine sonst zu teure Karte spielbar', () => {
    const state = withHand(createMatch(1), ['tower-hp', 'summon-brute'], 1);
    expect(playCard(state, 0, 1, 0)).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    const after = discardCard(state, 0, 0).state;
    expect(playCard(after, 0, 0, 0).ok).toBe(true);
  });
});

describe('Lane-Karten', () => {
  const place = (state: MatchState, hand: string[]) => withHand(state, hand, MAX_ENERGY);

  it('legt eine Lane-Karte in den Lane-Slot der Lane und zieht Energie ab', () => {
    const state = place(createMatch(1), ['lane-buff']);
    const result = playCard(state, 0, 0, 0);
    expect(result.ok).toBe(true);
    const lane = result.state.players[0].lines[0]!;
    expect(lane).toMatchObject({ laneCard: 'lane-buff', laneEffect: 'buff' });
    expect(result.state.players[0].energy).toBe(MAX_ENERGY - getCardDef('lane-buff').cost);
    expect(result.state.players[0].hand).toEqual([]);
    expect(result.state.players[0].played).toEqual([{ cardId: 'lane-buff', line: 0 }]);
    // Nur die gewählte Lane und nur der eigene Spieler tragen die Karte.
    expect(result.state.players[1].lines[0]!.laneEffect).toBeUndefined();
  });

  it('lässt je Lane höchstens eine Lane-Karte zu, aber eine zweite auf einer anderen Lane', () => {
    const state = place(withLevel(createMatch(1), 2), ['lane-buff', 'lane-shield', 'lane-shield']);
    const first = playCard(state, 0, 0, 0);
    if (!first.ok) throw new Error(first.reason);
    const taken = playCard(first.state, 0, 0, 0);
    expect(taken).toMatchObject({ ok: false, reason: 'lane-slot-taken' });
    expect(taken.state).toBe(first.state);
    const other = playCard(first.state, 0, 0, 1);
    expect(other.ok).toBe(true);
    expect(other.state.players[0].lines[1]).toMatchObject({ laneCard: 'lane-shield', laneEffect: 'shield' });
  });

  it('braucht eine freie Lane mit lebendem Tower', () => {
    const state = place(createMatch(1), ['lane-buff']);
    expect(playCard(state, 0, 0, 1)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(state, 0, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
    for (const tower of state.players[0].lines[0]!.towers) tower.hp = 0;
    expect(playCard(state, 0, 0, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
  });

  it('gilt nur für die Runde: die nächste Planung beginnt mit freien Lane-Slots', () => {
    const state = place(createMatch(1), ['lane-buff']);
    const played = playCard(state, 0, 0, 0).state;
    const next = advance(setReady(setReady(played, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(next.round).toBe(2);
    for (const player of next.players) {
      for (const lane of player.lines) expect(lane.laneCard).toBeUndefined();
      for (const lane of player.lines) expect(lane.laneEffect).toBeUndefined();
    }
  });

  it('wirkt im Kampf auf alle Einheiten der Lane (Buff: mehr Schaden, Schild: weniger erlittener Schaden)', () => {
    const run = (effect: 'buff' | 'shield' | null) => {
      let state = withHand(createMatch(1), effect ? [effect === 'buff' ? 'lane-buff' : 'lane-shield'] : [], MAX_ENERGY);
      const attacker = { id: 1, line: 0, slot: 0, position: 50, hp: 1000, damage: 20, range: MINION_RANGE, speed: 0 };
      const victim = { id: 1, line: 0, slot: 0, position: 50, hp: 1000, damage: 0, range: MINION_RANGE, speed: 0 };
      state.players[0].minions.push(attacker);
      state.players[1].minions.push(victim);
      state.players[0].lines[0]!.towers.forEach((tower) => (tower.damage = 0));
      state.players[1].lines[0]!.towers.forEach((tower) => (tower.damage = 0));
      if (effect) {
        // Der Buff liegt auf der Lane des Angreifers (Spieler 0), das Schild auf der des Opfers (Spieler 1).
        const buffed = playCard(state, effect === 'buff' ? 0 : 1, 0, 0);
        if (!buffed.ok) throw new Error(buffed.reason);
        state = buffed.state;
      }
      state = advance(setReady(setReady(state, 0), 1), 1000);
      return 1000 - state.players[1].minions[0]!.hp;
    };
    const base = run(null);
    expect(base).toBeCloseTo(20, 5);
    expect(run('buff')).toBeCloseTo(base * LANE_BUFF_FACTOR, 5);
    expect(run('shield')).toBeCloseTo(base * LANE_SHIELD_FACTOR, 5);
  });
});

/** Hebt das Feld von `player` auf Stufe 2 und kauft die obere und die untere Lane (Lane 1 und 2); wirft bei Fehlern. */
function buyBoth(state: MatchState, player: PlayerIndex): MatchState {
  let current = state;
  for (const step of [
    () => upgradeField(current, player),
    () => buyLane(current, player, 1),
    () => buyLane(current, player, 2),
  ]) {
    const result = step();
    if (!result.ok) throw new Error(result.reason);
    current = result.state;
  }
  return current;
}

describe('Lanes je Spieler', () => {
  it('lässt dem Gegner seine Lanes, wenn der Spieler eine neue Lane kauft', () => {
    const bought = buyBoth(withHand(createMatch(1), [], MAX_ENERGY), 0);
    expect(bought.players[0].level).toBe(2);
    expect(bought.players[0].lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 0, 0]);
    expect(bought.players[1].level).toBe(1);
    expect(bought.players[1].lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
    expect(laneSlotCounts(bought.players[1])).toEqual([6, 0, 0, 0, 0]);
    // Der Gegner kann dort weder beschwören noch eine Lane-Karte legen.
    const enemy = withHand(bought, ['summon-minion', 'lane-buff'], MAX_ENERGY);
    expect(playCard(enemy, 1, 0, 1)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(enemy, 1, 1, 1)).toMatchObject({ ok: false, reason: 'invalid-line' });
  });

  it('schaltet die Lanes des Gegners erst mit seinem eigenen Kauf frei', () => {
    const state = buyBoth(buyBoth(withHand(createMatch(1), [], 100), 0), 1);
    expect(state.players[1].level).toBe(2);
    expect(state.players[1].lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 0, 0]);
    expect(state.players[0].level).toBe(2);
    expect(playCard(withHand(state, ['summon-minion'], MAX_ENERGY), 1, 0, 1).ok).toBe(true);
  });

  it('übersteht Runden: gekaufte Lanes und Feldstufe beider Spieler bleiben getrennt', () => {
    let state = buyBoth(withHand(createMatch(1), [], MAX_ENERGY), 0);
    state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(state.players.map((p) => p.level)).toEqual([2, 1]);
    expect(state.players.map(boughtLaneCount)).toEqual([3, 1]);
    expect(state.players[1].lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
  });
});

describe('Wirtschaft', () => {
  const energyOf = (state: MatchState, player: PlayerIndex = 0) => state.players[player].energy;

  it('startet beide Spieler auf Feldstufe 1 mit einem Turm-Satz und genau einer Lane', () => {
    const state = createMatch(1);
    for (const player of state.players) {
      expect(player.level).toBe(1);
      expect(boughtLaneCount(player)).toBe(1);
      expect(player.lines.map((line) => line.bought)).toEqual([true, false, false, false, false]);
      expect(player.lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
      expect(player.energy).toBe(3);
    }
  });

  it('berechnet das Einkommen als 3 + (Runde − 1) + Festungen + Lanes', () => {
    expect(incomeForRound(1, 1, 1)).toBe(3);
    expect(incomeForRound(2, 1, 1)).toBe(4);
    expect(incomeForRound(2, 2, 1)).toBe(5);
    expect(incomeForRound(2, 2, 2)).toBe(6);
    expect(incomeForRound(5, 3, 5)).toBe(3 + 4 + 2 + 4);
  });

  it('bringt ein Upgrade in Runde 1 ab Runde 2 mit +1 Einkommen', () => {
    const upgraded = upgradeField(createMatch(1), 0);
    if (!upgraded.ok) throw new Error(upgraded.reason);
    expect(energyOf(upgraded.state)).toBe(3 - UPGRADE_COST);
    const next = advance(setReady(setReady(upgraded.state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(next.round).toBe(2);
    expect(energyOf(next, 0)).toBe(energyForRound(2) + 1);
    expect(energyOf(next, 1)).toBe(energyForRound(2));
  });

  it('zählt gekaufte Lanes mit +1 je Lane zum Einkommen', () => {
    const state = buyBoth(withHand(createMatch(1), [], MAX_ENERGY), 0);
    const next = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(energyOf(next, 0)).toBe(incomeForRound(2, 2, 3));
    expect(energyOf(next, 0)).toBe(energyForRound(2) + 1 + 2);
  });

  it('erlaubt das Upgrade in jeder Planungsphase bis zur höchsten Feldstufe, danach max-level', () => {
    let state = withHand(createMatch(1), [], 100);
    for (let level = 1; level < MAX_FIELD_LEVEL; level += 1) {
      const result = upgradeField(state, 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.players[0].level).toBe(MAX_FIELD_LEVEL);
    expect(upgradeField(state, 0)).toMatchObject({ ok: false, reason: 'max-level' });
  });

  it('lehnt ein Upgrade ohne Energie, im Kampf und nach „Bereit“ ab und lässt den Zustand unberührt', () => {
    const poor = withHand(createMatch(1), [], UPGRADE_COST - 1);
    const before = structuredClone(poor);
    expect(upgradeField(poor, 0)).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    expect(poor).toEqual(before);
    expect(upgradeField(setReady(poor, 0), 0)).toMatchObject({ ok: false, reason: 'already-ready' });
    const combat = setReady(setReady(withHand(createMatch(1), [], 9), 0), 1);
    expect(upgradeField(combat, 0)).toMatchObject({ ok: false, reason: 'not-planning' });
  });

  it('wertet das Upgrade für Synergien wie die Karte „Lane ausbauen“', () => {
    const archer = playCard(withHand(createMatch(1), ['summon-archer'], 9), 0, 0, 0);
    if (!archer.ok) throw new Error(archer.reason);
    const upgraded = upgradeField(archer.state, 0);
    if (!upgraded.ok) throw new Error(upgraded.reason);
    expect(upgraded.state.players[0].synergies.map((s) => s.id)).toEqual(['archer-line-upgrade']);
  });

  it('lehnt den Lane-Kauf auf Feldstufe 1 mit level-too-low ab', () => {
    const state = withHand(createMatch(1), [], 100);
    expect(buyLane(state, 0, 1)).toMatchObject({ ok: false, reason: 'level-too-low' });
    expect(buyLane(state, 0, 2)).toMatchObject({ ok: false, reason: 'level-too-low' });
  });

  it('kauft auf Feldstufe 2 die obere und die untere Lane je für 5 Energie, einzeln und beide', () => {
    const upgraded = upgradeField(withHand(createMatch(1), [], 100), 0);
    if (!upgraded.ok) throw new Error(upgraded.reason);
    const base = upgraded.state;
    const upper = buyLane(base, 0, 1);
    if (!upper.ok) throw new Error(upper.reason);
    expect(upper.state.players[0].lines.map((line) => line.bought)).toEqual([true, true, false, false, false]);
    expect(energyOf(upper.state)).toBe(energyOf(base) - LANE_COST);
    expect(upper.state.players[0].lines[1]!.towers).toHaveLength(1);
    const lower = buyLane(base, 0, 2);
    if (!lower.ok) throw new Error(lower.reason);
    expect(lower.state.players[0].lines.map((line) => line.bought)).toEqual([true, false, true, false, false]);
    const both = buyLane(upper.state, 0, 2);
    if (!both.ok) throw new Error(both.reason);
    expect(boughtLaneCount(both.state.players[0])).toBe(3);
    expect(energyOf(both.state)).toBe(energyOf(base) - 2 * LANE_COST);
  });

  it('lehnt Lane-Käufe ohne Energie, doppelt, mit ungültiger Lane und nach „Bereit“ ab', () => {
    const rich = buyBoth(withHand(createMatch(1), [], 100), 0);
    expect(buyLane(rich, 0, 1)).toMatchObject({ ok: false, reason: 'lane-owned' });
    expect(buyLane(rich, 0, 0)).toMatchObject({ ok: false, reason: 'lane-owned' });
    expect(buyLane(rich, 0, 9)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(buyLane(rich, 0, -1)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(buyLane(rich, 0, 1.5)).toMatchObject({ ok: false, reason: 'invalid-line' });
    const upgraded = upgradeField(withHand(createMatch(1), [], 100), 0);
    if (!upgraded.ok) throw new Error(upgraded.reason);
    const poor = withHand(upgraded.state, [], LANE_COST - 1);
    expect(buyLane(poor, 0, 1)).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    expect(buyLane(setReady(poor, 0), 0, 1)).toMatchObject({ ok: false, reason: 'already-ready' });
  });

  it('zieht für 1 Energie eine Karte, beide Spieler sehen dieselbe Karte', () => {
    const state = withHand(createMatch(1), ['summon-minion'], 3);
    const first = drawCard(state, 0);
    if (!first.ok) throw new Error(first.reason);
    expect(first.state.players[0].hand).toHaveLength(2);
    expect(energyOf(first.state)).toBe(3 - DRAW_COST);
    const second = drawCard(first.state, 0);
    if (!second.ok) throw new Error(second.reason);
    expect(second.state.players[0].hand).toHaveLength(3);
    const other = drawCard(state, 1);
    if (!other.ok) throw new Error(other.reason);
    expect(other.state.players[1].hand[1]).toBe(first.state.players[0].hand[1]);
  });

  it('lehnt das Ziehen bei 0 Energie, bei vollem Handlimit und nach „Bereit“ ab', () => {
    expect(drawCard(withHand(createMatch(1), [], 0), 0)).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    const full = withHand(createMatch(1), Array(HAND_LIMIT).fill('summon-minion'), 3);
    expect(drawCard(full, 0)).toMatchObject({ ok: false, reason: 'hand-full' });
    expect(drawCard(setReady(withHand(createMatch(1), [], 3), 0), 0)).toMatchObject({ ok: false, reason: 'already-ready' });
  });

  it('erlaubt in Runde 1 mit den 3 Startenergie drei Stufe-1-Zauber', () => {
    expect(getCardDef('tower-hp').cost).toBe(1);
    expect(energyOf(createMatch(1))).toBe(3);
    let state = withHand(createMatch(1), ['tower-hp', 'tower-hp', 'tower-hp'], 3);
    for (let index = 0; index < 3; index += 1) {
      const result = playCard(state, 0, 0, 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(energyOf(state)).toBe(0);
  });
});

describe('Spielende bei zerstörten Türmen', () => {
  it('beendet das Spiel genau dann, wenn ein Spieler keinen lebenden Tower mehr hat (towersAlive === 0)', () => {
    const state = createMatch(1);
    expect(towersAlive(state.players[0])).toBe(3);
    expect(destroyedOutcome(state)).toBeNull();
    for (const tower of state.players[1].lines[0]!.towers) tower.hp = 0;
    expect(towersAlive(state.players[1])).toBe(0);
    expect(destroyedOutcome(state)).toBe('player0');
    const ending = advance(setReady(setReady(state, 0), 1), TICK_MS);
    expect(ending.phase).toBe('over');
    expect(ending.outcome).toBe('player0');
  });

  it('bietet zerstörte Tower keine Slots mehr an und setzt dort keine Einheiten', () => {
    const state = withHand(createMatch(1), ['summon-minion'], MAX_ENERGY);
    state.players[0].lines[0]!.towers[0]!.hp = 0;
    expect(laneSlotCounts(state.players[0])).toEqual([4, 0, 0, 0, 0]);
    expect(playCard(state, 0, 0, 0, 0)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(playCard(state, 0, 0, 0, 1)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(playCard(state, 0, 0, 0, 2).ok).toBe(true);
    // Ohne Slot nimmt die Karte den ersten freien Slot eines lebenden Towers.
    expect(playCard(state, 0, 0, 0).state.players[0].minions[0]).toMatchObject({ slot: 2, position: 8 });
  });
});

describe('Synergien', () => {
  const archerDef = getCardDef('summon-archer');
  const ARCHER_RANGE = archerDef.type === 'summon' ? (archerDef.range ?? MINION_RANGE) : MINION_RANGE;
  const start = () =>
    withLevel(withHand(createMatch(5), ['summon-archer', 'line-upgrade', 'summon-archer', 'summon-minion', 'summon-minion']), 2);

  /** Spielt die Handkarten mit den IDs der Reihe nach (Ziel-Line nur für Beschwörungen); wirft bei Fehlern. */
  function playAll(state: MatchState, plays: [string, number?][], player: PlayerIndex = 0): MatchState {
    let current = state;
    for (const [id, line] of plays) {
      const result = playCard(current, player, find(current, player, id), line);
      if (!result.ok) throw new Error(result.reason);
      current = result.state;
    }
    return current;
  }

  it('gibt dem Bogenschützen mit Lane +1 range +2, ohne Basiswert oder Line-Bonus zu ändern', () => {
    const state = playAll(start(), [['summon-archer', 0], ['line-upgrade']]);
    const player = state.players[0];
    expect(player.synergies).toMatchObject([{ id: 'archer-line-upgrade', line: 0, modifier: { stat: 'range', amount: 2 } }]);
    expect(player.minions[0]).toMatchObject({ range: ARCHER_RANGE, rangeBonus: 2 });
    expect(player.lines[0]!.bonus).toEqual({ hp: 0, damage: 0 });
  });

  it('wirkt unabhängig von der Reihenfolge der Karten', () => {
    const forward = playAll(start(), [['summon-archer', 0], ['line-upgrade']]);
    const backward = playAll(start(), [['line-upgrade'], ['summon-archer', 0]]);
    expect(backward.players[0].synergies).toEqual(forward.players[0].synergies);
    expect(backward.players[0].minions[0]!.rangeBonus).toBe(2);
  });

  it('wirkt auf später beschworene Minions der Line, nicht auf andere Lines und nicht auf den Gegner', () => {
    let state = playAll(start(), [['summon-archer', 0], ['line-upgrade']]);
    state = playAll(state, [['summon-minion', 0], ['summon-minion', 1]]);
    state = playAll(withHand(state, ['summon-minion'], 5), [['summon-minion', 0]], 1);
    const [first, late, other] = state.players[0].minions;
    expect([first!.rangeBonus, late!.rangeBonus, other!.rangeBonus]).toEqual([2, 2, undefined]);
    expect(state.players[1].synergies).toEqual([]);
    expect(state.players[1].minions[0]!.rangeBonus).toBeUndefined();
  });

  it('stapelt bei einem zweiten Bogenschützen nicht über +2', () => {
    const state = playAll(start(), [['summon-archer', 0], ['line-upgrade'], ['summon-archer', 0]]);
    expect(state.players[0].synergies).toHaveLength(1);
    expect(state.players[0].minions.map((m) => m.rangeBonus)).toEqual([2, 2]);
  });

  it('verändert nach einem fehlgeschlagenen playCard nichts', () => {
    const state = playAll(start(), [['summon-archer', 0]]);
    const broke = structuredClone(state);
    broke.players[0].energy = 0;
    const before = structuredClone(broke);
    const result = playCard(broke, 0, find(broke, 0, 'line-upgrade'));
    expect(result).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    expect(result.state).toEqual(before);
    expect(result.state.players[0].synergies).toEqual([]);
  });

  it('nimmt die Synergie mit zurückgenommenem oder verschobenem Bogenschützen zurück', () => {
    const state = playAll(start(), [['summon-archer', 0], ['line-upgrade']]);
    const id = state.players[0].minions[0]!.id;
    const undone = undoSummon(state, 0, id);
    if (!undone.ok) throw new Error(undone.reason);
    expect(undone.state.players[0].synergies).toEqual([]);
    expect(undone.state.players[0].played.map((p) => p.cardId)).toEqual(['line-upgrade']);
    // Auf Lane 1 hat das Upgrade (ohne Lane-Ziel) ebenfalls Wirkung, der Bonus folgt dem Minion.
    const moved = moveMinion(state, 0, id, 1, 0);
    if (!moved.ok) throw new Error(moved.reason);
    expect(moved.state.players[0].synergies[0]!.line).toBe(1);
    expect(moved.state.players[0].minions[0]!.rangeBonus).toBe(2);
  });

  it('entfernt den Bonus bei startRound auch bei Überlebenden', () => {
    let state = playAll(start(), [['summon-archer', 0], ['line-upgrade']]);
    state.players[0].minions[0]!.hp = 1000;
    state.players[0].minions[0]!.maxHp = 1000;
    state = setReady(setReady(state, 0), 1);
    state = advance(state, COMBAT_TICKS * TICK_MS);
    expect(state.round).toBe(2);
    const player = state.players[0];
    expect(player.minions).toHaveLength(1);
    expect(player.minions[0]).toMatchObject({ range: ARCHER_RANGE });
    expect(player.minions[0]!.rangeBonus).toBeUndefined();
    expect(player.synergies).toEqual([]);
    expect(player.played).toEqual([]);
  });

  it('wirkt im Kampf: Treffer ausserhalb der Basisreichweite, innerhalb von Basis plus 2', () => {
    const setup = (withSynergy: boolean) => {
      let state = playAll(start(), withSynergy ? [['summon-archer', 0], ['line-upgrade']] : [['summon-archer', 0]]);
      state = withHand(state, [], 0);
      const archer = state.players[0].minions[0]!;
      archer.position = 60;
      state.players[1].minions.push({
        id: 99, line: 0, position: LINE_LENGTH - 60 - (ARCHER_RANGE + 1), hp: 50, damage: 0, range: MINION_RANGE, speed: 0,
      });
      return advance(setReady(setReady(state, 0), 1), TICK_MS);
    };
    expect(setup(false).players[1].minions[0]!.hp).toBe(50);
    expect(setup(true).players[1].minions[0]!.hp).toBeLessThan(50);
  });

  it('rechnet die effektive Reichweite als Basis plus Bonus', () => {
    expect(effectiveRange({ id: 1, line: 0, position: 0, hp: 1, damage: 1, range: 10, speed: 1, rangeBonus: 2 })).toBe(12);
  });

  it('ergibt bei gleichem Seed und gleichen Zügen identische Zustände', () => {
    const run = () => {
      let state = createMatch(11);
      for (let round = 0; round < 3; round += 1) {
        state = botPlan(botPlan(state, 0), 1);
        state = advance(state, COMBAT_TICKS * TICK_MS);
      }
      return state;
    };
    expect(run()).toEqual(run());
  });
});
