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
import { COLORS, drawBoard, drawMinions, type LabelFn, LabelPool, VIEW } from './main-scene';

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
    this.pool = new LabelPool(this);
    this.graphics = this.add.graphics();
    const restart = () => {
      if (isReplayOver(this.replay)) this.scene.restart();
    };
    this.input.on('pointerdown', restart);
    this.input.keyboard?.on('keydown', restart);
    this.render();
  }

  update(_time: number, deltaMs: number): void {
    this.replay = stepReplay(this.replay, deltaMs);
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
    label(`Replay ${this.seed} · Runde ${match.round}/${MAX_ROUNDS} · ${phaseText}`, VIEW.width / 2, 16, { size: 13 });
    label(`Blau: ${match.players[0].energy} Energie`, 70, 40, { size: 11, color: '#9aa4bf' });
    label(`Orange: ${match.players[1].energy} Energie`, 290, 40, { size: 11, color: '#9aa4bf' });

    g.fillStyle(COLORS.card, 1).fillRoundedRect(BAND.x, BAND.y, BAND.width, BAND.height, 8);
    label('Kommentar', BAND.x + 10, BAND.y + 14, { size: 11, color: '#ffd54a', origin: 0 });
    this.replay.events.slice(-VISIBLE_COMMENTS).forEach((event, index) => {
      label(describeEvent(event), BAND.x + 10, BAND.y + 38 + index * LINE_HEIGHT, {
        size: 12,
        color: event.player === 0 ? '#4fc3f7' : '#ff7043',
        origin: 0,
      });
    });
    if (this.replay.events.length === 0) {
      label('Die Bots planen …', BAND.x + 10, BAND.y + 38, { size: 12, color: '#9aa4bf', origin: 0 });
    }
    if (match.phase === 'combat') {
      label(`Zeitlupe ×${SLOWMO_FACTOR}`, BAND.x + BAND.width - 10, BAND.y + 14, {
        size: 11,
        color: '#9aa4bf',
        origin: 1,
      });
    }

    if (match.phase === 'over') {
      g.fillStyle(0x000000, 0.8).fillRect(0, 150, VIEW.width, 240);
      const text =
        match.outcome === 'draw' ? 'Unentschieden' : match.outcome === 'player0' ? 'Blau gewinnt' : 'Orange gewinnt';
      label(text, VIEW.width / 2, 190, { size: 26 });
      label('Zum Teilen:', VIEW.width / 2, 245, { size: 12, color: '#9aa4bf' });
      label(this.shareUrl(), VIEW.width / 2, 285, { size: 12, width: VIEW.width - 40 });
      label('Taste oder Klick: Replay neu starten', VIEW.width / 2, 355, { size: 13, color: '#9aa4bf' });
    }

    this.pool.hideUnused();
  }

  private shareUrl(): string {
    return `${window.location.origin}${window.location.pathname}?replay=${this.seed}`;
  }
}
