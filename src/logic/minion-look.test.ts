import { describe, expect, it } from 'vitest';
import type { Minion } from './combat';
import type { FxEvent } from './fx-events';
import {
  ATTACK_MS,
  BOB_AMPLITUDE,
  BOB_PERIOD_MS,
  DEATH_FALL_ANGLE,
  DEATH_MS,
  FLASH_MS,
  MAX_RADIUS,
  MIN_RADIUS,
  WALK_PERIOD_MS,
  advanceMinionAnim,
  attackProgress,
  bobOffset,
  deathAlpha,
  deathAngle,
  deathProgress,
  minionPhase,
  newMinionAnim,
  strideSwing,
  updateAttacks,
  updateGhosts,
  walkCycle,
  facing,
  flashKey,
  flashStrength,
  laneStagger,
  minionRadius,
  minionShape,
  STAGGER_STEP,
  updateFlashes,
} from './minion-look';

describe('minionShape', () => {
  it('ordnet Rollen Formen zu', () => {
    expect(minionShape({ range: 4 })).toBe('melee');
    expect(minionShape({ range: 14 })).toBe('ranged');
    expect(minionShape({ range: 10, heals: true })).toBe('healer');
    expect(minionShape({ range: 4, explodes: { radius: 10, damage: 15 } })).toBe('destroyer');
  });

  it('erkennt den Zerstörer unabhängig von seiner Reichweite und lässt den Heiler Vorrang', () => {
    const explodes = { radius: 10, damage: 15 };
    expect(minionShape({ range: 14, explodes })).toBe('destroyer');
    expect(minionShape({ range: 10, heals: true, explodes })).toBe('healer');
  });
});

describe('minionRadius', () => {
  it('wächst mit Max-HP und ist begrenzt', () => {
    expect(minionRadius(0)).toBe(MIN_RADIUS);
    expect(minionRadius(20)).toBe(MIN_RADIUS);
    expect(minionRadius(30)).toBeLessThan(minionRadius(80));
    expect(minionRadius(80)).toBe(MAX_RADIUS);
    expect(minionRadius(500)).toBe(MAX_RADIUS);
  });
  it('macht große Einheiten sichtbar größer', () => {
    expect(minionRadius(80) - minionRadius(30)).toBeGreaterThanOrEqual(3);
  });
});

describe('facing', () => {
  it('Spieler schaut nach rechts, Bot nach links (die Lane läuft waagrecht)', () => {
    expect(facing(0)).toBe(1);
    expect(facing(1)).toBe(-1);
  });
});

describe('laneStagger', () => {
  it('verteilt Minions nach ID auf drei Bahnen quer zur Lane', () => {
    expect([3, 1, 2].map(laneStagger)).toEqual([-STAGGER_STEP, 0, STAGGER_STEP].map((v) => v));
    expect(laneStagger(3)).toBe(laneStagger(0));
  });

  it('ist stabil: dieselbe ID ergibt immer denselben Versatz, benachbarte IDs verschiedene', () => {
    expect(laneStagger(7)).toBe(laneStagger(7));
    expect(new Set([1, 2, 3].map(laneStagger)).size).toBe(3);
    for (const id of [1, 2, 3, 50]) expect(Math.abs(laneStagger(id))).toBeLessThanOrEqual(STAGGER_STEP);
  });
});

describe('bobOffset', () => {
  it('steht still ohne Bewegung', () => {
    expect(bobOffset(123, 1, false)).toBe(0);
  });
  it('bleibt im Ausschlag und wiederholt sich nach einer Periode', () => {
    for (let t = 0; t < 1000; t += 37) expect(Math.abs(bobOffset(t, 3, true))).toBeLessThanOrEqual(BOB_AMPLITUDE);
    expect(bobOffset(50 + BOB_PERIOD_MS, 3, true)).toBeCloseTo(bobOffset(50, 3, true), 9);
  });
  it('hängt nur von der Zeit ab, nicht von der Zahl der Schritte', () => {
    expect(bobOffset(1000, 2, true)).toBe(bobOffset(1000, 2, true));
  });
  it('versetzt die Phase je Minion', () => {
    expect(bobOffset(0, 1, true)).not.toBe(bobOffset(0, 2, true));
  });
});

