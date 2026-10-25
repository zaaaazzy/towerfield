import { describe, expect, it } from 'vitest';
import { applyMinionBuff } from './buff';
import {
  combatTick,
  type CombatPlayer,
  explosionVictims,
  LINE_LENGTH,
  MINION_RANGE,
  MINION_SPEED,
  TICK_SECONDS,
  TOWER_RANGE,
  totalTowerHp,
  towerDistance,
  towersAlive,
} from './combat';

function player(towerHp = 100, towerDamage = 8): CombatPlayer {
  return {
    lines: [0, 1, 2].map(() => ({ towers: [{ hp: towerHp, maxHp: towerHp, damage: towerDamage }] })),
    minions: [],
  };
}

function minion(id: number, line: number, position: number, hp = 30, damage = 6, speed = MINION_SPEED, range = MINION_RANGE) {
  return { id, line, position, hp, damage, range, speed };
}

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
    const players: [CombatPlayer, CombatPlayer] = [player(100, 30), player()];
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
    expect(players[1].lines[0]!.towers[0]!.hp).toBe(90);
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
    expect(ranged[1].lines[0]!.towers[0]!.hp).toBe(93);
    expect(ranged[0].minions[0]!.position).toBe(LINE_LENGTH - 14);

    const melee: [CombatPlayer, CombatPlayer] = [player(), player()];
    melee[0].minions.push(minion(1, 0, LINE_LENGTH - 14, 30, 7));
    combatTick(melee, 1);
    expect(melee[1].lines[0]!.towers[0]!.hp).toBe(100);
    expect(melee[0].minions[0]!.position).toBeCloseTo(LINE_LENGTH - 4, 6);
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
    players[0].minions.push(minion(1, 0, 20, 30, 7, MINION_SPEED, 14));
    players[1].minions.push(minion(1, 0, 50, 1000, 0));
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(1000);
    expect(players[0].minions[0]!.position).toBeCloseTo(30, 6);
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
  const healer = (id: number, line: number, position: number, damage = 5) => ({
    ...minion(id, line, position, 20, damage, MINION_SPEED, 10),
    maxHp: 20,
    heals: true,
  });
  const wounded = (id: number, line: number, position: number, hp: number, maxHp = 30) => ({
    ...minion(id, line, position, hp, 6),
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
    expect(players[0].minions[1]!.hp).toBeCloseTo(12.5);
  });

  it('heilt nicht außerhalb der Reichweite, auf anderer Line, Gegner oder sich selbst', () => {
    const players = setup(healer(1, 0, 10), wounded(2, 0, 21, 10), wounded(3, 1, 10, 10));
    players[1].minions.push(wounded(4, 0, 10, 10));
    players[1].minions.push({ ...healer(5, 2, 5), hp: 5 });
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.hp)).toEqual([20, 10, 10]);
    expect(players[1].minions.map((m) => m.hp)).toEqual([10, 5]);
  });

  it('behandelt einen Verbündeten ohne maxHp als unverwundet (maxHp fehlt: es gilt hp)', () => {
    const bare = minion(2, 0, 12, 10) as unknown as ReturnType<typeof wounded>;
    const players = setup(healer(1, 0, 10), bare);
    combatTick(players, 1);
    expect(players[0].minions[1]!.hp).toBe(10);
  });

  it('übersteigt maxHp nie', () => {
    const players = setup(healer(1, 0, 10), wounded(2, 0, 12, 29));
    combatTick(players, 1);
    expect(players[0].minions[1]!.hp).toBe(30);
  });

  it('wählt den niedrigsten HP-Anteil, bei Gleichstand den kleineren Index', () => {
    const players = setup(healer(1, 0, 10), wounded(2, 0, 12, 15), wounded(3, 0, 12, 6), wounded(4, 0, 12, 6));
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.hp)).toEqual([20, 15, 11, 6]);
  });

  it('verursacht weder Minion- noch Tower-Schaden und läuft weiter', () => {
    const players = setup(healer(1, 0, LINE_LENGTH - 4));
    players[1].minions.push(minion(9, 0, 4 + 2, 30, 0));
    const towerBefore = players[1].lines[0]!.towers[0]!.hp;
    combatTick(players, 1);
    expect(players[1].minions[0]!.hp).toBe(30);
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
    players[1].minions.push(minion(7, 0, 48, 30, 6));
    combatTick(players, 1);
    expect(players[0].minions[1]!.hp).toBeCloseTo(9);
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
    const tower = (offset: number) => ({ offset, hp: 100, maxHp: 100, damage: 8 });
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
    // Position 80 des Angreifers: Abstand zu den Towern bei 16, 8 und 0 ist 4, 12 und 20.
    players[0].minions.push(minion(1, 0, 80, 30, 6));
    combatTick(players, 1);
    const [back, middle, front] = players[1].lines[0]!.towers;
    expect(front!.hp).toBe(94);
    expect(middle!.hp).toBe(100);
    expect(back!.hp).toBe(100);
    expect(players[0].minions[0]!.position).toBe(80);
  });

  it('wendet sich dem nächsten Tower zu, sobald der vorderste fällt, und läuft dafür weiter', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    players[1].lines[0]!.towers[2]!.hp = 0;
    players[0].minions.push(minion(1, 0, 80, 1000, 6));
    combatTick(players, 1);
    // Der Tower bei 8 ist 12 entfernt (außerhalb der Reichweite 4): der Minion rückt vor, statt zu schlagen.
    expect(players[1].lines[0]!.towers[1]!.hp).toBe(100);
    expect(players[0].minions[0]!.position).toBeCloseTo(90, 6);
    combatTick(players, 1);
    expect(players[1].lines[0]!.towers[1]!.hp).toBe(94);
  });

  it('lässt jeden Tower von seinem Standort aus schießen', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    // Minion bei Position 60: Abstand 40 zum Tower bei 0, 32 zum Tower bei 8, 24 zum Tower bei 16 (Reichweite 20).
    players[0].minions.push(minion(1, 0, 60, 1000, 0));
    combatTick(players, 1);
    expect(players[0].minions[0]!.hp).toBe(1000);
    // Bei Position 64 erreicht nur der vordere Tower (Abstand 20), bei 72 auch der mittlere (Abstand 20).
    players[0].minions[0]!.position = 64;
    combatTick(players, 1);
    expect(players[0].minions[0]!.hp).toBe(992);
    players[0].minions[0]!.position = 72;
    combatTick(players, 1);
    expect(players[0].minions[0]!.hp).toBe(976);
  });

  it('zählt lebende Tower und ihre Lebenspunkte über alle Tower aller Lanes', () => {
    const player = defender();
    expect(towersAlive(player)).toBe(3);
    expect(totalTowerHp(player)).toBe(300);
    player.lines[0]!.towers[1]!.hp = 0;
    expect(towersAlive(player)).toBe(2);
    expect(totalTowerHp(player)).toBe(200);
  });

  it('meldet Tower-Schaden mit dem Rest-HP-Deckel des getroffenen Towers', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    players[1].lines[0]!.towers[2]!.hp = 2;
    players[0].minions.push(minion(1, 0, 80, 30, 6));
    const calls: [number, number, string, number][] = [];
    combatTick(players, 1, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    expect(calls).toEqual([[0, 1, 'tower', 2]]);
    expect(players[1].lines[0]!.towers[2]!.hp).toBe(0);
  });

  it('lässt Minions auf einer Lane ohne Tower bis ans Ende laufen, ohne etwas zu treffen', () => {
    const players: [CombatPlayer, CombatPlayer] = [attacker(), defender()];
    players[0].minions.push(minion(1, 1, 90, 30, 6));
    for (let tick = 0; tick < 40; tick += 1) combatTick(players);
    expect(players[0].minions[0]!.position).toBe(LINE_LENGTH);
    expect(totalTowerHp(players[1])).toBe(300);
  });
});

