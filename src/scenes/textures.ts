/**
 * Generierte Texturen (keine Bilddateien nötig, siehe docs/grafik-stil.md): Hintergrund mit Verlauf, Boden, Wegen und
 * Vignette sowie Partikel- und Leuchttexturen. Das Muster ist fest (eigener Zeichen-Zufall, kein Spielzufall) und
 * ändert weder Regeln noch Seed.
 */
import Phaser from 'phaser';
import { PALETTE } from './theme';

export const TEXTURE_KEYS = {
  backdrop: 'backdrop',
  spark: 'spark',
  glow: 'glow',
  arrow: 'arrow',
  sword: 'sword',
  splinter: 'splinter',
} as const;

/** Wo Boden, Wege und Hand-Tisch liegen; ohne Angabe gibt es nur Verlauf und Vignette (z. B. Balance-Szene). */
export interface FieldGeometry {
  width: number;
  height: number;
  /** y-Mitte jeder Lane (waagrechte Wege), von oben nach unten oder in Lane-Reihenfolge. */
  laneCenters: readonly number[];
  /** x des linken (eigenen) und des rechten (gegnerischen) Lane-Endes. */
  leftX: number;
  rightX: number;
  /** Halbe Höhe eines Wegs. */
  pathHalfHeight: number;
  /** Oberkante des Hand-Tischs. */
  handTop: number;
}

const css = (color: number, alpha = 1): string => {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
};

/** Kleiner fester Zufallsgenerator nur für die Bildmuster. */
function patternRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, field?: FieldGeometry): void {
  const random = patternRandom(7);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, css(PALETTE.bgDeep));
  sky.addColorStop(0.45, css(PALETTE.bgMid));
  sky.addColorStop(1, css(PALETTE.bgDeep));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, height * 0.38, 10, width / 2, height * 0.38, height * 0.6);
  glow.addColorStop(0, css(PALETTE.bgLight, 0.55));
  glow.addColorStop(1, css(PALETTE.bgLight, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 120; index += 1) {
    ctx.fillStyle = css(PALETTE.goldLight, 0.05 + random() * 0.25);
    ctx.fillRect(random() * width, random() * height, 1 + random(), 1 + random());
  }

  if (field) paintField(ctx, field, random);

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.28, width / 2, height / 2, height * 0.72);
  vignette.addColorStop(0, css(PALETTE.black, 0));
  vignette.addColorStop(1, css(PALETTE.black, 0.62));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function paintField(ctx: CanvasRenderingContext2D, field: FieldGeometry, random: () => number): void {
  const left = 8;
  const right = field.width - 8;
  const topLane = Math.min(...field.laneCenters);
  const bottomLane = Math.max(...field.laneCenters);
  const top = topLane - field.pathHalfHeight - 14;
  const bottom = bottomLane + field.pathHalfHeight + 22;

  // Boden mit Rahmen und Körnung.
  const ground = ctx.createLinearGradient(0, top, 0, bottom);
  ground.addColorStop(0, css(0x2a2f5a));
  ground.addColorStop(0.5, css(PALETTE.ground));
  ground.addColorStop(1, css(0x1a2140));
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, bottom - top, 10);
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let index = 0; index < 700; index += 1) {
    ctx.fillStyle = random() < 0.5 ? css(PALETTE.black, 0.12) : css(PALETTE.stone, 0.08);
    ctx.fillRect(left + random() * (right - left), top + random() * (bottom - top), 1 + random() * 2, 1 + random() * 2);
  }
  // Mittellinie des Felds (senkrecht, dort treffen sich die Wellen).
  const middle = (field.leftX + field.rightX) / 2;
  const band = ctx.createLinearGradient(middle - 20, 0, middle + 20, 0);
  band.addColorStop(0, css(PALETTE.gold, 0));
  band.addColorStop(0.5, css(PALETTE.gold, 0.12));
  band.addColorStop(1, css(PALETTE.gold, 0));
  ctx.fillStyle = band;
  ctx.fillRect(middle - 20, top, 40, bottom - top);
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = css(PALETTE.bronzeDark);
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, bottom - top, 10);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(PALETTE.bronze, 0.9);
  ctx.beginPath();
  ctx.roundRect(left + 1.5, top + 1.5, right - left - 3, bottom - top - 3, 9);
  ctx.stroke();

  // Wege: Steinplatten mit Fugen und Rand.
  for (const center of field.laneCenters) {
    const x = field.leftX - 14;
    const w = field.rightX - field.leftX + 28;
    const h = field.pathHalfHeight * 2;
    const y = center - field.pathHalfHeight;
    const path = ctx.createLinearGradient(0, y, 0, y + h);
    path.addColorStop(0, css(0x2e2a4a));
    path.addColorStop(0.5, css(PALETTE.path));
    path.addColorStop(1, css(0x2e2a4a));
    ctx.fillStyle = path;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css(PALETTE.pathEdge, 0.7);
    ctx.lineWidth = 1;
    for (let column = 0, px = x; px < x + w; column += 1, px += 12) {
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + h);
      ctx.moveTo(px, y + (column % 2 === 0 ? h * 0.35 : h * 0.65));
      ctx.lineTo(px + 12, y + (column % 2 === 0 ? h * 0.35 : h * 0.65));
      ctx.stroke();
    }
    for (let index = 0; index < 60; index += 1) {
      ctx.fillStyle = css(random() < 0.5 ? PALETTE.black : PALETTE.stone, 0.12);
      ctx.fillRect(x + random() * w, y + random() * h, 2, 2);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = css(PALETTE.pathEdge);
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = css(PALETTE.stone, 0.45);
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }

  // Hand-Tisch aus Holz mit Maserung und Goldkante.
  const tableTop = field.handTop - 12;
  const wood = ctx.createLinearGradient(0, tableTop, 0, field.height);
  wood.addColorStop(0, css(0x4a2f2a));
  wood.addColorStop(1, css(0x24141c));
  ctx.fillStyle = wood;
  ctx.fillRect(0, tableTop, field.width, field.height - tableTop);
  for (let index = 0; index < 46; index += 1) {
    const y = tableTop + random() * (field.height - tableTop);
    ctx.strokeStyle = css(random() < 0.5 ? PALETTE.black : PALETTE.bronze, 0.1 + random() * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(field.width * 0.3, y + random() * 4 - 2, field.width * 0.6, y + random() * 4 - 2, field.width, y);
    ctx.stroke();
  }
  ctx.fillStyle = css(PALETTE.goldDark);
  ctx.fillRect(0, tableTop, field.width, 3);
  ctx.fillStyle = css(PALETTE.gold, 0.9);
  ctx.fillRect(0, tableTop, field.width, 1);
}

function createCanvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) return;
  paint(texture.getContext());
  texture.refresh();
}

/** Legt Partikel- und Leuchttexturen an (einmal pro Spiel). */
export function ensureTextures(scene: Phaser.Scene): void {
  createCanvasTexture(scene, TEXTURE_KEYS.spark, 16, 16, (ctx) => {
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
  });
  createCanvasTexture(scene, TEXTURE_KEYS.glow, 64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
  // Holzpfeil, Spitze nach rechts (Rotation 0 = Flug nach rechts): Federn, Schaft, Eisenspitze.
  createCanvasTexture(scene, TEXTURE_KEYS.arrow, 22, 6, (ctx) => {
    ctx.fillStyle = css(0xe8dcc0);
    ctx.fillRect(0, 0, 4, 2);
    ctx.fillRect(0, 4, 4, 2);
    ctx.fillStyle = css(PALETTE.bronze);
    ctx.fillRect(1, 2, 16, 2);
    ctx.fillStyle = css(PALETTE.stone);
    ctx.beginPath();
    ctx.moveTo(16, 0.5);
    ctx.lineTo(22, 3);
    ctx.lineTo(16, 5.5);
    ctx.closePath();
    ctx.fill();
  });
  // Schwert, Klinge nach rechts: Lederknauf, Bronze-Parierstange, Stahlklinge mit dunkler Kante.
  createCanvasTexture(scene, TEXTURE_KEYS.sword, 26, 8, (ctx) => {
    ctx.fillStyle = css(PALETTE.bronzeDark);
    ctx.fillRect(0, 3, 6, 2);
    ctx.fillStyle = css(PALETTE.bronze);
    ctx.fillRect(6, 0, 2, 8);
    ctx.fillStyle = css(PALETTE.stoneDark);
    ctx.beginPath();
    ctx.moveTo(8, 1.5);
    ctx.lineTo(22, 1.5);
    ctx.lineTo(26, 4);
    ctx.lineTo(22, 6.5);
    ctx.lineTo(8, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(0xdfe6ee);
    ctx.fillRect(8, 2.5, 14, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(9, 3, 12, 1);
  });
  // Weisser Splitter, wird beim Ausstoss holzfarben eingefärbt.
  createCanvasTexture(scene, TEXTURE_KEYS.splinter, 6, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 6, 2);
  });
}

/** Fügt den Hintergrund (Verlauf, Vignette, optional Boden, Wege und Tisch) hinter alle anderen Objekte. */
export function addBackdrop(scene: Phaser.Scene, width: number, height: number, field?: FieldGeometry): void {
  ensureTextures(scene);
  const key = field ? TEXTURE_KEYS.backdrop : `${TEXTURE_KEYS.backdrop}-plain`;
  createCanvasTexture(scene, key, width, height, (ctx) => paintBackdrop(ctx, width, height, field));
  scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(-100);
}
