/**
 * Zeichnet Spielfeld, Tower, Bauplätze und Minions (Boden und Wege liegen im Hintergrundbild, siehe `textures.ts`).
 * Beide Teams tragen ihre Teamfarbe samt Leuchten und werfen einen Schatten; die Form folgt der Rolle
 * (`logic/minion-look.ts`). Nur Darstellung, keine Regeln.
 */
import Phaser from 'phaser';
import { type Explosion, LINE_LENGTH } from '../logic/combat';
import { LANE_COUNT, laneName, laneRow, laneTowerOffsets, laneUnlockLevel } from '../logic/lanes';
import { getCardDef } from '../logic/cards';
import { cardTypeStyle } from '../logic/card-style';
import { isLaneOpen, LANE_COST, type MatchState, type PlayerState } from '../logic/match';
import {
  attackProgress,
  bobOffset,
  deathAlpha,
  deathAngle,
  deathProgress,
  facing,
  flashKey,
  flashStrength,
  laneStagger,
  type MinionAnim,
  type MinionGhost,
  minionPhase,
  minionRadius,
  type MinionShape,
  minionShape,
  strideSwing,
  walkCycle,
} from '../logic/minion-look';
import { squashScale } from '../logic/juice';
import {
  LANE_SLOT_GAP,
  type LineGeometry,
  positionToX,
  SLOT_DY,
  slotPoint,
  slotSide,
  slotTower,
  validSlots,
} from '../logic/placement';
import {
  emberFlicker,
  SMOKE_RISE,
  smokePuff,
  smokePuffCount,
  TOWER_LOOKS,
  towerDamageStage,
  towerSeed,
} from '../logic/tower-look';
import { describeSynergy } from '../logic/synergies';
import type { Point } from './effects';
import type { LabelFn } from './labels';
import { drawFigure } from './minion-figure';
import { drawBar, healthFill, lerpColor, LIGHT, MATERIAL, PALETTE, TEAM_COLOR, TEXT } from './theme';

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

const teamOf = (owner: number) => (owner === HUMAN ? TEAM[HUMAN] : TEAM[BOT]);

/** X-Koordinate einer Position (0 bis `LINE_LENGTH`), gezählt vom eigenen Ende des jeweiligen Spielers aus. */
export function lineX(owner: number, position: number): number {
  if (owner === HUMAN) return positionToX(position, GEOMETRY);
  return FIELD.enemyTowerX - (position / LINE_LENGTH) * (FIELD.enemyTowerX - FIELD.ownTowerX);
}

/** Strecke (Positionen) nach dem Start am Tower, auf der ein Minion vom Slot-Platz auf die Lane-Mitte zurückgleitet. */
const SLOT_BLEND = 14;

/**
 * Mittelpunkt, an dem ein Minion gezeichnet wird. Mit `spawn` (Standort seines Towers) steht es in der Planung auf
 * seinem Turm-Slot oben oder unten und gleitet beim Loslaufen auf die Lane (quer versetzt nach ID); ohne `spawn` läuft
 * es auf der Lane.
 */
export function minionPoint(
  owner: number,
  minion: { id: number; line: number; position: number; slot?: number },
  spawn?: number,
): Point {
  const center = FIELD.laneCenters[minion.line]!;
  const t = spawn === undefined || minion.slot === undefined ? 0 : Math.min(1, Math.max(0, 1 - (minion.position - spawn) / SLOT_BLEND));
  const hold = t * t * (3 - 2 * t);
  const slotY = slotSide(minion.slot ?? 0) === 0 ? -SLOT_DY : SLOT_DY;
  return {
    x: lineX(owner, minion.position),
    y: center + laneStagger(minion.id) * (1 - hold) + slotY * hold,
  };
}

/** Wie `minionPoint`, nimmt den Standort des Towers aus dem Zustand des Spielers. */
export function playerMinionPoint(owner: number, player: PlayerState, minion: PlayerState['minions'][number]): Point {
  const tower = minion.slot === undefined ? undefined : player.lines[minion.line]?.towers[slotTower(minion.slot)];
  return minionPoint(owner, minion, tower === undefined ? undefined : (tower.offset ?? 0));
}

