import { describe, expect, it } from 'vitest';
import { applyMinionBuff } from './buff';
import {
  combatTick,
  type CombatPlayer,
  explosionVictims,
  isTowerMinion,
  LANE_BUFF_FACTOR,
  LANE_SHIELD_FACTOR,
  LIGHTNING_FACTOR,
  LINE_LENGTH,
  MINION_RANGE,
  MINION_SPEED,
  SHIELD_REFLECT,
  spawnTowerMinions,
  TICK_SECONDS,
  TOWER_RANGE,
  TOWER_SPAWN_MS,
  totalTowerHp,
  towerDistance,
  towersAlive,
} from './combat';
import {
  CARD_BALANCE,
  MINION_DAMAGE,
  MINION_HP,
  TOWER_DAMAGE,
  TOWER_HP,
  TOWER_SPAWN_DAMAGE,
  TOWER_SPAWN_HP,
  TOWER_SPAWN_RANGE,
  TOWER_SPAWN_SPEED,
} from './balance-config';
import { towerOf } from './test-fixtures';

/** Trefferpunkte für Ziele, die im Test nicht fallen sollen: weit über jedem Schaden eines Tests. */
const SOAK_HP = 1000;
/** Werte der Karten, deren Reichweite oder Heilung die Tests brauchen. */
const ARCHER = CARD_BALANCE['summon-archer'];
const HEALER = CARD_BALANCE['summon-healer'];
const DESTROYER = CARD_BALANCE['summon-destroyer'];

function player(towerHp = TOWER_HP, towerDamage = TOWER_DAMAGE): CombatPlayer {
  return {
    lines: [0, 1, 2].map(() => ({ towers: [{ hp: towerHp, maxHp: towerHp, damage: towerDamage }] })),
    minions: [],
  };
}

function minion(
  id: number,
  line: number,
  position: number,
  hp = MINION_HP,
  damage = MINION_DAMAGE,
  speed = MINION_SPEED,
  range = MINION_RANGE,
) {
  return { id, line, position, hp, damage, range, speed };
}

describe('Lane-Karten im Kampf', () => {
  /** Zwei Minions treffen sich auf Lane 0: Spieler 0 greift mit 10 Schaden/s an, Spieler 1 steht ohne Schaden da. */
  function duel(): [CombatPlayer, CombatPlayer] {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 50, 1000, 10, 0));
    players[1].minions.push(minion(1, 0, 50, 1000, 0, 0));
    for (const side of players) for (const line of side.lines) line.towers[0]!.damage = 0;
    return players;
  }
  const lost = (players: [CombatPlayer, CombatPlayer]) => 1000 - players[1].minions[0]!.hp;

  it('Lane-Buff erhöht den Schaden aller eigenen Minions der Lane, nicht den anderer Lanes', () => {
    const players = duel();
    players[0].lines[0]!.laneEffect = 'buff';
    combatTick(players, 1);
    expect(lost(players)).toBeCloseTo(10 * LANE_BUFF_FACTOR, 9);

    const other = duel();
    other[0].lines[1]!.laneEffect = 'buff';
    combatTick(other, 1);
    expect(lost(other)).toBeCloseTo(10, 9);
  });

  it('Lane-Buff gilt auch gegen Tower und zählt im Sammler', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 96, 30, 10));
    players[0].lines[0]!.laneEffect = 'buff';
    const calls: number[] = [];
    combatTick(players, 0.5, (_side, _id, kind, amount) => void (kind === 'tower' && calls.push(amount)));
    expect(players[1].lines[0]!.towers[0]!.hp).toBeCloseTo(TOWER_HP - 5 * LANE_BUFF_FACTOR, 9);
    expect(calls[0]).toBeCloseTo(5 * LANE_BUFF_FACTOR, 9);
  });

  it('Lane-Schild senkt den erlittenen Schaden der Minions der Lane', () => {
    const players = duel();
    players[1].lines[0]!.laneEffect = 'shield';
    const calls: number[] = [];
    combatTick(players, 1, (_side, _id, kind, amount) => void (kind === 'minion' && calls.push(amount)));
    expect(lost(players)).toBeCloseTo(10 * LANE_SHIELD_FACTOR, 9);
    expect(calls[0]).toBeCloseTo(10 * LANE_SHIELD_FACTOR, 9);
  });

  it('Lane-Schild schützt auch vor Tower-Schüssen und Blitzen', () => {
    for (const specialization of [undefined, 'lightning'] as const) {
      const players: [CombatPlayer, CombatPlayer] = [player(), player()];
      players[0].minions.push(minion(1, 0, 90, 1000, 0, 0));
      players[1].lines[0]!.towers[0]!.damage = 10;
      if (specialization) players[1].lines[0]!.towers[0]!.specialization = specialization;
      players[0].lines[0]!.laneEffect = 'shield';
      combatTick(players, 1);
      const factor = specialization ? LIGHTNING_FACTOR : 1;
      expect(1000 - players[0].minions[0]!.hp).toBeCloseTo(10 * factor * LANE_SHIELD_FACTOR, 9);
    }
  });

  it('wirkt ohne Lane-Karte nicht', () => {
    const players = duel();
    combatTick(players, 1);
    expect(lost(players)).toBeCloseTo(10, 9);
  });
});

describe('Tower-Schild', () => {
  function shielded(shield: number): [CombatPlayer, CombatPlayer] {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].lines[0]!.towers[0]!.shield = shield;
    // Minion 0 steht in Reichweite des gegnerischen Towers: 10 Schaden pro Sekunde.
    players[0].minions.push(minion(1, 0, 96, 30, 10));
    return players;
  }

  it('absorbiert Schaden zuerst und lässt die HP unberührt', () => {
    const players = shielded(5);
    combatTick(players, 0.5);
    const tower = players[1].lines[0]!.towers[0]!;
    expect(tower.shield).toBeCloseTo(0, 9);
    expect(tower.hp).toBe(TOWER_HP);
  });

  it('gibt den Rest nach dem Schild an die HP weiter', () => {
    const players = shielded(2);
    combatTick(players, 0.5);
    const tower = players[1].lines[0]!.towers[0]!;
    expect(tower.shield).toBe(0);
    // 10 Schaden pro Sekunde über 0,5 s = 5; das Schild fängt 2 ab, 3 gehen an die HP.
    expect(tower.hp).toBeCloseTo(TOWER_HP - 3, 9);
  });

  it('meldet dem Sammler den vollen Schaden, solange Schild und HP reichen', () => {
    const players = shielded(5);
    const calls: [number, number, string, number][] = [];
    combatTick(players, 0.5, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    expect(calls).toContainEqual([0, 1, 'tower', 5]);
  });

  it('ohne Schild verhält sich der Tower wie bisher', () => {
    const players = shielded(0);
    delete players[1].lines[0]!.towers[0]!.shield;
    combatTick(players, 0.5);
    expect(players[1].lines[0]!.towers[0]!.hp).toBe(TOWER_HP - 5);
  });
});

