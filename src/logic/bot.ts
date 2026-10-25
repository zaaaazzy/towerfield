/**
 * Lokaler Gegner mit festen Regeln. Er liest nur den eigenen Spieler (kein Blick auf die Karten des Gegners)
 * und entscheidet ohne Zufall.
 */
import { getCardDef } from './cards';
import { lineCapacity, LINE_COUNT, MAX_LINE_LEVEL, type MatchState, type PlayerIndex, playCard, setReady } from './match';

/** Reihenfolge, in der der Bot Karten bevorzugt. */
const PRIORITY = [
  'summon-minion',
  'tower-hp',
  'line-upgrade',
  'minion-upgrade-line',
  'summon-brute',
  'tower-damage',
  'minion-upgrade-all',
];

/** Zielline einer Karte (die mit dem kleinsten Wert, bei Gleichstand die niedrigste), oder `undefined`. */
function chooseLine(state: MatchState, playerIndex: PlayerIndex, cardId: string): number | undefined {
  const player = state.players[playerIndex];
  const def = getCardDef(cardId);
  const lines = Array.from({ length: LINE_COUNT }, (_, index) => index);
  const minions = (line: number) => player.minions.filter((m) => m.line === line).length;
  const pick = (candidates: number[], score: (line: number) => number): number | undefined =>
    candidates.reduce<number | undefined>(
      (best, line) => (best === undefined || score(line) < score(best) ? line : best),
      undefined,
    );
  switch (def.type) {
    case 'summon':
      return pick(
        lines.filter((line) => minions(line) < lineCapacity(player.lines[line]!.level)),
        minions,
      );
    case 'line-upgrade':
      return pick(
        lines.filter((line) => player.lines[line]!.level < MAX_LINE_LEVEL),
        (line) => player.lines[line]!.level,
      );
    case 'tower-upgrade':
      return pick(lines, (line) => player.lines[line]!.tower.hp);
    case 'minion-upgrade':
      return pick(lines, (line) => -player.lines[line]!.bonus.hp);
  }
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
  for (;;) {
    const player = current.players[playerIndex];
    let played = false;
    for (const id of priority) {
      const handIndex = player.hand.indexOf(id);
      if (handIndex < 0) continue;
      const def = getCardDef(id);
      const line = def.target === 'line' ? chooseLine(current, playerIndex, id) : undefined;
      if (def.target === 'line' && line === undefined) continue;
      const result = playCard(current, playerIndex, handIndex, line);
      if (result.ok) {
        current = result.state;
        played = true;
        break;
      }
    }
    if (!played) break;
  }
  return setReady(current, playerIndex);
}
