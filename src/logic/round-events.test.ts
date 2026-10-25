import { describe, expect, it } from 'vitest';
import { buildDeck } from './cards';
import { advance, COMBAT_TICKS, createMatch, type MatchState, MAX_ROUNDS, setReady } from './match';
import { TICK_MS } from './combat';
import {
  deriveEventSeed,
  EVENT_INTERVAL,
  getRoundEventDef,
  isEventRound,
  pickRoundEvent,
  ROUND_EVENTS,
  type RoundEventId,
} from './round-events';

/** Spielt Runden ohne Karten durch, bis die Planung von `round` offen ist. */
function toRound(seed: number, round: number): MatchState {
  let state = createMatch(seed);
  while (state.round < round) {
    state = advance(setReady(setReady(state, 0), 1), COMBAT_TICKS * TICK_MS);
  }
  return state;
}

describe('isEventRound', () => {
  it('trifft nur die Runden 3 und 6 von 1 bis MAX_ROUNDS', () => {
    const rounds = Array.from({ length: MAX_ROUNDS }, (_, index) => index + 1);
    expect(rounds.filter(isEventRound)).toEqual([3, 6]);
    expect(EVENT_INTERVAL).toBe(3);
  });

  it('lehnt Runde 0, negative und gebrochene Runden ab', () => {
    expect([0, -3, 1.5].some(isEventRound)).toBe(false);
  });
});

describe('pickRoundEvent', () => {
  it('liefert bei gleichem Seed und gleicher Runde dasselbe Ereignis', () => {
    for (const seed of [0, 1, 42, 99999]) {
      expect(pickRoundEvent(seed, 3)).toEqual(pickRoundEvent(seed, 3));
    }
  });

  it('wählt in Nicht-Ereignisrunden nichts und lässt den Seed unverändert', () => {
    expect(pickRoundEvent(123, 2)).toEqual({ event: null, seed: 123 });
  });

  it('schaltet den Seed in Ereignisrunden weiter', () => {
    expect(pickRoundEvent(123, 3).seed).not.toBe(123);
  });

  it('wählt über 1000 Seeds jedes Ereignis des Pools mindestens einmal', () => {
    const seen = new Set<RoundEventId | null>();
    for (let seed = 0; seed < 1000; seed += 1) seen.add(pickRoundEvent(deriveEventSeed(seed), 3).event);
    for (const def of ROUND_EVENTS) expect(seen.has(def.id)).toBe(true);
  });
});

describe('Event-Seed', () => {
  it('ist vom Match-Seed abgeleitet und davon verschieden', () => {
    expect(deriveEventSeed(5)).toBe(deriveEventSeed(5));
    expect(deriveEventSeed(5)).not.toBe(5);
    expect(deriveEventSeed(5)).not.toBe(deriveEventSeed(6));
  });

  it('ändert die Deck-Reihenfolge nicht', () => {
    for (const seed of [1, 7, 31]) {
      const before = createMatch(seed).deck;
      const after = toRound(seed, 6).deck;
      expect(after).toEqual(before);
      expect(after).toEqual(buildDeck(seed, before.length));
    }
  });

  it('ergibt im Match reproduzierbar dieselben Ereignisse', () => {
    expect(toRound(11, 6).event).toBe(toRound(11, 6).event);
    expect(toRound(11, 3).event).toBe(pickRoundEvent(deriveEventSeed(11), 3).event);
  });

  it('setzt das Ereignis nur in den Runden 3 und 6', () => {
    const events = [1, 2, 3, 4, 5, 6, 7, 8].map((round) => toRound(11, round).event !== null);
    expect(events).toEqual([false, false, true, false, false, true, false, false]);
  });
});

describe('getRoundEventDef', () => {
  it('liefert Name und Kurzbeschreibung zu jeder ID', () => {
    for (const def of ROUND_EVENTS) {
      expect(getRoundEventDef(def.id)).toBe(def);
      expect(def.name).not.toBe('');
      expect(def.description).not.toBe('');
    }
  });
});
