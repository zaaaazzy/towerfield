/** Kartenfilter für die Hand: reine Darstellungshilfe, ohne Phaser. */
import type { CardType } from './cards';

export type HandFilter = 'all' | 'summon' | 'upgrade' | 'tower';

/** Reihenfolge, in der die Filtertaste durchschaltet. */
export const HAND_FILTERS: readonly HandFilter[] = ['all', 'summon', 'upgrade', 'tower'];

export const HAND_FILTER_NAMES: Record<HandFilter, string> = {
  all: 'Alle',
  summon: 'Beschwörung',
  upgrade: 'Upgrade',
  tower: 'Tower',
};

const GROUPS: Record<CardType, Exclude<HandFilter, 'all'>> = {
  summon: 'summon',
  'line-upgrade': 'upgrade',
  'minion-upgrade': 'upgrade',
  'tower-upgrade': 'tower',
};

/** Nächster Filter in der Reihenfolge Alle → Beschwörung → Upgrade → Tower → Alle. */
export function nextHandFilter(filter: HandFilter): HandFilter {
  return HAND_FILTERS[(HAND_FILTERS.indexOf(filter) + 1) % HAND_FILTERS.length]!;
}

/** Ist eine Karte dieses Typs bei dem Filter sichtbar (und damit antippbar)? */
export function isCardVisible(type: CardType, filter: HandFilter): boolean {
  return filter === 'all' || GROUPS[type] === filter;
}
