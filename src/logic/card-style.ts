/**
 * Darstellungsregeln für Karten: Farbe, Symbol und Banner je Kartentyp sowie der Beschreibungstext.
 * Ohne Phaser, DOM und Canvas; liest nur die Kartendefinitionen.
 */
import { BUFF_RATIO } from './buff';
import type { CardDef, CardType } from './cards';
import { LANE_BUFF_FACTOR, LANE_SHIELD_FACTOR, LIGHTNING_FACTOR, MINION_RANGE, SHIELD_REFLECT } from './combat';
import { SPECIALIZE_MIN_LEVEL } from './match';

/** Symbol, das die Szene in der Bildfläche der Karte zeichnet. */
export type CardSymbol = 'sword' | 'tower' | 'gem' | 'arrow' | 'bolt' | 'shield';

export interface CardTypeStyle {
  /** Rahmen- und Bannerfarbe (RGB). */
  accent: number;
  /** Abgedunkelte Variante für Banner und Bildfläche. */
  dark: number;
  symbol: CardSymbol;
  /** Text im Typ-Banner (kurz, passt auf eine kleine Karte). */
  banner: string;
}

export const CARD_TYPE_STYLES: Readonly<Record<CardType, CardTypeStyle>> = {
  summon: { accent: 0xe0584a, dark: 0x6a1f1c, symbol: 'sword', banner: 'BESCHWÖRUNG' },
  'tower-upgrade': { accent: 0x4a90e2, dark: 0x1b3a6a, symbol: 'tower', banner: 'TOWER' },
  'tower-specialize': { accent: 0xe0b23a, dark: 0x6a4e12, symbol: 'bolt', banner: 'SPEZIAL' },
  'line-upgrade': { accent: 0x3fb68b, dark: 0x145440, symbol: 'arrow', banner: 'LANE' },
  'minion-upgrade': { accent: 0xb06be0, dark: 0x4a2470, symbol: 'gem', banner: 'MINIONS' },
  'minion-buff': { accent: 0xe0a53a, dark: 0x6a4a14, symbol: 'gem', banner: 'STÄRKUNG' },
  'lane-card': { accent: 0x39c6d6, dark: 0x125560, symbol: 'shield', banner: 'LANE-KARTE' },
};

export function cardTypeStyle(type: CardType): CardTypeStyle {
  return CARD_TYPE_STYLES[type];
}

/** Karten mit eigenem Bild unter `public/assets/cards/<id>.svg`; alle anderen zeigen das Typ-Symbol als Rückfall. */
export const CARD_ART_IDS: readonly string[] = [
  'summon-minion',
  'summon-brute',
  'summon-archer',
  'summon-healer',
  'summon-destroyer',
  'line-upgrade',
  'tower-hp',
  'tower-damage',
  'minion-upgrade-line',
  'minion-upgrade-all',
  'buff-minion',
  'tower-lightning',
  'tower-shield',
  'summon-scout',
  'summon-guard',
  'summon-mage',
  'lane-buff',
  'lane-shield',
  'tower-armor',
  'minion-upgrade-elite',
];

/** Texturschlüssel des Kartenbilds oder `null`, wenn die Karte nur das Typ-Symbol zeigt. */
export function cardArtKey(def: CardDef): string | null {
  return CARD_ART_IDS.includes(def.id) ? `card-art-${def.id}` : null;
}

export interface CardStats {
  hp: number;
  damage: number;
  /** Upgrades zeigen ihre Werte mit „+“ davor. */
  bonus: boolean;
}

/** Leben und Schaden für die Wert-Plaketten auf dem Kartenbild; `null`, wenn die Karte keine Werte hat. */
export function cardStats(def: CardDef): CardStats | null {
  if (def.type === 'line-upgrade' || def.type === 'tower-specialize' || def.type === 'minion-buff' || def.type === 'lane-card') {
    return null;
  }
  if (def.hp <= 0 && def.damage <= 0) return null;
  return { hp: def.hp, damage: def.damage, bonus: def.type !== 'summon' };
}

/** Kurzer Regeltext für das Textfeld der Karte, nur aus den Werten der Definition abgeleitet. */
export function describeCard(def: CardDef): string {
  switch (def.type) {
    case 'line-upgrade':
      return 'Lane +1 Stufe\noben + unten';
    case 'tower-upgrade':
      return [def.hp > 0 ? `+${def.hp} Leben` : '', def.damage > 0 ? `+${def.damage} Schaden` : ''].filter(Boolean).join('\n');
    case 'tower-specialize':
      return def.path === 'lightning'
        ? `Trifft alle Gegner\nder Lane (${Math.round(LIGHTNING_FACTOR * 100)} %)\nab Lane-Lvl ${SPECIALIZE_MIN_LEVEL}`
        : `Wirft ${Math.round(SHIELD_REFLECT * 100)} % des Schadens\nzurück\nab Lane-Lvl ${SPECIALIZE_MIN_LEVEL}`;
    case 'minion-upgrade':
      return `${def.scope === 'all' ? 'Alle' : 'Lane'}: +${def.hp} Leben\n+${def.damage} Schaden`;
    case 'minion-buff':
      return `Ein Minion:\n+${BUFF_RATIO * 100} % Leben, Schaden`;
    case 'lane-card':
      return def.effect === 'buff'
        ? `Hinter dem Turm:\nLane +${Math.round((LANE_BUFF_FACTOR - 1) * 100)} % Schaden`
        : `Hinter dem Turm:\nLane -${Math.round((1 - LANE_SHIELD_FACTOR) * 100)} %\nerlittener Schaden`;
    case 'summon':
      if (def.explodes) return `${def.damage} Schaden · ${def.hp} Leben\nTod: ${def.explodes.damage} Fläche`;
      return def.role === 'healer'
        ? `Heilt ${def.damage}/s\n${def.hp} Leben`
        : `${def.damage} ${def.range && def.range > MINION_RANGE ? 'Fernschaden' : 'Schaden'}\n${def.hp} Leben`;
  }
}
