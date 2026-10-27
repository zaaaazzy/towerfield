/**
 * Zeichnet die Figurenmodelle der vier Einheitentypen (Nahkämpfer mit Schwert, Fernkämpfer mit Bogen, Heiler mit
 * Stab, Zerstörer mit Bombe). Prozedural mit Graphics statt Bilddateien: Die Pose (Schritt, Schlag, Fall) ändert sich
 * jedes Bild, und die Teamfarben kommen ohne zusätzliche Texturen aus. Die Pose berechnet `logic/minion-look.ts`;
 * hier wird nur gezeichnet.
 */
import Phaser from 'phaser';
import type { MinionShape } from '../logic/minion-look';
import { PALETTE } from './theme';

/** Farben eines Teams (Hauptton, dunkle Kontur, aufgehellter Ton). */
export interface TeamColors {
  main: number;
  dark: number;
  light: number;
}

/** Pose einer Figur; alle Werte kommen aus der Logik (Phase, Zyklus, Fortschritt). */
export interface FigurePose {
  /** Schrittausschlag der Beine, -1 bis 1; 0 steht. */
  stride: number;
  /** Wippen des Körpers in Pixeln (negativ = nach oben). */
  bob: number;
  /** Fortschritt der Angriffsbewegung, 0 bis 1; `null` = kein Angriff. */
  attack: number | null;
  /** Fallwinkel in rad (Sterbeanimation), 0 = aufrecht. */
  fall: number;
  /** Trefferblitz, 0 bis 1. */
  flash: number;
  alpha: number;
}

const SKIN = 0xf1cfa5;
const STEEL = 0xdfe3f2;
const WOOD = 0x8a5a2b;

/** Schwingt von 0 über 1 zurück auf 0 (Mitte des Angriffs = Höhepunkt). */
const pulse = (p: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));

/**
 * Eine Figur, Füße bei (`x`, `feetY`), Blick nach `dir` (1 rechts, -1 links), Größenfaktor `scale` (1 = 24 px hoch).
 * Gezeichnet wird in lokalen Einheiten (y nach oben negativ, Blick nach +x) mit verschobenem, gespiegeltem Koordinatensystem.
 */
export function drawFigure(
  g: Phaser.GameObjects.Graphics,
  shape: MinionShape,
  x: number,
  feetY: number,
  dir: -1 | 1,
  scale: number,
  team: TeamColors,
  pose: FigurePose,
): void {
  g.save();
  g.translateCanvas(x, feetY);
  g.rotateCanvas(-dir * pose.fall);
  g.scaleCanvas(dir * scale, scale);
  const a = pose.alpha;
  const swing = pose.attack === null ? 0 : pulse(pose.attack);
  const up = pose.bob;
  if (shape === 'melee') drawMelee(g, team, pose, swing, up, a);
  else if (shape === 'ranged') drawRanged(g, team, pose, up, a);
  else if (shape === 'healer') drawHealer(g, team, pose, swing, up, a);
  else drawDestroyer(g, team, pose, swing, up, a);
  g.restore();
}

/** Zwei Beine mit Fuß; Standbein bleibt am Boden, Schwungbein hebt sich. */
function legs(g: Phaser.GameObjects.Graphics, color: number, stride: number, hipY: number, a: number): void {
  for (const sign of [1, -1]) {
    const swingX = stride * 4 * sign;
    const lift = Math.max(0, stride * sign) * 2.2;
    g.lineStyle(3, PALETTE.black, 0.45 * a).lineBetween(sign * 1.6, hipY, swingX + sign * 1.6, -lift);
    g.lineStyle(2.2, color, a).lineBetween(sign * 1.6, hipY, swingX + sign * 1.6, -lift);
    g.fillStyle(PALETTE.panelDark, a).fillRoundedRect(swingX + sign * 1.6 - 1.5, -lift - 1.2, 4, 2.4, 1);
  }
}

