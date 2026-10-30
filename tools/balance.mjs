/**
 * CLI-Wrapper für den Balance-Bericht (`npm run balance`). Liest Argumente, ruft `runSimulation` auf und gibt aus.
 * Alle Regeln und die Formatierung liegen in `src/logic/`.
 */
import { runSimulation } from '../src/logic/balance-sim.ts';
import { formatBalanceTable, parseBalanceArgs } from '../src/logic/balance-format.ts';

const parsed = parseBalanceArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`Fehler: ${parsed.error}\n`);
  process.exit(1);
}
const { seed, count, format } = parsed.options;
const report = runSimulation({ startSeed: seed, count });

process.stdout.write(`${format === 'json' ? JSON.stringify(report, null, 2) : formatBalanceTable(report)}\n`);
