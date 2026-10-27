import { describe, expect, it } from 'vitest';
import { botPlan } from './bot';
import { CARD_DEFS, getCardDef } from './cards';
import { createMatch, MAX_ROUNDS, playCard, setReady } from './match';
import {
  applyAction,
  appendAction,
  botPlanRecorded,
  createRecord,
  decodeMatch,
  encodeMatch,
  MAX_MOVES_LENGTH,
  performAction,
  RECORD_VERSION,
  type RecordedAction,
  type RecordedMatch,
  replayRecorded,
  shareQuery,
  wrapText,
} from './match-record';
import { playScriptedMatch } from './match-record-fixture';
import { parseReplaySeed } from './seed';

const SEEDS = [1, 5, 42];

describe('Aufzeichnung und Nachspielen', () => {
  it('enthält alle acht Aktionstypen mit Runde und Spieler', () => {
    const types = new Set<string>();
    for (const seed of SEEDS) {
      for (const action of playScriptedMatch(seed).record.actions) {
        types.add(action.type);
        expect(action.round).toBeGreaterThanOrEqual(1);
        expect(action.round).toBeLessThanOrEqual(MAX_ROUNDS);
        expect([0, 1]).toContain(action.player);
      }
    }
    expect([...types].sort()).toEqual(['buy-lane', 'discard', 'draw', 'move', 'play', 'ready', 'undo', 'upgrade']);
  });

  it('zeichnet Slots, Verschieben und Abwerfen auf und spielt sie mit gleichem Ergebnis nach', () => {
    let slots = 0;
    let moves = 0;
    let discards = 0;
    for (const seed of SEEDS) {
      const original = playScriptedMatch(seed);
      for (const action of original.record.actions) {
        if (action.type === 'play' && action.slot !== undefined) slots += 1;
        if (action.type === 'move') moves += 1;
        if (action.type === 'discard') discards += 1;
      }
      const replayed = replayRecorded(decodeMatch(seed, encodeMatch(original.record))!);
      expect(replayed.ok).toBe(true);
      expect(replayed.state).toEqual(original.state);
    }
    expect(slots).toBeGreaterThan(0);
    expect(moves).toBeGreaterThan(0);
    expect(discards).toBeGreaterThan(0);
  });

  it('zeichnet das Abwerfen des Bots mit und spielt es nach', () => {
    const state = createMatch(4);
    state.players[1].hand = ['buff-minion', 'summon-brute'];
    state.players[1].energy = 1;
    const planned = botPlanRecorded(state, createRecord(4), 1);
    // Nach dem Abwerfen hat der Bot 2 Energie und baut das Feld aus (Upgrade steht in der Priorität vorn).
    expect(planned.record.actions.map((a) => a.type)).toEqual(['discard', 'upgrade', 'ready']);
    expect(planned.record.actions[0]).toMatchObject({ type: 'discard', cardId: 'buff-minion', player: 1 });
    const first = applyAction(state, planned.record.actions[0]!);
    expect(first.ok).toBe(true);
    expect(first.state.players[1].energy).toBe(2);
  });

  it('wendet „abwerfen“ an und lehnt eine Karte ab, die nicht auf der Hand ist', () => {
    const state = createMatch(1);
    state.players[0].energy = 2;
    const cardId = state.players[0].hand[0]!;
    const done = applyAction(state, { type: 'discard', round: 1, player: 0, cardId });
    expect(done.ok).toBe(true);
    expect(done.state.players[0].energy).toBe(3);
    expect(done.state.players[0].hand).toHaveLength(state.players[0].hand.length - 1);
    expect(applyAction(state, { type: 'discard', round: 1, player: 0, cardId: 'lane-buff' })).toMatchObject({
      ok: false,
      reason: 'no-such-card',
    });
  });

  it('wendet Upgrade, Lane-Kauf und Ziehen über die Regeln an und lehnt Regelverstöße ab', () => {
    const state = createMatch(1);
    state.players[0].energy = 20;
    expect(applyAction(state, { type: 'buy-lane', round: 1, player: 0, line: 1 })).toMatchObject({
      ok: false,
      reason: 'level-too-low',
    });
    const upgraded = applyAction(state, { type: 'upgrade', round: 1, player: 0 });
    if (!upgraded.ok) throw new Error(upgraded.reason);
    expect(upgraded.state.players[0].level).toBe(2);
    const bought = applyAction(upgraded.state, { type: 'buy-lane', round: 1, player: 0, line: 2 });
    if (!bought.ok) throw new Error(bought.reason);
    expect(bought.state.players[0].lines[2]!.bought).toBe(true);
    const drawn = applyAction(bought.state, { type: 'draw', round: 1, player: 0 });
    if (!drawn.ok) throw new Error(drawn.reason);
    expect(drawn.state.players[0].hand).toHaveLength(state.players[0].hand.length + 1);
    expect(applyAction(drawn.state, { type: 'draw', round: 2, player: 0 })).toMatchObject({ ok: false, reason: 'wrong-round' });
  });

  it('wendet „spielen“ mit gewähltem Turm-Slot an', () => {
    const state = createMatch(1);
    state.players[0].hand = ['summon-minion'];
    state.players[0].energy = 3;
    const done = applyAction(state, { type: 'play', round: 1, player: 0, cardId: 'summon-minion', line: 0, slot: 4 });
    expect(done.ok).toBe(true);
    expect(done.state.players[0].minions[0]).toMatchObject({ slot: 4, position: 16 });
  });

  it('ergibt nach Kodieren, Dekodieren und Nachspielen exakt denselben MatchState', () => {
    for (const seed of SEEDS) {
      const original = playScriptedMatch(seed);
      expect(original.state.phase).toBe('over');
      const decoded = decodeMatch(seed, encodeMatch(original.record));
      expect(decoded).toEqual(original.record);
      const result = replayRecorded(decoded!);
      expect(result.ok).toBe(true);
      expect(result.state).toEqual(original.state);
      expect(result.state.outcome).toBe(original.state.outcome);
    }
  });

  it('meldet fehlende Züge am Ende, überzählige nach dem Spielende und Züge aus der falschen Runde', () => {
    const { record } = playScriptedMatch(5);
    const truncated = replayRecorded({ ...record, actions: record.actions.slice(0, -1) });
    expect(truncated).toMatchObject({ ok: false, reason: 'truncated' });

    const extra: RecordedAction = { type: 'ready', round: MAX_ROUNDS, player: 0 };
    const trailing = replayRecorded(appendAction(record, extra));
    expect(trailing).toMatchObject({ ok: false, reason: 'trailing-actions', index: record.actions.length });

    const wrongRound = replayRecorded({ ...record, actions: [{ ...record.actions[0]!, round: 3 }, ...record.actions] });
    expect(wrongRound).toMatchObject({ ok: false, reason: 'wrong-round', index: 0 });
  });

  it('erkennt eine regelwidrige Aktion (zu wenig Energie) und bricht an ihr ab', () => {
    const seed = 3;
    let energy = createMatch(seed).players[0].energy;
    let expectedIndex = -1;
    const actions: RecordedAction[] = createMatch(seed).players[0].hand.map((cardId, index) => {
      const def = getCardDef(cardId);
      energy -= def.cost;
      if (energy < 0 && expectedIndex < 0) expectedIndex = index;
      return { type: 'play', round: 1, player: 0, cardId, line: def.target === 'line' ? 0 : null };
    });
    expect(expectedIndex).toBeGreaterThan(0);
    const result = replayRecorded({ ...createRecord(seed), actions });
    expect(result).toMatchObject({ ok: false, reason: 'not-enough-energy', index: expectedIndex });
    // Der Zustand ist der vor der fehlerhaften Aktion: alle Karten davor wurden gespielt.
    expect(result.state.players[0].hand).toHaveLength(actions.length - expectedIndex);
  });

  it('lehnt „Lane ausbauen“ mit Ziel-Lane, „Bereit“ im Kampf und Zug auf gesperrter Lane ab', () => {
    const state = createMatch(1);
    state.players[0].hand = ['line-upgrade', 'summon-minion'];
    state.players[0].energy = 8;
    expect(applyAction(state, { type: 'play', round: 1, player: 0, cardId: 'line-upgrade', line: 0 })).toMatchObject({
      ok: false,
      reason: 'invalid-line',
    });
    const upgraded = applyAction(state, { type: 'play', round: 1, player: 0, cardId: 'line-upgrade', line: null });
    expect(upgraded.ok).toBe(true);
    expect(upgraded.state.players[0].level).toBe(2);
    expect(applyAction(state, { type: 'play', round: 1, player: 0, cardId: 'summon-minion', line: 1 })).toMatchObject({
      ok: false,
      reason: 'invalid-line',
    });
    const combat = setReady(setReady(state, 0), 1);
    expect(applyAction(combat, { type: 'ready', round: 1, player: 0 })).toMatchObject({
      ok: false,
      reason: 'not-planning',
    });
  });

  it('wirft beim Kodieren einer unbekannten Karte', () => {
    const record = appendAction(createRecord(1), { type: 'play', round: 1, player: 0, cardId: 'gibt-es-nicht', line: null });
    expect(() => encodeMatch(record)).toThrow('Unbekannte Karte');
    const discard = appendAction(createRecord(1), { type: 'discard', round: 1, player: 0, cardId: 'gibt-es-nicht' });
    expect(() => encodeMatch(discard)).toThrow('Unbekannte Karte');
  });

  it('lehnt Aktionen für nicht vorhandene Karten, Minions und doppeltes Bereit ab, ohne zu werfen', () => {
    const state = createMatch(1);
    const missing = (type: RecordedAction['type']): RecordedAction => {
      switch (type) {
        case 'play':
          return { type, round: 1, player: 0, cardId: 'summon-brute', line: 0 };
        case 'move':
          return { type, round: 1, player: 0, minionId: 99, line: 0, slot: 0 };
        case 'undo':
          return { type, round: 1, player: 0, minionId: 99 };
        case 'discard':
          return { type, round: 1, player: 0, cardId: 'summon-brute' };
        case 'upgrade':
        case 'draw':
        case 'ready':
          return { type, round: 1, player: 0 };
        case 'buy-lane':
          return { type, round: 1, player: 0, line: 1 };
      }
    };
    expect(applyAction({ ...state, players: [{ ...state.players[0], hand: [] }, state.players[1]] }, missing('play'))).toMatchObject({ ok: false, reason: 'no-such-card' });
    expect(applyAction(state, missing('move'))).toMatchObject({ ok: false, reason: 'no-such-minion' });
    expect(applyAction(state, missing('undo'))).toMatchObject({ ok: false, reason: 'no-such-minion' });
    const ready = applyAction(state, missing('ready'));
    expect(ready.ok).toBe(true);
    expect(applyAction(ready.state, missing('ready'))).toMatchObject({ ok: false, reason: 'already-ready' });
  });
});

