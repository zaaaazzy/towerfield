/**
 * Zeichnet Spielfeld, Tower, Bauplätze und Minions (Boden und Wege liegen im Hintergrundbild, siehe `textures.ts`).
 * Beide Teams tragen ihre Teamfarbe samt Leuchten und werfen einen Schatten; die Form folgt der Rolle
 * (`logic/minion-look.ts`). Nur Darstellung, keine Regeln.
 */
import Phaser from 'phaser';
import { LINE_LENGTH } from '../logic/combat';
import { LINE_COUNT, lineCapacity, type MatchState } from '../logic/match';
import {
  bobOffset,
  facing,
  flashKey,
  flashStrength,
  minionRadius,
  type MinionShape,
  minionShape,
} from '../logic/minion-look';
import { isSlotFree, isValidSlot, type LineGeometry, positionToY, slotPosition } from '../logic/placement';
import type { Point } from './effects';
import type { LabelFn } from './labels';
import { drawBar, healthFill, lerpColor, PALETTE, TEXT } from './theme';

export const HUMAN = 0;
export const BOT = 1;

/** Lage der Lines und Tower in Spielpixeln. */
export const FIELD = {
  lineCenters: [60, 180, 300],
  lineHalfWidth: 50,
  enemyTowerY: 90,
  ownTowerY: 400,
  /** Halbe Breite des gezeichneten Wegs. */
  pathHalfWidth: 17,
};

export const GEOMETRY: LineGeometry = {
  lineCenters: FIELD.lineCenters,
  lineHalfWidth: FIELD.lineHalfWidth,
  ownTowerY: FIELD.ownTowerY,
  enemyTowerY: FIELD.enemyTowerY,
};

export const MINION_RADIUS = 7;

/** Teamfarben samt aufgehelltem Ton für den Verlauf (einmal berechnet, nicht pro Frame). */
const TEAM = {
  [HUMAN]: { main: PALETTE.human, dark: PALETTE.humanDark, light: lerpColor(PALETTE.human, PALETTE.white, 0.45) },
  [BOT]: { main: PALETTE.bot, dark: PALETTE.botDark, light: lerpColor(PALETTE.bot, PALETTE.white, 0.45) },
};

/** Stahlton der Klinge des Nahkämpfers. */
const STEEL = 0xdfe3f2;

const teamOf = (owner: number) => (owner === HUMAN ? TEAM[HUMAN] : TEAM[BOT]);

/** Y-Koordinate einer Position (0 bis `LINE_LENGTH`) vom Tower des jeweiligen Spielers aus. */
export function lineY(owner: number, position: number): number {
  if (owner === HUMAN) return positionToY(position, GEOMETRY);
  const span = FIELD.ownTowerY - FIELD.enemyTowerY;
  return FIELD.enemyTowerY + (position / LINE_LENGTH) * span;
}

/** Mittelpunkt, an dem ein Minion gezeichnet wird. */
export function minionPoint(owner: number, minion: { id: number; line: number; position: number }): Point {
  return {
    x: FIELD.lineCenters[minion.line]!,
    y: lineY(owner, minion.position),
  };
}

export function towerPoint(owner: number, line: number): Point {
  return { x: FIELD.lineCenters[line]!, y: owner === HUMAN ? FIELD.ownTowerY : FIELD.enemyTowerY };
}

