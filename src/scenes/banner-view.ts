import Phaser from 'phaser';
import { type Banner, type BannerRun, advanceBanner, bannerSlide, type BannerTone, skipBanner, startBanner } from '../logic/phase-banner';
import { LabelPool } from './labels';
import { lerpColor, PALETTE, TEXT } from './theme';

/** Tiefe über Beschriftungen und Effekten, unter nichts: das Banner liegt oben. */
const BANNER_DEPTH = 60;
/** Pergament-Streifen in Spielkoordinaten; liegt über dem Feld, weit weg von Handkarten und „Bereit“-Knopf. */
export const BANNER_BAND = { y: 170, height: 76 };

/** Rahmen- und Schmuckfarbe je Farbton. */
const TONE_COLOR: Record<BannerTone, number> = {
  round: PALETTE.gold,
  event: PALETTE.human,
  victory: PALETTE.goldLight,
  defeat: PALETTE.bad,
  draw: PALETTE.stone,
};

const PARCHMENT = 0xe9d9a6;
const PARCHMENT_DARK = 0xc8b27a;

/**
 * Animiertes Pergament-/Gold-Banner. Hält den Ablauf (`BannerRun`, Zeit aus `delta`), zeichnet ihn in einen eigenen
 * Container und fährt ihn von links ein und wieder aus. Das Banner blockiert nichts: Nur ein Tippen im Streifen
 * überspringt es (`handleTap`), alle anderen Eingaben gehen durch. Mit `fast` zeigt es nie etwas.
 */
export class BannerView {
  private readonly container: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly pool: LabelPool;
  private run: BannerRun | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly view: { width: number; height: number },
    private readonly fast: boolean,
  ) {
    this.container = scene.add.container(0, 0).setDepth(BANNER_DEPTH).setVisible(false);
    this.graphics = scene.add.graphics();
    this.container.add(this.graphics);
    this.pool = new LabelPool(scene, this.container);
  }

  /** Läuft gerade ein Banner? */
  get active(): boolean {
    return this.run !== null;
  }

  /** Startet das Banner; im Schnellvorlauf passiert nichts. */
  show(banner: Banner | null): void {
    if (this.fast || !banner) return;
    this.run = startBanner(banner);
  }

  /** Tippen im Streifen überspringt das Banner und wird verbraucht (`true`); sonst geht die Eingabe weiter. */
  handleTap(y: number): boolean {
    if (!this.run || y < BANNER_BAND.y || y > BANNER_BAND.y + BANNER_BAND.height) return false;
    this.skip();
    return true;
  }

  /** Blendet das laufende Banner sofort aus (es fährt noch kurz hinaus). */
  skip(): void {
    if (this.run) this.run = skipBanner(this.run);
  }

  update(deltaMs: number): void {
    if (this.run) this.run = advanceBanner(this.run, deltaMs);
    this.draw();
  }

  private draw(): void {
    const run = this.run;
    const g = this.graphics.clear();
    this.pool.reset();
    this.container.setVisible(run !== null);
    if (!run) {
      this.pool.hideUnused();
      return;
    }
    const slide = bannerSlide(run);
    const { width } = this.view;
    const { y, height } = BANNER_BAND;
    const accent = TONE_COLOR[run.banner.tone];
    this.container.setPosition(-(1 - slide) * width, 0).setAlpha(slide);

    // Pergamentstreifen mit Verlauf, Goldkanten und Eckzierden.
    g.fillStyle(PALETTE.black, 0.35).fillRect(0, y + 4, width, height);
    g.fillStyle(PARCHMENT, 1).fillRect(0, y, width, height / 2);
    g.fillStyle(PARCHMENT_DARK, 1).fillRect(0, y + height / 2, width, height / 2);
    g.fillStyle(lerpColor(PARCHMENT, PALETTE.white, 0.4), 0.6).fillRect(0, y + 4, width, 6);
    g.fillStyle(accent, 1).fillRect(0, y, width, 4).fillRect(0, y + height - 4, width, 4);
    g.fillStyle(PALETTE.goldDark, 1).fillRect(0, y + 4, width, 1).fillRect(0, y + height - 5, width, 1);
    for (const x of [14, width - 14]) {
      g.fillStyle(accent, 1).fillTriangle(x, y + height / 2 - 8, x + 8, y + height / 2, x, y + height / 2 + 8);
      g.fillStyle(accent, 1).fillTriangle(x, y + height / 2 - 8, x - 8, y + height / 2, x, y + height / 2 + 8);
    }

    const { title, subtitle } = run.banner;
    const titleY = subtitle ? y + height / 2 - 10 : y + height / 2;
    this.pool.label(title, width / 2, titleY, { size: 28, font: 'heading', bold: true, color: TEXT.dark, stroke: 0 });
    if (subtitle) {
      this.pool.label(subtitle, width / 2, y + height / 2 + 20, { size: 14, font: 'heading', color: TEXT.dark, stroke: 0 });
    }
    this.pool.hideUnused();
  }
}

