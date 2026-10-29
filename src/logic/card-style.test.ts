import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_DEFS, type CardDef, type CardType, getCardDef } from './cards';
import { CARD_ART_IDS, CARD_TYPE_STYLES, cardArtKey, cardStats, cardTypeStyle, describeCard } from './card-style';

const TYPES: CardType[] = [
  'line-upgrade',
  'tower-upgrade',
  'tower-specialize',
  'summon',
  'minion-upgrade',
  'minion-buff',
  'lane-card',
];

describe('cardTypeStyle', () => {
  it('kennt alle Kartentypen', () => {
    for (const type of TYPES) expect(cardTypeStyle(type)).toBe(CARD_TYPE_STYLES[type]);
  });

  it('unterscheidet die Typen nach Rahmenfarbe und Symbol', () => {
    const accents = new Set(TYPES.map((type) => cardTypeStyle(type).accent));
    const symbols = new Set(TYPES.map((type) => cardTypeStyle(type).symbol));
    expect(accents.size).toBe(TYPES.length);
    // „Minion stärken“ teilt sich das Symbol mit den Minion-Upgrades, unterscheidet sich aber in Farbe und Banner.
    expect(symbols.size).toBe(TYPES.length - 1);
  });

  it('gibt jedem Typ ein Banner', () => {
    for (const type of TYPES) expect(cardTypeStyle(type).banner.length).toBeGreaterThan(0);
  });
});

describe('cardArtKey', () => {
  it('liefert für jede Karte aus CARD_DEFS einen eigenen Schlüssel der Form card-art-<id>', () => {
    const missing = CARD_DEFS.filter((def) => cardArtKey(def) === null).map((def) => def.id);
    expect(missing, `Karten ohne Bild: ${missing.join(', ')}`).toEqual([]);
    const keys = CARD_DEFS.map((def) => cardArtKey(def));
    expect(new Set(keys).size).toBe(CARD_DEFS.length);
    for (const def of CARD_DEFS) expect(cardArtKey(def)).toBe(`card-art-${def.id}`);
  });

  it('listet jede Karten-ID genau einmal und hat zu jeder Karte eine SVG-Datei im Format 134×72', () => {
    expect(new Set(CARD_ART_IDS).size).toBe(CARD_ART_IDS.length);
    expect(CARD_ART_IDS).toHaveLength(CARD_DEFS.length);
    for (const def of CARD_DEFS) {
      const svg = readFileSync(`public/assets/cards/${def.id}.svg`, 'utf8');
      expect(svg, `${def.id}.svg`).toContain('viewBox="0 0 134 72"');
    }
  });

  it('kennt kein Bild für unbekannte Karten (Rückfall auf das Typ-Symbol)', () => {
    expect(cardArtKey({ ...getCardDef('line-upgrade'), id: 'neu' })).toBeNull();
  });
});

describe('cardStats', () => {
  it('zeigt Leben und Schaden aus der Definition, bei Upgrades mit Plus', () => {
    expect(cardStats(getCardDef('summon-brute'))).toEqual({ hp: 80, damage: 12, bonus: false });
    expect(cardStats(getCardDef('tower-hp'))).toEqual({ hp: 30, damage: 0, bonus: true });
    expect(cardStats(getCardDef('minion-upgrade-all'))).toEqual({ hp: 5, damage: 1, bonus: true });
  });

  it('hat für die Line-Karte und die Spezialisierungen keine Werte', () => {
    expect(cardStats(getCardDef('line-upgrade'))).toBeNull();
    expect(cardStats(getCardDef('tower-lightning'))).toBeNull();
    expect(cardStats(getCardDef('tower-shield'))).toBeNull();
  });
});

describe('cardStats mit leeren Werten', () => {
  it('zeigt Werte, sobald Leben oder Schaden gesetzt ist, und nichts, wenn beides 0 ist', () => {
    expect(cardStats(getCardDef('tower-damage'))).toEqual({ hp: 0, damage: 4, bonus: true });
    expect(cardStats({ ...getCardDef('tower-hp'), hp: 0, damage: 0 } as CardDef)).toBeNull();
    expect(cardStats({ ...getCardDef('tower-hp'), hp: 0, damage: 4 } as CardDef)).toEqual({ hp: 0, damage: 4, bonus: true });
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
    expect(describeCard(getCardDef('summon-destroyer'))).toBe('8 Schaden · 40 Leben\nTod: 15 Fläche');
    expect(describeCard(getCardDef('minion-upgrade-all'))).toBe('Alle: +5 Leben\n+1 Schaden');
    expect(describeCard(getCardDef('minion-upgrade-line'))).toBe('Lane: +10 Leben\n+2 Schaden');
    expect(describeCard(getCardDef('line-upgrade'))).toBe('Lane +1 Stufe\noben + unten');
    expect(describeCard(getCardDef('tower-lightning'))).toContain('Trifft alle Gegner');
    expect(describeCard(getCardDef('tower-shield'))).toContain('Wirft 50 % des Schadens');
    expect(describeCard(getCardDef('buff-minion'))).toBe('Ein Minion:\n+50 % Leben, Schaden');
  });

  it('beschreibt Lane-Karten mit ihrer Wirkung und ohne Wert-Plaketten', () => {
    expect(describeCard(getCardDef('lane-buff'))).toBe('Hinter dem Turm:\nLane +25 % Schaden');
    expect(describeCard(getCardDef('lane-shield'))).toBe('Hinter dem Turm:\nLane -30 %\nerlittener Schaden');
    expect(cardStats(getCardDef('lane-buff'))).toBeNull();
    expect(cardTypeStyle('lane-card').banner).toBe('LANE-KARTE');
  });

  it('gibt „Minion stärken“ ein eigenes Banner und keine Wert-Plaketten', () => {
    expect(cardStats(getCardDef('buff-minion'))).toBeNull();
    expect(cardTypeStyle('minion-buff').banner).toBe('STÄRKUNG');
    expect(cardTypeStyle('minion-buff').accent).not.toBe(cardTypeStyle('minion-upgrade').accent);
  });
});