/** Tower einer Line samt Lebensbalken; `direction` 1 = Balken unter dem Tower, -1 = darüber. */
export function drawTower(
  g: Phaser.GameObjects.Graphics,
  label: LabelFn,
  x: number,
  y: number,
  line: { tower: { hp: number; maxHp: number } },
  owner: number,
  direction: 1 | -1,
): void {
  const { hp, maxHp } = line.tower;
  const alive = hp > 0;
  const team = teamOf(owner);
  const accent = alive ? team.main : PALETTE.stoneDark;

  // Schatten und Teamfarben-Schein auf dem Boden.
  g.fillStyle(PALETTE.black, 0.4).fillEllipse(x + 3, y + 14, 60, 13);
  if (alive) g.fillStyle(team.main, 0.2).fillEllipse(x, y + 12, 68, 18);

  // Mauerwerk: Zinnen, Sockel mit Verlauf, Teamfarben-Wimpel an den Seiten.
  const wall = alive ? PALETTE.stone : lerpColor(PALETTE.stoneDark, PALETTE.black, 0.3);
  for (let block = 0; block < 5; block += 1) {
    g.fillStyle(wall, 1).fillRect(x - 25 + block * 11.5, y - 16, 7, 6);
  }
  g.fillStyle(lerpColor(wall, PALETTE.black, 0.45), 1).fillRect(x - 25, y - 11, 50, 25);
  g.fillStyle(wall, 1).fillRect(x - 25, y - 12, 50, 12);
  g.fillStyle(lerpColor(wall, PALETTE.black, 0.3), 1).fillRect(x - 25, y, 50, 13);
  g.fillStyle(PALETTE.white, 0.18).fillRect(x - 25, y - 12, 50, 1);
  for (const side of [-1, 1]) {
    g.fillStyle(lerpColor(accent, PALETTE.black, 0.35), 1).fillRect(x + side * 22 - 3, y - 12, 6, 25);
    g.fillStyle(accent, 1).fillRect(x + side * 22 - 2, y - 11, 4, 22);
    if (alive) {
      g.fillStyle(team.main, 0.3).fillCircle(x + side * 22, y - 17, 6);
      g.fillStyle(PALETTE.white, 0.95).fillCircle(x + side * 22, y - 17, 2.5);
    }
  }
  // Schild in der Mitte, Rand in der Teamfarbe.
  g.fillStyle(accent, 1).fillRoundedRect(x - 15, y - 9, 30, 19, 4);
  g.fillStyle(PALETTE.panelDark, 0.9).fillRoundedRect(x - 14, y - 8, 28, 17, 3);

  const barY = direction === 1 ? y + 16 : y - 24;
  drawBar(g, x - 25, barY, 50, 6, maxHp > 0 ? hp / maxHp : 0, healthFill(maxHp > 0 ? hp / maxHp : 0), 'gold');
  label(`${Math.ceil(hp)}`, x, y + 1, { size: 11, bold: true, font: 'heading', color: alive ? TEXT.main : TEXT.dim });
}

/** Zeitbezogene Darstellung eines Minions: Szenenzeit (aus `delta` summiert), Laufen und Trefferblitz (0 bis 1). */
export interface MinionLook {
  id: number;
  timeMs: number;
  moving: boolean;
  flash: number;
}

/** Zeit und Blitze, die die Szenen an `drawMinions` geben (beides wird aus `delta` fortgeschrieben). */
export interface MinionAnim {
  timeMs: number;
  flashes: ReadonlyMap<string, number>;
}

/** Füllt die Silhouette der Rolle: Nahkämpfer rund, Fernkämpfer Raute in Blickrichtung, Heiler Rundquadrat. */
function fillSilhouette(
  g: Phaser.GameObjects.Graphics,
  shape: MinionShape,
  x: number,
  y: number,
  r: number,
  color: number,
  alpha: number,
): void {
  g.fillStyle(color, alpha);
  if (shape === 'melee') {
    g.fillCircle(x, y, r);
  } else if (shape === 'ranged') {
    const w = r * 0.95;
    const h = r * 1.3;
    g.fillTriangle(x, y - h, x + w, y, x - w, y);
    g.fillTriangle(x, y + h, x + w, y, x - w, y);
  } else {
    g.fillRoundedRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.5);
  }
}

/**
 * Ein Minion mit Schatten, Teamfarben-Leuchten, Form nach Rolle (Nahkämpfer Kreis mit Klinge, Fernkämpfer Raute mit
 * Bogen, Heiler Rundquadrat mit Kreuz und Heiligenschein), Verlauf, Glanzlicht und Augen in Blickrichtung.
 * `look` liefert Wippen beim Laufen und Trefferblitz; ohne `minion` (gezogene Figur) entsteht ein neutraler Nahkämpfer.
 */