/** Standort des Towers `tower` der Lane `line`; die Positionen der Tower stehen in `lanes.ts`. */
export function towerPoint(owner: number, line: number, tower: number): Point {
  return { x: lineX(owner, laneTowerOffsets(line)[tower] ?? 0), y: FIELD.laneCenters[line]! };
}

type Segment = readonly [number, number, number, number];
const WALL_CRACKS: readonly Segment[] = [[-7, -8, -4, -2], [6, -8, 3, 0], [-8, 4, -3, 9], [7, 3, 4, 10]];
const RUIN_CRACKS: readonly Segment[] = [[-6, 4, -4, 10], [4, 5, 2, 11], [0, 4, 1, 8], [6, 6, 7, 10]];
const WALL_EMBERS: readonly (readonly [number, number])[] = [[-6, -12], [5, -4], [-2, 8]];
const RUIN_EMBERS: readonly (readonly [number, number])[] = [[-5, 5], [4, 7], [0, 10]];

/** Ein Tower, kompakt (die drei Tower der Start-Lane stehen nur 24 px auseinander), mit Lebensbalken darüber. */
export function drawTower(
  g: Phaser.GameObjects.Graphics,
  label: LabelFn,
  x: number,
  y: number,
  tower: { hp: number; maxHp: number; specialization?: 'lightning' | 'shield' },
  owner: number,
  timeMs = 0,
): void {
  const { hp, maxHp } = tower;
  const look = TOWER_LOOKS[towerDamageStage(hp, maxHp)];
  const alive = !look.collapsed;
  const team = teamOf(owner);
  const accent = alive ? team.main : PALETTE.stoneDark;
  const wall = alive ? PALETTE.stone : lerpColor(PALETTE.stoneDark, PALETTE.black, 0.3);
  const shade = lerpColor(wall, PALETTE.black, 0.45);

  // Schatten und Teamfarben-Schein auf dem Boden.
  g.fillStyle(PALETTE.black, 0.4).fillEllipse(x + 2, y + 12, 22, 7);
  if (alive) g.fillStyle(team.main, 0.2).fillEllipse(x, y + 10, 26, 10);

  if (look.collapsed) {
    // Ruine: niedrige, zerbrochene Mauerreste an derselben Stelle.
    g.fillStyle(shade, 1).fillRect(x - 9, y + 3, 18, 9);
    g.fillStyle(wall, 1).fillRect(x - 9, y + 3, 7, 4).fillRect(x + 1, y + 5, 8, 3).fillRect(x - 3, y + 1, 4, 3);
    g.fillStyle(accent, 1).fillRect(x - 9, y + 5, 2, 7);
    g.fillStyle(PALETTE.black, 0.55).fillTriangle(x + 2, y + 3, x + 9, y + 3, x + 9, y + 9);
  } else {
    // Mauerwerk: Zinnen (abgebrochene fehlen von rechts), Sockel mit Verlauf, Teamfarben-Streifen, Schild in der Mitte.
    for (let block = 0; block < 3 - look.missingMerlons; block += 1) {
      g.fillStyle(wall, 1).fillRect(x - 9 + block * 7, y - 13, 4, 4);
    }
    g.fillStyle(shade, 1).fillRect(x - 9, y - 9, 18, 21);
    g.fillStyle(wall, 1).fillRect(x - 9, y - 9, 18, 10);
    g.fillStyle(PALETTE.white, 0.18).fillRect(x - 9, y - 9, 18, 1);
    g.fillStyle(accent, 1).fillRect(x - 9, y - 9, 2, 21).fillRect(x + 7, y - 9, 2, 21);
    g.fillStyle(accent, 1).fillRoundedRect(x - 6, y - 6, 12, 13, 2);
    g.fillStyle(PALETTE.panelDark, 0.9).fillRoundedRect(x - 5, y - 5, 10, 11, 2);

    if (tower.specialization) {
      // Markierung im Schild des Towers (die Fläche über dem Tower gehört den Turm-Slots): gelb für den Blitz-Turm,
      // blau für den Schild-Turm.
      const mark = tower.specialization === 'lightning' ? TEAM_COLOR.markLightning : TEAM_COLOR.markShield;
      g.fillStyle(mark, 0.35).fillRoundedRect(x - 5, y - 5, 10, 11, 2);
      g.lineStyle(1, mark, 1).strokeRoundedRect(x - 5.5, y - 5.5, 11, 12, 2);
    }
  }

  // Risse (feste Anordnung, nur die Anzahl wächst mit dem Schaden); in der Ruine auf die Mauerreste begrenzt.
  const cracks = look.collapsed ? RUIN_CRACKS : WALL_CRACKS;
  g.lineStyle(1, PALETTE.black, 0.8);
  for (const [x1, y1, x2, y2] of cracks.slice(0, look.cracks)) g.lineBetween(x + x1, y + y1, x + x2, y + y2);

  // Glut an den Bruchstellen und Rauch; beides aus der Szenenzeit, nie aus Frames.
  const seed = towerSeed(x, y);
  const embers = look.ember > 0 ? (look.collapsed ? RUIN_EMBERS : WALL_EMBERS) : [];
  embers.forEach(([ex, ey], index) => {
    const glow = look.ember * emberFlicker(timeMs, index, seed);
    g.fillStyle(LIGHT.emberGlow, 0.55 * glow).fillCircle(x + ex, y + ey, 2.2);
    g.fillStyle(LIGHT.emberCore, 0.9 * glow).fillCircle(x + ex, y + ey, 1);
  });
  const puffs = smokePuffCount(look.smoke);
  const smokeY = look.collapsed ? y + 2 : y - 13;
  for (let index = 0; index < puffs; index += 1) {
    const puff = smokePuff(timeMs, index, seed);
    const alpha = look.smoke * 0.5 * (1 - puff.rise);
    g.fillStyle(MATERIAL.smoke, alpha).fillCircle(x - 3 + index * 3 + puff.drift, smokeY - puff.rise * SMOKE_RISE, 2 + puff.rise * 2);
  }

  drawBar(g, x - 10, y - 21, 20, 4, maxHp > 0 ? hp / maxHp : 0, healthFill(maxHp > 0 ? hp / maxHp : 0), 'gold');
  label(`${Math.ceil(hp)}`, x, y + 1, { size: 8, bold: true, font: 'heading', color: alive ? TEXT.main : TEXT.dim });
}

