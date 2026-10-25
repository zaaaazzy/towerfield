/**
 * Spielzustand und Regeln eines 1-gegen-1-Matches: Runden, Hand, Energie, Karten ausspielen, Sieg.
 * Ohne Phaser, DOM und Canvas. Alle Funktionen geben einen neuen Zustand zurück; der alte bleibt unverändert.
 * Die Planung wirkt nur auf den eigenen Spieler, deshalb ist die Reihenfolge der Spieler egal. Kein Zufall außer
 * der Deck-Reihenfolge, die der Seed einmal festlegt.
 */
import { applyMinionBuff } from './buff';
import { buildDeck, getCardDef } from './cards';
import {
  combatTick,
  type CombatPlayer,
  type Minion,
  MINION_RANGE,
  MINION_SPEED,
  TICK_MS,
  type Tower,
  totalTowerHp,
  towersAlive,
} from './combat';
import { createStats, type MatchStats, recordDamage, recordMove, recordSummon, recordUndo } from './match-stats';
import { isLaneUnlocked, LANE_COUNT, laneTowerOffsets, MAX_FIELD_LEVEL } from './lanes';
import { firstFreeSlot, isSlotFree, isValidSlot, slotPosition } from './placement';
import { type ActiveSynergy, activeSynergies, type PlayedCard, synergyBonus } from './synergies';

/** Zahl der Lanes des voll ausgebauten Feldes (Lvl 3); `PlayerState.lines` hat immer so viele Einträge. */
export const LINE_COUNT = LANE_COUNT;
export const START_HAND = 5;
export const DRAW_PER_ROUND = 3;
/** Handlimit (bestätigt, siehe docs/designkonzept.md): Karten über dem Limit verfallen am Ende der Hand. */
export const HAND_LIMIT = 10;
export const MAX_ROUNDS = 8;
export const BASE_ENERGY = 3;
export const ENERGY_PER_ROUND = 1;
export const MAX_ENERGY = 8;
export const BASE_CAPACITY = 2;
export const TOWER_HP = 100;
export const TOWER_DAMAGE = 8;
/** Dauer der Kampfphase in Ticks (20 Sekunden). */
export const COMBAT_TICKS = 400;

/** Nur dieser Spieler (der eigene) wird in `MatchState.stats` erfasst. */
const STATS_PLAYER: PlayerIndex = 0;

export type Phase = 'planning' | 'combat' | 'over';
export type Outcome = 'player0' | 'player1' | 'draw';
export type PlayerIndex = 0 | 1;

/** Eine Lane (siehe `lanes.ts`). Ist sie noch nicht frei, hat sie keine Tower. */
export interface LineState {
  towers: Tower[];
  /** Dauerhafter Bonus für künftig beschworene Minions dieser Lane. */
  bonus: { hp: number; damage: number };
}

export interface PlayerState extends CombatPlayer {
  /** Ausbaustufe des Feldes (1 bis `MAX_FIELD_LEVEL`); bestimmt, welche Lanes frei sind, und die Kapazität je Lane. */
  level: number;
  energy: number;
  /** Karten-IDs in der Reihenfolge, in der sie auf die Hand kamen. */
  hand: string[];
  lines: LineState[];
  nextMinionId: number;
  /** In dieser Planungsphase beschworene Minions samt Karte; nur sie lassen sich verschieben oder zurücknehmen. */
  placements: { minionId: number; cardId: string }[];
  /** Alle in dieser Runde gespielten Karten mit Ziel-Lane; `startRound` leert die Liste. */
  played: PlayedCard[];
  /** Daraus folgende aktive Synergien (nur diese Runde, nur für die Minions dieses Spielers), siehe `synergies.ts`. */
  synergies: ActiveSynergy[];
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
  /** Statistik des eigenen Spielers (Spieler 0), siehe `match-stats.ts`. */
  stats: MatchStats;
}

export type PlayError =
  | 'not-planning'
  | 'already-ready'
  | 'no-such-card'
  | 'not-enough-energy'
  | 'invalid-line'
  | 'invalid-slot'
  | 'slot-taken'
  | 'no-such-minion'
  | 'line-full'
  | 'max-level'
  | 'invalid-target';