function flashOver(g: Phaser.GameObjects.Graphics, pose: FigurePose, draw: () => void): void {
  if (pose.flash <= 0) return;
  g.fillStyle(PALETTE.white, 0.75 * pose.flash * pose.alpha);
  draw();
}

function drawMelee(g: Phaser.GameObjects.Graphics, t: TeamColors, pose: FigurePose, swing: number, up: number, a: number): void {
  legs(g, t.dark, pose.stride, -8, a);
  // Rundschild auf der Rückseite, Körper, Kopf mit Helm.
  g.fillStyle(t.dark, a).fillCircle(-4.5, -12 + up, 4.2);
  g.fillStyle(t.light, a).fillCircle(-4.5, -12 + up, 2.4);
  g.fillStyle(t.dark, a).fillRoundedRect(-4.6, -18 + up, 9.2, 11.4, 2.5);
  g.fillStyle(t.main, a).fillRoundedRect(-3.8, -17.2 + up, 7.6, 9.6, 2);
  g.fillStyle(t.light, 0.7 * a).fillRect(-3, -16.5 + up, 6, 2);
  g.fillStyle(PALETTE.goldDark, a).fillRect(-3.8, -10 + up, 7.6, 1.4);
  g.fillStyle(SKIN, a).fillCircle(0.8, -21 + up, 3.6);
  g.fillStyle(t.dark, a).fillRoundedRect(-3.2, -26 + up, 7.6, 4.6, 2);
  g.fillStyle(t.main, a).fillRect(-1.2, -27.5 + up, 2.4, 2.4);
  g.fillStyle(PALETTE.panelDark, a).fillCircle(2.4, -21 + up, 0.8);
  // Schwertarm: Ruhe schräg nach oben, beim Schlag von hinten oben nach vorn unten.
  const angle = pose.attack === null ? -0.9 : -1.9 + pose.attack * 2.9;
  const shoulderX = 3;
  const shoulderY = -15 + up;
  const handX = shoulderX + Math.cos(angle) * 5;
  const handY = shoulderY + Math.sin(angle) * 5 + 3;
  const tipX = handX + Math.cos(angle) * (9 + swing * 2);
  const tipY = handY + Math.sin(angle) * (9 + swing * 2);
  g.lineStyle(2.2, SKIN, a).lineBetween(shoulderX, shoulderY, handX, handY);
  g.lineStyle(3, t.dark, a).lineBetween(handX, handY, tipX, tipY);
  g.lineStyle(1.6, STEEL, a).lineBetween(handX, handY, tipX, tipY);
  if (swing > 0.3) g.lineStyle(1, PALETTE.white, 0.5 * swing * a).lineBetween(handX - 3, handY - 3, tipX + 2, tipY + 2);
  flashOver(g, pose, () => g.fillRoundedRect(-4.6, -18 + up, 9.2, 11.4, 2.5).fillCircle(0.8, -21 + up, 3.6));
}