describe('Kampf mit Schaden-Sammler', () => {
  type Call = [number, number, string, number];
  const collect = (calls: Call[]) => (side: number, id: number, kind: 'minion' | 'tower', amount: number) =>
    void calls.push([side, id, kind, amount]);

  it('meldet jedem kämpfenden Minion damage * deltaSeconds', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 48, 30, 6));
    players[1].minions.push(minion(7, 0, 48, 30, 10));
    const calls: Call[] = [];
    combatTick(players, 0.5, collect(calls));
    expect(calls).toContainEqual([0, 1, 'minion', 3]);
    expect(calls).toContainEqual([1, 7, 'minion', 5]);
  });

  it('deckelt den Schaden auf die Rest-HP des Ziels', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 48, 30, 60));
    players[1].minions.push(minion(7, 0, 48, 2, 6));
    const calls: Call[] = [];
    combatTick(players, 1, collect(calls));
    expect(calls).toContainEqual([0, 1, 'minion', 2]);
  });

  it('verteilt knappe Rest-HP anteilig auf gleichzeitige Angreifer, auch den Tower', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(TOWER_HP, 30), player()];
    // Ziel (HP 4) steht 5 vor dem Tower von Spieler 0: zwei Minions (je 10) und der Tower (30) treffen es, Summe 50.
    players[0].minions.push(minion(1, 0, 0, 30, 10, MINION_SPEED, 100), minion(2, 0, 0, 30, 10, MINION_SPEED, 100));
    players[1].minions.push(minion(7, 0, 95, 4, 0));
    const calls: Call[] = [];
    combatTick(players, 1, collect(calls));
    const minionHits = calls.filter((c) => c[2] === 'minion');
    expect(minionHits).toHaveLength(2);
    for (const hit of minionHits) expect(hit[3]).toBeCloseTo((10 * 4) / 50, 9);
    expect(calls.every((c) => c[0] === 0)).toBe(true);
  });

  it('rechnet Tower-Schaden dem Minion-Typ zu, nicht dem Tower, und meldet Tower-Schaden an Minions nicht', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    // Minion 1 steht am gegnerischen Tower; Minion 7 (Gegner) wird nur vom Tower von Spieler 0 getroffen.
    players[0].minions.push(minion(1, 0, 98, 30, 6));
    players[1].minions.push(minion(7, 1, 90, 30, 0));
    const calls: Call[] = [];
    combatTick(players, 1, collect(calls));
    expect(calls).toContainEqual([0, 1, 'tower', 6]);
    expect(calls.filter((c) => c[2] === 'minion')).toHaveLength(0);
  });

  it('liefert ohne Sammler dasselbe Ergebnis wie mit Sammler', () => {
    const build = (): [CombatPlayer, CombatPlayer] => {
      const players: [CombatPlayer, CombatPlayer] = [player(), player()];
      players[0].minions.push(minion(1, 0, 40, 30, 6), minion(2, 2, 96, 30, 6));
      players[1].minions.push(minion(7, 0, 56, 30, 10));
      return players;
    };
    const plain = build();
    const counted = build();
    for (let tick = 0; tick < 40; tick += 1) {
      combatTick(plain, TICK_SECONDS);
      combatTick(counted, TICK_SECONDS, () => {});
    }
    expect(counted).toEqual(plain);
  });
});

