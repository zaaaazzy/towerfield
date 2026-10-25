/**
 * Isometrische Karte (halb-diagonale Draufsicht, Kacheln 2:1) und Kamera-Begrenzung. Ohne Phaser.
 * Weltraum: Kachel-Einheiten, x quer zu den Lines, y entlang der Lines. Bildschirmraum: Pixel bei Zoom 1.
 */
import { LINE_LENGTH } from './combat';
import { clamp, type Vector } from './game-state';
import { LINE_COUNT } from './match';

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
/** Breite einer Line in Kacheln. */
export const LANE_TILES = 4;
/** Eine Kachel entspricht so vielen Line-Einheiten; die Line (100) ist damit 20 Kacheln lang. */
export const UNITS_PER_TILE = 5;
export const WORLD_SIZE: Vector = { x: LINE_COUNT * LANE_TILES, y: LINE_LENGTH / UNITS_PER_TILE };
/** Bei 0.35 passt die ganze Kartenbreite (1024 px) auf die Ansichtsbreite von 360 px. */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function worldToScreen(world: Vector): Vector {
  return { x: ((world.x - world.y) * TILE_WIDTH) / 2, y: ((world.x + world.y) * TILE_HEIGHT) / 2 };
}

export function screenToWorld(screen: Vector): Vector {
  const a = (screen.x * 2) / TILE_WIDTH;
  const b = (screen.y * 2) / TILE_HEIGHT;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * Weltpunkt einer Line-Position. Spieler 0 steht unten (eigener Tower bei y = `WORLD_SIZE.y`), Spieler 1 oben (y = 0);
 * die Position zählt jeweils vom eigenen Tower weg.
 */
export function linePointToWorld(playerIndex: 0 | 1, line: number, position: number): Vector {
  const along = position / UNITS_PER_TILE;
  return { x: (line + 0.5) * LANE_TILES, y: playerIndex === 0 ? WORLD_SIZE.y - along : along };
}

/** Umschließendes Rechteck der Karte im Bildschirmraum bei Zoom 1 (Rand der vier Eckpunkte). */
export function mapBounds(): Rect {
  const corners = [
    worldToScreen({ x: 0, y: 0 }),
    worldToScreen({ x: WORLD_SIZE.x, y: 0 }),
    worldToScreen({ x: 0, y: WORLD_SIZE.y }),
    worldToScreen({ x: WORLD_SIZE.x, y: WORLD_SIZE.y }),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Hält den Scroll-Offset (linke obere Ecke des Ausschnitts im Bildschirmraum bei Zoom 1) so, dass der Ausschnitt
 * der Größe `view` Pixel bei `zoom` in der Karte bleibt. Ist die Karte kleiner als der Ausschnitt, wird sie zentriert.
 */
export function clampScroll(
  scroll: Vector,
  view: { width: number; height: number },
  zoom: number,
  bounds: Rect = mapBounds(),
): Vector {
  const z = clampZoom(zoom);
  const axis = (value: number, start: number, size: number, viewSize: number): number => {
    const visible = viewSize / z;
    if (size <= visible) return start + (size - visible) / 2;
    return clamp(value, start, start + size - visible);
  };
  return {
    x: axis(scroll.x, bounds.x, bounds.width, view.width),
    y: axis(scroll.y, bounds.y, bounds.height, view.height),
  };
}
