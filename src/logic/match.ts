/**
 * Spielzustand und Regeln eines 1-gegen-1-Matches: Runden, Hand, Energie, Karten ausspielen, Sieg.
 * Ohne Phaser, DOM und Canvas. Alle Funktionen geben einen neuen Zustand zurück; der alte bleibt unverändert.
 * Die Planung wirkt nur auf den eigenen Spieler, deshalb ist die Reihenfolge der Spieler egal. Kein Zufall außer
 * der Deck-Reihenfolge, die der Seed einmal festlegt.
 */
import { buildDeck, getCardDef } from './cards';
import {
  combatTick,
  type CombatPlayer,
  type Minion,
  TICK_MS,
  type Tower,
  totalTowerHp,
  towersAlive,
} from './combat';

export const LINE_COUNT = 3;
export const START_HAND = 7;
export const DRAW_PER_ROUND = 5;
/** Handlimit (Vorschlag aus dem Auftrag, noch zu bestätigen): neu gezogene Karten über dem Limit verfallen. */
export const HAND_LIMIT = 10;
export const MAX_ROUNDS = 8;
export const BASE_ENERGY = 3;
export const ENERGY_PER_ROUND = 1;
export const MAX_ENERGY = 10;
export const MAX_LINE_LEVEL = 5;
export const BASE_CAPACITY = 2;
export const TOWER_HP = 100;
export const TOWER_DAMAGE = 8;
/** Dauer der Kampfphase in Ticks (20 Sekunden). */
export const COMBAT_TICKS = 400;

export type Phase = 'planning' | 'combat' | 'over';
export type Outcome = 'player0' | 'player1' | 'draw';
export type PlayerIndex = 0 | 1;

export interface LineState {
  level: number;
  tower: Tower;
  /** Dauerhafter Bonus für künftig beschworene Minions dieser Line. */
  bonus: { hp: number; damage: number };
}

export interface PlayerState extends CombatPlayer {
  energy: number;
  /** Karten-IDs in der Reihenfolge, in der sie auf die Hand kamen. */
  hand: string[];
  lines: LineState[];
  nextMinionId: number;
}

export interface MatchState {
  seed: number;
  round: number;
  phase: Phase;
  deck: string[];
  /** Anzahl bereits gezogener Karten (gleich für beide Spieler). */
  drawn: number;
  players: [PlayerState, PlayerState];
  ready: [boolean, boolean];
  /** Noch nicht verrechnete Zeit der Kampfphase in Millisekunden. */
  accumulatorMs: number;
  combatTicks: number;
  outcome: Outcome | null;
}

export type PlayError =
  | 'not-planning'
  | 'already-ready'
  | 'no-such-card'
  | 'not-enough-energy'
  | 'invalid-line'
  | 'line-full'
  | 'max-level';

export type PlayResult = { ok: true; state: MatchState } | { ok: false; state: MatchState; reason: PlayError };

/** Maximale Zahl lebender Minions einer Line des Levels `level`. */
export function lineCapacity(level: number): number {
  return BASE_CAPACITY + level;
}

export function energyForRound(round: number): number {
  return Math.min(MAX_ENERGY, BASE_ENERGY + (round - 1) * ENERGY_PER_ROUND);
}

function createPlayer(): PlayerState {
  return {
    energy: 0,
    hand: [],
    nextMinionId: 1,
    minions: [],
    lines: Array.from({ length: LINE_COUNT }, () => ({
      level: 1,
      tower: { hp: TOWER_HP, maxHp: TOWER_HP, damage: TOWER_DAMAGE },
      bonus: { hp: 0, damage: 0 },
    })),
  };
}

/** Beginnt Runde `round` (verändert `state`): Energie setzen, dieselben Karten für beide ziehen, Planung öffnen. */
function startRound(state: MatchState, round: number): void {
  const count = round === 1 ? START_HAND : DRAW_PER_ROUND;
  const drawn = state.deck.slice(state.drawn, state.drawn + count);
  state.drawn += count;
  state.round = round;
  state.phase = 'planning';
  state.ready = [false, false];
  state.accumulatorMs = 0;
  state.combatTicks = 0;
  for (const player of state.players) {
    player.energy = energyForRound(round);
    player.hand.push(...drawn);
    player.hand.length = Math.min(player.hand.length, HAND_LIMIT);
  }
}

export function createMatch(seed: number): MatchState {
  const state: MatchState = {
    seed,
    round: 0,
    phase: 'planning',
    deck: buildDeck(seed, START_HAND + DRAW_PER_ROUND * (MAX_ROUNDS - 1)),
    drawn: 0,
    players: [createPlayer(), createPlayer()],
    ready: [false, false],
    accumulatorMs: 0,
    combatTicks: 0,
    outcome: null,
  };
  startRound(state, 1);
  return state;
}

function reject(state: MatchState, reason: PlayError): PlayResult {
  return { ok: false, state, reason };
}