export type { MinionAnim };

/** Zeitbezogene Darstellung eines Minions: Szenenzeit (aus `delta` summiert), Laufen, Angriff und Trefferblitz (0 bis 1). */
export interface MinionLook {
  id: number;
  timeMs: number;
  moving: boolean;
  flash: number;
  /** Restzeit der Angriffsbewegung in ms (0 = kein Angriff). */
  attackRemainingMs?: number;
  /** Squash & Stretch (Faktoren auf Breite und Höhe, `squashScale`); fehlt = unverformt. */
  squash?: { x: number; y: number };
}

/** Figur im Maßstab 1 ist 24 Einheiten hoch; `FIGURE_UNIT` rechnet den Radius (`minionRadius`) in diesen Maßstab um. */
const FIGURE_UNIT = 9;

/**
 * Ein Minion als Figur (`minion-figure.ts`) mit Schatten, Teamfarben-Leuchten und Lebensbalken. `look` liefert die Phase
 * (Laufen, Angriff) und den Trefferblitz; ohne `look` steht die Figur still. Ohne `minion` (gezogene Figur) entsteht ein
 * neutraler Nahkämpfer. `baseY` ist die Mitte der Figur; die Beine reichen darunter bis zum Boden.
 */
export function drawMinionBody(
  g: Phaser.GameObjects.Graphics,
  x: number,
  baseY: number,
  owner: number,
  minion?: { hp: number; maxHp?: number; heals?: boolean; explodes?: Explosion; range: number; source?: 'card' | 'tower' },
  baseAlpha = 1,
  look?: MinionLook,
): void {
  // Spawn-Minions der Türme sind blasser als beschworene Figuren, damit man sie auf einen Blick unterscheidet.
  const alpha = minion?.source === 'tower' ? baseAlpha * 0.65 : baseAlpha;
  const team = teamOf(owner);
  const maxHp = minion ? (minion.maxHp ?? minion.hp) : 0;
  const r = minion ? minionRadius(maxHp) : MINION_RADIUS;
  const shape: MinionShape = minion ? minionShape(minion) : 'melee';
  const scale = r / FIGURE_UNIT;
  const feetY = baseY + 12 * scale;
  const phase = look ? minionPhase(look.moving, look.attackRemainingMs ?? 0) : 'idle';
  const stride = look && phase === 'walk' ? strideSwing(walkCycle(look.timeMs, look.id)) : 0;

  // Schatten und Leuchten in der Teamfarbe bleiben am Boden.
  g.fillStyle(PALETTE.black, 0.38 * alpha).fillEllipse(x + 1, feetY, r * 2.2, r * 0.9);
  g.fillStyle(team.main, 0.18 * alpha).fillEllipse(x, feetY - 2, r * 2.6, r * 1.2);

  drawFigure(g, shape, x, feetY, facing(owner), scale, team, {
    stride,
    bob: look && phase === 'walk' ? bobOffset(look.timeMs, look.id, true) : 0,
    attack: phase === 'attack' ? attackProgress(look?.attackRemainingMs ?? 0) : null,
    fall: 0,
    flash: look?.flash ?? 0,
    alpha,
    squash: look?.squash,
  });

  // Lebensbalken über dem Kopf.
  if (minion && minion.hp < maxHp) {
    const width = 14;
    drawBar(g, x - width / 2, feetY - 31 * scale, width, 3, minion.hp / maxHp, healthFill(minion.hp / maxHp), 'steel');
  }
}

