import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  levelsForSeed,
  type MatchResult,
  runSimulation,
  shuffledPriority,
  simulateMatch,
  strategiesForSeed,
} from './balance-sim';
import { ECONOMY_ACTIONS } from './bot';
import { CARD_DEFS } from './cards';
import { MAX_ROUNDS } from './match';
import { EVENT_INTERVAL } from './round-events';

const ids = CARD_DEFS.map((def) => def.id);

describe('Stufenvergleich Leicht gegen Normal', () => {
  it('wechselt die Seiten je Seed', () => {
    expect(levelsForSeed(2)).toEqual(['easy', 'normal']);
    expect(levelsForSeed(3)).toEqual(['normal', 'easy']);
    expect(levelsForSeed(0)).toEqual(['easy', 'normal']);
  });

  it('simulateMatch ohne Stufen bleibt Leicht gegen Leicht und trägt keine Stufen ein', () => {
    const plain = simulateMatch(5, strategiesForSeed(5));
    expect(plain).not.toHaveProperty('levels');
    expect(simulateMatch(5, strategiesForSeed(5), ['easy', 'easy']).played).toEqual(plain.played);
  });

  it('simuliert Matches mit beiden Stufen und ist reproduzierbar', () => {
    const levels = levelsForSeed(4);
    const match = simulateMatch(4, strategiesForSeed(4), levels);
    expect(match.levels).toEqual(levels);
    expect(simulateMatch(4, strategiesForSeed(4), levels)).toEqual(match);
    expect(['player0', 'player1', 'draw']).toContain(match.outcome);
  });

  it('der Bericht enthält Siegquoten für Leicht und Normal aus Matches mit beiden Stufen', () => {
    const report = runSimulation({ startSeed: 1, count: 40, compareLevels: true });
    const { easy, normal } = report.levelStats;
    expect(easy.matches).toBe(40);
    expect(normal.matches).toBe(40);
    expect(easy.wins + normal.wins).toBeLessThanOrEqual(40);
    expect(easy.winRate).toBeCloseTo(easy.wins / 40, 10);
    expect(normal.winRate).toBeCloseTo(normal.wins / 40, 10);
    expect(easy.winRate + normal.winRate + report.drawRate).toBeCloseTo(1, 10);
    expect(runSimulation({ startSeed: 1, count: 40, compareLevels: true })).toEqual(report);
  });

  it('beide Stufen kommen in den Ergebnissen vor, auf beiden Seiten', () => {
    const results = [1, 2, 3, 4].map((seed) => simulateMatch(seed, strategiesForSeed(seed), levelsForSeed(seed)));
    for (const index of [0, 1]) expect(new Set(results.map((r) => r.levels![index]))).toEqual(new Set(['easy', 'normal']));
  });

  it('zählt Siege und Remis je Stufe aus den Ergebnissen; gleiche Stufen und fehlende Stufen zählen nicht', () => {
    const report = buildReport(
      [
        result({ outcome: 'player0', rounds: 5, levels: ['easy', 'normal'] }),
        result({ outcome: 'player0', rounds: 5, levels: ['normal', 'easy'] }),
        result({ outcome: 'player1', rounds: 5, levels: ['normal', 'easy'] }),
        result({ outcome: 'draw', rounds: 5, levels: ['easy', 'normal'] }),
        result({ outcome: 'player0', rounds: 5, levels: ['normal', 'normal'] }),
        result({ outcome: 'player1', rounds: 5 }),
      ],
      0,
    );
    expect(report.levelStats.easy).toEqual({ matches: 4, wins: 2, winRate: 0.5 });
    expect(report.levelStats.normal).toEqual({ matches: 4, wins: 1, winRate: 0.25 });
  });

  it('ohne Stufenvergleich sind alle Quoten 0', () => {
    const empty = { easy: { matches: 0, wins: 0, winRate: 0 }, normal: { matches: 0, wins: 0, winRate: 0 } };
    expect(buildReport([], 0).levelStats).toEqual(empty);
    expect(runSimulation({ startSeed: 1, count: 5 }).levelStats).toEqual(empty);
  });
});

function result(partial: Partial<MatchResult> & Pick<MatchResult, 'outcome' | 'rounds'>): MatchResult {
  return { seed: 0, endedBy: 'round-limit', played: [[], []], ...partial };
}