export type PlayResult = { ok: true; state: MatchState } | { ok: false; state: MatchState; reason: PlayError };

/** Maximale Zahl lebender Minions je freier Lane bei Ausbaustufe `level`. */
export function lineCapacity(level: number): number {
  return BASE_CAPACITY + level;
}

/** Slot-Zahl je Lane-Index bei Ausbaustufe `level`: `lineCapacity` für freie Lanes, 0 für noch gesperrte. */
export function laneSlotCounts(level: number): number[] {
  return Array.from({ length: LANE_COUNT }, (_, lane) => (isLaneUnlocked(level, lane) ? lineCapacity(level) : 0));
}

/** Frische Tower einer Lane (Start-Lane: drei nebeneinander, sonst einer). */
export function createLaneTowers(lane: number): Tower[] {
  return laneTowerOffsets(lane).map((offset) => ({ offset, hp: TOWER_HP, maxHp: TOWER_HP, damage: TOWER_DAMAGE }));
}

/** Tower, den ein Tower-Upgrade der Lane trifft: der lebende mit den wenigsten LP (bei Gleichstand der hintere), sonst der erste. */
function upgradeTarget(towers: Tower[]): Tower {
  const alive = towers.filter((tower) => tower.hp > 0);
  return alive.reduce((best, tower) => (tower.hp < best.hp ? tower : best), alive[0] ?? towers[0]!);
}

export function energyForRound(round: number): number {
  return Math.min(MAX_ENERGY, BASE_ENERGY + (round - 1) * ENERGY_PER_ROUND);
}

function createPlayer(): PlayerState {
  return {
    level: 1,
    energy: 0,
    hand: [],
    nextMinionId: 1,
    placements: [],
    played: [],
    synergies: [],
    minions: [],
    lines: Array.from({ length: LANE_COUNT }, (_, lane) => ({
      towers: isLaneUnlocked(1, lane) ? createLaneTowers(lane) : [],
      bonus: { hp: 0, damage: 0 },
    })),
  };
}

/**
 * Setzt die überlebenden Minions eines Spielers auf Slots ihrer Line zurück (verändert `player`): nach `id`
 * aufsteigend auf die niedrigsten freien Slots, Line und Werte bleiben. Tote Minions entfallen. Gibt es mehr
 * Überlebende als gültige Slots (in der Praxis unmöglich, Kapazität ≤ Zonen-Slots), stehen die übrigen auf dem
 * letzten gültigen Slot, damit keiner entfernt wird und keiner über `PLACEMENT_ZONE_END` hinausragt.
 */
export function respawnSurvivors(player: PlayerState): void {
  const alive = player.minions.filter((m) => m.hp > 0);
  const placed: Minion[] = [];
  const positions = new Map<number, number>();
  for (const minion of [...alive].sort((a, b) => a.id - b.id)) {
    const slotCount = Math.max(lineCapacity(player.level), alive.length);
    let slot = firstFreeSlot(placed, minion.line, slotCount);
    if (slot === undefined) {
      slot = slotCount - 1;
      while (slot > 0 && !isValidSlot(slot, slotCount)) slot -= 1;
    }
    const position = slotPosition(slot);
    positions.set(minion.id, position);
    placed.push({ ...minion, position });
  }
  player.minions = alive.map((m) => ({ ...m, position: positions.get(m.id)! }));
}

/**
 * Wertet die Synergien aus `player.played` neu aus (verändert `player`) und setzt den temporären Reichweitenbonus aller
 * Minions nach ihrer aktuellen Lane. Ohne Bonus fehlt das Feld; `LineState.bonus` und Basiswerte bleiben unberührt.
 */
function refreshSynergies(player: PlayerState): void {
  player.synergies = activeSynergies(player.played);
  for (const minion of player.minions) {
    const bonus = synergyBonus(player.synergies, minion.line, 'range');
    if (bonus > 0) minion.rangeBonus = bonus;
    else delete minion.rangeBonus;
  }
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
    player.placements = [];
    player.played = [];
    respawnSurvivors(player);
    refreshSynergies(player);
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
    stats: createStats(),
  };
  startRound(state, 1);
  return state;
}

