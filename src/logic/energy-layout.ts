/**
 * Layout der Energie-Leiste unten links: Rahmen, Kristall (Raute) und Textpositionen.
 * Reine Zahlen ohne Phaser; die Szene wandelt die Punkte beim Zeichnen um.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rahmen der Leiste in Weltkoordinaten. */
export const ENERGY_BAR: Rect = { x: 6, y: 597, width: 108, height: 27 };

/** Mittelpunkt des Kristalls. */
export const ENERGY_CRYSTAL_CENTER: Pt = { x: 22, y: 611 };

/** Halbe Breite und Höhe der Raute. */
export const ENERGY_CRYSTAL_HALF = { width: 6, height: 8 };

/** Verkleinerung der inneren Raute gegenüber der äußeren. */
export const ENERGY_INNER_SCALE = 0.75;

/** Radius des Leuchtkreises hinter dem Kristall. */
export const ENERGY_GLOW_RADIUS = 11;

/** Ecke des Glanzdreiecks relativ zum Mittelpunkt (neben der oberen Spitze). */
export const ENERGY_SHINE_OFFSET: Pt = { x: 4, y: -1 };

/** Beschriftung „Energie n“ und Meldungszeile. */
export const ENERGY_LABEL: Pt = { x: 72, y: 612 };
export const ENERGY_MESSAGE: Pt = { x: 70, y: 632 };

export interface EnergyCrystalLayout {
  center: Pt;
  glowRadius: number;
  /** Äußere Raute: oben, rechts, unten, links. */
  outer: [Pt, Pt, Pt, Pt];
  /** Innere Raute, um den Mittelpunkt verkleinert. */
  inner: [Pt, Pt, Pt, Pt];
  /** Glanzdreieck: obere Spitze, Punkt rechts davon, Mittelpunkt. */
  shine: [Pt, Pt, Pt];
}

/** Eckpunkte des Kristalls um `center`. */
export function energyCrystalLayout(center: Pt = ENERGY_CRYSTAL_CENTER): EnergyCrystalLayout {
  const { width, height } = ENERGY_CRYSTAL_HALF;
  const outer: EnergyCrystalLayout['outer'] = [
    { x: center.x, y: center.y - height },
    { x: center.x + width, y: center.y },
    { x: center.x, y: center.y + height },
    { x: center.x - width, y: center.y },
  ];
  const scaled = (p: Pt): Pt => ({
    x: center.x + (p.x - center.x) * ENERGY_INNER_SCALE,
    y: center.y + (p.y - center.y) * ENERGY_INNER_SCALE,
  });
  return {
    center: { ...center },
    glowRadius: ENERGY_GLOW_RADIUS,
    outer,
    inner: [scaled(outer[0]), scaled(outer[1]), scaled(outer[2]), scaled(outer[3])],
    shine: [
      { ...outer[0] },
      { x: center.x + ENERGY_SHINE_OFFSET.x, y: center.y + ENERGY_SHINE_OFFSET.y },
      { ...center },
    ],
  };
}