/** Farbe des Wappens und der Strahlen nach Spielerfarbe (Mensch blau, Bot orange). */
export function crestColors(owner: 'human' | 'bot'): { main: number; dark: number; light: number } {
  const main = owner === 'human' ? PALETTE.human : PALETTE.bot;
  const dark = owner === 'human' ? PALETTE.humanDark : PALETTE.botDark;
  return { main, dark, light: lerpColor(main, PALETTE.white, 0.45) };
}

/** Wappenschild mit Goldrand und Mittelstern; `size` ist die Breite. */
export function drawCrest(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  colors: { main: number; dark: number; light: number },
): void {
  const w = size / 2;
  const h = size * 0.6;
  const shield = (scale: number) => [
    new Phaser.Geom.Point(cx - w * scale, cy - h * scale),
    new Phaser.Geom.Point(cx + w * scale, cy - h * scale),
    new Phaser.Geom.Point(cx + w * scale, cy + h * 0.1 * scale),
    new Phaser.Geom.Point(cx, cy + h * scale),
    new Phaser.Geom.Point(cx - w * scale, cy + h * 0.1 * scale),
  ];
  g.fillStyle(PALETTE.goldDark, 1).fillPoints(shield(1.12), true);
  g.fillStyle(PALETTE.gold, 1).fillPoints(shield(1.05), true);
  g.fillStyle(colors.dark, 1).fillPoints(shield(0.95), true);
  g.fillStyle(colors.main, 1).fillPoints(shield(0.8), true);
  g.fillStyle(colors.light, 0.35).fillRect(cx - w * 0.8, cy - h * 0.8, w * 0.8, h * 0.45);
  // Fünfzackiger Stern in der Mitte.
  const star: Phaser.Geom.Point[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = (i % 2 === 0 ? 0.42 : 0.18) * size * 0.5;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    star.push(new Phaser.Geom.Point(cx + Math.cos(angle) * radius * 1.6, cy - h * 0.1 + Math.sin(angle) * radius * 1.6));
  }
  g.fillStyle(PALETTE.goldLight, 1).fillPoints(star, true);
  g.lineStyle(1, PALETTE.goldDark, 1).strokePoints(star, true);
}

/** Lichtstrahlen, die sich über `timeMs` (aus `delta` summiert) langsam drehen und leicht pulsieren. */
export function drawRays(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  timeMs: number,
  color: number,
): void {
  const count = 12;
  const spin = timeMs / 6000;
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 700);
  for (let i = 0; i < count; i += 1) {
    const angle = spin + (i * Math.PI * 2) / count;
    const spread = Math.PI / count / 2;
    g.fillStyle(color, 0.1 + 0.1 * pulse);
    g.fillTriangle(
      cx,
      cy,
      cx + Math.cos(angle - spread) * radius,
      cy + Math.sin(angle - spread) * radius,
      cx + Math.cos(angle + spread) * radius,
      cy + Math.sin(angle + spread) * radius,
    );
  }
}