describe('Kampf', () => {
  it('bewegt ein Minion mit der Geschwindigkeit pro Sekunde', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 0));
    for (let tick = 0; tick < 20; tick += 1) combatTick(players, TICK_SECONDS);
    expect(players[0].minions[0]!.position).toBeCloseTo(MINION_SPEED * 1, 6);
  });

  it('bewegt Minions je nach eigenem Tempo und lässt sie 2 Einheiten auseinanderlaufen', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 0, 30, 6, 8), minion(2, 0, 0, 30, 6, 10));
    for (let tick = 0; tick < 20; tick += 1) combatTick(players, TICK_SECONDS);
    const [slow, fast] = players[0].minions;
    expect(slow!.position).toBeCloseTo(8, 6);
    expect(fast!.position).toBeCloseTo(10, 6);
    expect(fast!.position - slow!.position).toBeCloseTo(2, 6);
  });

  it('hält ein Minion unabhängig vom Tempo an, sobald ein Ziel oder der Tower in Reichweite ist', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, LINE_LENGTH - MINION_RANGE, 30, 6, 50), minion(2, 1, 48, 1000, 6, 50));
    players[1].minions.push(minion(1, 1, 48, 1000, 6, 50));
    combatTick(players);
    expect(players[0].minions[0]!.position).toBe(LINE_LENGTH - MINION_RANGE);
    expect(players[0].minions[1]!.position).toBe(48);
  });

  it('überschreitet LINE_LENGTH auch bei hohem Tempo nicht', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 0, 30, 6, 500));
    players[1].lines[0]!.towers[0]!.hp = 0;
    for (let tick = 0; tick < 20; tick += 1) combatTick(players, TICK_SECONDS);
    expect(players[0].minions[0]!.position).toBeLessThanOrEqual(LINE_LENGTH);
  });

  it('lässt gegnerische Minions in der Mitte aufeinandertreffen und sich bekämpfen', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 1, 0));
    players[1].minions.push(minion(1, 1, 0));
    for (let tick = 0; tick < 200; tick += 1) combatTick(players);
    const a = players[0].minions[0];
    const b = players[1].minions[0];
    // Gleiche Werte: beide fallen im selben Tick.
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });

  it('hält ein Minion an, sobald ein Gegner in Reichweite ist', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 0, 1000));
    players[1].minions.push(minion(1, 0, 0, 1000));
    for (let tick = 0; tick < 100; tick += 1) combatTick(players);
    const gapNow = LINE_LENGTH - players[0].minions[0]!.position - players[1].minions[0]!.position;
    expect(gapNow).toBeLessThanOrEqual(MINION_RANGE);
    expect(gapNow).toBeGreaterThan(MINION_RANGE - 2 * MINION_SPEED * TICK_SECONDS);
  });

  it('greift Minions nur auf derselben Line an', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 48));
    players[1].minions.push(minion(1, 2, 48));
    combatTick(players);
    expect(players[0].minions[0]!.hp).toBe(MINION_HP);
    expect(players[1].minions[0]!.hp).toBe(MINION_HP);
  });

  it('lässt einen Tower Minions in Reichweite beschießen, aber keine außerhalb', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(
      minion(1, 0, LINE_LENGTH - 2 * TOWER_RANGE),
      minion(2, 1, LINE_LENGTH - TOWER_RANGE),
    );
    combatTick(players, 1);
    expect(players[1].minions.find((m) => m.id === 1)!.hp).toBe(MINION_HP);
    expect(players[1].minions.find((m) => m.id === 2)!.hp).toBe(MINION_HP - TOWER_DAMAGE);
  });

  it('trifft ein Minion genau im Abstand TOWER_RANGE, aber keins im Abstand TOWER_RANGE + 1', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(
      minion(1, 0, LINE_LENGTH - TOWER_RANGE),
      minion(2, 1, LINE_LENGTH - TOWER_RANGE - 1),
    );
    combatTick(players, 1);
    expect(players[1].minions.find((m) => m.id === 1)!.hp).toBe(MINION_HP - TOWER_DAMAGE);
    expect(players[1].minions.find((m) => m.id === 2)!.hp).toBe(MINION_HP);
  });

  it('lässt ein Minion knapp ausserhalb von TOWER_RANGE unbeschädigt (nach altem Wert 25 wäre es getroffen worden)', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(minion(1, 0, LINE_LENGTH - TOWER_RANGE - 2));
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(MINION_HP);
  });

  it('lässt einen fernkämpfenden Minion (Bogenschütze) den Tower erst in TOWER_RANGE treffen, den Tower ihn dann auch', () => {
    expect(ARCHER.range).toBeLessThan(TOWER_RANGE);
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    // Der Abstand der Bogenschützen-Reichweite liegt innerhalb von TOWER_RANGE: der Tower trifft den Fernkämpfer.
    players[1].minions.push(minion(1, 0, LINE_LENGTH - ARCHER.range));
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(MINION_HP - TOWER_DAMAGE);
  });

  it('beschießt das vorderste Minion im Turmradius', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(minion(1, 0, LINE_LENGTH - TOWER_RANGE), minion(2, 0, LINE_LENGTH - TOWER_RANGE / 2));
    combatTick(players, 1);
    expect(players[1].minions.find((m) => m.id === 1)!.hp).toBe(MINION_HP);
    expect(players[1].minions.find((m) => m.id === 2)!.hp).toBe(MINION_HP - TOWER_DAMAGE);
  });

  it('schadet dem gegnerischen Tower am Ende der Line', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, LINE_LENGTH - MINION_RANGE, SOAK_HP, 10));
    combatTick(players, 1);
    expect(players[1].lines[0]!.towers[0]!.hp).toBe(TOWER_HP - 10);
    expect(totalTowerHp(players[1])).toBe(players[1].lines.length * TOWER_HP - 10);
  });

  it('lässt einen Fernkämpfer einen Minion aus 10 Einheiten angreifen, einen Nahkämpfer nicht', () => {
    // Abstand 10: der Bogenschütze reicht, der Nahkämpfer nicht.
    expect(ARCHER.range).toBeGreaterThanOrEqual(10);
    expect(MINION_RANGE).toBeLessThan(10);
    const ranged: [CombatPlayer, CombatPlayer] = [player(), player()];
    ranged[0].minions.push(minion(1, 0, 45, MINION_HP, ARCHER.damage, MINION_SPEED, ARCHER.range));
    ranged[1].minions.push(minion(1, 0, 45, SOAK_HP, 0));
    combatTick(ranged, 1);
    expect(ranged[1].minions[0]!.hp).toBeCloseTo(SOAK_HP - ARCHER.damage, 6);
    expect(ranged[0].minions[0]!.position).toBe(45);

    const melee: [CombatPlayer, CombatPlayer] = [player(), player()];
    melee[0].minions.push(minion(1, 0, 45, MINION_HP, ARCHER.damage));
    melee[1].minions.push(minion(1, 0, 45, SOAK_HP, 0));
    combatTick(melee, 1);
    expect(melee[1].minions[0]!.hp).toBe(SOAK_HP);
    expect(melee[0].minions[0]!.position).toBeCloseTo(45 + MINION_SPEED, 6);
  });

  it('lässt einen Fernkämpfer den Tower aus Bogenschützen-Reichweite angreifen, einen Nahkämpfer erst ab MINION_RANGE', () => {
    const start = LINE_LENGTH - ARCHER.range;
    const ranged: [CombatPlayer, CombatPlayer] = [player(), player()];
    ranged[0].minions.push(minion(1, 0, start, MINION_HP, ARCHER.damage, MINION_SPEED, ARCHER.range));
    combatTick(ranged, 1);
    expect(ranged[1].lines[0]!.towers[0]!.hp).toBe(TOWER_HP - ARCHER.damage);
    expect(ranged[0].minions[0]!.position).toBe(start);

    const melee: [CombatPlayer, CombatPlayer] = [player(), player()];
    melee[0].minions.push(minion(1, 0, start, MINION_HP, ARCHER.damage));
    combatTick(melee, 1);
    expect(melee[1].lines[0]!.towers[0]!.hp).toBe(TOWER_HP);
    expect(melee[0].minions[0]!.position).toBeCloseTo(start + MINION_SPEED, 6);
  });

  it('bewegt einen Minion mit seinem eigenen speed und skaliert mit deltaSeconds', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 10, 30, 6, 5, 14));
    combatTick(players, 0.5);
    expect(players[0].minions[0]!.position).toBeCloseTo(12.5, 6);
    combatTick(players, 2);
    expect(players[0].minions[0]!.position).toBeCloseTo(22.5, 6);
  });

  it('lässt einen Fernkämpfer außerhalb seiner Reichweite weiterlaufen', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, 20, MINION_HP, ARCHER.damage, MINION_SPEED, ARCHER.range));
    players[1].minions.push(minion(1, 0, 50, SOAK_HP, 0));
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(SOAK_HP);
    expect(players[0].minions[0]!.position).toBeCloseTo(20 + MINION_SPEED, 6);
  });

  it('lässt Tower nicht unter 0 fallen und zählt lebende Tower', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(5), player()];
    players[1].minions.push(minion(1, 0, LINE_LENGTH - MINION_RANGE, 1000, 100));
    combatTick(players, 1);
    expect(players[0].lines[0]!.towers[0]!.hp).toBe(0);
    expect(towersAlive(players[0])).toBe(2);
  });

  it('wirkt für beide Seiten gleich (keine Bevorzugung durch die Reihenfolge)', () => {
    const a: [CombatPlayer, CombatPlayer] = [player(), player()];
    const b: [CombatPlayer, CombatPlayer] = [player(), player()];
    a[0].minions.push(minion(1, 0, 40, 30, 6));
    a[1].minions.push(minion(1, 0, 56, 30, 6));
    b[1].minions.push(minion(1, 0, 40, 30, 6));
    b[0].minions.push(minion(1, 0, 56, 30, 6));
    for (let tick = 0; tick < 60; tick += 1) {
      combatTick(a);
      combatTick(b);
    }
    expect(a[0]).toEqual(b[1]);
    expect(a[1]).toEqual(b[0]);
  });
});

