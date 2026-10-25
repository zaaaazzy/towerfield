import { describe, expect, it } from 'vitest';
import { createStats, recordDamage, recordMove, recordSummon, recordUndo } from './match-stats';

describe('Match-Statistik', () => {
  it('startet leer', () => {
    expect(createStats()).toEqual({ played: {}, damage: {}, cardByMinion: {} });
  });

  it('zählt Beschwörungen pro Karte und Line', () => {
    const stats = createStats();
    recordSummon(stats, 1, 'summon-minion', 1);
    recordSummon(stats, 2, 'summon-minion', 1);
    recordSummon(stats, 3, 'summon-archer', 0);
    expect(stats.played['summon-minion']).toEqual([0, 2]);
    expect(stats.played['summon-archer']).toEqual([1]);
  });

  it('nimmt Beschwörungen zurück und fällt nie unter 0', () => {
    const stats = createStats();
    recordSummon(stats, 1, 'summon-minion', 1);
    recordUndo(stats, 1, 1);
    recordUndo(stats, 1, 1);
    expect(stats.played['summon-minion']).toEqual([0, 0]);
    expect(stats.cardByMinion[1]).toBeUndefined();
  });

  it('verschiebt die Zählung auf die neue Line', () => {
    const stats = createStats();
    recordSummon(stats, 1, 'summon-minion', 0);
    recordMove(stats, 1, 0, 2);
    expect(stats.played['summon-minion']).toEqual([0, 0, 1]);
  });

  it('rechnet Schaden dem Kartentyp zu und trennt Minion- und Tower-Schaden', () => {
    const stats = createStats();
    recordSummon(stats, 1, 'summon-brute', 0);
    recordDamage(stats, 1, 'minion', 2.5);
    recordDamage(stats, 1, 'tower', 4);
    recordDamage(stats, 99, 'minion', 10);
    expect(stats.damage).toEqual({ 'summon-brute': { minionDamage: 2.5, towerDamage: 4 } });
  });
});
