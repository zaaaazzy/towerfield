/**
 * Visuelle und akustische Ereignisse aus dem Vergleich zweier Spielzustände (Treffer, Heilung, Tod, Beschwörung,
 * Turmschaden, Schild, Rundenwechsel, Spielende). Ohne Phaser: Die Szene wandelt die Ereignisse in Partikel, Tweens,
 * Schadenszahlen und (über `audio-events.ts`) Töne um. Verändert den Zustand nie.
 */
import { effectiveRange, LINE_LENGTH, MINION_RANGE, type Minion, TOWER_RANGE, towerDistance } from './combat';
import type { MatchState, Outcome } from './match';

/** Womit ein Minion getroffen wurde: Nahkampf, Fernschuss (Bogen, Tower) oder Blitz-Turm. */
export type DamageSource = 'melee' | 'arrow' | 'lightning';

export type FxEvent =
  | { kind: 'summon'; owner: number; minionId: number; line: number; position: number }
  | {
      kind: 'minion-damage';
      owner: number;
      minionId: number;
      line: number;
      position: number;
      amount: number;
      source: DamageSource;
    }
  /** Ein verwundeter Minion hat im Kampf HP zurückbekommen (Heiler). */
  | { kind: 'minion-heal'; owner: number; minionId: number; line: number; position: number; amount: number }
  | { kind: 'minion-death'; owner: number; minionId: number; line: number; position: number }
  /** Ein Zerstörer ist im Kampf gestorben und explodiert; `radius` in Lane-Einheiten. */
  | { kind: 'explosion'; owner: number; minionId: number; line: number; position: number; radius: number }
  | { kind: 'tower-damage'; owner: number; line: number; tower: number; amount: number }
  | { kind: 'tower-down'; owner: number; line: number; tower: number }
  /** Ein Schild-Turm wurde getroffen oder sein Schild (Runden-Ereignis) hat Schaden aufgefangen. */
  | { kind: 'shield-block'; owner: number; line: number; tower: number }
  | { kind: 'round-start'; round: number }
  | { kind: 'round-end'; round: number }
  | { kind: 'match-over'; outcome: Outcome };

/** Schaden unterhalb dieser Schwelle gilt als Rundungsrauschen. */
const EPSILON = 1e-6;

/**
 * Quelle des Schadens an `minion` (Zustand vor dem Tick): ein lebender Blitz-Turm in Reichweite, sonst ein Gegner mit
 * Fernkampf-Reichweite oder ein Tower in Reichweite als Fernschuss, sonst Nahkampf (auch bei Rückwurf und Explosion).
 */
function damageSource(prev: MatchState, owner: number, minion: Minion): DamageSource {
  const enemy = prev.players[1 - owner]!;
  const towers = enemy.lines[minion.line]!.towers;
  const reaches = (tower: (typeof towers)[number]) =>
    tower.hp > 0 && towerDistance(tower, minion.position) <= TOWER_RANGE;
  if (towers.some((tower) => tower.specialization === 'lightning' && reaches(tower))) return 'lightning';
  const attackers = enemy.minions.filter(
    (other) =>
      other.line === minion.line &&
      !other.heals &&
      other.hp > 0 &&
      LINE_LENGTH - other.position - minion.position <= effectiveRange(other),
  );
  if (attackers.some((other) => other.range > MINION_RANGE)) return 'arrow';
  if (attackers.length > 0) return 'melee';
  return towers.some(reaches) ? 'arrow' : 'melee';
}

/**
 * Ereignisse beim Übergang von `prev` nach `next`. Neue Minions sind Beschwörungen; verschwundene Minions gelten nur
 * im Kampf als Tod (in der Planung nimmt der Spieler Minions zurück). Heilung (steigende HP) zählt nur im Kampf.
 * Dazu kommen Rundenstart, Rundenende und Spielende.
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
          source: damageSource(prev, owner, old),
        });
      } else if (minion.hp - old.hp > EPSILON && prev.phase === 'combat' && next.phase === 'combat') {
        events.push({
          kind: 'minion-heal',
          owner,
          minionId: minion.id,
          line: minion.line,
          position: minion.position,
          amount: minion.hp - old.hp,
        });
      }
    }
    if (prev.phase === 'combat') {
      for (const minion of before.minions) {
        if (!afterIds.has(minion.id)) {
          events.push({ kind: 'minion-death', owner, minionId: minion.id, line: minion.line, position: minion.position });
          if (minion.explodes) {
            events.push({
              kind: 'explosion',
              owner,
              minionId: minion.id,
              line: minion.line,
              position: minion.position,
              radius: minion.explodes.radius,
            });
          }
        }
      }
    }
    after.lines.forEach((line, index) => {
      line.towers.forEach((tower, towerIndex) => {
        const old = before.lines[index]!.towers[towerIndex];
        if (!old) return; // frisch freigeschaltete Lane
        const lost = old.hp - tower.hp;
        if (lost > EPSILON) events.push({ kind: 'tower-damage', owner, line: index, tower: towerIndex, amount: lost });
        // Das Schild verfällt nach dem Kampf; nur der Verlust mitten im Kampf ist ein Block.
        const shieldLost =
          prev.phase === 'combat' && next.phase === 'combat' && (old.shield ?? 0) - (tower.shield ?? 0) > EPSILON;
        if (shieldLost || (tower.specialization === 'shield' && lost > EPSILON)) {
          events.push({ kind: 'shield-block', owner, line: index, tower: towerIndex });
        }
        if (old.hp > 0 && tower.hp <= 0) events.push({ kind: 'tower-down', owner, line: index, tower: towerIndex });
      });
    });
  }
  if (prev.phase !== 'combat' && next.phase === 'combat') events.push({ kind: 'round-start', round: next.round });
  if (prev.phase === 'combat' && next.phase === 'planning') events.push({ kind: 'round-end', round: prev.round });
  if (prev.phase !== 'over' && next.phase === 'over' && next.outcome) {
    events.push({ kind: 'match-over', outcome: next.outcome });
  }
  return events;
}
