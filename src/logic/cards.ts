/**
 * Kartendefinitionen und Deck-Reihenfolge. Ohne Phaser: reine Daten und Funktionen.
 * Alle Spieler nutzen dasselbe Deck, das einmal per Seed gemischt wird.
 * Kosten, Werte und Kopienzahl je Karte stehen in `balance-config.ts` (`CARD_BALANCE`); hier nur Name, Typ und Ziel.
 */
import { CARD_BALANCE, type CardBalance, type CardBalanceId } from './balance-config';
import { type Explosion, type LaneEffect, type Specialization } from './combat';
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

/** Werte-Tabelle als lose typierte Sicht: der Zugriff über die ID liefert immer einen Eintrag. */
const BALANCE: Readonly<Record<CardBalanceId, CardBalance>> = CARD_BALANCE;

/** Kosten der Karte. */
function costOf(id: CardBalanceId): number {
  return BALANCE[id].cost;
}

/** Kosten und Zuwachs (HP, Schaden) eines Upgrades. */
function upgradeStats(id: CardBalanceId): { cost: number; hp: number; damage: number } {
  const { cost, hp, damage } = BALANCE[id];
  return { cost, hp: hp!, damage: damage! };
}

/** Kosten und Werte einer Beschwörung; `range` fehlt bei Nahkämpfern (Standard-Reichweite). */
function summonStats(id: CardBalanceId): { cost: number; hp: number; damage: number; speed: number; range?: number } {
  const { cost, hp, damage, speed, range } = BALANCE[id];
  return { cost, hp: hp!, damage: damage!, speed: speed!, ...(range === undefined ? {} : { range }) };
}

export const CARD_DEFS: readonly CardDef[] = [
  { id: 'summon-minion', name: 'Minion', type: 'summon', target: 'line', ...summonStats('summon-minion') },
  { id: 'summon-brute', name: 'Brocken', type: 'summon', target: 'line', ...summonStats('summon-brute') },
  { id: 'summon-archer', name: 'Bogenschütze', type: 'summon', target: 'line', ...summonStats('summon-archer') },
  { id: 'summon-healer', name: 'Heiler', type: 'summon', target: 'line', ...summonStats('summon-healer'), role: 'healer' },
  {
    id: 'summon-destroyer',
    name: 'Zerstörer',
    type: 'summon',
    target: 'line',
    ...summonStats('summon-destroyer'),
    role: 'destroyer',
    explodes: { ...BALANCE['summon-destroyer'].explosion! },
  },
  { id: 'line-upgrade', name: 'Lane +1', type: 'line-upgrade', cost: costOf('line-upgrade'), target: 'none' },
  { id: 'tower-hp', name: 'Tower Leben', type: 'tower-upgrade', target: 'line', ...upgradeStats('tower-hp') },
  { id: 'tower-damage', name: 'Tower Schaden', type: 'tower-upgrade', target: 'line', ...upgradeStats('tower-damage') },
  { id: 'tower-lightning', name: 'Blitz-Turm', type: 'tower-specialize', cost: costOf('tower-lightning'), target: 'line', path: 'lightning' },
  { id: 'tower-shield', name: 'Schild-Turm', type: 'tower-specialize', cost: costOf('tower-shield'), target: 'line', path: 'shield' },
  {
    id: 'minion-upgrade-line',
    name: 'Minions Line',
    type: 'minion-upgrade',
    target: 'line',
    ...upgradeStats('minion-upgrade-line'),
    scope: 'line',
  },
  {
    id: 'minion-upgrade-all',
    name: 'Minions alle',
    type: 'minion-upgrade',
    target: 'none',
    ...upgradeStats('minion-upgrade-all'),
    scope: 'all',
  },
  // Muss am Ende der Liste stehen: `match-record.ts` kodiert Karten über ihre Position.
  { id: 'buff-minion', name: 'Minion stärken', type: 'minion-buff', cost: costOf('buff-minion'), target: 'minion' },
  // Neu mit Version 6 (Turm-Slots): Beschwörungen, Lane-Karten und Upgrades, ebenfalls nur am Ende anfügen.
  { id: 'summon-scout', name: 'Späher', type: 'summon', target: 'line', ...summonStats('summon-scout') },
  { id: 'summon-guard', name: 'Wächter', type: 'summon', target: 'line', ...summonStats('summon-guard') },
  { id: 'summon-mage', name: 'Magier', type: 'summon', target: 'line', ...summonStats('summon-mage') },
  { id: 'lane-buff', name: 'Lane-Buff', type: 'lane-card', cost: costOf('lane-buff'), target: 'line', effect: 'buff' },
  { id: 'lane-shield', name: 'Lane-Schild', type: 'lane-card', cost: costOf('lane-shield'), target: 'line', effect: 'shield' },
  { id: 'tower-armor', name: 'Tower Panzer', type: 'tower-upgrade', target: 'line', ...upgradeStats('tower-armor') },
  {
    id: 'minion-upgrade-elite',
    name: 'Elite-Drill',
    type: 'minion-upgrade',
    target: 'line',
    ...upgradeStats('minion-upgrade-elite'),
    scope: 'line',
  },
];

/**
 * Wie oft jede Karte in einem Durchgang des Decks vorkommt (aus `CARD_BALANCE`). Das Linien-Upgrade hat 0 Kopien: Es
 * ist eine Aktion (`upgradeField`), keine Karte im Deck mehr; die Kartendefinition bleibt für Synergien.
 */
const COPIES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(CARD_BALANCE).map(([id, balance]) => [id, balance.copies]),
);

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
