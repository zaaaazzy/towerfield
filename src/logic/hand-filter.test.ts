import { describe, expect, it } from 'vitest';
import type { CardType } from './cards';
import { HAND_FILTERS, type HandFilter, isCardVisible, nextHandFilter } from './hand-filter';

const EXPECTED: Record<HandFilter, CardType[]> = {
  all: ['summon', 'line-upgrade', 'minion-upgrade', 'minion-buff', 'lane-card', 'tower-upgrade', 'tower-specialize'],
  summon: ['summon'],
  upgrade: ['line-upgrade', 'minion-upgrade', 'minion-buff', 'lane-card'],
  tower: ['tower-upgrade', 'tower-specialize'],
};

describe('isCardVisible', () => {
  const types: CardType[] = [
    'summon',
    'line-upgrade',
    'minion-upgrade',
    'minion-buff',
    'lane-card',
    'tower-upgrade',
    'tower-specialize',
  ];
  for (const filter of HAND_FILTERS) {
    for (const type of types) {
      const expected = EXPECTED[filter].includes(type);
      it(`Filter ${filter}, Karte ${type}: ${expected ? 'sichtbar' : 'ausgeblendet'}`, () => {
        expect(isCardVisible(type, filter)).toBe(expected);
      });
    }
  }
});

describe('nextHandFilter', () => {
  it('schaltet Alle → Beschwörung → Upgrade → Tower → Alle', () => {
    expect(nextHandFilter('all')).toBe('summon');
    expect(nextHandFilter('summon')).toBe('upgrade');
    expect(nextHandFilter('upgrade')).toBe('tower');
    expect(nextHandFilter('tower')).toBe('all');
  });
});
