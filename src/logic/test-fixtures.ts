/**
 * Testhilfen für die Logik-Tests: Decks, Hände und Einheiten werden aus einer expliziten Kartenliste und aus
 * `balance-config.ts` (`CARD_BALANCE`) gebaut. Die Tests hängen so weder von Seed und Deckreihenfolge noch von festen
 * Balance-Zahlen ab; eine reine Balance-Änderung betrifft nur `balance-config.ts` und `balance-config.test.ts`.
 * Ohne Phaser, DOM und Canvas. Wo Zufall bleibt (Runden-Ereignisse), entscheidet der Seed von `createMatch`.
 */
import {
  CARD_BALANCE,
  type CardBalanceId,
  DRAW_PER_ROUND,
  HAND_LIMIT,
  MAX_ENERGY,
  MAX_ROUNDS,
  MINION_RANGE,
  MINION_SPEED,
  START_HAND,
  TOWER_DAMAGE,
  TOWER_HP,
} from './balance-config';
import { createMatch, type MatchState, type PlayerIndex } from './match';
import type { Minion, Tower } from './combat';
import { isLaneBuyable } from './lanes';

/** Karten, die ein Match insgesamt zieht: Startkarten plus `DRAW_PER_ROUND` je Runde. */
export const DECK_LENGTH = START_HAND + DRAW_PER_ROUND * MAX_ROUNDS;

/**
 * Deck der Länge `length` aus einer expliziten Kartenliste: die Liste wird in genau dieser Reihenfolge wiederholt, es gibt
 * weder Mischen noch Seed. Die Karten an Position `n` sind damit `cards[n % cards.length]`.
 */
export function fixedDeck(cards: readonly string[], length: number = DECK_LENGTH): string[] {
  if (cards.length === 0) throw new Error('fixedDeck braucht mindestens eine Karte');
  return Array.from({ length }, (_, index) => cards[index % cards.length]!);
}

/**
 * Match in Runde 1, dessen Deck `fixedDeck(cards)` ist; beide Spieler halten die ersten `START_HAND` Karten davon.
 * Der Seed bestimmt nur noch die Runden-Ereignisse, nicht die Karten.
 */
export function createMatchWithDeck(cards: readonly string[], seed = 1): MatchState {
  const state = createMatch(seed);
  state.deck = fixedDeck(cards);
  state.drawn = START_HAND;
  for (const player of state.players) player.hand = state.deck.slice(0, START_HAND);
  return state;
}

/** Kopie des Zustands, in der beide Spieler genau diese Hand und `energy` Energie (Standard: `MAX_ENERGY`) haben. */
export function withHand(state: MatchState, hand: readonly string[], energy: number = MAX_ENERGY): MatchState {
  const copy = structuredClone(state);
  for (const player of copy.players) {
    player.hand = [...hand];
    player.energy = energy;
  }
  return copy;
}

/** Match mit dieser Hand und Energie für beide Spieler; das Deck dahinter ist `fixedDeck(hand)`. */
export function createMatchWithHand(hand: readonly string[], energy: number = MAX_ENERGY, seed = 1): MatchState {
  return withHand(createMatchWithDeck(hand, seed), hand, energy);
}

/** Kopie des Zustands, in der beide Spieler das Feld auf `level` ausgebaut und alle damit kaufbaren Lanes gekauft haben. */
export function withLevel(state: MatchState, level: number): MatchState {
  const copy = structuredClone(state);
  for (const player of copy.players) {
    player.level = level;
    player.lines.forEach((lane, index) => {
      if (isLaneBuyable(level, index)) lane.bought = true;
    });
  }
  return copy;
}

/** Karte in einer Hand der Länge `count` (z. B. `HAND_LIMIT`): wiederholt `cardId`, ohne Seed. */
export function handOf(cardId: string, count: number): string[] {
  return Array.from({ length: count }, () => cardId);
}

/** Hand, die genau am Handlimit liegt. */
export function fullHand(cardId = 'summon-minion'): string[] {
  return handOf(cardId, HAND_LIMIT);
}

/**
 * Einheit mit den Soll-Werten der Beschwörungskarte `cardId` (HP, Schaden, Reichweite, Tempo aus `CARD_BALANCE`;
 * `range`/`speed` ohne Eintrag gelten als Minion-Standard). `overrides` ersetzt einzelne Felder.
 */
export function unitOf(cardId: CardBalanceId, overrides: Partial<Minion> = {}): Minion {
  const balance = CARD_BALANCE[cardId] as { hp?: number; damage?: number; range?: number; speed?: number };
  if (balance.hp === undefined || balance.damage === undefined) throw new Error(`${cardId} ist keine Beschwörung`);
  return {
    id: 1,
    line: 0,
    position: 0,
    slot: 0,
    hp: balance.hp,
    maxHp: balance.hp,
    damage: balance.damage,
    range: balance.range ?? MINION_RANGE,
    speed: balance.speed ?? MINION_SPEED,
    ...overrides,
  };
}

/** Einheit, die steht und nichts trifft: hält die Kampfphase am Leben, ohne den Ausgang zu ändern. */
export function idleUnit(id: number, overrides: Partial<Minion> = {}): Minion {
  return { ...unitOf('summon-minion', { id }), damage: 0, range: 0, speed: 0, ...overrides };
}

/** Frischer Tower mit den Standardwerten `TOWER_HP` und `TOWER_DAMAGE`. */
export function towerOf(overrides: Partial<Tower> = {}): Tower {
  return { hp: TOWER_HP, maxHp: TOWER_HP, damage: TOWER_DAMAGE, ...overrides };
}

/** Zerstört alle Tower des Spielers (HP 0). Verändert `state`. */
export function destroyTowers(state: MatchState, player: PlayerIndex): void {
  for (const line of state.players[player].lines) for (const tower of line.towers) tower.hp = 0;
}
