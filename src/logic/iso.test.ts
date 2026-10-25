import { describe, expect, it } from 'vitest';
import {
  clampScroll,
  clampZoom,
  linePointToWorld,
  mapBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  TILE_HEIGHT,
  TILE_WIDTH,
  worldToScreen,
  WORLD_SIZE,
} from './iso';

describe('Welt ↔ Iso-Bildschirm', () => {
  it('liefert nach Welt → Bildschirm → Welt den Ausgangspunkt', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 3.5, y: 7.25 },
      { x: WORLD_SIZE.x, y: WORLD_SIZE.y },
      { x: -2, y: 11 },
    ]) {
      const back = screenToWorld(worldToScreen(point));
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it('bildet die Kachel im Verhältnis 2:1 ab', () => {
    expect(TILE_WIDTH / TILE_HEIGHT).toBe(2);
    expect(worldToScreen({ x: 1, y: 0 })).toEqual({ x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
    expect(worldToScreen({ x: 0, y: 1 })).toEqual({ x: -TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
  });

  it('setzt die eigenen Tower unten, die gegnerischen oben, auf der Mitte der Line', () => {
    expect(linePointToWorld(0, 1, 0)).toEqual({ x: 6, y: WORLD_SIZE.y });
    expect(linePointToWorld(1, 1, 0)).toEqual({ x: 6, y: 0 });
    expect(linePointToWorld(0, 0, 100).y).toBe(0);
    expect(linePointToWorld(1, 2, 100).y).toBe(WORLD_SIZE.y);
  });
});

describe('Kamera-Begrenzung', () => {
  // Kleiner als die Karte (1024 × 512), damit die Grenzen greifen.
  const view = { width: 360, height: 300 };
  const bounds = mapBounds();

  it('hält den Ausschnitt innerhalb der Kartengrenzen', () => {
    for (const zoom of [1, 1.5]) {
      for (const scroll of [
        { x: -9999, y: -9999 },
        { x: 9999, y: 9999 },
        { x: bounds.x + 50, y: bounds.y + 20 },
      ]) {
        const clamped = clampScroll(scroll, view, zoom, bounds);
        expect(clamped.x).toBeGreaterThanOrEqual(bounds.x);
        expect(clamped.y).toBeGreaterThanOrEqual(bounds.y);
        expect(clamped.x + view.width / zoom).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
        expect(clamped.y + view.height / zoom).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-9);
      }
    }
  });

  it('lässt einen gültigen Offset unverändert', () => {
    const scroll = { x: bounds.x + 100, y: bounds.y + 10 };
    expect(clampScroll(scroll, { width: 360, height: 400 }, 1, bounds)).toEqual(scroll);
  });

  it('zentriert die Karte, wenn der Ausschnitt größer ist', () => {
    const clamped = clampScroll({ x: 0, y: 0 }, { width: 4000, height: 4000 }, 1, bounds);
    expect(clamped.x).toBeCloseTo(bounds.x + bounds.width / 2 - 2000, 9);
    expect(clamped.y).toBeCloseTo(bounds.y + bounds.height / 2 - 2000, 9);
  });

  it('begrenzt den Zoom', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(1.2)).toBe(1.2);
  });
});
