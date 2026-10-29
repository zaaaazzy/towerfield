/**
 * Leitplanken für den Balance-Bericht: grobe Grenzen, damit ein starkes Ungleichgewicht sofort auffällt.
 * Reine Funktionen, ohne Phaser, DOM und Canvas. Die Grenzen werden nie automatisch angepasst.
 */
import type { BalanceReport } from './balance-sim';
import { formatPercent, formatSignedPercent } from './balance-format';

/** Erlaubter Bereich der Siegquote je Seite. */
export const MIN_SIDE_WIN_RATE = 0.4;
export const MAX_SIDE_WIN_RATE = 0.6;
/** Höchste erlaubte Abweichung `deltaToBaseline` je Karte (15 Prozentpunkte), als Betrag. */
export const MAX_CARD_DELTA = 0.15;
/** Mindest-Stichprobe (`matchesWithCard`); darunter streut `deltaToBaseline` zu stark und zählt nicht als Verstoss. */
export const MIN_CARD_MATCHES = 30;

/**
 * Bekannte, gemeldete Abweichungen (Karten-ID → Begründung). Sie sind keine Freigabe der Balance, sondern halten den
 * Test grün, bis das Ungleichgewicht bewusst behoben wird. Neue Einträge nur nach Meldung an den Auftraggeber.
 */
export const KNOWN_CARD_DEVIATIONS: Readonly<Record<string, string>> = {
  'tower-shield': 'Siegquote rund 29 Punkte unter der Basis (Messlauf Seed 1, 1000 Matches); gemeldet, nicht behoben.',
  'tower-lightning': 'Siegquote rund 29 Punkte unter der Basis (Messlauf Seed 1, 1000 Matches); gemeldet, nicht behoben.',
};

/** Prüft den Bericht und liefert die Verstösse als Klartext (leer: alles im Rahmen). */
export function checkGuardrails(
  report: BalanceReport,
  knownDeviations: Readonly<Record<string, string>> = KNOWN_CARD_DEVIATIONS,
): string[] {
  const violations: string[] = [];
  const sides: [string, number][] = [
    ['winRatePlayer0', report.winRatePlayer0],
    ['winRatePlayer1', report.winRatePlayer1],
  ];
  for (const [side, value] of sides) {
    if (value < MIN_SIDE_WIN_RATE || value > MAX_SIDE_WIN_RATE) {
      violations.push(
        `${side} = ${formatPercent(value)} liegt ausserhalb von ${formatPercent(MIN_SIDE_WIN_RATE)}–${formatPercent(MAX_SIDE_WIN_RATE)}`,
      );
    }
  }
  for (const card of report.cards) {
    if (card.matchesWithCard < MIN_CARD_MATCHES || knownDeviations[card.cardId] !== undefined) continue;
    if (Math.abs(card.deltaToBaseline) > MAX_CARD_DELTA) {
      violations.push(
        `${card.cardId}: deltaToBaseline = ${formatSignedPercent(card.deltaToBaseline)} überschreitet ±${formatPercent(MAX_CARD_DELTA)} (${card.matchesWithCard} Matches)`,
      );
    }
  }
  return violations;
}
