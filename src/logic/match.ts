/**
 * Spielzustand und Regeln eines 1-gegen-1-Matches: Runden, Hand, Energie, Karten ausspielen, Sieg.
 * Ohne Phaser, DOM und Canvas. Alle Funktionen geben einen neuen Zustand zurück; der alte bleibt unverändert.
 * Die Planung wirkt nur auf den eigenen Spieler, deshalb ist die Reihenfolge der Spieler egal. Zufall nur
 * zwischen den Runden und über Seeds: die Deck-Reihenfolge und die Runden-Ereignisse (`round-events.ts`); der Kampf
 * bleibt zufallsfrei.
 */
import { applyMinionBuff } from './buff';
import { buildDeck, getCardDef } from './cards';
import {
  combatTick,
  type CombatPlayer,
  LINE_LENGTH,
  type LaneEffect,
  type Minion,
  MINION_RANGE,
  MINION_SPEED,
  TICK_MS,
  TICK_SECONDS,
  type Tower,
  totalTowerHp,
  towersAlive,
} from './combat';
import { createStats, type MatchStats, recordDamage, recordMove, recordSummon, recordUndo } from './match-stats';
import {
  deriveEventSeed,
  EARLY_RESPAWN_TICKS,
  EVENT_ENERGY_BONUS,
  pickRoundEvent,
  type RoundEventId,
  TOWER_SHIELD,
} from './round-events';
import { isLaneUnlocked, LANE_COUNT, laneTowerOffsets, laneUnlockLevel, MAX_FIELD_LEVEL } from './lanes';
import { firstFreeSlot, isSlotFree, isValidSlot, slotPosition, validSlots } from './placement';
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
/** Energie, die das Verschieben eines Minions auf einen anderen Turm-Slot kostet. */
export const MOVE_COST = 1;
/** Energie, die das Abwerfen einer Handkarte bringt; über `MAX_ENERGY` verfällt sie. */
export const DISCARD_ENERGY = 1;
export const TOWER_HP = 100;
export const TOWER_DAMAGE = 8;
/** Mindest-Level einer Lane (Ausbaustufe, ab der sie frei ist, siehe `laneUnlockLevel`) für eine Tower-Spezialisierung. */
export const SPECIALIZE_MIN_LEVEL = 2;
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
  /** Lane-Karte im Lane-Slot hinter den Towern (höchstens eine); gilt nur für die laufende Runde. */
  laneCard?: string;
  /** Wirkung dieser Lane-Karte auf alle Minions der Lane; gesetzt genau dann, wenn `laneCard` gesetzt ist. */
  laneEffect?: LaneEffect;
}

