import { describe, expect, it } from 'vitest';
import { CARD_BALANCE, HAND_LIMIT, MINION_RANGE, MINION_SPEED, START_HAND, TOWER_DAMAGE, TOWER_HP } from './balance-config';
import {
  createMatchWithDeck,
  createMatchWithHand,
  DECK_LENGTH,
  destroyTowers,
  fixedDeck,
  fullHand,
  handOf,
  idleUnit,
  towerOf,
  unitOf,
  withHand,
  withLevel,
} from './test-fixtures';
import { towersAlive } from './combat';

describe('Test-Fixtures', () => {
  it('fixedDeck wiederholt die Kartenliste in fester Reihenfolge ohne Seed', () => {
    expect(fixedDeck(['a', 'b', 'c'], 7)).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
    expect(fixedDeck(['a'])).toHaveLength(DECK_LENGTH);
    expect(() => fixedDeck([])).toThrow();
  });

  it('createMatchWithDeck legt das Deck fest und gibt beiden Spielern die ersten START_HAND Karten', () => {
    const cards = ['summon-minion', 'summon-brute', 'tower-hp'];
    for (const seed of [1, 2, 3]) {
      const state = createMatchWithDeck(cards, seed);
      expect(state.deck).toEqual(fixedDeck(cards));
      expect(state.drawn).toBe(START_HAND);
      for (const player of state.players) expect(player.hand).toEqual(state.deck.slice(0, START_HAND));
    }
  });

  it('withHand und createMatchWithHand setzen Hand und Energie für beide Spieler, ohne den Ausgang zu ändern', () => {
    const base = createMatchWithDeck(['summon-minion']);
    const state = withHand(base, ['tower-hp'], 4);
    for (const player of state.players) expect(player).toMatchObject({ hand: ['tower-hp'], energy: 4 });
    expect(base.players[0].hand).toHaveLength(START_HAND);
    const direct = createMatchWithHand(['tower-hp', 'summon-brute'], 6);
    for (const player of direct.players) expect(player).toMatchObject({ hand: ['tower-hp', 'summon-brute'], energy: 6 });
    expect(createMatchWithHand(['tower-hp']).players[0].energy).toBeGreaterThan(0);
  });

  it('withLevel baut das Feld aus und kauft die freigeschalteten Lanes', () => {
    const grown = withLevel(createMatchWithDeck(['summon-minion']), 2);
    expect(grown.players[0].level).toBe(2);
    expect(grown.players[0].lines.map((line) => line.bought)).toEqual([true, true, true, false, false]);
  });

  it('handOf und fullHand liefern gleiche Karten; fullHand liegt genau am Handlimit', () => {
    expect(handOf('tower-hp', 3)).toEqual(['tower-hp', 'tower-hp', 'tower-hp']);
    expect(fullHand()).toHaveLength(HAND_LIMIT);
    expect(fullHand('tower-hp').every((id) => id === 'tower-hp')).toBe(true);
  });

  it('unitOf übernimmt die Werte der Karte aus CARD_BALANCE und die Standardwerte für Reichweite und Tempo', () => {
    expect(unitOf('summon-archer')).toMatchObject({
      hp: CARD_BALANCE['summon-archer'].hp,
      maxHp: CARD_BALANCE['summon-archer'].hp,
      damage: CARD_BALANCE['summon-archer'].damage,
      range: CARD_BALANCE['summon-archer'].range,
      speed: CARD_BALANCE['summon-archer'].speed,
    });
    expect(unitOf('summon-minion')).toMatchObject({ range: MINION_RANGE, speed: MINION_SPEED });
    expect(unitOf('summon-minion', { id: 7, hp: 1 })).toMatchObject({ id: 7, hp: 1 });
    expect(() => unitOf('tower-lightning')).toThrow();
  });

  it('idleUnit steht still und trifft nichts', () => {
    expect(idleUnit(3)).toMatchObject({ id: 3, damage: 0, range: 0, speed: 0 });
    expect(idleUnit(3, { line: 2 }).line).toBe(2);
  });

  it('towerOf und destroyTowers nutzen die Tower-Werte aus der Balance-Konfiguration', () => {
    expect(towerOf()).toEqual({ hp: TOWER_HP, maxHp: TOWER_HP, damage: TOWER_DAMAGE });
    expect(towerOf({ offset: 8 }).offset).toBe(8);
    const state = createMatchWithDeck(['summon-minion']);
    destroyTowers(state, 1);
    expect(towersAlive(state.players[1])).toBe(0);
    expect(towersAlive(state.players[0])).toBeGreaterThan(0);
  });
});
