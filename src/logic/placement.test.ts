import { describe, expect, it } from 'vitest';
import { getCardDef } from './cards';
import { type Minion } from './combat';
import {
  createMatch,
  lineCapacity,
  MAX_LINE_LEVEL,
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
  positionToY,
  SLOT_SPACING,
  slotAtPosition,
  slotPosition,
  yToPosition,
} from './placement';

/** Match mit Beschwörungskarten und viel Energie, damit nur die Platzierung getestet wird. */
function setup(): MatchState {
  const state = createMatch(1);
  state.players[0].hand = ['summon-minion', 'summon-minion', 'summon-minion', 'summon-minion', 'summon-brute'];
  state.players[0].energy = 8;
  return state;
}

function minion(line: number, position: number): Minion {
  return { id: 1, line, position, hp: 1, damage: 1, speed: 10 };
}

describe('Slots', () => {
  it('liegen in der eigenen Hälfte, auch bei höchster Line-Stufe', () => {
    for (let slot = 0; slot < lineCapacity(MAX_LINE_LEVEL); slot += 1) {
      expect(isValidSlot(slot, lineCapacity(MAX_LINE_LEVEL))).toBe(true);
      expect(slotPosition(slot)).toBeLessThanOrEqual(PLACEMENT_ZONE_END);
    }
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
    const result = playCard(setup(), 0, 0, 1, 2);
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

  it('meldet einen Slot außerhalb der Line-Kapazität', () => {
    const result = playCard(setup(), 0, 0, 0, lineCapacity(1));
    expect(result).toMatchObject({ ok: false, reason: 'invalid-slot' });
  });

  it('meldet bei voller Line „line-full“, auch mit freiem Slot-Wunsch', () => {
    let state = setup();
    for (let slot = 0; slot < lineCapacity(1); slot += 1) state = playCard(state, 0, 0, 0, slot).state;
    expect(playCard(state, 0, 0, 0, 0)).toMatchObject({ ok: false, reason: 'line-full' });
    expect(playCard(state, 0, 0, 0)).toMatchObject({ ok: false, reason: 'line-full' });
  });

  it('erlaubt gleiche Slots auf verschiedenen Lines', () => {
    const first = playCard(setup(), 0, 0, 0, 0);
    expect(playCard(first.state, 0, 0, 1, 0).ok).toBe(true);
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
  it('versetzt einen Minion kostenlos auf einen freien Slot einer anderen Line', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
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
    state.players[0].minions.push({ id: 50, line: 0, position: 60, hp: 5, damage: 1, speed: 10 });
    expect(undoSummon(state, 0, 50)).toMatchObject({ ok: false, reason: 'no-such-minion' });
    expect(moveMinion(state, 0, 50, 0, 0)).toMatchObject({ ok: false, reason: 'no-such-minion' });
  });
});

describe('Zeiger → Line und Slot', () => {
  const geometry: LineGeometry = { lineCenters: [60, 180, 300], lineHalfWidth: 50, ownTowerY: 400, enemyTowerY: 90 };
  const counts = [3, 3, 3];

  it('rechnet Position und y ineinander um', () => {
    for (const position of [0, 2, 14, 100]) {
      expect(yToPosition(positionToY(position, geometry), geometry)).toBeCloseTo(position);
    }
  });

  it('trifft einen Slot genau und mit Toleranz', () => {
    const y = positionToY(slotPosition(1), geometry);
    expect(dropTargetAt(180, y, geometry, counts)).toEqual({ line: 1, slot: 1 });
    expect(dropTargetAt(190, y + 2, geometry, counts)).toEqual({ line: 1, slot: 1 });
  });

  it('trifft eine Line ohne Slot (hinter den vorhandenen Slots oder zwischen Zonen)', () => {
    expect(dropTargetAt(60, positionToY(slotPosition(3), geometry), geometry, counts)).toEqual({ line: 0, slot: null });
    expect(dropTargetAt(300, positionToY(60, geometry), geometry, counts)).toEqual({ line: 2, slot: null });
  });

  it('liefert null außerhalb aller Lines', () => {
    const y = positionToY(slotPosition(0), geometry);
    expect(dropTargetAt(120, y, geometry, counts)).toBeNull();
    expect(dropTargetAt(60, 600, geometry, counts)).toBeNull();
    expect(dropTargetAt(60, 20, geometry, counts)).toBeNull();
  });

  it('slotAtPosition kennt nur gültige Slots', () => {
    expect(slotAtPosition(slotPosition(2), 3)).toBe(2);
    expect(slotAtPosition(slotPosition(3), 3)).toBeNull();
    expect(slotAtPosition(-10, 3)).toBeNull();
  });
});
