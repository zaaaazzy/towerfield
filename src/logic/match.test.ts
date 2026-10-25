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
  MAX_LINE_LEVEL,
  MAX_ROUNDS,
  type MatchState,
  type PlayerIndex,
  playCard,
  setReady,
  START_HAND,
} from './match';
import { LINE_LENGTH, MINION_RANGE, TICK_MS } from './combat';

/** Index der ersten Handkarte mit dieser ID, im Test garantiert vorhanden (sonst Testfehler). */
function find(state: MatchState, player: PlayerIndex, id: string): number {
  const index = state.players[player].hand.indexOf(id);
  if (index < 0) throw new Error(`Karte ${id} nicht auf der Hand`);
  return index;
}

/** Zustand mit einer bestimmten Karte auf der Hand beider Spieler (Hand überschrieben). */
function withHand(state: MatchState, hand: string[], energy = 10): MatchState {
  const copy = structuredClone(state);
  for (const player of copy.players) {
    player.hand = [...hand];
    player.energy = energy;
  }
  return copy;
}

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

  it('gibt beiden Spielern exakt 7 identische Karten und gleiche Energie', () => {
    const state = createMatch(42);
    expect(state.players[0].hand).toHaveLength(START_HAND);
    expect(START_HAND).toBe(7);
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
  it('zieht zu Beginn jeder weiteren Runde 5 identische Karten pro Spieler und erhöht die Energie gleich', () => {
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
    expect(state.players[0].hand).toHaveLength(5);
    expect(state.players[0].energy).toBe(energyForRound(2));
    expect(state.players[1].energy).toBe(energyForRound(2));
    expect(energyForRound(2)).toBeGreaterThan(energyForRound(1));
  });

  it('lässt überzählige Karten über dem Handlimit verfallen', () => {
    let state = createMatch(3);
    expect(state.players[0].hand).toHaveLength(7);
    state = setReady(setReady(state, 0), 1);
    state = advance(state, COMBAT_TICKS * TICK_MS);
    expect(state.players[0].hand).toHaveLength(HAND_LIMIT);
    expect(state.players[1].hand).toHaveLength(HAND_LIMIT);
    expect(state.drawn).toBe(START_HAND + DRAW_PER_ROUND);
  });

  it('begrenzt die Energie', () => {
    expect(energyForRound(100)).toBeLessThanOrEqual(10);
  });

  it('beendet die Kampfphase erst nach der Rundendauer', () => {
    let state = setReady(setReady(createMatch(3), 0), 1);
    state = advance(state, (COMBAT_TICKS - 2) * TICK_MS);
    expect(state.phase).toBe('combat');
    expect(state.round).toBe(1);
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
    expect(player.energy).toBe(10 - getCardDef('line-upgrade').cost);
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
    state.players[0].minions.push({ id: 1, line: 1, position: LINE_LENGTH - MINION_RANGE, hp: 50, damage: 20 });
    state.players[1].minions.push({ id: 1, line: 0, position: LINE_LENGTH - MINION_RANGE, hp: 50, damage: 20 });
    state = advance(state, TICK_MS);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('draw');
  });

  it('beendet das Spiel mit Sieg, sobald nur ein Spieler keine Tower mehr hat', () => {
    let state = setReady(setReady(createMatch(1), 0), 1);
    state = structuredClone(state);
    state.players[1].lines.forEach((line, index) => (line.tower.hp = index === 1 ? 0.1 : 0));
    state.players[0].minions.push({ id: 1, line: 1, position: LINE_LENGTH - MINION_RANGE, hp: 50, damage: 20 });
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