describe('Zerstörer', () => {
  const BLAST = { radius: 10, damage: 15 };
  /** Zerstörer; Tempo 0, damit die Positionen im Test fest bleiben. */
  const destroyer = (id: number, line: number, position: number, hp = 40, damage = 8) => ({
    ...minion(id, line, position, hp, damage, 0),
    explodes: { ...BLAST },
  });
  /** Ruhiger Gegner ohne Schaden und Tempo. */
  const dummy = (id: number, line: number, position: number, hp = 100) => minion(id, line, position, hp, 0, 0);
  const setup = (own: ReturnType<typeof minion>[], foes: ReturnType<typeof minion>[], towerDamage = 0) => {
    const players: [CombatPlayer, CombatPlayer] = [player(100, towerDamage), player(100, towerDamage)];
    players[0].minions.push(...own);
    players[1].minions.push(...foes);
    return players;
  };
  const hpOf = (p: CombatPlayer, id: number) => p.minions.find((m) => m.id === id)?.hp;

  describe('explosionVictims', () => {
    const boom = destroyer(1, 0, 50);

    it('trifft lebende Gegner derselben Lane bis genau zum Radius', () => {
      const foes = [dummy(2, 0, 50), dummy(3, 0, 58), dummy(4, 0, 60), dummy(5, 0, 41), dummy(6, 0, 40)];
      // Abstand 0, 8, 10, 9 (hinter dem Zerstörer) und 10; Position 61 wäre bei 11.
      expect(explosionVictims(boom, foes)).toEqual([0, 1, 2, 3, 4]);
      expect(explosionVictims(boom, [dummy(7, 0, 61), dummy(8, 0, 39)])).toEqual([]);
    });

    it('lässt andere Lanes und Gefallene aus und trifft ohne explodes nichts', () => {
      const foes = [dummy(2, 1, 50), { ...dummy(3, 0, 50), hp: 0 }, dummy(4, 0, 50)];
      expect(explosionVictims(boom, foes)).toEqual([2]);
      expect(explosionVictims(minion(9, 0, 50), foes)).toEqual([]);
    });
  });

  it('verändert Minions ohne explodes nicht: ein gestorbener Nahkämpfer richtet keinen Flächenschaden an', () => {
    // Gegner hinter dem Gegenüber (Position < 50) stehen ausser Reichweite, aber im Radius einer Explosion.
    const players = setup([minion(1, 0, 50, 1, 8, 0)], [minion(2, 0, 50, 100, 6, 0), dummy(3, 0, 42)]);
    combatTick(players, 1);
    expect(players[0].minions).toHaveLength(0);
    expect(hpOf(players[1], 3)).toBe(100);
    expect(hpOf(players[1], 2)).toBe(92);
  });

  it('trifft beim Tod jeden gegnerischen Minion im Radius einmalig mit dem Explosionsschaden', () => {
    const players = setup(
      [destroyer(1, 0, 50, 1), dummy(10, 0, 50)],
      // Abstand zur Todesposition (x = 50): 8, 10, 11; Minion 6 steht auf einer anderen Lane.
      [minion(2, 0, 50, 100, 6, 0), dummy(3, 0, 42), dummy(4, 0, 40), dummy(5, 0, 39), dummy(6, 1, 50)],
    );
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([10]);
    // Der Angreifer verliert 8 aus dem Kampf und 15 durch die Explosion.
    expect(hpOf(players[1], 2)).toBe(100 - 8 - 15);
    expect(hpOf(players[1], 3)).toBe(85);
    expect(hpOf(players[1], 4)).toBe(85);
    expect(hpOf(players[1], 5)).toBe(100); // ausserhalb des Radius
    expect(hpOf(players[1], 6)).toBe(100); // andere Lane
    expect(hpOf(players[0], 10)).toBe(100); // eigener Minion
  });

  it('explodiert nicht, solange der Zerstörer den Tick überlebt', () => {
    const players = setup([destroyer(1, 0, 50, 40)], [minion(2, 0, 50, 100, 6, 0), dummy(3, 0, 42)]);
    combatTick(players, 1);
    expect(hpOf(players[0], 1)).toBe(34);
    expect(hpOf(players[1], 3)).toBe(100);
    expect(hpOf(players[1], 2)).toBe(92);
  });

  it('explodiert nur einmal, auch wenn der tote Zerstörer in späteren Ticks nicht mehr existiert', () => {
    const players = setup([destroyer(1, 0, 50, 1)], [minion(2, 0, 50, 100, 6, 0), dummy(3, 0, 42)]);
    combatTick(players, 1);
    combatTick(players, 1);
    expect(hpOf(players[1], 3)).toBe(85);
  });

  it('der Schaden hängt nicht von delta ab', () => {
    const small = setup([destroyer(1, 0, 50, 1)], [dummy(2, 0, 42), minion(3, 0, 50, 100, 600, 0)]);
    const large = setup([destroyer(1, 0, 50, 1)], [dummy(2, 0, 42), minion(3, 0, 50, 100, 600, 0)]);
    combatTick(small, 0.05);
    combatTick(large, 1);
    expect(hpOf(small[1], 2)).toBe(85);
    expect(hpOf(large[1], 2)).toBe(85);
  });

  it('explodiert auch, wenn ein Tower ihn tötet', () => {
    // Der Zerstörer von Spieler 0 steht bei 85, 15 vor dem gegnerischen Tower (Reichweite 20); der Gegner bei 10 ist 5 entfernt.
    const players = setup([destroyer(1, 0, 85, 40)], [dummy(2, 0, 10)], 100);
    combatTick(players, 1);
    expect(players[0].minions).toHaveLength(0);
    expect(hpOf(players[1], 2)).toBe(85);
  });

  it('trifft von beiden Seiten gleichzeitig: sich gegenseitig tötende Zerstörer treffen nur Unbeteiligte', () => {
    const players = setup(
      [destroyer(1, 0, 50, 1), dummy(10, 0, 45)],
      [destroyer(2, 0, 50, 1), dummy(11, 0, 45)],
    );
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([10]);
    expect(players[1].minions.map((m) => m.id)).toEqual([11]);
    expect(hpOf(players[0], 10)).toBe(85);
    expect(hpOf(players[1], 11)).toBe(85);
  });

  it('löst eine Kettenreaktion im selben Tick aus und endet', () => {
    // Zerstörer 1 fällt im Kampf mit Gegner 2 (Zerstörer, Rest-HP 2). Seine Explosion tötet 2 und 4; deren Explosionen
    // töten 3 und 5; Gegner 21 steht im Radius aller drei Zerstörer, die danach explodieren, und überlebt mit 55 HP.
    const players = setup(
      [destroyer(1, 0, 50, 1, 0), destroyer(3, 0, 45, 10, 0), destroyer(5, 0, 40, 10, 0), dummy(20, 0, 20)],
      [destroyer(2, 0, 50, 10), destroyer(4, 0, 58, 10, 0), dummy(21, 0, 60)],
    );
    combatTick(players, 1);
    expect(players[0].minions.map((m) => m.id)).toEqual([20]);
    expect(players[1].minions.map((m) => m.id)).toEqual([21]);
    expect(hpOf(players[1], 21)).toBe(55);
  });

  it('beendet auch eine grosse Kette nach endlich vielen Wellen, jeder Zerstörer explodiert genau einmal', () => {
    // Der Angreifer 100 tötet nur Zerstörer 1; dessen Explosion tötet alle Gegner-Zerstörer, deren Explosionen die
    // übrigen eigenen, deren Explosionen treffen den Angreifer. Zehn Zerstörer ergeben also zehn Treffer à 15.
    const own = Array.from({ length: 10 }, (_, i) => destroyer(i + 1, 0, 50 - (i % 3), i === 0 ? 1 : 10, 0));
    own[0]!.position = 50;
    const foes = [
      minion(100, 0, 50, 1000, 100, 0),
      ...Array.from({ length: 10 }, (_, i) => destroyer(i + 101, 0, 45, 10, 0)),
    ];
    const players = setup(own, foes);
    combatTick(players, 1);
    expect(players[0].minions).toHaveLength(0);
    expect(players[1].minions.map((m) => m.id)).toEqual([100]);
    expect(hpOf(players[1], 100)).toBe(1000 - 10 * 15);
  });

  it('meldet den Explosionsschaden dem Zerstörer, gedeckelt auf die Rest-HP des Opfers', () => {
    const players = setup([destroyer(1, 0, 50, 1)], [minion(2, 0, 50, 100, 6, 0), dummy(3, 0, 42, 100), dummy(4, 0, 40, 4)]);
    const calls: [number, number, string, number][] = [];
    combatTick(players, 1, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    const blast = calls.filter((c) => c[0] === 0 && c[1] === 1);
    // Kampfschaden 8 an Minion 2, Explosion 15 an Minion 2, 15 an Minion 3 und nur 4 (Rest-HP) an Minion 4.
    expect(blast.map((c) => c[3]).sort((a, b) => a - b)).toEqual([4, 8, 15, 15]);
    expect(calls.every((c) => c[2] === 'minion')).toBe(true);
  });

  it('teilt den Schaden mehrerer Explosionen auf ein Opfer mit knappen HP anteilig auf', () => {
    // Zwei Zerstörer ohne HP explodieren gleichzeitig auf ein Opfer mit 10 HP: 30 Schaden, je Meldung nur 5.
    const players = setup([destroyer(1, 0, 50, 0, 0), destroyer(3, 0, 50, 0, 0)], [dummy(4, 0, 45, 10)]);
    const calls: [number, number, string, number][] = [];
    combatTick(players, 1, (side, id, kind, amount) => void calls.push([side, id, kind, amount]));
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call[3]).toBeCloseTo(5, 9);
    expect(players[1].minions).toHaveLength(0);
  });

  it('liefert mit und ohne Sammler dasselbe Ergebnis', () => {
    const build = () =>
      setup([destroyer(1, 0, 50, 1), dummy(10, 0, 45)], [destroyer(2, 0, 50, 5), dummy(11, 0, 45)]);
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
    const own = { ...minion(1, 0, 50), maxHp: 30 };
    for (let count = 0; count < buffs; count += 1) applyMinionBuff(own);
    players[0].minions = [own, { ...minion(2, 1, 50), maxHp: 30 }];
    players[1].minions = [{ ...minion(10, 0, 50, 60, 6), maxHp: 60 }];
    for (let tick = 0; tick < ticks; tick += 1) combatTick(players, 1);
    return players;
  }

  it('liefert mit mehreren Buffs und gleichem Ausgangszustand zwei identische Endzustände', () => {
    expect(fight(3, 200)).toEqual(fight(3, 200));
    expect(fight(2, 80)).toEqual(fight(2, 80));
  });

  it('gibt dem gestärkten Minion mehr Leben und Schaden als dem ungestärkten', () => {
    const [plain, once, twice] = [0, 1, 2].map((buffs) => {
      const own = { ...minion(1, 0, 50), maxHp: 30 };
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
