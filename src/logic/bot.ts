/**
 * Lokaler Gegner mit festen Regeln. Er liest nur den eigenen Spieler (kein Blick auf die Karten des Gegners)
 * und entscheidet ohne Zufall.
 */
import { getCardDef } from './cards';
import { laneUnlockLevel } from './lanes';
import type { Minion } from './combat';
import {
  buyLane,
  DISCARD_ENERGY,
  discardCard,
  DRAW_COST,
  drawCard,
  HAND_LIMIT,
  LANE_COST,
  MAX_ENERGY,
  MAX_ROUNDS,
  type MatchState,
  openLanes,
  type PlayerIndex,
  playCard,
  setReady,
  specializeTarget,
  SPECIALIZE_MIN_LEVEL,
  UPGRADE_COST,
  upgradeField,
} from './match';
import { firstFreeSlot } from './placement';

/**
 * Wirtschaftsaktionen, die neben den Karten-IDs in einer Prioritätsliste stehen dürfen: Feld-Upgrade, Lane kaufen
 * (die niedrigste kaufbare) und eine Karte ziehen. Fehlen sie in der Liste, nutzt der Bot sie nicht.
 */
export const ECONOMY_ACTIONS = ['upgrade', 'buy-lane', 'draw'] as const;
export type EconomyAction = (typeof ECONOMY_ACTIONS)[number];

/** Reihenfolge, in der der Bot Karten und Wirtschaftsaktionen bevorzugt. */
const PRIORITY = [
  'upgrade',
  'summon-minion',
  'summon-archer',
  'summon-healer',
  'summon-destroyer',
  'summon-scout',
  'tower-hp',
  'buy-lane',
  'minion-upgrade-line',
  'summon-brute',
  'summon-mage',
  'lane-buff',
  'buff-minion',
  'tower-damage',
  'summon-guard',
  'lane-shield',
  'tower-armor',
  'tower-lightning',
  'tower-shield',
  'minion-upgrade-elite',
  'minion-upgrade-all',
  'draw',
];

/** Ziel-Minion einer Karte: der lebende eigene mit dem meisten `maxHp` (bei Gleichstand die kleinste Id), oder `undefined`. */
function chooseMinion(state: MatchState, playerIndex: PlayerIndex): number | undefined {
  const size = (m: Minion) => m.maxHp ?? m.hp;
  return state.players[playerIndex].minions
    .filter((m) => m.hp > 0)
    .reduce<Minion | undefined>(
      (best, m) => (best === undefined || size(m) > size(best) || (size(m) === size(best) && m.id < best.id) ? m : best),
      undefined,
    )?.id;
}

/** Ziel-Lane einer Karte (die freie mit dem kleinsten Wert, bei Gleichstand die niedrigste), oder `undefined`. */
function chooseLine(state: MatchState, playerIndex: PlayerIndex, cardId: string): number | undefined {
  const player = state.players[playerIndex];
  const def = getCardDef(cardId);
  const lines = openLanes(player);
  const minions = (line: number) => player.minions.filter((m) => m.line === line).length;
  const pick = (candidates: number[], score: (line: number) => number): number | undefined =>
    candidates.reduce<number | undefined>(
      (best, line) => (best === undefined || score(line) < score(best) ? line : best),
      undefined,
    );
  switch (def.type) {
    case 'summon':
      return pick(
        lines.filter((line) => firstFreeSlot(player.minions, line, player.lines[line]!.towers) !== undefined),
        minions,
      );
    case 'lane-card':
      // Nur Lanes mit eigenen Minions und freiem Lane-Slot; die mit den meisten Minions, bei Gleichstand die niedrigste.
      return pick(
        lines.filter((line) => minions(line) > 0 && player.lines[line]!.laneEffect === undefined),
        (line) => -minions(line),
      );
    case 'tower-upgrade':
      return pick(lines, (line) => player.lines[line]!.towers.reduce((sum, tower) => sum + tower.hp, 0));
    case 'tower-specialize':
      // Nur Lanes ab dem Mindest-Level mit freiem Tower; die mit dem höchsten Level, bei Gleichstand die niedrigste.
      return pick(
        lines.filter(
          (line) =>
            laneUnlockLevel(line) >= SPECIALIZE_MIN_LEVEL && specializeTarget(player.lines[line]!.towers) !== undefined,
        ),
        (line) => -laneUnlockLevel(line),
      );
    case 'minion-upgrade':
      return pick(lines, (line) => -player.lines[line]!.bonus.hp);
  }
}

/**
 * Ein einzelner Zug des Bots: gespielte Karte, Zielline und Ziel-Minion (`undefined` ohne Ziel) und der Zustand danach.
 * Mit `discard` hat der Bot die Karte abgeworfen statt gespielt (`line` ist dann `undefined`). Mit `economy` war es
 * eine Wirtschaftsaktion: `cardId` ist dann leer, bei `buy-lane` steht die gekaufte Lane in `line`.
 */
export interface BotMove {
  cardId: string;
  line: number | undefined;
  minionId?: number;
  discard?: true;
  economy?: EconomyAction;
  state: MatchState;
}

