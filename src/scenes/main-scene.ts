import Phaser from 'phaser';
import { CARD_ART_IDS, cardTypeStyle } from '../logic/card-style';
import { getCardDef } from '../logic/cards';
import { diffFx } from '../logic/fx-events';
import { type CardPose, cardAt, fanLayout, HAND_FAN, liftedPose, sortHand } from '../logic/hand-layout';
import { advance, createMatch, DISCARD_ENERGY, type MatchState, MAX_ROUNDS, MOVE_COST } from '../logic/match';
import { getRoundEventDef } from '../logic/round-events';
import { isLaneUnlocked, LANE_COUNT, laneShortName } from '../logic/lanes';
import { botPlanRecorded, createRecord, performAction, type RecordedMatch } from '../logic/match-record';
import { HAND_FILTER_NAMES, type HandFilter, isCardVisible, nextHandFilter } from '../logic/hand-filter';
import { updateFlashes } from '../logic/minion-look';
import { parseSeed } from '../logic/seed';
import {
  freeLaneSlotPoints,
  freeSlotPoints,
  nearestPoint,
  type Point,
  SNAP_RADIUS,
  slotProximity,
  snapTarget,
} from '../logic/placement';
import { CardView } from './card-view';
import { Effects, type Locator } from './effects';
import {
  BOT,
  drawBoard,
  drawMinionBody,
  drawMinions,
  drawSlotDots,
  FIELD,
  GEOMETRY,
  HUMAN,
  type MinionAnim,
  minionPoint,
  playerMinionPoint,
  type SlotDot,
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

/** Taste „Abwerfen“ oben links: sichtbar, solange eine Karte gewählt ist oder gezogen wird; Karte darauf ablegen wirft sie ab. */
const DISCARD_BUTTON = { x: 6, y: 32, width: 96, height: 24 };
/** Zeitkonstanten (ms) der weichen Animationen: Punkte-Nähe, Einblenden, Einrasten der gezogenen Karte, Rückflug. */
const PROXIMITY_TIME_MS = 70;
const FADE_TIME_MS = 110;
const SNAP_TIME_MS = 45;
const RETURN_TIME_MS = 60;

/** Ziel eines Zugs auf dem Feld: ein Turm-Slot (mit `slot`) oder der Lane-Slot einer Lane (ohne `slot`). */
interface Target extends Point {
  line: number;
  slot?: number;
}

/** Zeigerzustand: gedrückt auf einem Minion oder einer Handkarte (noch ein Tippen) oder schon am Ziehen. */
interface DragState {
  /** Gezogener eigener Minion (verschieben) oder `null`. */
  minionId: number | null;
  /** Hand-Index der gezogenen Beschwörungs- oder Lane-Karte oder `null`. */
  handIndex: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
}

/** Die Figur, die eine gezogene Karte darstellt: folgt dem Zeiger, rastet an Punkten ein und fliegt zurück in die Hand. */
interface CardGhost {
  cardId: string;
  x: number;
  y: number;
  alpha: number;
  /** Rückflugziel (Lage der Karte in der Hand); `null`, solange sie gezogen wird. */
  returnTo: Point | null;
}

/** Karten, die beim aktiven Filter nicht passen, liegen hinter allen anderen. */
const FADED_Z_OFFSET = -20;

/** Schlüssel eines Ziels für die geglättete Nähe: Lane und Slot (der Lane-Slot hat keinen). */
function targetKey(target: Target): string {
  return `${target.line}:${target.slot ?? 'L'}`;
}

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
  /** Zeiger zuletzt (für die Nähe der Punkte bei gewählter Karte ohne Ziehen). */
  private pointer: Point | null = null;
  /** Nähe des Zeigers je Ziel (0 bis 1, Schlüssel `Linie:Slot`), gleitet über `delta`. */
  private proximities = new Map<string, number>();
  /** Sichtbarkeit der grünen Punkte (0 bis 1), gleitet über `delta`. */
  private dotFade = 0;
  private ghost: CardGhost | null = null;
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

  /** Die grünen Punkte, die gerade angezeigt werden, samt Nähe des Zeigers (nur lesen, z. B. für E2E-Tests). */
  get slotDots(): { line: number; slot: number | null; x: number; y: number; proximity: number }[] {
    if (this.dotFade <= 0.01) return [];
    return this.activeTargets().map((target) => ({
      line: target.line,
      slot: target.slot ?? null,
      x: target.x,
      y: target.y,
      proximity: this.proximities.get(targetKey(target)) ?? 0,
    }));
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
    this.pointer = null;
    this.proximities = new Map();
    this.dotFade = 0;
    this.ghost = null;
    this.statsClosed = false;
    this.handFilter = 'all';
    this.cardViews = [];
    this.graphics = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer.worldX, pointer.worldY));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer.worldX, pointer.worldY));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer.worldX, pointer.worldY));
    this.input.on('pointerupoutside', () => this.cancelDrag());
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
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN]) this.cancelDrag();
    this.updateLifts(deltaMs);
    this.updateDrag(deltaMs);
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
    for (const minion of player.minions) {
      if (minion.hp <= 0 || minion.slot === undefined) continue;
      const point = playerMinionPoint(HUMAN, player, minion);
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
    const player = this.state.players[HUMAN];
    for (const minion of player.minions) {
      if (minion.hp <= 0) continue;
      const point = playerMinionPoint(HUMAN, player, minion);
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
    if (minionId !== null) {
      this.drag = { minionId, handIndex: null, startX: x, startY: y, x, y, dragging: false };
      return;
    }
    const handIndex = this.cardIndexAt(x, y);
    if (handIndex !== null && this.isDraggable(handIndex)) {
      this.drag = { minionId: null, handIndex, startX: x, startY: y, x, y, dragging: false };
      return;
    }
    this.drag = null;
    this.handleTap(x, y);
  }

  /** Lässt sich die Handkarte ziehen? Beschwörungs- und Lane-Karten, die der Spieler bezahlen kann und der Filter zeigt. */
  private isDraggable(handIndex: number): boolean {
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN] || !this.isVisibleInHand(handIndex)) return false;
    const def = getCardDef(this.state.players[HUMAN].hand[handIndex]!);
    return (def.type === 'summon' || def.type === 'lane-card') && this.state.players[HUMAN].energy >= def.cost;
  }

  /** Bricht ein laufendes Ziehen ab; eine gezogene Karte fliegt zurück in die Hand, ohne Energie zu kosten. */
  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.dragging && drag.handIndex !== null) this.returnGhost(drag.handIndex);
  }

  private onPointerMove(x: number, y: number): void {
    this.pointer = { x, y };
    this.hovered = this.drag?.dragging ? null : this.cardIndexAt(x, y);
    const drag = this.drag;
    if (!drag) return;
    drag.x = x;
    drag.y = y;
    if (!drag.dragging && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.dragging && drag.handIndex !== null) {
      const cardId = this.state.players[HUMAN].hand[drag.handIndex];
      if (cardId !== undefined) this.ghost = { cardId, x: drag.startX, y: drag.startY, alpha: 0, returnTo: null };
      this.selected = null;
    }
    drag.dragging = true;
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
    if (drag.handIndex !== null) {
      this.dropCard(drag.handIndex, x, y);
      return;
    }
    const target = snapTarget(this.targetsFor(drag), x, y);
    if (!target) {
      this.message = '';
      return;
    }
    const done = performAction(this.state, this.record, HUMAN, {
      type: 'move',
      minionId: drag.minionId!,
      line: target.line,
      slot: target.slot!,
    });
    this.state = done.result.state;
    this.record = done.record;
    this.message = done.result.ok ? '' : this.explain(done.result.reason);
  }

  /** Karte loslassen: auf der Abwerfen-Taste abwerfen, an einem Ziel in Reichweite einrasten, sonst zurück in die Hand. */
  private dropCard(handIndex: number, x: number, y: number): void {
    if (inside(DISCARD_BUTTON, x, y)) {
      this.ghost = null;
      this.discard(handIndex);
      return;
    }
    const target = snapTarget(this.targetsFor({ minionId: null, handIndex }), x, y);
    if (!target) {
      this.message = '';
      this.returnGhost(handIndex);
      return;
    }
    if (this.play(handIndex, target.line, undefined, target.slot)) this.ghost = null;
    else this.returnGhost(handIndex);
  }

  /** Lässt die Kartenfigur zur Handkarte zurückfliegen. */
  private returnGhost(handIndex: number): void {
    if (!this.ghost) return;
    const { order, poses } = this.handLayout(false);
    const pose = poses[order.indexOf(handIndex)];
    this.ghost.returnTo = pose ? { x: pose.x, y: pose.y } : { x: this.ghost.x, y: LAYOUT.handTop + 40 };
  }

  /** Alle Ziele (Turm-Slots oder Lane-Slots), die zu dem gezogenen Minion bzw. der Karte passen. */
  private targetsFor(source: { minionId: number | null; handIndex: number | null }): Target[] {
    const human = this.state.players[HUMAN];
    if (source.handIndex !== null) {
      const id = human.hand[source.handIndex];
      if (id === undefined) return [];
      return this.targetsOfCard(id);
    }
    return freeSlotPoints(human.lines, human.minions, GEOMETRY);
  }

  /** Ziele einer Karte: Turm-Slots für Beschwörungen, Lane-Slots für Lane-Karten, sonst keine. */
  private targetsOfCard(cardId: string): Target[] {
    const human = this.state.players[HUMAN];
    const type = getCardDef(cardId).type;
    if (type === 'summon') return freeSlotPoints(human.lines, human.minions, GEOMETRY);
    if (type === 'lane-card') return freeLaneSlotPoints(human.lines, GEOMETRY);
    return [];
  }

  /** Lane unter dem Punkt, wenn sie der Spieler freigeschaltet hat (Antippen der Lane), sonst `null`. */
  private laneAt(x: number, y: number): number | null {
    if (x < FIELD.ownTowerX - 30 || x > FIELD.enemyTowerX + 30) return null;
    const lane = FIELD.laneCenters.findIndex(
      (center, line) => isLaneUnlocked(this.state.players[HUMAN].level, line) && Math.abs(y - center) <= FIELD.laneHalfHeight,
    );
    return lane < 0 ? null : lane;
  }

  /** Die Ziele, die gerade angezeigt werden: beim Ziehen die der gezogenen Quelle, sonst die der gewählten Karte. */
  private activeTargets(): Target[] {
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN]) return [];
    if (this.drag?.dragging) return this.targetsFor(this.drag);
    const id = this.selected === null ? undefined : this.state.players[HUMAN].hand[this.selected];
    return id === undefined ? [] : this.targetsOfCard(id);
  }

  /** Gleitet Sichtbarkeit und Nähe der Punkte sowie die Kartenfigur (Einrasten, Rückflug) über `delta`. */
  private updateDrag(deltaMs: number): void {
    const targets = this.activeTargets();
    const fadeFactor = 1 - Math.exp(-deltaMs / FADE_TIME_MS);
    this.dotFade += ((targets.length > 0 ? 1 : 0) - this.dotFade) * fadeFactor;
    const dragging = this.drag?.dragging ? this.drag : null;
    const pointer = dragging ? { x: dragging.x, y: dragging.y } : this.pointer;
    const near = pointer ? nearestPoint(targets, pointer.x, pointer.y) : null;
    const proxFactor = 1 - Math.exp(-deltaMs / PROXIMITY_TIME_MS);
    const next = new Map<string, number>();
    for (const target of targets) {
      const key = targetKey(target);
      const distance = pointer ? Math.hypot(target.x - pointer.x, target.y - pointer.y) : Infinity;
      // Der nächste Punkt in Reichweite ist voll hervorgehoben: dort rastet die Karte beim Loslassen ein.
      const wanted = near?.point === target && near.distance <= SNAP_RADIUS ? 1 : slotProximity(distance) * 0.8;
      const current = this.proximities.get(key) ?? 0;
      next.set(key, current + (wanted - current) * proxFactor);
    }
    this.proximities = next;

    const ghost = this.ghost;
    if (!ghost) return;
    if (ghost.returnTo) {
      const back = 1 - Math.exp(-deltaMs / RETURN_TIME_MS);
      ghost.x += (ghost.returnTo.x - ghost.x) * back;
      ghost.y += (ghost.returnTo.y - ghost.y) * back;
      ghost.alpha -= deltaMs / 220;
      if (ghost.alpha <= 0.02) this.ghost = null;
      return;
    }
    if (!dragging) return;
    const snap = near && near.distance <= SNAP_RADIUS ? near.point : null;
    const goal = snap ?? dragging;
    const follow = 1 - Math.exp(-deltaMs / SNAP_TIME_MS);
    ghost.x += (goal.x - ghost.x) * follow;
    ghost.y += (goal.y - ghost.y) * follow;
    ghost.alpha = Math.min(1, ghost.alpha + deltaMs / 90);
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
    if (this.selected !== null && inside(DISCARD_BUTTON, x, y)) {
      this.discard(this.selected);
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
    if (this.selected === null || this.selectedNeedsMinion() || y > LAYOUT.handTop - 4) return;
    // Ein Antippen nahe einem grünen Punkt wählt diesen Slot, sonst die angetippte Lane (erster freier Slot bzw. Lane-Slot).
    const snap = snapTarget(this.activeTargets(), x, y);
    if (snap) {
      this.play(this.selected, snap.line, undefined, snap.slot);
      return;
    }
    const line = this.laneAt(x, y);
    if (line !== null) this.play(this.selected, line);
  }

  /** Ist die Handkarte mit diesem Hand-Index beim aktiven Filter sichtbar und antippbar? */
  private isVisibleInHand(handIndex: number): boolean {
    const id = this.state.players[HUMAN].hand[handIndex];
    return id !== undefined && isCardVisible(getCardDef(id).type, this.handFilter);
  }

  /** Wirft die Handkarte ab (bringt `DISCARD_ENERGY` Energie, siehe `discardCard`). */
  private discard(handIndex: number): void {
    const cardId = this.state.players[HUMAN].hand[handIndex];
    if (cardId === undefined) return;
    const done = performAction(this.state, this.record, HUMAN, { type: 'discard', cardId });
    this.state = done.result.state;
    this.record = done.record;
    this.selected = null;
    this.message = done.result.ok ? '' : this.explain(done.result.reason);
    if (done.result.ok) this.lifts.splice(handIndex, 1);
  }

  /** Spielt die Handkarte; `true`, wenn sie gespielt wurde. */
  private play(handIndex: number, line?: number, minionId?: number, slot?: number): boolean {
    const cardId = this.state.players[HUMAN].hand[handIndex];
    if (cardId === undefined) return false;
    // Lage vor dem Spielen merken: danach ist die Karte aus der Hand und die Hand ordnet sich neu.
    const { order, poses } = this.handLayout(false);
    const pose = poses[order.indexOf(handIndex)];
    const done = performAction(this.state, this.record, HUMAN, {
      type: 'play',
      cardId,
      line: line ?? null,
      ...(minionId === undefined ? {} : { minionId }),
      ...(slot === undefined ? {} : { slot }),
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
    return result.ok;
  }

  private explain(reason: string): string {
    switch (reason) {
      case 'not-enough-energy':
        return 'Nicht genug Energie';
      case 'line-full':
        return 'Kein Turm-Slot frei';
      case 'lane-slot-taken':
        return 'Lane hat schon eine Lane-Karte';
      case 'max-level':
        return 'Feld ist auf Höchststufe';
      case 'level-too-low':
        return 'Lane-Level zu niedrig';
      case 'already-specialized':
        return 'Tower schon spezialisiert';
      case 'slot-taken':
        return 'Turm-Slot ist belegt';
      case 'invalid-target':
        return 'Wähle einen eigenen Minion';
      case 'invalid-slot':
      case 'invalid-line':
        return 'Hier ist kein Platz';
      default:
        return '';
    }
  }

  /** Die gezogene Karte als kleine Figur: Beschwörung als Einheit, Lane-Karte als Kartenplakette in ihrer Farbe. */
  private drawGhost(ghost: CardGhost): void {
    const g = this.graphics;
    const def = getCardDef(ghost.cardId);
    if (def.type === 'summon') {
      drawMinionBody(g, ghost.x, ghost.y, HUMAN, undefined, 0.9 * ghost.alpha);
    } else {
      const accent = cardTypeStyle(def.type).accent;
      g.fillStyle(accent, 0.9 * ghost.alpha).fillRoundedRect(ghost.x - 11, ghost.y - 11, 22, 22, 5);
      g.lineStyle(2, PALETTE.white, 0.85 * ghost.alpha).strokeRoundedRect(ghost.x - 11, ghost.y - 11, 22, 22, 5);
    }
    if (ghost.alpha > 0.5) this.label(def.name, ghost.x, ghost.y - 22, { size: 9, stroke: 2 });
  }

  /** „Abwerfen“-Taste: erscheint bei gewählter oder gezogener Karte; hell, wenn die gezogene Karte darüber schwebt. */
  private drawDiscardButton(state: MatchState, draggingCard: boolean): void {
    if (state.phase !== 'planning' || state.ready[HUMAN] || (this.selected === null && !draggingCard)) return;
    const hover = draggingCard && this.drag !== null && inside(DISCARD_BUTTON, this.drag.x, this.drag.y);
    drawButton(
      this.graphics,
      DISCARD_BUTTON,
      hover ? { top: 0xd9a441, bottom: 0x8a5a14 } : { top: 0x6a4a8a, bottom: 0x35234f },
    );
    this.label(
      `Abwerfen +${DISCARD_ENERGY}`,
      DISCARD_BUTTON.x + DISCARD_BUTTON.width / 2,
      DISCARD_BUTTON.y + DISCARD_BUTTON.height / 2,
      { size: 11, font: 'heading', bold: true },
    );
  }

  private label: LabelFn =(text, x, y, options) => this.pool.label(text, x, y, options);

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
    if (state.event && state.phase !== 'over') {
      const event = getRoundEventDef(state.event);
      this.label(`${event.name}: ${event.description}`, VIEW.width / 2, 54, { size: 11, color: TEXT.gold });
    }

    const drag = this.drag?.dragging ? this.drag : null;
    drawMinions(g, state, drag?.minionId ?? undefined, this.minionAnim);
    if (this.dotFade > 0.01) {
      const dots: SlotDot[] = this.activeTargets().map((target) => ({
        x: target.x,
        y: target.y,
        proximity: this.proximities.get(targetKey(target)) ?? 0,
      }));
      drawSlotDots(g, dots, this.minionAnim.timeMs, this.dotFade);
    }
    if (drag?.minionId != null) {
      drawMinionBody(g, drag.x, drag.y, HUMAN, undefined, 0.85);
      this.label(`-${MOVE_COST} Energie`, drag.x, drag.y - 20, { size: 9, color: TEXT.gold, stroke: 2 });
    }
    if (this.ghost) this.drawGhost(this.ghost);
    this.drawDiscardButton(state, drag?.handIndex != null);
    if (needsMinion) {
      // Mögliche Ziele der gewählten Karte: alle eigenen lebenden Minions mit grünem Ring.
      for (const minion of human.minions) {
        if (minion.hp <= 0) continue;
        const point = playerMinionPoint(HUMAN, human, minion);
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