describe('Heiler', () => {
  const healer = (id: number, line: number, position: number, damage: number = HEALER.damage) => ({
    ...minion(id, line, position, HEALER.hp, damage, MINION_SPEED, HEALER.range),
    maxHp: HEALER.hp,
    heals: true,
  });
  const wounded = (id: number, line: number, position: number, hp: number, maxHp: number = MINION_HP) => ({
    ...minion(id, line, position, hp),
    maxHp,
  });
  const setup = (...own: ReturnType<typeof wounded>[]): [CombatPlayer, CombatPlayer] => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(...own);
    return players;
  };

  it('heilt einen verwundeten Verbündeten in Reichweite um damage * deltaSeconds', () => {
    const players = setup(healer(1, 0, 10), wounded(2, 0, 15, 10));
    combatTick(players, 0.5);
    expect(players[0].minions[1]!.hp).toBeCloseTo(10 + HEALER.damage * 0.5);
  });

  it('heilt nicht außerhalb der Reichweite, auf anderer Line, Gegner oder sich selbst', () => {
    const outOfRange = 10 + HEALER.range + 1;
    const players = setup(healer(1, 0, 10), wounded(2, 0, outOfRange, 10), wounded(3, 1, 10, 10));
    players[1].minions.push(wounded(4, 0, 10, 10));
    players[1].minions.push({ ...healer(5, 2, 5), hp: 5 });
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.hp)).toEqual([HEALER.hp, 10, 10]);
    expect(players[1].minions.map((m) => m.hp)).toEqual([10, 5]);
  });

  it('behandelt einen Verbündeten ohne maxHp als unverwundet (maxHp fehlt: es gilt hp)', () => {
    const bare = minion(2, 0, 12, 10) as unknown as ReturnType<typeof wounded>;
    const players = setup(healer(1, 0, 10), bare);
    combatTick(players, 1);
    expect(players[0].minions[1]!.hp).toBe(10);
  });

  it('übersteigt maxHp nie', () => {
    const players = setup(healer(1, 0, 10), wounded(2, 0, 12, MINION_HP - 1));
    combatTick(players, 1);
    expect(players[0].minions[1]!.hp).toBe(MINION_HP);
  });

  it('wählt den niedrigsten HP-Anteil, bei Gleichstand den kleineren Index', () => {
    const players = setup(healer(1, 0, 10), wounded(2, 0, 12, 15), wounded(3, 0, 12, 6), wounded(4, 0, 12, 6));
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.hp)).toEqual([HEALER.hp, 15, 6 + HEALER.damage, 6]);
  });

  it('verursacht weder Minion- noch Tower-Schaden und läuft weiter', () => {
    const players = setup(healer(1, 0, LINE_LENGTH - MINION_RANGE));
    players[1].minions.push(minion(9, 0, MINION_RANGE + 2, MINION_HP, 0));
    const towerBefore = players[1].lines[0]!.towers[0]!.hp;
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(MINION_HP);
    expect(players[1].lines[0]!.towers[0]!.hp).toBe(towerBefore);
    expect(players[0].minions[0]!.position).toBe(LINE_LENGTH);
  });

  it('belebt keinen Minion wieder, der im selben Tick stirbt', () => {
    const players = setup(healer(1, 0, 45), wounded(2, 0, 50, 1));
    players[1].minions.push(minion(7, 0, 48, 30, 60));
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([1]);
  });

  it('verrechnet Heilung und Schaden im selben Tick', () => {
    const players = setup(healer(1, 0, 45), wounded(2, 0, 50, 10));
    players[1].minions.push(minion(7, 0, 48));
    combatTick(players, 1);
    expect(players[0].minions[1]!.hp).toBeCloseTo(10 + HEALER.damage - MINION_DAMAGE);
  });

  it('hängt nicht von der Spielerreihenfolge ab', () => {
    const a: [CombatPlayer, CombatPlayer] = [player(), player()];
    const b: [CombatPlayer, CombatPlayer] = [player(), player()];
    a[0].minions.push(healer(1, 0, 40), wounded(2, 0, 44, 12));
    a[1].minions.push(minion(7, 0, 56, 30, 6));
    b[1].minions.push(healer(1, 0, 40), wounded(2, 0, 44, 12));
    b[0].minions.push(minion(7, 0, 56, 30, 6));
    for (let tick = 0; tick < 40; tick += 1) {
      combatTick(a);
      combatTick(b);
    }
    expect(a[0]).toEqual(b[1]);
    expect(a[1]).toEqual(b[0]);
  });
});

