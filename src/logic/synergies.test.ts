import { describe, expect, it } from 'vitest';
import { CARD_DEFS } from './cards';
import { activeSynergies, type ActiveSynergy, describeSynergy, type PlayedCard, SYNERGY_DEFS, type SynergyDef, synergyBonus } from './synergies';

const archer = (line?: number): PlayedCard => ({ cardId: 'summon-archer', line });
const upgrade = (line?: number): PlayedCard => ({ cardId: 'line-upgrade', line });

describe('SYNERGY_DEFS', () => {
  it('verweist nur auf vorhandene Karten und hat eindeutige IDs', () => {
    const ids = new Set(CARD_DEFS.map((card) => card.id));
    for (const def of SYNERGY_DEFS) {
      expect(def.cards.every((id) => ids.has(id))).toBe(true);
    }
    expect(new Set(SYNERGY_DEFS.map((def) => def.id)).size).toBe(SYNERGY_DEFS.length);
  });

  it('enthält Bogenschütze + Lane +1 mit Reichweite +2 auf derselben Line', () => {
    expect(SYNERGY_DEFS[0]).toMatchObject({
      cards: ['summon-archer', 'line-upgrade'],
      condition: 'sameLine',
      modifier: { stat: 'range', amount: 2 },
    });
  });
});

describe('activeSynergies', () => {
  it('liefert ohne gespielte Karten nichts', () => {
    expect(activeSynergies([])).toEqual([]);
  });

  it('liefert für Bogenschütze und Upgrade auf derselben Line genau eine Synergie range +2', () => {
    const result = activeSynergies([archer(1), upgrade(1)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'archer-line-upgrade', line: 1, modifier: { stat: 'range', amount: 2 } });
  });

  it('liefert für verschiedene Lines keine Synergie', () => {
    expect(activeSynergies([archer(0), upgrade(1)])).toEqual([]);
  });

  it('ist unabhängig von der Reihenfolge', () => {
    expect(activeSynergies([upgrade(0), archer(0)])).toEqual(activeSynergies([archer(0), upgrade(0)]));
  });

  it('stapelt nicht bei mehrfach gespielten Karten', () => {
    const result = activeSynergies([archer(0), archer(0), upgrade(0), upgrade(0)]);
    expect(result).toHaveLength(1);
    expect(synergyBonus(result, 0, 'range')).toBe(2);
  });

  it('wertet jede Line einzeln aus und sortiert nach Line', () => {
    const result = activeSynergies([archer(2), archer(1), upgrade(1), upgrade(2)]);
    expect(result.map((s) => s.line)).toEqual([1, 2]);
  });

  it('lässt ein Upgrade ohne Lane-Ziel zu jeder Bogenschützen-Line passen', () => {
    const result = activeSynergies([archer(0), upgrade(), archer(2)]);
    expect(result.map((s) => s.line)).toEqual([0, 2]);
  });

  it('ignoriert Paare ganz ohne Lane', () => {
    expect(activeSynergies([archer(), upgrade()])).toEqual([]);
  });

  it('verlangt beide Karten', () => {
    expect(activeSynergies([archer(0)])).toEqual([]);
    expect(activeSynergies([upgrade(0)])).toEqual([]);
    expect(activeSynergies([{ cardId: 'summon-minion', line: 0 }, upgrade(0)])).toEqual([]);
  });

  describe('mit eigenen Definitionen', () => {
    const pair: SynergyDef = {
      id: 'pair',
      name: 'Paar',
      cards: ['a', 'a'],
      condition: 'anyLine',
      modifier: { stat: 'range', amount: 1 },
    };

    it('braucht bei gleichen Karten-IDs zwei gespielte Karten', () => {
      expect(activeSynergies([{ cardId: 'a', line: 0 }], [pair])).toEqual([]);
      expect(activeSynergies([{ cardId: 'a', line: 0 }, { cardId: 'a', line: 1 }], [pair])).toHaveLength(1);
    });

    it('gilt bei anyLine für alle Lines (line null) und höchstens einmal', () => {
      const result = activeSynergies([{ cardId: 'a', line: 0 }, { cardId: 'a', line: 1 }, { cardId: 'a', line: 2 }], [pair]);
      expect(result).toEqual([{ id: 'pair', name: 'Paar', line: null, modifier: { stat: 'range', amount: 1 } }]);
    });

    it('behält die Reihenfolge der Definitionen', () => {
      const other: SynergyDef = { ...pair, id: 'other', cards: ['b', 'b'] };
      const cards = [{ cardId: 'b' }, { cardId: 'b' }, { cardId: 'a' }, { cardId: 'a' }];
      expect(activeSynergies(cards, [pair, other]).map((s) => s.id)).toEqual(['pair', 'other']);
      expect(activeSynergies(cards, [other, pair]).map((s) => s.id)).toEqual(['other', 'pair']);
    });
  });
});

describe('describeSynergy', () => {
  it('nennt Namen und Bonus', () => {
    const [synergy] = activeSynergies([archer(0), upgrade(0)]);
    expect(describeSynergy(synergy!)).toBe('Fernkampf-Ausbau · Reichweite +2');
  });
});

describe('synergyBonus', () => {
  const synergy = (line: number | null, amount: number): ActiveSynergy => ({
    id: 'x',
    name: 'X',
    line,
    modifier: { stat: 'range', amount },
  });

  it('ist 0 ohne Synergien', () => {
    expect(synergyBonus([], 0, 'range')).toBe(0);
  });

  it('zählt nur die eigene Line und Synergien für alle Lines', () => {
    const list = [synergy(1, 2), synergy(null, 1)];
    expect(synergyBonus(list, 1, 'range')).toBe(3);
    expect(synergyBonus(list, 0, 'range')).toBe(1);
  });

  it('ignoriert andere Werte', () => {
    const other = { ...synergy(0, 5), modifier: { stat: 'other', amount: 5 } } as unknown as ActiveSynergy;
    expect(synergyBonus([other], 0, 'range')).toBe(0);
  });
});
