import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const SCENES = new URL('../scenes/', import.meta.url).pathname;
const HEX_COLOR = /0x[0-9a-f]{6}\b|#[0-9a-f]{6}\b/gi;

/** Farben gehören in die Palette (`src/scenes/theme.ts`); Szenenmodule enthalten keine freien Hex-Werte. */
it('enthält kein Szenenmodul außer theme.ts einen freien Hex-Farbwert', () => {
  const found: string[] = [];
  for (const file of readdirSync(SCENES)) {
    if (!file.endsWith('.ts') || file === 'theme.ts') continue;
    readFileSync(join(SCENES, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (HEX_COLOR.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
        HEX_COLOR.lastIndex = 0;
      });
  }
  expect(found, `Freie Hex-Farben in Szenen (nach theme.ts verschieben):\n${found.join('\n')}`).toEqual([]);
});
