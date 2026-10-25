import { describe, expect, it } from 'vitest';
import { CARD_DEFS, type CardDef, type CardType, getCardDef } from './cards';
import { CARD_TYPE_STYLES, cardTypeStyle, describeCard } from './card-style';

const TYPES: CardType[] = ['line-upgrade', 'tower-upgrade', 'summon', 'minion-upgrade'];

describe('cardTypeStyle', () => {
  it('kennt alle vier Kartentypen', () => {
    for (const type of TYPES) expect(cardTypeStyle(type)).toBe(CARD_TYPE_STYLES[type]);
  });

  it('unterscheidet die Typen nach Rahmenfarbe und Symbol', () => {
    const accents = new Set(TYPES.map((type) => cardTypeStyle(type).accent));
    const symbols = new Set(TYPES.map((type) => cardTypeStyle(type).symbol));
    expect(accents.size).toBe(4);
    expect(symbols.size).toBe(4);
  });

  it('gibt jedem Typ ein Banner', () => {
    for (const type of TYPES) expect(cardTypeStyle(type).banner.length).toBeGreaterThan(0);
  });
});

describe('describeCard', () => {
  it('beschreibt jede Karte mit nicht leerem Text', () => {
    for (const def of CARD_DEFS) expect(describeCard(def)).not.toBe('');
  });

  it('nennt die Werte aus der Definition', () => {
    expect(describeCard(getCardDef('tower-hp'))).toBe('+30 Leben');
    expect(describeCard({ ...getCardDef('tower-hp'), damage: 4 } as CardDef)).toBe('+30 Leben\n+4 Schaden');
    expect(describeCard(getCardDef('tower-damage'))).toBe('+4 Schaden');
    expect(describeCard(getCardDef('summon-minion'))).toBe('6 Schaden\n30 Leben');
    expect(describeCard(getCardDef('summon-archer'))).toBe('7 Fernschaden\n20 Leben');
    expect(describeCard(getCardDef('summon-healer'))).toBe('Heilt 5/s\n20 Leben');
    expect(describeCard(getCardDef('minion-upgrade-all'))).toBe('Alle: +5 Leben\n+1 Schaden');
    expect(describeCard(getCardDef('minion-upgrade-line'))).toBe('Line: +10 Leben\n+2 Schaden');
    expect(describeCard(getCardDef('line-upgrade'))).toBe('Line +1 Stufe');
  });
});