describe('Aufzeichnen verändert nichts', () => {
  it('performAction liefert denselben Zustand wie die Regel selbst und lässt die Eingabe unberührt', () => {
    const state = createMatch(7);
    const snapshot = structuredClone(state);
    const cardId = state.players[0].hand[0]!;
    const line = getCardDef(cardId).target === 'line' ? 0 : undefined;
    const direct = playCard(state, 0, 0, line);
    const record = createRecord(7);
    const recorded = performAction(state, record, 0, { type: 'play', cardId, line: line ?? null });
    expect(recorded.result).toEqual(direct);
    expect(state).toEqual(snapshot);
    expect(record.actions).toHaveLength(0);
    expect(recorded.record.actions).toHaveLength(1);
    expect(performAction(state, record, 0, { type: 'ready' }).result.state).toEqual(setReady(state, 0));
  });

  it('schreibt fehlgeschlagene Aktionen nicht mit', () => {
    const state = createMatch(7);
    const record = createRecord(7);
    const failed = performAction(state, record, 0, { type: 'undo', minionId: 42 });
    expect(failed.result.ok).toBe(false);
    expect(failed.record).toBe(record);
  });

  it('botPlanRecorded spielt exakt wie botPlan und schreibt jede Karte plus Bereit mit', () => {
    for (const seed of SEEDS) {
      const state = createMatch(seed);
      const planned = botPlanRecorded(state, createRecord(seed), 1);
      expect(planned.state).toEqual(botPlan(state, 1));
      const actions = planned.record.actions;
      expect(actions.at(-1)).toMatchObject({ type: 'ready', player: 1, round: 1 });
      const count = (type: string) => actions.filter((a) => a.type === type).length;
      // Jede gespielte oder abgeworfene Karte verlässt die Hand, jede gezogene kommt dazu.
      const shrink = state.players[1].hand.length - planned.state.players[1].hand.length;
      expect(count('play') + count('discard') - count('draw')).toBe(shrink);
    }
  });
});