export function drawMinionBody(
  g: Phaser.GameObjects.Graphics,
  x: number,
  baseY: number,
  owner: number,
  minion?: { hp: number; maxHp?: number; heals?: boolean; range: number },
  alpha = 1,
  look?: MinionLook,
): void {
  const team = teamOf(owner);
  const dir = facing(owner);
  const maxHp = minion ? (minion.maxHp ?? minion.hp) : 0;
  const r = minion ? minionRadius(maxHp) : MINION_RADIUS;
  const shape: MinionShape = minion ? minionShape(minion) : 'melee';
  const y = baseY + (look ? bobOffset(look.timeMs, look.id, look.moving) : 0);

  // Schatten bleibt am Boden, Leuchten in der Teamfarbe.
  g.fillStyle(PALETTE.black, 0.38 * alpha).fillEllipse(x + 1, baseY + r * 0.9, r * 2.2, r * 0.9);
  g.fillStyle(team.main, 0.2 * alpha).fillCircle(x, y, r + 4);

  // Ausrüstung vorn: Klinge, Bogen oder Heiligenschein.
  if (shape === 'melee') {
    const tip = y + dir * (r + 5);
    g.fillStyle(team.dark, alpha).fillTriangle(x - 3, y + dir * r * 0.5, x + 3, y + dir * r * 0.5, x, tip + dir);
    g.fillStyle(STEEL, alpha).fillTriangle(x - 1.8, y + dir * r * 0.55, x + 1.8, y + dir * r * 0.55, x, tip);
  } else if (shape === 'ranged') {
    const centre = dir < 0 ? -Math.PI / 2 : Math.PI / 2;
    g.lineStyle(2, team.dark, alpha).beginPath().arc(x, y, r + 3, centre - 1, centre + 1).strokePath();
    g.lineStyle(1, PALETTE.goldLight, alpha).beginPath().arc(x, y, r + 3, centre - 1, centre + 1).strokePath();
  } else {
    g.lineStyle(2, PALETTE.good, 0.9 * alpha).strokeEllipse(x, y + dir * (r + 2.5), r * 1.3, 3.5);
  }

  // Körper: dunkle Kontur, Teamfarbe, aufgehellte Fläche oben links (Verlauf), Glanzlicht.
  fillSilhouette(g, shape, x, y, r + 1.2, team.dark, alpha);
  fillSilhouette(g, shape, x, y, r, team.main, alpha);
  fillSilhouette(g, shape, x - r * 0.12, y - r * 0.2, r * 0.72, team.light, 0.75 * alpha);
  g.fillStyle(PALETTE.white, 0.55 * alpha).fillCircle(x - r * 0.35, y - r * 0.42, Math.max(1, r * 0.2));

  // Augen auf der Blickseite zeigen die Laufrichtung; der Heiler trägt stattdessen ein Kreuz.
  if (shape === 'healer') {
    const c = r * 0.55;
    g.fillStyle(PALETTE.white, alpha).fillRect(x - 1.5, y - c, 3, c * 2).fillRect(x - c, y - 1.5, c * 2, 3);
    g.fillStyle(PALETTE.good, alpha).fillRect(x - 0.75, y - c + 0.75, 1.5, c * 2 - 1.5).fillRect(x - c + 0.75, y - 0.75, c * 2 - 1.5, 1.5);
  } else {
    const eyeY = y + dir * r * 0.3;
    g.fillStyle(PALETTE.panelDark, alpha).fillCircle(x - r * 0.33, eyeY, 1.4).fillCircle(x + r * 0.33, eyeY, 1.4);
    g.fillStyle(PALETTE.white, alpha).fillCircle(x - r * 0.33, eyeY - 0.3, 0.6).fillCircle(x + r * 0.33, eyeY - 0.3, 0.6);
  }

  if (look && look.flash > 0) fillSilhouette(g, shape, x, y, r + 1.2, PALETTE.white, 0.8 * look.flash * alpha);

  // Lebensbalken hinter der Einheit (gegen die Blickrichtung), damit er Klinge, Bogen und Heiligenschein nicht verdeckt.
  if (minion && minion.hp < maxHp) {
    const width = 14;
    const barY = dir < 0 ? baseY + r + 4 : baseY - r - 7;
    drawBar(g, x - width / 2, barY, width, 3, minion.hp / maxHp, healthFill(minion.hp / maxHp), 'steel');
  }
}

