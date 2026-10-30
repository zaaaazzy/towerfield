import Phaser from 'phaser';
import { CARD_ART_IDS, cardTypeStyle } from '../logic/card-style';
import { getCardDef } from '../logic/cards';
import { ENERGY_BAR, ENERGY_LABEL, ENERGY_MESSAGE, energyCrystalLayout } from '../logic/energy-layout';
import { diffFx } from '../logic/fx-events';
import { type CardPose, cardAt, fanLayout, HAND_FAN, liftedPose, sortHand } from '../logic/hand-layout';
import {
  advance,
  boughtLaneCount,
  CARDS_PER_ROUND,
  createMatch,
  DISCARD_ENERGY,
  DRAW_COST,
  incomeForRound,
  isLaneOpen,
  type MatchState,
  MAX_ROUNDS,
  MOVE_COST,
  SELL_MINION_ENERGY,
  UPGRADE_COST,
} from '../logic/match';
import { getRoundEventDef } from '../logic/round-events';
import { LANE_COUNT, laneShortName, MAX_FIELD_LEVEL } from '../logic/lanes';
import { type ActionBody, botPlanRecorded, createRecord, performAction, type RecordedMatch } from '../logic/match-record';
import { HAND_FILTER_NAMES, type HandFilter, isCardVisible, nextHandFilter } from '../logic/hand-filter';
import { advancePress, type PressState, startPress } from '../logic/long-press';
import { advanceMinionAnim, newMinionAnim } from '../logic/minion-look';
import { summarizeStats } from '../logic/match-stats';
import { bannerFor } from '../logic/phase-banner';
import { parseFast, parseSeed } from '../logic/seed';
import type { AudioEvent } from '../logic/audio-events';
import { AudioLayer, audioControlAt, drawAudioControls, sliderValueAt } from './audio';
import {
  freeLaneSlotPoints,
  freeSlotPoints,
  nearestPoint,
  type Point,
  SNAP_RADIUS,
  slotProximity,
  snapTarget,
} from '../logic/placement';
import { AmbienceLayer } from './ambience-layer';
import { BannerView, crestColors, drawCrest, drawRays } from './banner-view';
import { CardDetailView } from './card-detail-view';
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
import { drawButton, drawPanel, PALETTE, SURFACE, TEXT } from './theme';

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

/** Fläche der Glühwürmchen: das Spielfeld oberhalb der Hand; auch von der Replay-Szene genutzt. */
export const AMBIENCE_BOUNDS = { width: VIEW.width, height: BACKDROP_FIELD.handTop };

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
/** Abschlussbildschirm (nach dem Schließen der Statistik): Wappen, Bilanz, Teilen-URL und der Knopf zum Kopieren. */
const SHARE_PANEL = { x: 20, y: 30, width: 320, height: 560 };
const SHARE_COPY = { x: 110, y: 496, width: 140, height: 36 };
/** Mitte des Wappens und der Lichtstrahlen im Abschlussbildschirm. */
const CREST_CENTER = { x: 180, y: 100 };
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
/** Tasten für die Wirtschaft im oberen Rand: eine Karte ziehen (links neben dem Gegner-Text) und das Feld ausbauen. */
const DRAW_BUTTON = { x: 106, y: 32, width: 64, height: 24 };
const UPGRADE_BUTTON = { x: 266, y: 32, width: 88, height: 24 };
/** Taste „Figur verkaufen“ zwischen Ziehen und Upgrade: sichtbar, solange eine eigene Figur angetippt ist. */
const SELL_BUTTON = { x: 174, y: 32, width: 88, height: 24 };
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

