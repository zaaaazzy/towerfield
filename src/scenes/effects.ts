/**
 * Treffer-, Tod- und Beschwörungseffekte: Partikel, Ringe (Tweens) und aufsteigende Schadenszahlen.
 * Die Szene übergibt die Ereignisse aus `logic/fx-events.ts`; hier entsteht nur Darstellung. Zeiten laufen über
 * `delta` bzw. Phaser-Tweens, Mengen sind begrenzt, damit viele gleichzeitige Treffer nicht bremsen.
 */
import Phaser from 'phaser';
import type { FxEvent } from '../logic/fx-events';
import { FONTS, PALETTE, TEXT } from './theme';
import { TEXTURE_KEYS } from './textures';

export interface Point {
  x: number;
  y: number;
}

/** Wie die Szene Ereignisse auf Bildschirmpunkte abbildet. */
export interface Locator {
  minion(owner: number, line: number, position: number, id: number): Point;
  tower(owner: number, line: number): Point;
}

/** Schaden wird je Ziel gesammelt und als eine Zahl gezeigt (sonst gäbe es je Tick eine Zahl). */
interface Pending {
  amount: number;
  /** Zeit seit der letzten Zahl bzw. dem ersten Schaden in Millisekunden. */
  age: number;
  sparkCooldown: number;
  point: Point;
  tower: boolean;
}

const NUMBER_INTERVAL_MS = 450;
const SPARK_INTERVAL_MS = 160;
const PENDING_TIMEOUT_MS = 2000;
const MAX_FLOATERS = 20;
const MAX_RINGS = 24;
const MAX_PARTICLES = 150;

const teamColor = (owner: number): number => (owner === 0 ? PALETTE.human : PALETTE.bot);