describe('flashStrength', () => {
  it('läuft von 1 auf 0', () => {
    expect(flashStrength(FLASH_MS)).toBe(1);
    expect(flashStrength(FLASH_MS / 2)).toBeCloseTo(0.5);
    expect(flashStrength(0)).toBe(0);
    expect(flashStrength(-5)).toBe(0);
    expect(flashStrength(FLASH_MS * 3)).toBe(1);
  });
});

describe('updateFlashes', () => {
  const damage = (owner: number, minionId: number): FxEvent => ({
    kind: 'minion-damage',
    owner,
    minionId,
    line: 0,
    position: 10,
    amount: 3,
    source: 'melee',
  });

  it('startet einen Blitz bei Schaden', () => {
    const next = updateFlashes(new Map(), [damage(0, 5)], 16);
    expect(next.get(flashKey(0, 5))).toBe(FLASH_MS);
  });
  it('ignoriert andere Ereignisse', () => {
    const events: FxEvent[] = [{ kind: 'tower-damage', owner: 0, line: 0, tower: 0, amount: 2 }];
    expect(updateFlashes(new Map(), events, 16).size).toBe(0);
  });
  it('lässt Blitze mit der Zeit ablaufen und entfernt sie', () => {
    const start = new Map([[flashKey(1, 2), 100]]);
    expect(updateFlashes(start, [], 40).get(flashKey(1, 2))).toBe(60);
    expect(updateFlashes(start, [], 100).has(flashKey(1, 2))).toBe(false);
  });
  it('verändert die Eingabe nicht und startet bei erneutem Schaden neu', () => {
    const start = new Map([[flashKey(0, 5), 20]]);
    const next = updateFlashes(start, [damage(0, 5)], 10);
    expect(start.get(flashKey(0, 5))).toBe(20);
    expect(next.get(flashKey(0, 5))).toBe(FLASH_MS);
  });
});

const unit = (over: Partial<Minion> & { id: number }): Minion => ({
  line: 0,
  position: 40,
  hp: 30,
  damage: 5,
  range: 4,
  speed: 10,
  ...over,
});

describe('Laufzyklus', () => {
  it('bleibt im Bereich 0 bis 1 und wiederholt sich nach einer Periode', () => {
    for (let t = 0; t < 2000; t += 91) {
      const c = walkCycle(t, 4);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(1);
    }
    expect(walkCycle(100 + WALK_PERIOD_MS, 2)).toBeCloseTo(walkCycle(100, 2), 9);
  });
  it('ist bei 30 und 144 Hz gleich schnell (Summe der delta, nicht der Frames)', () => {
    const run = (hz: number) => {
      let t = 0;
      for (let i = 0; i < hz; i += 1) t += 1000 / hz;
      return walkCycle(t, 1);
    };
    expect(run(30)).toBeCloseTo(run(144), 6);
  });
  it('schwingt die Beine zwischen -1 und 1', () => {
    expect(strideSwing(0)).toBeCloseTo(0);
    expect(strideSwing(0.25)).toBeCloseTo(1);
    expect(strideSwing(0.75)).toBeCloseTo(-1);
  });
});

describe('minionPhase', () => {
  it('wählt Angriff vor Laufen vor Stehen', () => {
    expect(minionPhase(false, 0)).toBe('idle');
    expect(minionPhase(true, 0)).toBe('walk');
    expect(minionPhase(true, 100)).toBe('attack');
    expect(minionPhase(false, 100)).toBe('attack');
  });
});

