import { describe, expect, it } from 'vitest';
import {
  type AudioEvent,
  createAudioState,
  planSounds,
  RATE_SPREAD,
  SOUND_KEYS,
  type SoundKey,
  soundKeyFor,
  THROTTLE,
  VOLUME_MIN,
} from './audio-events';
import type { FxEvent } from './fx-events';

/** Je ein Ereignis jeder Art (Kampf, Karte, Runde, Spielende). */
const EXAMPLES: { event: AudioEvent; key: SoundKey }[] = [
  { event: { kind: 'summon', owner: 0, minionId: 1, line: 0, position: 5 }, key: 'summon' },
  { event: { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 5, amount: 2, source: 'melee' }, key: 'melee-hit' },
  { event: { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 5, amount: 2, source: 'arrow' }, key: 'arrow' },
  { event: { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 5, amount: 2, source: 'lightning' }, key: 'lightning' },
  { event: { kind: 'minion-heal', owner: 0, minionId: 1, line: 0, position: 5, amount: 2 }, key: 'heal' },
  { event: { kind: 'minion-death', owner: 0, minionId: 1, line: 0, position: 5 }, key: 'minion-death' },
  { event: { kind: 'explosion', owner: 0, minionId: 1, line: 0, position: 5, radius: 8 }, key: 'explosion' },
  { event: { kind: 'tower-damage', owner: 1, line: 0, tower: 0, amount: 3 }, key: 'tower-hit' },
  { event: { kind: 'tower-down', owner: 1, line: 0, tower: 0 }, key: 'tower-down' },
  { event: { kind: 'shield-block', owner: 1, line: 0, tower: 0 }, key: 'shield-block' },
  { event: { kind: 'card-play' }, key: 'card-play' },
  { event: { kind: 'round-start', round: 2 }, key: 'round-start' },
  { event: { kind: 'round-end', round: 2 }, key: 'round-end' },
  { event: { kind: 'match-over', outcome: 'player0' }, key: 'victory' },
  { event: { kind: 'match-over', outcome: 'player1' }, key: 'defeat' },
];

describe('soundKeyFor', () => {
  it.each(EXAMPLES)('ordnet $event.kind genau einen Schlüssel zu ($key)', ({ event, key }) => {
    expect(soundKeyFor(event)).toBe(key);
    expect(SOUND_KEYS).toContain(key);
  });

  it('deckt jede FX-Ereignisart ab', () => {
    const kinds: FxEvent['kind'][] = [
      'summon',
      'minion-damage',
      'minion-heal',
      'minion-death',
      'explosion',
      'tower-damage',
      'tower-down',
      'shield-block',
      'round-start',
      'round-end',
      'match-over',
    ];
    const covered = new Set(EXAMPLES.map(({ event }) => event.kind));
    for (const kind of kinds) expect(covered.has(kind)).toBe(true);
  });

  it('nutzt für die Kampfarten Treffer, Pfeil, Blitz, Schild, Heilung, Beschwörung und Tod unterschiedliche Schlüssel', () => {
    const combat = EXAMPLES.filter(({ key }) =>
      ['melee-hit', 'arrow', 'lightning', 'shield-block', 'heal', 'summon', 'minion-death'].includes(key),
    ).map(({ event }) => soundKeyFor(event));
    expect(combat).toHaveLength(7);
    expect(new Set(combat).size).toBe(7);
  });

  it('wertet Sieg und Niederlage aus Sicht des Spielers; ein Unentschieden klingt wie ein Rundenende', () => {
    expect(soundKeyFor({ kind: 'match-over', outcome: 'player1' }, 1)).toBe('victory');
    expect(soundKeyFor({ kind: 'match-over', outcome: 'player0' }, 1)).toBe('defeat');
    expect(soundKeyFor({ kind: 'match-over', outcome: 'draw' })).toBe('round-end');
  });
});

const hit = (id: number): AudioEvent => ({
  kind: 'minion-damage',
  owner: 0,
  minionId: id,
  line: 0,
  position: 5,
  amount: 1,
  source: 'melee',
});

