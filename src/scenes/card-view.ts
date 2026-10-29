/**
 * Zeichnet eine Handkarte im Kartenspiel-Look: Rahmen in der Farbe des Kartentyps, Kopfzeile mit Namen,
 * Kosten-Kristall und Bildfläche mit Kartenbild (Rückfall: Typ-Symbol). Regeltext und Werte stehen nur in der
 * Detailansicht (`card-detail-view.ts`). Jede Karte ist ein eigener Container, der in lokalen Koordinaten um den Mittelpunkt zeichnet. Position,
 * Neigung, Skalierung und Tiefe kommen aus `CardPose` (`src/logic/hand-layout.ts`); so liegt auch der Text
 * zusammen mit seiner Karte in der richtigen Reihenfolge.
 */
import Phaser from 'phaser';
import { type CardSymbol, cardArtKey, cardTypeStyle } from '../logic/card-style';
import type { CardDef } from '../logic/cards';
import { type CardPose, HAND_FAN } from '../logic/hand-layout';
import { LabelPool } from './labels';
import { fillGradient, lerpColor, PALETTE, TEXT } from './theme';

export interface CardLook {
  /** 0 (flach) bis 1 (voll angehoben): steuert Schatten und Leuchten. */
  lift: number;
  selected: boolean;
  affordable: boolean;
  /** Passt die Karte zum Handfilter? Sonst nur eine blasse Rückseite. */
  visible: boolean;
}

/** Tiefe der Karten: über Feld, Beschriftungen und Leiste, unter den Effekten (ab 19). */
const CARD_DEPTH = 11;
const WIDTH = HAND_FAN.cardWidth;
const HEIGHT = HAND_FAN.cardHeight;
const RADIUS = 6;

/** Kleines Typ-Symbol, zentriert auf (cx, cy) mit Radius r; auch von der Detailansicht genutzt. */
export function drawSymbol(g: Phaser.GameObjects.Graphics, symbol: CardSymbol, cx: number, cy: number, r: number, color: number): void {
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
    case 'bolt':
      g.fillStyle(dark, 0.8).fillPoints(
        [
          new Phaser.Geom.Point(cx + r * 0.3, cy - r),
          new Phaser.Geom.Point(cx - r * 0.6, cy + r * 0.1),
          new Phaser.Geom.Point(cx - r * 0.05, cy + r * 0.1),
          new Phaser.Geom.Point(cx - r * 0.3, cy + r),
          new Phaser.Geom.Point(cx + r * 0.6, cy - r * 0.2),
          new Phaser.Geom.Point(cx + r * 0.05, cy - r * 0.2),
        ],
        true,
      );
      g.fillStyle(PALETTE.goldLight, 1).fillPoints(
        [
          new Phaser.Geom.Point(cx + r * 0.2, cy - r * 0.8),
          new Phaser.Geom.Point(cx - r * 0.4, cy + r * 0.05),
          new Phaser.Geom.Point(cx + r * 0.1, cy + r * 0.05),
          new Phaser.Geom.Point(cx - r * 0.2, cy + r * 0.8),
          new Phaser.Geom.Point(cx + r * 0.4, cy - r * 0.1),
          new Phaser.Geom.Point(cx - r * 0.05, cy - r * 0.1),
        ],
        true,
      );
      break;
    case 'arrow':
      g.lineStyle(Math.max(1.5, r * 0.5), PALETTE.white, 0.95);
      g.lineBetween(cx, cy + r * 0.8, cx, cy - r * 0.6);
      g.lineBetween(cx - r * 0.6, cy - r * 0.1, cx, cy - r * 0.8);
      g.lineBetween(cx + r * 0.6, cy - r * 0.1, cx, cy - r * 0.8);
      break;
    case 'shield':
      g.fillStyle(dark, 0.85).fillPoints(
        [
          new Phaser.Geom.Point(cx - r * 0.85, cy - r * 0.8),
          new Phaser.Geom.Point(cx + r * 0.85, cy - r * 0.8),
          new Phaser.Geom.Point(cx + r * 0.75, cy + r * 0.2),
          new Phaser.Geom.Point(cx, cy + r),
          new Phaser.Geom.Point(cx - r * 0.75, cy + r * 0.2),
        ],
        true,
      );
      g.fillStyle(PALETTE.white, 0.9).fillPoints(
        [
          new Phaser.Geom.Point(cx - r * 0.6, cy - r * 0.6),
          new Phaser.Geom.Point(cx + r * 0.6, cy - r * 0.6),
          new Phaser.Geom.Point(cx + r * 0.5, cy + r * 0.1),
          new Phaser.Geom.Point(cx, cy + r * 0.7),
          new Phaser.Geom.Point(cx - r * 0.5, cy + r * 0.1),
        ],
        true,
      );
      break;
  }
}

