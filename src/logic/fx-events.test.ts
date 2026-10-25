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

  it('meldet Turmschaden und den Fall eines Towers', () => {
    const prev = createMatch(1);
    const hurt = structuredClone(prev);
    hurt.players[1].lines[2]!.tower.hp -= 12;
    expect(diffFx(prev, hurt)).toEqual([{ kind: 'tower-damage', owner: 1, line: 2, amount: 12 }]);

    const down = structuredClone(prev);
    down.players[1].lines[2]!.tower.hp = 0;
    expect(diffFx(prev, down)).toEqual([
      { kind: 'tower-damage', owner: 1, line: 2, amount: prev.players[1].lines[2]!.tower.hp },
      { kind: 'tower-down', owner: 1, line: 2 },
    ]);
  });

  it('verändert die Eingaben nicht', () => {
    const prev = withMinion();
    const next = structuredClone(prev);
    next.players[1].lines[0]!.tower.hp -= 5;
    const snapshot = structuredClone({ prev, next });
    diffFx(prev, next);
    expect({ prev, next }).toEqual(snapshot);
  });
});