describe('planSounds', () => {
  it('drosselt gleichzeitige Ereignisse auf die Obergrenze je Schlüssel', () => {
    const events = Array.from({ length: 20 }, (_, id) => hit(id));
    const { plays } = planSounds(createAudioState(1), events, 16);
    expect(plays).toHaveLength(THROTTLE.maxPerKey);
  });

  it('hält die Gesamtgrenze pro Zeitfenster ein, auch über mehrere Bilder', () => {
    const kinds: AudioEvent[] = EXAMPLES.map(({ event }) => event).filter(
      (event) => !['round-start', 'round-end', 'match-over', 'tower-down'].includes(event.kind),
    );
    const many = [...kinds, ...kinds, ...kinds];
    let state = createAudioState(3);
    let total = 0;
    for (let frame = 0; frame < 10; frame += 1) {
      const planned = planSounds(state, many, 16);
      state = planned.state;
      total += planned.plays.length;
    }
    // 10 Bilder à 16 ms = 160 ms: noch im ersten Fenster.
    expect(total).toBeLessThanOrEqual(THROTTLE.maxTotal);
    expect(total).toBe(THROTTLE.maxTotal);
  });

  it('lässt nach Ablauf des Fensters (über delta) wieder Töne zu', () => {
    const first = planSounds(createAudioState(1), [hit(1), hit(2), hit(3)], 0);
    expect(first.plays).toHaveLength(THROTTLE.maxPerKey);
    const soon = planSounds(first.state, [hit(4)], THROTTLE.windowMs - 1);
    expect(soon.plays).toHaveLength(0);
    const later = planSounds(soon.state, [hit(5)], 1);
    expect(later.plays).toHaveLength(1);
  });

  it('spielt Rundenwechsel und Spielende auch im Lärm eines grossen Kampfes', () => {
    const noise: AudioEvent[] = EXAMPLES.map(({ event }) => event).filter((event) => event.kind !== 'match-over');
    const events: AudioEvent[] = [...noise, { kind: 'match-over', outcome: 'player0' }];
    const keys = planSounds(createAudioState(1), events, 16).plays.map((play) => play.key);
    expect(keys).toContain('victory');
  });

  it('ignoriert negative delta-Werte', () => {
    const { state } = planSounds(createAudioState(1), [], -50);
    expect(state.nowMs).toBe(0);
  });

  it('liefert zur selben Seed dieselben Variationen und zu anderen Seeds andere', () => {
    const events = EXAMPLES.map(({ event }) => event);
    const a = planSounds(createAudioState(42), events, 16);
    const b = planSounds(createAudioState(42), events, 16);
    const c = planSounds(createAudioState(43), events, 16);
    expect(a).toEqual(b);
    expect(a.plays.map((play) => play.rate)).not.toEqual(c.plays.map((play) => play.rate));
  });

  it('hält Tonhöhe und Lautstärke im Wertebereich', () => {
    let state = createAudioState(7);
    for (let frame = 0; frame < 200; frame += 1) {
      const planned = planSounds(state, [hit(frame)], 300);
      state = planned.state;
      for (const play of planned.plays) {
        expect(play.rate).toBeGreaterThanOrEqual(1 - RATE_SPREAD);
        expect(play.rate).toBeLessThanOrEqual(1 + RATE_SPREAD);
        expect(play.volume).toBeGreaterThanOrEqual(VOLUME_MIN);
        expect(play.volume).toBeLessThanOrEqual(1);
      }
    }
  });

  it('verbraucht für verworfene Ereignisse keinen Zufall', () => {
    const events = Array.from({ length: 6 }, (_, id) => hit(id));
    const once = planSounds(createAudioState(5), events.slice(0, THROTTLE.maxPerKey), 0);
    const throttled = planSounds(createAudioState(5), events, 0);
    expect(throttled.state.seed).toBe(once.state.seed);
  });

  it('verändert die übergebene Zustandsliste nicht', () => {
    const state = createAudioState(1);
    const snapshot = structuredClone(state);
    planSounds(state, [hit(1)], 10);
    expect(state).toEqual(snapshot);
  });
});
