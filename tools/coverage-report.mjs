/**
 * CLI-Wrapper für die Berichtsvorlage (`npm run coverage:report -- <E2E-Tests> <Smoke-Tests>`).
 * Liest `coverage/coverage-summary.json` und gibt die drei Zeilen aus; die Regeln liegen in `src/logic/`.
 */
import { readFileSync } from 'node:fs';
import { buildCoverageReport } from '../src/logic/coverage-report.ts';

const [e2eArg, smokeArg] = process.argv.slice(2);
let summary;
try {
  summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
} catch {
  process.stderr.write('Fehler: coverage/coverage-summary.json fehlt oder ist kein JSON – zuerst `npm run test:coverage`.\n');
  process.exit(1);
}
const toCount = (arg) => (arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined);
const result = buildCoverageReport(summary, toCount(e2eArg), toCount(smokeArg));
if (!result.ok) {
  process.stderr.write(`Fehler: ${result.error}\n`);
  process.exit(1);
}
process.stdout.write(`${result.text}\n`);