/** Eine sterbende Einheit (Kopie aus `updateGhosts`): kippt nach hinten um und blendet aus; ohne Lebensbalken. */
function drawGhost(g: Phaser.GameObjects.Graphics, ghost: MinionGhost): void {
  const progress = deathProgress(ghost.ageMs);
  const alpha = deathAlpha(progress);
  if (alpha <= 0) return;
  const point = minionPoint(ghost.owner, { id: ghost.id, line: ghost.line, position: ghost.position });
  const scale = ghost.radius / FIGURE_UNIT;
  const feetY = point.y + 12 * scale;
  g.fillStyle(PALETTE.black, 0.38 * alpha).fillEllipse(point.x + 1, feetY, ghost.radius * 2.2, ghost.radius * 0.9);
  drawFigure(g, ghost.shape, point.x, feetY, facing(ghost.owner), scale, teamOf(ghost.owner), {
    stride: 0,
    bob: 0,
    attack: null,
    fall: deathAngle(progress),
    flash: 1 - progress,
    alpha,
  });
}

/** Kurzname für die Zuordnung am Slot, z. B. „T2o“ (Turm 2, oben) – steht neben jeder Einheit auf einem Turm-Slot. */
function slotTag(slot: number): string {
  return `T${slotTower(slot) + 1}${slotSide(slot) === 0 ? 'o' : 'u'}`;
}

/**
 * Turm-Slots der Lane: zwei je lebendem Tower, oben und unten. Ein freier Slot ist ein schwacher Ring; ein besetzter
 * trägt die Farbe der Karte (Kartentyp), eine Linie zum Tower und das Kürzel von Turm und Seite.
 */
