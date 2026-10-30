import { readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('liegt unter src/logic/ keine Datei tmp-*.test.ts', () => {
  const found = readdirSync(new URL('.', import.meta.url)).filter((name) => /^tmp-.*\.test\.ts$/.test(name));
  expect(found, `Temporäre Testdateien in src/logic/ gefunden (löschen oder in reguläre Tests überführen): ${found.join(', ')}`).toEqual([]);
});
