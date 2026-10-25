/**
 * Visuelle Ereignisse aus dem Vergleich zweier Spielzustände (Treffer, Tod, Beschwörung, Turmschaden).
 * Ohne Phaser: Die Szene wandelt die Ereignisse in Partikel, Tweens und Schadenszahlen um. Verändert den Zustand nie.
 */
import type { MatchState } from './match';

export type FxEvent =
  | { kind: 'summon'; owner: number; minionId: number; line: number; position: number }
  | { kind: 'minion-damage'; owner: number; minionId: number; line: number; position: number; amount: number }
  | { kind: 'minion-death'; owner: number; minionId: number; line: number; position: number }
  | { kind: 'tower-damage'; owner: number; line: number; tower: number; amount: number }
  | { kind: 'tower-down'; owner: number; line: number; tower: number };

/** Schaden unterhalb dieser Schwelle gilt als Rundungsrauschen. */
const EPSILON = 1e-6;

/**
 * Ereignisse beim Übergang von `prev` nach `next`. Neue Minions sind Beschwörungen; verschwundene Minions gelten nur
 * im Kampf als Tod (in der Planung nimmt der Spieler Minions zurück). Heilung (steigende HP) erzeugt kein Ereignis.
 */
export function diffFx(prev: MatchState, next: MatchState): FxEvent[] {
  const events: FxEvent[] = [];
  for (let owner = 0; owner < next.players.length; owner += 1) {
    const before = prev.players[owner]!;
    const after = next.players[owner]!;
    const beforeById = new Map(before.minions.map((minion) => [minion.id, minion]));
    const afterIds = new Set(after.minions.map((minion) => minion.id));

    for (const minion of after.minions) {
      const old = beforeById.get(minion.id);
      if (!old) {
        events.push({ kind: 'summon', owner, minionId: minion.id, line: minion.line, position: minion.position });
      } else if (old.hp - minion.hp > EPSILON) {
        events.push({
          kind: 'minion-damage',
          owner,
          minionId: minion.id,
          line: minion.line,
          position: minion.position,
          amount: old.hp - minion.hp,
        });
      }
    }
    if (prev.phase === 'combat') {
      for (const minion of before.minions) {
        if (!afterIds.has(minion.id)) {
          events.push({ kind: 'minion-death', owner, minionId: minion.id, line: minion.line, position: minion.position });
        }
      }
    }
    after.lines.forEach((line, index) => {
      line.towers.forEach((tower, towerIndex) => {
        const old = before.lines[index]!.towers[towerIndex];
        if (!old) return; // frisch freigeschaltete Lane
        const lost = old.hp - tower.hp;
        if (lost > EPSILON) events.push({ kind: 'tower-damage', owner, line: index, tower: towerIndex, amount: lost });
        if (old.hp > 0 && tower.hp <= 0) events.push({ kind: 'tower-down', owner, line: index, tower: towerIndex });
      });
    });
  }
  return events;
}
