/**
 * Regressionsgrenzen für die Balance. Fester Seed-Bereich, daher reproduzierbar: ändert sich eine Karte oder ein
 * Wert, zeigt dieser Test die Wirkung sofort. Vorgehen bei gewollten Änderungen: docs/anwendung-balance-cli.md.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BALANCE_COUNT, formatPercent } from './balance-format';
import { runSimulation } from './balance-sim';

/** Fester Startseed des Regressionslaufs. */
const START_SEED = 1;
/** Matches des Regressionslaufs; gleich der CLI-Vorgabe, mindestens 1000 (Bug „Simulation auf 1000 Matches“). */
const MATCH_COUNT = DEFAULT_BALANCE_COUNT;
/** Erlaubter Bereich der Siegquote je Seite. */
const MIN_SIDE_WIN_RATE = 0.4;
const MAX_SIDE_WIN_RATE = 0.6;
/**
 * Grenzwert für |deltaToBaseline| je Karte. Messlauf (Seed 1, 1000 Matches): grösste Abweichung 0,286
 * (tower-shield −28,6 %, tower-lightning −27,6 %), alle übrigen unter 0,04. 0,40 lässt Reserve, bleibt aber weit.
 */
const MAX_CARD_DELTA = 0.4;
/**
 * Ziel für die beiden Spezialisierungskarten: |deltaToBaseline| ≤ 0,15. Es ist ohne Änderung von Kartenwerten nicht
 * erreichbar (Ursache: docs/anwendung-balance-cli.md, „Ursache der Abweichung“). Bis dahin gilt die engere Grenze
 * 0,35 als Rückfall-Schutz; sie wird mit dem Kartenwert-Auftrag auf 0,15 gesenkt.
 */
const MAX_SPECIALIZE_DELTA = 0.35;
const SPECIALIZE_CARDS = ['tower-lightning', 'tower-shield'];

describe('Balance-Regression (Seed 1, 1000 Matches)', () => {
  const report = runSimulation({ startSeed: START_SEED, count: MATCH_COUNT });

  it('simuliert den vollen Seed-Bereich', () => {
    expect(report.totalMatches).toBe(MATCH_COUNT);
    expect(report.startSeed).toBe(START_SEED);
  });

  it.each([
    ['winRatePlayer0', report.winRatePlayer0],
    ['winRatePlayer1', report.winRatePlayer1],
  ])('%s liegt zwischen 40 und 60 %%', (side, value) => {
    expect(
      value >= MIN_SIDE_WIN_RATE && value <= MAX_SIDE_WIN_RATE,
      `${side} = ${formatPercent(value)} (${value}) liegt ausserhalb von ${MIN_SIDE_WIN_RATE}–${MAX_SIDE_WIN_RATE}`,
    ).toBe(true);
  });

  it('keine Karte überschreitet den Grenzwert für |deltaToBaseline|', () => {
    const violations = report.cards
      .filter((card) => Math.abs(card.deltaToBaseline) > MAX_CARD_DELTA)
      .map((card) => `${card.cardId}: deltaToBaseline = ${card.deltaToBaseline.toFixed(4)}`);
    expect(violations, `Grenzwert ${MAX_CARD_DELTA} überschritten von: ${violations.join('; ')}`).toEqual([]);
  });

  it('die Spezialisierungskarten bleiben unter dem engeren Rückfall-Grenzwert', () => {
    const cards = report.cards.filter((card) => SPECIALIZE_CARDS.includes(card.cardId));
    expect(cards).toHaveLength(SPECIALIZE_CARDS.length);
    for (const card of cards) {
      expect(card.matchesWithCard, `${card.cardId} wird nie gespielt`).toBeGreaterThan(0);
      expect(Math.abs(card.deltaToBaseline), `${card.cardId}: ${card.deltaToBaseline.toFixed(4)}`).toBeLessThanOrEqual(
        MAX_SPECIALIZE_DELTA,
      );
    }
  });

  it('line-upgrade wird im Messlauf gespielt (als Feld-Upgrade)', () => {
    const card = report.cards.find((c) => c.cardId === 'line-upgrade')!;
    expect(card.matchesWithCard).toBeGreaterThan(0);
  });
});