/** Kosten-Kristall (Raute) mit Zahl, zentriert auf (cx, cy) mit Radius cr; auch von der Detailansicht genutzt. */
export function drawCostCrystal(
  g: Phaser.GameObjects.Graphics,
  pool: LabelPool,
  cost: number,
  cx: number,
  cy: number,
  cr: number,
  affordable: boolean,
  alpha: number,
): void {
  const diamond = [
    new Phaser.Geom.Point(cx, cy - cr),
    new Phaser.Geom.Point(cx + cr * 0.85, cy),
    new Phaser.Geom.Point(cx, cy + cr),
    new Phaser.Geom.Point(cx - cr * 0.85, cy),
  ];
  g.fillStyle(PALETTE.goldDark, 1).fillPoints(diamond, true);
  const inner = diamond.map((p) => new Phaser.Geom.Point(cx + (p.x - cx) * 0.78, cy + (p.y - cy) * 0.78));
  g.fillStyle(affordable ? PALETTE.energy : PALETTE.stoneDark, 1).fillPoints(inner, true);
  g.fillStyle(PALETTE.white, 0.4).fillPoints([inner[0]!, inner[1]!, new Phaser.Geom.Point(cx, cy)], true);
  pool.label(`${cost}`, cx, cy + cr * 0.05, { size: cr * 1.26, font: 'heading', bold: true, color: TEXT.main, alpha });
}

export class CardView {
  private readonly container: Phaser.GameObjects.Container;
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly art: Phaser.GameObjects.Image;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly pool: LabelPool;

