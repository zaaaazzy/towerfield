/**
 * Einheitliche Coverage-Berichtsvorlage: genau drei Zeilen (Logik, Szenen-E2E, Smoke).
 * Reine Funktion: Die Summary kommt bereits geparst (`coverage/coverage-summary.json`), kein Dateizugriff.
 */

export type CoverageReportResult = { ok: true; lines: string[]; text: string } | { ok: false; error: string };

/** Reihenfolge und Schreibweise wie im Abschnitt „Bereichsnamen“ in AGENTS.md. */
const METRICS = [
  ['lines', 'Zeilen'],
  ['branches', 'Zweige'],
  ['functions', 'Funktionen'],
  ['statements', 'Anweisungen'],
] as const;

/** Eine Dezimalstelle mit Dezimalkomma, z. B. 99,9. */
export function formatPercent(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Erzeugt die drei Berichtszeilen. Fehlende oder ungültige Werte ergeben `{ ok: false, error }`, nie eine Ausnahme.
 */
export function buildCoverageReport(summary: unknown, e2eCount: unknown, smokeCount: unknown): CoverageReportResult {
  const total = isRecord(summary) ? summary.total : undefined;
  if (!isRecord(total)) return { ok: false, error: 'Coverage-Summary ungültig: Feld "total" fehlt.' };

  const parts: string[] = [];
  for (const [key, label] of METRICS) {
    const metric = total[key];
    const pct = isRecord(metric) ? metric.pct : undefined;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: `Coverage-Summary ungültig: "total.${key}.pct" fehlt oder ist keine Prozentzahl.` };
    }
    parts.push(`${label} ${formatPercent(pct)} %`);
  }
  if (!isValidCount(e2eCount)) {
    return { ok: false, error: 'Testanzahl für Szenen-E2E fehlt oder ist keine ganze Zahl ab 0.' };
  }
  if (!isValidCount(smokeCount)) {
    return { ok: false, error: 'Testanzahl für Smoke fehlt oder ist keine ganze Zahl ab 0.' };
  }

  const lines = [
    `Logik: ${parts.join(', ')}`,
    `Szenen-E2E: ${e2eCount} Tests`,
    `Smoke: ${smokeCount} Tests`,
  ];
  return { ok: true, lines, text: lines.join('\n') };
}
