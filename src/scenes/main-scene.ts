import Phaser from 'phaser';
import { CARD_ART_IDS, cardTypeStyle } from '../logic/card-style';
import { getCardDef } from '../logic/cards';
import { diffFx } from '../logic/fx-events';
import { type CardPose, cardAt, fanLayout, HAND_FAN, liftedPose, sortHand } from '../logic/hand-layout';
import {
  advance,
  createMatch,
  type MatchState,
  MAX_ROUNDS,
  laneSlotCounts,
  moveMinion,
} from '../logic/match';
import { LANE_COUNT, laneShortName } from '../logic/lanes';
import { botPlanRecorded, createRecord, performAction, type RecordedMatch } from '../logic/match-record';
import { HAND_FILTER_NAMES, type HandFilter, isCardVisible, nextHandFilter } from '../logic/hand-filter';
import { updateFlashes } from '../logic/minion-look';
import { parseSeed } from '../logic/seed';
import { type DropTarget, dropTargetAt, slotPosition } from '../logic/placement';
import { CardView } from './card-view';
import { Effects, type Locator } from './effects';
import {
  drawBoard,
  drawMinionBody,
  drawMinions,
  FIELD,
  GEOMETRY,
  HUMAN,
  BOT,
  lineX,
  type MinionAnim,
  minionPoint,
  towerPoint,
} from './field-view';
import { type LabelFn, LabelPool } from './labels';
import { copyToClipboard, shareUrl, shareUrlLines } from './share';
import { addBackdrop } from './textures';
import { drawButton, drawPanel, PALETTE, TEXT } from './theme';

/** Spielfläche im Hochformat; Phaser skaliert sie per `Scale.FIT` auf den Bildschirm. */
export const VIEW = { width: 360, height: 640 };

/** Feld-Geometrie für den Hintergrund (Boden, Wege, Hand-Tisch); auch von der Replay-Szene genutzt. */
export const BACKDROP_FIELD = {
  width: VIEW.width,
  height: VIEW.height,
  laneCenters: FIELD.laneCenters,
  leftX: FIELD.ownTowerX,
  rightX: FIELD.enemyTowerX,
  pathHalfHeight: FIELD.pathHalfHeight,
  handTop: 440,
};

/** Wie Effekte Ereignisse auf Bildschirmpunkte abbilden; auch von der Replay-Szene genutzt. */
export const FX_LOCATOR: Locator = {
  minion: (owner, line, position, id) => minionPoint(owner, { id, line, position }),
  tower: (owner, line, tower) => towerPoint(owner, line, tower),
};

const LAYOUT = {
  handTop: 440,
  button: { x: 230, y: 592, width: 120, height: 40 },
  /** Filtertaste für die Hand: schaltet bei jedem Tipp weiter, links neben `button`, unter den Karten. */
  filterButton: { x: 122, y: 592, width: 102, height: 40 },
};

const STATS_PANEL = { x: 20, y: 60, width: 320, height: 500 };
const STATS_CLOSE = { x: 120, y: 504, width: 120, height: 40 };
/** Ende-Bild mit Teilen-URL (nach dem Schließen der Statistik) und der Knopf zum Kopieren des Links. */
const SHARE_PANEL = { x: 20, y: 150, width: 320, height: 360 };
const SHARE_COPY = { x: 110, y: 424, width: 140, height: 36 };
const SHARE_LINE_HEIGHT = 12;

/** Trefferradius zum Greifen eines Minions; größer als die gezeichnete Fläche, damit Touch trifft. */
const GRAB_RADIUS = 18;
/** Bewegung in Spielpixeln, ab der aus einem Antippen ein Ziehen wird. */
const DRAG_THRESHOLD = 8;
/** Zeitkonstante (ms), mit der eine Karte beim Hover/Auswählen nach oben gleitet bzw. zurückfällt. */
const LIFT_TIME_MS = 70;
/** Bei größeren Zeitsprüngen (Tab im Hintergrund, Zeitraffer) gibt es keine Effekte. */
const FX_MAX_DELTA_MS = 500;

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

/** Karten, die beim aktiven Filter nicht passen, liegen hinter allen anderen. */
const FADED_Z_OFFSET = -20;

