import { describe, expect, it } from 'vitest';
import { getCardDef } from './cards';
import { type Minion } from './combat';
import { laneTowerOffsets, MAX_FIELD_LEVEL } from './lanes';
import {
  createMatch,
  laneSlotCounts,
  lineCapacity,
  type MatchState,
  moveMinion,
  playCard,
  setReady,
  undoSummon,
} from './match';
import {
  dropTargetAt,
  firstFreeSlot,
  isSlotFree,
  isValidSlot,
  type LineGeometry,
  PLACEMENT_ZONE_END,
  positionToX,
  SLOT_SPACING,
  slotAtPosition,
  slotPosition,
  xToPosition,
} from './placement';

/** Match mit Beschwörungskarten und viel Energie, damit nur die Platzierung getestet wird; `level` = Ausbaustufe. */
function setup(level = 1): MatchState {
  const state = createMatch(1);
  state.players[0].hand = ['summon-minion', 'summon-minion', 'summon-minion', 'summon-minion', 'summon-brute'];
  state.players[0].energy = 8;
  state.players[0].level = level;
  return state;
}

function minion(line: number, position: number): Minion {
  return { id: 1, line, position, hp: 1, damage: 1, range: 4, speed: 10 };
}

describe('Slots', () => {
  it('liegen in der eigenen Hälfte, auch bei höchster Ausbaustufe', () => {
    for (let slot = 0; slot < lineCapacity(MAX_FIELD_LEVEL); slot += 1) {
      expect(isValidSlot(slot, lineCapacity(MAX_FIELD_LEVEL))).toBe(true);
      expect(slotPosition(slot)).toBeLessThanOrEqual(PLACEMENT_ZONE_END);
    }
  });

  it('umschließen die Tower der Start-Lane: Plätze vor, zwischen und hinter den Towern', () => {
    const towers = laneTowerOffsets(0);
    const positions = Array.from({ length: lineCapacity(MAX_FIELD_LEVEL) }, (_, slot) => slotPosition(slot));
    expect(towers).toEqual([0, 8, 16]);
    expect(positions.some((p) => p > towers[0]! && p < towers[1]!)).toBe(true);
    expect(positions.some((p) => p > towers[1]! && p < towers[2]!)).toBe(true);
    expect(positions.some((p) => p > towers[2]!)).toBe(true);
    // Kein Slot liegt genau auf einem Tower.
    for (const p of positions) expect(towers).not.toContain(p);
  });

  it('lehnt ungültige Slots ab', () => {
    expect(isValidSlot(-1, 3)).toBe(false);
    expect(isValidSlot(3, 3)).toBe(false);
    expect(isValidSlot(0.5, 3)).toBe(false);
    expect(isValidSlot(1000, 2000)).toBe(false);
  });

  it('erkennt belegte Slots nur auf derselben Line', () => {
    const minions = [minion(0, slotPosition(1))];
    expect(isSlotFree(minions, 0, 1)).toBe(false);
    expect(isSlotFree(minions, 1, 1)).toBe(true);
    expect(isSlotFree(minions, 0, 2)).toBe(true);
    expect(firstFreeSlot(minions, 0, 3)).toBe(0);
    expect(firstFreeSlot([minion(0, slotPosition(0)), { ...minion(0, slotPosition(1)), id: 2 }], 0, 3)).toBe(2);
  });
});

