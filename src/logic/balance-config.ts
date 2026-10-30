/**
 * Zentrale Balancing-Konfiguration: alle Basiswerte des Spiels an einer Stelle. Ohne Phaser, DOM und Canvas.
 * Die Datei importiert nichts aus `match`, `combat`, `cards` oder `lanes` (sonst gäbe es einen Zyklus); `match.ts` und
 * `combat.ts` führen die Namen per Re-Export weiter. Eine Wertänderung berührt nur diese Datei; die README-Tabelle
 * „Basiswerte“ prüft `balance-config.test.ts` gegen diese Werte.
 */

// Match-Ablauf
export const START_HAND = 5;
/** Karten, die nach „Ende der Planung“ neu gezogen werden (die Resthand wird vorher abgelegt). */
export const DRAW_PER_ROUND = 5;
/** Karten, die pro Runde aus der Hand gespielt werden dürfen. */
export const CARDS_PER_ROUND = 1;
/** Handlimit (bestätigt, siehe docs/designkonzept.md): Karten über dem Limit verfallen am Ende der Hand. */
export const HAND_LIMIT = 10;
export const MAX_ROUNDS = 8;
/** Dauer der Kampfphase in Ticks (20 Sekunden). */
export const COMBAT_TICKS = 400;

// Wirtschaft (siehe docs/anwendung-wirtschaft.md): Energie ist die einzige Währung.
/** Einkommen in Runde 1 ohne Ausbau; die Start-Festung und die Start-Lane stecken schon darin. */
export const BASE_ENERGY = 3;
/** Einkommen, das mit jeder Runde dazukommt. */
export const ENERGY_PER_ROUND = 1;
/** Einkommen je Festung (Feldstufe) und je gekaufter Lane über den Start-Wert hinaus. */
export const INCOME_PER_FORTRESS = 1;
export const INCOME_PER_LANE = 1;
/** Festungen (= Feldstufe) und Lanes zu Spielbeginn; sie bringen kein Zusatzeinkommen. */
export const START_FORTRESSES = 1;
export const START_LANES = 1;
/** Energie für ein Upgrade der Feldstufe (bringt ab der nächsten Runde `INCOME_PER_FORTRESS` mehr). */
export const UPGRADE_COST = 2;
/** Energie für den Kauf einer Lane (ab der Feldstufe, die `laneUnlockLevel` verlangt). */
export const LANE_COST = 5;
/** Energie für das Ziehen einer zusätzlichen Karte. */
export const DRAW_COST = 1;
/** Energie, die das Verschieben eines Minions auf einen anderen Turm-Slot kostet. */
export const MOVE_COST = 1;
/** Energie, die das Abwerfen einer Handkarte bringt; über `MAX_ENERGY` verfällt sie. */
export const DISCARD_ENERGY = 1;
/** Energie, die der Verkauf einer platzierten Figur in der Planungsphase bringt; über `MAX_ENERGY` verfällt sie. */
export const SELL_MINION_ENERGY = 1;
/** Zusätzliche Energie beim Runden-Ereignis „Energieschub“ (gedeckelt durch `MAX_ENERGY`). */
export const EVENT_ENERGY_BONUS = 1;

// Feld
/** Höchste Ausbaustufe des Feldes (Lvl 3 = Start-Lane plus zwei Lanes pro Seite). */
export const MAX_FIELD_LEVEL = 3;
/** Zahl der Lanes des voll ausgebauten Feldes; `lanes.ts` prüft der Test auf Übereinstimmung mit dem Layout. */
export const FIELD_LANE_COUNT = 5;
/** Mindest-Level einer Lane (Ausbaustufe, ab der sie frei ist) für eine Tower-Spezialisierung. */
export const SPECIALIZE_MIN_LEVEL = 2;

/**
 * Höchstes Rundeneinkommen (letzte Runde, voll ausgebautes Feld) plus Energieschub-Ereignis. Die Obergrenze liegt
 * genau dort, damit sie das Einkommen nie abschneidet; sie begrenzt nur die Energie aus dem Abwerfen.
 */
export const MAX_ENERGY =
  BASE_ENERGY +
  (MAX_ROUNDS - 1) * ENERGY_PER_ROUND +
  (MAX_FIELD_LEVEL - START_FORTRESSES) * INCOME_PER_FORTRESS +
  (FIELD_LANE_COUNT - START_LANES) * INCOME_PER_LANE +
  EVENT_ENERGY_BONUS;

// Tower
export const TOWER_HP = 100;
export const TOWER_DAMAGE = 8;
export const TOWER_RANGE = 20;
/** Blitz-Turm: Anteil des Tower-Schadens, den jedes getroffene Minion erleidet (er trifft dafür alle in Reichweite). */
export const LIGHTNING_FACTOR = 0.6;
/** Schild-Turm: Anteil des Schadens, den ein Minion dem Tower zufügt und der als Rückwurf auf das Minion fällt. */
export const SHIELD_REFLECT = 0.5;

