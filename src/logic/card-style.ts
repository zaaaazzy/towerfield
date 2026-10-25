/**
 * Darstellungsregeln für Karten: Farbe, Symbol und Banner je Kartentyp sowie der Beschreibungstext.
 * Ohne Phaser, DOM und Canvas; liest nur die Kartendefinitionen.
 */
import { BUFF_RATIO } from './buff';
import type { CardDef, CardType } from './cards';
import { MINION_RANGE } from './combat';

/** Symbol, das die Szene in der Bildfläche der Karte zeichnet. */
export type CardSymbol = 'sword' | 'tower' | 'gem' | 'arrow';

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
  'line-upgrade': { accent: 0x3fb68b, dark: 0x145440, symbol: 'arrow', banner: 'LANE' },
  'minion-upgrade': { accent: 0xb06be0, dark: 0x4a2470, symbol: 'gem', banner: 'MINIONS' },
  'minion-buff': { accent: 0xe0a53a, dark: 0x6a4a14, symbol: 'gem', banner: 'STÄRKUNG' },
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
  if (def.type === 'line-upgrade' || def.type === 'minion-buff') return null;
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
    case 'minion-upgrade':
      return `${def.scope === 'all' ? 'Alle' : 'Lane'}: +${def.hp} Leben\n+${def.damage} Schaden`;
    case 'minion-buff':
      return `Ein Minion:\n+${BUFF_RATIO * 100} % Leben, Schaden`;
    case 'summon':
      if (def.explodes) return `${def.damage} Schaden · ${def.hp} Leben\nTod: ${def.explodes.damage} Fläche`;
      return def.role === 'healer'
        ? `Heilt ${def.damage}/s\n${def.hp} Leben`
        : `${def.damage} ${def.range && def.range > MINION_RANGE ? 'Fernschaden' : 'Schaden'}\n${def.hp} Leben`;
  }
}