/**
 * Spielt die Handkarte `handIndex` für `playerIndex` aus, bei Bedarf auf `lineIndex`. Bei einem Fehler kommt der
 * unveränderte Zustand zurück.
 */
export function playCard(
  state: MatchState,
  playerIndex: PlayerIndex,
  handIndex: number,
  lineIndex?: number,
): PlayResult {
  if (state.phase !== 'planning') return reject(state, 'not-planning');
  if (state.ready[playerIndex]) return reject(state, 'already-ready');
  const current = state.players[playerIndex];
  const cardId = current.hand[handIndex];
  if (cardId === undefined) return reject(state, 'no-such-card');
  const def = getCardDef(cardId);
  if (current.energy < def.cost) return reject(state, 'not-enough-energy');
  if (def.target === 'line') {
    if (lineIndex === undefined || !Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= LINE_COUNT) {
      return reject(state, 'invalid-line');
    }
    const line = current.lines[lineIndex]!;
    if (def.type === 'summon' && current.minions.filter((m) => m.line === lineIndex).length >= lineCapacity(line.level)) {
      return reject(state, 'line-full');
    }
    if (def.type === 'line-upgrade' && line.level >= MAX_LINE_LEVEL) return reject(state, 'max-level');
  }

  const next = structuredClone(state);
  const player = next.players[playerIndex];
  player.energy -= def.cost;
  player.hand.splice(handIndex, 1);
  const line = def.target === 'line' ? player.lines[lineIndex!]! : undefined;
  switch (def.type) {
    case 'line-upgrade':
      line!.level += 1;
      break;
    case 'tower-upgrade':
      line!.tower.maxHp += def.hp;
      line!.tower.hp += def.hp;
      line!.tower.damage += def.damage;
      break;
    case 'summon': {
      const minion: Minion = {
        id: player.nextMinionId,
        line: lineIndex!,
        position: 0,
        hp: def.hp + line!.bonus.hp,
        damage: def.damage + line!.bonus.damage,
      };
      player.nextMinionId += 1;
      player.minions.push(minion);
      break;
    }
    case 'minion-upgrade':
      for (const target of def.scope === 'all' ? player.lines : [line!]) {
        target.bonus.hp += def.hp;
        target.bonus.damage += def.damage;
      }
      break;
  }
  return { ok: true, state: next };
}

/** Der Spieler beendet seine Planung. Sind beide bereit, beginnt die Kampfphase. */
export function setReady(state: MatchState, playerIndex: PlayerIndex): MatchState {
  if (state.phase !== 'planning' || state.ready[playerIndex]) return state;
  const next = structuredClone(state);
  next.ready[playerIndex] = true;
  if (next.ready[0] && next.ready[1]) {
    next.phase = 'combat';
    next.accumulatorMs = 0;
    next.combatTicks = 0;
  }
  return next;
}

/** Ergebnis, wenn mindestens ein Spieler keinen Tower mehr hat; sonst `null`. Beide ohne Tower: Unentschieden. */
export function destroyedOutcome(state: MatchState): Outcome | null {
  const dead0 = towersAlive(state.players[0]) === 0;
  const dead1 = towersAlive(state.players[1]) === 0;
  if (dead0 && dead1) return 'draw';
  if (dead0) return 'player1';
  if (dead1) return 'player0';
  return null;
}

/** Ergebnis nach der letzten Runde: mehr Tower-Lebenspunkte gewinnt, bei Gleichstand Unentschieden. */
export function hpOutcome(state: MatchState): Outcome {
  const hp0 = totalTowerHp(state.players[0]);
  const hp1 = totalTowerHp(state.players[1]);
  if (hp0 === hp1) return 'draw';
  return hp0 > hp1 ? 'player0' : 'player1';
}

function finish(state: MatchState, outcome: Outcome): void {
  state.phase = 'over';
  state.outcome = outcome;
  state.accumulatorMs = 0;
}

/**
 * Lässt die Kampfphase `deltaMs` Millisekunden laufen. Die Zeit wird in feste Ticks zerlegt, daher ist das Ergebnis
 * unabhängig von der Bildwiederholrate. Außerhalb der Kampfphase passiert nichts.
 */
export function advance(state: MatchState, deltaMs: number): MatchState {
  if (state.phase !== 'combat' || !(deltaMs > 0)) return state;
  const next = structuredClone(state);
  next.accumulatorMs += deltaMs;
  // Kleine Toleranz gegen Rundungsfehler beim Aufsummieren vieler Bruchteile.
  while (next.phase === 'combat' && next.accumulatorMs >= TICK_MS - 1e-6) {
    next.accumulatorMs -= TICK_MS;
    combatTick(next.players);
    next.combatTicks += 1;
    const destroyed = destroyedOutcome(next);
    if (destroyed) {
      finish(next, destroyed);
    } else if (next.combatTicks >= COMBAT_TICKS) {
      if (next.round >= MAX_ROUNDS) finish(next, hpOutcome(next));
      else startRound(next, next.round + 1);
    }
  }
  return next;
}