  constructor(private readonly scene: Phaser.Scene) {
    this.back = scene.add.graphics();
    this.art = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.front = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.back, this.art, this.front]).setDepth(CARD_DEPTH).setVisible(false);
    this.pool = new LabelPool(scene, this.container);
  }

  hide(): void {
    this.container.setVisible(false);
  }

  /** Zeichnet die Karte neu und stellt sie in die Lage `pose`. */
  update(pose: CardPose, def: CardDef, look: CardLook): void {
    const container = this.container;
    // Tiefe ist ein kleiner Bruchteil, damit auch die höchste Karte unter den Effekten bleibt.
    container
      .setPosition(pose.x, pose.y)
      .setRotation(pose.rotation)
      .setScale(pose.scale)
      .setDepth(CARD_DEPTH + pose.z * 0.01)
      .setVisible(true);
    const { back, front, art, pool } = this;
    back.clear();
    front.clear();
    pool.reset();
    art.setVisible(false);

    const x = -WIDTH / 2;
    const y = -HEIGHT / 2;
    if (!look.visible) {
      back.fillStyle(PALETTE.panelDark, 0.25).fillRoundedRect(x, y, WIDTH, HEIGHT, RADIUS);
      back.lineStyle(1, PALETTE.stoneDark, 0.3).strokeRoundedRect(x, y, WIDTH, HEIGHT, RADIUS);
      pool.hideUnused();
      return;
    }

    const style = cardTypeStyle(def.type);
    const lift = look.lift;
    const textAlpha = look.affordable ? 1 : 0.7;

    // Schatten, bei angehobener Karte weiter und weicher.
    back.fillStyle(PALETTE.black, 0.3).fillRoundedRect(x + 1 + 3 * lift, y + 2 + 5 * lift, WIDTH, HEIGHT, RADIUS);
    back.fillStyle(PALETTE.black, 0.15 * lift).fillRoundedRect(x + 2 + 5 * lift, y + 4 + 8 * lift, WIDTH, HEIGHT, RADIUS);

    // Leuchten: Auswahl in Gold, Hover in der Typfarbe.
    const glowColor = look.selected ? PALETTE.gold : style.accent;
    const glow = look.selected ? Math.max(lift, 0.8) : lift;
    if (glow > 0.02) {
      for (let ring = 4; ring >= 1; ring -= 1) {
        back.lineStyle(ring * 2, glowColor, 0.16 * glow).strokeRoundedRect(x - ring, y - ring, WIDTH + ring * 2, HEIGHT + ring * 2, RADIUS + ring);
      }
    }

    // Rahmen: Typfarbe außen, Gold/Typfarbe innen, Pergament-Grund.
    back.fillStyle(lerpColor(style.accent, PALETTE.black, 0.45), 1).fillRoundedRect(x, y, WIDTH, HEIGHT, RADIUS);
    back.fillStyle(look.selected ? PALETTE.goldLight : style.accent, 1).fillRoundedRect(x + 1, y + 1, WIDTH - 2, HEIGHT - 2, RADIUS - 1);
    back.fillStyle(PALETTE.panelDark, 1).fillRoundedRect(x + 2, y + 2, WIDTH - 4, HEIGHT - 4, RADIUS - 2);

    // Kopfzeile mit Namen; lange Namen werden kleiner oder brechen um (Platz für zwei Zeilen).
    fillGradient(back, x + 2.5, y + 2.5, WIDTH - 5, 21.5, lerpColor(style.accent, PALETTE.white, 0.15), style.dark, 1, 5);
    const longest = Math.max(...def.name.split(' ').map((word) => word.length));
    pool.label(def.name, x + 46, y + 13.5, {
      size: longest >= 11 ? 6.5 : longest >= 9 ? 7.5 : 8.5,
      font: 'heading',
      bold: true,
      stroke: 2,
      width: 50,
      alpha: textAlpha,
    });

    // Bildfläche über den Rest der Karte: eigenes Kartenbild (mittig zugeschnitten, ohne Verzerrung), sonst Typ-Symbol.
    // Den Regeltext zeigt erst die Detailansicht (langes Drücken).
    const artX = x + 3.5;
    const artY = y + 26;
    const artW = WIDTH - 7;
    const artH = HEIGHT - 30;
    fillGradient(back, artX, artY, artW, artH, style.dark, lerpColor(style.accent, PALETTE.black, 0.25), 1, 6);
    const key = cardArtKey(def);
    if (key && this.scene.textures.exists(key)) {
      const frame = this.scene.textures.getFrame(key);
      const shownW = (artH * frame.width) / frame.height;
      const cropW = Math.min(frame.width, (artW / shownW) * frame.width);
      art
        .setTexture(key)
        .setCrop((frame.width - cropW) / 2, 0, cropW, frame.height)
        .setPosition(artX + artW / 2, artY + artH / 2)
        .setDisplaySize(shownW, artH)
        .setVisible(true);
    } else {
      back.fillStyle(PALETTE.white, 0.1).fillCircle(artX + artW / 2, artY + artH / 2, artH * 0.4);
      drawSymbol(back, style.symbol, artX + artW / 2, artY + artH / 2, 18, style.accent);
    }
    front.lineStyle(1, PALETTE.goldDark, 1).strokeRect(artX, artY, artW, artH);

    // Kosten-Kristall (Raute, überlappt die Ecke).
    drawCostCrystal(front, pool, def.cost, x + 9, y + 11, 9.5, look.affordable, textAlpha);

    // Nicht bezahlbar: Karte abdunkeln (deckend, damit keine Nachbarkarte durchscheint).
    if (!look.affordable) front.fillStyle(PALETTE.black, 0.38).fillRoundedRect(x, y, WIDTH, HEIGHT, RADIUS);

    pool.hideUnused();
  }
}