describe('Beschwören auf Slots', () => {
  it('stellt den Minion auf die Position des gewählten Slots', () => {
    const result = playCard(setup(2), 0, 0, 1, 2);
    expect(result.ok).toBe(true);
    expect(result.state.players[0].minions[0]).toMatchObject({ line: 1, position: slotPosition(2) });
  });

  it('nimmt ohne Slot den ersten freien', () => {
    let state = setup();
    for (let i = 0; i < 2; i += 1) {
      const result = playCard(state, 0, 0, 0);
      expect(result.ok).toBe(true);
      state = result.state;
    }
    expect(state.players[0].minions.map((m) => m.position)).toEqual([slotPosition(0), slotPosition(1)]);
  });

  it('meldet einen belegten Slot und lässt den Zustand unverändert', () => {
    const first = playCard(setup(), 0, 0, 0, 1);
    const second = playCard(first.state, 0, 0, 0, 1);
    expect(second).toMatchObject({ ok: false, reason: 'slot-taken' });
    expect(second.state).toBe(first.state);
  });

  it('meldet einen Slot außerhalb der Lane-Kapazität', () => {
    const result = playCard(setup(), 0, 0, 0, lineCapacity(1));
    expect(result).toMatchObject({ ok: false, reason: 'invalid-slot' });
  });

  it('meldet bei voller Line „line-full“, auch mit freiem Slot-Wunsch', () => {
    let state = setup();
    for (let slot = 0; slot < lineCapacity(1); slot += 1) state = playCard(state, 0, 0, 0, slot).state;
    expect(playCard(state, 0, 0, 0, 0)).toMatchObject({ ok: false, reason: 'line-full' });
    expect(playCard(state, 0, 0, 0)).toMatchObject({ ok: false, reason: 'line-full' });
  });

  it('erlaubt gleiche Slots auf verschiedenen Lanes', () => {
    const first = playCard(setup(2), 0, 0, 0, 0);
    expect(playCard(first.state, 0, 0, 1, 0).ok).toBe(true);
    expect(playCard(first.state, 0, 0, 2, 0).ok).toBe(true);
  });

  it('lehnt eine noch gesperrte oder ungültige Lane ab und lässt den Zustand unverändert', () => {
    const state = setup();
    for (const lane of [1, 2, 3, 4, 5, -1, 0.5]) {
      const result = playCard(state, 0, 0, lane, 0);
      expect(result).toMatchObject({ ok: false, reason: 'invalid-line' });
      expect(result.state).toBe(state);
    }
  });

  it('lehnt bei Lvl 2 die Lanes von Lvl 3 ab, bei Lvl 3 nimmt es alle fünf an', () => {
    expect(playCard(setup(2), 0, 0, 3, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(playCard(setup(2), 0, 0, 4, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
    for (const lane of [0, 1, 2, 3, 4]) expect(playCard(setup(3), 0, 0, lane, 0).ok).toBe(true);
  });

  it('ignoriert den Slot bei Karten ohne Beschwörung', () => {
    const state = setup();
    state.players[0].hand = ['tower-hp'];
    expect(playCard(state, 0, 0, 0, 99).ok).toBe(true);
  });

  it('hält den Slotabstand größer als die halbe Minion-Reichweite-Überlappung', () => {
    expect(SLOT_SPACING).toBeGreaterThan(0);
  });
});

describe('Verschieben vor „Bereit“', () => {
  it('versetzt einen Minion kostenlos auf einen freien Slot einer anderen Lane', () => {
    const placed = playCard(setup(2), 0, 0, 0, 0).state;
    const id = placed.players[0].minions[0]!.id;
    const moved = moveMinion(placed, 0, id, 2, 2);
    expect(moved.ok).toBe(true);
    expect(moved.state.players[0].minions[0]).toMatchObject({ line: 2, position: slotPosition(2) });
    expect(moved.state.players[0].energy).toBe(placed.players[0].energy);
  });

  it('darf auf den eigenen Slot zurück und lehnt fremd belegte ab', () => {
    let state = playCard(setup(), 0, 0, 0, 0).state;
    state = playCard(state, 0, 0, 0, 1).state;
    const [a, b] = state.players[0].minions;
    expect(moveMinion(state, 0, a!.id, 0, 0).ok).toBe(true);
    expect(moveMinion(state, 0, a!.id, 0, 1)).toMatchObject({ ok: false, reason: 'slot-taken' });
    expect(moveMinion(state, 0, b!.id, 0, 9)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(moveMinion(state, 0, b!.id, 7, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
  });

  it('lehnt das Verschieben auf eine volle Lane ab, der eigene alte Platz zählt dabei nicht mit', () => {
    let state = setup(2);
    for (let slot = 0; slot < lineCapacity(2); slot += 1) state = playCard(state, 0, 0, 1, slot).state;
    state = playCard(state, 0, 0, 0, 0).state;
    const outsider = state.players[0].minions.find((m) => m.line === 0)!;
    expect(moveMinion(state, 0, outsider.id, 1, 0)).toMatchObject({ ok: false, reason: 'line-full' });
    // Auf der eigenen, vollen Lane bleibt der Wechsel auf einen freien Platz möglich, wenn er einen frei macht.
    const onFull = state.players[0].minions.filter((m) => m.line === 1);
    expect(moveMinion(state, 0, onFull[0]!.id, 1, 0).ok).toBe(true);
  });

  it('verschiebt und nimmt auch für Spieler 1 zurück, ohne die Statistik des eigenen Spielers zu berühren', () => {
    const state = setup(2);
    state.players[1].hand = ['summon-minion', 'summon-minion'];
    state.players[1].energy = 8;
    const placed = playCard(state, 1, 0, 0, 0);
    if (!placed.ok) throw new Error(placed.reason);
    const id = placed.state.players[1].minions[0]!.id;
    const moved = moveMinion(placed.state, 1, id, 0, 2);
    expect(moved.ok).toBe(true);
    expect(moved.state.players[1].minions[0]).toMatchObject({ line: 0, position: slotPosition(2) });
    const undone = undoSummon(moved.state, 1, id);
    expect(undone.ok).toBe(true);
    expect(undone.state.players[1].minions).toHaveLength(0);
    expect(undone.state.stats).toEqual(state.stats);
  });

  it('lehnt Verschieben und Zurücknehmen außerhalb der Planungsphase ab', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
    const id = placed.players[0].minions[0]!.id;
    const combat = setReady(setReady(placed, 0), 1);
    expect(moveMinion(combat, 0, id, 0, 1)).toMatchObject({ ok: false, reason: 'not-planning' });
    expect(undoSummon(combat, 0, id)).toMatchObject({ ok: false, reason: 'not-planning' });
  });

  it('lehnt das Verschieben auf eine gesperrte Lane ab', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
    const id = placed.players[0].minions[0]!.id;
    const result = moveMinion(placed, 0, id, 1, 0);
    expect(result).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(result.state).toBe(placed);
  });

  it('kennt keine fremden oder alten Minions', () => {
    const state = playCard(setup(), 0, 0, 0, 0).state;
    expect(moveMinion(state, 0, 999, 0, 1)).toMatchObject({ ok: false, reason: 'no-such-minion' });
    expect(moveMinion(state, 1, state.players[0].minions[0]!.id, 0, 1)).toMatchObject({
      ok: false,
      reason: 'no-such-minion',
    });
  });

  it('ist nach „Bereit“ gesperrt', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
    const ready = setReady(placed, 0);
    const id = ready.players[0].minions[0]!.id;
    expect(moveMinion(ready, 0, id, 0, 1)).toMatchObject({ ok: false, reason: 'already-ready' });
    expect(undoSummon(ready, 0, id)).toMatchObject({ ok: false, reason: 'already-ready' });
  });
});

describe('Rückgängig machen vor „Bereit“', () => {
  it('nimmt die Beschwörung zurück, erstattet Energie und gibt die Karte zurück', () => {
    const before = setup();
    const placed = playCard(before, 0, 4, 0, 0).state; // Brocken, Kosten 2
    expect(placed.players[0].energy).toBe(before.players[0].energy - getCardDef('summon-brute').cost);
    const undone = undoSummon(placed, 0, placed.players[0].minions[0]!.id);
    expect(undone.ok).toBe(true);
    const player = undone.state.players[0];
    expect(player.minions).toHaveLength(0);
    expect(player.energy).toBe(before.players[0].energy);
    expect(player.hand.at(-1)).toBe('summon-brute');
    expect(player.placements).toEqual([]);
  });

  it('gibt den Slot wieder frei', () => {
    const placed = playCard(setup(), 0, 0, 0, 1).state;
    const undone = undoSummon(placed, 0, placed.players[0].minions[0]!.id).state;
    expect(playCard(undone, 0, 0, 0, 1).ok).toBe(true);
  });

  it('gilt nicht für Minions aus früheren Runden', () => {
    const state = setup();
    state.players[0].minions.push({ id: 50, line: 0, position: 60, hp: 5, damage: 1, range: 4, speed: 10 });
    expect(undoSummon(state, 0, 50)).toMatchObject({ ok: false, reason: 'no-such-minion' });
    expect(moveMinion(state, 0, 50, 0, 0)).toMatchObject({ ok: false, reason: 'no-such-minion' });
  });
});

describe('Zeiger → Lane und Slot', () => {
  // Lane-Index 0 = Start-Lane (Mitte), 1/2 = Lvl 2 oben/unten, 3/4 = Lvl 3 oben/unten.
  const geometry: LineGeometry = { laneCenters: [232, 162, 302, 92, 372], laneHalfHeight: 33, ownTowerX: 30, enemyTowerX: 330 };
  const counts = [3, 3, 3, 0, 0];

  it('rechnet Position und x ineinander um', () => {
    for (const position of [0, 2, 14, 100]) {
      expect(xToPosition(positionToX(position, geometry), geometry)).toBeCloseTo(position);
    }
    expect(positionToX(0, geometry)).toBe(30);
    expect(positionToX(100, geometry)).toBe(330);
  });

  it('trifft einen Slot genau und mit Toleranz', () => {
    const x = positionToX(slotPosition(1), geometry);
    expect(dropTargetAt(x, 162, geometry, counts)).toEqual({ line: 1, slot: 1 });
    expect(dropTargetAt(x + 2, 170, geometry, counts)).toEqual({ line: 1, slot: 1 });
    expect(dropTargetAt(x, 232, geometry, counts)).toEqual({ line: 0, slot: 1 });
    expect(dropTargetAt(x, 302, geometry, counts)).toEqual({ line: 2, slot: 1 });
  });

  it('trifft eine Lane ohne Slot (hinter den vorhandenen Slots oder zwischen Zonen)', () => {
    expect(dropTargetAt(positionToX(slotPosition(3), geometry), 232, geometry, counts)).toEqual({ line: 0, slot: null });
    expect(dropTargetAt(positionToX(60, geometry), 302, geometry, counts)).toEqual({ line: 2, slot: null });
  });

  it('liefert null zwischen den Lanes, links und rechts neben dem Feld und über und unter allen Lanes', () => {
    const x = positionToX(slotPosition(0), geometry);
    expect(dropTargetAt(x, 197, geometry, counts)).toBeNull();
    expect(dropTargetAt(x, 267, geometry, counts)).toBeNull();
    expect(dropTargetAt(-20, 232, geometry, counts)).toBeNull();
    expect(dropTargetAt(10, 232, geometry, counts)).not.toBeNull();
    expect(dropTargetAt(380, 232, geometry, counts)).toBeNull();
    expect(dropTargetAt(x, 20, geometry, counts)).toBeNull();
    expect(dropTargetAt(x, 600, geometry, counts)).toBeNull();
  });

  it('behandelt Lanes ohne Eintrag in der Slot-Zahl-Liste wie gesperrte', () => {
    const x = positionToX(slotPosition(0), geometry);
    expect(dropTargetAt(x, 232, geometry, [3])).toEqual({ line: 0, slot: 0 });
    expect(dropTargetAt(x, 162, geometry, [3])).toBeNull();
    expect(dropTargetAt(x, 232, geometry, [])).toBeNull();
  });

  it('trifft keine gesperrte Lane (Slot-Zahl 0), auch wenn der Zeiger genau darauf steht', () => {
    const x = positionToX(slotPosition(0), geometry);
    expect(dropTargetAt(x, 92, geometry, counts)).toBeNull();
    expect(dropTargetAt(x, 372, geometry, counts)).toBeNull();
    expect(dropTargetAt(x, 92, geometry, laneSlotCounts(3))).toEqual({ line: 3, slot: 0 });
    expect(dropTargetAt(x, 372, geometry, laneSlotCounts(3))).toEqual({ line: 4, slot: 0 });
    expect(dropTargetAt(x, 372, geometry, laneSlotCounts(2))).toBeNull();
  });

  it('slotAtPosition kennt nur gültige Slots', () => {
    expect(slotAtPosition(slotPosition(2), 3)).toBe(2);
    expect(slotAtPosition(slotPosition(3), 3)).toBeNull();
    expect(slotAtPosition(-10, 3)).toBeNull();
  });
});