function drawRanged(g: Phaser.GameObjects.Graphics, t: TeamColors, pose: FigurePose, up: number, a: number): void {
  legs(g, t.dark, pose.stride, -8, a);
  // Köcher auf dem Rücken, Körper, Kapuze.
  g.fillStyle(WOOD, a).fillRoundedRect(-6.2, -17 + up, 2.8, 9, 1);
  g.fillStyle(STEEL, a).fillRect(-5.6, -19 + up, 0.8, 2.2).fillRect(-4.4, -19.5 + up, 0.8, 2.6);
  g.fillStyle(t.dark, a).fillRoundedRect(-4, -18 + up, 8, 10.5, 2.5);
  g.fillStyle(t.main, a).fillRoundedRect(-3.2, -17.2 + up, 6.4, 8.8, 2);
  g.fillStyle(t.light, 0.6 * a).fillRect(-2.4, -16.5 + up, 4.8, 1.8);
  g.fillStyle(SKIN, a).fillCircle(0.8, -21 + up, 3.2);
  g.fillStyle(t.dark, a).fillTriangle(-4.2, -19 + up, 4.6, -19 + up, 0.2, -28.5 + up);
  g.fillStyle(t.main, a).fillTriangle(-3.2, -19.4 + up, 3.6, -19.4 + up, 0.2, -27 + up);
  g.fillStyle(SKIN, a).fillCircle(1.4, -20.6 + up, 2.4);
  g.fillStyle(PALETTE.panelDark, a).fillCircle(2.6, -20.8 + up, 0.7);
  // Bogen vorn, Sehne wird aufgezogen und schnellt beim Schuss zurück; der Pfeil fliegt im zweiten Teil des Angriffs.
  const pull = pose.attack === null ? 0 : pose.attack < 0.5 ? pose.attack * 2 : 0;
  const bowX = 6.5;
  const bowY = -14 + up;
  g.lineStyle(2, WOOD, a).beginPath().arc(bowX, bowY, 6.5, -1.15, 1.15).strokePath();
  const topX = bowX + Math.cos(-1.15) * 6.5;
  const topY = bowY + Math.sin(-1.15) * 6.5;
  const botY = bowY + Math.sin(1.15) * 6.5;
  const stringX = bowX - 1.5 - pull * 5;
  g.lineStyle(0.8, PALETTE.white, 0.9 * a).lineBetween(topX, topY, stringX, bowY).lineBetween(stringX, bowY, topX, botY);
  g.lineStyle(2, SKIN, a).lineBetween(2, -15 + up, bowX, bowY).lineBetween(1, -14 + up, stringX, bowY);
  if (pose.attack !== null && pose.attack < 0.5) {
    g.lineStyle(1.2, STEEL, a).lineBetween(stringX, bowY, bowX + 5, bowY);
  } else if (pose.attack !== null) {
    const flight = (pose.attack - 0.5) * 2;
    g.lineStyle(1.2, STEEL, (1 - flight) * a).lineBetween(bowX + 2 + flight * 12, bowY, bowX + 7 + flight * 12, bowY);
  }
  flashOver(g, pose, () => g.fillRoundedRect(-4, -18 + up, 8, 10.5, 2.5).fillCircle(0.8, -21 + up, 3.2));
}

function drawHealer(g: Phaser.GameObjects.Graphics, t: TeamColors, pose: FigurePose, swing: number, up: number, a: number): void {
  // Robe: Dreieck bis zum Boden, Saum wippt mit dem Schritt; nur die Füße schauen heraus.
  const hem = pose.stride * 1.5;
  g.fillStyle(PALETTE.panelDark, a).fillRoundedRect(-3 + hem, -1.6, 3.6, 2.2, 1).fillRoundedRect(0.6 - hem, -1.6, 3.6, 2.2, 1);
  g.fillStyle(t.dark, a).fillTriangle(-6.2, -1 + up * 0.3, 6.2, -1 + up * 0.3, 0, -19 + up);
  g.fillStyle(t.main, a).fillTriangle(-5, -2 + up * 0.3, 5, -2 + up * 0.3, 0, -18 + up);
  g.fillStyle(t.light, 0.65 * a).fillTriangle(-2.2, -6 + up * 0.5, 0.5, -6 + up * 0.5, -0.7, -17 + up);
  g.fillStyle(PALETTE.good, a).fillRect(-1, -14 + up, 2, 8).fillRect(-3, -11 + up, 6, 2);
  g.fillStyle(PALETTE.white, a).fillRect(-0.5, -13.4 + up, 1, 6.8).fillRect(-2.4, -10.5 + up, 4.8, 1);
  g.fillStyle(SKIN, a).fillCircle(0.6, -21.5 + up, 3.3);
  g.fillStyle(t.light, a).fillRoundedRect(-3, -25.5 + up, 7.2, 3.2, 1.6);
  g.fillStyle(PALETTE.panelDark, a).fillCircle(2, -21.5 + up, 0.7);
  // Stab: beim Zauber nach oben gereckt, Kugel leuchtet und sendet einen Ring aus.
  const raise = swing * 5;
  const staffX = 6;
  g.lineStyle(1.8, WOOD, a).lineBetween(staffX, -2, staffX, -22 - raise + up);
  g.lineStyle(2, SKIN, a).lineBetween(2.5, -14 + up, staffX, -13 - raise * 0.6 + up);
  const orbY = -24 - raise + up;
  g.fillStyle(PALETTE.good, (0.25 + 0.5 * swing) * a).fillCircle(staffX, orbY, 3.6 + swing * 2);
  g.fillStyle(PALETTE.good, a).fillCircle(staffX, orbY, 2.2);
  g.fillStyle(PALETTE.white, 0.85 * a).fillCircle(staffX - 0.6, orbY - 0.6, 0.8);
  if (pose.attack !== null) {
    g.lineStyle(1.2, PALETTE.good, (1 - pose.attack) * 0.9 * a).strokeCircle(staffX, orbY, 3 + pose.attack * 9);
  }
  flashOver(g, pose, () => g.fillTriangle(-6.2, -1, 6.2, -1, 0, -19 + up).fillCircle(0.6, -21.5 + up, 3.3));
}

