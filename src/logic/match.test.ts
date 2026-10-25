import { describe, expect, it } from 'vitest';
import { botPlan } from './bot';
import { getCardDef } from './cards';
import {
  advance,
  BASE_ENERGY,
  COMBAT_TICKS,
  createMatch,
  destroyedOutcome,
  DRAW_PER_ROUND,
  energyForRound,
  HAND_LIMIT,
  hpOutcome,
  createLaneTowers,
  laneSlotCounts,
  lineCapacity,
  LINE_COUNT,
  MAX_ENERGY,
  MAX_ROUNDS,
  type MatchState,
  moveMinion,
  type PlayerIndex,
  playCard,
  respawnSurvivors,
  setReady,
  START_HAND,
  TOWER_DAMAGE,
  TOWER_HP,
  undoSummon,
} from './match';
import { LINE_LENGTH, MINION_RANGE, TICK_MS, towersAlive } from './combat';
import { isLaneUnlocked, MAX_FIELD_LEVEL, unlockedLanes } from './lanes';
import { PLACEMENT_ZONE_END, slotPosition } from './placement';

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
      if (isLaneUnlocked(level, index) && lane.towers.length === 0) lane.towers = createLaneTowers(index);
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

  it('begrenzt die Energie auf 8', () => {
    expect(MAX_ENERGY).toBe(8);
    expect([1, 2, 3, 4, 5, 6].map(energyForRound)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(energyForRound(7)).toBe(8);
    expect(energyForRound(100)).toBe(8);
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
    let state = setReady(setReady(createMatch(3), 0), 1);
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

  it('schaltet mit „Lane ausbauen“ (Lvl 2) je eine Lane oberhalb und unterhalb frei und verbraucht die Karte', () => {
    const state = withHand(createMatch(1), ['line-upgrade', 'summon-minion']);
    const result = playCard(state, 0, 0);
    expect(result.ok).toBe(true);
    const player = result.state.players[0];
    expect(player.level).toBe(2);
    expect(unlockedLanes(player.level)).toEqual([1, 0, 2]);
    expect(player.lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 0, 0]);
    for (const tower of [...player.lines[1]!.towers, ...player.lines[2]!.towers]) {
      expect(tower).toEqual({ offset: 0, hp: TOWER_HP, maxHp: TOWER_HP, damage: TOWER_DAMAGE });
    }
    expect(player.hand).toEqual(['summon-minion']);
    expect(player.energy).toBe(MAX_ENERGY - getCardDef('line-upgrade').cost);
    // Gegner und Ausgangszustand bleiben unberührt.
    expect(result.state.players[1].level).toBe(1);
    expect(result.state.players[1].lines.map((line) => line.towers.length)).toEqual([3, 0, 0, 0, 0]);
    expect(state.players[0].level).toBe(1);
  });

  it('schaltet mit der zweiten Ausbaustufe (Lvl 3) je eine weitere Lane oben und unten frei und stoppt dort', () => {
    expect(lineCapacity(2)).toBe(lineCapacity(1) + 1);
    let state = withHand(createMatch(1), Array(MAX_FIELD_LEVEL + 1).fill('line-upgrade'), 100);
    for (let level = 1; level < MAX_FIELD_LEVEL; level += 1) {
      const result = playCard(state, 0, 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    const player = state.players[0];
    expect(player.level).toBe(MAX_FIELD_LEVEL);
    expect(unlockedLanes(player.level)).toEqual([3, 1, 0, 2, 4]);
    expect(player.lines.map((line) => line.towers.length)).toEqual([3, 1, 1, 1, 1]);
    expect(playCard(state, 0, 0)).toMatchObject({ ok: false, reason: 'max-level' });
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

  it('liefert die Slot-Zahlen je Lane: gesperrte Lanes haben keine', () => {
    expect(laneSlotCounts(1)).toEqual([lineCapacity(1), 0, 0, 0, 0]);
    expect(laneSlotCounts(2)).toEqual([lineCapacity(2), lineCapacity(2), lineCapacity(2), 0, 0]);
    expect(laneSlotCounts(3)).toEqual(Array(5).fill(lineCapacity(3)));
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

  it('beschwört ein Minion auf der gewählten Lane und lehnt es bei voller Lane ab', () => {
    let state = withLevel(withHand(createMatch(1), Array(lineCapacity(2) + 1).fill('summon-minion'), 100), 2);
    for (let index = 0; index < lineCapacity(2); index += 1) {
      const result = playCard(state, 0, 0, 1);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.players[0].minions.filter((m) => m.line === 1)).toHaveLength(lineCapacity(2));
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
    const base = withHand(createMatch(1), ['summon-minion', 'line-upgrade', 'tower-hp']);
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
  });

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
  const minion = (id: number, line: number, position: number, hp = 20) => ({
    id,
    line,
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
    state.players[0].placements = minions.map((m) => ({ minionId: m.id, cardId: 'summon-minion' }));
    return state;
  }

  it('setzt Überlebende auf allen freien Lanes mit unveränderten Werten in die nächste Planung, Tote entfallen', () => {
    // Nur Spieler 0 hat das Feld ausgebaut; der Gegner hat auf diesen Lanes keine Tower, die Überlebenden bleiben heil.
    const state = createMatch(3);
    state.players[0].level = MAX_FIELD_LEVEL;
    const survivors = [minion(4, 1, 50), minion(2, 2, 50), minion(7, 4, 50), minion(8, 3, 50)];
    state.players[0].minions = [...survivors, minion(9, 1, 50, 0)];
    const ready = setReady(setReady(state, 0), 1);
    const next = advance(ready, COMBAT_TICKS * TICK_MS);
    expect(next.phase).toBe('planning');
    expect(next.round).toBe(2);
    expect(next.players[0].minions.map((m) => m.id)).toEqual([4, 2, 7, 8]);
    for (const original of survivors) {
      const back = next.players[0].minions.find((m) => m.id === original.id)!;
      expect(back).toEqual({ ...original, position: slotPosition(0) });
    }
    expect(next.players[0].minions.some((m) => m.id === 9)).toBe(false);
    expect(next.players[0].placements).toEqual([]);
  });

  it('setzt Überlebende nach id aufsteigend auf die niedrigsten freien Slots ihrer Lane', () => {
    const state = withMinions([minion(5, 1, 40), minion(2, 1, 33), minion(9, 0, 12), minion(3, 1, 50)]);
    respawnSurvivors(state.players[0]);
    const byId = (id: number) => state.players[0].minions.find((m) => m.id === id)!;
    expect(byId(2).position).toBe(slotPosition(0));
    expect(byId(3).position).toBe(slotPosition(1));
    expect(byId(5).position).toBe(slotPosition(2));
    expect(byId(9).position).toBe(slotPosition(0));
  });

  it('behält Lane und Werte, entfernt Tote und bleibt in der Zone', () => {
    const state = withMinions([minion(1, 2, 45), minion(2, 2, 10, 0)]);
    respawnSurvivors(state.players[0]);
    expect(state.players[0].minions).toEqual([{ ...minion(1, 2, 45), position: slotPosition(0) }]);
    expect(state.players[0].minions[0]!.position).toBeLessThanOrEqual(PLACEMENT_ZONE_END);
  });

  it('leert in Runde 2 placements und setzt Überlebende beider Spieler zurück', () => {
    let state = withMinions([minion(1, 0, 20)]);
    state.players[1].minions = [minion(1, 0, 20)];
    state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
    expect(state.round).toBe(2);
    expect(state.players[0].placements).toEqual([]);
    for (const player of state.players) {
      for (const m of player.minions) {
        expect(m.position).toBe(slotPosition(0));
        expect(m.position).toBeLessThanOrEqual(PLACEMENT_ZONE_END);
      }
    }
  });

  it('entfernt bei übervoller Lane keinen Minion und bleibt in der Zone', () => {
    const state = withMinions(Array.from({ length: 12 }, (_, i) => minion(i + 1, 0, 40 + i)));
    respawnSurvivors(state.players[0]);
    expect(state.players[0].minions).toHaveLength(12);
    for (const m of state.players[0].minions) expect(m.position).toBeLessThanOrEqual(PLACEMENT_ZONE_END);
    const first = state.players[0].minions.slice(0, 8).map((m) => m.position);
    expect(new Set(first).size).toBe(8);
  });

  it('liefert bei gleichem Seed nach Runde 2 identische Positionen', () => {
    const run = () => {
      let state = createMatch(7);
      state = botPlan(botPlan(state, 0), 1);
      state = advance(state, COMBAT_TICKS * TICK_MS);
      return state.players.map((p) => p.minions.map((m) => [m.id, m.line, m.position]));
    };
    expect(run()).toEqual(run());
  });

  it('belegt nach Runde 2 in echten Matches keinen Slot doppelt und bleibt in der Zone', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = createMatch(seed);
      state = botPlan(botPlan(state, 0), 1);
      state = advance(state, COMBAT_TICKS * TICK_MS);
      for (const player of state.players) {
        const keys = player.minions.map((m) => `${m.line}:${m.position}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const m of player.minions) expect(m.position).toBeLessThanOrEqual(PLACEMENT_ZONE_END);
      }
    }
  });
});
