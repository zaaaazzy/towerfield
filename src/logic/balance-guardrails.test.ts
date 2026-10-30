import { describe, expect, it } from 'vitest';
import {
  checkGuardrails,
  MAX_CARD_DELTA,
  MAX_SIDE_WIN_RATE,
  MIN_CARD_SAMPLE,
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

const reportWith = (overrides: Partial<ReturnType<typeof buildReport>>) => ({
  ...buildReport([], 1),
  winRatePlayer0: 0.5,
  winRatePlayer1: 0.5,
  ...overrides,
});

describe('checkGuardrails', () => {
  it('meldet bei ausgeglichenem Bericht nichts', () => {
    expect(checkGuardrails(reportWith({ cards: [card('a', 0.05), card('b', -MAX_CARD_DELTA)] }))).toEqual([]);
    expect(checkGuardrails(reportWith({ winRatePlayer0: MIN_SIDE_WIN_RATE, winRatePlayer1: MAX_SIDE_WIN_RATE }))).toEqual(
      [],
    );
  });

  it('erkennt eine Seite ausserhalb von 40–60 % und nennt Seite und Wert', () => {
    const low = checkGuardrails(reportWith({ winRatePlayer0: 0.35, winRatePlayer1: 0.65 }));
    expect(low).toHaveLength(2);
    expect(low[0]).toContain('winRatePlayer0 = 35.0 %');
    expect(low[1]).toContain('winRatePlayer1 = 65.0 %');
  });

  it('erkennt eine Karte über ±15 Punkte und nennt Karte und Wert', () => {
    const violations = checkGuardrails(reportWith({ cards: [card('stark', 0.2), card('schwach', -0.29), card('ok', 0.1)] }));
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('stark: deltaToBaseline = +20.0 %');
    expect(violations[1]).toContain('schwach: deltaToBaseline = -29.0 %');
  });

  it('wertet Karten ohne Einsätze nicht als Verstoss', () => {
    expect(checkGuardrails(reportWith({ cards: [card('unbenutzt', 0, 0)] }))).toEqual([]);
  });

  it('wertet Karten unter der Mindeststichprobe nicht als Verstoss', () => {
    const cards = [card('selten', 0.4, MIN_CARD_SAMPLE - 1), card('genug', 0.4, MIN_CARD_SAMPLE)];
    expect(checkGuardrails(reportWith({ cards })).map((line) => line.split(':')[0])).toEqual(['genug']);
  });
});

/**
 * Leitplanken-Test gegen den echten Kartenbestand. Gemessen brauchen 400 Matches hier rund 4,2 s und kämen zu nahe an
 * den 5 s Vitest-Standard-Timeout; 200 Matches brauchen etwa die Hälfte. Das reicht für die Leitplanken (auch
 * die seltensten Karten kommen auf mehrere Dutzend Spieler-Matches, über der Mindeststichprobe). Die Matchzahl der Dev-Szene
 * (1000) bleibt unberührt.
 */
const START_SEED = 1;
const MATCH_COUNT = 200;
/**
 * Bekannte Abweichungen, die der Auftrag nur melden soll (docs/anwendung-balance-cli.md): Der Bot spielt Blitz- und
 * Schild-Turm bei Seed 1 mit rund −29 Punkten. Sie werden hier ausgenommen, die Grenzen bleiben unverändert. Wird eine
 * Karte ausgeglichen, den Eintrag löschen.
 */
const KNOWN_DEVIATIONS = ['tower-shield', 'tower-lightning'];

describe(`Leitplanken (Seed ${START_SEED}, ${MATCH_COUNT} Matches)`, () => {
  it('hält Seiten und Karten innerhalb der Grenzen', () => {
    const report = runSimulation({ startSeed: START_SEED, count: MATCH_COUNT });
    const violations = checkGuardrails(report).filter(
      (line) => !KNOWN_DEVIATIONS.some((id) => line.startsWith(`${id}:`)),
    );
    expect(violations, `Leitplanken verletzt:\n${violations.join('\n')}`).toEqual([]);
  });
});
