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
  'minion-buff',
  'lane-card',
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

/** Spielfläche, in die die Detailansicht passen muss (wie `VIEW` in der Szene). */
export const DETAIL_VIEW = { width: 360, height: 640 };

/** Gewünschte Breite der Detailansicht und Mindestabstand zum Rand der Spielfläche. */
export const DETAIL_WIDTH = 220;
export const DETAIL_MARGIN = 16;
/** Die Detailansicht ist mindestens so oft so breit wie eine Handkarte. */
export const DETAIL_MIN_SCALE = 2;
/** Mittelpunkt der Detailansicht in Anteilen der Spielfläche (etwas über der Mitte, unten bleibt Platz für den Hinweis). */
const DETAIL_CENTER_Y = 0.47;

/** Lage der Detailansicht: Mittelpunkt, Größe und Skalierung gegenüber der Handkarte. */
export interface DetailLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

/** Größe und Position der Detailansicht: Seitenverhältnis der Handkarte, begrenzt auf die Spielfläche. */
export function detailLayout(view = DETAIL_VIEW, config: FanConfig = HAND_FAN): DetailLayout {
  const maxWidth = Math.min(
    view.width - 2 * DETAIL_MARGIN,
    ((view.height - 2 * DETAIL_MARGIN) * config.cardWidth) / config.cardHeight,
  );
  const width = Math.min(DETAIL_WIDTH, maxWidth);
  const scale = width / config.cardWidth;
  return { x: view.width / 2, y: view.height * DETAIL_CENTER_Y, width, height: config.cardHeight * scale, scale };
}

/** Maße des Glanzbands: Dauer eines Durchlaufs, Anteil davon mit Band, Breite (Anteil der Kartenbreite) und Neigung. */
export const GLINT = { periodMs: 2400, sweepFraction: 0.55, bandFraction: 0.3, slant: 0.45 };

/** Fortschritt des Bands (0 bis 1) zur Zeit `elapsedMs` seit dem Öffnen; `null` in der Pause zwischen zwei Durchläufen. */
export function glintProgress(elapsedMs: number, glint = GLINT): number | null {
  const inPeriod = ((elapsedMs % glint.periodMs) + glint.periodMs) % glint.periodMs;
  const sweepMs = glint.periodMs * glint.sweepFraction;
  return inPeriod < sweepMs ? inPeriod / sweepMs : null;
}

export interface PlanePoint {
  x: number;
  y: number;
}

/** Schneidet ein Vieleck an der senkrechten Linie `x = limit`; `keepGreater`: der Teil rechts davon bleibt. */
function clipAtX(polygon: readonly PlanePoint[], limit: number, keepGreater: boolean): PlanePoint[] {
  const inside = (p: PlanePoint): boolean => (keepGreater ? p.x >= limit : p.x <= limit);
  const result: PlanePoint[] = [];
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    if (inside(current) !== inside(previous)) {
      const t = (limit - previous.x) / (current.x - previous.x);
      result.push({ x: limit, y: previous.y + t * (current.y - previous.y) });
    }
    if (inside(current)) result.push(current);
  });
  return result;
}

/**
 * Eckpunkte des diagonalen Lichtbands relativ zur Kartenmitte, begrenzt auf die Karte (Breite `width`, Höhe `height`);
 * leer in der Pause. `bandFraction` ist die Breite des Bands als Anteil der Kartenbreite.
 */
export function glintPolygon(width: number, height: number, elapsedMs: number, bandFraction: number = GLINT.bandFraction): PlanePoint[] {
  const progress = glintProgress(elapsedMs);
  if (progress === null) return [];
  const bandWidth = width * bandFraction;
  const shear = GLINT.slant * (height / 2);
  // Das Band läuft von links hinter den Rand bis rechts hinter den Rand, auch an den schrägen Enden.
  const start = -width / 2 - shear - bandWidth;
  const end = width / 2 + shear;
  const left = start + (end - start) * progress;
  const right = left + bandWidth;
  const band: PlanePoint[] = [
    { x: left - shear, y: -height / 2 },
    { x: right - shear, y: -height / 2 },
    { x: right + shear, y: height / 2 },
    { x: left + shear, y: height / 2 },
  ];
  return clipAtX(clipAtX(band, -width / 2, true), width / 2, false);
}
