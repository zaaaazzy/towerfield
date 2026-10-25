/**
 * Zeichnet Spielfeld, Tower, Bauplätze und Minions (Boden und Wege liegen im Hintergrundbild, siehe `textures.ts`).
 * Beide Teams tragen ihre Teamfarbe samt Leuchten und werfen einen Schatten; die Form folgt der Rolle
 * (`logic/minion-look.ts`). Nur Darstellung, keine Regeln.
 */
import Phaser from 'phaser';
import { type Explosion, LINE_LENGTH } from '../logic/combat';
import { isLaneUnlocked, LANE_COUNT, laneName, laneRow, laneTowerOffsets, laneUnlockLevel } from '../logic/lanes';
import { lineCapacity, type MatchState } from '../logic/match';
import {
  bobOffset,
  facing,
  flashKey,
  flashStrength,
  laneStagger,
  minionRadius,
  type MinionShape,
  minionShape,
} from '../logic/minion-look';
import { isSlotFree, isValidSlot, type LineGeometry, positionToX, slotPosition } from '../logic/placement';
import { describeSynergy } from '../logic/synergies';
import type { Point } from './effects';
import type { LabelFn } from './labels';
import { drawBar, healthFill, lerpColor, PALETTE, TEXT } from './theme';

export const HUMAN = 0;
export const BOT = 1;

/** y der Start-Lane und Abstand zweier Lane-Reihen in Spielpixeln. */
const MIDDLE_Y = 232;
const LANE_SPACING = 70;

/** Lage der waagrechten Lanes und ihrer Enden in Spielpixeln; `laneCenters` folgt dem Lane-Index. */
export const FIELD = {
  laneCenters: Array.from({ length: LANE_COUNT }, (_, lane) => MIDDLE_Y + laneRow(lane) * LANE_SPACING),
  /** Halbe Höhe der Trefferfläche einer Lane (Spielraum für den Querversatz der Minions). */
  laneHalfHeight: 33,
  /** x der Position 0 (eigenes Ende, links) und `LINE_LENGTH` (gegnerisches Ende, rechts). */
  ownTowerX: 30,
  enemyTowerX: 330,
  /** Halbe Höhe des gezeichneten Wegs. */
  pathHalfHeight: 24,
};