describe('Mehrere Tower auf einer Lane', () => {
  /** Verteidiger mit drei Towern bei 0, 8 und 16 auf Lane 0 (wie die Start-Lane), Lane 1 ohne Tower. */
  function defender(): CombatPlayer {
    const tower = (offset: number) => towerOf({ offset });
    return { lines: [{ towers: [tower(0), tower(8), tower(16)] }, { towers: [] }], minions: [] };
  }
  function attacker(): CombatPlayer {
    return { lines: [{ towers: [] }, { towers: [] }], minions: [] };
  }

  it('misst den Abstand zum Tower von seinem Standort aus', () => {
    expect(towerDistance({ offset: 16, hp: 1, maxHp: 1, damage: 0 }, 70)).toBe(14);
    expect(towerDistance({ hp: 1, maxHp: 1, damage: 0 }, 70)).toBe(30);
  });

  it('greift zuerst den vordersten Tower an, den dem Angreifer nächsten', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    // Der Angreifer steht genau in Minion-Reichweite des vordersten Towers (bei 16); die anderen sind weiter weg.
    const start = LINE_LENGTH - 16 - MINION_RANGE;
    players[0].minions.push(minion(1, 0, start));
    combatTick(players, 1);
    const [back, middle, front] = players[1].lines[0]!.towers;
    expect(front!.hp).toBe(TOWER_HP - MINION_DAMAGE);
    expect(middle!.hp).toBe(TOWER_HP);
    expect(back!.hp).toBe(TOWER_HP);
    expect(players[0].minions[0]!.position).toBe(start);
  });

  it('wendet sich dem nächsten Tower zu, sobald der vorderste fällt, und läuft dafür weiter', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    players[1].lines[0]!.towers[2]!.hp = 0;
    const start = LINE_LENGTH - 16 - MINION_RANGE;
    players[0].minions.push(minion(1, 0, start, SOAK_HP));
    combatTick(players, 1);
    // Der Tower bei 8 liegt ausserhalb der Minion-Reichweite: der Minion rückt vor, statt zu schlagen.
    expect(players[1].lines[0]!.towers[1]!.hp).toBe(TOWER_HP);
    expect(players[0].minions[0]!.position).toBeCloseTo(start + MINION_SPEED, 6);
    combatTick(players, 1);
    expect(players[1].lines[0]!.towers[1]!.hp).toBe(TOWER_HP - MINION_DAMAGE);
  });

  it('lässt jeden Tower von seinem Standort aus schießen', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    // Die Towerreichweite zählt vom Standort des Towers (0, 8, 16) aus.
    const outside = LINE_LENGTH - 16 - TOWER_RANGE - 1;
    players[0].minions.push(minion(1, 0, outside, SOAK_HP, 0));
    combatTick(players, 1);
    expect(players[0].minions[0]!.hp).toBe(SOAK_HP);
    // Am Rand der Reichweite erreicht nur der vordere Tower (bei 16), eine Tower-Distanz weiter auch der mittlere (bei 8).
    players[0].minions[0]!.position = LINE_LENGTH - 16 - TOWER_RANGE;
    combatTick(players, 1);
    expect(players[0].minions[0]!.hp).toBe(SOAK_HP - TOWER_DAMAGE);
    players[0].minions[0]!.position = LINE_LENGTH - 8 - TOWER_RANGE;
    combatTick(players, 1);
    expect(players[0].minions[0]!.hp).toBe(SOAK_HP - 3 * TOWER_DAMAGE);
  });

  it('zählt lebende Tower und ihre Lebenspunkte über alle Tower aller Lanes', () => {
    const player = defender();
    expect(towersAlive(player)).toBe(3);
    expect(totalTowerHp(player)).toBe(3 * TOWER_HP);
    player.lines[0]!.towers[1]!.hp = 0;
    expect(towersAlive(player)).toBe(2);
    expect(totalTowerHp(player)).toBe(2 * TOWER_HP);
  });

  it('meldet Tower-Schaden mit dem Rest-HP-Deckel des getroffenen Towers', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    players[1].lines[0]!.towers[2]!.hp = 2;
    players[0].minions.push(minion(1, 0, LINE_LENGTH - 16 - MINION_RANGE));
    const calls: [number, number, string, number][] = [];
    combatTick(players, 1, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    expect(calls).toEqual([[0, 1, 'tower', 2]]);
    expect(players[1].lines[0]!.towers[2]!.hp).toBe(0);
  });

  it('lässt Minions auf einer Lane ohne Tower bis ans Ende laufen, ohne etwas zu treffen', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    players[0].minions.push(minion(1, 1, 90));
    for (let tick = 0; tick < 40; tick += 1) combatTick(players);
    expect(players[0].minions[0]!.position).toBe(LINE_LENGTH);
    expect(totalTowerHp(players[1])).toBe(3 * TOWER_HP);
  });
});

describe('Tower-Spezialisierungen', () => {
  const firstTower = (p: CombatPlayer, line = 0) => p.lines[line]!.towers[0]!;

  describe('Blitz-Turm', () => {
    function setup(specialization?: 'lightning'): [CombatPlayer, CombatPlayer] {
      const players: [CombatPlayer, CombatPlayer] = [player(), player()];
      // Nur Lane 0 des Verteidigers hat einen Tower; so schießt kein anderer Tower auf die Minions.
      players[1].lines[1]!.towers = [];
      players[1].lines[2]!.towers = [];
      if (specialization) firstTower(players[1]).specialization = specialization;
      // Abstand zum Tower: halbe Reichweite, drei Viertel, Rand der Reichweite und 10 darüber (außerhalb); dazu ein
      // Minion auf Lane 1.
      players[0].minions.push(
        minion(1, 0, LINE_LENGTH - TOWER_RANGE / 2, SOAK_HP, 0),
        minion(2, 0, LINE_LENGTH - 0.75 * TOWER_RANGE, SOAK_HP, 0),
        minion(3, 0, LINE_LENGTH - TOWER_RANGE, SOAK_HP, 0),
        minion(4, 0, LINE_LENGTH - TOWER_RANGE - 10, SOAK_HP, 0),
        minion(5, 1, LINE_LENGTH - TOWER_RANGE / 2, SOAK_HP, 0),
      );
      return players;
    }

    it('trifft alle Minions seiner Lane in Reichweite mit LIGHTNING_FACTOR', () => {
      const players = setup('lightning');
      combatTick(players, 1);
      const hp = players[0].minions.map((m) => m.hp);
      expect(hp[0]).toBeCloseTo(SOAK_HP - TOWER_DAMAGE * LIGHTNING_FACTOR, 9);
      expect(hp[1]).toBeCloseTo(SOAK_HP - TOWER_DAMAGE * LIGHTNING_FACTOR, 9);
      expect(hp[2]).toBeCloseTo(SOAK_HP - TOWER_DAMAGE * LIGHTNING_FACTOR, 9);
    });

    it('trifft weder Minions außerhalb der Reichweite noch anderer Lanes', () => {
      const players = setup('lightning');
      combatTick(players, 1);
      expect(players[0].minions[3]!.hp).toBe(SOAK_HP);
      expect(players[0].minions[4]!.hp).toBe(SOAK_HP);
    });

    it('lässt einen normalen Tower nur den vordersten Minion treffen', () => {
      const players = setup();
      combatTick(players, 1);
      expect(players[0].minions.map((m) => m.hp)).toEqual([SOAK_HP - TOWER_DAMAGE, SOAK_HP, SOAK_HP, SOAK_HP, SOAK_HP]);
    });

    it('schießt nicht mehr, wenn er zerstört ist', () => {
      const players = setup('lightning');
      firstTower(players[1]).hp = 0;
      combatTick(players, 1);
      expect(players[0].minions.every((m) => m.hp === SOAK_HP)).toBe(true);
    });
  });

  describe('Schild-Turm', () => {
    function setup(minionHp: number, shield = true): [CombatPlayer, CombatPlayer] {
      const players: [CombatPlayer, CombatPlayer] = [player(), player(TOWER_HP, 0)];
      if (shield) firstTower(players[1]).specialization = 'shield';
      // Der Minion steht innerhalb seiner Reichweite am Tower und schlägt zu.
      players[0].minions.push(minion(1, 0, LINE_LENGTH - MINION_RANGE / 2, minionHp));
      return players;
    }

    it('wirft SHIELD_REFLECT des Schadens auf den Angreifer zurück', () => {
      const players = setup(MINION_HP);
      combatTick(players, 1);
      expect(firstTower(players[1]).hp).toBe(TOWER_HP - MINION_DAMAGE);
      expect(players[0].minions[0]!.hp).toBeCloseTo(MINION_HP - MINION_DAMAGE * SHIELD_REFLECT, 9);
    });

    it('wirft ohne Schild nichts zurück', () => {
      const players = setup(MINION_HP, false);
      combatTick(players, 1);
      expect(players[0].minions[0]!.hp).toBe(MINION_HP);
    });

    it('deckelt den Rückwurf auf die Rest-HP des Angreifers', () => {
      const players = setup(1);
      combatTick(players, 1);
      expect(players[0].minions).toHaveLength(0);
      expect(firstTower(players[1]).hp).toBe(TOWER_HP - MINION_DAMAGE);
    });

    it('wirft pro Tick anteilig zur Tick-Dauer zurück', () => {
      const players = setup(MINION_HP);
      combatTick(players, 0.5);
      expect(players[0].minions[0]!.hp).toBeCloseTo(MINION_HP - MINION_DAMAGE * 0.5 * SHIELD_REFLECT, 9);
    });
  });

  it('ändert das Ergebnis nicht, wenn die Spieler vertauscht werden', () => {
    const build = (): [CombatPlayer, CombatPlayer] => {
      const a = player();
      const b = player();
      firstTower(a, 0).specialization = 'lightning';
      firstTower(b, 0).specialization = 'shield';
      firstTower(a, 1).specialization = 'shield';
      firstTower(b, 1).specialization = 'lightning';
      a.minions.push(minion(1, 0, 95, 40, 6), minion(2, 0, 85, 40, 6), minion(3, 1, 97, 40, 9));
      b.minions.push(minion(1, 0, 96, 40, 7), minion(2, 1, 90, 40, 5), minion(3, 1, 98, 3, 9));
      return [a, b];
    };
    const normal = build();
    const swapped = build().reverse() as [CombatPlayer, CombatPlayer];
    for (let tick = 0; tick < 20; tick += 1) {
      combatTick(normal);
      combatTick(swapped);
    }
    expect(normal[0]).toEqual(swapped[1]);
    expect(normal[1]).toEqual(swapped[0]);
  });
});

