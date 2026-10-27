/**
 * Kartendefinitionen und Deck-Reihenfolge. Ohne Phaser: reine Daten und Funktionen.
 * Alle Spieler nutzen dasselbe Deck, das einmal per Seed gemischt wird.
 */
import { type Explosion, type LaneEffect, MINION_SPEED, type Specialization } from './combat';
import { nextRandom } from './game-state';

export type CardType =
  | 'line-upgrade'
  | 'tower-upgrade'
  | 'tower-specialize'
  | 'summon'
  | 'minion-upgrade'
  | 'minion-buff'
  | 'lane-card';

interface CardBase {
  id: string;
  name: string;
  cost: number;
  /** `line`: die Karte braucht eine gewählte Lane, `minion`: einen eigenen lebenden Minion, `none`: sie wirkt ohne Ziel. */
  target: 'line' | 'minion' | 'none';
}

export type CardDef =
  | (CardBase & { type: 'line-upgrade' })
  | (CardBase & { type: 'tower-upgrade'; hp: number; damage: number })
  | (CardBase & { type: 'tower-specialize'; path: Specialization })
  | (CardBase & { type: 'summon'; hp: number; damage: number; range?: number; speed?: number; role?: 'healer' | 'destroyer'; explodes?: Explosion })
  | (CardBase & { type: 'minion-upgrade'; hp: number; damage: number; scope: 'line' | 'all' })
  | (CardBase & { type: 'minion-buff' })
  /** Lane-Karte: wirkt in der Runde auf alle Minions der Lane; liegt im Lane-Slot hinter den Towern (höchstens eine je Lane). */
  | (CardBase & { type: 'lane-card'; effect: LaneEffect });

export const CARD_DEFS: readonly CardDef[] = [
  { id: 'summon-minion', name: 'Minion', type: 'summon', cost: 1, target: 'line', hp: 30, damage: 6, speed: MINION_SPEED },
  { id: 'summon-brute', name: 'Brocken', type: 'summon', cost: 2, target: 'line', hp: 80, damage: 12, speed: 8 },
  { id: 'summon-archer', name: 'Bogenschütze', type: 'summon', cost: 2, target: 'line', hp: 20, damage: 7, range: 14, speed: 10 },
  { id: 'summon-healer', name: 'Heiler', type: 'summon', cost: 2, target: 'line', hp: 20, damage: 5, range: 10, speed: MINION_SPEED, role: 'healer' },
  {
    id: 'summon-destroyer',
    name: 'Zerstörer',
    type: 'summon',
    cost: 2,
    target: 'line',
    hp: 40,
    damage: 8,
    speed: 8,
    role: 'destroyer',
    explodes: { radius: 10, damage: 15 },
  },
  { id: 'line-upgrade', name: 'Lane +1', type: 'line-upgrade', cost: 2, target: 'none' },
  { id: 'tower-hp', name: 'Tower Leben', type: 'tower-upgrade', cost: 1, target: 'line', hp: 30, damage: 0 },
  { id: 'tower-damage', name: 'Tower Schaden', type: 'tower-upgrade', cost: 2, target: 'line', hp: 0, damage: 4 },
  { id: 'tower-lightning', name: 'Blitz-Turm', type: 'tower-specialize', cost: 2, target: 'line', path: 'lightning' },
  { id: 'tower-shield', name: 'Schild-Turm', type: 'tower-specialize', cost: 2, target: 'line', path: 'shield' },
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
  // Muss am Ende der Liste stehen: `match-record.ts` kodiert Karten über ihre Position.
  { id: 'buff-minion', name: 'Minion stärken', type: 'minion-buff', cost: 2, target: 'minion' },
  // Neu mit Version 6 (Turm-Slots): Beschwörungen, Lane-Karten und Upgrades, ebenfalls nur am Ende anfügen.
  { id: 'summon-scout', name: 'Späher', type: 'summon', cost: 1, target: 'line', hp: 20, damage: 4, speed: 14 },
  { id: 'summon-guard', name: 'Wächter', type: 'summon', cost: 3, target: 'line', hp: 120, damage: 12, speed: 6 },
  { id: 'summon-mage', name: 'Magier', type: 'summon', cost: 3, target: 'line', hp: 25, damage: 12, range: 12, speed: 9 },
  { id: 'lane-buff', name: 'Lane-Buff', type: 'lane-card', cost: 2, target: 'line', effect: 'buff' },
  { id: 'lane-shield', name: 'Lane-Schild', type: 'lane-card', cost: 2, target: 'line', effect: 'shield' },
  { id: 'tower-armor', name: 'Tower Panzer', type: 'tower-upgrade', cost: 2, target: 'line', hp: 60, damage: 0 },
  {
    id: 'minion-upgrade-elite',
    name: 'Elite-Drill',
    type: 'minion-upgrade',
    cost: 2,
    target: 'line',
    hp: 20,
    damage: 4,
    scope: 'line',
  },
];

/** Wie oft jede Karte in einem Durchgang des Decks vorkommt. */
const COPIES: Readonly<Record<string, number>> = {
  'summon-minion': 4,
  'summon-brute': 2,
  'summon-archer': 2,
  'summon-healer': 1,
  'summon-destroyer': 1,
  // Das Upgrade ist eine Aktion (`upgradeField`), keine Karte im Deck mehr; die Kartendefinition bleibt für Synergien.
  'line-upgrade': 0,
  'tower-hp': 2,
  'tower-damage': 1,
  'tower-lightning': 1,
  'tower-shield': 1,
  'minion-upgrade-line': 2,
  'minion-upgrade-all': 1,
  'buff-minion': 1,
  'summon-scout': 2,
  'summon-guard': 1,
  'summon-mage': 1,
  'lane-buff': 1,
  'lane-shield': 1,
  'tower-armor': 1,
  'minion-upgrade-elite': 1,
};

/** Karten je Durchgang des Decks (Summe von `COPIES`). */
export const DECK_CYCLE = Object.values(COPIES).reduce((sum, count) => sum + count, 0);

/** Karten, die in Runde N genau N Einheiten beschwören (Rundenzahl als Multiplikator). */
const ROUND_SCALED_SUMMONS: readonly string[] = ['summon-archer'];

/** Anzahl der Einheiten, die `cardId` in Runde `round` beschwört: Bogenschütze = Rundenzahl, sonst 1. */
export function summonCount(cardId: string, round: number): number {
  return ROUND_SCALED_SUMMONS.includes(cardId) ? Math.max(1, Math.floor(round)) : 1;
}

export function getCardDef(id: string): CardDef {
  const def = CARD_DEFS.find((card) => card.id === id);
  if (!def) throw new Error(`Unbekannte Karte: ${id}`);
  return def;
}

/**
 * Deck der Länge `length`: die Karten laut `COPIES` (so oft wiederholt wie nötig), einmal per Seed gemischt
 * (Fisher-Yates). Gleicher Seed ergibt dieselbe Reihenfolge. `defs` und `copies` sind nur für Tests austauschbar;
 * Karten ohne Eintrag in `copies` kommen nicht vor (mindestens eine Karte braucht einen Eintrag > 0).
 */
export function buildDeck(
  seed: number,
  length: number,
  defs: readonly CardDef[] = CARD_DEFS,
  copies: Readonly<Record<string, number>> = COPIES,
): string[] {
  const pool: string[] = [];
  while (pool.length < length) {
    for (const def of defs) {
      for (let copy = 0; copy < (copies[def.id] ?? 0); copy += 1) pool.push(def.id);
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