function drawSlotMarkers(
  g: Phaser.GameObjects.Graphics,
  label: LabelFn,
  state: MatchState,
  line: number,
  planning: boolean,
): void {
  const human = state.players[HUMAN];
  const towers = human.lines[line]!.towers;
  const center = FIELD.laneCenters[line]!;
  for (const slot of validSlots(towers)) {
    const point = slotPoint(line, towers, slot, GEOMETRY);
    const occupant = human.minions.find((m) => m.line === line && m.slot === slot);
    const top = slotSide(slot) === 0;
    if (!occupant) {
      g.lineStyle(1, PALETTE.bronze, 0.55).strokeCircle(point.x, point.y, 5);
      continue;
    }
    const cardId = state.stats.cardByMinion[occupant.id];
    const color = cardId === undefined ? PALETTE.human : cardTypeStyle(getCardDef(cardId).type).accent;
    g.lineStyle(1.5, PALETTE.human, 0.6).lineBetween(point.x, top ? point.y + 8 : point.y - 8, point.x, center + (top ? -13 : 12));
    g.fillStyle(color, 0.28).fillCircle(point.x, point.y, 10);
    g.lineStyle(2, color, 0.95).strokeCircle(point.x, point.y, 10);
    if (planning) label(slotTag(slot), point.x + 15, point.y, { size: 7, color: TEXT.dim });
  }
}

/** Lane-Slot hinter dem Tower-Ende: leer ein Quadrat-Rahmen, mit Lane-Karte gefüllt in der Kartenfarbe samt Kürzel. */
function drawLaneSlot(
  g: Phaser.GameObjects.Graphics,
  label: LabelFn,
  line: { laneCard?: string; laneEffect?: string },
  x: number,
  y: number,
): void {
  if (line.laneCard === undefined) {
    g.lineStyle(1, PALETTE.bronze, 0.55).strokeRoundedRect(x - 5, y - 5, 10, 10, 2);
    return;
  }
  const style = cardTypeStyle(getCardDef(line.laneCard).type);
  g.fillStyle(style.accent, 0.85).fillRoundedRect(x - 6, y - 6, 12, 12, 3);
  g.lineStyle(1.5, PALETTE.white, 0.8).strokeRoundedRect(x - 6, y - 6, 12, 12, 3);
  label(line.laneEffect === 'buff' ? 'B' : 'S', x, y, { size: 8, bold: true, font: 'heading' });
}

/** Ein Punkt, den die Szene beim Ziehen einer Karte oder Einheit zeichnet; `proximity` kommt von `slotProximity`. */
export interface SlotDot {
  x: number;
  y: number;
  /** 0 bis 1: wie nah der Zeiger ist (geglättet über `delta`). */
  proximity: number;
}

/**
 * Grüne Punkte an den Zielen eines Zugs. Je näher der Zeiger, desto größer und heller der Punkt (Skalierung und Glow);
 * `fade` (0 bis 1) blendet alle Punkte weich ein, `timeMs` lässt sie leicht pulsieren.
 */
export function drawSlotDots(g: Phaser.GameObjects.Graphics, dots: readonly SlotDot[], timeMs: number, fade: number): void {
  dots.forEach((dot, index) => {
    const pulse = 0.5 + 0.5 * Math.sin(timeMs / 240 + index);
    const r = (4.5 + 3.5 * dot.proximity + 0.6 * pulse) * fade;
    g.fillStyle(PALETTE.good, (0.1 + 0.3 * dot.proximity) * fade).fillCircle(dot.x, dot.y, r + 5 + 9 * dot.proximity);
    g.fillStyle(PALETTE.good, fade).fillCircle(dot.x, dot.y, r);
    g.lineStyle(1.5, PALETTE.white, (0.35 + 0.55 * dot.proximity) * fade).strokeCircle(dot.x, dot.y, r + 1);
  });
}

/**
 * Lanes, Bauplätze und beide Tower-Gruppen. Lanes, die der Mensch noch nicht gekauft hat, liegen abgedunkelt mit
 * Preis oder nötiger Feldstufe da. `highlight` rahmt die gekauften Lanes golden.
 */
