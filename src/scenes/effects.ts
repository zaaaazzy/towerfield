/**
 * Treffer-, Tod- und Beschwörungseffekte: Partikel, Ringe (Tweens) und aufsteigende Schadenszahlen.
 * Je Schadensquelle ein eigener Treffer: Pfeile fliegen im Bogen heran, Nahkämpfer ziehen einen Schwerthieb, Blitze
 * schlagen zickzack ein. Tower splittern wie Holz, Gefallene hinterlassen Staub.
 * Beschwörung steigt als Funkenfontäne auf, Heilung als grüne Lichter, Explosion und Turmzerstörung bekommen
 * zusätzlich einen additiven Lichtfleck; Blitz-Türme glühen dauerhaft (`glowTowers`).
 * Die Szene übergibt die Ereignisse aus `logic/fx-events.ts`; hier entsteht nur Darstellung. Zeiten laufen über
 * `delta` bzw. Phaser-Tweens, Mengen sind begrenzt, damit viele gleichzeitige Treffer nicht bremsen.
 * Wackeln, Blitz und Hit-Stop stehen in `logic/juice.ts` und werden in `main-scene.ts` angewendet.
 */
import Phaser from 'phaser';
import type { DamageSource, FxEvent } from '../logic/fx-events';
import { FONTS, FX_COLOR, LIGHT, PALETTE, TEAM_COLOR, TEXT } from './theme';
import { TEXTURE_KEYS } from './textures';

export interface Point {
  x: number;
  y: number;
}

/** Wie die Szene Ereignisse auf Bildschirmpunkte abbildet. */
export interface Locator {
  minion(owner: number, line: number, position: number, id: number): Point;
  tower(owner: number, line: number, tower: number): Point;
}

/** Schaden wird je Ziel gesammelt und als eine Zahl gezeigt (sonst gäbe es je Tick eine Zahl). */
interface Pending {
  amount: number;
  /** Zeit seit der letzten Zahl bzw. dem ersten Schaden in Millisekunden. */
  age: number;
  sparkCooldown: number;
  point: Point;
  tower: boolean;
  /** Woher der letzte Schaden kam; fehlt bei Towern. */
  source?: DamageSource;
  /** Punkt in Richtung Angreifer (Startpunkt der Pfeile, Seite des Schwerthiebs). */
  from?: Point;
}

const NUMBER_INTERVAL_MS = 450;
const SPARK_INTERVAL_MS = 160;
const PENDING_TIMEOUT_MS = 2000;
const MAX_FLOATERS = 20;
const MAX_RINGS = 24;
const MAX_PARTICLES = 150;
const MAX_STROKES = 24;
/** Kantenlänge der Textur `glow` in Pixeln. */
const GLOW_SIZE = 64;
/** Abstand (Lane-Einheiten), aus dem Pfeile heranfliegen – etwas unter der Reichweite des Bogenschützen (14). */
const ARROW_DISTANCE = 12;
const ARROW_FLIGHT_MS = 220;
const WOOD = FX_COLOR.wood;
const DUST = FX_COLOR.dust;
const STEEL = FX_COLOR.steel;
const BOLT = FX_COLOR.bolt;
/** Größte Zahl gleichzeitiger Licht-Sprites (Glühen bei Blitz, Explosion, Heilung). */
const MAX_LIGHTS = 16;
/** Dauer eines Pulses des Dauerglühens am Blitz-Turm in Millisekunden. */
const LIGHT_PULSE_MS = 900;

const teamColor = (owner: number): number => (owner === 0 ? PALETTE.human : PALETTE.bot);

/**
 * Partikelarten: Leuchtfunken (`hit`, `death`, `down`), aufsteigende Funken bei der Beschwörung (`summon`),
 * langsam schwebende grüne Lichter bei der Heilung (`heal`), Holzsplitter mit Schwerkraft und Staubwolken.
 */