describe('Angriffs- und Sterbefortschritt', () => {
  it('attackProgress läuft von 0 auf 1', () => {
    expect(attackProgress(ATTACK_MS)).toBe(0);
    expect(attackProgress(ATTACK_MS / 2)).toBeCloseTo(0.5);
    expect(attackProgress(0)).toBe(1);
    expect(attackProgress(-10)).toBe(1);
    expect(attackProgress(ATTACK_MS * 2)).toBe(0);
  });
  it('deathProgress ist begrenzt, Alpha blendet in der zweiten Hälfte aus, der Winkel kippt nach hinten', () => {
    expect(deathProgress(-1)).toBe(0);
    expect(deathProgress(DEATH_MS / 2)).toBeCloseTo(0.5);
    expect(deathProgress(DEATH_MS * 3)).toBe(1);
    expect(deathAlpha(0)).toBe(1);
    expect(deathAlpha(0.5)).toBe(1);
    expect(deathAlpha(0.75)).toBeCloseTo(0.5);
    expect(deathAlpha(1)).toBe(0);
    expect(deathAngle(0)).toBe(0);
    expect(deathAngle(0.35)).toBeGreaterThan(0);
    expect(deathAngle(0.35)).toBeLessThan(DEATH_FALL_ANGLE);
    expect(deathAngle(1)).toBe(DEATH_FALL_ANGLE);
  });
});

describe('updateAttacks', () => {
  const hit = (owner: number, position: number): FxEvent => ({
    kind: 'minion-damage',
    owner,
    minionId: 9,
    line: 0,
    position,
    amount: 3,
    source: 'melee',
  });

  it('startet die Angriffsbewegung beim Gegner in Reichweite, nicht bei fernen oder anderen Lanes', () => {
    const players = [
      { minions: [unit({ id: 9, position: 48 })] },
      { minions: [unit({ id: 1, position: 50 }), unit({ id: 2, position: 10 }), unit({ id: 3, position: 50, line: 1 })] },
    ];
    const next = updateAttacks(new Map(), [hit(0, 48)], players, 16);
    expect([...next.keys()]).toEqual([flashKey(1, 1)]);
    expect(next.get(flashKey(1, 1))).toBe(ATTACK_MS);
  });
  it('lässt Heiler und Tote nicht angreifen, Fernkämpfer aus der Ferne schon', () => {
    const players = [
      { minions: [unit({ id: 9, position: 30 })] },
      {
        minions: [
          unit({ id: 1, position: 60, heals: true, range: 10 }),
          unit({ id: 2, position: 60, hp: 0 }),
          unit({ id: 3, position: 60, range: 14 }),
        ],
      },
    ];
    const next = updateAttacks(new Map(), [hit(0, 30)], players, 16);
    expect([...next.keys()]).toEqual([flashKey(1, 3)]);
  });
  it('startet den Zauber des Heilers bei Heilung und ignoriert andere Ereignisse und unbekannte Seiten', () => {
    const heal: FxEvent = { kind: 'minion-heal', owner: 0, minionId: 9, line: 0, position: 40, amount: 2 };
    const players = [
      {
        minions: [
          unit({ id: 9, position: 40 }),
          unit({ id: 4, position: 36, heals: true, range: 10 }),
          unit({ id: 5, position: 90, heals: true, range: 10 }),
          unit({ id: 9, heals: true, position: 40 }),
        ],
      },
    ];
    expect([...updateAttacks(new Map(), [heal], players, 0).keys()]).toEqual([flashKey(0, 4)]);
    expect(updateAttacks(new Map(), [{ kind: 'round-start', round: 1 }], players, 0).size).toBe(0);
    expect(updateAttacks(new Map(), [hit(0, 40)], players, 0).size).toBe(0);
    expect(updateAttacks(new Map(), [{ ...heal, owner: 5 }], players, 0).size).toBe(0);
  });
  it('lässt Angriffe ablaufen, startet sie neu und verändert die Eingabe nicht', () => {
    const start = new Map([[flashKey(1, 1), 100]]);
    expect(updateAttacks(start, [], [], 40).get(flashKey(1, 1))).toBe(60);
    expect(updateAttacks(start, [], [], 100).size).toBe(0);
    const players = [{ minions: [] }, { minions: [unit({ id: 1, position: 50 })] }];
    expect(updateAttacks(start, [hit(0, 48)], players, 10).get(flashKey(1, 1))).toBe(ATTACK_MS);
    expect(start.get(flashKey(1, 1))).toBe(100);
  });
});

