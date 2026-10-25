import { describe, expect, it } from 'vitest';
import type { Minion } from './combat';
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
      { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 10, amount: 6, source: 'melee' },
    ]);
    expect(diffFx(hurt, prev)).toEqual([]);
  });

  it('meldet Heilung nur, wenn ein Minion im Kampf HP zurückbekommt', () => {
    const hurt = withMinion();
    hurt.players[0].minions[0]!.hp = 20;
    const healed = structuredClone(hurt);
    healed.players[0].minions[0]!.hp = 26;
    expect(diffFx(hurt, healed)).toEqual([]);
    hurt.phase = 'combat';
    healed.phase = 'combat';
    expect(diffFx(hurt, healed)).toEqual([
      { kind: 'minion-heal', owner: 0, minionId: 1, line: 0, position: 10, amount: 6 },
    ]);
  });

  describe('Quelle des Schadens', () => {
    function duel(attacker: Partial<Minion>): { prev: MatchState; next: MatchState } {
      const prev = withMinion();
      prev.phase = 'combat';
      // Verteidiger (Spieler 0) bei 10, Angreifer (Spieler 1) bei 88: Abstand 2.
      prev.players[1].minions.push({ id: 9, line: 0, position: 88, hp: 30, damage: 6, range: 4, speed: 10, ...attacker });
      const next = structuredClone(prev);
      next.players[0].minions[0]!.hp = 24;
      return { prev, next };
    }

    it('Nahkämpfer in Reichweite ergeben Nahkampf', () => {
      const { prev, next } = duel({});
      expect(diffFx(prev, next)).toMatchObject([{ kind: 'minion-damage', source: 'melee' }]);
    });

    it('ein Gegner mit Fernkampf-Reichweite ergibt einen Pfeil', () => {
      const { prev, next } = duel({ range: 20, position: 70 });
      expect(diffFx(prev, next)).toMatchObject([{ kind: 'minion-damage', source: 'arrow' }]);
    });

    it('ein Tower in Reichweite ohne Gegner-Minion schießt einen Pfeil', () => {
      const prev = withMinion();
      prev.phase = 'combat';
      prev.players[0].minions[0]!.position = 90;
      const next = structuredClone(prev);
      next.players[0].minions[0]!.hp = 24;
      expect(diffFx(prev, next)).toMatchObject([{ kind: 'minion-damage', source: 'arrow' }]);
    });

    it('ein Blitz-Turm in Reichweite ergibt Blitz, auch neben einem Nahkämpfer', () => {
      const { prev, next } = duel({});
      prev.players[0].minions[0]!.position = 90;
      next.players[0].minions[0]!.position = 90;
      prev.players[1].lines[0]!.towers[0]!.specialization = 'lightning';
      expect(diffFx(prev, next)).toMatchObject([{ kind: 'minion-damage', source: 'lightning' }]);
    });

    it('ein gefallener Blitz-Turm und ein Heiler als Gegner zählen nicht als Quelle', () => {
      const { prev, next } = duel({ heals: true });
      prev.players[1].lines[0]!.towers[0]!.specialization = 'lightning';
      prev.players[1].lines[0]!.towers[0]!.hp = 0;
      expect(diffFx(prev, next)).toMatchObject([{ kind: 'minion-damage', source: 'melee' }]);
    });
  });

  it('meldet einen Schild-Block, wenn ein Schild-Turm getroffen wird oder sein Schild im Kampf Schaden auffängt', () => {
    const prev = createMatch(1);
    prev.phase = 'combat';
    prev.players[1].lines[0]!.towers[0]!.specialization = 'shield';
    const hit = structuredClone(prev);
    hit.players[1].lines[0]!.towers[0]!.hp -= 4;
    expect(diffFx(prev, hit)).toEqual([
      { kind: 'tower-damage', owner: 1, line: 0, tower: 0, amount: 4 },
      { kind: 'shield-block', owner: 1, line: 0, tower: 0 },
    ]);

    const shielded = structuredClone(prev);
    shielded.players[1].lines[0]!.towers[0]!.specialization = undefined;
    shielded.players[1].lines[0]!.towers[0]!.shield = 10;
    const absorbed = structuredClone(shielded);
    absorbed.players[1].lines[0]!.towers[0]!.shield = 6;
    expect(diffFx(shielded, absorbed)).toEqual([{ kind: 'shield-block', owner: 1, line: 0, tower: 0 }]);

    // Verfällt das Schild nach dem Kampf, ist das kein Block.
    const planning = structuredClone(absorbed);
    planning.phase = 'planning';
    delete planning.players[1].lines[0]!.towers[0]!.shield;
    expect(diffFx(absorbed, planning).some((event) => event.kind === 'shield-block')).toBe(false);
  });

  it('meldet Rundenstart, Rundenende und Spielende', () => {
    const planning = createMatch(1);
    const combat = structuredClone(planning);
    combat.phase = 'combat';
    combat.round = 3;
    expect(diffFx(planning, combat)).toEqual([{ kind: 'round-start', round: 3 }]);

    const after = structuredClone(combat);
    after.phase = 'planning';
    expect(diffFx(combat, after)).toEqual([{ kind: 'round-end', round: 3 }]);

    const over = structuredClone(combat);
    over.phase = 'over';
    over.outcome = 'player1';
    expect(diffFx(combat, over)).toEqual([{ kind: 'match-over', outcome: 'player1' }]);
    expect(diffFx(over, structuredClone(over))).toEqual([]);
  });

  it('meldet den Tod nur im Kampf, nicht beim Zurücknehmen in der Planung', () => {
    const prev = withMinion();
    const next = structuredClone(prev);
    next.players[0].minions = [];
    expect(diffFx(prev, next)).toEqual([]);
    prev.phase = 'combat';
    next.phase = 'combat';
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
