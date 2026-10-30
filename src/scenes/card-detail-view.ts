/**
 * Große Detailansicht einer Handkarte (langes Drücken): abgedunkelter Hintergrund, Karte mit Kartenbild, Namen,
 * Kosten, vollem Regeltext und Typ-Banner sowie ein diagonales Lichtband, das über die Karte wandert. Maße und
 * Band kommen aus `src/logic/hand-layout.ts`; die Animation läuft über die Zeit seit dem Öffnen (aus `delta`).
 * Alles liegt in einem Container in Spielkoordinaten, über Karten und Effekten.
 */
import Phaser from 'phaser';
import { cardArtKey, cardTypeStyle, describeCard } from '../logic/card-style';
import type { CardDef } from '../logic/cards';
import { detailLayout, glintPolygon } from '../logic/hand-layout';
import { drawCostCrystal, drawSymbol } from './card-view';
import { LabelPool } from './labels';
import { fillGradient, FX_COLOR, lerpColor, PALETTE, TEXT } from './theme';

/** Tiefe: über Handkarten (ab 11), Beschriftungen und Effekten (ab 19). */
const DETAIL_DEPTH = 40;
const RADIUS = 14;

export class CardDetailView {
  private readonly container: Phaser.GameObjects.Container;
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly art: Phaser.GameObjects.Image;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly glint: Phaser.GameObjects.Graphics;
  private readonly pool: LabelPool;
  /** Zeit seit dem Öffnen in Millisekunden; steuert das Lichtband. */
  private elapsedMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly view: { width: number; height: number },
  ) {
    this.back = scene.add.graphics();
    this.art = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.front = scene.add.graphics();
    this.glint = scene.add.graphics();
    this.container = scene.add
      .container(0, 0, [this.back, this.art, this.front, this.glint])
      .setDepth(DETAIL_DEPTH)
      .setVisible(false);
    this.pool = new LabelPool(scene, this.container);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  hide(): void {
    this.container.setVisible(false);
    this.elapsedMs = 0;
  }

  /** Zeichnet die Detailansicht neu; `deltaMs` ist die Zeit seit dem letzten Bild (0 beim ersten Zeichnen). */
  update(def: CardDef, affordable: boolean, deltaMs: number): void {
    if (!this.container.visible) this.elapsedMs = 0;
    else this.elapsedMs += deltaMs;
    this.container.setVisible(true);
    const { back, front, art, glint, pool } = this;
    back.clear();
    front.clear();
    glint.clear();
    pool.reset();
    art.setVisible(false);

    const layout = detailLayout(this.view);
    const { width, height } = layout;
    const x = layout.x - width / 2;
    const y = layout.y - height / 2;
    // Alle Maße als Vielfache der Kartenbreite, damit die Ansicht bei anderer Größe mitwächst.
    const unit = width / 220;
    const style = cardTypeStyle(def.type);
    const textAlpha = affordable ? 1 : 0.8;

    back.fillStyle(PALETTE.black, 0.78).fillRect(0, 0, this.view.width, this.view.height);
    back.fillStyle(PALETTE.black, 0.4).fillRoundedRect(x + 4 * unit, y + 8 * unit, width, height, RADIUS * unit);

    // Rahmen: Typfarbe außen und innen, Pergament-Grund.
    back.lineStyle(10 * unit, style.accent, 0.18).strokeRoundedRect(x - 4 * unit, y - 4 * unit, width + 8 * unit, height + 8 * unit, (RADIUS + 4) * unit);
    back.fillStyle(lerpColor(style.accent, PALETTE.black, 0.45), 1).fillRoundedRect(x, y, width, height, RADIUS * unit);
    back.fillStyle(style.accent, 1).fillRoundedRect(x + 3 * unit, y + 3 * unit, width - 6 * unit, height - 6 * unit, (RADIUS - 3) * unit);
    back.fillStyle(PALETTE.panelDark, 1).fillRoundedRect(x + 6 * unit, y + 6 * unit, width - 12 * unit, height - 12 * unit, (RADIUS - 6) * unit);

    // Kopfzeile mit Namen (Platz rechts vom Kosten-Kristall).
    const headerY = y + 8 * unit;
    const headerH = 52 * unit;
    fillGradient(back, x + 8 * unit, headerY, width - 16 * unit, headerH, lerpColor(style.accent, PALETTE.white, 0.15), style.dark, 1, 8);
    const longest = Math.max(...def.name.split(' ').map((word) => word.length));
    pool.label(def.name, x + 128 * unit, headerY + headerH / 2, {
      size: (longest >= 11 ? 17 : 21) * unit,
      font: 'heading',
      bold: true,
      stroke: 3,
      width: 150 * unit,
      alpha: textAlpha,
    });

    // Bildfläche mit Kartenbild (Seitenverhältnis der SVG), sonst großes Typ-Symbol.
    const artX = x + 8 * unit;
    const artY = headerY + headerH + 6 * unit;
    const artW = width - 16 * unit;
    const artH = (artW * 144) / 268;
    fillGradient(back, artX, artY, artW, artH, style.dark, lerpColor(style.accent, PALETTE.black, 0.25), 1, 8);
    const key = cardArtKey(def);
    if (key && this.scene.textures.exists(key)) {
      art.setTexture(key).setCrop().setPosition(artX + artW / 2, artY + artH / 2).setDisplaySize(artW, artH).setVisible(true);
    } else {
      back.fillStyle(PALETTE.white, 0.1).fillCircle(artX + artW / 2, artY + artH / 2, artH * 0.4);
      drawSymbol(back, style.symbol, artX + artW / 2, artY + artH / 2, 34 * unit, style.accent);
    }
    front.lineStyle(2, PALETTE.goldDark, 1).strokeRect(artX, artY, artW, artH);

    // Textfeld mit dem vollen Regeltext.
    const textY = artY + artH + 8 * unit;
    const bannerH = 26 * unit;
    const bannerY = y + height - 8 * unit - bannerH;
    const textH = bannerY - 6 * unit - textY;
    front.fillStyle(FX_COLOR.detailArt, 0.95).fillRect(artX, textY, artW, textH);
    front.lineStyle(2, PALETTE.bronze, 0.8).strokeRect(artX, textY, artW, textH);
    pool.label(describeCard(def), x + width / 2, textY + textH / 2, { size: 16 * unit, width: artW - 14 * unit, stroke: 2, alpha: textAlpha });

    // Typ-Banner.
    fillGradient(front, x + 8 * unit, bannerY, width - 16 * unit, bannerH, style.accent, style.dark, 1, 6);
    pool.label(style.banner, x + width / 2, bannerY + bannerH / 2, { size: 13 * unit, bold: true, stroke: 2, alpha: textAlpha });

    // Kosten-Kristall überlappt die linke obere Ecke.
    drawCostCrystal(front, pool, def.cost, x + 30 * unit, y + 34 * unit, 24 * unit, affordable, textAlpha);

    pool.label('Loslassen oder Tippen zum Schließen', this.view.width / 2, y + height + 22, { size: 12, color: TEXT.dim });
    pool.hideUnused();

    // Lichtband über Karte und Text (die Labels entstehen erst nach dem Band, daher nach vorn holen).
    const polygon = glintPolygon(width, height, this.elapsedMs);
    if (polygon.length >= 3) {
      glint.fillStyle(PALETTE.white, 0.26).fillPoints(
        polygon.map((p) => new Phaser.Geom.Point(layout.x + p.x, layout.y + p.y)),
        true,
      );
    }
    this.container.bringToTop(glint);
  }
}
