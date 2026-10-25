/**
 * Kartendefinitionen und Deck-Reihenfolge. Ohne Phaser: reine Daten und Funktionen.
 * Alle Spieler nutzen dasselbe Deck, das einmal per Seed gemischt wird.
 */
import { MINION_SPEED } from './combat';
import { nextRandom } from './game-state';

export type CardType = 'line-upgrade' | 'tower-upgrade' | 'summon' | 'minion-upgrade';

interface CardBase {
  id: string;
  name: string;
  cost: number;
  /** `line`: die Karte braucht eine gewählte Line, `none`: sie wirkt ohne Ziel. */
  target: 'line' | 'none';
}

export type CardDef =
  | (CardBase & { type: 'line-upgrade' })
  | (CardBase & { type: 'tower-upgrade'; hp: number; damage: number })
  | (CardBase & { type: 'summon'; hp: number; damage: number; range?: number; speed?: number; role?: 'healer' })
  | (CardBase & { type: 'minion-upgrade'; hp: number; damage: number; scope: 'line' | 'all' });

export const CARD_DEFS: readonly CardDef[] = [
  { id: 'summon-minion', name: 'Minion', type: 'summon', cost: 1, target: 'line', hp: 30, damage: 6, speed: MINION_SPEED },
  { id: 'summon-brute', name: 'Brocken', type: 'summon', cost: 2, target: 'line', hp: 80, damage: 12, speed: 8 },
  { id: 'summon-archer', name: 'Bogenschütze', type: 'summon', cost: 2, target: 'line', hp: 20, damage: 7, range: 14, speed: 10 },
  { id: 'summon-healer', name: 'Heiler', type: 'summon', cost: 2, target: 'line', hp: 20, damage: 5, range: 10, speed: MINION_SPEED, role: 'healer' },
  { id: 'line-upgrade', name: 'Line +1', type: 'line-upgrade', cost: 2, target: 'line' },
  { id: 'tower-hp', name: 'Tower Leben', type: 'tower-upgrade', cost: 1, target: 'line', hp: 30, damage: 0 },
  { id: 'tower-damage', name: 'Tower Schaden', type: 'tower-upgrade', cost: 2, target: 'line', hp: 0, damage: 4 },
  {
    id: 'minion-upgrade-line',
    name: 'Minions Line',
    type: 'minion-upgrade',
    cost: 1,
    target: 'line',
    hp: 10,
    damage: 2,
    scope: 'line',
  },
  {
    id: 'minion-upgrade-all',
    name: 'Minions alle',
    type: 'minion-upgrade',
    cost: 3,
    target: 'none',
    hp: 5,
    damage: 1,
    scope: 'all',
  },
];

/** Wie oft jede Karte in einem Durchgang des Decks vorkommt. */
const COPIES: Readonly<Record<string, number>> = {
  'summon-minion': 4,
  'summon-brute': 2,
  'summon-archer': 2,
  'summon-healer': 1,
  'line-upgrade': 2,
  'tower-hp': 2,
  'tower-damage': 1,
  'minion-upgrade-line': 2,
  'minion-upgrade-all': 1,
};

export function getCardDef(id: string): CardDef {
  const def = CARD_DEFS.find((card) => card.id === id);
  if (!def) throw new Error(`Unbekannte Karte: ${id}`);
  return def;
}

/**
 * Deck der Länge `length`: die Karten laut `COPIES` (so oft wiederholt wie nötig), einmal per Seed gemischt
 * (Fisher-Yates). Gleicher Seed ergibt dieselbe Reihenfolge.
 */
export function buildDeck(seed: number, length: number): string[] {
  const pool: string[] = [];
  while (pool.length < length) {
    for (const def of CARD_DEFS) {
      for (let copy = 0; copy < (COPIES[def.id] ?? 0); copy += 1) pool.push(def.id);
    }
  }
  pool.length = length;
  let state = seed;
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.seed;
    const other = Math.floor(random.value * (index + 1));
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  return pool;
}
