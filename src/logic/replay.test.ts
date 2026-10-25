import { describe, expect, it } from 'vitest';
import { simulateMatch, strategiesForSeed } from './balance-sim';
import { CARD_DEFS } from './cards';
import { advance } from './match';
import { createRecord, decodeMatch, encodeMatch, type RecordedAction, type RecordedMatch } from './match-record';
import { playScriptedMatch } from './match-record-fixture';
import {
  combatDelta,
  createInvalidReplay,
  createRecordedReplay,
  createReplay,
  describeAbort,
  describeEvent,
  isReplayAborted,
  isReplayOver,
  PLAY_PAUSE_MS,
  type ReplayAbortReason,
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

describe('Replay einer Aufzeichnung', () => {
  function runRecorded(record: RecordedMatch): ReplayState {
    let replay = createRecordedReplay(record);
    for (let steps = 0; steps < MAX_STEPS && !isReplayOver(replay) && !isReplayAborted(replay); steps += 1) {
      replay = stepReplay(replay, FRAME_MS);
    }
    return replay;
  }

  it('endet mit demselben MatchState wie das Original und zeigt die Züge in der gespielten Reihenfolge', () => {
    for (const seed of [1, 42]) {
      const original = playScriptedMatch(seed);
      const decoded = decodeMatch(seed, encodeMatch(original.record))!;
      const replay = runRecorded(decoded);
      expect(replay.aborted).toBeNull();
      expect(replay.match).toEqual(original.state);
      expect(replay.events).toHaveLength(original.record.actions.length);
      replay.events.forEach((event, index) => {
        const action = original.record.actions[index]!;
        expect(event.round).toBe(action.round);
        expect(event.player).toBe(action.player);
        expect(event.action ?? 'play').toBe(action.type);
      });
    }
  });

  it('spielt Partien mit „Minion stärken“ samt Ziel-Id bis zum gleichen Endstand nach', () => {
    let withBuff = 0;
    for (let seed = 1; seed <= 25 && withBuff < 3; seed += 1) {
      const original = playScriptedMatch(seed);
      const buffs = original.record.actions.filter((a) => a.type === 'play' && a.cardId === 'buff-minion');
      if (buffs.length === 0) continue;
      withBuff += 1;
      expect(buffs.every((a) => a.type === 'play' && a.minionId !== undefined && a.line === null)).toBe(true);
      const decoded = decodeMatch(seed, encodeMatch(original.record))!;
      expect(decoded.actions).toEqual(original.record.actions);
      const replay = runRecorded(decoded);
      expect(replay.aborted).toBeNull();
      expect(replay.match).toEqual(original.state);
    }
    expect(withBuff).toBeGreaterThan(0);
  }, 30_000);

  it('führt höchstens eine Aktion pro Pause aus und bleibt reproduzierbar', () => {
    const { record } = playScriptedMatch(5);
    const start = createRecordedReplay(record);
    expect(stepReplay(start, PLAY_PAUSE_MS - 1).events).toHaveLength(0);
    expect(stepReplay(start, PLAY_PAUSE_MS).events).toHaveLength(1);
    expect(stepReplay(start, PLAY_PAUSE_MS * 3).events).toHaveLength(3);
    expect(runRecorded(record).match).toEqual(runRecorded(record).match);
  });

  it('bricht an einer regelwidrigen Aktion kontrolliert ab und bleibt dort stehen', () => {
    const { record } = playScriptedMatch(5);
    // Dieselbe Karte achtmal: spätestens dann fehlt die Karte auf der Hand oder die Energie.
    const bad: RecordedAction = { type: 'play', round: 1, player: 1, cardId: 'summon-healer', line: 0 };
    const replay = runRecorded({ ...record, actions: [...record.actions.slice(0, 2), ...Array(8).fill(bad)] });
    expect(replay.aborted).not.toBeNull();
    expect(replay.aborted!.index).toBeGreaterThanOrEqual(2);
    expect(describeAbort(replay.aborted!)).toContain('Replay abgebrochen bei Zug');
    expect(stepReplay(replay, 1000)).toBe(replay);
  });

  it('bricht ab, wenn die Aufzeichnung vor dem Spielende endet oder danach weitergeht', () => {
    const { record } = playScriptedMatch(5);
    expect(runRecorded({ ...record, actions: record.actions.slice(0, -1) }).aborted?.reason).toBe('truncated');
    const trailing = runRecorded({ ...record, actions: [...record.actions, { type: 'ready', round: 8, player: 0 }] });
    expect(trailing.aborted?.reason).toBe('trailing-actions');
    expect(trailing.match.phase).toBe('over');
  });

  it('createInvalidReplay steht sofort mit invalid-data und läuft nicht', () => {
    const replay = createInvalidReplay(7);
    expect(replay.aborted).toEqual({ reason: 'invalid-data', index: 0 });
    expect(stepReplay(replay, 5000)).toBe(replay);
    expect(describeAbort(replay.aborted!)).toContain('ungültig');
  });

  it('bricht „Minion stärken“ ohne gültiges Ziel mit invalid-target ab und beschreibt den Grund', () => {
    const action: RecordedAction = { type: 'play', round: 1, player: 0, cardId: 'buff-minion', line: null, minionId: 99 };
    const state = createRecordedReplay({ ...createRecord(3), actions: [action] });
    state.match.players[0].hand = ['buff-minion'];
    state.match.players[0].energy = 5;
    const replay = stepReplay(state, PLAY_PAUSE_MS);
    expect(replay.aborted).toEqual({ reason: 'invalid-target', index: 0 });
    expect(describeAbort(replay.aborted!)).toContain('Ziel-Minion');
  });

  it('lässt das Bot-Replay unverändert: kein Skript, kein Abbruch', () => {
    const replay = runReplay(7).replay;
    expect(replay.script).toBeNull();
    expect(replay.aborted).toBeNull();
    expect(replay.events.every((event) => event.action === undefined)).toBe(true);
  });
});

describe('describeEvent für Aufzeichnungen', () => {
  const base = { round: 3, player: 0 as const };

  it('beschreibt Verschieben, Zurücknehmen und Bereit mit Spieler und Runde', () => {
    const move = describeEvent({ ...base, action: 'move', cardId: 'summon-archer', line: 1, slot: 2 });
    expect(move).toBe('Runde 3 · Blau verschiebt Bogenschütze auf Lvl 2 oben, Platz 3');
    const undo = describeEvent({ ...base, player: 1, action: 'undo', cardId: 'summon-minion', line: null });
    expect(undo).toBe('Runde 3 · Orange nimmt Minion zurück');
    expect(describeEvent({ ...base, action: 'ready', cardId: '', line: null })).toBe('Runde 3 · Blau ist bereit');
  });

  it('gibt für jeden Abbruchgrund einen Hinweis aus', () => {
    const reasons: ReplayAbortReason[] = [
      'invalid-data',
      'truncated',
      'trailing-actions',
      'wrong-round',
      'not-planning',
      'already-ready',
      'no-such-card',
      'not-enough-energy',
      'invalid-line',
      'invalid-slot',
      'slot-taken',
      'no-such-minion',
      'line-full',
      'max-level',
    ];
    for (const reason of reasons) expect(describeAbort({ reason, index: 4 }).length).toBeGreaterThan(10);
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

  it('nennt die Lane mit ihrem Namen, nur wenn die Karte eine hat', () => {
    const on = (line: number) => describeEvent({ round: 1, player: 0, cardId: 'summon-minion', line });
    expect(on(0)).toContain('auf Start-Lane');
    expect(on(1)).toContain('auf Lvl 2 oben');
    expect(on(2)).toContain('auf Lvl 2 unten');
    expect(on(3)).toContain('auf Lvl 3 oben');
    expect(on(4)).toContain('auf Lvl 3 unten');
    expect(describeEvent({ round: 1, player: 0, cardId: 'minion-upgrade-all', line: null })).not.toContain('Lane');
  });

  it('beschreibt den Abbruch auf einer gesperrten Lane verständlich', () => {
    expect(describeAbort({ reason: 'invalid-line', index: 2 })).toContain('Lane');
    expect(describeAbort({ reason: 'line-full', index: 2 })).toContain('Lane');
  });
});
