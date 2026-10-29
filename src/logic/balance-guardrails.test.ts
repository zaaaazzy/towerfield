import { describe, expect, it } from 'vitest';
import {
  checkGuardrails,
  KNOWN_CARD_DEVIATIONS,
  MAX_CARD_DELTA,
  MIN_CARD_MATCHES,
  MIN_SIDE_WIN_RATE,
} from './balance-guardrails';
import { buildReport, type CardStats, runSimulation } from './balance-sim';

const card = (cardId: string, deltaToBaseline: number, matchesWithCard = 100): CardStats => ({
  cardId,
  matchesWithCard,
  plays: matchesWithCard,
  winRate: 0.5 + deltaToBaseline,
  drawRate: 0,
  lossRate: 0.5 - deltaToBaseline,
  deltaToBaseline,
});

const report = (overrides: Partial<ReturnType<typeof buildReport>> = {}) => ({
  ...buildReport([], 1),
  totalMatches: 100,
  winRatePlayer0: 0.5,
  winRatePlayer1: 0.5,
  baselineWinRate: 0.5,
  ...overrides,
});

describe('checkGuardrails', () => {
  it('meldet nichts bei einem ausgeglichenen Bericht', () => {
    expect(checkGuardrails(report({ cards: [card('a', 0.05), card('b', -MAX_CARD_DELTA)] }), {})).toEqual([]);
  });

  it('erkennt eine Seite unter 40 % und eine über 60 %', () => {
    const low = checkGuardrails(report({ winRatePlayer0: 0.35, winRatePlayer1: 0.65 }), {});
    expect(low).toHaveLength(2);
    expect(low[0]).toContain('winRatePlayer0 = 35.0 %');
    expect(low[1]).toContain('winRatePlayer1 = 65.0 %');
    expect(checkGuardrails(report({ winRatePlayer0: MIN_SIDE_WIN_RATE, winRatePlayer1: 0.6 }), {})).toEqual([]);
  });

  it('erkennt eine Karte über +15 und unter −15 Punkten mit Name und Wert', () => {
    const result = checkGuardrails(report({ cards: [card('hoch', 0.2), card('tief', -0.2), card('ok', 0.1)] }), {});
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('hoch: deltaToBaseline = +20.0 %');
    expect(result[1]).toContain('tief: deltaToBaseline = -20.0 %');
  });

  it('wertet Karten ohne Einsätze und mit zu kleiner Stichprobe nicht als Verstoss', () => {
    const cards = [card('leer', 0, 0), card('selten', -0.4, MIN_CARD_MATCHES - 1), card('genug', -0.4, MIN_CARD_MATCHES)];
    const result = checkGuardrails(report({ cards }), {});
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('genug');
  });

  it('überspringt bekannte Abweichungen, meldet sie aber ohne Eintrag', () => {
    const cards = [card('bekannt', -0.3)];
    expect(checkGuardrails(report({ cards }), { bekannt: 'Grund' })).toEqual([]);
    expect(checkGuardrails(report({ cards }), {})).toHaveLength(1);
  });

  it('nutzt standardmässig die Liste der bekannten Abweichungen', () => {
    const [id] = Object.keys(KNOWN_CARD_DEVIATIONS);
    expect(checkGuardrails(report({ cards: [card(id!, -0.3)] }))).toEqual([]);
  });
});

describe('Leitplanken gegen die Simulation', () => {
  /**
   * 500 Matches brauchten gemessen 4,5 s und damit fast den Vitest-Standard-Timeout von 5 s. 200 Matches brauchen
   * rund 1,8 s, lassen also Reserve für langsamere Rechner. Seltene Karten haben dabei noch über `MIN_CARD_MATCHES`
   * Matches; kleinere Stichproben zählen ohnehin nicht. Den Dauerlauf mit 1000 Matches macht `npm run balance`.
   */
  it('hält Seitenquoten und Kartenabweichungen im Rahmen (Seed 1, 200 Matches)', () => {
    const violations = checkGuardrails(runSimulation({ startSeed: 1, count: 200 }));
    expect(violations, `Leitplanken verletzt:\n${violations.join('\n')}`).toEqual([]);
  });
});