describe('encodeMatch / decodeMatch', () => {
  it('ergibt die ursprüngliche Aktionsliste, auch bei Seeds mit 1 und mit 15 Ziffern', () => {
    const longSeed = parseReplaySeed('?replay=999999999999999')!;
    expect(String(longSeed).length).toBeLessThan(15);
    for (const seed of [1, longSeed]) {
      const { record } = playScriptedMatch(seed);
      expect(record.actions.length).toBeGreaterThan(10);
      const decoded = decodeMatch(seed, encodeMatch(record));
      expect(decoded?.actions).toEqual(record.actions);
      expect(decoded?.seed).toBe(seed);
      expect(decoded?.version).toBe(RECORD_VERSION);
    }
  });

  it('kodiert eine leere Liste, jede Aktionsart und Karten ohne Line', () => {
    const actions: RecordedAction[] = [
      { type: 'play', round: 1, player: 0, cardId: 'minion-upgrade-all', line: null },
      { type: 'play', round: 2, player: 1, cardId: 'summon-healer', line: 2 },
      { type: 'move', round: 8, player: 1, minionId: 123456, line: 0, slot: 4 },
      { type: 'undo', round: 3, player: 0, minionId: 0 },
      { type: 'play', round: 4, player: 0, cardId: 'summon-minion', line: 0, slot: 5 },
      { type: 'play', round: 4, player: 1, cardId: 'lane-buff', line: 2 },
      { type: 'discard', round: 6, player: 1, cardId: 'buff-minion' },
      { type: 'upgrade', round: 1, player: 0 },
      { type: 'buy-lane', round: 2, player: 1, line: 4 },
      { type: 'draw', round: 3, player: 0 },
      { type: 'ready', round: 5, player: 1 },
    ];
    for (const list of [[], actions]) {
      const record: RecordedMatch = { ...createRecord(9), actions: list };
      expect(decodeMatch(9, encodeMatch(record))).toEqual(record);
    }
  });

  it('nutzt nur URL-sichere Zeichen und bleibt kompakt', () => {
    const { record } = playScriptedMatch(42);
    const text = encodeMatch(record);
    expect(text).toMatch(/^[0-9a-z.-]+$/);
    expect(text.length).toBeLessThan(MAX_MOVES_LENGTH);
    expect(text.startsWith(`v${RECORD_VERSION}`)).toBe(true);
    expect(shareQuery(record)).toBe(`?replay=${record.seed}&moves=${text}`);
  });

  it('liefert für ungültige Daten null und wirft nie', () => {
    const { record } = playScriptedMatch(5);
    const valid = encodeMatch(record);
    const v = `v${RECORD_VERSION}`;
    const bad = [
      '',
      `${v}.`,
      `${v}..r10`,
      'v0.r10',
      'v1.r10',
      'v2.r10',
      'v3.r10',
      'v4.r10',
      'v5.r10',
      'v6.r10',
      'v8.r10',
      '7.r10',
      `V${RECORD_VERSION}.r10`,
      `${v}.x10`,
      `${v}.r90`,
      `${v}.r00`,
      `${v}.r12`,
      `${v}.r10-1`,
      `${v}.r10-`,
      `${v}.p10`,
      `${v}.p10-`,
      `${v}.p10-99`,
      `${v}.p10-01`,
      `${v}.p10--1`,
      `${v}.p10-0-5`,
      `${v}.p10-5-1-2`,
      `${v}.p10-0-1-2-3`,
      `${v}.d10`,
      `${v}.d10-99`,
      `${v}.d10-0-1`,
      `${v}.p10-1.5`,
      `${v}.p10-20`,
      `${v}.p10-12-1-2`,
      `${v}.m10-1-1`,
      `${v}.m10-1-5-0`,
      `${v}.m10-1-1-0-0`,
      `${v}.u10`,
      `${v}.u10-1-1`,
      `${v}.g10-1`,
      `${v}.w10-1`,
      `${v}.b10`,
      `${v}.b10-5`,
      `${v}.b10-1-1`,
      `${v}.p10-9999999`,
      `${v}.p10-0%20`,
      '<script>',
      `${v}.r10 `,
      `${valid}.`,
      `${valid}.zz`,
      v.padEnd(MAX_MOVES_LENGTH + 1, '.'),
      `${v}${'.r10'.repeat(MAX_MOVES_LENGTH)}`,
    ];
    for (const text of bad) expect(decodeMatch(1, text), text).toBeNull();
    expect(decodeMatch(1, undefined as unknown as string)).toBeNull();
    expect(decodeMatch(1, null as unknown as string)).toBeNull();
  });

  it('lehnt Links aus älteren Versionen ab, nimmt aber alle fünf Lane-Indizes an', () => {
    expect(RECORD_VERSION).toBe(7);
    expect(decodeMatch(1, 'v1.p10-0-0.r10')).toBeNull();
    // Ältere Versionen kennen weder Turm-Slots noch das neue Wirtschaftskonzept: Deck und Regeln wären andere.
    for (const old of ['v2', 'v3', 'v4', 'v5', 'v6']) expect(decodeMatch(1, `${old}.p10-0-0.r10`)).toBeNull();
    for (const lane of [0, 1, 2, 3, 4]) {
      expect(decodeMatch(1, `v7.p10-0-${lane}`)?.actions).toEqual([
        { type: 'play', round: 1, player: 0, cardId: 'summon-minion', line: lane },
      ]);
      expect(decodeMatch(1, `v7.p10-0-${lane}-3`)?.actions).toEqual([
        { type: 'play', round: 1, player: 0, cardId: 'summon-minion', line: lane, slot: 3 },
      ]);
      expect(decodeMatch(1, `v7.m10-1-${lane}-0`)?.actions).toEqual([
        { type: 'move', round: 1, player: 0, minionId: 1, line: lane, slot: 0 },
      ]);
      expect(decodeMatch(1, `v7.b10-${lane}`)?.actions).toEqual([{ type: 'buy-lane', round: 1, player: 0, line: lane }]);
    }
    expect(decodeMatch(1, 'v7.p10-0-5')).toBeNull();
    expect(decodeMatch(1, 'v7.g11.w20')?.actions).toEqual([
      { type: 'upgrade', round: 1, player: 1 },
      { type: 'draw', round: 2, player: 0 },
    ]);
    expect(decodeMatch(1, 'v7.d20-3')?.actions).toEqual([{ type: 'discard', round: 2, player: 0, cardId: 'summon-healer' }]);
  });

  it('kodiert die Ziel-Minion-ID der Karte „Minion stärken“ und liest sie zurück', () => {
    const actions: RecordedAction[] = [
      { type: 'play', round: 2, player: 0, cardId: 'buff-minion', line: null, minionId: 7 },
      { type: 'play', round: 3, player: 1, cardId: 'buff-minion', line: null, minionId: 0 },
    ];
    const record: RecordedMatch = { ...createRecord(9), actions };
    const text = encodeMatch(record);
    expect(text).toBe('v7.p20-12-7.p31-12-0');
    expect(decodeMatch(9, text)).toEqual(record);
  });

  it('bricht das Nachspielen von „Minion stärken“ ohne gültiges Ziel mit invalid-target ab', () => {
    const seed = 3;
    const cardId = 'buff-minion';
    const state = createMatch(seed);
    state.players[0].hand = [cardId];
    expect(applyAction(state, { type: 'play', round: 1, player: 0, cardId, line: null })).toMatchObject({
      ok: false,
      reason: 'invalid-target',
    });
    expect(applyAction(state, { type: 'play', round: 1, player: 0, cardId, line: 1, minionId: 1 })).toMatchObject({
      ok: false,
      reason: 'invalid-line',
    });
  });

  it('bricht das Nachspielen ab, wenn eine Aktion eine noch gesperrte Lane nutzt', () => {
    const seed = 3;
    const cardId = createMatch(seed).players[0].hand.find((id) => getCardDef(id).type === 'summon')!;
    const result = replayRecorded({
      ...createRecord(seed),
      actions: [{ type: 'play', round: 1, player: 0, cardId, line: 3 }],
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-line', index: 0 });
  });

  it('weist abgeschnittene Zeichenfolgen ab oder liefert eine gültige, nie eine Ausnahme', () => {
    const valid = encodeMatch(playScriptedMatch(5).record);
    let nulls = 0;
    for (let length = 0; length <= valid.length; length += 1) {
      const decoded = decodeMatch(5, valid.slice(0, length));
      if (decoded === null) nulls += 1;
      else expect(decoded.actions.length).toBeLessThanOrEqual(valid.split('.').length - 1);
    }
    expect(nulls).toBeGreaterThan(0);
    // Das Nachspielen eines Präfixes (kein Spielende) wird kontrolliert abgelehnt.
    const cut = decodeMatch(5, valid.slice(0, Math.floor(valid.length / 2)));
    if (cut) expect(replayRecorded(cut).ok).toBe(false);
  });

  it('lehnt einen unzulässigen Seed ab', () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decodeMatch(seed, `v${RECORD_VERSION}`)).toBeNull();
    }
    expect(decodeMatch(0, `v${RECORD_VERSION}`)).toEqual({ ...createRecord(0) });
  });

  it('manipulierte, aber lesbare Daten bricht erst das Nachspielen ab', () => {
    const text = encodeMatch(playScriptedMatch(5).record).replace(/^v7\./, 'v7.p10-0.p10-0.p10-0.p10-0.p10-0.p10-0.');
    const decoded = decodeMatch(5, text);
    expect(decoded).not.toBeNull();
    const result = replayRecorded(decoded!);
    expect(result.ok).toBe(false);
  });

  it('spielt Spezialisierungen aus der Aufzeichnung und dem Link identisch nach', () => {
    let found = 0;
    for (let seed = 1; seed <= 40 && found < 2; seed += 1) {
      const { state, record } = playScriptedMatch(seed);
      const specialized = state.players.flatMap((p) => p.lines.flatMap((l) => l.towers)).some((t) => t.specialization);
      if (!specialized) continue;
      found += 1;
      const replayed = replayRecorded(decodeMatch(seed, encodeMatch(record))!);
      expect(replayed.ok).toBe(true);
      expect(replayed.state).toEqual(state);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('hält die Kartenliste fest: Änderungen daran verlangen eine neue Version', () => {
    expect(CARD_DEFS.map((def) => def.id)).toEqual([
      'summon-minion',
      'summon-brute',
      'summon-archer',
      'summon-healer',
      'summon-destroyer',
      'line-upgrade',
      'tower-hp',
      'tower-damage',
      'tower-lightning',
      'tower-shield',
      'minion-upgrade-line',
      'minion-upgrade-all',
      'buff-minion',
      'summon-scout',
      'summon-guard',
      'summon-mage',
      'lane-buff',
      'lane-shield',
      'tower-armor',
      'minion-upgrade-elite',
    ]);
    expect(RECORD_VERSION).toBe(7);
  });
});

describe('wrapText', () => {
  it('teilt in Zeilen fester Länge und behält den Inhalt', () => {
    expect(wrapText('abcdefg', 3)).toEqual(['abc', 'def', 'g']);
    expect(wrapText('', 3)).toEqual([]);
    expect(wrapText('abc', 0)).toEqual(['a', 'b', 'c']);
    expect(wrapText('x'.repeat(100), 40).join('')).toBe('x'.repeat(100));
  });
});