describe('Ereignis-Zähler', () => {
  it('zählt je Ereignis die Häufigkeit und liefert bei gleichem Startseed dieselben Zähler', () => {
    const report = runSimulation({ startSeed: 1, count: 30 });
    expect(runSimulation({ startSeed: 1, count: 30 }).eventCounts).toEqual(report.eventCounts);
    expect(Object.keys(report.eventCounts).sort()).toEqual(['early-respawn', 'energy', 'tower-shield']);
    const total = Object.values(report.eventCounts).reduce((sum, value) => sum + value, 0);
    // Höchstens eine Ereignisrunde je EVENT_INTERVAL Runden und Match; Matches können früher enden.
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(30 * Math.floor(MAX_ROUNDS / EVENT_INTERVAL));
  });

  it('summiert die Ereignisse der Ergebnisse; ohne Ergebnisse ist alles 0', () => {
    const report = buildReport(
      [
        result({ outcome: 'draw', rounds: 8, events: ['energy', 'tower-shield'] }),
        result({ outcome: 'draw', rounds: 3, events: ['energy'] }),
      ],
      0,
    );
    expect(report.eventCounts).toEqual({ energy: 2, 'early-respawn': 0, 'tower-shield': 1 });
    expect(buildReport([], 0).eventCounts).toEqual({ energy: 0, 'early-respawn': 0, 'tower-shield': 0 });
  });

  it('simulateMatch meldet nur Ereignisse der tatsächlich gespielten Runden', () => {
    const match = simulateMatch(3, strategiesForSeed(3));
    expect(match.events!.length).toBeLessThanOrEqual(Math.floor(match.rounds / EVENT_INTERVAL));
  });
});

describe('Strategien', () => {
  it('würfeln eine Reihenfolge aus allen Karten-IDs und Wirtschaftsaktionen, reproduzierbar je Seed', () => {
    expect([...shuffledPriority(5)].sort()).toEqual([...ids, ...ECONOMY_ACTIONS].sort());
    expect(shuffledPriority(5)).toEqual(shuffledPriority(5));
    expect(strategiesForSeed(7)).toEqual(strategiesForSeed(7));
  });

  it('lassen die Simulation mit jeder gewürfelten Reihenfolge enden und zählen nur gespielte Karten', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const match = simulateMatch(seed, strategiesForSeed(seed));
      expect(match.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(match.played[0].every((id) => ids.includes(id))).toBe(true);
    }
  });

  it('unterscheiden sich zwischen Seeds und Spielern', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 10; seed += 1) for (const order of strategiesForSeed(seed)) orders.add(order.join());
    expect(orders.size).toBeGreaterThan(10);
  });
});

describe('simulateMatch', () => {
  it('liefert bei gleichem Seed und gleichen Strategien dasselbe Ergebnis', () => {
    for (const seed of [1, 2, 3]) {
      expect(simulateMatch(seed, strategiesForSeed(seed))).toEqual(simulateMatch(seed, strategiesForSeed(seed)));
    }
  });

  it('beendet jedes Match innerhalb von MAX_ROUNDS Runden', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const match = simulateMatch(seed, strategiesForSeed(seed));
      expect(match.rounds).toBeGreaterThanOrEqual(1);
      expect(match.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(['player0', 'player1', 'draw']).toContain(match.outcome);
      if (match.rounds < MAX_ROUNDS) expect(match.endedBy).toBe('towers');
    }
  });

  it('erfasst die gespielten Karten', () => {
    const match = simulateMatch(3, strategiesForSeed(3));
    for (const cards of match.played) {
      expect(cards.length).toBeGreaterThan(0);
      for (const id of cards) expect(ids).toContain(id);
    }
  });

  it('nutzt die Strategie: ohne Karten in der Reihenfolge wird nichts gespielt', () => {
    const match = simulateMatch(3, [[], strategiesForSeed(3)[1]]);
    expect(match.played[0]).toEqual([]);
    expect(match.played[1].length).toBeGreaterThan(0);
  });
});

