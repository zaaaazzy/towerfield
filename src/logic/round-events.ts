/**
 * Runden-Ereignisse: Jede dritte Runde wirkt ein Ereignis aus einem festen Pool auf beide Spieler. Ohne Phaser, DOM
 * und Canvas. Die Wahl fällt beim Rundenstart über einen eigenen Event-Seed (aus dem Match-Seed abgeleitet, getrennt vom
 * Deck-Seed) und gilt vor der Kampfphase, die Kampfberechnung bleibt zufallsfrei. Das Ereignis ist ab der Planung sichtbar.
 */
import { nextRandom } from './game-state';

export type RoundEventId = 'energy' | 'early-respawn' | 'tower-shield';

export interface RoundEventDef {
  id: RoundEventId;
  name: string;
  description: string;
}

/** Fester Pool; die Reihenfolge bestimmt die Zuordnung der Zufallszahl. */
export const ROUND_EVENTS: readonly RoundEventDef[] = [
  { id: 'energy', name: 'Energieschub', description: 'Beide Spieler haben 1 Energie mehr.' },
  { id: 'early-respawn', name: 'Früher Aufbruch', description: 'Überlebende Minions starten früher.' },
  { id: 'tower-shield', name: 'Tower-Schild', description: 'Jeder Tower erhält einen Schild für den Kampf.' },
];

/** Jede `EVENT_INTERVAL`-te Runde löst ein Ereignis aus (bei `MAX_ROUNDS = 8`: Runde 3 und 6). */
export const EVENT_INTERVAL = 3;
/** Zusätzliche Energie bei „Energieschub“ (gedeckelt durch `MAX_ENERGY`). */
export const EVENT_ENERGY_BONUS = 1;
/** Vorsprung überlebender Minions bei „Früher Aufbruch“ in Ticks (1 Sekunde); die Strecke folgt dem Minion-Tempo. */
export const EARLY_RESPAWN_TICKS = 20;
/** Schild-Punkte je Tower bei „Tower-Schild“; sie absorbieren Schaden vor den HP und verfallen nach dem Kampf. */
export const TOWER_SHIELD = 30;

/** Event-Seed eines Matches: aus dem Match-Seed abgeleitet, ohne den Deck-Seed zu berühren. */
export function deriveEventSeed(matchSeed: number): number {
  return Math.imul((matchSeed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0;
}

export function isEventRound(round: number): boolean {
  return Number.isInteger(round) && round > 0 && round % EVENT_INTERVAL === 0;
}

export function getRoundEventDef(id: RoundEventId): RoundEventDef {
  return ROUND_EVENTS.find((def) => def.id === id)!;
}

/**
 * Wählt das Ereignis der Runde `round`. In Nicht-Ereignisrunden kommt `event: null` und derselbe Seed zurück; sonst wird
 * der Event-Seed über `nextRandom` einen Schritt weitergeschaltet. Gleicher Seed und gleiche Runde: gleiches Ereignis.
 */
export function pickRoundEvent(eventSeed: number, round: number): { event: RoundEventId | null; seed: number } {
  if (!isEventRound(round)) return { event: null, seed: eventSeed };
  const random = nextRandom(eventSeed);
  const index = Math.floor(random.value * ROUND_EVENTS.length);
  return { event: ROUND_EVENTS[index]!.id, seed: random.seed };
}
