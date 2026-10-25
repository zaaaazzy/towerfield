import { describe, expect, it } from 'vitest';
import { simulateMatch, strategiesForSeed } from './balance-sim';
import { CARD_DEFS } from './cards';
import { advance } from './match';
import {
  combatDelta,
  createReplay,
  describeEvent,
  isReplayOver,
  PLAY_PAUSE_MS,
  type ReplayEvent,
  type ReplayState,
  SLOWMO_FACTOR,
  stepReplay,
} from './replay';

const FRAME_MS = 100;
/** Sicherung gegen Endlosschleifen: 8 Runden Kampf in Zeitlupe plus Planung, mit Reserve. */
const MAX_STEPS = 20_000;

function runReplay(seed: number): { replay: ReplayState; steps: number } {
  let replay = createReplay(seed);
  let steps = 0;
  while (!isReplayOver(replay) && steps < MAX_STEPS) {
    replay = stepReplay(replay, FRAME_MS);
    steps += 1;
  }
  return { replay, steps };
}

describe('Replay-Logik', () => {
  it('ergibt bei gleichem Seed denselben Endzustand und dieselben Ereignisse', () => {
    const a = runReplay(42).replay;
    const b = runReplay(42).replay;
    expect(a.match).toEqual(b.match);
    expect(a.events).toEqual(b.events);
  });

  it('liefert für unterschiedliche Seeds unterschiedliche Ereignislisten', () => {
    const lists = [1, 2, 3].map((seed) => JSON.stringify(runReplay(seed).replay.events));
    expect(new Set(lists).size).toBeGreaterThan(1);
    expect(lists[0]).not.toBe(lists[1]);
  });

  it('endet nach endlich vielen Schritten in der Phase over mit gültigem Outcome', () => {
    for (const seed of [1, 7, 99]) {
      const { replay, steps } = runReplay(seed);
      expect(steps).toBeLessThan(MAX_STEPS);
      expect(replay.match.phase).toBe('over');
      expect(['player0', 'player1', 'draw']).toContain(replay.match.outcome);
    }
  });

  it('kommt zum selben Ergebnis wie die Simulation ohne Zeitlupe', () => {
    for (const seed of [1, 5, 13]) {
      const result = simulateMatch(seed, strategiesForSeed(seed));
      const { replay } = runReplay(seed);
      expect(replay.match.outcome).toBe(result.outcome);
      expect(replay.match.round).toBe(result.rounds);
    }
  });

  it('erzeugt je gespielter Karte genau ein Ereignis mit Spieler, Karte und Runde', () => {
    for (const seed of [1, 5, 13]) {
      const result = simulateMatch(seed, strategiesForSeed(seed));
      const { replay } = runReplay(seed);
      for (const player of [0, 1] as const) {
        const ids = replay.events.filter((e) => e.player === player).map((e) => e.cardId);
        expect(ids.sort()).toEqual([...result.played[player]].sort());
      }
      for (const event of replay.events) {
        expect(event.round).toBeGreaterThanOrEqual(1);
        expect(CARD_DEFS.some((def) => def.id === event.cardId)).toBe(true);
      }
    }
  });

  it('spielt in der Planung höchstens eine Karte pro Pause', () => {
    const start = createReplay(3);
    expect(stepReplay(start, PLAY_PAUSE_MS - 1).events).toHaveLength(0);
    const after = stepReplay(start, PLAY_PAUSE_MS);
    expect(after.events.length).toBeLessThanOrEqual(1);
    expect(stepReplay(start, PLAY_PAUSE_MS * 2).events.length).toBeLessThanOrEqual(2);
  });

  it('ändert den übergebenen Zustand nicht', () => {
    const start = createReplay(3);
    const snapshot = structuredClone(start);
    stepReplay(start, PLAY_PAUSE_MS * 3);
    expect(start).toEqual(snapshot);
  });

  it('verbraucht in der Kampfphase weniger Spielzeit als ein normales Match', () => {
    let replay = createReplay(3);
    for (let i = 0; i < MAX_STEPS && replay.match.phase === 'planning'; i += 1) replay = stepReplay(replay, FRAME_MS);
    expect(replay.match.phase).toBe('combat');
    const delta = 1000;
    const slow = stepReplay(replay, delta).match;
    const normal = advance(replay.match, delta);
    expect(SLOWMO_FACTOR).toBeLessThan(1);
    expect(combatDelta(delta)).toBeCloseTo(delta * SLOWMO_FACTOR);
    expect(slow.combatTicks).toBeLessThan(normal.combatTicks);
    expect(slow.combatTicks).toBe(advance(replay.match, combatDelta(delta)).combatTicks);
  });

  it('ändert nach dem Ende oder bei delta 0 nichts', () => {
    const { replay } = runReplay(3);
    expect(stepReplay(replay, 1000)).toBe(replay);
    const fresh = createReplay(3);
    expect(stepReplay(fresh, 0)).toBe(fresh);
  });
});

describe('describeEvent', () => {
  it('formuliert für jede Karte einen nicht leeren Text mit Spieler und Runde', () => {
    for (const def of CARD_DEFS) {
      const event: ReplayEvent = {
        round: 2,
        player: 1,
        cardId: def.id,
        line: def.target === 'line' ? 1 : null,
      };
      const text = describeEvent(event);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('Runde 2');
      expect(text).toContain('Orange');
      expect(text).toContain(def.name);
    }
  });

  it('nennt die Line 1-basiert, nur wenn die Karte eine hat', () => {
    expect(describeEvent({ round: 1, player: 0, cardId: 'summon-minion', line: 0 })).toContain('Line 1');
    expect(describeEvent({ round: 1, player: 0, cardId: 'minion-upgrade-all', line: null })).not.toContain('Line');
  });
});
