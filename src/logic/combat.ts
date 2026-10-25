/**
 * Kampfphase: Minions laufen, Minions und Tower verursachen Schaden. Ohne Phaser, ohne Zufall.
 * Der Schaden wird als Rate pro Sekunde angegeben und je Tick mit der Tick-Dauer verrechnet; beide Seiten werden
 * aus demselben Zustand berechnet und gleichzeitig angewendet, damit die Spielerreihenfolge nichts ändert.
 */

/** Länge einer Line in Einheiten. Position 0 liegt am eigenen Tower, `LINE_LENGTH` am gegnerischen. */
export const LINE_LENGTH = 100;
/** Feste Schrittweite der Simulation, unabhängig von der Bildwiederholrate. */
export const TICK_MS = 50;
export const TICK_SECONDS = TICK_MS / 1000;
/** Standard-Reichweite (Nahkämpfer); die Simulation nutzt `Minion.range`. */
export const MINION_RANGE = 4;
/** Standard-Tempo (Minions ohne eigene Rolle); die Simulation nutzt `Minion.speed`. */
export const MINION_SPEED = 10;
export const TOWER_RANGE = 20;

export interface Tower {
  hp: number;
  maxHp: number;
  /** Schaden pro Sekunde. */
  damage: number;
}

export interface Minion {
  id: number;
  line: number;
  /** Weg vom eigenen Tower aus (0 bis `LINE_LENGTH`). */
  position: number;
  hp: number;
  /** Schaden pro Sekunde. */
  damage: number;
  /** Reichweite in Einheiten. */
  range: number;
  /** Tempo in Einheiten pro Sekunde. */
  speed: number;
}

/** Was der Kampf von einem Spieler braucht; `lines[i].tower` ist der Tower der Line i. */
export interface CombatPlayer {
  lines: { tower: Tower }[];
  minions: Minion[];
}

/** Abstand zweier gegnerischer Minions auf derselben Line. */
export function gap(a: Minion, b: Minion): number {
  return LINE_LENGTH - a.position - b.position;
}

/**
 * Meldet den tatsächlich verursachten Schaden eines Minions (`side`, `minionId`) an Minions oder Tower.
 * Der Betrag ist auf die Rest-HP des Ziels gedeckelt; bei mehreren Angreifern wird er anteilig verteilt.
 */
export type DamageCollector = (side: number, minionId: number, kind: 'minion' | 'tower', amount: number) => void;

/**
 * Ein Tick von `deltaSeconds` Sekunden. Verändert die übergebenen Spieler (der Aufrufer arbeitet auf einer Kopie).
 * Ein optionaler `collector` erfährt den Minion-Schaden; ohne ihn ist das Verhalten unverändert.
 */
export function combatTick(
  players: [CombatPlayer, CombatPlayer],
  deltaSeconds: number = TICK_SECONDS,
  collector?: DamageCollector,
): void {
  const minionDamage = players.map((player) => player.minions.map(() => 0));
  const towerDamage = players.map((player) => player.lines.map(() => 0));
  /** Treffer von Minions für den Sammler; Ziel ist ein Minion-Index oder (bei `kind` 'tower') ein Line-Index. */
  const hits: { side: number; minionId: number; kind: 'minion' | 'tower'; targetSide: number; target: number; amount: number }[] = [];
  const nextPosition = players.map((player) => player.minions.map((minion) => minion.position));

  for (const side of [0, 1] as const) {
    const me = players[side];
    const enemySide = 1 - side;
    const enemy = players[enemySide];

    me.minions.forEach((minion, index) => {
      let target = -1;
      let best = Infinity;
      enemy.minions.forEach((other, otherIndex) => {
        if (other.line !== minion.line) return;
        const distance = gap(minion, other);
        if (distance <= minion.range && distance < best) {
          best = distance;
          target = otherIndex;
        }
      });
      if (target >= 0) {
        minionDamage[enemySide]![target]! += minion.damage * deltaSeconds;
        hits.push({ side, minionId: minion.id, kind: 'minion', targetSide: enemySide, target, amount: minion.damage * deltaSeconds });
        return;
      }
      const tower = enemy.lines[minion.line]!.tower;
      if (tower.hp > 0 && LINE_LENGTH - minion.position <= minion.range) {
        towerDamage[enemySide]![minion.line]! += minion.damage * deltaSeconds;
        hits.push({ side, minionId: minion.id, kind: 'tower', targetSide: enemySide, target: minion.line, amount: minion.damage * deltaSeconds });
        return;
      }
      nextPosition[side]![index] = Math.min(LINE_LENGTH, minion.position + minion.speed * deltaSeconds);
    });

    me.lines.forEach((line, lineIndex) => {
      if (line.tower.hp <= 0) return;
      let target = -1;
      let furthest = -Infinity;
      enemy.minions.forEach((other, otherIndex) => {
        if (other.line !== lineIndex || LINE_LENGTH - other.position > TOWER_RANGE) return;
        if (other.position > furthest) {
          furthest = other.position;
          target = otherIndex;
        }
      });
      if (target >= 0) minionDamage[enemySide]![target]! += line.tower.damage * deltaSeconds;
    });
  }

  if (collector) {
    for (const hit of hits) {
      const target = players[hit.targetSide]!;
      const incoming = hit.kind === 'minion' ? minionDamage[hit.targetSide]![hit.target]! : towerDamage[hit.targetSide]![hit.target]!;
      const remaining = hit.kind === 'minion' ? target.minions[hit.target]!.hp : target.lines[hit.target]!.tower.hp;
      const share = incoming > remaining ? remaining / incoming : 1;
      collector(hit.side, hit.minionId, hit.kind, hit.amount * share);
    }
  }

  players.forEach((player, side) => {
    player.minions.forEach((minion, index) => {
      minion.position = nextPosition[side]![index]!;
      minion.hp -= minionDamage[side]![index]!;
    });
    player.minions = player.minions.filter((minion) => minion.hp > 1e-9);
    player.lines.forEach((line, index) => {
      line.tower.hp = Math.max(0, line.tower.hp - towerDamage[side]![index]!);
    });
  });
}

export function towersAlive(player: CombatPlayer): number {
  return player.lines.filter((line) => line.tower.hp > 0).length;
}

export function totalTowerHp(player: CombatPlayer): number {
  return player.lines.reduce((sum, line) => sum + line.tower.hp, 0);
}