function inside(rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * Spielbare Basis-Szene: liest Touch/Maus, ruft die Match-Logik auf und zeichnet das Ergebnis.
 * Spieler 0 (unten) ist der Mensch, Spieler 1 (oben) der lokale Bot.
 */
export class MainScene extends Phaser.Scene {
  private state: MatchState = createMatch(1);
  /** Alle Aktionen beider Spieler seit Matchbeginn; daraus entsteht die Teilen-URL. Reine Mitschrift, ohne Regeln. */
  private record: RecordedMatch = createRecord(1);
  private graphics!: Phaser.GameObjects.Graphics;
  private pool!: LabelPool;
  private effects!: Effects;
  /** Zustand des letzten Bilds; der Vergleich mit dem aktuellen liefert die Effekte. */
  private fxState: MatchState = this.state;
  /** Szenenzeit und Trefferblitze der Minions (aus `delta` fortgeschrieben, nur Darstellung). */
  private minionAnim: MinionAnim = { timeMs: 0, flashes: new Map() };
  /** Index der angetippten Karte, die auf eine Line wartet. */
  private selected: number | null = null;
  /** Karte unter dem Mauszeiger (nur Darstellung). */
  private hovered: number | null = null;
  /** Anhebung je Handkarte (0 bis 1), gleitet über `delta`. */
  private lifts: number[] = [];
  private message = '';
  private drag: DragState | null = null;
  /** Statistik-Overlay nach Match-Ende wurde geschlossen. */
  private statsClosed = false;
  /** Kartenfilter der Hand; reiner Darstellungs- und Eingabezustand, wird nicht gespeichert. */
  private handFilter: HandFilter = 'all';
  /** Ansichten der Handkarten, je Anzeigeplatz von links nach rechts (wiederverwendet). */
  private cardViews: CardView[] = [];

  constructor() {
    super('main');
  }

  preload(): void {
    for (const id of CARD_ART_IDS) this.load.svg(`card-art-${id}`, `assets/cards/${id}.svg`, { width: 268, height: 144 });
  }

  /** Aktueller Spielzustand (nur lesen), z. B. für den Smoke-Test. */
  get current(): MatchState {
    return this.state;
  }

  /** Aufzeichnung des laufenden Matches (nur lesen, z. B. für E2E-Tests). */
  get currentRecord(): RecordedMatch {
    return this.record;
  }

  /** Index der angetippten Handkarte, die auf eine Line wartet (nur lesen, z. B. für E2E-Tests). */
  get selectedCard(): number | null {
    return this.selected;
  }

  create(): void {
    this.state = createMatch(parseSeed(window.location.search) ?? Date.now() >>> 0);
    this.record = createRecord(this.state.seed);
    this.fxState = this.state;
    this.minionAnim = { timeMs: 0, flashes: new Map() };
    addBackdrop(this, VIEW.width, VIEW.height, BACKDROP_FIELD);
    this.pool = new LabelPool(this);
    this.effects = new Effects(this, FX_LOCATOR);
    this.selected = null;
    this.hovered = null;
    this.lifts = [];
    this.message = '';
    this.drag = null;
    this.statsClosed = false;
    this.handFilter = 'all';
    this.cardViews = [];
    this.graphics = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer.worldX, pointer.worldY));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer.worldX, pointer.worldY));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer.worldX, pointer.worldY));
    this.input.on('pointerupoutside', () => {
      this.drag = null;
    });
    this.input.on('gameout', () => {
      this.hovered = null;
    });
    this.render();
  }

  update(_time: number, deltaMs: number): void {
    if (this.state.phase === 'planning' && !this.state.ready[BOT]) {
      const planned = botPlanRecorded(this.state, this.record, BOT);
      this.state = planned.state;
      this.record = planned.record;
    }
    this.state = advance(this.state, deltaMs);
    if (this.state.phase !== 'planning') {
      this.selected = null;
      this.hovered = null;
    }
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN]) this.drag = null;
    this.updateLifts(deltaMs);
    this.updateEffects(deltaMs);
    this.render();
  }

  /** Gleitet jede Handkarte zur Ziel-Anhebung (Hover oder Auswahl). */
  private updateLifts(deltaMs: number): void {
    const factor = 1 - Math.exp(-deltaMs / LIFT_TIME_MS);
    const count = this.state.players[HUMAN].hand.length;
    for (let index = 0; index < count; index += 1) {
      const target = this.selected === index || this.hovered === index ? 1 : 0;
      const current = this.lifts[index] ?? 0;
      this.lifts[index] = current + (target - current) * factor;
    }
    this.lifts.length = count;
  }

  /** Vergleicht mit dem letzten Bild: Treffer, Tod, Beschwörung und Turmschaden lösen Effekte aus. */
  private updateEffects(deltaMs: number): void {
    const previous = this.fxState;
    this.fxState = this.state;
    const events = deltaMs <= FX_MAX_DELTA_MS ? diffFx(previous, this.state) : [];
    this.effects.play(events);
    this.effects.update(deltaMs);
    this.minionAnim = {
      timeMs: this.minionAnim.timeMs + deltaMs,
      flashes: updateFlashes(this.minionAnim.flashes, events, deltaMs),
    };
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

  /**
   * Anzeigereihenfolge (`order[platz]` = Hand-Index) und Lage jeder Karte je Anzeigeplatz. Mit `target` gilt die
   * Endlage der Anhebung (Hover/Auswahl), sonst der aktuelle, gleitende Wert; Treffer prüfen die Endlage.
   */
  private handLayout(target: boolean): { order: number[]; poses: CardPose[] } {
    const hand = this.state.players[HUMAN].hand;
    const order = sortHand(hand.map((id) => getCardDef(id).type));
    const rest = fanLayout(order.length);
    const poses = order.map((handIndex, slot) => {
      const lift = target ? (this.selected === handIndex || this.hovered === handIndex ? 1 : 0) : (this.lifts[handIndex] ?? 0);
      return liftedPose(rest[slot]!, lift, order.length);
    });
    return { order, poses };
  }

  /** Hand-Index der obersten sichtbaren, antippbaren Handkarte unter dem Punkt (nur in der Planung), sonst `null`. */
  private cardIndexAt(x: number, y: number): number | null {
    if (this.state.phase !== 'planning') return null;
    const { order, poses } = this.handLayout(true);
    const slot = cardAt(poses, x, y, (s) => this.isVisibleInHand(order[s]!));
    return slot === null ? null : order[slot]!;
  }

  /** Wartet die gewählte Karte auf einen eigenen Minion als Ziel? */
  private selectedNeedsMinion(): boolean {
    const id = this.selected === null ? undefined : this.state.players[HUMAN].hand[this.selected];
    return id !== undefined && getCardDef(id).target === 'minion';
  }

  /** Id des eigenen lebenden Minions unter dem Punkt (der nächste im Greifradius), sonst `null`. */
  private ownMinionAt(x: number, y: number): number | null {
    let best: number | null = null;
    let bestDistance = GRAB_RADIUS;
    for (const minion of this.state.players[HUMAN].minions) {
      if (minion.hp <= 0) continue;
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
    // Ist eine Karte mit Ziel-Minion gewählt, trifft das Antippen eines eigenen Minions (kein Ziehen).
    if (this.state.phase === 'planning' && this.selectedNeedsMinion()) {
      const targetId = this.ownMinionAt(x, y);
      if (targetId !== null) {
        this.drag = null;
        this.play(this.selected!, undefined, targetId);
        return;
      }
    }
    const minionId = this.grabbableMinionAt(x, y);
    if (minionId === null) {
      this.drag = null;
      this.handleTap(x, y);
      return;
    }
    this.drag = { minionId, startX: x, startY: y, x, y, dragging: false, target: null, valid: false };
  }

  private onPointerMove(x: number, y: number): void {
    this.hovered = this.cardIndexAt(x, y);
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
    const done = performAction(this.state, this.record, HUMAN, {
      type: 'move',
      minionId: drag.minionId,
      line: target.line,
      slot: target.slot ?? -1,
    });
    this.state = done.result.state;
    this.record = done.record;
    this.message = done.result.ok ? '' : this.explain(done.result.reason);
  }

  private targetAt(x: number, y: number): DropTarget | null {
    return dropTargetAt(x, y, GEOMETRY, laneSlotCounts(this.state.players[HUMAN].level));
  }

  private handleTap(x: number, y: number): void {
    if (this.state.phase === 'over') {
      if (!this.statsClosed) {
        if (inside(STATS_CLOSE, x, y)) this.statsClosed = true;
        return;
      }
      if (inside(SHARE_COPY, x, y)) {
        copyToClipboard(shareUrl(this.record));
        return;
      }
      this.scene.restart();
      return;
    }
    if (this.state.phase !== 'planning') return;
    if (inside(LAYOUT.button, x, y)) {
      this.selected = null;
      this.message = '';
      const done = performAction(this.state, this.record, HUMAN, { type: 'ready' });
      this.state = done.result.state;
      this.record = done.record;
      return;
    }
    if (inside(LAYOUT.filterButton, x, y)) {
      this.handFilter = nextHandFilter(this.handFilter);
      const selected = this.selected;
      if (selected !== null && !this.isVisibleInHand(selected)) this.selected = null;
      return;
    }
    const index = this.cardIndexAt(x, y);
    if (index !== null) {
      this.message = '';
      const def = getCardDef(this.state.players[HUMAN].hand[index]!);
      if (def.target === 'none') {
        this.play(index);
      } else {
        this.selected = this.selected === index ? null : index;
      }
      return;
    }
    if (this.selected === null || this.selectedNeedsMinion()) return;
    const target = this.targetAt(x, y);
    if (target && y <= LAYOUT.handTop - 4) this.play(this.selected, target.line);
  }

  /** Ist die Handkarte mit diesem Hand-Index beim aktiven Filter sichtbar und antippbar? */
  private isVisibleInHand(handIndex: number): boolean {
    const id = this.state.players[HUMAN].hand[handIndex];
    return id !== undefined && isCardVisible(getCardDef(id).type, this.handFilter);
  }

  private play(handIndex: number, line?: number, minionId?: number): void {
    const cardId = this.state.players[HUMAN].hand[handIndex];
    if (cardId === undefined) return;
    // Lage vor dem Spielen merken: danach ist die Karte aus der Hand und die Hand ordnet sich neu.
    const { order, poses } = this.handLayout(false);
    const pose = poses[order.indexOf(handIndex)];
    const done = performAction(this.state, this.record, HUMAN, {
      type: 'play',
      cardId,
      line: line ?? null,
      ...(minionId === undefined ? {} : { minionId }),
    });
    const result = done.result;
    this.state = result.state;
    this.record = done.record;
    this.selected = null;
    this.message = result.ok ? '' : this.explain(result.reason);
    if (result.ok) {
      const def = getCardDef(cardId);
      if (pose) {
        const { cardWidth: width, cardHeight: height } = HAND_FAN;
        this.effects.cardPlayed({ x: pose.x - width / 2, y: pose.y - height / 2, width, height }, def.name, cardTypeStyle(def.type).accent);
      }
      this.lifts.splice(handIndex, 1);
    }
  }

  private explain(reason: string): string {
    switch (reason) {
      case 'not-enough-energy':
        return 'Nicht genug Energie';
      case 'line-full':
        return 'Lane ist voll';
      case 'max-level':
        return 'Feld ist auf Höchststufe';
      case 'slot-taken':
        return 'Platz ist belegt';
      case 'invalid-target':
        return 'Wähle einen eigenen Minion';
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

    const needsMinion = this.selectedNeedsMinion();
    drawBoard(g, this.label, state, this.selected !== null && !needsMinion);

    const phaseText =
      state.phase === 'planning' ? 'Planung' : state.phase === 'combat' ? 'Kampf' : 'Ende';
    drawPanel(g, 80, 3, 200, 26, { metal: 'gold', radius: 10 });
    this.label(`Runde ${state.round}/${MAX_ROUNDS} · ${phaseText}`, VIEW.width / 2, 16, {
      size: 14,
      font: 'heading',
      bold: true,
    });
    this.label(`Gegner: ${bot.hand.length} Karten`, VIEW.width / 2, 40, { size: 11, color: TEXT.dim });

    const drag = this.drag?.dragging ? this.drag : null;
    if (drag?.target) {
      const color = drag.valid ? PALETTE.good : PALETTE.bad;
      const center = FIELD.laneCenters[drag.target.line]!;
      const left = FIELD.ownTowerX - 14;
      g.lineStyle(2, color, 0.8).strokeRoundedRect(
        left,
        center - FIELD.laneHalfHeight,
        FIELD.enemyTowerX - FIELD.ownTowerX + 28,
        FIELD.laneHalfHeight * 2,
        8,
      );
      if (drag.target.slot !== null) {
        const slotX = lineX(HUMAN, slotPosition(drag.target.slot));
        g.fillStyle(color, 0.5).fillCircle(slotX, center, GRAB_RADIUS * 0.6);
      }
    }

    drawMinions(g, state, drag?.minionId, this.minionAnim);
    if (drag) drawMinionBody(g, drag.x, drag.y, HUMAN, undefined, 0.85);
    if (needsMinion) {
      // Mögliche Ziele der gewählten Karte: alle eigenen lebenden Minions mit grünem Ring.
      for (const minion of human.minions) {
        if (minion.hp <= 0) continue;
        const point = minionPoint(HUMAN, minion);
        g.lineStyle(2, PALETTE.good, 0.9).strokeCircle(point.x, point.y, GRAB_RADIUS * 0.7);
      }
    }

    // Handkarten als Fächer in Typ-Reihenfolge; Stapelhöhe und Anhebung stehen in der Pose.
    const cards = human.hand.map((id, index) => ({ def: getCardDef(id), index }));
    const { order, poses } = this.handLayout(false);
    const shown = state.phase === 'over' ? 0 : order.length;
    order.slice(0, shown).forEach((handIndex, slot) => {
      const { def } = cards[handIndex]!;
      const visible = isCardVisible(def.type, this.handFilter);
      const pose = poses[slot]!;
      while (this.cardViews.length <= slot) this.cardViews.push(new CardView(this));
      this.cardViews[slot]!.update(visible ? pose : { ...pose, z: pose.z + FADED_Z_OFFSET }, def, {
        lift: this.lifts[handIndex] ?? 0,
        selected: this.selected === handIndex,
        affordable: human.energy >= def.cost,
        visible,
      });
    });
    // Nach Match-Ende (Overlay auf der Grafik) und für nicht mehr belegte Plätze bleiben die Karten verborgen.
    this.cardViews.forEach((view, slot) => {
      if (slot >= shown) view.hide();
    });

    const matching = cards.filter(({ def }) => isCardVisible(def.type, this.handFilter)).length;
    const filterButton = LAYOUT.filterButton;
    drawButton(
      g,
      filterButton,
      this.handFilter === 'all' ? { top: 0x4a4570, bottom: 0x2a2548 } : { top: 0x5a82d0, bottom: 0x28427f },
    );
    this.label(
      `Filter: ${HAND_FILTER_NAMES[this.handFilter]} (${matching})`,
      filterButton.x + filterButton.width / 2,
      filterButton.y + filterButton.height / 2,
      { size: 10, width: filterButton.width - 8 },
    );

    // Leiste unten: Energie im Bronzerahmen mit Kristall, Bereit-Knopf.
    drawPanel(g, 6, 597, 108, 27, { metal: 'bronze', radius: 8 });
    const crystal = [
      new Phaser.Geom.Point(22, 603),
      new Phaser.Geom.Point(28, 611),
      new Phaser.Geom.Point(22, 619),
      new Phaser.Geom.Point(16, 611),
    ];
    g.fillStyle(PALETTE.energy, 0.3).fillCircle(22, 611, 11);
    g.fillStyle(PALETTE.goldDark, 1).fillPoints(crystal, true);
    g.fillStyle(PALETTE.energy, 1).fillPoints(crystal.map((p) => new Phaser.Geom.Point(22 + (p.x - 22) * 0.75, 611 + (p.y - 611) * 0.75)), true);
    g.fillStyle(PALETTE.white, 0.45).fillPoints([crystal[0]!, new Phaser.Geom.Point(26, 610), new Phaser.Geom.Point(22, 611)], true);
    this.label(`Energie ${human.energy}`, 72, 612, { size: 16, color: TEXT.gold, font: 'heading', bold: true });
    if (this.message) this.label(this.message, 70, 632, { size: 10, color: TEXT.bad });
    const button = LAYOUT.button;
    const waiting = state.phase !== 'planning' || state.ready[HUMAN];
    drawButton(g, button, { enabled: !waiting });
    this.label(waiting ? 'Kampf läuft' : 'Bereit', button.x + button.width / 2, button.y + button.height / 2, {
      size: 14,
      font: 'heading',
      bold: true,
    });

    if (state.phase === 'over' && !this.statsClosed) {
      this.renderStats(state);
    } else if (state.phase === 'over') {
      g.fillStyle(PALETTE.black, 0.55).fillRect(0, 0, VIEW.width, VIEW.height);
      const panel = SHARE_PANEL;
      drawPanel(g, panel.x, panel.y, panel.width, panel.height, { metal: 'gold' });
      const text =
        state.outcome === 'draw' ? 'Unentschieden' : state.outcome === 'player0' ? 'Du gewinnst!' : 'Du verlierst';
      this.label(text, VIEW.width / 2, panel.y + 36, { size: 26, font: 'heading', bold: true, color: TEXT.gold, stroke: 3 });
      this.label('Replay zum Teilen:', VIEW.width / 2, panel.y + 78, { size: 12, color: TEXT.dim });
      const lines = shareUrlLines(shareUrl(this.record));
      this.label(lines.join('\n'), VIEW.width / 2, panel.y + 96 + (lines.length * SHARE_LINE_HEIGHT) / 2, {
        size: 9,
        stroke: 1,
      });
      drawButton(g, SHARE_COPY);
      this.label('Link kopieren', SHARE_COPY.x + SHARE_COPY.width / 2, SHARE_COPY.y + SHARE_COPY.height / 2, {
        size: 13,
        font: 'heading',
        bold: true,
      });
      this.label('Tippen für ein neues Spiel', VIEW.width / 2, panel.y + panel.height - 28, { size: 13, color: TEXT.dim });
    }

    this.pool.hideUnused();
  }

  /** Overlay nach Match-Ende: Ergebnis, Karten pro Line und Schaden je Minion-Typ (liest nur `state.stats`). */
  private renderStats(state: MatchState): void {
    const g = this.graphics;
    const { x, y, width, height } = STATS_PANEL;
    g.fillStyle(PALETTE.black, 0.85).fillRect(0, 0, VIEW.width, VIEW.height);
    drawPanel(g, x, y, width, height, { metal: 'gold' });
    const text =
      state.outcome === 'draw' ? 'Unentschieden' : state.outcome === 'player0' ? 'Du gewinnst!' : 'Du verlierst';
    this.label(text, VIEW.width / 2, y + 22, { size: 20, font: 'heading', bold: true, color: TEXT.gold, stroke: 3 });
    g.fillStyle(PALETTE.gold, 0.6).fillRect(x + 12, y + 38, width - 24, 1);

    const left = x + 12;
    const columns = Array.from({ length: LANE_COUNT }, (_, lane) => x + 120 + lane * 42);
    let row = y + 54;
    this.label('Karten pro Lane', left, row, { size: 12, color: TEXT.gold, origin: 0, font: 'heading', bold: true });
    columns.forEach((column, lane) => this.label(laneShortName(lane), column, row, { size: 9, color: TEXT.dim }));
    const played = Object.entries(state.stats.played);
    if (played.length === 0) this.label('Keine Beschwörungen', left, (row += 18), { size: 11, color: TEXT.dim, origin: 0 });
    for (const [cardId, counts] of played) {
      row += 18;
      this.label(getCardDef(cardId).name, left, row, { size: 11, origin: 0 });
      columns.forEach((column, line) => this.label(`${counts[line] ?? 0}`, column, row, { size: 11 }));
    }

    row += 34;
    this.label('Schaden je Typ', left, row, { size: 12, color: TEXT.gold, origin: 0, font: 'heading', bold: true });
    this.label('Minions', x + 190, row, { size: 11, color: TEXT.dim });
    this.label('Tower', x + 260, row, { size: 11, color: TEXT.dim });
    const damage = Object.entries(state.stats.damage);
    if (damage.length === 0) this.label('Kein Schaden', left, (row += 18), { size: 11, color: TEXT.dim, origin: 0 });
    for (const [cardId, entry] of damage) {
      row += 18;
      this.label(getCardDef(cardId).name, left, row, { size: 11, origin: 0 });
      this.label(`${Math.round(entry.minionDamage)}`, x + 190, row, { size: 11 });
      this.label(`${Math.round(entry.towerDamage)}`, x + 260, row, { size: 11 });
    }

    const button = STATS_CLOSE;
    drawButton(g, button);
    this.label('Schließen', button.x + button.width / 2, button.y + button.height / 2, {
      size: 14,
      font: 'heading',
      bold: true,
    });
  }
}
