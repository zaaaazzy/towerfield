import { describe, expect, it } from 'vitest';
import { createStats, recordDamage, recordMove, recordSummon, recordUndo, summarizeStats } from './match-stats';

describe('summarizeStats', () => {
  it('liefert für eine leere Statistik Nullen', () => {
    expect(summarizeStats(createStats())).toEqual({ summoned: 0, minionDamage: 0, towerDamage: 0, topCardId: null });
  });

  it('summiert Beschwörungen und Schaden und nennt die stärkste Karte', () => {
    const stats = createStats();
    recordSummon(stats, 1, 'summon-minion', 0);
    recordSummon(stats, 2, 'summon-minion', 1);
    recordSummon(stats, 3, 'summon-brute', 0);
    recordDamage(stats, 1, 'minion', 10.4);
    recordDamage(stats, 3, 'minion', 20);
    recordDamage(stats, 3, 'tower', 5.2);
    recordDamage(stats, 2, 'tower', 5);
    recordSummon(stats, 4, 'summon-archer', 0);
    recordDamage(stats, 4, 'minion', 0.4);
    expect(summarizeStats(stats)).toEqual({ summoned: 4, minionDamage: 31, towerDamage: 10, topCardId: 'summon-brute' });
  });
});

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