export function drawBoard(g: Phaser.GameObjects.Graphics, label: LabelFn, state: MatchState, highlight = false, timeMs = 0): void {
  const human = state.players[HUMAN];
  const bot = state.players[BOT];
  const left = FIELD.ownTowerX - 14;
  const width = FIELD.enemyTowerX - FIELD.ownTowerX + 28;
  for (let line = 0; line < LANE_COUNT; line += 1) {
    const center = FIELD.laneCenters[line]!;
    const top = center - FIELD.pathHalfHeight;
    const height = FIELD.pathHalfHeight * 2;
    if (!isLaneOpen(human, line)) {
      g.fillStyle(PALETTE.black, 0.62).fillRect(left, top, width, height);
      const buyable = human.level >= laneUnlockLevel(line);
      label(
        buyable
          ? `${laneName(line)} · tippen zum Kaufen (${LANE_COST} Energie)`
          : `${laneName(line)} · ab Feld Lvl ${laneUnlockLevel(line)} kaufbar`,
        180,
        center,
        { size: 10, color: buyable ? TEXT.gold : TEXT.dim },
      );
      // Die Tower stehen auch auf nicht gekauften Lanes (beide Seiten) und werden dort angegriffen und spawnen.
      for (const tower of bot.lines[line]!.towers) drawTower(g, label, lineX(BOT, tower.offset ?? 0), center, tower, BOT, timeMs);
      for (const tower of human.lines[line]!.towers) drawTower(g, label, lineX(HUMAN, tower.offset ?? 0), center, tower, HUMAN, timeMs);
      continue;
    }
    if (highlight) {
      g.fillStyle(PALETTE.gold, 0.07).fillRoundedRect(left, top - 3, width, height + 6, 8);
      g.lineStyle(3, PALETTE.gold, 0.18).strokeRoundedRect(left - 1, top - 4, width + 2, height + 8, 9);
      g.lineStyle(2, PALETTE.gold, 0.65).strokeRoundedRect(left, top - 3, width, height + 6, 8);
    }
    drawSlotMarkers(g, label, state, line, state.phase === 'planning');
    drawLaneSlot(g, label, human.lines[line]!, lineX(HUMAN, 0) - LANE_SLOT_GAP, center);
    drawLaneSlot(g, label, bot.lines[line]!, lineX(BOT, 0) + LANE_SLOT_GAP, center);
    for (const tower of bot.lines[line]!.towers) drawTower(g, label, lineX(BOT, tower.offset ?? 0), center, tower, BOT, timeMs);
    for (const tower of human.lines[line]!.towers) {
      drawTower(g, label, lineX(HUMAN, tower.offset ?? 0), center, tower, HUMAN, timeMs);
    }
    label(laneName(line), 180, center - 30, { size: 9, color: TEXT.gold });
    // Aktive Synergien der Lane (nur Anzeige, die Regeln stehen in `logic/synergies.ts`).
    human.synergies
      .filter((synergy) => synergy.line === null || synergy.line === line)
      .forEach((synergy, row) => label(describeSynergy(synergy), 268, center - 30 + row * 9, { size: 8, color: TEXT.good }));
  }
}

/**
 * Alle Minions beider Spieler samt sterbenden Kopien; `skipHumanId` lässt einen eigenen Minion aus (der gerade gezogen
 * wird). `anim` bringt Szenenzeit, Trefferblitze, Angriffe und Sterbende; im Kampf laufen die Minions im Schritt.
 */
export function drawMinions(g: Phaser.GameObjects.Graphics, state: MatchState, skipHumanId?: number, anim?: MinionAnim): void {
  const moving = state.phase === 'combat';
  for (const owner of [BOT, HUMAN]) {
    const player = state.players[owner]!;
    for (const minion of player.minions) {
      if (owner === HUMAN && skipHumanId === minion.id) continue;
      const point = playerMinionPoint(owner, player, minion);
      const squashRun = anim?.squashes.get(flashKey(owner, minion.id));
      const look = anim
        ? {
            squash: squashRun && squashScale(squashRun),
            id: minion.id,
            timeMs: anim.timeMs,
            moving,
            flash: flashStrength(anim.flashes.get(flashKey(owner, minion.id)) ?? 0),
            attackRemainingMs: anim.attacks.get(flashKey(owner, minion.id)) ?? 0,
          }
        : undefined;
      drawMinionBody(g, point.x, point.y, owner, minion, 1, look);
    }
  }
  for (const ghost of anim?.ghosts ?? []) drawGhost(g, ghost);
}
