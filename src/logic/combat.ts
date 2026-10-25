/**
 * Kampfphase: Minions laufen, Minions und Tower verursachen Schaden. Ohne Phaser, ohne Zufall.
 * Der Schaden wird als Rate pro Sekunde angegeben und je Tick mit der Tick-Dauer verrechnet; beide Seiten werden
 * aus demselben Zustand berechnet und gleichzeitig angewendet, damit die Spielerreihenfolge nichts ändert.
 */

/**
 * Länge einer Lane in Einheiten. Die Lane läuft waagrecht: Position 0 liegt am eigenen (linken) Ende, `LINE_LENGTH`
 * am gegnerischen (rechten). Jeder Spieler zählt vom eigenen Ende aus.
 */
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
  /** Standort auf der Lane, vom eigenen Ende aus; fehlt er, steht der Tower am Ende (0). */
  offset?: number;
  hp: number;
  maxHp: number;
  /** Schaden pro Sekunde. */
  damage: number;
}

export interface Minion {
  id: number;
  /** Index der Lane. */
  line: number;
  /** Weg vom eigenen Ende der Lane aus (0 bis `LINE_LENGTH`). */
  position: number;
  hp: number;
  /** Obergrenze für Heilung; beim Beschwören gleich `hp`. Fehlt es, gilt `hp`. */
  maxHp?: number;
  /** Heilt statt anzugreifen: `damage` ist dann Heilung in HP pro Sekunde. */
  heals?: boolean;
  /** Schaden pro Sekunde. */
  damage: number;
  /** Reichweite in Einheiten. */
  range: number;
  /** Tempo in Einheiten pro Sekunde. */
  speed: number;
}

/** Was der Kampf von einem Spieler braucht; `lines[i].towers` sind die Tower der Lane i (leer: Lane nicht frei). */
export interface CombatPlayer {
  lines: { towers: Tower[] }[];
  minions: Minion[];
}

/** Abstand zweier gegnerischer Minions auf derselben Lane. */
export function gap(a: Minion, b: Minion): number {
  return LINE_LENGTH - a.position - b.position;
}

/** Abstand eines gegnerischen Minions (Position `position`, vom anderen Ende gezählt) zu einem Tower der Lane. */
export function towerDistance(tower: Tower, position: number): number {
  return LINE_LENGTH - position - (tower.offset ?? 0);
}

/** Index des lebenden Towers, der dem anrückenden Minion am nächsten steht, oder `-1`, wenn keiner lebt. */
function nearestTower(towers: readonly Tower[], position: number): number {
  let best = -1;
  let bestDistance = Infinity;
  towers.forEach((tower, index) => {
    const distance = towerDistance(tower, position);
    if (tower.hp > 0 && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Index des Verbündeten, den der Heiler `healerIndex` heilt: gleiche Lane, im Abstand `range`, verwundet und am Leben,
 * nie der Heiler selbst; niedrigster HP-Anteil, bei Gleichstand der kleinere Index. `-1`, wenn es keinen gibt.
 */
function healTarget(allies: Minion[], healerIndex: number): number {
  const healer = allies[healerIndex]!;
  let target = -1;
  let lowest = Infinity;
  allies.forEach((ally, index) => {
    const maxHp = ally.maxHp ?? ally.hp;
    if (index === healerIndex || ally.line !== healer.line || ally.hp <= 1e-9 || ally.hp >= maxHp) return;
    if (Math.abs(ally.position - healer.position) > healer.range) return;
    const ratio = ally.hp / maxHp;
    if (ratio < lowest) {
      lowest = ratio;
      target = index;
    }
  });
  return target;
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
  const healing = players.map((player) => player.minions.map(() => 0));
  const towerDamage = players.map((player) => player.lines.map((line) => line.towers.map(() => 0)));
  /** Treffer von Minions für den Sammler; Ziel ist ein Minion-Index oder (bei `kind` 'tower') Lane und Tower. */
  const hits: {
    side: number;
    minionId: number;
    kind: 'minion' | 'tower';
    targetSide: number;
    target: number;
    tower: number;
    amount: number;
  }[] = [];
  const nextPosition = players.map((player) => player.minions.map((minion) => minion.position));

  for (const side of [0, 1] as const) {
    const me = players[side];
    const enemySide = 1 - side;
    const enemy = players[enemySide];

    me.minions.forEach((minion, index) => {
      if (minion.heals) {
        const ally = healTarget(me.minions, index);
        if (ally >= 0) healing[side]![ally]! += minion.damage * deltaSeconds;
        nextPosition[side]![index] = Math.min(LINE_LENGTH, minion.position + minion.speed * deltaSeconds);
        return;
      }
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
        hits.push({ side, minionId: minion.id, kind: 'minion', targetSide: enemySide, target, tower: -1, amount: minion.damage * deltaSeconds });
        return;
      }
      const towers = enemy.lines[minion.line]!.towers;
      const tower = nearestTower(towers, minion.position);
      if (tower >= 0 && towerDistance(towers[tower]!, minion.position) <= minion.range) {
        towerDamage[enemySide]![minion.line]![tower]! += minion.damage * deltaSeconds;
        hits.push({ side, minionId: minion.id, kind: 'tower', targetSide: enemySide, target: minion.line, tower, amount: minion.damage * deltaSeconds });
        return;
      }
      nextPosition[side]![index] = Math.min(LINE_LENGTH, minion.position + minion.speed * deltaSeconds);
    });

    me.lines.forEach((line, lineIndex) => {
      for (const tower of line.towers) {
        if (tower.hp <= 0) continue;
        let target = -1;
        let furthest = -Infinity;
        enemy.minions.forEach((other, otherIndex) => {
          if (other.line !== lineIndex || towerDistance(tower, other.position) > TOWER_RANGE) return;
          if (other.position > furthest) {
            furthest = other.position;
            target = otherIndex;
          }
        });
        if (target >= 0) minionDamage[enemySide]![target]! += tower.damage * deltaSeconds;
      }
    });
  }

  if (collector) {
    for (const hit of hits) {
      const target = players[hit.targetSide]!;
      const incoming =
        hit.kind === 'minion'
          ? minionDamage[hit.targetSide]![hit.target]!
          : towerDamage[hit.targetSide]![hit.target]![hit.tower]!;
      const remaining =
        hit.kind === 'minion' ? target.minions[hit.target]!.hp : target.lines[hit.target]!.towers[hit.tower]!.hp;
      const share = incoming > remaining ? remaining / incoming : 1;
      collector(hit.side, hit.minionId, hit.kind, hit.amount * share);
    }
  }

  players.forEach((player, side) => {
    player.minions.forEach((minion, index) => {
      minion.position = nextPosition[side]![index]!;
      minion.hp = Math.min(minion.maxHp ?? minion.hp, minion.hp - minionDamage[side]![index]! + healing[side]![index]!);
    });
    player.minions = player.minions.filter((minion) => minion.hp > 1e-9);
    player.lines.forEach((line, index) => {
      line.towers.forEach((tower, towerIndex) => {
        tower.hp = Math.max(0, tower.hp - towerDamage[side]![index]![towerIndex]!);
      });
    });
  });
}

export function towersAlive(player: CombatPlayer): number {
  return player.lines.reduce((sum, line) => sum + line.towers.filter((tower) => tower.hp > 0).length, 0);
}

export function totalTowerHp(player: CombatPlayer): number {
  return player.lines.reduce((sum, line) => sum + line.towers.reduce((inner, tower) => inner + tower.hp, 0), 0);
}
