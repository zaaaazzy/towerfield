import { describe, expect, it } from 'vitest';
import { diffFx } from './fx-events';
import { createMatch, type MatchState } from './match';

function withMinion(): MatchState {
  const state = createMatch(1);
  state.players[0].minions.push({ id: 1, line: 0, position: 10, hp: 30, damage: 6, range: 4, speed: 10 });
  return state;
}

describe('diffFx', () => {
  it('meldet nichts, wenn sich nichts ändert', () => {
    const state = withMinion();
    expect(diffFx(state, structuredClone(state))).toEqual([]);
  });

  it('meldet eine Beschwörung für einen neuen Minion', () => {
    const prev = createMatch(1);
    const next = withMinion();
    expect(diffFx(prev, next)).toEqual([{ kind: 'summon', owner: 0, minionId: 1, line: 0, position: 10 }]);
  });

  it('meldet Schaden an einem Minion, aber keine Heilung', () => {
    const prev = withMinion();
    const hurt = structuredClone(prev);
    hurt.players[0].minions[0]!.hp = 24;
    expect(diffFx(prev, hurt)).toEqual([
      { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 10, amount: 6 },
    ]);
    expect(diffFx(hurt, prev)).toEqual([]);
  });

  it('meldet den Tod nur im Kampf, nicht beim Zurücknehmen in der Planung', () => {
    const prev = withMinion();
    const next = structuredClone(prev);
    next.players[0].minions = [];
    expect(diffFx(prev, next)).toEqual([]);
    prev.phase = 'combat';
    expect(diffFx(prev, next)).toEqual([{ kind: 'minion-death', owner: 0, minionId: 1, line: 0, position: 10 }]);
  });

  it('meldet für einen gestorbenen Zerstörer zusätzlich eine Explosion mit Radius, andere nicht', () => {
    const prev = withMinion();
    prev.phase = 'combat';
    prev.players[0].minions.push({
      id: 2,
      line: 1,
      position: 30,
      hp: 5,
      damage: 8,
      range: 4,
      speed: 8,
      explodes: { radius: 10, damage: 15 },
    });
    const next = structuredClone(prev);
    next.players[0].minions = [];
    expect(diffFx(prev, next)).toEqual([
      { kind: 'minion-death', owner: 0, minionId: 1, line: 0, position: 10 },
      { kind: 'minion-death', owner: 0, minionId: 2, line: 1, position: 30 },
      { kind: 'explosion', owner: 0, minionId: 2, line: 1, position: 30, radius: 10 },
    ]);
  });

  it('meldet keine Explosion, wenn der Zerstörer in der Planung zurückgenommen wird', () => {
    const prev = withMinion();
    prev.players[0].minions[0]!.explodes = { radius: 10, damage: 15 };
    const next = structuredClone(prev);
    next.players[0].minions = [];
    expect(diffFx(prev, next)).toEqual([]);
  });

  it('meldet im Kampf keinen Tod für Minions, die noch leben', () => {
    const prev = withMinion();
    prev.phase = 'combat';
    expect(diffFx(prev, structuredClone(prev))).toEqual([]);
  });

  it('meldet Turmschaden und den Fall eines Towers samt Tower-Index auf der Lane', () => {
    const prev = createMatch(1);
    const hurt = structuredClone(prev);
    hurt.players[1].lines[0]!.towers[2]!.hp -= 12;
    expect(diffFx(prev, hurt)).toEqual([{ kind: 'tower-damage', owner: 1, line: 0, tower: 2, amount: 12 }]);

    const down = structuredClone(prev);
    down.players[1].lines[0]!.towers[1]!.hp = 0;
    expect(diffFx(prev, down)).toEqual([
      { kind: 'tower-damage', owner: 1, line: 0, tower: 1, amount: prev.players[1].lines[0]!.towers[1]!.hp },
      { kind: 'tower-down', owner: 1, line: 0, tower: 1 },
    ]);
  });

  it('unterscheidet die drei Tower der Start-Lane', () => {
    const prev = createMatch(1);
    const next = structuredClone(prev);
    next.players[0].lines[0]!.towers[0]!.hp -= 1;
    next.players[0].lines[0]!.towers[2]!.hp -= 3;
    expect(diffFx(prev, next)).toEqual([
      { kind: 'tower-damage', owner: 0, line: 0, tower: 0, amount: 1 },
      { kind: 'tower-damage', owner: 0, line: 0, tower: 2, amount: 3 },
    ]);
  });

  it('meldet für eine frisch freigeschaltete Lane keinen Turmschaden', () => {
    const prev = createMatch(1);
    const next = structuredClone(prev);
    next.players[0].level = 2;
    next.players[0].lines[1]!.towers = [{ offset: 0, hp: 100, maxHp: 100, damage: 8 }];
    expect(diffFx(prev, next)).toEqual([]);
  });

  it('verändert die Eingaben nicht', () => {
    const prev = withMinion();
    const next = structuredClone(prev);
    next.players[1].lines[0]!.towers[0]!.hp -= 5;
    const snapshot = structuredClone({ prev, next });
    diffFx(prev, next);
    expect({ prev, next }).toEqual(snapshot);
  });
});