function reject(state: MatchState, reason: PlayError): PlayResult {
  return { ok: false, state, reason };
}

/**
 * Spielt die Handkarte `handIndex` für `playerIndex` aus, bei Bedarf auf `lineIndex`. Eine Beschwörung steht danach
 * auf Slot `slot` der Line (ohne Angabe: auf dem ersten freien Slot); bei anderen Karten wird `slot` ignoriert.
 * Karten mit Ziel `minion` brauchen `targetMinionId`, einen eigenen lebenden Minion.
 * Bei einem Fehler kommt der unveränderte Zustand zurück.
 */
export function playCard(
  state: MatchState,
  playerIndex: PlayerIndex,
  handIndex: number,
  lineIndex?: number,
  slot?: number,
  targetMinionId?: number,
): PlayResult {
  if (state.phase !== 'planning') return reject(state, 'not-planning');
  if (state.ready[playerIndex]) return reject(state, 'already-ready');
  const current = state.players[playerIndex];
  const cardId = current.hand[handIndex];
  if (cardId === undefined) return reject(state, 'no-such-card');
  const def = getCardDef(cardId);
  if (current.energy < def.cost) return reject(state, 'not-enough-energy');
  let summonSlot = 0;
  if (def.target === 'line') {
    if (lineIndex === undefined || !isLaneUnlocked(current.level, lineIndex)) return reject(state, 'invalid-line');
    if (def.type === 'summon') {
      const slotCount = lineCapacity(current.level);
      if (current.minions.filter((m) => m.line === lineIndex).length >= slotCount) return reject(state, 'line-full');
      if (slot === undefined) {
        const free = firstFreeSlot(current.minions, lineIndex, slotCount);
        if (free === undefined) return reject(state, 'slot-taken');
        summonSlot = free;
      } else {
        if (!isValidSlot(slot, slotCount)) return reject(state, 'invalid-slot');
        if (!isSlotFree(current.minions, lineIndex, slot)) return reject(state, 'slot-taken');
        summonSlot = slot;
      }
    }
  }
  if (def.target === 'minion') {
    if (targetMinionId === undefined || !current.minions.some((m) => m.id === targetMinionId && m.hp > 0)) {
      return reject(state, 'invalid-target');
    }
  }
  if (def.type === 'line-upgrade' && current.level >= MAX_FIELD_LEVEL) return reject(state, 'max-level');

  const next = structuredClone(state);
  const player = next.players[playerIndex];
  player.energy -= def.cost;
  player.hand.splice(handIndex, 1);
  const line = def.target === 'line' ? player.lines[lineIndex!]! : undefined;
  const played: PlayedCard = { cardId };
  if (def.target === 'line') played.line = lineIndex;
  if (def.target === 'minion') played.line = player.minions.find((m) => m.id === targetMinionId)!.line;
  switch (def.type) {
    case 'line-upgrade':
      // Neue Ausbaustufe: die frisch freien Lanes (je eine oberhalb und unterhalb) bekommen ihre Tower.
      player.level += 1;
      player.lines.forEach((lane, index) => {
        if (isLaneUnlocked(player.level, index) && lane.towers.length === 0) lane.towers = createLaneTowers(index);
      });
      break;
    case 'tower-upgrade': {
      const tower = upgradeTarget(line!.towers);
      tower.maxHp += def.hp;
      tower.hp += def.hp;
      tower.damage += def.damage;
      break;
    }
    case 'summon': {
      const minion: Minion = {
        id: player.nextMinionId,
        line: lineIndex!,
        position: slotPosition(summonSlot),
        hp: def.hp + line!.bonus.hp,
        damage: def.damage + line!.bonus.damage,
        range: def.range ?? MINION_RANGE,
        speed: def.speed ?? MINION_SPEED,
        maxHp: def.hp + line!.bonus.hp,
        ...(def.role === 'healer' ? { heals: true } : {}),
        ...(def.explodes ? { explodes: { ...def.explodes } } : {}),
      };
      player.nextMinionId += 1;
      player.minions.push(minion);
      player.placements.push({ minionId: minion.id, cardId });
      played.minionId = minion.id;
      if (playerIndex === STATS_PLAYER) recordSummon(next.stats, minion.id, cardId, minion.line);
      break;
    }
    case 'minion-upgrade':
      for (const target of def.scope === 'all' ? player.lines : [line!]) {
        target.bonus.hp += def.hp;
        target.bonus.damage += def.damage;
      }
      break;
    case 'minion-buff':
      applyMinionBuff(player.minions.find((m) => m.id === targetMinionId)!);
      break;
  }
  player.played.push(played);
  refreshSynergies(player);
  return { ok: true, state: next };
}

