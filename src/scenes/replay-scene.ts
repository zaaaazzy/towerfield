import Phaser from 'phaser';
import { MAX_ROUNDS } from '../logic/match';
import { decodeMatch, type RecordedMatch } from '../logic/match-record';
import {
  createInvalidReplay,
  createRecordedReplay,
  createReplay,
  describeAbort,
  describeEvent,
  isReplayOver,
  type ReplayState,
  SLOWMO_FACTOR,
  stepReplay,
} from '../logic/replay';
import { parseReplayMoves, parseReplaySeed } from '../logic/seed';
import { diffFx } from '../logic/fx-events';
import { advanceMinionAnim, newMinionAnim } from '../logic/minion-look';
import { REPLAY_MUSIC_SCALE } from '../logic/audio-settings';
import { AudioLayer } from './audio';
import { Effects } from './effects';
import { drawBoard, drawMinions, type MinionAnim } from './field-view';
import { type LabelFn, LabelPool } from './labels';
import { AmbienceLayer } from './ambience-layer';
import { AMBIENCE_BOUNDS, BACKDROP_FIELD, FX_LOCATOR, VIEW } from './main-scene';
import { shareUrl, shareUrlLines } from './share';
import { addBackdrop } from './textures';
import { drawPanel, TEXT } from './theme';

/** Zahl der Kommentare, die gleichzeitig im Band stehen. */
const VISIBLE_COMMENTS = 6;
const BAND = { x: 10, y: 450, width: 340, height: 170 };
const LINE_HEIGHT = 24;

/**
 * Replay-Szene: `?replay=<seed>` zeigt ein Bot-gegen-Bot-Match, `?replay=<seed>&moves=<kodiert>` die aufgezeichneten
 * Züge eines gespielten Matches, jeweils ohne Spielereingabe. Die Logik steckt in `replay.ts`; die Szene ruft sie mit
 * `delta` auf und zeichnet Spielfeld und Kommentarband. Nach dem Ende startet ein Tastendruck oder Klick dasselbe Replay
 * neu. Sind die Zugdaten ungültig oder regelwidrig, bleibt das Replay mit einem Hinweis stehen; dann führt ein Tastendruck
 * oder Klick zu einem neuen Spiel (`MainScene`).
 */
export class ReplayScene extends Phaser.Scene {
  private replay: ReplayState = createReplay(1);
  /** Die dekodierten Züge, `null` beim Bot-Replay und bei ungültigen Zugdaten. */
  private record: RecordedMatch | null = null;
  private seed = 1;
  private graphics!: Phaser.GameObjects.Graphics;
  private pool!: LabelPool;
  private effects!: Effects;
  private ambience!: AmbienceLayer;
  private audio!: AudioLayer;
  /** Szenenzeit und Trefferblitze der Minions (aus `delta` fortgeschrieben, nur Darstellung). */
  private minionAnim: MinionAnim = newMinionAnim();

  constructor() {
    super('replay');
  }

  preload(): void {
    AudioLayer.preload(this);
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
    const moves = parseReplayMoves(window.location.search);
    this.record = moves === null ? null : decodeMatch(this.seed, moves);
    this.replay =
      moves === null
        ? createReplay(this.seed)
        : this.record
          ? createRecordedReplay(this.record)
          : createInvalidReplay(this.seed);
    this.minionAnim = newMinionAnim();
    addBackdrop(this, VIEW.width, VIEW.height, BACKDROP_FIELD);
    this.ambience = new AmbienceLayer(this, this.replay.match.seed, this.replay.match.round, AMBIENCE_BOUNDS, VIEW);
    this.pool = new LabelPool(this);
    this.effects = new Effects(this, FX_LOCATOR);
    this.audio = new AudioLayer(this, this.seed, REPLAY_MUSIC_SCALE);
    this.graphics = this.add.graphics();
    const restart = () => {
      if (this.replay.aborted) this.scene.start('main');
      else if (isReplayOver(this.replay)) this.scene.restart();
    };
    this.input.on('pointerdown', restart);
    this.input.keyboard?.on('keydown', restart);
    this.render();
  }

  update(_time: number, deltaMs: number): void {
    const previous = this.replay.match;
    this.replay = stepReplay(this.replay, deltaMs);
    const events = diffFx(previous, this.replay.match);
    this.effects.play(events);
    this.effects.update(deltaMs);
    this.audio.play(events, deltaMs);
    this.minionAnim = advanceMinionAnim(this.minionAnim, events, previous, this.replay.match, deltaMs);
    this.ambience.setRound(this.replay.match.round);
    this.ambience.update(deltaMs);
    this.render();
  }

  private render(): void {
    const g = this.graphics;
    const label: LabelFn = (text, x, y, options) => this.pool.label(text, x, y, options);
    const { match } = this.replay;
    g.clear();
    this.pool.reset();

    drawBoard(g, label, match);
    drawMinions(g, match, undefined, this.minionAnim);

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
    if (this.replay.events.length === 0 && !this.replay.aborted) {
      const waiting = this.record ? 'Die Züge werden abgespielt …' : 'Die Bots planen …';
      label(waiting, BAND.x + 10, BAND.y + 38, { size: 12, color: TEXT.dim, origin: 0 });
    }
    if (match.phase === 'combat') {
      label(`Zeitlupe ×${SLOWMO_FACTOR}`, BAND.x + BAND.width - 10, BAND.y + 14, {
        size: 11,
        color: TEXT.dim,
        origin: 1,
      });
    }

    if (this.replay.aborted) {
      g.fillStyle(0x000000, 0.6).fillRect(0, 0, VIEW.width, VIEW.height);
      drawPanel(g, 10, 200, 340, 200, { metal: 'gold' });
      label('Replay gestoppt', VIEW.width / 2, 235, { size: 22, font: 'heading', bold: true, color: TEXT.gold, stroke: 3 });
      label(describeAbort(this.replay.aborted), VIEW.width / 2, 300, { size: 13, width: VIEW.width - 60 });
      label('Taste oder Klick: neues Spiel', VIEW.width / 2, 365, { size: 13, color: TEXT.dim });
    } else if (match.phase === 'over') {
      g.fillStyle(0x000000, 0.6).fillRect(0, 0, VIEW.width, VIEW.height);
      drawPanel(g, 10, 120, 340, 310, { metal: 'gold' });
      const text =
        match.outcome === 'draw' ? 'Unentschieden' : match.outcome === 'player0' ? 'Blau gewinnt' : 'Orange gewinnt';
      label(text, VIEW.width / 2, 160, { size: 26, font: 'heading', bold: true, color: TEXT.gold, stroke: 3 });
      label('Zum Teilen:', VIEW.width / 2, 205, { size: 12, color: TEXT.dim });
      if (this.record) {
        const lines = shareUrlLines(this.shareUrl());
        label(lines.join('\n'), VIEW.width / 2, 222 + (lines.length * 12) / 2, { size: 9, stroke: 1 });
      } else {
        label(this.shareUrl(), VIEW.width / 2, 245, { size: 12, width: VIEW.width - 40 });
      }
      label('Taste oder Klick: Replay neu starten', VIEW.width / 2, 405, { size: 13, color: TEXT.dim });
    }

    this.pool.hideUnused();
  }

  private shareUrl(): string {
    if (this.record) return shareUrl(this.record);
    return `${window.location.origin}${window.location.pathname}?replay=${this.seed}`;
  }
}