export const GEOMETRY: LineGeometry = {
  laneCenters: FIELD.laneCenters,
  laneHalfHeight: FIELD.laneHalfHeight,
  ownTowerX: FIELD.ownTowerX,
  enemyTowerX: FIELD.enemyTowerX,
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

/** X-Koordinate einer Position (0 bis `LINE_LENGTH`), gezählt vom eigenen Ende des jeweiligen Spielers aus. */
export function lineX(owner: number, position: number): number {
  if (owner === HUMAN) return positionToX(position, GEOMETRY);
  return FIELD.enemyTowerX - (position / LINE_LENGTH) * (FIELD.enemyTowerX - FIELD.ownTowerX);
}

/** Mittelpunkt, an dem ein Minion gezeichnet wird (auf seiner Lane, quer versetzt nach ID). */
export function minionPoint(owner: number, minion: { id: number; line: number; position: number }): Point {
  return {
    x: lineX(owner, minion.position),
    y: FIELD.laneCenters[minion.line]! + laneStagger(minion.id),
  };
}

/** Standort des Towers `tower` der Lane `line`; die Positionen der Tower stehen in `lanes.ts`. */
export function towerPoint(owner: number, line: number, tower: number): Point {
  return { x: lineX(owner, laneTowerOffsets(line)[tower] ?? 0), y: FIELD.laneCenters[line]! };
}

/** Ein Tower, kompakt (die drei Tower der Start-Lane stehen nur 24 px auseinander), mit Lebensbalken darüber. */
export function drawTower(
  g: Phaser.GameObjects.Graphics,
  label: LabelFn,
  x: number,
  y: number,
  tower: { hp: number; maxHp: number },
  owner: number,
): void {
  const { hp, maxHp } = tower;
  const alive = hp > 0;
  const team = teamOf(owner);
  const accent = alive ? team.main : PALETTE.stoneDark;
  const wall = alive ? PALETTE.stone : lerpColor(PALETTE.stoneDark, PALETTE.black, 0.3);

  // Schatten und Teamfarben-Schein auf dem Boden.
  g.fillStyle(PALETTE.black, 0.4).fillEllipse(x + 2, y + 12, 22, 7);
  if (alive) g.fillStyle(team.main, 0.2).fillEllipse(x, y + 10, 26, 10);

  // Mauerwerk: Zinnen, Sockel mit Verlauf, Teamfarben-Streifen, Schild in der Mitte.
  for (let block = 0; block < 3; block += 1) {
    g.fillStyle(wall, 1).fillRect(x - 9 + block * 7, y - 13, 4, 4);
  }
  g.fillStyle(lerpColor(wall, PALETTE.black, 0.45), 1).fillRect(x - 9, y - 9, 18, 21);
  g.fillStyle(wall, 1).fillRect(x - 9, y - 9, 18, 10);
  g.fillStyle(PALETTE.white, 0.18).fillRect(x - 9, y - 9, 18, 1);
  g.fillStyle(accent, 1).fillRect(x - 9, y - 9, 2, 21).fillRect(x + 7, y - 9, 2, 21);
  g.fillStyle(accent, 1).fillRoundedRect(x - 6, y - 6, 12, 13, 2);
  g.fillStyle(PALETTE.panelDark, 0.9).fillRoundedRect(x - 5, y - 5, 10, 11, 2);

  drawBar(g, x - 10, y - 21, 20, 4, maxHp > 0 ? hp / maxHp : 0, healthFill(maxHp > 0 ? hp / maxHp : 0), 'gold');
  label(`${Math.ceil(hp)}`, x, y + 1, { size: 8, bold: true, font: 'heading', color: alive ? TEXT.main : TEXT.dim });
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

/** Füllt die Silhouette der Rolle: Nahkämpfer rund, Fernkämpfer Raute in Blickrichtung, Heiler Rundquadrat, Zerstörer Stachelkugel. */
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
    g.fillTriangle(x - h, y, x, y - w, x, y + w);
    g.fillTriangle(x + h, y, x, y - w, x, y + w);
  } else if (shape === 'destroyer') {
    // Stachelkugel: Kreis mit vier Spitzen oben, unten, vorn und hinten.
    const s = r * 1.3;
    const w = r * 0.5;
    g.fillCircle(x, y, r * 0.92);
    g.fillTriangle(x - w, y - r * 0.6, x + w, y - r * 0.6, x, y - s);
    g.fillTriangle(x - w, y + r * 0.6, x + w, y + r * 0.6, x, y + s);
    g.fillTriangle(x - r * 0.6, y - w, x - r * 0.6, y + w, x - s, y);
    g.fillTriangle(x + r * 0.6, y - w, x + r * 0.6, y + w, x + s, y);
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
  minion?: { hp: number; maxHp?: number; heals?: boolean; explodes?: Explosion; range: number },
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
    const tip = x + dir * (r + 5);
    g.fillStyle(team.dark, alpha).fillTriangle(x + dir * r * 0.5, y - 3, x + dir * r * 0.5, y + 3, tip + dir, y);
    g.fillStyle(STEEL, alpha).fillTriangle(x + dir * r * 0.55, y - 1.8, x + dir * r * 0.55, y + 1.8, tip, y);
  } else if (shape === 'ranged') {
    const centre = dir < 0 ? Math.PI : 0;
    g.lineStyle(2, team.dark, alpha).beginPath().arc(x, y, r + 3, centre - 1, centre + 1).strokePath();
    g.lineStyle(1, PALETTE.goldLight, alpha).beginPath().arc(x, y, r + 3, centre - 1, centre + 1).strokePath();
  } else if (shape === 'healer') {
    g.lineStyle(2, PALETTE.good, 0.9 * alpha).strokeEllipse(x + dir * (r + 2.5), y, 3.5, r * 1.3);
  } else {
    // Zündschnur oben mit Funken.
    g.lineStyle(1.5, STEEL, alpha).beginPath().moveTo(x, y - r).lineTo(x - dir * 2, y - r - 4).strokePath();
    g.fillStyle(PALETTE.gold, alpha).fillCircle(x - dir * 2, y - r - 5, 1.8);
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
    const eyeX = x + dir * r * 0.3;
    g.fillStyle(PALETTE.panelDark, alpha).fillCircle(eyeX, y - r * 0.33, 1.4).fillCircle(eyeX, y + r * 0.33, 1.4);
    g.fillStyle(PALETTE.white, alpha).fillCircle(eyeX - 0.3, y - r * 0.33, 0.6).fillCircle(eyeX - 0.3, y + r * 0.33, 0.6);
  }

  if (look && look.flash > 0) fillSilhouette(g, shape, x, y, r + 1.2, PALETTE.white, 0.8 * look.flash * alpha);

  // Lebensbalken hinter der Einheit (gegen die Blickrichtung), damit er Klinge, Bogen und Heiligenschein nicht verdeckt.
  if (minion && minion.hp < maxHp) {
    const width = 14;
    const barY = baseY - r - 7;
    drawBar(g, x - width / 2, barY, width, 3, minion.hp / maxHp, healthFill(minion.hp / maxHp), 'steel');
  }
}