/**
 * Verschiebt einen in dieser Planungsphase beschworenen Minion auf Line `lineIndex`, Slot `slot` (kostenlos, beliebig
 * oft bis „Bereit“). Der eigene alte Platz zählt dabei als frei. Bei einem Fehler kommt der alte Zustand zurück.
 */
export function moveMinion(
  state: MatchState,
  playerIndex: PlayerIndex,
  minionId: number,
  lineIndex: number,
  slot: number,
): PlayResult {
  if (state.phase !== 'planning') return reject(state, 'not-planning');
  if (state.ready[playerIndex]) return reject(state, 'already-ready');
  const current = state.players[playerIndex];
  if (!current.placements.some((p) => p.minionId === minionId) || !current.minions.some((m) => m.id === minionId)) {
    return reject(state, 'no-such-minion');
  }
  if (!isLaneUnlocked(current.level, lineIndex)) return reject(state, 'invalid-line');
  const others = current.minions.filter((m) => m.id !== minionId);
  const slotCount = lineCapacity(current.level);
  if (others.filter((m) => m.line === lineIndex).length >= slotCount) return reject(state, 'line-full');
  if (!isValidSlot(slot, slotCount)) return reject(state, 'invalid-slot');
  if (!isSlotFree(others, lineIndex, slot)) return reject(state, 'slot-taken');
  const next = structuredClone(state);
  const moved = next.players[playerIndex].minions.find((m) => m.id === minionId)!;
  if (playerIndex === STATS_PLAYER) recordMove(next.stats, minionId, moved.line, lineIndex);
  moved.line = lineIndex;
  moved.position = slotPosition(slot);
  const owner = next.players[playerIndex];
  // Jede Platzierung dieser Runde hat einen Eintrag in `played` (beide entstehen in `playCard`).
  owner.played.find((p) => p.minionId === minionId)!.line = lineIndex;
  refreshSynergies(owner);
  return { ok: true, state: next };
}

/**
 * Nimmt eine in dieser Planungsphase gespielte Beschwörung zurück: der Minion verschwindet, die Energie wird erstattet
 * und die Karte kommt ans Ende der Hand. Upgrades lassen sich nicht zurücknehmen.
 */
export function undoSummon(state: MatchState, playerIndex: PlayerIndex, minionId: number): PlayResult {
  if (state.phase !== 'planning') return reject(state, 'not-planning');
  if (state.ready[playerIndex]) return reject(state, 'already-ready');
  const placement = state.players[playerIndex].placements.find((p) => p.minionId === minionId);
  if (!placement) return reject(state, 'no-such-minion');
  const next = structuredClone(state);
  const player = next.players[playerIndex];
  if (playerIndex === STATS_PLAYER) {
    recordUndo(next.stats, minionId, player.minions.find((m) => m.id === minionId)!.line);
  }
  player.minions = player.minions.filter((m) => m.id !== minionId);
  player.placements = player.placements.filter((p) => p.minionId !== minionId);
  player.played = player.played.filter((p) => p.minionId !== minionId);
  refreshSynergies(player);
  player.energy += getCardDef(placement.cardId).cost;
  player.hand.push(placement.cardId);
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
    combatTick(next.players, undefined, (side, minionId, kind, amount) => {
      if (side === STATS_PLAYER) recordDamage(next.stats, minionId, kind, amount);
    });
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
