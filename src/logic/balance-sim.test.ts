import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  type MatchResult,
  playEvent,
  runSimulation,
  shuffledPriority,
  simulateMatch,
  strategiesForSeed,
} from './balance-sim';
import { botStep, ECONOMY_ACTIONS } from './bot';
import { CARD_DEFS } from './cards';
import { MAX_FIELD_LEVEL } from './lanes';
import { createLaneTowers, createMatch, MAX_ROUNDS } from './match';
import { EVENT_INTERVAL } from './round-events';

const ids = CARD_DEFS.map((def) => def.id);

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

describe('Zeitpunkt der Karten (Runde und Level)', () => {
  const fresh = () => createMatch(1);

  describe('playEvent', () => {
    it('zählt das Feld-Upgrade als Einsatz von line-upgrade mit Runde und Feldstufe', () => {
      const state = fresh();
      const move = botStep(state, 0, ['upgrade'])!;
      expect(playEvent(state, 0, move)).toEqual({ cardId: 'line-upgrade', round: 1, fieldLevel: 1 });
    });

    it('liefert für Lane-Kauf und Ziehen keinen Eintrag', () => {
      const state = fresh();
      state.players[0].level = 2;
      state.players[0].energy = 10;
      const buy = botStep(state, 0, ['buy-lane'])!;
      expect(buy.economy).toBe('buy-lane');
      expect(playEvent(state, 0, buy)).toBeUndefined();
      const draw = botStep(state, 0, ['draw'])!;
      expect(draw.economy).toBe('draw');
      expect(playEvent(state, 0, draw)).toBeUndefined();
    });

    it('nennt bei einer Karte mit Lane-Ziel das Lane-Level, bei einer Spezialisierung das der Ziel-Lane', () => {
      const start = fresh();
      start.players[0].hand = ['summon-minion'];
      expect(playEvent(start, 0, botStep(start, 0, ['summon-minion'])!)).toEqual({
        cardId: 'summon-minion',
        round: 1,
        fieldLevel: 1,
        laneLevel: 1,
      });

      const grown = fresh();
      const player = grown.players[0];
      player.level = 2;
      player.energy = 5;
      player.hand = ['tower-lightning'];
      player.lines[1] = { bought: true, towers: createLaneTowers(1), bonus: { hp: 0, damage: 0 } };
      expect(playEvent(grown, 0, botStep(grown, 0, ['tower-lightning'])!)).toEqual({
        cardId: 'tower-lightning',
        round: 1,
        fieldLevel: 2,
        laneLevel: 2,
      });
    });

    it('lässt das Lane-Level bei Karten ohne Lane-Ziel weg', () => {
      const state = fresh();
      state.players[0].energy = 5;
      state.players[0].hand = ['minion-upgrade-all'];
      const event = playEvent(state, 0, botStep(state, 0, ['minion-upgrade-all'])!)!;
      expect(event).toEqual({ cardId: 'minion-upgrade-all', round: 1, fieldLevel: 1 });
      expect('laneLevel' in event).toBe(false);
    });

    it('markiert einen Abwurf und nennt kein Lane-Level', () => {
      const state = fresh();
      state.players[0].energy = 1;
      state.players[0].hand = ['tower-lightning', 'summon-brute'];
      const move = botStep(state, 0, ['summon-brute'])!;
      expect(move.discard).toBe(true);
      expect(playEvent(state, 0, move)).toEqual({ cardId: 'tower-lightning', round: 1, fieldLevel: 1, discard: true });
    });
  });

  describe('simulateMatch', () => {
    it('führt Protokoll und Handreste, die zu played passen', () => {
      for (const seed of [1, 2, 3]) {
        const match = simulateMatch(seed, strategiesForSeed(seed));
        for (const index of [0, 1] as const) {
          const log = match.log![index];
          expect(log.filter((entry) => !entry.discard).map((entry) => entry.cardId)).toEqual(match.played[index]);
          for (const entry of log) {
            expect(entry.round).toBeGreaterThanOrEqual(1);
            expect(entry.round).toBeLessThanOrEqual(match.rounds);
            expect(entry.fieldLevel).toBeGreaterThanOrEqual(1);
            expect(entry.fieldLevel).toBeLessThanOrEqual(MAX_FIELD_LEVEL);
            if (entry.laneLevel !== undefined) expect(entry.laneLevel).toBeGreaterThanOrEqual(1);
          }
          for (let i = 1; i < log.length; i += 1) expect(log[i]!.round).toBeGreaterThanOrEqual(log[i - 1]!.round);
          for (const id of match.held![index]) expect(ids).toContain(id);
        }
      }
    });

    it('zählt das Feld-Upgrade als Einsatz von line-upgrade', () => {
      const match = simulateMatch(1, strategiesForSeed(1));
      const upgrades = match.log!.flat().filter((entry) => entry.cardId === 'line-upgrade');
      expect(upgrades.length).toBeGreaterThan(0);
      expect(upgrades.every((entry) => entry.laneLevel === undefined && !entry.discard)).toBe(true);
    });
  });

  describe('buildReport', () => {
    const logged = buildReport(
      [
        result({
          outcome: 'player0',
          rounds: 6,
          played: [['tower-lightning', 'tower-lightning'], []],
          log: [
            [
              { cardId: 'tower-lightning', round: 3, fieldLevel: 2, laneLevel: 2 },
              { cardId: 'tower-lightning', round: 4, fieldLevel: 3, discard: true },
              { cardId: 'tower-lightning', round: 5, fieldLevel: 3, laneLevel: 3 },
            ],
            [],
          ],
          held: [['tower-lightning'], ['summon-minion']],
        }),
      ],
      1,
    );
    const lightning = logged.cards.find((card) => card.cardId === 'tower-lightning')!.timing;

    it('zählt Einsätze je Runde, Lane-Level und Feldstufe sowie die mittlere Runde', () => {
      expect(lightning.playsByRound).toEqual([0, 0, 1, 0, 1, 0, 0, 0]);
      expect(lightning.playsByLaneLevel).toEqual([0, 1, 1]);
      expect(lightning.playsByFieldLevel).toEqual([0, 1, 1]);
      expect(lightning.avgPlayRound).toBe(4);
    });

    it('zählt Abwürfe getrennt von Einsätzen und die Hand am Ende', () => {
      expect(lightning.discards).toBe(1);
      expect(lightning.discardsByRound).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
      expect(lightning.held).toBe(1);
      expect(logged.cards.find((card) => card.cardId === 'summon-minion')!.timing.held).toBe(1);
    });

    it('liefert ohne Protokoll leere Zähler und die mittlere Runde 0', () => {
      const timing = buildReport([result({ outcome: 'draw', rounds: 3 })], 1).cards[0]!.timing;
      expect(timing.playsByRound).toEqual(Array(MAX_ROUNDS).fill(0));
      expect(timing.playsByLaneLevel).toEqual(Array(MAX_FIELD_LEVEL).fill(0));
      expect(timing).toMatchObject({ avgPlayRound: 0, discards: 0, held: 0 });
    });

    it('weist line-upgrade im Messlauf als gespielt aus (Feld-Upgrade), mit Runde ab 1', () => {
      const report = runSimulation({ startSeed: 1, count: 30 });
      const upgrade = report.cards.find((card) => card.cardId === 'line-upgrade')!;
      expect(upgrade.matchesWithCard).toBeGreaterThan(0);
      expect(upgrade.timing.playsByRound.reduce((sum, n) => sum + n, 0)).toBe(upgrade.plays);
      expect(upgrade.timing.playsByRound[0]).toBeGreaterThan(0);
    });
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