function emitterConfig(kind: string, color: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  const base = { tint: color, emitting: false } as const;
  if (kind === 'summon') {
    return {
      ...base,
      lifespan: { min: 380, max: 650 },
      speed: { min: 35, max: 95 },
      angle: { min: -130, max: -50 },
      gravityY: 60,
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
    };
  }
  if (kind === 'heal') {
    return {
      ...base,
      lifespan: { min: 600, max: 1000 },
      speed: { min: 8, max: 28 },
      angle: { min: -115, max: -65 },
      gravityY: -45,
      scale: { start: 0.8, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: 'ADD',
    };
  }
  if (kind === 'splinter') {
    return {
      ...base,
      lifespan: { min: 350, max: 650 },
      speed: { min: 50, max: 150 },
      angle: { min: 200, max: 340 },
      gravityY: 380,
      rotate: { min: 0, max: 360 },
      scale: { start: 1, end: 0.6 },
      alpha: { start: 1, end: 0 },
    };
  }
  if (kind === 'dust') {
    return {
      ...base,
      lifespan: { min: 500, max: 900 },
      speed: { min: 8, max: 35 },
      scale: { start: 0.8, end: 2.2 },
      alpha: { start: 0.55, end: 0 },
    };
  }
  const big = kind === 'down' || kind === 'death';
  return {
    ...base,
    lifespan: big ? { min: 350, max: 700 } : { min: 200, max: 400 },
    speed: big ? { min: 40, max: 140 } : { min: 25, max: 85 },
    scale: { start: big ? 1.1 : 0.7, end: 0 },
    alpha: { start: 1, end: 0 },
    blendMode: 'ADD',
  };
}

export class Effects {
  private readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly pending = new Map<string, Pending>();
  private floaters = 0;
  private rings = 0;
  private lights = 0;
  /** Dauerglühen der Blitz-Türme (wiederverwendet). */
  private readonly towerGlows: Phaser.GameObjects.Image[] = [];
  /** Lebende Pfeile, Hiebe und Blitze. */
  private strokes = 0;

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
          this.burst('summon', teamColor(event.owner), at, 12);
          this.ring(at, teamColor(event.owner), 1.1);
          this.light(at, teamColor(event.owner), 1.2, 320, 0.5);
          break;
        }
        case 'minion-heal': {
          const at = this.locate.minion(event.owner, event.line, event.position, event.minionId);
          this.burst('heal', FX_COLOR.heal, at, 4);
          this.light(at, FX_COLOR.heal, 1, 420, 0.4);
          break;
        }
        case 'minion-damage':
          this.collect(`m:${event.owner}:${event.minionId}`, event.amount, {
            point: this.locate.minion(event.owner, event.line, event.position, event.minionId),
            tower: false,
            source: event.source,
            from: this.locate.minion(event.owner, event.line, event.position + ARROW_DISTANCE, event.minionId),
          });
          break;
        case 'minion-death': {
          const at = this.locate.minion(event.owner, event.line, event.position, event.minionId);
          this.burst('dust', DUST, at, 10);
          this.burst('death', teamColor(event.owner), at, 8);
          break;
        }
        case 'explosion': {
          const at = this.locate.minion(event.owner, event.line, event.position, event.minionId);
          const edge = this.locate.minion(event.owner, event.line, event.position + event.radius, event.minionId);
          // Der Ring wächst bis zum Radius der Explosion (Textur `glow`: 64 px Durchmesser).
          const size = Math.max(0.5, (Math.abs(edge.x - at.x) * 2) / GLOW_SIZE);
          this.burst('down', PALETTE.gold, at, 24);
          this.burst('death', teamColor(event.owner), at, 14);
          this.ring(at, PALETTE.gold, size);
          this.ring(at, PALETTE.white, size * 0.6);
          this.light(at, LIGHT.emberGlow, size * 1.4, 520, 0.8);
          break;
        }
        case 'tower-damage':
          this.collect(`t:${event.owner}:${event.line}:${event.tower}`, event.amount, {
            point: this.locate.tower(event.owner, event.line, event.tower),
            tower: true,
          });
          break;
        case 'tower-down': {
          const at = this.locate.tower(event.owner, event.line, event.tower);
          this.burst('splinter', WOOD, at, 30);
          this.burst('dust', DUST, at, 18);
          this.burst('down', teamColor(event.owner), at, 12);
          this.light(at, LIGHT.emberCore, 2, 600, 0.7);
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

  private collect(
    key: string,
    amount: number,
    target: { point: Point; tower: boolean; source?: DamageSource; from?: Point },
  ): void {
    const entry = this.pending.get(key);
    if (entry) {
      entry.amount += amount;
      entry.point = target.point;
      entry.source = target.source;
      entry.from = target.from;
      if (entry.sparkCooldown <= 0) this.spark(entry);
      return;
    }
    const created: Pending = { amount, age: 0, sparkCooldown: 0, ...target };
    this.pending.set(key, created);
    this.spark(created);
  }

  /** Sichtbarer Treffer je Quelle; höchstens einer pro Ziel und `SPARK_INTERVAL_MS`. */
  private spark(entry: Pending): void {
    entry.sparkCooldown = SPARK_INTERVAL_MS;
    const at = entry.point;
    if (entry.tower) {
      this.burst('splinter', WOOD, at, 5);
      return;
    }
    switch (entry.source) {
      case 'arrow':
        if (entry.from) this.arrow(entry.from, at);
        break;
      case 'lightning':
        this.bolt(at);
        this.burst('hit', BOLT, at, 4);
        this.light(at, BOLT, 0.9, 200, 0.6);
        break;
      default:
        this.slash(at, entry.from);
        this.burst('hit', STEEL, at, 3);
    }
  }

  private emitter(kind: string, color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const key = `${kind}:${color}`;
    let emitter = this.emitters.get(key);
    if (!emitter) {
      emitter = this.scene.add.particles(0, 0, kind === 'splinter' ? TEXTURE_KEYS.splinter : TEXTURE_KEYS.spark, emitterConfig(kind, color));
      emitter.setDepth(20);
      this.emitters.set(key, emitter);
    }
    return emitter;
  }

  /** Holzpfeil fliegt in flachem Bogen vom Angreifer zum Ziel und splittert dort auf. */
  private arrow(from: Point, to: Point): void {
    if (this.strokes >= MAX_STROKES) return;
    this.strokes += 1;
    const sprite = this.scene.add.image(from.x, from.y, TEXTURE_KEYS.arrow).setDepth(21);
    const lift = Math.min(18, Math.abs(to.x - from.x) * 0.25);
    let lastX = from.x;
    let lastY = from.y;
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ARROW_FLIGHT_MS,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - lift * 4 * t * (1 - t);
        sprite.setPosition(x, y).setRotation(Math.atan2(y - lastY, x - lastX));
        lastX = x;
        lastY = y;
      },
      onComplete: () => {
        sprite.destroy();
        this.strokes -= 1;
        this.burst('splinter', WOOD, to, 3);
      },
    });
  }

  /**
   * Schwerthieb: Das Schwert steht mit dem Griff auf der Seite des Angreifers, schwingt von oben über das Ziel und
   * hinterlässt eine helle Spur.
   */
  private slash(at: Point, from?: Point): void {
    if (this.strokes >= MAX_STROKES) return;
    this.strokes += 1;
    // Richtung vom Angreifer zum Ziel: +1 = nach rechts.
    const dir = from && from.x < at.x ? 1 : -1;
    const hilt = { x: at.x - dir * 14, y: at.y + 2 };
    const toward = dir > 0 ? 0 : Math.PI;
    const raised = toward - dir * 1.3;
    const lowered = toward + dir * 0.5;
    const sword = this.scene.add.image(hilt.x, hilt.y, TEXTURE_KEYS.sword).setOrigin(0.15, 0.5).setDepth(21).setRotation(raised);
    const trail = this.scene.add.graphics({ x: hilt.x, y: hilt.y }).setDepth(20);
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 190,
      ease: 'Quad.easeIn',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const angle = raised + (lowered - raised) * t;
        sword.setRotation(angle);
        const [a, b] = dir > 0 ? [raised, angle] : [angle, raised];
        trail.clear().lineStyle(3, STEEL, 0.5 * (1 - t * 0.5)).beginPath().arc(0, 0, 20, a, b).strokePath();
      },
      onComplete: () => {
        this.scene.tweens.add({
          targets: [sword, trail],
          alpha: 0,
          duration: 120,
          onComplete: () => {
            sword.destroy();
            trail.destroy();
            this.strokes -= 1;
          },
        });
      },
    });
  }

  /** Blitz: kurzer Zickzack von oben ins Ziel. */
  private bolt(at: Point): void {
    if (this.strokes >= MAX_STROKES) return;
    this.strokes += 1;
    const g = this.scene.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
    const points: Point[] = [{ x: at.x + Phaser.Math.Between(-6, 6), y: at.y - 46 }];
    for (let i = 1; i < 5; i += 1) points.push({ x: at.x + Phaser.Math.Between(-7, 7), y: at.y - 46 + (46 * i) / 5 });
    points.push(at);
    g.lineStyle(3, BOLT, 0.5).strokePoints(points);
    g.lineStyle(1, PALETTE.white, 1).strokePoints(points);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 160,
      onComplete: () => {
        g.destroy();
        this.strokes -= 1;
      },
    });
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

  /**
   * Kurzes Licht: additiv gemischter Lichtfleck, der mit ease-out wächst und ausblendet. Sprites mit `ADD` statt
   * Normal-Maps (siehe Abgrenzung des Auftrags).
   */
  private light(at: Point, color: number, size: number, durationMs: number, alpha: number): void {
    if (this.lights >= MAX_LIGHTS) return;
    this.lights += 1;
    const glow = this.scene.add
      .image(at.x, at.y, TEXTURE_KEYS.glow)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(18)
      .setScale(size * 0.6)
      .setAlpha(alpha);
    this.scene.tweens.add({
      targets: glow,
      scale: size * 1.6,
      alpha: 0,
      duration: durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        glow.destroy();
        this.lights -= 1;
      },
    });
  }

  /**
   * Dauerglühen an den Blitz-Türmen: ein weicher Lichtfleck je Turm, der mit der Szenenzeit pulsiert. `points` sind
   * die Bildschirmpunkte der Blitz-Türme dieses Bilds; überzählige Sprites werden ausgeblendet.
   */
  glowTowers(points: readonly Point[], timeMs: number): void {
    while (this.towerGlows.length < points.length) {
      this.towerGlows.push(
        this.scene.add.image(0, 0, TEXTURE_KEYS.glow).setTint(TEAM_COLOR.markLightning).setBlendMode(Phaser.BlendModes.ADD).setDepth(17),
      );
    }
    const pulse = 0.5 + 0.5 * Math.sin((timeMs / LIGHT_PULSE_MS) * Math.PI * 2);
    this.towerGlows.forEach((glow, index) => {
      const point = points[index];
      glow.setVisible(point !== undefined);
      if (point) glow.setPosition(point.x, point.y).setScale(0.9 + 0.25 * pulse).setAlpha(0.25 + 0.2 * pulse);
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
