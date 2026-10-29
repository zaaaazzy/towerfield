import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;
const SCAN_DIRS = ['src', 'e2e'];

function findTmpFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTmpFiles(path));
    else if (entry.name.startsWith('tmp-')) found.push(path);
  }
  return found;
}

it('liegt unter src/ und e2e/ keine temporäre Datei tmp-*', () => {
  const found = SCAN_DIRS.flatMap((dir) => findTmpFiles(join(ROOT, dir))).map((path) => path.slice(ROOT.length));
  expect(found, `Temporäre Dateien gefunden (löschen oder in reguläre Tests überführen):\n${found.join('\n')}`).toEqual([]);
});
