import { describe, expect, it } from 'vitest';
import {
  combatTick,
  type CombatPlayer,
  LINE_LENGTH,
  MINION_RANGE,
  MINION_SPEED,
  TICK_SECONDS,
  TOWER_RANGE,
  totalTowerHp,
  towersAlive,
} from './combat';

function player(towerHp = 100, towerDamage = 8): CombatPlayer {
  return {
    lines: [0, 1, 2].map(() => ({ tower: { hp: towerHp, maxHp: towerHp, damage: towerDamage } })),
    minions: [],
  };
}

function minion(id: number, line: number, position: number, hp = 30, damage = 6, speed = MINION_SPEED, range = MINION_RANGE) {
  return { id, line, position, hp, damage, range, speed };
}

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
    players[1].lines[0]!.tower.hp = 0;
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
    players[0].minions.push(minion(1, 0, 48, 30));
    players[1].minions.push(minion(1, 2, 48, 30));
    combatTick(players);
    expect(players[0].minions[0]!.hp).toBe(30);
    expect(players[1].minions[0]!.hp).toBe(30);
  });

  it('lässt einen Tower Minions in Reichweite beschießen, aber keine außerhalb', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(minion(1, 0, 60, 30), minion(2, 1, 80, 30));
    combatTick(players, 1);
    expect(players[1].minions.find((m) => m.id === 1)!.hp).toBe(30);
    expect(players[1].minions.find((m) => m.id === 2)!.hp).toBe(22);
  });

  it('trifft ein Minion genau im Abstand TOWER_RANGE, aber keins im Abstand TOWER_RANGE + 1', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(
      minion(1, 0, LINE_LENGTH - TOWER_RANGE, 30),
      minion(2, 1, LINE_LENGTH - TOWER_RANGE - 1, 30),
    );
    combatTick(players, 1);
    expect(players[1].minions.find((m) => m.id === 1)!.hp).toBe(22);
    expect(players[1].minions.find((m) => m.id === 2)!.hp).toBe(30);
  });

  it('lässt ein Minion im Abstand 22 unbeschädigt (nach altem Wert 25 wäre es getroffen worden)', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(minion(1, 0, LINE_LENGTH - 22, 30));
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(30);
  });

  it('lässt einen fernkämpfenden Minion (Reichweite 14) den Tower erst in TOWER_RANGE treffen, den Tower ihn dann auch', () => {
    const rangedRange = 14;
    expect(rangedRange).toBeLessThan(TOWER_RANGE);
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    // Abstand 14 liegt innerhalb von TOWER_RANGE: der Tower trifft den Fernkämpfer.
    players[1].minions.push(minion(1, 0, LINE_LENGTH - rangedRange, 30));
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(22);
  });

  it('beschießt das vorderste Minion im Turmradius', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[1].minions.push(minion(1, 0, 80, 30), minion(2, 0, 90, 30));
    combatTick(players, 1);
    expect(players[1].minions.find((m) => m.id === 1)!.hp).toBe(30);
    expect(players[1].minions.find((m) => m.id === 2)!.hp).toBe(22);
  });

  it('schadet dem gegnerischen Tower am Ende der Line', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(), player()];
    players[0].minions.push(minion(1, 0, LINE_LENGTH - MINION_RANGE, 1000, 10));
    combatTick(players, 1);
    expect(players[1].lines[0]!.tower.hp).toBe(90);
    expect(totalTowerHp(players[1])).toBe(290);
  });

  it('lässt einen Fernkämpfer einen Minion aus 10 Einheiten angreifen, einen Nahkämpfer nicht', () => {
    const ranged: [CombatPlayer, CombatPlayer] = [player(), player()];
    ranged[0].minions.push(minion(1, 0, 45, 30, 7, MINION_SPEED, 14));
    ranged[1].minions.push(minion(1, 0, 45, 1000, 0));
    combatTick(ranged, 1);
    expect(ranged[1].minions[0]!.hp).toBeCloseTo(993, 6);
    expect(ranged[0].minions[0]!.position).toBe(45);

    const melee: [CombatPlayer, CombatPlayer] = [player(), player()];
    melee[0].minions.push(minion(1, 0, 45, 30, 7));
    melee[1].minions.push(minion(1, 0, 45, 1000, 0));
    combatTick(melee, 1);
    expect(melee[1].minions[0]!.hp).toBe(1000);
    expect(melee[0].minions[0]!.position).toBeCloseTo(55, 6);
  });

  it('lässt einen Fernkämpfer den Tower aus 14 Einheiten angreifen, einen Nahkämpfer erst ab 4', () => {
    const ranged: [CombatPlayer, CombatPlayer] = [player(), player()];
    ranged[0].minions.push(minion(1, 0, LINE_LENGTH - 14, 30, 7, MINION_SPEED, 14));
    combatTick(ranged, 1);
    expect(ranged[1].lines[0]!.tower.hp).toBe(93);
    expect(ranged[0].minions[0]!.position).toBe(LINE_LENGTH - 14);

    const melee: [CombatPlayer, CombatPlayer] = [player(), player()];
    melee[0].minions.push(minion(1, 0, LINE_LENGTH - 14, 30, 7));
    combatTick(melee, 1);
    expect(melee[1].lines[0]!.tower.hp).toBe(100);
    expect(melee[0].minions[0]!.position).toBeCloseTo(LINE_LENGTH - 4, 6);
  });

  it('lässt Tower nicht unter 0 fallen und zählt lebende Tower', () => {
    const players: [CombatPlayer, CombatPlayer] = [player(5), player()];
    players[1].minions.push(minion(1, 0, LINE_LENGTH - MINION_RANGE, 1000, 100));
    combatTick(players, 1);
    expect(players[0].lines[0]!.tower.hp).toBe(0);
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