/** Druck auf eine Handkarte: Haltezeit und Bewegung für das Langdrücken (siehe `long-press.ts`). */
interface HandPress {
  handIndex: number;
  press: PressState;
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
  private ambience!: AmbienceLayer;
  private audio!: AudioLayer;
  /** Regler, der gerade gezogen wird (nur Eingabezustand). */
  private slider: 'music' | 'effects' | null = null;
  /** Töne zu Aktionen ohne Zustandsunterschied (Karte gespielt), bis zum nächsten Bild. */
  private pendingAudio: AudioEvent[] = [];
  /** Zustand des letzten Bilds; der Vergleich mit dem aktuellen liefert die Effekte. */
  private fxState: MatchState = this.state;
  /** Szenenzeit und Trefferblitze der Minions (aus `delta` fortgeschrieben, nur Darstellung). */
  private minionAnim: MinionAnim = newMinionAnim();
  /** Index der angetippten Karte, die auf eine Line wartet. */
  private selected: number | null = null;
  /** Id der angetippten eigenen Figur, die „Verkaufen“ treffen würde (nur Eingabezustand). */
  private sellId: number | null = null;
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
  /** Detailansicht der Handkarten (langes Drücken) und der Hand-Index der gezeigten Karte. */
  private detailView!: CardDetailView;
  private detail: number | null = null;
  /** Dauer des gerade gezeichneten Bilds in Millisekunden (0 beim Zeichnen außerhalb von `update`). */
  private frameMs = 0;
  /** Gedrückte Handkarte, solange der Zeiger unten ist und noch kein Ziehen läuft. */
  private handPress: HandPress | null = null;
  /** Banner für Rundenwechsel und Spielende (Ablauf in `phase-banner.ts`). */
  private banner!: BannerView;
  /** Zeit seit Spielende in ms (aus `delta`), treibt die Lichtstrahlen des Abschlussbildschirms. */
  private endClockMs = 0;

  constructor() {
    super('main');
  }

  preload(): void {
    for (const id of CARD_ART_IDS) this.load.svg(`card-art-${id}`, `assets/cards/${id}.svg`, { width: 268, height: 144 });
    AudioLayer.preload(this);
  }

