/**
 * Lokaler Gegner mit festen Regeln. Er liest nur den eigenen Spieler (kein Blick auf die Karten des Gegners)
 * und entscheidet ohne Zufall.
 */
import { getCardDef } from './cards';
import { unlockedLanes } from './lanes';
import type { Minion } from './combat';
import { lineCapacity, type MatchState, type PlayerIndex, playCard, setReady } from './match';

/** Reihenfolge, in der der Bot Karten bevorzugt. */
const PRIORITY = [
  'summon-minion',
  'summon-archer',
  'summon-healer',
  'summon-destroyer',
  'tower-hp',
  'line-upgrade',
  'minion-upgrade-line',
  'summon-brute',
  'buff-minion',
  'tower-damage',
  'minion-upgrade-all',
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
  const lines = unlockedLanes(player.level).sort((a, b) => a - b);
  const minions = (line: number) => player.minions.filter((m) => m.line === line).length;
  const pick = (candidates: number[], score: (line: number) => number): number | undefined =>
    candidates.reduce<number | undefined>(
      (best, line) => (best === undefined || score(line) < score(best) ? line : best),
      undefined,
    );
  switch (def.type) {
    case 'summon':
      return pick(
        lines.filter((line) => minions(line) < lineCapacity(player.level)),
        minions,
      );
    case 'tower-upgrade':
      return pick(lines, (line) => player.lines[line]!.towers.reduce((sum, tower) => sum + tower.hp, 0));
    case 'minion-upgrade':
      return pick(lines, (line) => -player.lines[line]!.bonus.hp);
  }
}

/** Ein einzelner Zug des Bots: gespielte Karte, Zielline und Ziel-Minion (`undefined` ohne Ziel) und der Zustand danach. */
export interface BotMove {
  cardId: string;
  line: number | undefined;
  minionId?: number;
  state: MatchState;
}

/** Spielt die nächste Karte des Bots nach `priority`, oder `null`, wenn er nichts mehr spielen kann. */
export function botStep(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): BotMove | null {
  const player = state.players[playerIndex];
  for (const id of priority) {
    const handIndex = player.hand.indexOf(id);
    if (handIndex < 0) continue;
    const def = getCardDef(id);
    const line = def.target === 'line' ? chooseLine(state, playerIndex, id) : undefined;
    if (def.target === 'line' && line === undefined) continue;
    const minionId = def.target === 'minion' ? chooseMinion(state, playerIndex) : undefined;
    if (def.target === 'minion' && minionId === undefined) continue;
    const result = playCard(state, playerIndex, handIndex, line, undefined, minionId);
    if (result.ok) return { cardId: id, line, ...(minionId === undefined ? {} : { minionId }), state: result.state };
  }
  return null;
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