// Kampf
/**
 * Länge einer Lane in Einheiten. Die Lane läuft waagrecht: Position 0 liegt am eigenen (linken) Ende, `LINE_LENGTH`
 * am gegnerischen (rechten). Jeder Spieler zählt vom eigenen Ende aus.
 */
export const LINE_LENGTH = 100;
/** Feste Schrittweite der Simulation, unabhängig von der Bildwiederholrate. */
export const TICK_MS = 50;
/** Lane-Buff: Faktor auf den Schaden der eigenen Minions der Lane. */
export const LANE_BUFF_FACTOR = 1.25;
/** Lane-Schild: Faktor auf den Schaden, den die eigenen Minions der Lane erleiden. */
export const LANE_SHIELD_FACTOR = 0.7;

// Minion-Standardwerte (Nahkämpfer ohne Rolle)
export const MINION_HP = 30;
export const MINION_DAMAGE = 6;
/** Standard-Reichweite (Nahkämpfer); die Simulation nutzt `Minion.range`. */
export const MINION_RANGE = 4;
/** Standard-Tempo (Minions ohne eigene Rolle); die Simulation nutzt `Minion.speed`. */
export const MINION_SPEED = 10;

// Turm-Spawn: Jeder lebende Turm erzeugt in der Kampfphase regelmässig einen eigenen Minion (`source: 'tower'`).
/** Zeit zwischen zwei Spawns eines Turms in Millisekunden (Kampfzeit, nicht Frames). */
export const TOWER_SPAWN_MS = 1000;
export const TOWER_SPAWN_HP = 12;
export const TOWER_SPAWN_DAMAGE = 3;
export const TOWER_SPAWN_RANGE = MINION_RANGE;
export const TOWER_SPAWN_SPEED = MINION_SPEED;

/** Balancing-Werte einer Karte. Fehlende Felder gelten als nicht vorhanden (`range`/`speed`: Minion-Standard). */
export interface CardBalance {
  cost: number;
  /** Wie oft die Karte in einem Durchgang des Decks vorkommt. */
  copies: number;
  hp?: number;
  damage?: number;
  range?: number;
  speed?: number;
  /** Explosion beim Tod (Zerstörer). */
  explosion?: { radius: number; damage: number };
}

/**
 * Werte-Tabelle je Karten-ID. Name, Typ und Ziel stehen in `cards.ts`. Bei Beschwörungen sind `hp`/`damage`/`speed`
 * die Werte des Minions, bei Tower- und Minion-Upgrades der Zuwachs.
 */
export const CARD_BALANCE = {
  'summon-minion': { cost: 1, copies: 4, hp: MINION_HP, damage: MINION_DAMAGE, speed: MINION_SPEED },
  'summon-brute': { cost: 2, copies: 2, hp: 80, damage: 12, speed: 8 },
  'summon-archer': { cost: 2, copies: 2, hp: 20, damage: 7, range: 14, speed: 10 },
  'summon-healer': { cost: 2, copies: 1, hp: 20, damage: 5, range: 10, speed: MINION_SPEED },
  'summon-destroyer': { cost: 2, copies: 1, hp: 40, damage: 8, speed: 8, explosion: { radius: 10, damage: 15 } },
  // Das Upgrade ist eine Aktion (`upgradeField`), keine Karte im Deck mehr (0 Kopien); die Definition bleibt für Synergien.
  'line-upgrade': { cost: 2, copies: 0 },
  'tower-hp': { cost: 1, copies: 2, hp: 30, damage: 0 },
  'tower-damage': { cost: 2, copies: 1, hp: 0, damage: 4 },
  'tower-lightning': { cost: 2, copies: 1 },
  'tower-shield': { cost: 2, copies: 1 },
  'minion-upgrade-line': { cost: 1, copies: 2, hp: 10, damage: 2 },
  'minion-upgrade-all': { cost: 3, copies: 1, hp: 5, damage: 1 },
  'buff-minion': { cost: 2, copies: 1 },
  'summon-scout': { cost: 1, copies: 2, hp: 20, damage: 4, speed: 14 },
  'summon-guard': { cost: 3, copies: 1, hp: 120, damage: 12, speed: 6 },
  'summon-mage': { cost: 3, copies: 1, hp: 25, damage: 12, range: 12, speed: 9 },
  'lane-buff': { cost: 2, copies: 1 },
  'lane-shield': { cost: 2, copies: 1 },
  'tower-armor': { cost: 2, copies: 1, hp: 60, damage: 0 },
  'minion-upgrade-elite': { cost: 2, copies: 1, hp: 20, damage: 4 },
} as const satisfies Record<string, CardBalance>;

export type CardBalanceId = keyof typeof CARD_BALANCE;
