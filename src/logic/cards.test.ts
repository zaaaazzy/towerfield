import { describe, expect, it } from 'vitest';
import { buildDeck, CARD_DEFS, getCardDef } from './cards';

describe('Karten', () => {
  it('deckt alle vier Kartentypen ab', () => {
    const types = new Set(CARD_DEFS.map((card) => card.type));
    expect([...types].sort()).toEqual(['line-upgrade', 'minion-upgrade', 'summon', 'tower-upgrade']);
  });

  it('hat eindeutige IDs und positive Kosten', () => {
    expect(new Set(CARD_DEFS.map((card) => card.id)).size).toBe(CARD_DEFS.length);
    for (const card of CARD_DEFS) expect(card.cost).toBeGreaterThan(0);
  });

  it('gibt jeder Summon-Karte ein positives Tempo (Minion 10, Brocken 8)', () => {
    for (const card of CARD_DEFS) {
      if (card.type === 'summon') expect(card.speed).toBeGreaterThan(0);
    }
    expect(getCardDef('summon-minion')).toMatchObject({ speed: 10 });
    expect(getCardDef('summon-brute')).toMatchObject({ speed: 8 });
  });

  it('wirft bei einer unbekannten Karte', () => {
    expect(() => getCardDef('gibt-es-nicht')).toThrow();
  });

  it('baut mit demselben Seed dasselbe Deck und mit anderem Seed ein anderes', () => {
    expect(buildDeck(5, 42)).toEqual(buildDeck(5, 42));
    expect(buildDeck(5, 42)).not.toEqual(buildDeck(6, 42));
  });

  it('liefert die verlangte Länge nur mit bekannten Karten', () => {
    const deck = buildDeck(1, 42);
    expect(deck).toHaveLength(42);
    for (const id of deck) expect(() => getCardDef(id)).not.toThrow();
  });
});
