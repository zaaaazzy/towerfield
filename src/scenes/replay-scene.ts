import Phaser from 'phaser';
import { MAX_ROUNDS } from '../logic/match';
import {
  createReplay,
  describeEvent,
  isReplayOver,
  type ReplayState,
  SLOWMO_FACTOR,
  stepReplay,
} from '../logic/replay';
import { parseReplaySeed } from '../logic/seed';
import { diffFx } from '../logic/fx-events';
import { Effects } from './effects';
import { drawBoard, drawMinions } from './field-view';
import { type LabelFn, LabelPool } from './labels';
import { BACKDROP_FIELD, FX_LOCATOR, VIEW } from './main-scene';
import { addBackdrop } from './textures';
import { drawPanel, TEXT } from './theme';

/** Zahl der Kommentare, die gleichzeitig im Band stehen. */
const VISIBLE_COMMENTS = 6;
const BAND = { x: 10, y: 450, width: 340, height: 170 };
const LINE_HEIGHT = 24;

/**
 * Replay-Szene (`?replay=<seed>`): ein Bot-gegen-Bot-Match zum Seed ohne Spielereingabe. Die Logik steckt in
 * `replay.ts`; die Szene ruft sie mit `delta` auf und zeichnet Spielfeld und Kommentarband. Nach dem Ende startet
 * ein Tastendruck oder Klick dasselbe Replay neu.
 */
export class ReplayScene extends Phaser.Scene {
  private replay: ReplayState = createReplay(1);
  private seed = 1;
  private graphics!: Phaser.GameObjects.Graphics;
  private pool!: LabelPool;
  private effects!: Effects;

  constructor() {
    super('replay');
  }

  /** Aktueller Replay-Zustand (nur lesen), z. B. für den Smoke-Test. */
  get current(): ReplayState {
    return this.replay;
  }

  /** Die gerade sichtbaren Kommentare, ältester zuerst (nur lesen, z. B. für den Smoke-Test). */
  get comments(): string[] {
    return this.replay.events.slice(-VISIBLE_COMMENTS).map(describeEvent);
  }

  create(): void {
    this.seed = parseReplaySeed(window.location.search) ?? 1;
    this.replay = createReplay(this.seed);
    addBackdrop(this, VIEW.width, VIEW.height, BACKDROP_FIELD);
    this.pool = new LabelPool(this);
    this.effects = new Effects(this, FX_LOCATOR);
    this.graphics = this.add.graphics();
    const restart = () => {
      if (isReplayOver(this.replay)) this.scene.restart();
    };
    this.input.on('pointerdown', restart);
    this.input.keyboard?.on('keydown', restart);
    this.render();
  }

  update(_time: number, deltaMs: number): void {
    const previous = this.replay.match;
    this.replay = stepReplay(this.replay, deltaMs);
    this.effects.play(diffFx(previous, this.replay.match));
    this.effects.update(deltaMs);
    this.render();
  }

  private render(): void {
    const g = this.graphics;
    const label: LabelFn = (text, x, y, options) => this.pool.label(text, x, y, options);
    const { match } = this.replay;
    g.clear();
    this.pool.reset();

    drawBoard(g, label, match);
    drawMinions(g, match);

    const phaseText = match.phase === 'planning' ? 'Planung' : match.phase === 'combat' ? 'Kampf (Zeitlupe)' : 'Ende';
    drawPanel(g, 20, 3, 320, 26, { metal: 'gold', radius: 10 });
    label(`Replay ${this.seed} · Runde ${match.round}/${MAX_ROUNDS} · ${phaseText}`, VIEW.width / 2, 16, {
      size: 13,
      font: 'heading',
      bold: true,
    });
    label(`Blau: ${match.players[0].energy} Energie`, 70, 40, { size: 11, color: TEXT.human });
    label(`Orange: ${match.players[1].energy} Energie`, 290, 40, { size: 11, color: TEXT.bot });

    drawPanel(g, BAND.x, BAND.y, BAND.width, BAND.height, { metal: 'bronze' });
    label('Kommentar', BAND.x + 10, BAND.y + 14, { size: 11, color: TEXT.gold, origin: 0, font: 'heading', bold: true });
    this.replay.events.slice(-VISIBLE_COMMENTS).forEach((event, index) => {
      label(describeEvent(event), BAND.x + 10, BAND.y + 38 + index * LINE_HEIGHT, {
        size: 12,
        color: event.player === 0 ? TEXT.human : TEXT.bot,
        origin: 0,
      });
    });
    if (this.replay.events.length === 0) {
      label('Die Bots planen …', BAND.x + 10, BAND.y + 38, { size: 12, color: TEXT.dim, origin: 0 });
    }
    if (match.phase === 'combat') {
      label(`Zeitlupe ×${SLOWMO_FACTOR}`, BAND.x + BAND.width - 10, BAND.y + 14, {
        size: 11,
        color: TEXT.dim,
        origin: 1,
      });
    }

    if (match.phase === 'over') {
      g.fillStyle(0x000000, 0.6).fillRect(0, 0, VIEW.width, VIEW.height);
      drawPanel(g, 10, 150, 340, 240, { metal: 'gold' });
      const text =
        match.outcome === 'draw' ? 'Unentschieden' : match.outcome === 'player0' ? 'Blau gewinnt' : 'Orange gewinnt';
      label(text, VIEW.width / 2, 190, { size: 26, font: 'heading', bold: true, color: TEXT.gold, stroke: 3 });
      label('Zum Teilen:', VIEW.width / 2, 245, { size: 12, color: TEXT.dim });
      label(this.shareUrl(), VIEW.width / 2, 285, { size: 12, width: VIEW.width - 40 });
      label('Taste oder Klick: Replay neu starten', VIEW.width / 2, 355, { size: 13, color: TEXT.dim });
    }

    this.pool.hideUnused();
  }

  private shareUrl(): string {
    return `${window.location.origin}${window.location.pathname}?replay=${this.seed}`;
  }
}
