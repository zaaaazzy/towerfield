import { describe, expect, it } from 'vitest';
import { buildDeck, CARD_DEFS, DECK_CYCLE, getCardDef } from './cards';

describe('Karten', () => {
  it('deckt alle sieben Kartentypen ab', () => {
    const types = new Set(CARD_DEFS.map((card) => card.type));
    expect([...types].sort()).toEqual([
      'lane-card',
      'line-upgrade',
      'minion-buff',
      'minion-upgrade',
      'summon',
      'tower-specialize',
      'tower-upgrade',
    ]);
  });

  it('definiert Blitz- und Schild-Turm als Spezialisierung mit Ziel Line und passendem Pfad', () => {
    expect(getCardDef('tower-lightning')).toMatchObject({ type: 'tower-specialize', target: 'line', path: 'lightning' });
    expect(getCardDef('tower-shield')).toMatchObject({ type: 'tower-specialize', target: 'line', path: 'shield' });
  });

  it('legt beide Spezialisierungen einmal pro Durchgang ins Deck, deterministisch pro Seed', () => {
    const deck = buildDeck(9, DECK_CYCLE);
    expect(deck.filter((id) => id === 'tower-lightning')).toHaveLength(1);
    expect(deck.filter((id) => id === 'tower-shield')).toHaveLength(1);
    expect(buildDeck(9, DECK_CYCLE)).toEqual(deck);
  });

  it('definiert „Minion stärken“ als Karte mit Ziel-Minion', () => {
    expect(getCardDef('buff-minion')).toMatchObject({
      name: 'Minion stärken',
      type: 'minion-buff',
      target: 'minion',
      cost: 2,
    });
  });

  it('legt „Minion stärken“ einmal pro Durchgang ins Deck, deterministisch pro Seed', () => {
    expect(buildDeck(1, DECK_CYCLE).filter((id) => id === 'buff-minion')).toHaveLength(1);
    expect(buildDeck(3, DECK_CYCLE * 2).filter((id) => id === 'buff-minion')).toHaveLength(2);
    expect(buildDeck(3, DECK_CYCLE * 2)).toEqual(buildDeck(3, DECK_CYCLE * 2));
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

  it('definiert den Bogenschützen mit Kosten 2, 20 LP, 7 Schaden/s, Reichweite 14 und Tempo 10', () => {
    expect(getCardDef('summon-archer')).toMatchObject({
      name: 'Bogenschütze',
      type: 'summon',
      cost: 2,
      target: 'line',
      hp: 20,
      damage: 7,
      range: 14,
      speed: 10,
    });
  });

  it('legt den Bogenschützen genau zweimal in einen Durchgang des Decks', () => {
    expect(buildDeck(1, DECK_CYCLE).filter((id) => id === 'summon-archer')).toHaveLength(2);
    expect(buildDeck(7, DECK_CYCLE * 3).filter((id) => id === 'summon-archer')).toHaveLength(6);
  });

  it('definiert den Heiler als Summon-Karte mit Reichweite 10, positivem Wert und Ziel Line', () => {
    expect(getCardDef('summon-healer')).toMatchObject({
      name: 'Heiler',
      type: 'summon',
      target: 'line',
      range: 10,
      speed: 10,
      role: 'healer',
    });
    expect(getCardDef('summon-healer')).toHaveProperty('damage');
    expect((getCardDef('summon-healer') as { damage: number }).damage).toBeGreaterThan(0);
  });

  it('legt den Heiler einmal pro Durchgang ins Deck, deterministisch pro Seed', () => {
    expect(buildDeck(1, DECK_CYCLE).filter((id) => id === 'summon-healer')).toHaveLength(1);
    expect(buildDeck(3, DECK_CYCLE * 2).filter((id) => id === 'summon-healer')).toHaveLength(2);
    expect(buildDeck(3, DECK_CYCLE * 2)).toEqual(buildDeck(3, DECK_CYCLE * 2));
  });

  it('definiert den Zerstörer als Summon-Karte mit Rolle destroyer und Explosionswerten', () => {
    expect(getCardDef('summon-destroyer')).toMatchObject({
      name: 'Zerstörer',
      type: 'summon',
      target: 'line',
      cost: 2,
      hp: 40,
      damage: 8,
      speed: 8,
      role: 'destroyer',
      explodes: { radius: 10, damage: 15 },
    });
  });

  it('legt den Zerstörer einmal pro Durchgang ins Deck, deterministisch pro Seed', () => {
    expect(buildDeck(2, DECK_CYCLE).filter((id) => id === 'summon-destroyer')).toHaveLength(1);
    expect(buildDeck(3, DECK_CYCLE * 2).filter((id) => id === 'summon-destroyer')).toHaveLength(2);
    expect(buildDeck(3, DECK_CYCLE * 2)).toEqual(buildDeck(3, DECK_CYCLE * 2));
  });

  describe('neue Karten (Turm-Slots)', () => {
    const NEW_IDS = [
      'summon-scout',
      'summon-guard',
      'summon-mage',
      'lane-buff',
      'lane-shield',
      'tower-armor',
      'minion-upgrade-elite',
    ];

    it('hängt mindestens sechs neue Karten ans Ende der Liste (Beschwörungen, Lane-Karten, Upgrades)', () => {
      expect(NEW_IDS.length).toBeGreaterThanOrEqual(6);
      expect(CARD_DEFS.slice(-NEW_IDS.length).map((def) => def.id)).toEqual(NEW_IDS);
      const types = new Set(NEW_IDS.map((id) => getCardDef(id).type));
      expect(types).toEqual(new Set(['summon', 'lane-card', 'tower-upgrade', 'minion-upgrade']));
    });

    it('legt jede neue Karte ins Deck, deterministisch pro Seed', () => {
      const deck = buildDeck(4, DECK_CYCLE);
      for (const id of NEW_IDS) expect(deck).toContain(id);
      expect(buildDeck(4, DECK_CYCLE)).toEqual(deck);
    });

    it('zählt DECK_CYCLE als Summe aller Exemplare und enthält jede Karte der Liste', () => {
      const deck = buildDeck(1, DECK_CYCLE);
      expect(deck).toHaveLength(DECK_CYCLE);
      for (const def of CARD_DEFS) expect(deck).toContain(def.id);
    });

    it('definiert Lane-Karten mit Ziel Lane und einer Wirkung', () => {
      expect(getCardDef('lane-buff')).toMatchObject({ type: 'lane-card', target: 'line', effect: 'buff', cost: 2 });
      expect(getCardDef('lane-shield')).toMatchObject({ type: 'lane-card', target: 'line', effect: 'shield', cost: 2 });
    });

    it('gibt den neuen Beschwörungen Tempo, Leben und Schaden', () => {
      expect(getCardDef('summon-scout')).toMatchObject({ cost: 1, hp: 20, damage: 4, speed: 14 });
      expect(getCardDef('summon-guard')).toMatchObject({ cost: 3, hp: 120, damage: 12, speed: 6 });
      expect(getCardDef('summon-mage')).toMatchObject({ cost: 3, hp: 25, damage: 12, range: 12, speed: 9 });
    });
  });

  it('wirft bei einer unbekannten Karte', () => {
    expect(() => getCardDef('gibt-es-nicht')).toThrow();
  });

  it('baut mit demselben Seed dasselbe Deck und mit anderem Seed ein anderes', () => {
    expect(buildDeck(5, 42)).toEqual(buildDeck(5, 42));
    expect(buildDeck(5, 42)).not.toEqual(buildDeck(6, 42));
  });

  it('lässt Karten ohne COPIES-Eintrag weg und liefert trotzdem die verlangte Länge', () => {
    const [first, second] = CARD_DEFS;
    const deck = buildDeck(4, 10, [first!, second!], { [first!.id]: 2 });
    expect(deck).toHaveLength(10);
    expect(deck).not.toContain(second!.id);
    expect(new Set(deck)).toEqual(new Set([first!.id]));
  });

  it('liefert ohne die optionalen Parameter exakt das bisherige Deck', () => {
    const expected = [
      'minion-upgrade-all', 'tower-hp', 'tower-hp', 'buff-minion', 'minion-upgrade-line', 'tower-shield',
      'summon-minion', 'summon-minion', 'summon-brute', 'summon-archer', 'summon-healer', 'summon-minion',
      'minion-upgrade-line', 'summon-archer', 'line-upgrade', 'summon-destroyer', 'summon-minion', 'line-upgrade',
      'summon-brute', 'tower-lightning', 'tower-damage',
    ];
    expect(buildDeck(5, 21)).toEqual(expected);
  });

  it('liefert die verlangte Länge nur mit bekannten Karten', () => {
    const deck = buildDeck(1, 42);
    expect(deck).toHaveLength(42);
    for (const id of deck) expect(() => getCardDef(id)).not.toThrow();
  });
});
