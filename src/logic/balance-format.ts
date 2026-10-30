/**
 * Formatierung des Balance-Berichts und Argument-Auswertung für `npm run balance`. Reine Funktionen, ohne Phaser,
 * DOM und Canvas.
 */
import type { BalanceReport, CardStats } from './balance-sim';

export type BalanceFormat = 'table' | 'json';

export interface BalanceCliOptions {
  seed: number;
  count: number;
  format: BalanceFormat;
}

export type ParseResult = { ok: true; options: BalanceCliOptions } | { ok: false; error: string };

/** Standard-Startseed des CLI. */
export const DEFAULT_BALANCE_SEED = 1;
/** Standard-Matchzahl für CLI und Regressionstest (Untergrenze 1000 aus dem Bug „Simulation auf 1000 Matches“). */
export const DEFAULT_BALANCE_COUNT = 1000;
/** Obergrenze, damit ein Tippfehler den Lauf nicht für Stunden blockiert. */
export const MAX_BALANCE_COUNT = 1_000_000;

const MAX_SEED = 0xffffffff;

/** Prozentdarstellung mit einer Nachkommastelle, z. B. `0.5` → `50.0 %`. */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

/** Vorzeichenbehaftete Prozentpunkte, z. B. `0.052` → `+5.2 %`. */
export function formatSignedPercent(value: number): string {
  const text = formatPercent(value);
  if (text === '0.0 %' || text === '-0.0 %') return '0.0 %';
  return value > 0 ? `+${text}` : text;
}

/** Karten nach |deltaToBaseline| absteigend; bei Gleichstand nach `cardId`. Das Original bleibt unverändert. */
export function sortCardsByDelta(cards: readonly CardStats[]): CardStats[] {
  return [...cards].sort(
    (a, b) => Math.abs(b.deltaToBaseline) - Math.abs(a.deltaToBaseline) || a.cardId.localeCompare(b.cardId),
  );
}

/** Rendert Zeilen als Spalten mit fester Breite: erste Spalte links, übrige rechts ausgerichtet. */
function renderRows(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) =>
    row.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!))).join('  ').trimEnd(),
  );
}

/** Lesbare Tabelle: Kopfwerte, eine Zeile je Karte (sortiert) und die Ereigniszähler. */
export function formatBalanceTable(report: BalanceReport): string {
  const header = [
    `startSeed:       ${report.startSeed}`,
    `totalMatches:    ${report.totalMatches}`,
    `winRatePlayer0:  ${formatPercent(report.winRatePlayer0)}`,
    `winRatePlayer1:  ${formatPercent(report.winRatePlayer1)}`,
    `drawRate:        ${formatPercent(report.drawRate)}`,
    `avgRounds:       ${report.avgRounds.toFixed(2)}`,
    `baselineWinRate: ${formatPercent(report.baselineWinRate)}`,
    `towerKillShare:  ${formatPercent(report.towerKillShare)}`,
    `roundLimitShare: ${formatPercent(report.roundLimitShare)}`,
  ];
  const cardRows = [
    ['cardId', 'matchesWithCard', 'plays', 'winRate', 'drawRate', 'lossRate', 'deltaToBaseline'],
    ...sortCardsByDelta(report.cards).map((card) => [
      card.cardId,
      String(card.matchesWithCard),
      String(card.plays),
      formatPercent(card.winRate),
      formatPercent(card.drawRate),
      formatPercent(card.lossRate),
      formatSignedPercent(card.deltaToBaseline),
    ]),
  ];
  const eventRows = [['event', 'count'], ...Object.entries(report.eventCounts).map(([id, n]) => [id, String(n)])];
  return [...header, '', ...renderRows(cardRows), '', ...renderRows(eventRows)].join('\n');
}

function parseInteger(name: string, raw: string, min: number, max: number): number | string {
  if (!/^\d+$/.test(raw)) return `--${name} erwartet eine ganze Zahl, erhalten: „${raw}“.`;
  const value = Number(raw);
  if (value < min || value > max) return `--${name} muss zwischen ${min} und ${max} liegen, erhalten: ${raw}.`;
  return value;
}

/** Wertet `--seed`, `--count` und `--json` aus (Werte als `--name wert` oder `--name=wert`). */
export function parseBalanceArgs(args: readonly string[]): ParseResult {
  const options: BalanceCliOptions = { seed: DEFAULT_BALANCE_SEED, count: DEFAULT_BALANCE_COUNT, format: 'table' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') {
      options.format = 'json';
      continue;
    }
    const match = /^--(seed|count)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, error: `Unbekanntes Argument „${arg}“. Erlaubt: --seed, --count, --json.` };
    const name = match[1] as 'seed' | 'count';
    let raw = match[2];
    if (raw === undefined) {
      raw = args[index + 1];
      index += 1;
    }
    if (raw === undefined) return { ok: false, error: `--${name} braucht einen Wert.` };
    const value =
      name === 'seed' ? parseInteger(name, raw, 0, MAX_SEED) : parseInteger(name, raw, 1, MAX_BALANCE_COUNT);
    if (typeof value === 'string') return { ok: false, error: value };
    options[name] = value;
  }
  return { ok: true, options };
}
