/**
 * Zeichnet eine Handkarte im Kartenspiel-Look: Rahmen in der Farbe des Kartentyps, Kopfzeile mit Namen,
 * Kosten-Kristall, Bildfläche mit Typ-Symbol, Textfeld und Typ-Banner. Hover/Auswahl hebt die Karte an
 * (Skalierung, Schatten, Leuchten). Trefferfläche und Layout der Hand bleiben bei `cardRect` der Szene.
 */
import Phaser from 'phaser';
import { type CardSymbol, cardTypeStyle, describeCard } from '../logic/card-style';
import type { CardDef } from '../logic/cards';
import type { LabelFn } from './labels';
import { fillGradient, lerpColor, PALETTE, TEXT } from './theme';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardLook {
  /** 0 (flach) bis 1 (voll angehoben). */
  lift: number;
  selected: boolean;
  affordable: boolean;
  /** Passt die Karte zum Handfilter? Sonst nur eine blasse Rückseite. */
  visible: boolean;
}

const LIFT_SCALE = 0.1;
const LIFT_PIXELS = 9;

/** Kleines Typ-Symbol, zentriert auf (cx, cy) mit Radius r. */
function drawSymbol(g: Phaser.GameObjects.Graphics, symbol: CardSymbol, cx: number, cy: number, r: number, color: number): void {
  const dark = lerpColor(color, PALETTE.black, 0.55);
  g.lineStyle(Math.max(1, r * 0.55), dark, 0.8);
  switch (symbol) {
    case 'sword':
      g.lineBetween(cx - r * 0.8, cy + r * 0.8, cx + r * 0.8, cy - r * 0.8);
      g.lineBetween(cx - r * 0.2, cy - r * 0.2 + r * 0.4, cx + r * 0.4, cy + r * 0.2 + r * 0.4);
      g.lineStyle(Math.max(1, r * 0.3), PALETTE.white, 0.95);
      g.lineBetween(cx - r * 0.8, cy + r * 0.8, cx + r * 0.8, cy - r * 0.8);
      g.lineStyle(Math.max(1, r * 0.3), PALETTE.goldLight, 1);
      g.lineBetween(cx - r * 0.3, cy + r * 0.1, cx + r * 0.1, cy + r * 0.5);
      break;
    case 'tower':
      g.fillStyle(dark, 0.8).fillRect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.6);
      g.fillStyle(PALETTE.stone, 1).fillRect(cx - r * 0.6, cy - r * 0.5, r * 1.2, r * 1.3);
      for (const dx of [-0.6, -0.1, 0.4]) g.fillStyle(PALETTE.stone, 1).fillRect(cx + r * dx, cy - r * 0.9, r * 0.25, r * 0.45);
      g.fillStyle(dark, 1).fillRect(cx - r * 0.12, cy + r * 0.1, r * 0.24, r * 0.7);
      break;
    case 'gem':
      g.fillStyle(dark, 0.8).fillPoints(
        [new Phaser.Geom.Point(cx, cy - r), new Phaser.Geom.Point(cx + r * 0.8, cy), new Phaser.Geom.Point(cx, cy + r), new Phaser.Geom.Point(cx - r * 0.8, cy)],
        true,
      );
      g.fillStyle(PALETTE.white, 0.85).fillPoints(
        [new Phaser.Geom.Point(cx, cy - r * 0.8), new Phaser.Geom.Point(cx + r * 0.5, cy), new Phaser.Geom.Point(cx, cy + r * 0.2), new Phaser.Geom.Point(cx - r * 0.5, cy)],
        true,
      );
      break;
    case 'arrow':
      g.lineStyle(Math.max(1.5, r * 0.5), PALETTE.white, 0.95);
      g.lineBetween(cx, cy + r * 0.8, cx, cy - r * 0.6);
      g.lineBetween(cx - r * 0.6, cy - r * 0.1, cx, cy - r * 0.8);
      g.lineBetween(cx + r * 0.6, cy - r * 0.1, cx, cy - r * 0.8);
      break;
  }
}

/** Lebensgroße Schrift in `size` Pixeln, skaliert mit der Karte. */
const scaled = (size: number, s: number): number => Math.round(size * s * 10) / 10;