/**
 * Lanes, Bauplätze, beide Tower-Gruppen und die Ausbaustufe. Lanes, die der Mensch noch nicht freigeschaltet hat,
 * liegen abgedunkelt mit ihrer Freischalt-Stufe da. `highlight` rahmt die freien Lanes golden.
 */
export function drawBoard(g: Phaser.GameObjects.Graphics, label: LabelFn, state: MatchState, highlight = false): void {
  const human = state.players[HUMAN];
  const bot = state.players[BOT];
  const slots = lineCapacity(human.level);
  const left = FIELD.ownTowerX - 14;
  const width = FIELD.enemyTowerX - FIELD.ownTowerX + 28;
  for (let line = 0; line < LANE_COUNT; line += 1) {
    const center = FIELD.laneCenters[line]!;
    const top = center - FIELD.pathHalfHeight;
    const height = FIELD.pathHalfHeight * 2;
    if (!isLaneUnlocked(human.level, line)) {
      g.fillStyle(PALETTE.black, 0.62).fillRect(left, top, width, height);
      label(`${laneName(line)} · mit Lane +1 (Lvl ${laneUnlockLevel(line)})`, 180, center, { size: 10, color: TEXT.dim });
      for (const tower of bot.lines[line]!.towers) drawTower(g, label, lineX(BOT, tower.offset ?? 0), center, tower, BOT);
      continue;
    }
    if (highlight) {
      g.fillStyle(PALETTE.gold, 0.07).fillRoundedRect(left, top - 3, width, height + 6, 8);
      g.lineStyle(3, PALETTE.gold, 0.18).strokeRoundedRect(left - 1, top - 4, width + 2, height + 8, 9);
      g.lineStyle(2, PALETTE.gold, 0.65).strokeRoundedRect(left, top - 3, width, height + 6, 8);
    }
    for (let slot = 0; slot < slots; slot += 1) {
      if (!isValidSlot(slot, slots)) continue;
      const x = lineX(HUMAN, slotPosition(slot));
      const free = isSlotFree(human.minions, line, slot);
      g.fillStyle(PALETTE.black, 0.3).fillEllipse(x, center + 1.5, 11, 7);
      g.fillStyle(free ? PALETTE.stoneDark : PALETTE.humanDark, free ? 0.7 : 0.55).fillEllipse(x, center, 10, 6);
      g.lineStyle(1, free ? PALETTE.bronze : PALETTE.human, free ? 0.7 : 0.8).strokeEllipse(x, center, 10, 6);
    }
    for (const tower of bot.lines[line]!.towers) drawTower(g, label, lineX(BOT, tower.offset ?? 0), center, tower, BOT);
    for (const tower of human.lines[line]!.towers) drawTower(g, label, lineX(HUMAN, tower.offset ?? 0), center, tower, HUMAN);
    label(laneName(line), 180, center - 30, { size: 9, color: TEXT.gold });
    // Aktive Synergien der Lane (nur Anzeige, die Regeln stehen in `logic/synergies.ts`).
    human.synergies
      .filter((synergy) => synergy.line === null || synergy.line === line)
      .forEach((synergy, row) => label(describeSynergy(synergy), 268, center - 30 + row * 9, { size: 8, color: TEXT.good }));
  }
  label(`Feld Lvl ${human.level}`, 330, 58, { size: 10, color: TEXT.gold });
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