/** Hintergrund-Aufbauten, Lines, Bauplätze, beide Tower und die Line-Stufen. `highlight` rahmt die Lines golden. */
export function drawBoard(g: Phaser.GameObjects.Graphics, label: LabelFn, state: MatchState, highlight = false): void {
  const human = state.players[HUMAN];
  const bot = state.players[BOT];
  for (let line = 0; line < LINE_COUNT; line += 1) {
    const center = FIELD.lineCenters[line]!;
    if (highlight) {
      const top = FIELD.enemyTowerY - 30;
      const height = FIELD.ownTowerY - FIELD.enemyTowerY + 60;
      g.fillStyle(PALETTE.gold, 0.07).fillRoundedRect(center - FIELD.lineHalfWidth, top, FIELD.lineHalfWidth * 2, height, 8);
      g.lineStyle(3, PALETTE.gold, 0.18).strokeRoundedRect(center - FIELD.lineHalfWidth - 1, top - 1, FIELD.lineHalfWidth * 2 + 2, height + 2, 9);
      g.lineStyle(2, PALETTE.gold, 0.65).strokeRoundedRect(center - FIELD.lineHalfWidth, top, FIELD.lineHalfWidth * 2, height, 8);
    }
    const slots = lineCapacity(human.lines[line]!.level);
    for (let slot = 0; slot < slots; slot += 1) {
      if (!isValidSlot(slot, slots)) continue;
      const y = lineY(HUMAN, slotPosition(slot));
      const free = isSlotFree(human.minions, line, slot);
      g.fillStyle(PALETTE.black, 0.3).fillEllipse(center, y + 1.5, 25, 9);
      g.fillStyle(free ? PALETTE.stoneDark : PALETTE.humanDark, free ? 0.7 : 0.55).fillEllipse(center, y, 23, 8);
      g.lineStyle(1, free ? PALETTE.bronze : PALETTE.human, free ? 0.7 : 0.8).strokeEllipse(center, y, 23, 8);
    }
    drawTower(g, label, center, FIELD.enemyTowerY, bot.lines[line]!, BOT, -1);
    drawTower(g, label, center, FIELD.ownTowerY, human.lines[line]!, HUMAN, 1);
    label(`Line ${line + 1} · Stufe ${human.lines[line]!.level}`, center, FIELD.ownTowerY + 38, {
      size: 10,
      color: TEXT.gold,
    });
  }
}

/**
 * Alle Minions beider Spieler; `skipHumanId` lässt einen eigenen Minion aus (der gerade gezogen wird). `anim` bringt
 * Szenenzeit und Trefferblitze; im Kampf wippen die Minions beim Laufen.
 */
export function drawMinions(g: Phaser.GameObjects.Graphics, state: MatchState, skipHumanId?: number, anim?: MinionAnim): void {
  const moving = state.phase === 'combat';
  for (const owner of [BOT, HUMAN]) {
    for (const minion of state.players[owner]!.minions) {
      if (owner === HUMAN && skipHumanId === minion.id) continue;
      const point = minionPoint(owner, minion);
      const look = anim
        ? {
            id: minion.id,
            timeMs: anim.timeMs,
            moving,
            flash: flashStrength(anim.flashes.get(flashKey(owner, minion.id)) ?? 0),
          }
        : undefined;
      drawMinionBody(g, point.x, point.y, owner, minion, 1, look);
    }
  }
}