export function drawCard(g: Phaser.GameObjects.Graphics, label: LabelFn, rect: Rect, def: CardDef, look: CardLook): void {
  const style = cardTypeStyle(def.type);
  const lift = look.lift;
  const s = 1 + LIFT_SCALE * lift;
  const w = rect.width * s;
  const h = rect.height * s;
  const x = rect.x + (rect.width - w) / 2;
  const y = rect.y + (rect.height - h) / 2 - LIFT_PIXELS * lift;
  const radius = 6;

  if (!look.visible) {
    g.fillStyle(PALETTE.panelDark, 0.25).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
    g.lineStyle(1, PALETTE.stoneDark, 0.3).strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
    return;
  }

  const alpha = look.affordable ? 1 : 0.6;
  const textAlpha = look.affordable ? 1 : 0.65;

  // Schatten, bei angehobener Karte weiter und weicher.
  g.fillStyle(PALETTE.black, 0.3).fillRoundedRect(x + 1 + 3 * lift, y + 2 + 5 * lift, w, h, radius);
  g.fillStyle(PALETTE.black, 0.15 * lift).fillRoundedRect(x + 2 + 5 * lift, y + 4 + 8 * lift, w, h, radius);

  // Leuchten: Auswahl in Gold, Hover in der Typfarbe.
  const glowColor = look.selected ? PALETTE.gold : style.accent;
  const glow = look.selected ? Math.max(lift, 0.8) : lift;
  if (glow > 0.02) {
    for (let ring = 4; ring >= 1; ring -= 1) {
      g.lineStyle(ring * 2, glowColor, 0.16 * glow).strokeRoundedRect(x - ring, y - ring, w + ring * 2, h + ring * 2, radius + ring);
    }
  }

  // Rahmen: Typfarbe außen, Gold/Bronze innen, Pergament-Grund.
  g.fillStyle(lerpColor(style.accent, PALETTE.black, 0.45), alpha).fillRoundedRect(x, y, w, h, radius);
  g.fillStyle(look.selected ? PALETTE.goldLight : style.accent, alpha).fillRoundedRect(x + s, y + s, w - 2 * s, h - 2 * s, radius - 1);
  g.fillStyle(PALETTE.panelDark, alpha).fillRoundedRect(x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, radius - 2);

  // Kopfzeile mit Namen.
  fillGradient(g, x + 2.5 * s, y + 2.5 * s, w - 5 * s, 12 * s, lerpColor(style.accent, PALETTE.white, 0.15), style.dark, alpha, 4);
  label(def.name, x + w / 2 + 7 * s, y + 8.5 * s, {
    size: scaled(def.name.length >= 12 ? 6 : def.name.length > 9 ? 7 : 8, s),
    font: 'heading',
    bold: true,
    stroke: 2,
    alpha: textAlpha,
  });

  // Bildfläche mit Symbol.
  const artX = x + 3.5 * s;
  const artY = y + 16 * s;
  const artW = w - 7 * s;
  const artH = 15 * s;
  fillGradient(g, artX, artY, artW, artH, style.dark, lerpColor(style.accent, PALETTE.black, 0.25), alpha, 4);
  g.fillStyle(PALETTE.white, 0.1 * alpha).fillCircle(artX + artW / 2, artY + artH / 2, artH * 0.55);
  g.lineStyle(1, PALETTE.goldDark, alpha).strokeRect(artX, artY, artW, artH);
  drawSymbol(g, style.symbol, artX + artW / 2, artY + artH / 2, 5.2 * s, style.accent);

  // Textfeld.
  const textY = y + 32.5 * s;
  const textH = 17 * s;
  g.fillStyle(0x3a3068, 0.9 * alpha).fillRect(x + 3.5 * s, textY, w - 7 * s, textH);
  g.lineStyle(1, PALETTE.bronze, 0.7 * alpha).strokeRect(x + 3.5 * s, textY, w - 7 * s, textH);
  label(describeCard(def), x + w / 2, textY + textH / 2, {
    size: scaled(6.5, s),
    width: w - 11 * s,
    stroke: 1,
    alpha: textAlpha,
  });

  // Typ-Banner.
  const bannerY = y + h - 11 * s;
  fillGradient(g, x + 2.5 * s, bannerY, w - 5 * s, 8.5 * s, style.accent, style.dark, alpha, 3);
  label(style.banner, x + w / 2, bannerY + 4.5 * s, { size: scaled(6, s), bold: true, stroke: 1, alpha: textAlpha });

  // Kosten-Kristall (Raute, überlappt die Ecke).
  const cx = x + 8 * s;
  const cy = y + 8.5 * s;
  const cr = 7.5 * s;
  const diamond = [
    new Phaser.Geom.Point(cx, cy - cr),
    new Phaser.Geom.Point(cx + cr * 0.85, cy),
    new Phaser.Geom.Point(cx, cy + cr),
    new Phaser.Geom.Point(cx - cr * 0.85, cy),
  ];
  g.fillStyle(PALETTE.goldDark, alpha).fillPoints(diamond, true);
  const inner = diamond.map((p) => new Phaser.Geom.Point(cx + (p.x - cx) * 0.78, cy + (p.y - cy) * 0.78));
  g.fillStyle(look.affordable ? PALETTE.energy : PALETTE.stoneDark, alpha).fillPoints(inner, true);
  g.fillStyle(PALETTE.white, 0.4 * alpha).fillPoints([inner[0]!, inner[1]!, new Phaser.Geom.Point(cx, cy)], true);
  label(`${def.cost}`, cx, cy + 0.5, { size: scaled(10, s), font: 'heading', bold: true, color: TEXT.main, alpha: textAlpha });
}
