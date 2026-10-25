import { expect, it } from 'vitest';
import { runSimulation } from './balance-sim';

it('Balance-Simulation spielt den Zerstörer und endet ohne Remis', () => {
  const report = runSimulation({ startSeed: 1, count: 20 });
  const destroyer = report.cards.find((card) => card.cardId === 'summon-destroyer');
  expect(destroyer?.plays).toBeGreaterThan(0);
  expect(report.drawRate).toBe(0);
});
