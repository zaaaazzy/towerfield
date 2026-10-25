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
  lineCapacity,
  LINE_COUNT,
  MAX_ENERGY,
  MAX_LINE_LEVEL,
  MAX_ROUNDS,
  type MatchState,
  moveMinion,
  type PlayerIndex,
  playCard,
  setReady,
  START_HAND,
  undoSummon,
} from './match';
import { LINE_LENGTH, MINION_RANGE, TICK_MS } from './combat';

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

describe('Statistik', () => {
  const start = () => withHand(createMatch(3), ['summon-minion', 'summon-archer', 'summon-minion']);

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
    expect(damage.towerDamage).toBeLessThanOrEqual(state.players[1].lines[0]!.tower.maxHp + 1e-6);
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
  it('hat für beide Spieler genau 3 Lines mit je 1 Tower', () => {
    const state = createMatch(42);
    for (const player of state.players) {
      expect(player.lines).toHaveLength(LINE_COUNT);
      expect(LINE_COUNT).toBe(3);
      for (const line of player.lines) {
        expect(line.level).toBe(1);
        expect(line.tower.hp).toBeGreaterThan(0);
      }
    }
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

  it('erhöht mit „Line ausbauen“ die Stufe genau um 1 und verbraucht die Karte', () => {
    const state = withHand(createMatch(1), ['line-upgrade', 'summon-minion']);
    const result = playCard(state, 0, 0, 2);
    expect(result.ok).toBe(true);
    const player = result.state.players[0];
    expect(player.lines[2]!.level).toBe(2);
    expect(player.lines[0]!.level).toBe(1);
    expect(player.hand).toEqual(['summon-minion']);
    expect(player.energy).toBe(MAX_ENERGY - getCardDef('line-upgrade').cost);
    // Gegner und Ausgangszustand bleiben unberührt.
    expect(result.state.players[1].lines[2]!.level).toBe(1);
    expect(state.players[0].lines[2]!.level).toBe(1);
  });

  it('erhöht mit „Line ausbauen“ die Kapazität und stoppt bei der maximalen Stufe', () => {
    expect(lineCapacity(2)).toBe(lineCapacity(1) + 1);
    let state = withHand(createMatch(1), Array(MAX_LINE_LEVEL + 1).fill('line-upgrade'), 100);
    for (let level = 1; level < MAX_LINE_LEVEL; level += 1) {
      const result = playCard(state, 0, 0, 0);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.players[0].lines[0]!.level).toBe(MAX_LINE_LEVEL);
    expect(playCard(state, 0, 0, 0)).toMatchObject({ ok: false, reason: 'max-level' });
  });

  it('baut mit „Tower ausbauen“ Leben oder Schaden des gewählten Towers aus', () => {
    const base = withHand(createMatch(1), ['tower-hp', 'tower-damage']);
    const hp = playCard(base, 0, 0, 1);
    if (!hp.ok) throw new Error(hp.reason);
    expect(hp.state.players[0].lines[1]!.tower.hp).toBeGreaterThan(base.players[0].lines[1]!.tower.hp);
    expect(hp.state.players[0].lines[1]!.tower.maxHp).toBe(hp.state.players[0].lines[1]!.tower.hp);
    const damage = playCard(base, 0, 1, 1);
    if (!damage.ok) throw new Error(damage.reason);
    expect(damage.state.players[0].lines[1]!.tower.damage).toBeGreaterThan(base.players[0].lines[1]!.tower.damage);
    expect(damage.state.players[0].lines[0]!.tower).toEqual(base.players[0].lines[0]!.tower);
  });

  it('beschwört ein Minion auf der gewählten Line und lehnt es bei voller Line ab', () => {
    let state = withHand(createMatch(1), Array(lineCapacity(1) + 1).fill('summon-minion'), 100);
    for (let index = 0; index < lineCapacity(1); index += 1) {
      const result = playCard(state, 0, 0, 1);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.players[0].minions.filter((m) => m.line === 1)).toHaveLength(lineCapacity(1));
    expect(state.players[1].minions).toHaveLength(0);
    expect(playCard(state, 0, 0, 1)).toMatchObject({ ok: false, reason: 'line-full' });
    // Eine andere Line ist frei.
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
    const later = playCard(state, 0, 0, 1);
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

  it('wirkt „Minion verbessern“ je nach Umfang auf eine oder alle Lines', () => {
    const base = withHand(createMatch(1), ['minion-upgrade-line', 'minion-upgrade-all'], 10);
    const one = playCard(base, 0, 0, 2);
    if (!one.ok) throw new Error(one.reason);
    expect(one.state.players[0].lines.map((l) => l.bonus.hp > 0)).toEqual([false, false, true]);
    const all = playCard(base, 0, 1);
    if (!all.ok) throw new Error(all.reason);
    expect(all.state.players[0].lines.map((l) => l.bonus.hp > 0)).toEqual([true, true, true]);
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

describe('Sieg', () => {
  it('lässt den Spieler verlieren, dessen drei Tower zerstört sind', () => {
    const state = createMatch(1);
    state.players[0].lines.forEach((line) => (line.tower.hp = 0));
    expect(destroyedOutcome(state)).toBe('player1');
    const other = createMatch(1);
    other.players[1].lines.forEach((line) => (line.tower.hp = 0));
    expect(destroyedOutcome(other)).toBe('player0');
    const partial = createMatch(1);
    partial.players[0].lines[0]!.tower.hp = 0;
    expect(destroyedOutcome(partial)).toBeNull();
  });

  it('wertet gleichzeitige Zerstörung aller Tower als Unentschieden', () => {
    let state = setReady(setReady(createMatch(1), 0), 1);
    state = structuredClone(state);
    // Letzter Tower: Spieler 0 auf Line 0, Spieler 1 auf Line 1; je ein Minion kurz davor.
    for (const [index, player] of state.players.entries()) {
      player.lines.forEach((line, lineIndex) => {
        line.tower.hp = lineIndex === index ? 0.1 : 0;
      });
    }
    state.players[0].minions.push({ id: 1, line: 1, position: LINE_LENGTH - MINION_RANGE, hp: 50, damage: 20, range: MINION_RANGE, speed: 10 });
    state.players[1].minions.push({ id: 1, line: 0, position: LINE_LENGTH - MINION_RANGE, hp: 50, damage: 20, range: MINION_RANGE, speed: 10 });
    state = advance(state, TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('draw');
  });

  it('beendet das Spiel mit Sieg, sobald nur ein Spieler keine Tower mehr hat', () => {
    let state = setReady(setReady(createMatch(1), 0), 1);
    state = structuredClone(state);
    state.players[1].lines.forEach((line, index) => (line.tower.hp = index === 1 ? 0.1 : 0));
    state.players[0].minions.push({ id: 1, line: 1, position: LINE_LENGTH - MINION_RANGE, hp: 50, damage: 20, range: MINION_RANGE, speed: 10 });
    state = advance(state, TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('player0');
  });

  it('vergleicht nach der letzten Runde die Tower-Lebenspunkte, bei Gleichstand Unentschieden', () => {
    const state = createMatch(1);
    expect(hpOutcome(state)).toBe('draw');
    state.players[0].lines[0]!.tower.hp -= 1;
    expect(hpOutcome(state)).toBe('player1');
    state.players[1].lines[2]!.tower.hp -= 5;
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
