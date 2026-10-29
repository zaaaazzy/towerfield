import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as config from './balance-config';
import { CARD_BALANCE, FIELD_LANE_COUNT, HAND_LIMIT, MAX_ENERGY, START_HAND } from './balance-config';
import { CARD_DEFS, DECK_CYCLE } from './cards';
import * as combat from './combat';
import { LANE_COUNT, MAX_FIELD_LEVEL } from './lanes';
import * as match from './match';
import { EVENT_ENERGY_BONUS } from './round-events';

/** Lose typierte Sicht auf die Kartentabelle (Zugriff über beliebige IDs). */
const BALANCE: Readonly<Record<string, config.CardBalance>> = CARD_BALANCE;

/** Alle Zahlen-Konstanten der Konfiguration (ohne die Kartentabelle). */
const NUMBERS = Object.entries(config).filter((entry): entry is [string, number] => typeof entry[1] === 'number');

/** Zeilen `| Wert | `KONSTANTE` | Zahl |` der README-Tabelle „Basiswerte“. */
function readmeTable(): Map<string, number> {
  const text = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const rows = new Map<string, number>();
  for (const row of text.matchAll(/^\|[^|\n]*\|\s*`([A-Z_]+)`\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*$/gm)) {
    rows.set(row[1]!, Number(row[2]));
  }
  return rows;
}

describe('README-Tabelle „Basiswerte“', () => {
  const table = readmeTable();

  it('nennt jede Zahlen-Konstante der Konfiguration', () => {
    expect([...table.keys()].sort()).toEqual(NUMBERS.map(([name]) => name).sort());
  });

  it.each(NUMBERS)('%s stimmt mit der Konfiguration überein', (name, value) => {
    expect(table.get(name)).toBe(value);
  });
});

describe('Plausibilität der Basiswerte', () => {
  it.each(NUMBERS)('%s ist endlich und positiv', (_name, value) => {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  });

  it('das Handlimit reicht für die Starthand', () => {
    expect(HAND_LIMIT).toBeGreaterThanOrEqual(START_HAND);
  });

  it('MAX_ENERGY ist das höchste Einkommen plus Energieschub', () => {
    const income =
      config.BASE_ENERGY +
      (config.MAX_ROUNDS - 1) * config.ENERGY_PER_ROUND +
      (config.MAX_FIELD_LEVEL - config.START_FORTRESSES) * config.INCOME_PER_FORTRESS +
      (config.FIELD_LANE_COUNT - config.START_LANES) * config.INCOME_PER_LANE;
    expect(MAX_ENERGY).toBe(income + config.EVENT_ENERGY_BONUS);
    expect(match.incomeForRound(config.MAX_ROUNDS, config.MAX_FIELD_LEVEL, LANE_COUNT) + EVENT_ENERGY_BONUS).toBe(MAX_ENERGY);
  });

  it('die Feldstufen und Lanes passen zusammen', () => {
    expect(FIELD_LANE_COUNT).toBe(LANE_COUNT);
    expect(config.START_FORTRESSES).toBeLessThanOrEqual(MAX_FIELD_LEVEL);
    expect(config.START_LANES).toBeLessThanOrEqual(FIELD_LANE_COUNT);
  });
});

describe('Re-Exporte', () => {
  it('match, combat, lanes und round-events liefern dieselben Werte wie die Konfiguration', () => {
    const source: Record<string, unknown> = { ...match, ...combat, MAX_FIELD_LEVEL, EVENT_ENERGY_BONUS };
    for (const [name, value] of NUMBERS) {
      if (name in source) expect(source[name], name).toBe(value);
    }
    expect(Object.keys(source)).toEqual(expect.arrayContaining(['TOWER_HP', 'TICK_MS', 'MAX_ENERGY']));
  });
});

describe('Kartentabelle CARD_BALANCE', () => {
  it('hat zu jeder Kartendefinition einen Eintrag und umgekehrt', () => {
    expect(Object.keys(CARD_BALANCE).sort()).toEqual(CARD_DEFS.map((def) => def.id).sort());
  });

  it('Kosten der Karten stammen aus der Tabelle', () => {
    for (const def of CARD_DEFS) {
      expect(def.cost, def.id).toBe(BALANCE[def.id]!.cost);
    }
  });

  it('Kopienzahlen sind ganze Zahlen ab 0 und ergeben DECK_CYCLE', () => {
    const copies = Object.values(BALANCE).map((entry) => entry.copies);
    expect(copies.every((count) => Number.isInteger(count) && count >= 0)).toBe(true);
    expect(copies.reduce((sum, count) => sum + count, 0)).toBe(DECK_CYCLE);
  });

  it('Kosten und Werte sind endlich und nicht negativ, Kosten positiv', () => {
    for (const [id, entry] of Object.entries(BALANCE)) {
      const values = [entry.hp, entry.damage, entry.range, entry.speed].filter((value) => value !== undefined);
      expect(entry.cost, id).toBeGreaterThan(0);
      for (const value of values) {
        expect(Number.isFinite(value), id).toBe(true);
        expect(value, id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('der Standard-Minion nutzt die Minion-Standardwerte', () => {
    expect(CARD_BALANCE['summon-minion']).toMatchObject({
      hp: config.MINION_HP,
      damage: config.MINION_DAMAGE,
      speed: config.MINION_SPEED,
    });
  });
});
