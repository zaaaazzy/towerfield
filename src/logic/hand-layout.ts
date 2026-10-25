/**
 * Anordnung der Hand als Kartenfächer: feste Typ-Reihenfolge, Position und Neigung je Anzeigeplatz sowie
 * Trefferprüfung mit Neigung und Z-Reihenfolge. Ohne Phaser, DOM und Canvas; die Szene zeichnet nur das Ergebnis.
 * Die Sortierung betrifft nur die Anzeige: Gespielt wird weiter per Hand-Index (siehe `match.ts`).
 */
import type { CardType } from './cards';

/** Typ-Reihenfolge von links nach rechts: Einheiten, Line-, Minion-, Tower-Upgrades. */
export const HAND_TYPE_ORDER: readonly CardType[] = [
  'summon',
  'line-upgrade',
  'minion-upgrade',
  'tower-upgrade',
  'tower-specialize',
];

/**
 * Hand-Indizes in Anzeigereihenfolge (Eintrag `slot` ist der Hand-Index der Karte auf Platz `slot`).
 * Stabil: Karten desselben Typs behalten ihre Reihenfolge.
 */
export function sortHand(types: readonly CardType[]): number[] {
  return types
    .map((type, index) => ({ rank: HAND_TYPE_ORDER.indexOf(type), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.index);
}

export interface FanConfig {
  /** Breite des Spielfelds; kein Teil einer Karte soll darüber hinausragen. */
  areaWidth: number;
  /** Mittelpunkt der mittleren Karte in Ruhe. */
  baseY: number;
  cardWidth: number;
  cardHeight: number;
  /** Größter Abstand zweier Kartenmitten (bei wenigen Karten); sonst rückt die Hand enger zusammen. */
  maxStep: number;
  /** Abstand zum Rand in Pixeln. */
  sideMargin: number;
  /** Neigung in Radiant je Kartenplatz Abstand von der Mitte. */
  tiltPerSlot: number;
  /** Wie viel tiefer die äußersten Karten gegenüber der Mitte liegen. */
  arcDepth: number;
  /** Anheben einer Karte beim Hover oder Auswählen (Pixel nach oben bei lift = 1). */
  liftPixels: number;
  /** Zusätzliche Skalierung bei lift = 1. */
  liftScale: number;
}

export const HAND_FAN: FanConfig = {
  areaWidth: 360,
  baseY: 505,
  cardWidth: 74,
  cardHeight: 104,
  maxStep: 50,
  sideMargin: 2,
  tiltPerSlot: 0.055,
  arcDepth: 26,
  liftPixels: 30,
  liftScale: 0.08,
};

/** Lage einer Karte: Mittelpunkt, Drehung im Uhrzeigersinn (Radiant), Skalierung und Stapelhöhe (größer = vorn). */
export interface CardPose {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  z: number;
}

/** Ruhelage jedes Anzeigeplatzes für `count` Karten, von links nach rechts. */
export function fanLayout(count: number, config: FanConfig = HAND_FAN): CardPose[] {
  if (count <= 0) return [];
  const mid = (count - 1) / 2;
  const maxTilt = mid * config.tiltPerSlot;
  // Halbe Breite einer um `maxTilt` gedrehten Karte: dort liegt die äußerste Karte am Rand.
  const extent = (config.cardWidth / 2) * Math.cos(maxTilt) + (config.cardHeight / 2) * Math.sin(maxTilt);
  const margin = extent + config.sideMargin;
  const centerX = config.areaWidth / 2;
  const step = count === 1 ? 0 : Math.min(config.maxStep, (config.areaWidth - 2 * margin) / (count - 1));
  return Array.from({ length: count }, (_, slot) => {
    const offset = slot - mid;
    const dx = offset * step;
    const arc = (dx / (config.areaWidth / 2)) ** 2;
    return {
      x: centerX + dx,
      y: config.baseY + config.arcDepth * arc,
      rotation: offset * config.tiltPerSlot,
      scale: 1,
      z: slot,
    };
  });
}

/** Lage mit Anhebung `lift` (0 bis 1): nach oben, gerade gestellt, leicht größer und vor allen Nachbarn. */
export function liftedPose(rest: CardPose, lift: number, count: number, config: FanConfig = HAND_FAN): CardPose {
  return {
    x: rest.x,
    y: rest.y - config.liftPixels * lift,
    rotation: rest.rotation * (1 - lift),
    scale: rest.scale + config.liftScale * lift,
    z: rest.z + lift * (count + 1),
  };
}

/** Liegt der Punkt auf der (gedrehten, skalierten) Karte? */
export function poseContains(pose: CardPose, x: number, y: number, config: FanConfig = HAND_FAN): boolean {
  const dx = x - pose.x;
  const dy = y - pose.y;
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= (config.cardWidth * pose.scale) / 2 && Math.abs(localY) <= (config.cardHeight * pose.scale) / 2;
}

/**
 * Anzeigeplatz der obersten Karte unter dem Punkt, sonst `null`. `hittable` schließt Karten aus (z. B. vom Filter
 * ausgeblendete); sie lassen den Treffer auf die darunterliegende Karte durch.
 */
export function cardAt(
  poses: readonly CardPose[],
  x: number,
  y: number,
  hittable: (slot: number) => boolean = () => true,
  config: FanConfig = HAND_FAN,
): number | null {
  let best: number | null = null;
  poses.forEach((pose, slot) => {
    if (!hittable(slot) || !poseContains(pose, x, y, config)) return;
    if (best === null || pose.z > poses[best]!.z) best = slot;
  });
  return best;
}