describe('Zerstörer', () => {
  const BLAST = DESTROYER.explosion;
  /** Position eines Ziels im Abstand von 2 unter dem Radius, am Radius und knapp darüber (Zerstörer bei 50). */
  const NEAR = 50 - (BLAST.radius - 2);
  const EDGE = 50 - BLAST.radius;
  const OUTSIDE = 50 - BLAST.radius - 1;
  /** Lebenspunkte, die eine Explosion sicher töten, aber keine zwei Treffer überstehen. */
  const FRAGILE_HP = BLAST.damage - 5;
  /** Zerstörer; Tempo 0, damit die Positionen im Test fest bleiben. */
  const destroyer = (id: number, line: number, position: number, hp: number = DESTROYER.hp, damage: number = DESTROYER.damage) => ({
    ...minion(id, line, position, hp, damage, 0),
    explodes: { ...BLAST },
  });
  /** Ruhiger Gegner ohne Schaden und Tempo. */
  const dummy = (id: number, line: number, position: number, hp = SOAK_HP) => minion(id, line, position, hp, 0, 0);
  const setup = (own: ReturnType<typeof minion>[], foes: ReturnType<typeof minion>[], towerDamage = 0) => {
    const players: [CombatPlayer, CombatPlayer] = [player(TOWER_HP, towerDamage), player(TOWER_HP, towerDamage)];
    players[0].minions.push(...own);
    players[1].minions.push(...foes);
    return players;
  };
  const hpOf = (p: CombatPlayer, id: number) => p.minions.find((m) => m.id === id)?.hp;

  describe('explosionVictims', () => {
    const boom = destroyer(1, 0, 50);

    it('trifft lebende Gegner derselben Lane bis genau zum Radius', () => {
      const r = BLAST.radius;
      const foes = [dummy(2, 0, 50), dummy(3, 0, 50 + r - 2), dummy(4, 0, 50 + r), dummy(5, 0, 50 - (r - 1)), dummy(6, 0, EDGE)];
      // Abstand 0, r - 2, r, r - 1 (hinter dem Zerstörer) und r; ein Abstand von r + 1 liegt ausserhalb.
      expect(explosionVictims(boom, foes)).toEqual([0, 1, 2, 3, 4]);
      expect(explosionVictims(boom, [dummy(7, 0, 50 + r + 1), dummy(8, 0, OUTSIDE)])).toEqual([]);
    });

    it('lässt andere Lanes und Gefallene aus und trifft ohne explodes nichts', () => {
      const foes = [dummy(2, 1, 50), { ...dummy(3, 0, 50), hp: 0 }, dummy(4, 0, 50)];
      expect(explosionVictims(boom, foes)).toEqual([2]);
      expect(explosionVictims(minion(9, 0, 50), foes)).toEqual([]);
    });
  });

  it('verändert Minions ohne explodes nicht: ein gestorbener Nahkämpfer richtet keinen Flächenschaden an', () => {
    // Gegner hinter dem Gegenüber (Position < 50) stehen ausser Reichweite, aber im Radius einer Explosion.
    const players = setup(
      [minion(1, 0, 50, 1, DESTROYER.damage, 0)],
      [minion(2, 0, 50, SOAK_HP, MINION_DAMAGE, 0), dummy(3, 0, NEAR)],
    );
    combatTick(players, 1);
    expect(players[0].minions).toHaveLength(0);
    expect(hpOf(players[1], 3)).toBe(SOAK_HP);
    expect(hpOf(players[1], 2)).toBe(SOAK_HP - DESTROYER.damage);
  });

  it('trifft beim Tod jeden gegnerischen Minion im Radius einmalig mit dem Explosionsschaden', () => {
    const players = setup(
      [destroyer(1, 0, 50, 1), dummy(10, 0, 50)],
      // Abstand zur Todesposition (x = 50): r - 2, r, r + 1; Minion 6 steht auf einer anderen Lane.
      [
        minion(2, 0, 50, SOAK_HP, MINION_DAMAGE, 0),
        dummy(3, 0, NEAR),
        dummy(4, 0, EDGE),
        dummy(5, 0, OUTSIDE),
        dummy(6, 1, 50),
      ],
    );
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([10]);
    // Der Angreifer verliert den Zerstörer-Schaden aus dem Kampf und den Explosionsschaden.
    expect(hpOf(players[1], 2)).toBe(SOAK_HP - DESTROYER.damage - BLAST.damage);
    expect(hpOf(players[1], 3)).toBe(SOAK_HP - BLAST.damage);
    expect(hpOf(players[1], 4)).toBe(SOAK_HP - BLAST.damage);
    expect(hpOf(players[1], 5)).toBe(SOAK_HP); // ausserhalb des Radius
    expect(hpOf(players[1], 6)).toBe(SOAK_HP); // andere Lane
    expect(hpOf(players[0], 10)).toBe(SOAK_HP); // eigener Minion
  });

  it('explodiert nicht, solange der Zerstörer den Tick überlebt', () => {
    const players = setup([destroyer(1, 0, 50)], [minion(2, 0, 50, SOAK_HP, MINION_DAMAGE, 0), dummy(3, 0, NEAR)]);
    combatTick(players, 1);
    expect(hpOf(players[0], 1)).toBe(DESTROYER.hp - MINION_DAMAGE);
    expect(hpOf(players[1], 3)).toBe(SOAK_HP);
    expect(hpOf(players[1], 2)).toBe(SOAK_HP - DESTROYER.damage);
  });

  it('explodiert nur einmal, auch wenn der tote Zerstörer in späteren Ticks nicht mehr existiert', () => {
    const players = setup([destroyer(1, 0, 50, 1)], [minion(2, 0, 50, SOAK_HP, MINION_DAMAGE, 0), dummy(3, 0, NEAR)]);
    combatTick(players, 1);
    combatTick(players, 1);
    expect(hpOf(players[1], 3)).toBe(SOAK_HP - BLAST.damage);
  });

  it('der Schaden hängt nicht von delta ab', () => {
    const killer = () => minion(3, 0, 50, SOAK_HP, 100 * DESTROYER.hp, 0);
    const small = setup([destroyer(1, 0, 50, 1)], [dummy(2, 0, NEAR), killer()]);
    const large = setup([destroyer(1, 0, 50, 1)], [dummy(2, 0, NEAR), killer()]);
    combatTick(small, 0.05);
    combatTick(large, 1);
    expect(hpOf(small[1], 2)).toBe(SOAK_HP - BLAST.damage);
    expect(hpOf(large[1], 2)).toBe(SOAK_HP - BLAST.damage);
  });

  it('explodiert auch, wenn ein Tower ihn tötet', () => {
    // Der Zerstörer von Spieler 0 steht innerhalb der Tower-Reichweite vor dem gegnerischen Tower; der Gegner steht
    // 5 neben der Todesposition des Zerstörers.
    const position = LINE_LENGTH - TOWER_RANGE + 5;
    const players = setup([destroyer(1, 0, position)], [dummy(2, 0, LINE_LENGTH - position - 5)], 2 * DESTROYER.hp);
    combatTick(players, 1);
    expect(players[0].minions).toHaveLength(0);
    expect(hpOf(players[1], 2)).toBe(SOAK_HP - BLAST.damage);
  });

  it('trifft von beiden Seiten gleichzeitig: sich gegenseitig tötende Zerstörer treffen nur Unbeteiligte', () => {
    const players = setup(
      [destroyer(1, 0, 50, 1), dummy(10, 0, 45)],
      [destroyer(2, 0, 50, 1), dummy(11, 0, 45)],
    );
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([10]);
    expect(players[1].minions.map((m) => m.id)).toEqual([11]);
    expect(hpOf(players[0], 10)).toBe(SOAK_HP - BLAST.damage);
    expect(hpOf(players[1], 11)).toBe(SOAK_HP - BLAST.damage);
  });

  it('löst eine Kettenreaktion im selben Tick aus und endet', () => {
    // Zerstörer 1 fällt im Kampf mit Gegner 2 (Zerstörer). Seine Explosion tötet 2 und 4; deren Explosionen
    // töten 3 und 5; Gegner 21 steht im Radius aller drei Zerstörer, die danach explodieren, und überlebt mit
    // drei Explosionstreffern weniger.
    const players = setup(
      [
        destroyer(1, 0, 50, 1, 0),
        destroyer(3, 0, 45, FRAGILE_HP, 0),
        destroyer(5, 0, 40, FRAGILE_HP, 0),
        dummy(20, 0, 20),
      ],
      [destroyer(2, 0, 50, FRAGILE_HP), destroyer(4, 0, 58, FRAGILE_HP, 0), dummy(21, 0, 60)],
    );
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([20]);
    expect(players[1].minions.map((m) => m.id)).toEqual([21]);
    expect(hpOf(players[1], 21)).toBe(SOAK_HP - 3 * BLAST.damage);
  });

  it('beendet auch eine grosse Kette nach endlich vielen Wellen, jeder Zerstörer explodiert genau einmal', () => {
    // Der Angreifer 100 tötet nur Zerstörer 1; dessen Explosion tötet alle Gegner-Zerstörer, deren Explosionen die
    // übrigen eigenen, deren Explosionen treffen den Angreifer. Zehn Zerstörer ergeben also zehn Treffer.
    const own = Array.from({ length: 10 }, (_, i) => destroyer(i + 1, 0, 50 - (i % 3), i === 0 ? 1 : FRAGILE_HP, 0));
    own[0]!.position = 50;
    const foes = [
      minion(100, 0, 50, SOAK_HP, 100 * DESTROYER.hp, 0),
      ...Array.from({ length: 10 }, (_, i) => destroyer(i + 101, 0, 45, FRAGILE_HP, 0)),
    ];
    const players = setup(own, foes);
    combatTick(players, 1);
    expect(players[0].minions).toHaveLength(0);
    expect(players[1].minions.map((m) => m.id)).toEqual([100]);
    expect(hpOf(players[1], 100)).toBe(SOAK_HP - 10 * BLAST.damage);
  });

  it('meldet den Explosionsschaden dem Zerstörer, gedeckelt auf die Rest-HP des Opfers', () => {
    const restHp = BLAST.damage / 3;
    const players = setup(
      [destroyer(1, 0, 50, 1)],
      [minion(2, 0, 50, SOAK_HP, MINION_DAMAGE, 0), dummy(3, 0, NEAR), dummy(4, 0, EDGE, restHp)],
    );
    const calls: [number, number, string, number][] = [];
    combatTick(players, 1, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    const blast = calls.filter((c) => c[0] === 0 && c[1] === 1);
    // Kampfschaden an Minion 2, Explosion an Minion 2 und 3 und nur die Rest-HP an Minion 4.
    expect(blast.map((c) => c[3]).sort((a, b) => a - b)).toEqual(
      [restHp, DESTROYER.damage, BLAST.damage, BLAST.damage].sort((a, b) => a - b),
    );
    expect(calls.every((c) => c[2] === 'minion')).toBe(true);
  });

  it('teilt den Schaden mehrerer Explosionen auf ein Opfer mit knappen HP anteilig auf', () => {
    // Zwei Zerstörer ohne HP explodieren gleichzeitig auf ein Opfer, das weniger als beide Explosionen zusammen aushält:
    // Die Summe der Meldungen ist die Rest-HP, je Meldung die Hälfte.
    const victimHp = BLAST.damage;
    const players = setup([destroyer(1, 0, 50, 0, 0), destroyer(3, 0, 50, 0, 0)], [dummy(4, 0, 45, victimHp)]);
    const calls: [number, number, string, number][] = [];
    combatTick(players, 1, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call[3]).toBeCloseTo(victimHp / 2, 9);
    expect(players[1].minions).toHaveLength(0);
  });

  it('liefert mit und ohne Sammler dasselbe Ergebnis', () => {
    const build = () =>
      setup([destroyer(1, 0, 50, 1), dummy(10, 0, 45)], [destroyer(2, 0, 50, FRAGILE_HP / 2), dummy(11, 0, 45)]);
    const plain = build();
    const counted = build();
    combatTick(plain, 1);
    combatTick(counted, 1, () => {});
    expect(counted).toEqual(plain);
  });
});

describe('Kampf mit gestärkten Minions', () => {
  /** Zwei Minions auf Lane 0 gegen einen Gegner; `buffs` Mal gestärkt wird der erste. */
  function fight(buffs: number, ticks: number): [CombatPlayer, CombatPlayer] {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    const own = { ...minion(1, 0, 50), maxHp: MINION_HP };
    for (let count = 0; count < buffs; count += 1) applyMinionBuff(own);
    players[0].minions = [own, { ...minion(2, 1, 50), maxHp: MINION_HP }];
    players[1].minions = [{ ...minion(10, 0, 50, 2 * MINION_HP), maxHp: 2 * MINION_HP }];
    for (let tick = 0; tick < ticks; tick += 1) combatTick(players, 1);
    return players;
  }

  it('liefert mit mehreren Buffs und gleichem Ausgangszustand zwei identische Endzustände', () => {
    expect(fight(3, 200)).toEqual(fight(3, 200));
    expect(fight(2, 80)).toEqual(fight(2, 80));
  });

  it('gibt dem gestärkten Minion mehr Leben und Schaden als dem ungestärkten', () => {
    const [plain, once, twice] = [0, 1, 2].map((buffs) => {
      const own = { ...minion(1, 0, 50), maxHp: MINION_HP };
      for (let count = 0; count < buffs; count += 1) applyMinionBuff(own);
      return own;
    });
    expect(once!.damage).toBeGreaterThan(plain!.damage);
    expect(twice!.damage).toBeGreaterThan(once!.damage);
    expect(twice!.maxHp).toBeGreaterThan(once!.maxHp!);
    // Nach einem Tick gegen denselben Gegner: der gestärkte Minion hat mehr LP und der Gegner weniger.
    const hp = (buffs: number, id: number, side: 0 | 1) => fight(buffs, 1)[side].minions.find((m) => m.id === id)!.hp;
    expect(hp(2, 1, 0)).toBeGreaterThan(hp(0, 1, 0));
    expect(hp(2, 10, 1)).toBeLessThan(hp(0, 10, 1));
  });
});

describe('Turm-Spawn', () => {
  const spawned = (p: CombatPlayer) => p.minions.filter((m) => m.source === 'tower');
  /** Spieler mit einem Tower auf Lane 0 (Standort 8) und einem zerstörten Tower auf Lane 1. */
  const spawner = (): CombatPlayer => ({
    lines: [
      { towers: [towerOf({ offset: 8 })] },
      { towers: [towerOf({ hp: 0 })] },
    ],
    minions: [],
  });

  it('erzeugt nach TOWER_SPAWN_MS genau einen und nach drei Intervallen genau drei Minions je lebendem Tower', () => {
    const one = spawner();
    spawnTowerMinions(one, TOWER_SPAWN_MS - 1);
    expect(spawned(one)).toHaveLength(0);
    spawnTowerMinions(one, 1);
    expect(spawned(one)).toHaveLength(1);
    const three = spawner();
    spawnTowerMinions(three, 3 * TOWER_SPAWN_MS);
    expect(spawned(three)).toHaveLength(3);
  });

  it('setzt die Werte aus der Balance-Konfiguration und stellt den Minion an den Standort des Towers', () => {
    const p = spawner();
    spawnTowerMinions(p, TOWER_SPAWN_MS);
    expect(spawned(p)[0]).toEqual({
      id: 1,
      line: 0,
      position: 8,
      hp: TOWER_SPAWN_HP,
      maxHp: TOWER_SPAWN_HP,
      damage: TOWER_SPAWN_DAMAGE,
      range: TOWER_SPAWN_RANGE,
      speed: TOWER_SPAWN_SPEED,
      source: 'tower',
    });
    expect(isTowerMinion(spawned(p)[0]!)).toBe(true);
    expect(isTowerMinion(minion(1, 0, 0))).toBe(false);
  });

  it('lässt zerstörte Tower nichts spawnen', () => {
    const p = spawner();
    spawnTowerMinions(p, 5 * TOWER_SPAWN_MS);
    expect(spawned(p).every((m) => m.line === 0)).toBe(true);
    p.lines[0]!.towers[0]!.hp = 0;
    const before = p.minions.length;
    spawnTowerMinions(p, 5 * TOWER_SPAWN_MS);
    expect(p.minions).toHaveLength(before);
  });

  it('hängt nur von der Zeit ab, nicht von der Schrittweite', () => {
    const counts = [1, 7, 50, 333, 1000].map((step) => {
      const p = spawner();
      for (let elapsed = 0; elapsed < 5 * TOWER_SPAWN_MS; elapsed += step) spawnTowerMinions(p, step);
      return spawned(p).length;
    });
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(5);
  });

  it('vergibt fortlaufende Ids nach den vorhandenen Minions und merkt sich die nächste Id', () => {
    const p = spawner();
    p.minions.push(minion(41, 0, 0));
    spawnTowerMinions(p, 2 * TOWER_SPAWN_MS);
    expect(spawned(p).map((m) => m.id)).toEqual([42, 43]);
    expect(p.nextMinionId).toBe(44);
    spawnTowerMinions(p, TOWER_SPAWN_MS);
    expect(spawned(p).map((m) => m.id)).toEqual([42, 43, 44]);
  });
});
