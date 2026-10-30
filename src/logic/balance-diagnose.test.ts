/**
 * Beleg zur Abweichung von `tower-lightning` und `tower-shield` im Messlauf (Seed 1, 1000 Matches). Ergebnis und
 * Schlussfolgerung: docs/anwendung-balance-cli.md, Abschnitt „Ursache der Abweichung“. Die Tests halten fest, was dort
 * steht, damit die Doku nicht still veraltet.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, strategiesForSeed } from './balance-sim';
import { botStep } from './bot';
import { TICK_MS } from './combat';
import { SPECIALIZE_MIN_LEVEL } from './balance-config';
import { advance, COMBAT_TICKS, createMatch, type MatchState, type PlayerIndex, setReady } from './match';

const SPECIALIZATIONS = ['tower-lightning', 'tower-shield'];
const SEED = 1;
const COUNT = 1000;

/** Siegquote von Spielern, die am Ende eine Lane ab Lvl 2 besitzen (`buyer`), und von allen übrigen. */
function laneBuyerWinRates(): { buyers: number; buyerWinRate: number; otherWinRate: number } {
  const stats = { buyers: { n: 0, wins: 0 }, others: { n: 0, wins: 0 } };
  for (let seed = SEED; seed < SEED + COUNT; seed += 1) {
    const strategies = strategiesForSeed(seed);
    let state: MatchState = createMatch(seed);
    while (state.phase !== 'over') {
      if (state.phase === 'planning') {
        for (const index of [0, 1] as PlayerIndex[]) {
          for (let move = botStep(state, index, strategies[index]); move; move = botStep(state, index, strategies[index])) {
            state = move.state;
          }
          state = setReady(state, index);
        }
      } else {
        state = advance(state, COMBAT_TICKS * TICK_MS);
      }
    }
    for (const index of [0, 1] as PlayerIndex[]) {
      const group = state.players[index].lines.slice(1).some((line) => line.bought) ? stats.buyers : stats.others;
      group.n += 1;
      if (state.outcome === (index === 0 ? 'player0' : 'player1')) group.wins += 1;
    }
  }
  return {
    buyers: stats.buyers.n,
    buyerWinRate: stats.buyers.wins / stats.buyers.n,
    otherWinRate: stats.others.wins / stats.others.n,
  };
}

describe('Beleg: warum Blitz- und Schild-Turm unter der Basis liegen (Seed 1, 1000 Matches)', () => {
  const report = runSimulation({ startSeed: SEED, count: COUNT });
  const specs = report.cards.filter((card) => SPECIALIZATIONS.includes(card.cardId));

  it('spielt sie nur auf Lanes ab dem Mindest-Level, nie auf der Start-Lane', () => {
    expect(specs).toHaveLength(2);
    for (const { plays, timing } of specs) {
      expect(plays).toBeGreaterThan(0);
      expect(timing.playsByLaneLevel.slice(0, SPECIALIZE_MIN_LEVEL - 1).every((n) => n === 0)).toBe(true);
      expect(timing.playsByLaneLevel.reduce((sum, n) => sum + n, 0)).toBe(plays);
    }
  });

  it('spielt sie frühestens in Runde 3 und im Mittel nicht „zu spät“ (vor Runde 6)', () => {
    for (const { timing } of specs) {
      expect(timing.playsByRound.slice(0, 2).every((n) => n === 0)).toBe(true);
      expect(timing.avgPlayRound).toBeGreaterThanOrEqual(3);
      expect(timing.avgPlayRound).toBeLessThan(6);
    }
  });

  it('lässt sie meist ungespielt: Abwürfe und Handreste übersteigen die Einsätze deutlich', () => {
    for (const { plays, timing } of specs) expect(timing.discards + timing.held).toBeGreaterThan(2 * plays);
  });

  it('schlägt die Karten fast nur Spieler, die eine Lane gekauft haben, und diese Spieler verlieren meist', () => {
    const { buyers, buyerWinRate, otherWinRate } = laneBuyerWinRates();
    const maxPlays = Math.max(...specs.map((card) => card.matchesWithCard));
    expect(maxPlays).toBeLessThanOrEqual(buyers);
    expect(buyerWinRate).toBeLessThan(otherWinRate - 0.2);
  }, 120_000);
});