function drawDestroyer(g: Phaser.GameObjects.Graphics, t: TeamColors, pose: FigurePose, swing: number, up: number, a: number): void {
  // Gedrungener Wicht mit Bombe auf dem Rücken; beim Angriff duckt er sich und stößt nach vorn.
  const lunge = swing * 3;
  g.save();
  g.translateCanvas(lunge, 0);
  legs(g, t.dark, pose.stride, -6, a);
  g.fillStyle(PALETTE.black, 0.9 * a).fillCircle(-5, -17 + up, 5.2);
  g.fillStyle(0x3a3a4e, a).fillCircle(-5.4, -17.4 + up, 4);
  g.fillStyle(PALETTE.white, 0.5 * a).fillCircle(-6.6, -18.8 + up, 1);
  const spark = 1 + 0.5 * Math.sin(pose.stride * 9 + (pose.attack ?? 0) * 12);
  g.lineStyle(1.2, STEEL, a).lineBetween(-5, -21.6 + up, -3.6, -24.5 + up);
  g.fillStyle(PALETTE.gold, a).fillCircle(-3.4, -25 + up, 1.6 * spark);
  g.fillStyle(PALETTE.white, 0.8 * a).fillCircle(-3.4, -25 + up, 0.7 * spark);
  g.fillStyle(t.dark, a).fillRoundedRect(-6, -17 + up, 12, 12, 4);
  g.fillStyle(t.main, a).fillRoundedRect(-5.2, -16.2 + up, 10.4, 10.2, 3.4);
  g.fillStyle(t.light, 0.65 * a).fillRoundedRect(-4.2, -15.4 + up, 6, 3.6, 1.8);
  g.fillStyle(PALETTE.gold, a).fillRect(-5.2, -9 + up, 10.4, 1.4);
  g.fillStyle(SKIN, a).fillCircle(1, -19.5 + up, 4);
  g.fillStyle(PALETTE.panelDark, a).fillCircle(2.6, -20.2 + up, 1).fillCircle(0, -20.2 + up, 1);
  g.lineStyle(1, PALETTE.panelDark, a).lineBetween(-0.6, -22 + up, 1.2, -21.4 + up).lineBetween(2.2, -21.4 + up, 4, -22 + up);
  g.fillStyle(t.dark, a).fillTriangle(-3, -23 + up, 0, -27.5 + up, 1.6, -23 + up).fillTriangle(1.6, -23 + up, 4, -27.5 + up, 5, -22.5 + up);
  g.lineStyle(2.4, SKIN, a).lineBetween(4, -13 + up, 7.5 + swing * 2.5, -11 + up + swing);
  flashOver(g, pose, () => g.fillRoundedRect(-6, -17 + up, 12, 12, 4).fillCircle(1, -19.5 + up, 4));
  g.restore();
}
