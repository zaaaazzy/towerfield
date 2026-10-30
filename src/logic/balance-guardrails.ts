/**
 * Leitplanken für den Balance-Bericht: grobe Grenzen, damit eine Karte oder Seite mit starkem Ungleichgewicht sofort
 * auffällt. Reine Funktionen, ohne Phaser, DOM und Canvas. Die Grenzen werden nie automatisch angepasst.
 */
import { formatPercent, formatSignedPercent } from './balance-format';
import type { BalanceReport } from './balance-sim';

/** Erlaubter Bereich der Siegquote je Seite (40–60 %). */
export const MIN_SIDE_WIN_RATE = 0.4;
export const MAX_SIDE_WIN_RATE = 0.6;
/** Höchste erlaubte |deltaToBaseline| je Karte: 15 Prozentpunkte. */
export const MAX_CARD_DELTA = 0.15;
/**
 * Mindestzahl an Spieler-Matches mit der Karte (`matchesWithCard`). Darunter streut `deltaToBaseline` zu stark
 * (bei 30 Matches rund ±9 Punkte Standardabweichung), und Karten ohne Einsatz haben ohnehin Delta 0.
 */
export const MIN_CARD_SAMPLE = 30;

/** Liefert die Verstösse des Berichts gegen die Leitplanken als Klartext; leer, wenn alles passt. */
export function checkGuardrails(report: BalanceReport): string[] {
  const violations: string[] = [];
  for (const [side, value] of [
    ['winRatePlayer0', report.winRatePlayer0],
    ['winRatePlayer1', report.winRatePlayer1],
  ] as const) {
    if (value < MIN_SIDE_WIN_RATE || value > MAX_SIDE_WIN_RATE) {
      violations.push(
        `${side} = ${formatPercent(value)} liegt ausserhalb von ${formatPercent(MIN_SIDE_WIN_RATE)}–${formatPercent(MAX_SIDE_WIN_RATE)}`,
      );
    }
  }
  for (const card of report.cards) {
    if (card.matchesWithCard < MIN_CARD_SAMPLE) continue;
    if (Math.abs(card.deltaToBaseline) > MAX_CARD_DELTA) {
      violations.push(
        `${card.cardId}: deltaToBaseline = ${formatSignedPercent(card.deltaToBaseline)} (winRate ${formatPercent(card.winRate)}, ${card.matchesWithCard} Matches) überschreitet ±${formatPercent(MAX_CARD_DELTA)}`,
      );
    }
  }
  return violations;
}
