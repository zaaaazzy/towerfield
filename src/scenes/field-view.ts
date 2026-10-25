/**
 * Zeichnet Spielfeld, Tower, Bauplätze und Minions (Boden und Wege liegen im Hintergrundbild, siehe `textures.ts`).
 * Beide Teams tragen ihre Teamfarbe samt Leuchten und werfen einen Schatten. Nur Darstellung, keine Regeln.
 */
import Phaser from 'phaser';
import { LINE_LENGTH, MINION_RANGE } from '../logic/combat';
import { LINE_COUNT, lineCapacity, type MatchState } from '../logic/match';
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

const TEAM = {
  [HUMAN]: { main: PALETTE.human, dark: PALETTE.humanDark },
  [BOT]: { main: PALETTE.bot, dark: PALETTE.botDark },
} as const;

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

/** Ein Minion mit Schatten, Leuchten in der Teamfarbe und Form nach Rolle (Heiler Kreuz, Fernkämpfer Raute). */
export function drawMinionBody(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  owner: number,
  minion?: { hp: number; maxHp?: number; heals?: boolean; range: number },
  alpha = 1,
): void {
  const team = teamOf(owner);
  const maxHp = minion ? (minion.maxHp ?? minion.hp) : 0;
  const radius = minion ? MINION_RADIUS + Math.min(2, Math.max(0, (maxHp - 30) / 25)) : MINION_RADIUS;
  g.fillStyle(PALETTE.black, 0.38 * alpha).fillEllipse(x + 1, y + radius * 0.9, radius * 2.2, radius * 0.9);
  g.fillStyle(team.main, 0.16 * alpha).fillCircle(x, y, radius + 6);
  g.fillStyle(team.main, 0.22 * alpha).fillCircle(x, y, radius + 3);
  g.fillStyle(team.dark, alpha).fillCircle(x, y, radius + 1.2);

  if (minion && !minion.heals && minion.range > MINION_RANGE) {
    const r = radius + 1;
    g.fillStyle(team.main, alpha).fillPoints(
      [new Phaser.Geom.Point(x, y - r), new Phaser.Geom.Point(x + r, y), new Phaser.Geom.Point(x, y + r), new Phaser.Geom.Point(x - r, y)],
      true,
    );
  } else {
    g.fillStyle(team.main, alpha).fillCircle(x, y, radius);
  }
  g.fillStyle(PALETTE.white, 0.35 * alpha).fillCircle(x - radius * 0.3, y - radius * 0.35, radius * 0.38);
  if (minion?.heals) {
    g.fillStyle(PALETTE.white, alpha).fillRect(x - 1.5, y - 4.5, 3, 9).fillRect(x - 4.5, y - 1.5, 9, 3);
    g.fillStyle(PALETTE.good, alpha).fillRect(x - 0.75, y - 3.75, 1.5, 7.5).fillRect(x - 3.75, y - 0.75, 7.5, 1.5);
  }
  if (minion && minion.hp < maxHp) {
    const width = 14;
    drawBar(g, x - width / 2, y - radius - 7, width, 3, minion.hp / maxHp, healthFill(minion.hp / maxHp), 'steel');
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

/** Alle Minions beider Spieler; `skipHumanId` lässt einen eigenen Minion aus (der gerade gezogen wird). */
export function drawMinions(g: Phaser.GameObjects.Graphics, state: MatchState, skipHumanId?: number): void {
  for (const owner of [BOT, HUMAN]) {
    for (const minion of state.players[owner]!.minions) {
      if (owner === HUMAN && skipHumanId === minion.id) continue;
      const point = minionPoint(owner, minion);
      drawMinionBody(g, point.x, point.y, owner, minion);
    }
  }
}
