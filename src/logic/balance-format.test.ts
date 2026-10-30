import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BALANCE_COUNT,
  DEFAULT_BALANCE_SEED,
  formatBalanceTable,
  formatPercent,
  formatSignedPercent,
  formatTimingRows,
  MAX_BALANCE_COUNT,
  parseBalanceArgs,
  sortCardsByDelta,
  TIMING_CARD_IDS,
} from './balance-format';
import { buildReport, type CardStats, type CardTiming } from './balance-sim';

const card = (cardId: string, deltaToBaseline: number, timing: Partial<CardTiming> = {}): CardStats => ({
  cardId,
  matchesWithCard: 10,
  plays: 12,
  winRate: 0.5 + deltaToBaseline,
  drawRate: 0,
  lossRate: 0.5 - deltaToBaseline,
  deltaToBaseline,
  timing: {
    playsByRound: [0, 0, 5, 4, 3, 0, 0, 0],
    playsByLaneLevel: [0, 12, 0],
    playsByFieldLevel: [0, 7, 5],
    avgPlayRound: 3.833,
    discards: 9,
    discardsByRound: [0, 0, 0, 0, 9, 0, 0, 0],
    held: 4,
    ...timing,
  },
});

describe('Prozentdarstellung', () => {
  it('rundet auf eine Nachkommastelle', () => {
    expect(formatPercent(0.5)).toBe('50.0 %');
    expect(formatPercent(0.51449)).toBe('51.4 %');
    expect(formatPercent(0)).toBe('0.0 %');
    expect(formatPercent(1)).toBe('100.0 %');
  });

  it('zeigt Vorzeichen und unterdrückt „-0.0“', () => {
    expect(formatSignedPercent(0.052)).toBe('+5.2 %');
    expect(formatSignedPercent(-0.291)).toBe('-29.1 %');
    expect(formatSignedPercent(0)).toBe('0.0 %');
    expect(formatSignedPercent(-0.00001)).toBe('0.0 %');
    expect(formatSignedPercent(0.00001)).toBe('0.0 %');
  });
});

describe('Sortierung', () => {
  it('sortiert nach |deltaToBaseline| absteigend, Gleichstand nach cardId, ohne das Original zu ändern', () => {
    const input = [card('b', 0.01), card('a', -0.01), card('c', -0.3), card('d', 0.05)];
    expect(sortCardsByDelta(input).map((c) => c.cardId)).toEqual(['c', 'd', 'a', 'b']);
    expect(input.map((c) => c.cardId)).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('Tabelle', () => {
  const report = {
    ...buildReport([], 7),
    totalMatches: 4,
    winRatePlayer0: 0.5,
    winRatePlayer1: 0.25,
    drawRate: 0.25,
    avgRounds: 6.784,
    towerKillShare: 0.75,
    roundLimitShare: 0.25,
    cards: [card('small', 0.01), card('big', -0.3)],
  };
  const lines = formatBalanceTable(report).split('\n');

  it('hat Kopf mit allen Kennzahlen', () => {
    expect(lines).toContain('startSeed:       7');
    expect(lines).toContain('totalMatches:    4');
    expect(lines).toContain('winRatePlayer0:  50.0 %');
    expect(lines).toContain('winRatePlayer1:  25.0 %');
    expect(lines).toContain('drawRate:        25.0 %');
    expect(lines).toContain('avgRounds:       6.78');
    expect(lines).toContain('towerKillShare:  75.0 %');
    expect(lines).toContain('roundLimitShare: 25.0 %');
  });

  it('listet Karten sortiert unter einer Kopfzeile', () => {
    const headIndex = lines.findIndex((line) => line.startsWith('cardId'));
    expect(lines[headIndex]).toContain('deltaToBaseline');
    expect(lines[headIndex + 1]).toMatch(/^big\s.*-30\.0 %$/);
    expect(lines[headIndex + 2]).toMatch(/^small\s.*\+1\.0 %$/);
  });

  it('enthält die Ereigniszähler, auch mit 0', () => {
    expect(lines.some((line) => line.startsWith('event'))).toBe(true);
    expect(lines.some((line) => /^energy\s+0$/.test(line))).toBe(true);
  });
});

describe('Zeitpunkt der Zielkarten', () => {
  const report = {
    ...buildReport([], 1),
    cards: [
      card('tower-lightning', -0.29),
      card('line-upgrade', 0.005, { playsByRound: [6, 6, 0, 0, 0, 0, 0, 0], avgPlayRound: 1.5, discards: 0, held: 0 }),
      card('summon-minion', 0.01),
    ],
  };

  it('nennt die vier Zielkarten', () => {
    expect([...TIMING_CARD_IDS]).toEqual(['tower-lightning', 'tower-shield', 'line-upgrade', 'minion-upgrade-elite']);
  });

  it('listet je vorhandener Zielkarte eine Zeile mit Runden, Lane-Leveln, mittlerer Runde, Abwürfen und Hand', () => {
    const rows = formatTimingRows(report);
    expect(rows[0]).toMatch(/^timing\s+R1\s+R2\s+R3\s+R4\s+R5\s+R6\s+R7\s+R8\s+L1\s+L2\s+L3\s+avgRound\s+discards\s+held$/);
    expect(rows[1]).toMatch(/^tower-lightning\s+0\s+0\s+5\s+4\s+3\s+0\s+0\s+0\s+0\s+12\s+0\s+3\.83\s+9\s+4$/);
    expect(rows[2]).toMatch(/^line-upgrade\s+6\s+6\s+0\s+0\s+0\s+0\s+0\s+0\s+0\s+12\s+0\s+1\.50\s+0\s+0$/);
    expect(rows).toHaveLength(3);
  });

  it('erscheint in der Tabelle, auch ohne Zielkarten und ohne Karten (kein Absturz)', () => {
    expect(formatBalanceTable(report).split('\n').some((line) => line.startsWith('tower-lightning') && line.endsWith('4'))).toBe(true);
    expect(formatTimingRows({ ...report, cards: [card('summon-minion', 0)] })).toHaveLength(1);
    expect(formatTimingRows({ ...report, cards: [] })).toEqual(['timing  avgRound  discards  held']);
  });
});

describe('Argumente', () => {
  it('liefert ohne Argumente die Vorgaben', () => {
    expect(parseBalanceArgs([])).toEqual({
      ok: true,
      options: { seed: DEFAULT_BALANCE_SEED, count: DEFAULT_BALANCE_COUNT, format: 'both' },
    });
    expect(DEFAULT_BALANCE_COUNT).toBeGreaterThanOrEqual(1000);
  });

  it('liest beide Schreibweisen', () => {
    expect(parseBalanceArgs(['--seed', '5', '--count=20', '--format', 'json'])).toEqual({
      ok: true,
      options: { seed: 5, count: 20, format: 'json' },
    });
    expect(parseBalanceArgs(['--format=table'])).toMatchObject({ ok: true, options: { format: 'table' } });
  });

  it.each([
    [['--count', '0']],
    [['--count', 'abc']],
    [['--count', '1.5']],
    [['--count', '-3']],
    [['--count', String(MAX_BALANCE_COUNT + 1)]],
    [['--seed', '-1']],
    [['--seed', 'x']],
    [['--seed', '4294967296']],
    [['--format', 'xml']],
    [['--count']],
    [['--unbekannt', '1']],
    [['5']],
  ])('lehnt %j mit Fehlermeldung ab', (args) => {
    const result = parseBalanceArgs(args);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
