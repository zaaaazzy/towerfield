import { describe, expect, it } from 'vitest';
import { getCardDef } from './cards';
import { type Minion, type Tower } from './combat';
import {
  buyLane,
  createMatch,
  laneSlotCounts,
  type MatchState,
  MOVE_COST,
  moveMinion,
  playCard,
  type PlayResult,
  setReady,
  undoSummon,
  upgradeField,
} from './match';
import {
  describeSlot,
  firstFreeSlot,
  freeLaneSlotPoints,
  freeSlotPoints,
  freeSlots,
  GLOW_RADIUS,
  isSlotFree,
  isValidSlot,
  LANE_SLOT_GAP,
  laneSlotPoint,
  type LineGeometry,
  makeSlot,
  nearestPoint,
  positionToX,
  SLOT_DY,
  SNAP_RADIUS,
  slotPoint,
  slotPosition,
  slotProximity,
  slotSide,
  slotTower,
  snapTarget,
  validSlots,
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

function minion(line: number, slot: number, id = 1): Minion {
  return { id, line, slot, position: 0, hp: 1, damage: 1, range: 4, speed: 10 };
}

const tower = (offset: number, hp = 100): Tower => ({ offset, hp, maxHp: 100, damage: 8 });

/** Der Zustand nach einer erfolgreichen Aktion; wirft mit dem Ablehnungsgrund. */
function unwrap(result: PlayResult): MatchState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

/** Öffnet die Lane `lane` von Spieler 0 mit einem einzelnen Tower, ohne Kauf (nur für Platzierungstests). */
function openLane(state: MatchState, lane: number): void {
  const line = state.players[0].lines[lane]!;
  line.bought = true;
  line.towers = [tower(0)];
}

describe('Slots', () => {
  it('bietet je lebendem Tower genau zwei Slots, oben und unten', () => {
    const towers = [tower(0), tower(8), tower(16)];
    expect(validSlots(towers)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(validSlots([tower(0)])).toEqual([0, 1]);
    expect(slotSide(0)).toBe(0);
    expect(slotSide(1)).toBe(1);
    expect(slotTower(3)).toBe(1);
    expect(makeSlot(2, 1)).toBe(5);
  });

  it('gibt der Start-Lane sechs Slots, den anderen Lanes zwei, gesperrten keine', () => {
    const player = createMatch(1).players[0];
    expect(laneSlotCounts(player)).toEqual([6, 0, 0, 0, 0]);
    let state = setup();
    state.players[0].energy = 100;
    // Feldstufe 2 → obere und untere Lane kaufen, Feldstufe 3 → die beiden äußeren.
    state = unwrap(upgradeField(state, 0));
    for (const lane of [1, 2]) state = unwrap(buyLane(state, 0, lane));
    expect(laneSlotCounts(state.players[0])).toEqual([6, 2, 2, 0, 0]);
    state = unwrap(upgradeField(state, 0));
    for (const lane of [3, 4]) state = unwrap(buyLane(state, 0, lane));
    expect(laneSlotCounts(state.players[0])).toEqual([6, 2, 2, 2, 2]);
  });

  it('bietet für einen zerstörten Tower keine Slots mehr', () => {
    const towers = [tower(0), tower(8, 0), tower(16)];
    expect(validSlots(towers)).toEqual([0, 1, 4, 5]);
    expect(isValidSlot(towers, 2)).toBe(false);
    expect(isValidSlot(towers, 3)).toBe(false);
    expect(isValidSlot(towers, 4)).toBe(true);
  });

  it('lehnt ungültige Slots ab', () => {
    const towers = [tower(0)];
    expect(isValidSlot(towers, -1)).toBe(false);
    expect(isValidSlot(towers, 2)).toBe(false);
    expect(isValidSlot(towers, 0.5)).toBe(false);
    expect(isValidSlot(towers, 1000)).toBe(false);
    expect(isValidSlot([], 0)).toBe(false);
  });

  it('startet ein Minion auf dem Standort seines Towers, beide Seiten gleich', () => {
    const towers = [tower(0), tower(8), tower(16)];
    expect(slotPosition(towers, 0)).toBe(0);
    expect(slotPosition(towers, 1)).toBe(0);
    expect(slotPosition(towers, 2)).toBe(8);
    expect(slotPosition(towers, 5)).toBe(16);
    expect(slotPosition([tower(0)], 7)).toBe(0);
  });

  it('erkennt belegte Slots nur auf derselben Lane und fasst höchstens eine Einheit je Slot', () => {
    const towers = [tower(0), tower(8)];
    const minions = [minion(0, 1)];
    expect(isSlotFree(minions, 0, 1)).toBe(false);
    expect(isSlotFree(minions, 1, 1)).toBe(true);
    expect(isSlotFree(minions, 0, 0)).toBe(true);
    expect(freeSlots(minions, 0, towers)).toEqual([0, 2, 3]);
    expect(firstFreeSlot(minions, 0, towers)).toBe(0);
    expect(firstFreeSlot([minion(0, 0), minion(0, 1, 2)], 0, towers)).toBe(2);
    expect(firstFreeSlot([0, 1, 2, 3].map((slot) => minion(0, slot, slot + 1)), 0, towers)).toBeUndefined();
  });

  it('benennt Turm und Seite', () => {
    expect(describeSlot(0)).toBe('Turm 1 oben');
    expect(describeSlot(3)).toBe('Turm 2 unten');
  });
});

describe('Beschwören auf Slots', () => {
  it('stellt den Minion auf den gewählten Slot an der Position seines Towers', () => {
    const result = playCard(setup(), 0, 0, 0, 3);
    expect(result.ok).toBe(true);
    expect(result.state.players[0].minions[0]).toMatchObject({ line: 0, slot: 3, position: 8 });
  });

  it('nimmt ohne Slot den ersten freien', () => {
    let state = setup();
    for (let i = 0; i < 3; i += 1) {
      const result = playCard(state, 0, 0, 0);
      expect(result.ok).toBe(true);
      state = result.state;
    }
    expect(state.players[0].minions.map((m) => m.slot)).toEqual([0, 1, 2]);
  });

  it('meldet einen belegten Slot und lässt den Zustand unverändert', () => {
    const first = playCard(setup(), 0, 0, 0, 1);
    const second = playCard(first.state, 0, 0, 0, 1);
    expect(second).toMatchObject({ ok: false, reason: 'slot-taken' });
    expect(second.state).toBe(first.state);
  });

  it('meldet einen Slot ohne Tower', () => {
    expect(playCard(setup(), 0, 0, 0, 6)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(playCard(setup(), 0, 0, 0, -1)).toMatchObject({ ok: false, reason: 'invalid-slot' });
  });

  it('meldet bei voller Lane „line-full“ ohne Slot-Wunsch und „slot-taken“ mit Wunsch', () => {
    let state = setup();
    state.players[0].hand = Array.from({ length: 8 }, () => 'summon-scout');
    state.players[0].energy = 20;
    for (let slot = 0; slot < 6; slot += 1) state = playCard(state, 0, 0, 0, slot).state;
    expect(playCard(state, 0, 0, 0, 0)).toMatchObject({ ok: false, reason: 'slot-taken' });
    expect(playCard(state, 0, 0, 0)).toMatchObject({ ok: false, reason: 'line-full' });
  });

  it('erlaubt gleiche Slots auf verschiedenen Lanes', () => {
    const state = setup(2);
    openLane(state, 1);
    openLane(state, 2);
    const first = playCard(state, 0, 0, 0, 0);
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

  it('lässt auf der Lane eines zerstörten Towers dessen Slots nicht zu', () => {
    const state = setup();
    state.players[0].lines[0].towers[1]!.hp = 0;
    expect(playCard(state, 0, 0, 0, 2)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(playCard(state, 0, 0, 0, 3)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(playCard(state, 0, 0, 0, 4).ok).toBe(true);
  });

  it('ignoriert den Slot bei Karten ohne Beschwörung', () => {
    const state = setup();
    state.players[0].hand = ['tower-hp'];
    expect(playCard(state, 0, 0, 0, 99).ok).toBe(true);
  });
});

describe('Verschieben auf einen anderen Turm-Slot', () => {
  it('kostet genau 1 Energie und setzt das Minion auf den neuen Slot', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
    const id = placed.players[0].minions[0]!.id;
    const moved = moveMinion(placed, 0, id, 0, 5);
    expect(moved.ok).toBe(true);
    expect(moved.state.players[0].minions[0]).toMatchObject({ line: 0, slot: 5, position: 16 });
    expect(moved.state.players[0].energy).toBe(placed.players[0].energy - MOVE_COST);
    expect(MOVE_COST).toBe(1);
  });

  it('versetzt auch auf einen Tower einer anderen Lane', () => {
    const state = setup(2);
    openLane(state, 1);
    const placed = playCard(state, 0, 0, 0, 0).state;
    const moved = moveMinion(placed, 0, placed.players[0].minions[0]!.id, 1, 1);
    expect(moved.state.players[0].minions[0]).toMatchObject({ line: 1, slot: 1, position: 0 });
  });

  it('lehnt bei zu wenig Energie ab, die Einheit bleibt, wo sie ist', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
    placed.players[0].energy = 0;
    const result = moveMinion(placed, 0, placed.players[0].minions[0]!.id, 0, 1);
    expect(result).toMatchObject({ ok: false, reason: 'not-enough-energy' });
    expect(result.state).toBe(placed);
    expect(result.state.players[0].minions[0]).toMatchObject({ slot: 0 });
  });

  it('verschiebt auch Überlebende früherer Runden', () => {
    const state = setup();
    state.players[0].minions.push({ id: 50, line: 0, slot: 4, position: 16, hp: 5, damage: 1, range: 4, speed: 10 });
    const moved = moveMinion(state, 0, 50, 0, 0);
    expect(moved.ok).toBe(true);
    expect(moved.state.players[0].minions.find((m) => m.id === 50)).toMatchObject({ slot: 0, position: 0 });
  });

  it('lehnt den eigenen und fremd belegte Slots, Slots ohne Tower und unfreie Lanes ab', () => {
    let state = playCard(setup(), 0, 0, 0, 0).state;
    state = playCard(state, 0, 0, 0, 1).state;
    const [a, b] = state.players[0].minions;
    expect(moveMinion(state, 0, a!.id, 0, 0)).toMatchObject({ ok: false, reason: 'slot-taken' });
    expect(moveMinion(state, 0, a!.id, 0, 1)).toMatchObject({ ok: false, reason: 'slot-taken' });
    expect(moveMinion(state, 0, b!.id, 0, 9)).toMatchObject({ ok: false, reason: 'invalid-slot' });
    expect(moveMinion(state, 0, b!.id, 7, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
    expect(moveMinion(state, 0, b!.id, 1, 0)).toMatchObject({ ok: false, reason: 'invalid-line' });
  });

  it('lehnt den Slot eines zerstörten Towers ab', () => {
    const placed = playCard(setup(), 0, 0, 0, 0).state;
    placed.players[0].lines[0].towers[2]!.hp = 0;
    expect(moveMinion(placed, 0, placed.players[0].minions[0]!.id, 0, 4)).toMatchObject({
      ok: false,
      reason: 'invalid-slot',
    });
  });

  it('verschiebt und nimmt auch für Spieler 1 zurück, ohne die Statistik des eigenen Spielers zu berühren', () => {
    const state = setup();
    state.players[1].hand = ['summon-minion', 'summon-minion'];
    state.players[1].energy = 8;
    const placed = playCard(state, 1, 0, 0, 0);
    if (!placed.ok) throw new Error(placed.reason);
    const id = placed.state.players[1].minions[0]!.id;
    const moved = moveMinion(placed.state, 1, id, 0, 2);
    expect(moved.ok).toBe(true);
    expect(moved.state.players[1].minions[0]).toMatchObject({ line: 0, slot: 2, position: 8 });
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

  it('kennt keine fremden oder toten Minions', () => {
    const state = playCard(setup(), 0, 0, 0, 0).state;
    expect(moveMinion(state, 0, 999, 0, 1)).toMatchObject({ ok: false, reason: 'no-such-minion' });
    expect(moveMinion(state, 1, state.players[0].minions[0]!.id, 0, 1)).toMatchObject({
      ok: false,
      reason: 'no-such-minion',
    });
    state.players[0].minions[0]!.hp = 0;
    expect(moveMinion(state, 0, state.players[0].minions[0]!.id, 0, 1)).toMatchObject({
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

  it('aktualisiert die Lane der Beschwörung dieser Runde in der Synergie-Liste', () => {
    const state = setup(2);
    openLane(state, 1);
    const placed = playCard(state, 0, 0, 0, 0).state;
    const moved = moveMinion(placed, 0, placed.players[0].minions[0]!.id, 1, 0).state;
    expect(moved.players[0].played[0]).toMatchObject({ line: 1 });
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
    state.players[0].minions.push({ id: 50, line: 0, slot: 0, position: 60, hp: 5, damage: 1, range: 4, speed: 10 });
    expect(undoSummon(state, 0, 50)).toMatchObject({ ok: false, reason: 'no-such-minion' });
  });
});

describe('Zeiger, Slot-Punkte und Einrasten', () => {
  // Lane-Index 0 = Start-Lane (Mitte), 1/2 = Lvl 2 oben/unten, 3/4 = Lvl 3 oben/unten.
  const geometry: LineGeometry = { laneCenters: [232, 162, 302, 92, 372], laneHalfHeight: 33, ownTowerX: 30, enemyTowerX: 330 };

  it('rechnet Position und x ineinander um', () => {
    for (const position of [0, 2, 14, 100]) {
      expect(xToPosition(positionToX(position, geometry), geometry)).toBeCloseTo(position);
    }
    expect(positionToX(0, geometry)).toBe(30);
    expect(positionToX(100, geometry)).toBe(330);
  });

  it('legt den oberen Slot über, den unteren unter die Lane-Mitte, beide am Tower', () => {
    const towers = [tower(0), tower(8)];
    expect(slotPoint(0, towers, 0, geometry)).toEqual({ line: 0, slot: 0, x: 30, y: 232 - SLOT_DY });
    expect(slotPoint(0, towers, 1, geometry)).toEqual({ line: 0, slot: 1, x: 30, y: 232 + SLOT_DY });
    expect(slotPoint(0, towers, 3, geometry)).toEqual({ line: 0, slot: 3, x: 54, y: 232 + SLOT_DY });
  });

  it('zeigt Punkte nur an freien Slots lebender Tower', () => {
    const player = createMatch(1).players[0];
    player.lines[0].towers[1]!.hp = 0;
    const occupied = [minion(0, 0)];
    const points = freeSlotPoints(player.lines, occupied, geometry);
    // Tower 1 ist zerstört (Slots 2, 3 fehlen), Slot 0 ist belegt; bleiben 1, 4, 5. Gesperrte Lanes haben keine Punkte.
    expect(points.map((p) => [p.line, p.slot])).toEqual([
      [0, 1],
      [0, 4],
      [0, 5],
    ]);
  });

  it('liefert Lane-Slots hinter dem Tower-Ende nur für freie Lanes ohne Lane-Karte', () => {
    const player = setup(2).players[0];
    player.lines[1].bought = true;
    player.lines[1].towers = [tower(0)];
    expect(freeLaneSlotPoints(player.lines, geometry).map((p) => p.line)).toEqual([0, 1]);
    player.lines[0].laneEffect = 'buff';
    expect(freeLaneSlotPoints(player.lines, geometry).map((p) => p.line)).toEqual([1]);
    player.lines[1].towers[0]!.hp = 0;
    expect(freeLaneSlotPoints(player.lines, geometry)).toEqual([]);
    expect(laneSlotPoint(0, geometry)).toEqual({ x: 30 - LANE_SLOT_GAP, y: 232 });
  });

  it('findet den nächsten Punkt und rastet nur in Reichweite ein', () => {
    const points = [
      { x: 30, y: 204, line: 0, slot: 0 },
      { x: 30, y: 260, line: 0, slot: 1 },
    ];
    expect(nearestPoint([], 0, 0)).toBeNull();
    expect(nearestPoint(points, 32, 210)?.point.slot).toBe(0);
    expect(nearestPoint(points, 32, 250)).toMatchObject({ point: { slot: 1 } });
    expect(snapTarget(points, 32, 210)?.slot).toBe(0);
    expect(snapTarget(points, 30, 204 - SNAP_RADIUS - 1)).toBeNull();
    expect(snapTarget(points, 30, 204 - SNAP_RADIUS)?.slot).toBe(0);
    expect(snapTarget(points, 300, 100)).toBeNull();
    expect(snapTarget([], 30, 204)).toBeNull();
  });

  it('wählt bei gleichem Abstand den ersten Punkt', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(nearestPoint(points, 5, 0)?.point).toBe(points[0]);
  });

  it('hebt einen Punkt stärker hervor, je näher der Zeiger ist', () => {
    expect(slotProximity(0)).toBe(1);
    expect(slotProximity(-5)).toBe(1);
    expect(slotProximity(GLOW_RADIUS)).toBe(0);
    expect(slotProximity(GLOW_RADIUS * 3)).toBe(0);
    expect(slotProximity(Number.NaN)).toBe(0);
    expect(slotProximity(20)).toBeGreaterThan(slotProximity(40));
    expect(slotProximity(40)).toBeGreaterThan(slotProximity(70));
    expect(slotProximity(40)).toBeGreaterThan(0);
  });

  it('rastet näher ein, als der Punkt zu glühen beginnt', () => {
    expect(SNAP_RADIUS).toBeLessThan(GLOW_RADIUS);
  });
});