describe('updateGhosts', () => {
  const death = (owner: number, minionId: number): FxEvent => ({ kind: 'minion-death', owner, minionId, line: 1, position: 33 });
  const before = [{ minions: [unit({ id: 7, hp: 0, maxHp: 80, heals: true })] }, { minions: [] }];

  it('legt beim Tod eine Kopie mit Form und Größe aus dem früheren Zustand an', () => {
    const ghosts = updateGhosts([], [death(0, 7)], before, 16);
    expect(ghosts).toEqual([{ owner: 0, id: 7, line: 1, position: 33, shape: 'healer', radius: MAX_RADIUS, ageMs: 0 }]);
  });
  it('überspringt Tote ohne Vorgänger und andere Ereignisse', () => {
    expect(updateGhosts([], [death(0, 99), death(1, 7), death(4, 7)], before, 16)).toEqual([]);
    expect(updateGhosts([], [{ kind: 'round-end', round: 1 }], before, 16)).toEqual([]);
  });
  it('lässt die Kopie altern und nach DEATH_MS verschwinden, ohne die Eingabe zu ändern', () => {
    const start = updateGhosts([], [death(0, 7)], before, 0);
    const mid = updateGhosts(start, [], before, 100);
    expect(mid[0]!.ageMs).toBe(100);
    expect(start[0]!.ageMs).toBe(0);
    expect(updateGhosts(mid, [], before, DEATH_MS)).toEqual([]);
  });
});

describe('advanceMinionAnim', () => {
  it('schreibt Zeit, Blitze, Angriffe und Sterbende gemeinsam fort', () => {
    const prev = { players: [{ minions: [unit({ id: 1, position: 40 })] }, { minions: [unit({ id: 2, position: 58 })] }] };
    const now = { players: [{ minions: [] as Minion[] }, { minions: [unit({ id: 2, position: 58 })] }] };
    const events: FxEvent[] = [
      { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 40, amount: 30, source: 'melee' },
      { kind: 'minion-death', owner: 0, minionId: 1, line: 0, position: 40 },
    ];
    const next = advanceMinionAnim(newMinionAnim(), events, prev, now, 20);
    expect(next.timeMs).toBe(20);
    expect(next.flashes.get(flashKey(0, 1))).toBe(FLASH_MS);
    expect(next.attacks.get(flashKey(1, 2))).toBe(ATTACK_MS);
    expect(next.ghosts).toHaveLength(1);
  });
});

describe('Übergang Laufen → Kampf → Tod', () => {
  it('durchläuft die Phasen über die Zeit', () => {
    const players = [{ minions: [unit({ id: 1, position: 48 })] }, { minions: [unit({ id: 2, position: 50 })] }];
    const hit: FxEvent = { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 48, amount: 1, source: 'melee' };
    let attacks: ReadonlyMap<string, number> = new Map();
    const key = flashKey(1, 2);
    expect(minionPhase(true, attacks.get(key) ?? 0)).toBe('walk');
    attacks = updateAttacks(attacks, [hit], players, 16);
    expect(minionPhase(true, attacks.get(key) ?? 0)).toBe('attack');
    attacks = updateAttacks(attacks, [], players, ATTACK_MS);
    expect(minionPhase(true, attacks.get(key) ?? 0)).toBe('walk');
    expect(minionPhase(false, attacks.get(key) ?? 0)).toBe('idle');
    const ghosts = updateGhosts([], [{ kind: 'minion-death', owner: 0, minionId: 1, line: 0, position: 48 }], players, 16);
    expect(deathProgress(ghosts[0]!.ageMs)).toBe(0);
    expect(updateGhosts(ghosts, [], players, DEATH_MS)).toHaveLength(0);
  });
});