  /** Audio-Einstellungen (nur lesen, z. B. für den Smoke-Test). */
  get audioSettings(): { music: number; effects: number; muted: boolean } {
    return this.audio.current;
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

  /** Läuft gerade ein Banner (nur lesen, z. B. für E2E-Tests)? */
  get bannerActive(): boolean {
    return this.banner.active;
  }

  /** Hand-Index der Karte in der Detailansicht oder `null` (nur lesen, z. B. für E2E-Tests). */
  get detailCard(): number | null {
    return this.detail;
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
    this.minionAnim = newMinionAnim();
    addBackdrop(this, VIEW.width, VIEW.height, BACKDROP_FIELD);
    this.ambience = new AmbienceLayer(this, this.state.seed, this.state.round, AMBIENCE_BOUNDS, VIEW);
    this.pool = new LabelPool(this);
    this.effects = new Effects(this, FX_LOCATOR);
    this.audio = new AudioLayer(this, this.state.seed);
    this.slider = null;
    this.pendingAudio = [];
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
    this.detail = null;
    this.handPress = null;
    this.graphics = this.add.graphics();
    this.detailView = new CardDetailView(this, VIEW);
    this.banner = new BannerView(this, VIEW, parseFast(window.location.search));
    this.endClockMs = 0;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer.worldX, pointer.worldY));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer.worldX, pointer.worldY));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer.worldX, pointer.worldY));
    this.input.on('pointerupoutside', () => {
      this.slider = null;
      this.closeDetail();
      this.cancelDrag();
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
    if (this.state.phase !== 'planning' || this.state.ready[HUMAN]) this.cancelDrag();
    if (this.state.phase !== 'planning') this.closeDetail();
    this.updatePress(deltaMs);
    this.updateLifts(deltaMs);
    this.updateDrag(deltaMs);
    this.updateEffects(deltaMs);
    this.banner.update(deltaMs);
    if (this.state.phase === 'over') this.endClockMs += deltaMs;
    this.ambience.setRound(this.state.round);
    this.ambience.update(deltaMs);
    this.frameMs = deltaMs;
    this.render();
    this.frameMs = 0;
  }

  /** Rechnet die Haltezeit eines Drucks auf eine Handkarte fort; ab der Schwelle öffnet die Detailansicht. */
  private updatePress(deltaMs: number): void {
    const held = this.handPress;
    if (!held || held.press.status !== 'pending') return;
    const at = this.pointer ?? { x: held.press.startX, y: held.press.startY };
    const press = advancePress(held.press, deltaMs, at.x, at.y);
    this.handPress = { ...held, press };
    if (press.status !== 'open') return;
    // Die Karte wird weder gezogen noch angetippt: Loslassen schließt nur die Ansicht.
    this.detail = held.handIndex;
    this.drag = null;
  }

  /** Schließt die Detailansicht; ein noch laufender Druck löst danach nichts mehr aus. */
  private closeDetail(): void {
    this.detail = null;
    this.handPress = null;
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
    for (const event of events) this.banner.show(bannerFor(event, this.state));
    this.effects.update(deltaMs);
    this.audio.play([...this.pendingAudio, ...events], deltaMs);
    this.pendingAudio = [];
    this.minionAnim = advanceMinionAnim(this.minionAnim, events, previous, this.state, deltaMs);
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
    // Ein Tippen auf den Banner-Streifen überspringt das Banner; alles andere geht durch.
    if (this.banner.handleTap(y)) {
      this.drag = null;
      return;
    }
    // Ein Tippen bei offener Detailansicht schließt sie, mehr nicht.
    if (this.detail !== null) {
      this.closeDetail();
      this.drag = null;
      return;
    }
    const control = audioControlAt(x, y);
    if (control === 'mute') {
      this.audio.toggleMute();
      return;
    }
    if (control) {
      this.slider = control;
      this.setSlider(control, x);
      return;
    }
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
    if (handIndex !== null) {
      // Auf einer Handkarte entscheidet erst das Loslassen (Tippen) oder die Haltezeit (Detailansicht).
      this.pointer = { x, y };
      this.handPress = { handIndex, press: startPress(x, y) };
      this.drag = this.isDraggable(handIndex) ? { minionId: null, handIndex, startX: x, startY: y, x, y, dragging: false } : null;
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

  private setSlider(control: 'music' | 'effects', x: number): void {
    const value = sliderValueAt(control, x);
    if (control === 'music') this.audio.setMusic(value);
    else this.audio.setEffects(value);
  }

  private onPointerMove(x: number, y: number): void {
    if (this.slider) {
      this.setSlider(this.slider, x);
      return;
    }
    this.pointer = { x, y };
    this.hovered = this.drag?.dragging ? null : this.cardIndexAt(x, y);
    // Bewegung über die Toleranz bricht das Langdrücken sofort ab (nicht erst im nächsten Bild).
    if (this.handPress) this.handPress = { ...this.handPress, press: advancePress(this.handPress.press, 0, x, y) };
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
    this.handPress = null;
  }

  private onPointerUp(x: number, y: number): void {
    this.slider = null;
    const held = this.handPress;
    this.handPress = null;
    if (this.detail !== null) {
      // Loslassen nach dem Langdrücken schließt nur die Ansicht: keine Karte wird gespielt oder gewählt.
      this.closeDetail();
      this.drag = null;
      return;
    }
    const drag = this.drag;
    if (!drag) {
      // Gedrückte Karte ohne Ziehen (z. B. Upgrade): das Antippen gilt erst beim Loslassen.
      if (held) this.handleTap(held.press.startX, held.press.startY);
      return;
    }
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
      (center, line) => isLaneOpen(this.state.players[HUMAN], line) && Math.abs(y - center) <= FIELD.laneHalfHeight,
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
      // Das Spielende-Banner kommt zuerst; ein Tippen blendet es aus, danach folgt der Abschlussbildschirm.
      if (this.banner.active) {
        this.banner.skip();
        return;
      }
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
      this.sellId = null;
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
    if (this.sellId !== null && inside(SELL_BUTTON, x, y)) {
      this.sell(this.sellId);
      return;
    }
    if (inside(LAYOUT.filterButton, x, y)) {
      this.handFilter = nextHandFilter(this.handFilter);
      const selected = this.selected;
      if (selected !== null && !this.isVisibleInHand(selected)) this.selected = null;
      return;
    }
    if (inside(UPGRADE_BUTTON, x, y)) {
      this.economy({ type: 'upgrade' });
      return;
    }
    if (inside(DRAW_BUTTON, x, y)) {
      this.economy({ type: 'draw' });
      return;
    }
    // Antippen einer eigenen Figur wählt sie zum Verkaufen (nochmals antippen hebt die Wahl auf).
    const tapped = this.selectedNeedsMinion() ? null : this.grabbableMinionAt(x, y);
    if (tapped !== null) {
      this.message = '';
      this.selected = null;
      this.sellId = this.sellId === tapped ? null : tapped;
      return;
    }
    const index = this.cardIndexAt(x, y);
    if (index !== null) {
      this.message = '';
      this.sellId = null;
      const def = getCardDef(this.state.players[HUMAN].hand[index]!);
      if (def.target === 'none') {
        this.play(index);
      } else {
        this.selected = this.selected === index ? null : index;
      }
      return;
    }
    if (this.selected === null) {
      const locked = this.lockedLaneAt(x, y);
      if (locked !== null) this.economy({ type: 'buy-lane', line: locked });
      return;
    }
    if (this.selectedNeedsMinion() || y > LAYOUT.handTop - 4) return;
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

  /** Noch nicht gekaufte Lane unter dem Punkt (nur ihr abgedunkelter Streifen), sonst `null`. */
  private lockedLaneAt(x: number, y: number): number | null {
    if (x < FIELD.ownTowerX - 14 || x > FIELD.enemyTowerX + 14) return null;
    const human = this.state.players[HUMAN];
    const lane = FIELD.laneCenters.findIndex(
      (center, line) => !isLaneOpen(human, line) && Math.abs(y - center) <= FIELD.pathHalfHeight,
    );
    return lane < 0 ? null : lane;
  }

  /** Führt eine Wirtschaftsaktion (Upgrade, Lane kaufen, Karte ziehen) des Menschen aus und zeigt einen Fehlergrund. */
  private economy(body: ActionBody): void {
    const done = performAction(this.state, this.record, HUMAN, body);
    this.state = done.result.state;
    this.record = done.record;
    this.message = done.result.ok ? '' : this.explain(done.result.reason);
    if (done.result.ok) this.pendingAudio.push({ kind: 'card-play' });
  }

  /** Verkauft die angetippte Figur (bringt `SELL_MINION_ENERGY` Energie, siehe `sellMinion`). */
  private sell(minionId: number): void {
    const done = performAction(this.state, this.record, HUMAN, { type: 'sell', minionId });
    this.state = done.result.state;
    this.record = done.record;
    this.sellId = null;
    this.message = done.result.ok ? '' : this.explain(done.result.reason);
    if (done.result.ok) this.pendingAudio.push({ kind: 'card-play' });
  }

  /** Verkauft die Handkarte (Abwerfen, bringt `DISCARD_ENERGY` Energie, siehe `discardCard`). */
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
      this.pendingAudio.push({ kind: 'card-play' });
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
        return 'Feldstufe zu niedrig';
      case 'lane-owned':
        return 'Lane schon gekauft';
      case 'hand-full':
        return 'Hand ist voll';
      case 'already-specialized':
        return 'Tower schon spezialisiert';
      case 'slot-taken':
        return 'Turm-Slot ist belegt';
      case 'invalid-target':
        return 'Wähle einen eigenen Minion';
      case 'card-limit':
        return 'Karte gespielt: nur eine pro Runde';
      case 'no-such-minion':
        return 'Diese Figur lässt sich nicht verkaufen';
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
      hover ? SURFACE.buttonDiscardHover : SURFACE.buttonDiscard,
    );
    this.label(
      `Verkaufen +${DISCARD_ENERGY}`,
      DISCARD_BUTTON.x + DISCARD_BUTTON.width / 2,
      DISCARD_BUTTON.y + DISCARD_BUTTON.height / 2,
      { size: 11, font: 'heading', bold: true },
    );
  }

  /** Tasten „Ziehen“ und „Upgrade“ mit Preis; grau, wenn die Aktion jetzt nicht geht. Dazu das Einkommen der nächsten Runde. */
  private drawEconomyButtons(state: MatchState): void {
    const human = state.players[HUMAN];
    const planning = state.phase === 'planning' && !state.ready[HUMAN];
    const maxLevel = human.level >= MAX_FIELD_LEVEL;
    const buttons = [
      { rect: DRAW_BUTTON, text: `Ziehen -${DRAW_COST}`, enabled: planning && human.energy >= DRAW_COST },
      {
        rect: UPGRADE_BUTTON,
        text: maxLevel ? `Lvl ${human.level} (max)` : `Upgrade -${UPGRADE_COST}`,
        enabled: planning && !maxLevel && human.energy >= UPGRADE_COST,
      },
    ];
    const sellable = planning && this.sellId !== null && human.minions.some((m) => m.id === this.sellId);
    if (sellable) {
      buttons.push({ rect: SELL_BUTTON, text: `Figur verkaufen +${SELL_MINION_ENERGY}`, enabled: true });
      const sold = human.minions.find((m) => m.id === this.sellId)!;
      const point = playerMinionPoint(HUMAN, human, sold);
      this.graphics.lineStyle(2, PALETTE.gold, 0.95).strokeCircle(point.x, point.y, GRAB_RADIUS * 0.8);
    }
    for (const { rect, text, enabled } of buttons) {
      drawButton(this.graphics, rect, { enabled });
      this.label(text, rect.x + rect.width / 2, rect.y + rect.height / 2, { size: 11, font: 'heading', bold: true });
    }
    const next = Math.min(MAX_ROUNDS, state.round + 1);
    this.label(
      `Feld Lvl ${human.level} · Einkommen ${incomeForRound(state.round, human.level, boughtLaneCount(human))}, nächste Runde ${incomeForRound(next, human.level, boughtLaneCount(human))}`,
      VIEW.width / 2,
      64,
      { size: 9, color: TEXT.gold },
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
    drawBoard(g, this.label, state, this.selected !== null && !needsMinion, this.minionAnim.timeMs);

    const phaseText =
      state.phase === 'planning' ? 'Planung' : state.phase === 'combat' ? 'Kampf' : 'Ende';
    drawPanel(g, 80, 3, 200, 26, { metal: 'gold', radius: 10 });
    this.label(`Runde ${state.round}/${MAX_ROUNDS} · ${phaseText}`, VIEW.width / 2, 16, {
      size: 14,
      font: 'heading',
      bold: true,
    });
    drawAudioControls(g, this.label, this.audio.current);
    this.label(`Gegner: ${bot.hand.length} Karten`, 218, 40, { size: 10, color: TEXT.dim });
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
    this.drawEconomyButtons(state);
    const cardPlayed = state.phase === 'planning' && !state.ready[HUMAN] && human.cardsPlayed >= CARDS_PER_ROUND;
    if (cardPlayed) {
      this.label('Karte gespielt · Rest wird beim Bereit abgelegt', VIEW.width / 2, LAYOUT.handTop - 8, {
        size: 10,
        color: TEXT.gold,
        stroke: 2,
      });
    }
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
        affordable: human.energy >= def.cost && !cardPlayed,
        visible,
      });
    });
    // Nach Match-Ende (Overlay auf der Grafik) und für nicht mehr belegte Plätze bleiben die Karten verborgen.
    this.cardViews.forEach((view, slot) => {
      if (slot >= shown) view.hide();
    });
    const detailId = this.detail === null ? undefined : human.hand[this.detail];
    if (detailId !== undefined && state.phase === 'planning') {
      const def = getCardDef(detailId);
      this.detailView.update(def, human.energy >= def.cost, this.frameMs);
    } else {
      this.detailView.hide();
    }

    const matching = cards.filter(({ def }) => isCardVisible(def.type, this.handFilter)).length;
    const filterButton = LAYOUT.filterButton;
    drawButton(g, filterButton, this.handFilter === 'all' ? SURFACE.buttonFilterAll : SURFACE.buttonFilterActive);
    this.label(
      `Filter: ${HAND_FILTER_NAMES[this.handFilter]} (${matching})`,
      filterButton.x + filterButton.width / 2,
      filterButton.y + filterButton.height / 2,
      { size: 10, width: filterButton.width - 8 },
    );

    // Leiste unten: Energie im Bronzerahmen mit Kristall, Bereit-Knopf.
    drawPanel(g, ENERGY_BAR.x, ENERGY_BAR.y, ENERGY_BAR.width, ENERGY_BAR.height, { metal: 'bronze', radius: 8 });
    const crystal = energyCrystalLayout();
    const toPoints = (points: readonly { x: number; y: number }[]) => points.map((p) => new Phaser.Geom.Point(p.x, p.y));
    g.fillStyle(PALETTE.energy, 0.3).fillCircle(crystal.center.x, crystal.center.y, crystal.glowRadius);
    g.fillStyle(PALETTE.goldDark, 1).fillPoints(toPoints(crystal.outer), true);
    g.fillStyle(PALETTE.energy, 1).fillPoints(toPoints(crystal.inner), true);
    g.fillStyle(PALETTE.white, 0.45).fillPoints(toPoints(crystal.shine), true);
    this.label(`Energie ${human.energy}`, ENERGY_LABEL.x, ENERGY_LABEL.y, { size: 16, color: TEXT.gold, font: 'heading', bold: true });
    if (this.message) this.label(this.message, ENERGY_MESSAGE.x, ENERGY_MESSAGE.y, { size: 10, color: TEXT.bad });
    const button = LAYOUT.button;
    const waiting = state.phase !== 'planning' || state.ready[HUMAN];
    drawButton(g, button, { enabled: !waiting });
    this.label(waiting ? 'Kampf läuft' : 'Bereit', button.x + button.width / 2, button.y + button.height / 2, {
      size: 14,
      font: 'heading',
      bold: true,
    });

    // Während das Spielende-Banner läuft, bleibt das Feld sichtbar; danach folgen Statistik und Abschlussbildschirm.
    if (state.phase === 'over' && !this.banner.active) {
      if (!this.statsClosed) this.renderStats(state);
      else this.renderEndScreen(state);
    }

    this.pool.hideUnused();
  }

  /** Abschlussbildschirm: Lichtstrahlen, Wappen in der Teamfarbe, Bilanz aus `state.stats`, Teilen-Link, Neustart. */
  private renderEndScreen(state: MatchState): void {
    const g = this.graphics;
    const panel = SHARE_PANEL;
    const centerX = VIEW.width / 2;
    const won = state.outcome === 'player0';
    const lost = state.outcome === 'player1';
    // Das Wappen gehört dem Sieger; beim Unentschieden trägt der Mensch es.
    const colors = crestColors(lost ? 'bot' : 'human');
    // Die Beschriftungen des Felds liegen über der Grafik; der Abschlussbildschirm ersetzt sie durch seine eigenen.
    this.pool.reset();
    g.fillStyle(PALETTE.black, 0.55).fillRect(0, 0, VIEW.width, VIEW.height);
    drawPanel(g, panel.x, panel.y, panel.width, panel.height, { metal: 'gold' });
    drawRays(g, CREST_CENTER.x, CREST_CENTER.y, 150, this.endClockMs, won ? PALETTE.goldLight : colors.light);
    drawCrest(g, CREST_CENTER.x, CREST_CENTER.y, 64, colors);

    const text = state.outcome === 'draw' ? 'Unentschieden' : won ? 'Du gewinnst!' : 'Du verlierst';
    this.label(text, centerX, panel.y + 142, { size: 26, font: 'heading', bold: true, color: TEXT.gold, stroke: 3 });

    const summary = summarizeStats(state.stats);
    const rows = [
      `Beschwörungen: ${summary.summoned}`,
      `Schaden an Minions: ${summary.minionDamage}`,
      `Schaden an Towern: ${summary.towerDamage}`,
      `Stärkste Karte: ${summary.topCardId === null ? '–' : getCardDef(summary.topCardId).name}`,
    ];
    rows.forEach((row, index) => this.label(row, centerX, panel.y + 176 + index * 16, { size: 12 }));

    this.label('Replay zum Teilen:', centerX, panel.y + 262, { size: 12, color: TEXT.dim });
    const lines = shareUrlLines(shareUrl(this.record));
    this.label(lines.join('\n'), centerX, panel.y + 280 + (lines.length * SHARE_LINE_HEIGHT) / 2, { size: 9, stroke: 1 });
    drawButton(g, SHARE_COPY);
    this.label('Link kopieren', SHARE_COPY.x + SHARE_COPY.width / 2, SHARE_COPY.y + SHARE_COPY.height / 2, {
      size: 13,
      font: 'heading',
      bold: true,
    });
    this.label('Tippen für ein neues Spiel', centerX, panel.y + panel.height - 24, { size: 13, color: TEXT.dim });
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