/**
 * Führt die Wirtschaftsaktion `id` aus, falls sie in `priority` vorgesehen und jetzt sinnvoll und legal ist; sonst
 * `null`. Sinnvoll heißt: Upgrade und Lane-Kauf nur, solange ihr Preis bis zum Spielende wieder hereinkommt; Ziehen nur,
 * wenn nach dem Ziehen noch Energie für eine Karte bleibt.
 */
function tryEconomy(state: MatchState, playerIndex: PlayerIndex, id: string): BotMove | null {
  const player = state.players[playerIndex];
  const roundsLeft = MAX_ROUNDS - state.round;
  const done = (action: EconomyAction, result: ReturnType<typeof upgradeField>, line?: number): BotMove | null =>
    result.ok ? { cardId: '', line, economy: action, state: result.state } : null;
  switch (id) {
    case 'upgrade':
      return roundsLeft >= UPGRADE_COST ? done('upgrade', upgradeField(state, playerIndex)) : null;
    case 'buy-lane': {
      if (roundsLeft < LANE_COST) return null;
      const lane = player.lines.findIndex((l, index) => !l.bought && player.level >= laneUnlockLevel(index));
      return lane < 0 ? null : done('buy-lane', buyLane(state, playerIndex, lane), lane);
    }
    case 'draw':
      return player.energy > DRAW_COST && player.hand.length < HAND_LIMIT
        ? done('draw', drawCard(state, playerIndex))
        : null;
    default:
      return null;
  }
}

/** Spielt die Handkarte `id`, falls der Bot sie jetzt legal spielen kann; sonst `null`. */
function tryPlay(state: MatchState, playerIndex: PlayerIndex, id: string): BotMove | null {
  const handIndex = state.players[playerIndex].hand.indexOf(id);
  if (handIndex < 0) return null;
  const def = getCardDef(id);
  const line = def.target === 'line' ? chooseLine(state, playerIndex, id) : undefined;
  if (def.target === 'line' && line === undefined) return null;
  const minionId = def.target === 'minion' ? chooseMinion(state, playerIndex) : undefined;
  if (def.target === 'minion' && minionId === undefined) return null;
  const result = playCard(state, playerIndex, handIndex, line, undefined, minionId);
  return result.ok ? { cardId: id, line, ...(minionId === undefined ? {} : { minionId }), state: result.state } : null;
}

/** Kopie des Zustands, in der `playerIndex` die Energie `energy` (höchstens `MAX_ENERGY`) hat. */
function withEnergy(state: MatchState, playerIndex: PlayerIndex, energy: number): MatchState {
  const copy = structuredClone(state);
  copy.players[playerIndex].energy = Math.min(MAX_ENERGY, energy);
  return copy;
}

/**
 * Wirft eine nutzlose Karte ab, wenn die dafür erhaltene Energie eine bevorzugte Karte spielbar macht, die jetzt knapp
 * nicht bezahlbar ist. Nutzlos ist eine Karte, die nicht in `priority` steht oder auch mit voller Energie kein Ziel hat.
 * Sonst `null`.
 */
function discardStep(state: MatchState, playerIndex: PlayerIndex, priority: readonly string[]): BotMove | null {
  const player = state.players[playerIndex];
  if (player.energy >= MAX_ENERGY) return null;
  const boosted = withEnergy(state, playerIndex, player.energy + DISCARD_ENERGY);
  const wanted = priority.find((id) => player.hand.includes(id) && tryPlay(boosted, playerIndex, id) !== null);
  if (wanted === undefined) return null;
  const full = withEnergy(state, playerIndex, MAX_ENERGY);
  const handIndex = player.hand.findIndex(
    (id) => id !== wanted && (!priority.includes(id) || tryPlay(full, playerIndex, id) === null),
  );
  if (handIndex < 0) return null;
  // Die Karte steht auf der Hand und der Bot plant noch (sonst wäre `wanted` nicht spielbar): das Abwerfen gelingt immer.
  const { state: next } = discardCard(state, playerIndex, handIndex);
  return { cardId: player.hand[handIndex]!, line: undefined, discard: true, state: next };
}

/**
 * Spielt die nächste Karte des Bots nach `priority`; geht das nicht, wirft er gegebenenfalls eine nutzlose Karte ab
 * (siehe `discardStep`). `null`, wenn er nichts mehr tun kann.
 */
export function botStep(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): BotMove | null {
  for (const id of priority) {
    const move = tryEconomy(state, playerIndex, id) ?? tryPlay(state, playerIndex, id);
    if (move) return move;
  }
  return discardStep(state, playerIndex, priority);
}

/**
 * Spielt die Karten des Bots für diese Runde und meldet ihn bereit. `priority` ist die Kartenreihenfolge
 * (Standard: `PRIORITY`); Karten, die darin fehlen, spielt der Bot nicht.
 */
export function botPlan(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): MatchState {
  let current = state;
  for (let move = botStep(current, playerIndex, priority); move; move = botStep(current, playerIndex, priority)) {
    current = move.state;
  }
  return setReady(current, playerIndex);
}