export class Effects {
  private readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly pending = new Map<string, Pending>();
  private floaters = 0;
  private rings = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly locate: Locator,
  ) {}

  /** Setzt die Ereignisse eines Zustandsübergangs in sichtbare Effekte um. */
  play(events: readonly FxEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'summon': {
          const at = this.locate.minion(event.owner, event.line, event.position, event.minionId);
          this.burst('summon', teamColor(event.owner), at, 10);
          this.ring(at, teamColor(event.owner), 1.1);
          break;
        }
        case 'minion-damage':
          this.collect(`m:${event.owner}:${event.minionId}`, event.amount, {
            point: this.locate.minion(event.owner, event.line, event.position, event.minionId),
            tower: false,
          });
          break;
        case 'minion-death': {
          const at = this.locate.minion(event.owner, event.line, event.position, event.minionId);
          this.burst('death', teamColor(event.owner), at, 16);
          this.ring(at, PALETTE.white, 0.9);
          break;
        }
        case 'tower-damage':
          this.collect(`t:${event.owner}:${event.line}`, event.amount, {
            point: this.locate.tower(event.owner, event.line),
            tower: true,
          });
          break;
        case 'tower-down': {
          const at = this.locate.tower(event.owner, event.line);
          this.burst('down', PALETTE.gold, at, 36);
          this.burst('down', teamColor(event.owner), at, 20);
          this.ring(at, PALETTE.gold, 2.2);
          this.scene.cameras.main.shake(220, 0.006);
          break;
        }
      }
    }
  }

  /** Die gespielte Karte flammt kurz auf, wächst und verblasst an ihrem Platz in der Hand. */
  cardPlayed(rect: { x: number; y: number; width: number; height: number }, name: string, accent: number): void {
    const { width, height } = rect;
    const ghost = this.scene.add.graphics();
    ghost.fillStyle(accent, 0.35).fillRoundedRect(-width / 2 - 3, -height / 2 - 3, width + 6, height + 6, 9);
    ghost.fillStyle(PALETTE.panelDark, 0.9).fillRoundedRect(-width / 2, -height / 2, width, height, 6);
    ghost.lineStyle(3, PALETTE.gold, 1).strokeRoundedRect(-width / 2, -height / 2, width, height, 6);
    const title = this.scene.add
      .text(0, 0, name, {
        fontFamily: FONTS.heading,
        fontSize: '9px',
        fontStyle: 'bold',
        color: TEXT.gold,
        stroke: TEXT.outline,
        strokeThickness: 2,
        align: 'center',
        wordWrap: { width: width - 6 },
        resolution: 2,
      })
      .setOrigin(0.5);
    const container = this.scene.add.container(rect.x + width / 2, rect.y + height / 2, [ghost, title]).setDepth(25);
    this.scene.tweens.add({
      targets: container,
      scale: 1.5,
      y: container.y - 44,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => container.destroy(),
    });
  }

  /** Pro Bild: sammelt Zeit und gibt fällige Schadenszahlen und Funken aus. */
  update(deltaMs: number): void {
    for (const [key, entry] of this.pending) {
      entry.age += deltaMs;
      entry.sparkCooldown -= deltaMs;
      if (entry.amount >= 0.5 && entry.age >= NUMBER_INTERVAL_MS) {
        this.floatNumber(entry.point, Math.round(entry.amount), entry.tower);
        entry.amount = 0;
        entry.age = 0;
      } else if (entry.age >= PENDING_TIMEOUT_MS) {
        this.pending.delete(key);
      }
    }
  }

  private collect(key: string, amount: number, target: { point: Point; tower: boolean }): void {
    const entry = this.pending.get(key);
    if (entry) {
      entry.amount += amount;
      entry.point = target.point;
      if (entry.sparkCooldown <= 0) this.spark(entry);
      return;
    }
    const created: Pending = { amount, age: 0, sparkCooldown: 0, point: target.point, tower: target.tower };
    this.pending.set(key, created);
    this.spark(created);
  }

  private spark(entry: Pending): void {
    entry.sparkCooldown = SPARK_INTERVAL_MS;
    this.burst('hit', entry.tower ? PALETTE.bad : PALETTE.goldLight, entry.point, entry.tower ? 4 : 3);
  }

  private emitter(kind: string, color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const key = `${kind}:${color}`;
    let emitter = this.emitters.get(key);
    if (!emitter) {
      const big = kind === 'down' || kind === 'death';
      emitter = this.scene.add.particles(0, 0, TEXTURE_KEYS.spark, {
        lifespan: big ? { min: 350, max: 700 } : { min: 200, max: 400 },
        speed: big ? { min: 40, max: 140 } : { min: 25, max: 85 },
        scale: { start: big ? 1.1 : 0.7, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: color,
        blendMode: 'ADD',
        emitting: false,
      });
      emitter.setDepth(20);
      this.emitters.set(key, emitter);
    }
    return emitter;
  }

  private burst(kind: string, color: number, at: Point, count: number): void {
    const emitter = this.emitter(kind, color);
    // Obergrenze lebender Partikel, damit viele gleichzeitige Treffer nicht bremsen.
    if (emitter.getAliveParticleCount() > MAX_PARTICLES) return;
    emitter.explode(count, at.x, at.y);
  }

  /** Expandierender Leuchtring, der ausblendet. */
  private ring(at: Point, color: number, size: number): void {
    if (this.rings >= MAX_RINGS) return;
    this.rings += 1;
    const glow = this.scene.add
      .image(at.x, at.y, TEXTURE_KEYS.glow)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(19)
      .setScale(0.15)
      .setAlpha(0.9);
    this.scene.tweens.add({
      targets: glow,
      scale: size,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        glow.destroy();
        this.rings -= 1;
      },
    });
  }

  /** Zahl, die am Ziel aufsteigt und verschwindet. */
  private floatNumber(at: Point, value: number, tower: boolean): void {
    if (this.floaters >= MAX_FLOATERS) return;
    this.floaters += 1;
    const text = this.scene.add
      .text(at.x + (tower ? 0 : 6), at.y - 10, `-${value}`, {
        fontFamily: FONTS.heading,
        fontSize: tower ? '16px' : '12px',
        fontStyle: 'bold',
        color: tower ? TEXT.bad : TEXT.gold,
        stroke: TEXT.outline,
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.scene.tweens.add({
      targets: text,
      y: text.y - 22,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        text.destroy();
        this.floaters -= 1;
      },
    });
  }
}