export interface PlayerState extends CombatPlayer {
  /** Ausbaustufe des Feldes (1 bis `MAX_FIELD_LEVEL`); bestimmt, welche Lanes frei sind. Gilt je Spieler. */
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
  /** Zustand des Event-Zufalls, getrennt vom Deck-Seed (siehe `round-events.ts`). */
  eventSeed: number;
  /** Ereignis der laufenden Runde für beide Spieler; `null` in Runden ohne Ereignis. */
  event: RoundEventId | null;
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
  | 'level-too-low'
  | 'already-specialized'
  | 'invalid-target'
  | 'lane-slot-taken';

export type PlayResult = { ok: true; state: MatchState } | { ok: false; state: MatchState; reason: PlayError };

/** Slot-Zahl je Lane-Index: zwei je lebendem Tower, 0 für gesperrte Lanes und Lanes ohne lebenden Tower. */
export function laneSlotCounts(player: PlayerState): number[] {
  return player.lines.map((line) => validSlots(line.towers).length);
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

/**
 * Tower, den eine Spezialisierung trifft: der vorderste lebende Tower der Lane ohne Spezialisierung (größter
 * Standort, er steht dem Gegner am nächsten), sonst `undefined`.
 */
export function specializeTarget(towers: Tower[]): Tower | undefined {
  return towers
    .filter((tower) => tower.hp > 0 && tower.specialization === undefined)
    .reduce<Tower | undefined>((best, tower) => (!best || (tower.offset ?? 0) > (best.offset ?? 0) ? tower : best), undefined);
}

export function energyForRound(round: number): number {
  return Math.min(MAX_ENERGY, BASE_ENERGY + (round - 1) * ENERGY_PER_ROUND);
}

/** Energie zu Beginn der Runde: `energyForRound` plus der Bonus des Ereignisses, höchstens `MAX_ENERGY`. */
export function roundEnergy(round: number, event: RoundEventId | null): number {
  const bonus = event === 'energy' ? EVENT_ENERGY_BONUS : 0;
  return Math.min(MAX_ENERGY, energyForRound(round) + bonus);
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
 * Stellt die überlebenden Minions eines Spielers (in unveränderter Reihenfolge) zurück auf ihre Turm-Slots (verändert
 * `player`): Sie kämpfen jede
 * Runde von demselben Tower aus und müssen nicht neu gesetzt werden. Tote Minions und Minions, deren Tower zerstört ist,
 * entfallen. Ein Minion ohne Slot (Altzustand) bekommt den ersten freien Slot seiner Lane oder entfällt, wenn keiner frei ist.
 */
export function respawnSurvivors(player: PlayerState): void {
  const placed: Minion[] = [];
  const keep = (minion: Minion, slot: number): void => {
    const towers = player.lines[minion.line]!.towers;
    placed.push({ ...minion, slot, position: slotPosition(towers, slot) });
  };
  const alive = player.minions.filter((m) => m.hp > 0);
  for (const minion of alive.filter((m) => m.slot !== undefined)) {
    if (isValidSlot(player.lines[minion.line]!.towers, minion.slot!)) keep(minion, minion.slot!);
  }
  for (const minion of alive.filter((m) => m.slot === undefined)) {
    const slot = firstFreeSlot(placed, minion.line, player.lines[minion.line]!.towers);
    if (slot !== undefined) keep(minion, slot);
  }
  const byId = new Map(placed.map((m) => [m.id, m]));
  player.minions = alive.filter((m) => byId.has(m.id)).map((m) => byId.get(m.id)!);
}

/**
 * „Früher Aufbruch“ (verändert `player`): Die überlebenden Minions (alle, die nicht in dieser Planung beschworen wurden)
 * starten `EARLY_RESPAWN_TICKS` Ticks früher, also um die in dieser Zeit gelaufene Strecke weiter vorn. Gilt ab Beginn
 * der Kampfphase, damit die Slots der Planung unberührt bleiben (siehe `respawnSurvivors`).
 */
export function applyEarlyRespawn(player: PlayerState): void {
  const fresh = new Set(player.placements.map((p) => p.minionId));
  for (const minion of player.minions) {
    if (fresh.has(minion.id)) continue;
    minion.position = Math.min(LINE_LENGTH, minion.position + minion.speed * EARLY_RESPAWN_TICKS * TICK_SECONDS);
  }
}

/** Entfernt alle Tower-Schilde (verändert `player`); am Ende der Kampfphase. */
function clearShields(player: PlayerState): void {
  for (const line of player.lines) for (const tower of line.towers) delete tower.shield;
}

/** „Tower-Schild“: Schild auf allen lebenden Towern (verändert `player`). */
function applyTowerShield(player: PlayerState): void {
  for (const line of player.lines) for (const tower of line.towers) if (tower.hp > 0) tower.shield = TOWER_SHIELD;
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
  const pick = pickRoundEvent(state.eventSeed, round);
  state.eventSeed = pick.seed;
  state.event = pick.event;
  for (const player of state.players) {
    clearShields(player);
    if (state.event === 'tower-shield') applyTowerShield(player);
    player.energy = roundEnergy(round, state.event);
    player.placements = [];
    player.played = [];
    for (const line of player.lines) {
      delete line.laneCard;
      delete line.laneEffect;
    }
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
    eventSeed: deriveEventSeed(seed),
    event: null,
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
    const towers = current.lines[lineIndex]!.towers;
    if (def.type === 'summon') {
      if (slot === undefined) {
        const free = firstFreeSlot(current.minions, lineIndex, towers);
        if (free === undefined) return reject(state, 'line-full');
        summonSlot = free;
      } else {
        if (!isValidSlot(towers, slot)) return reject(state, 'invalid-slot');
        if (!isSlotFree(current.minions, lineIndex, slot)) return reject(state, 'slot-taken');
        summonSlot = slot;
      }
    }
    if (def.type === 'lane-card') {
      if (!towers.some((tower) => tower.hp > 0)) return reject(state, 'invalid-line');
      if (current.lines[lineIndex]!.laneEffect !== undefined) return reject(state, 'lane-slot-taken');
    }
  }
  if (def.target === 'minion') {
    if (targetMinionId === undefined || !current.minions.some((m) => m.id === targetMinionId && m.hp > 0)) {
      return reject(state, 'invalid-target');
    }
  }
  if (def.type === 'line-upgrade' && current.level >= MAX_FIELD_LEVEL) return reject(state, 'max-level');
  if (def.type === 'tower-specialize') {
    if (laneUnlockLevel(lineIndex!) < SPECIALIZE_MIN_LEVEL) return reject(state, 'level-too-low');
    if (!specializeTarget(current.lines[lineIndex!]!.towers)) return reject(state, 'already-specialized');
  }

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
    case 'tower-specialize':
      specializeTarget(line!.towers)!.specialization = def.path;
      break;
    case 'summon': {
      const minion: Minion = {
        id: player.nextMinionId,
        line: lineIndex!,
        position: slotPosition(line!.towers, summonSlot),
        slot: summonSlot,
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
    case 'lane-card':
      line!.laneCard = cardId;
      line!.laneEffect = def.effect;
      break;
  }
  player.played.push(played);
  refreshSynergies(player);
  return { ok: true, state: next };
}

/**
 * Verschiebt einen eigenen lebenden Minion auf Lane `lineIndex`, Slot `slot` für die nächste Runde. Das kostet
 * `MOVE_COST` Energie; bei zu wenig Energie bleibt das Minion, wo es ist. Das Ziel muss ein freier Slot eines lebenden
 * Towers sein (der eigene Slot zählt als belegt). Bei einem Fehler kommt der alte Zustand zurück.
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
  if (!current.minions.some((m) => m.id === minionId && m.hp > 0)) return reject(state, 'no-such-minion');
  if (!isLaneUnlocked(current.level, lineIndex)) return reject(state, 'invalid-line');
  const towers = current.lines[lineIndex]!.towers;
  if (!isValidSlot(towers, slot)) return reject(state, 'invalid-slot');
  if (!isSlotFree(current.minions, lineIndex, slot)) return reject(state, 'slot-taken');
  if (current.energy < MOVE_COST) return reject(state, 'not-enough-energy');
  const next = structuredClone(state);
  const owner = next.players[playerIndex];
  const moved = owner.minions.find((m) => m.id === minionId)!;
  if (playerIndex === STATS_PLAYER) recordMove(next.stats, minionId, moved.line, lineIndex);
  owner.energy -= MOVE_COST;
  moved.line = lineIndex;
  moved.slot = slot;
  moved.position = slotPosition(towers, slot);
  // Eine Beschwörung dieser Runde hat einen Eintrag in `played`; Überlebende früherer Runden nicht.
  const entry = owner.played.find((p) => p.minionId === minionId);
  if (entry) entry.line = lineIndex;
  refreshSynergies(owner);
  return { ok: true, state: next };
}

/**
 * Wirft die Handkarte `handIndex` ab: Sie verschwindet aus dem Spiel, der Spieler erhält `DISCARD_ENERGY` Energie
 * (höchstens bis `MAX_ENERGY`, der Rest verfällt).
 */
export function discardCard(state: MatchState, playerIndex: PlayerIndex, handIndex: number): PlayResult {
  if (state.phase !== 'planning') return reject(state, 'not-planning');
  if (state.ready[playerIndex]) return reject(state, 'already-ready');
  if (state.players[playerIndex].hand[handIndex] === undefined) return reject(state, 'no-such-card');
  const next = structuredClone(state);
  const player = next.players[playerIndex];
  player.hand.splice(handIndex, 1);
  player.energy = Math.min(MAX_ENERGY, player.energy + DISCARD_ENERGY);
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
    if (next.event === 'early-respawn') for (const player of next.players) applyEarlyRespawn(player);
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
  for (const player of state.players) clearShields(player);
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