describe('runSimulation', () => {
  it('liefert totalMatches === count und Quoten, die 1 ergeben', () => {
    const report = runSimulation({ startSeed: 1, count: 12 });
    expect(report.totalMatches).toBe(12);
    expect(report.winRatePlayer0 + report.winRatePlayer1 + report.drawRate).toBeCloseTo(1, 10);
    expect(report.avgRounds).toBeGreaterThanOrEqual(1);
    expect(report.avgRounds).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(report.towerKillShare + report.roundLimitShare).toBeCloseTo(1, 10);
  });

  it('spielt den Zerstörer und endet ohne Remis', () => {
    const report = runSimulation({ startSeed: 1, count: 20 });
    const destroyer = report.cards.find((card) => card.cardId === 'summon-destroyer');
    expect(destroyer?.plays).toBeGreaterThan(0);
    expect(report.drawRate).toBe(0);
  });

  it('ist reproduzierbar und hängt vom Seed-Bereich ab', () => {
    const a = runSimulation({ startSeed: 10, count: 6 });
    expect(runSimulation({ startSeed: 10, count: 6 })).toEqual(a);
    expect(runSimulation({ startSeed: 1000, count: 6 })).not.toEqual(a);
  });

  it('schafft 200 Matches in angemessener Zeit', () => {
    const start = Date.now();
    const report = runSimulation({ startSeed: 1, count: 200 });
    expect(report.totalMatches).toBe(200);
    expect(Date.now() - start).toBeLessThan(20_000);
  }, 30_000);

  it('ist mit 1000 Matches deterministisch, zählt 1000 und die Quoten ergeben 1', () => {
    const start = Date.now();
    const report = runSimulation({ startSeed: 1, count: 1000 });
    expect(runSimulation({ startSeed: 1, count: 1000 })).toEqual(report);
    expect(report.totalMatches).toBe(1000);
    expect(report.startSeed).toBe(1);
    expect(report.winRatePlayer0 + report.winRatePlayer1 + report.drawRate).toBeCloseTo(1, 10);
    expect(report.towerKillShare + report.roundLimitShare).toBeCloseTo(1, 10);
    expect(Date.now() - start).toBeLessThan(60_000);
  }, 90_000);
});

describe('buildReport', () => {
  it('enthält jede Karte, auch ohne Einsatz und ohne Matches, ohne NaN', () => {
    for (const report of [buildReport([], 1), buildReport([result({ outcome: 'draw', rounds: 3 })], 1)]) {
      expect(report.cards.map((card) => card.cardId)).toEqual(ids);
      for (const value of [...Object.values(report), ...report.cards.flatMap((card) => Object.values(card))]) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(buildReport([], 1).totalMatches).toBe(0);
  });

  it('rechnet ein kleines Beispiel von Hand nach', () => {
    const report = buildReport(
      [
        result({ outcome: 'player0', rounds: 2, endedBy: 'towers', played: [['summon-minion', 'summon-minion'], ['tower-hp']] }),
        result({ outcome: 'player1', rounds: 8, played: [['summon-minion'], ['tower-hp', 'summon-minion']] }),
        result({ outcome: 'draw', rounds: 5, played: [[], ['summon-minion']] }),
        result({ outcome: 'player0', rounds: 5, endedBy: 'towers', played: [['tower-hp'], []] }),
      ],
      42,
    );
    expect(report.startSeed).toBe(42);
    expect(report.totalMatches).toBe(4);
    expect(report.avgRounds).toBe(5);
    expect(report.minRounds).toBe(2);
    expect(report.maxRounds).toBe(8);
    expect(report.winRatePlayer0).toBe(0.5);
    expect(report.winRatePlayer1).toBe(0.25);
    expect(report.drawRate).toBe(0.25);
    expect(report.towerKillShare).toBe(0.5);
    // 3 Siege in 8 Spieler-Matches.
    expect(report.baselineWinRate).toBe(3 / 8);

    // summon-minion: P0 in Match 1 (Sieg, 2 Einsätze), P0 in Match 2 (Niederlage), P1 in Match 2 (Sieg), P1 in Match 3 (Remis).
    const minion = report.cards.find((card) => card.cardId === 'summon-minion')!;
    expect(minion.matchesWithCard).toBe(4);
    expect(minion.plays).toBe(5);
    expect(minion.winRate).toBe(0.5);
    expect(minion.drawRate).toBe(0.25);
    expect(minion.lossRate).toBe(0.25);
    expect(minion.deltaToBaseline).toBeCloseTo(0.5 - 3 / 8, 10);
    const unused = report.cards.find((card) => card.cardId === 'minion-upgrade-all')!;
    expect(unused).toMatchObject({ matchesWithCard: 0, plays: 0, winRate: 0, deltaToBaseline: 0 });
  });
});

describe('Quelltext von balance-sim.ts', () => {
  const source = readFileSync(new URL('./balance-sim.ts', import.meta.url), 'utf8');

  it('importiert weder phaser noch DOM und nutzt kein Math.random', () => {
    expect(source).not.toMatch(/from 'phaser'/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\b(document|window)\./);
  });
});
