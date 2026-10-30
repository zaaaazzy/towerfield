import { describe, expect, it } from 'vitest';
import { buildCoverageReport, formatPercent } from './coverage-report';

const metric = (pct: number) => ({ total: 10, covered: 10, skipped: 0, pct });
const summary = {
  total: { lines: metric(99.92), branches: metric(99.72), functions: metric(100), statements: metric(99.94) },
};

describe('buildCoverageReport', () => {
  it('liefert genau drei Zeilen mit den festen Bereichsnamen', () => {
    const r = buildCoverageReport(summary, 4, 2);
    expect(r).toEqual({
      ok: true,
      lines: [
        'Logik: Zeilen 99,9 %, Zweige 99,7 %, Funktionen 100,0 %, Anweisungen 99,9 %',
        'Szenen-E2E: 4 Tests',
        'Smoke: 2 Tests',
      ],
      text: expect.any(String),
    });
    if (r.ok) expect(r.text.split('\n')).toEqual(r.lines);
  });

  it('gibt für Szenen-E2E und Smoke keinen Prozentwert aus', () => {
    const r = buildCoverageReport(summary, 0, 0);
    if (!r.ok) throw new Error('erwartet ok');
    expect(r.lines[1]).not.toContain('%');
    expect(r.lines[2]).not.toContain('%');
  });

  it.each([
    ['null', null],
    ['Zahl', 5],
    ['ohne total', {}],
    ['total ohne Metrik', { total: {} }],
    ['Metrik ohne pct', { total: { ...summary.total, lines: {} } }],
    ['pct als Text', { total: { ...summary.total, branches: { pct: '99' } } }],
    ['pct "Unknown"', { total: { ...summary.total, functions: { pct: 'Unknown' } } }],
    ['pct NaN', { total: { ...summary.total, statements: { pct: NaN } } }],
    ['pct über 100', { total: { ...summary.total, lines: { pct: 101 } } }],
    ['pct negativ', { total: { ...summary.total, lines: { pct: -1 } } }],
  ])('meldet ungültige Summary (%s) als Fehler', (_name, bad) => {
    const r = buildCoverageReport(bad, 1, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Coverage-Summary ungültig');
  });

  it('nennt das fehlende Feld bei der Metrik', () => {
    const r = buildCoverageReport({ total: { ...summary.total, branches: undefined } }, 1, 1);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('total.branches.pct') });
  });

  it.each([undefined, -1, 1.5, '3', NaN])('meldet ungültige Testanzahl %s', (bad) => {
    const e2e = buildCoverageReport(summary, bad, 1);
    expect(e2e).toEqual({ ok: false, error: expect.stringContaining('Szenen-E2E') });
    const smoke = buildCoverageReport(summary, 1, bad);
    expect(smoke).toEqual({ ok: false, error: expect.stringContaining('Smoke') });
  });
});

describe('formatPercent', () => {
  it('formatiert mit einer Dezimalstelle und Dezimalkomma', () => {
    expect(formatPercent(95.49)).toBe('95,5');
    expect(formatPercent(100)).toBe('100,0');
    expect(formatPercent(0)).toBe('0,0');
  });
});
