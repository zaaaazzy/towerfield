import Phaser from 'phaser';
import { botPlan } from '../logic/bot';
import { getCardDef } from '../logic/cards';
import { LINE_LENGTH } from '../logic/combat';
import {
  advance,
  createMatch,
  HAND_LIMIT,
  LINE_COUNT,
  type MatchState,
  MAX_ROUNDS,
  lineCapacity,
  moveMinion,
  playCard,
  setReady,
} from '../logic/match';
import { HAND_FILTER_NAMES, type HandFilter, isCardVisible, nextHandFilter } from '../logic/hand-filter';
import { parseSeed } from '../logic/seed';
import { type DropTarget, dropTargetAt, type LineGeometry, positionToY, slotPosition } from '../logic/placement';

/** Spielfläche im Hochformat; Phaser skaliert sie per `Scale.FIT` auf den Bildschirm. */
export const VIEW = { width: 360, height: 640 };

const HUMAN = 0;
const BOT = 1;

const LAYOUT = {
  lineCenters: [60, 180, 300],
  lineHalfWidth: 50,
  enemyTowerY: 90,
  ownTowerY: 400,
  cardWidth: 66,
  cardHeight: 62,
  cardGap: 4,
  cardsPerRow: 5,
  handTop: 440,
  button: { x: 230, y: 592, width: 120, height: 40 },
  /** Filtertaste für die Hand: schaltet bei jedem Tipp weiter, links neben `button`, unter den Karten. */
  filterButton: { x: 122, y: 592, width: 102, height: 40 },
};

const STATS_PANEL = { x: 20, y: 60, width: 320, height: 500 };
const STATS_CLOSE = { x: 120, y: 504, width: 120, height: 40 };

export const COLORS = {
  human: 0x4fc3f7,
  bot: 0xff7043,
  line: 0x1d2333,
  card: 0x2a3350,
  selected: 0xffd54a,
  valid: 0x66bb6a,
  invalid: 0xef5350,
};

const MINION_RADIUS = 7;
/** Trefferradius zum Greifen eines Minions; größer als die gezeichnete Fläche, damit Touch trifft. */
const GRAB_RADIUS = 18;
/** Bewegung in Spielpixeln, ab der aus einem Antippen ein Ziehen wird. */
const DRAG_THRESHOLD = 8;

const GEOMETRY: LineGeometry = {
  lineCenters: LAYOUT.lineCenters,
  lineHalfWidth: LAYOUT.lineHalfWidth,
  ownTowerY: LAYOUT.ownTowerY,
  enemyTowerY: LAYOUT.enemyTowerY,
};

/** Zeigerzustand: gedrückt auf einem Minion (noch ein Tippen) oder schon am Ziehen. */
interface DragState {
  minionId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  target: DropTarget | null;
  valid: boolean;
}

/** Mittelpunkt, an dem ein Minion gezeichnet wird. */
function minionPoint(owner: number, minion: { id: number; line: number; position: number }): { x: number; y: number } {
  return {
    x: LAYOUT.lineCenters[minion.line]! + (minion.id % 2 === 0 ? 8 : -8),
    y: lineY(owner, minion.position),
  };
}

function cardRect(index: number): { x: number; y: number; width: number; height: number } {
  const column = index % LAYOUT.cardsPerRow;
  const row = Math.floor(index / LAYOUT.cardsPerRow);
  return {
    x: 7 + column * (LAYOUT.cardWidth + LAYOUT.cardGap),
    y: LAYOUT.handTop + row * (LAYOUT.cardHeight + LAYOUT.cardGap),
    width: LAYOUT.cardWidth,
    height: LAYOUT.cardHeight,
  };
}

