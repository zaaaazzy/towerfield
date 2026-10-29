import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BALANCE_COUNT,
  DEFAULT_BALANCE_SEED,
  formatBalanceTable,
  formatPercent,
  formatSignedPercent,
  MAX_BALANCE_COUNT,
  parseBalanceArgs,
  sortCardsByDelta,
} from './balance-format';
import { buildReport, type CardStats } from './balance-sim';

const card = (cardId: string, deltaToBaseline: number): CardStats => ({
  cardId,
  matchesWithCard: 10,
  plays: 12,
  winRate: 0.5 + deltaToBaseline,
  drawRate: 0,
  lossRate: 0.5 - deltaToBaseline,
  deltaToBaseline,
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
