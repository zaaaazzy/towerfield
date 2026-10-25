import { it } from 'vitest';
import { buildDeck } from './cards';

it('print', () => {
  process.stdout.write(`DECK ${JSON.stringify(buildDeck(5, 21))}\n`);
});