function inside(rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Y-Koordinate einer Position (0 bis `LINE_LENGTH`) vom Tower des jeweiligen Spielers aus. */
function lineY(owner: number, position: number): number {
  if (owner === HUMAN) return positionToY(position, GEOMETRY);
  const span = LAYOUT.ownTowerY - LAYOUT.enemyTowerY;
  return LAYOUT.enemyTowerY + (position / LINE_LENGTH) * span;
}

export interface LabelOptions {
  size?: number;
  color?: string;
  origin?: number;
  width?: number;
}

/** Wiederverwendete Textobjekte: pro Bild `reset()`, dann `label()` je Text, am Ende `hideUnused()`. */
export class LabelPool {
  private texts: Phaser.GameObjects.Text[] = [];
  private cursor = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  reset(): void {
    this.cursor = 0;
  }

  label(text: string, x: number, y: number, options: LabelOptions = {}): void {
    let object = this.texts[this.cursor];
    if (!object) {
      object = this.scene.add.text(0, 0, '', { fontFamily: 'sans-serif', align: 'center' });
      this.texts.push(object);
    }
    this.cursor += 1;
    object
      .setText(text)
      .setPosition(x, y)
      .setFontSize(options.size ?? 12)
      .setColor(options.color ?? '#ffffff')
      .setOrigin(options.origin ?? 0.5, 0.5)
      .setWordWrapWidth(options.width ?? 0)
      .setVisible(true);
  }

  hideUnused(): void {
    for (let index = this.cursor; index < this.texts.length; index += 1) this.texts[index]!.setVisible(false);
  }
}

export type LabelFn = LabelPool['label'];

/** Tower einer Line samt Lebensbalken; `direction` 1 = Balken unter dem Tower, -1 = darüber. */
export function drawTower(
  g: Phaser.GameObjects.Graphics,
  label: LabelFn,
  x: number,
  y: number,
  line: { tower: { hp: number; maxHp: number } },
  color: number,
  direction: 1 | -1,
): void {
  const { hp, maxHp } = line.tower;
  const top = y - 12;
  g.fillStyle(hp > 0 ? color : 0x444b5e, 1).fillRect(x - 28, top, 56, 24);
  g.fillStyle(0x000000, 0.5).fillRect(x - 28, top + (direction === 1 ? 26 : -8), 56, 5);
  g.fillStyle(0x66bb6a, 1).fillRect(x - 28, top + (direction === 1 ? 26 : -8), 56 * (hp / maxHp), 5);
  label(`${Math.ceil(hp)}`, x, y, { size: 12, color: '#10141f' });
}

/** Hintergrund, Lines, beide Tower und die Line-Stufen des Spielers unten. `highlight` rahmt die Lines gelb. */
export function drawBoard(g: Phaser.GameObjects.Graphics, label: LabelFn, state: MatchState, highlight = false): void {
  const human = state.players[HUMAN];
  const bot = state.players[BOT];
  g.fillStyle(0x10141f, 1).fillRect(0, 0, VIEW.width, VIEW.height);
  for (let line = 0; line < LINE_COUNT; line += 1) {
    const center = LAYOUT.lineCenters[line]!;
    g.fillStyle(COLORS.line, 1).fillRect(center - 14, LAYOUT.enemyTowerY, 28, LAYOUT.ownTowerY - LAYOUT.enemyTowerY);
    if (highlight) {
      g.lineStyle(2, COLORS.selected, 0.6).strokeRect(
        center - LAYOUT.lineHalfWidth,
        LAYOUT.enemyTowerY - 30,
        LAYOUT.lineHalfWidth * 2,
        LAYOUT.ownTowerY - LAYOUT.enemyTowerY + 60,
      );
    }
    drawTower(g, label, center, LAYOUT.enemyTowerY, bot.lines[line]!, COLORS.bot, -1);
    drawTower(g, label, center, LAYOUT.ownTowerY, human.lines[line]!, COLORS.human, 1);
    label(`Line ${line + 1} · Stufe ${human.lines[line]!.level}`, center, LAYOUT.ownTowerY + 38, {
      size: 10,
      color: '#9aa4bf',
    });
  }
}

/** Alle Minions beider Spieler; `skipHumanId` lässt einen eigenen Minion aus (der gerade gezogen wird). */
export function drawMinions(g: Phaser.GameObjects.Graphics, state: MatchState, skipHumanId?: number): void {
  for (const owner of [BOT, HUMAN]) {
    for (const minion of state.players[owner]!.minions) {
      if (owner === HUMAN && skipHumanId === minion.id) continue;
      const point = minionPoint(owner, minion);
      g.fillStyle(owner === HUMAN ? COLORS.human : COLORS.bot, 1).fillCircle(point.x, point.y, MINION_RADIUS);
    }
  }
}

/**
 * Spielbare Basis-Szene: liest Touch/Maus, ruft die Match-Logik auf und zeichnet das Ergebnis.
 * Spieler 0 (unten) ist der Mensch, Spieler 1 (oben) der lokale Bot.
 */
export class MainScene extends Phaser.Scene {
  private state: MatchState = createMatch(1);
  private graphics!: Phaser.GameObjects.Graphics;
  private pool!: LabelPool;
  /** Index der angetippten Karte, die auf eine Line wartet. */
  private selected: number | null = null;
  private message = '';
  private drag: DragState | null = null;
  /** Statistik-Overlay nach Match-Ende wurde geschlossen. */
  private statsClosed = false;
  /** Kartenfilter der Hand; reiner Darstellungs- und Eingabezustand, wird nicht gespeichert. */
  private handFilter: HandFilter = 'all';

  constructor() {
    super('main');
  }

  /** Aktueller Spielzustand (nur lesen), z. B. für den Smoke-Test. */
  get current(): MatchState {
    return this.state;
  }

  /** Index der angetippten Handkarte, die auf eine Line wartet (nur lesen, z. B. für E2E-Tests). */
  get selectedCard(): number | null {
    return this.selected;
  }

  create(): void {
    this.state = createMatch(parseSeed(window.location.search) ?? Date.now() >>> 0);
    this.pool = new LabelPool(this);
    this.selected = null;
    this.message = '';
    this.drag = null;
    this.statsClosed = false;
    this.handFilter = 'all';
    this.graphics = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer.worldX, pointer.worldY));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer.worldX, pointer.worldY));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer.worldX, pointer.worldY));
    this.input.on('pointerupoutside', () => {
      this.drag = null;
    });
    this.render();
  }

  update(_time: number, deltaMs: number): void {
    if (this.state.phase === 'planning' && !this.state.ready[BOT]) {
      this.state = botPlan(this.state, BOT);
    }
    this.state = advance(this.state, deltaMs);
    if (this.state.phase !== 'planning') this.selected = null;
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN]) this.drag = null;
    this.render();
  }

  /** Id des eigenen, verschiebbaren Minions unter dem Punkt, sonst `null`. */
  private grabbableMinionAt(x: number, y: number): number | null {
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN]) return null;
    const player = this.state.players[HUMAN];
    let best: number | null = null;
    let bestDistance = GRAB_RADIUS;
    for (const placement of player.placements) {
      const minion = player.minions.find((m) => m.id === placement.minionId);
      if (!minion) continue;
      const point = minionPoint(HUMAN, minion);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) {
        best = minion.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  private onPointerDown(x: number, y: number): void {
    const minionId = this.grabbableMinionAt(x, y);
    if (minionId === null) {
      this.drag = null;
      this.handleTap(x, y);
      return;
    }
    this.drag = { minionId, startX: x, startY: y, x, y, dragging: false, target: null, valid: false };
  }

  private onPointerMove(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    drag.x = x;
    drag.y = y;
    if (!drag.dragging && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return;
    drag.dragging = true;
    drag.target = this.targetAt(x, y);
    drag.valid =
      drag.target !== null &&
      drag.target.slot !== null &&
      moveMinion(this.state, HUMAN, drag.minionId, drag.target.line, drag.target.slot).ok;
  }

  private onPointerUp(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (!drag.dragging) {
      // Kurzes Antippen ohne Ziehen: wie bisher behandeln.
      this.handleTap(drag.startX, drag.startY);
      return;
    }
    const target = this.targetAt(x, y);
    if (!target) {
      this.message = '';
      return;
    }
    const result = moveMinion(this.state, HUMAN, drag.minionId, target.line, target.slot ?? -1);
    if (result.ok) {
      this.state = result.state;
      this.message = '';
    } else {
      this.message = this.explain(result.reason);
    }
  }

  private targetAt(x: number, y: number): DropTarget | null {
    const counts = this.state.players[HUMAN].lines.map((line) => lineCapacity(line.level));
    return dropTargetAt(x, y, GEOMETRY, counts);
  }

  private handleTap(x: number, y: number): void {
    if (this.state.phase === 'over') {
      if (!this.statsClosed) {
        if (inside(STATS_CLOSE, x, y)) this.statsClosed = true;
        return;
      }
      this.scene.restart();
      return;
    }
    if (this.state.phase !== 'planning') return;
    if (inside(LAYOUT.button, x, y)) {
      this.selected = null;
      this.message = '';
      this.state = setReady(this.state, HUMAN);
      return;
    }
    if (inside(LAYOUT.filterButton, x, y)) {
      this.handFilter = nextHandFilter(this.handFilter);
      const selected = this.selected;
      if (selected !== null && !this.isVisibleInHand(selected)) this.selected = null;
      return;
    }
    const hand = this.state.players[HUMAN].hand;
    for (let index = 0; index < hand.length; index += 1) {
      if (!inside(cardRect(index), x, y)) continue;
      if (!this.isVisibleInHand(index)) return;
      this.message = '';
      const def = getCardDef(hand[index]!);
      if (def.target === 'none') {
        this.play(index);
      } else {
        this.selected = this.selected === index ? null : index;
      }
      return;
    }
    if (this.selected === null) return;
    const line = LAYOUT.lineCenters.findIndex((center) => Math.abs(x - center) <= LAYOUT.lineHalfWidth);
    if (line >= 0 && y >= LAYOUT.enemyTowerY - 30 && y <= LAYOUT.handTop - 4) this.play(this.selected, line);
  }

  /** Ist die Handkarte mit diesem Hand-Index beim aktiven Filter sichtbar und antippbar? */
  private isVisibleInHand(handIndex: number): boolean {
    const id = this.state.players[HUMAN].hand[handIndex];
    return id !== undefined && isCardVisible(getCardDef(id).type, this.handFilter);
  }

  private play(handIndex: number, line?: number): void {
    const result = playCard(this.state, HUMAN, handIndex, line);
    this.state = result.state;
    this.selected = null;
    this.message = result.ok ? '' : this.explain(result.reason);
  }

  private explain(reason: string): string {
    switch (reason) {
      case 'not-enough-energy':
        return 'Nicht genug Energie';
      case 'line-full':
        return 'Line ist voll';
      case 'max-level':
        return 'Line ist auf Höchststufe';
      case 'slot-taken':
        return 'Platz ist belegt';
      case 'invalid-slot':
      case 'invalid-line':
        return 'Hier ist kein Platz';
      default:
        return '';
    }
  }

  private label: LabelFn = (text, x, y, options) => this.pool.label(text, x, y, options);

  private render(): void {
    const g = this.graphics;
    g.clear();
    this.pool.reset();
    const state = this.state;
    const human = state.players[HUMAN];
    const bot = state.players[BOT];

    drawBoard(g, this.label, state, this.selected !== null);

    const phaseText =
      state.phase === 'planning' ? 'Planung' : state.phase === 'combat' ? 'Kampf' : 'Ende';
    this.label(`Runde ${state.round}/${MAX_ROUNDS} · ${phaseText}`, VIEW.width / 2, 16, { size: 14 });
    this.label(`Gegner: ${bot.hand.length} Karten`, VIEW.width / 2, 40, { size: 11, color: '#9aa4bf' });

    const drag = this.drag?.dragging ? this.drag : null;
    if (drag?.target) {
      const color = drag.valid ? COLORS.valid : COLORS.invalid;
      const center = LAYOUT.lineCenters[drag.target.line]!;
      g.lineStyle(2, color, 0.8).strokeRect(
        center - LAYOUT.lineHalfWidth,
        LAYOUT.enemyTowerY - 30,
        LAYOUT.lineHalfWidth * 2,
        LAYOUT.ownTowerY - LAYOUT.enemyTowerY + 42,
      );
      if (drag.target.slot !== null) {
        const slotY = lineY(HUMAN, slotPosition(drag.target.slot));
        g.fillStyle(color, 0.5).fillCircle(center, slotY, GRAB_RADIUS);
      }
    }

    drawMinions(g, state, drag?.minionId);
    if (drag) g.fillStyle(COLORS.human, 0.85).fillCircle(drag.x, drag.y, MINION_RADIUS + 2);

    // Handkarten
    human.hand.slice(0, HAND_LIMIT).forEach((id, index) => {
      const def = getCardDef(id);
      const rect = cardRect(index);
      const visible = isCardVisible(def.type, this.handFilter);
      const affordable = human.energy >= def.cost;
      g.fillStyle(COLORS.card, !visible ? 0.15 : affordable ? 1 : 0.45).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 6);
      if (this.selected === index) {
        g.lineStyle(3, COLORS.selected, 1).strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 6);
      }
      if (!visible) return;
      this.label(`${def.cost}`, rect.x + 9, rect.y + 9, { size: 12, color: '#ffd54a' });
      this.label(def.name, rect.x + rect.width / 2, rect.y + rect.height / 2 + 6, {
        size: 10,
        width: rect.width - 6,
      });
    });

    const matching = human.hand
      .slice(0, HAND_LIMIT)
      .filter((id) => isCardVisible(getCardDef(id).type, this.handFilter)).length;
    const filterButton = LAYOUT.filterButton;
    g.fillStyle(this.handFilter === 'all' ? 0x3a4256 : 0x4a5f8f, 1).fillRoundedRect(
      filterButton.x,
      filterButton.y,
      filterButton.width,
      filterButton.height,
      8,
    );
    this.label(
      `Filter: ${HAND_FILTER_NAMES[this.handFilter]} (${matching})`,
      filterButton.x + filterButton.width / 2,
      filterButton.y + filterButton.height / 2,
      { size: 10, width: filterButton.width - 8 },
    );

    // Leiste unten
    this.label(`Energie ${human.energy}`, 70, 612, { size: 16, color: '#ffd54a' });
    if (this.message) this.label(this.message, 70, 632, { size: 10, color: '#ff8a80' });
    const button = LAYOUT.button;
    const waiting = state.phase !== 'planning' || state.ready[HUMAN];
    g.fillStyle(waiting ? 0x3a4256 : 0x2e7d32, 1).fillRoundedRect(button.x, button.y, button.width, button.height, 8);
    this.label(waiting ? 'Kampf läuft' : 'Bereit', button.x + button.width / 2, button.y + button.height / 2, {
      size: 14,
    });

    if (state.phase === 'over' && !this.statsClosed) {
      this.renderStats(state);
    } else if (state.phase === 'over') {
      g.fillStyle(0x000000, 0.7).fillRect(0, 220, VIEW.width, 140);
      const text =
        state.outcome === 'draw' ? 'Unentschieden' : state.outcome === 'player0' ? 'Du gewinnst!' : 'Du verlierst';
      this.label(text, VIEW.width / 2, 270, { size: 26 });
      this.label('Tippen für ein neues Spiel', VIEW.width / 2, 320, { size: 13, color: '#9aa4bf' });
    }

    this.pool.hideUnused();
  }

  /** Overlay nach Match-Ende: Ergebnis, Karten pro Line und Schaden je Minion-Typ (liest nur `state.stats`). */
  private renderStats(state: MatchState): void {
    const g = this.graphics;
    const { x, y, width, height } = STATS_PANEL;
    g.fillStyle(0x000000, 0.88).fillRect(0, 0, VIEW.width, VIEW.height);
    g.fillStyle(COLORS.card, 1).fillRoundedRect(x, y, width, height, 8);
    const text =
      state.outcome === 'draw' ? 'Unentschieden' : state.outcome === 'player0' ? 'Du gewinnst!' : 'Du verlierst';
    this.label(text, VIEW.width / 2, y + 22, { size: 20 });

    const left = x + 12;
    const columns = [x + 150, x + 200, x + 250];
    let row = y + 54;
    this.label('Karten pro Line', left, row, { size: 12, color: '#ffd54a', origin: 0 });
    columns.forEach((column, line) => this.label(`L${line + 1}`, column, row, { size: 11, color: '#9aa4bf' }));
    const played = Object.entries(state.stats.played);
    if (played.length === 0) this.label('Keine Beschwörungen', left, (row += 18), { size: 11, color: '#9aa4bf', origin: 0 });
    for (const [cardId, counts] of played) {
      row += 18;
      this.label(getCardDef(cardId).name, left, row, { size: 11, origin: 0 });
      columns.forEach((column, line) => this.label(`${counts[line] ?? 0}`, column, row, { size: 11 }));
    }

    row += 34;
    this.label('Schaden je Typ', left, row, { size: 12, color: '#ffd54a', origin: 0 });
    this.label('Minions', x + 190, row, { size: 11, color: '#9aa4bf' });
    this.label('Tower', x + 260, row, { size: 11, color: '#9aa4bf' });
    const damage = Object.entries(state.stats.damage);
    if (damage.length === 0) this.label('Kein Schaden', left, (row += 18), { size: 11, color: '#9aa4bf', origin: 0 });
    for (const [cardId, entry] of damage) {
      row += 18;
      this.label(getCardDef(cardId).name, left, row, { size: 11, origin: 0 });
      this.label(`${Math.round(entry.minionDamage)}`, x + 190, row, { size: 11 });
      this.label(`${Math.round(entry.towerDamage)}`, x + 260, row, { size: 11 });
    }

    const button = STATS_CLOSE;
    g.fillStyle(0x2e7d32, 1).fillRoundedRect(button.x, button.y, button.width, button.height, 8);
    this.label('Schließen', button.x + button.width / 2, button.y + button.height / 2, { size: 14 });
  }
}
