/**
 * Lichtschicht über dem Hintergrund: Tönung, flackernde Lichtkegel um die Tower und entlang der Lanes, ziehender Nebel und
 * Glühwürmchen. Die Werte je Runde liefert `logic/ambience.ts`; hier entsteht nur Darstellung.
 * Die Schicht liegt zwischen Hintergrund (Tiefe -100) und dem Spielfeld samt UI (Tiefe 0 und höher), verdeckt also weder
 * Einheiten noch Karten, Knöpfe oder Texte. Alle Bewegung rechnet mit `delta`.
 */
import Phaser from 'phaser';
import {
  advanceDrift,
  type Ambience,
  ambienceForRound,
  blendAmbience,
  type Bounds,
  type Firefly,
  fireflyCount,
  fireflyGlow,
  fireflyStart,
  flickerAt,
  flickerParams,
  type FlickerParams,
  flickerStrength,
  MAX_FIREFLIES,
  stepFirefly,
} from '../logic/ambience';
import { MAX_ROUNDS } from '../logic/match';
import { FIELD } from './field-view';
import { FOG_TEXTURE, ensureTextures, TEXTURE_KEYS } from './textures';
import { LIGHT, LIGHT_STOPS } from './theme';

const DEPTH = -50;
/** Zeitkonstante (ms), mit der die Stimmung beim Rundenwechsel zum neuen Wert gleitet. */
const BLEND_TIME_MS = 900;
/** Deckkraft der Lichtkegel bei Tag (Abend) und bei Nacht. */
const CONE_ALPHA = { min: 0.22, max: 0.55 };
/** Tower-Lichtkegel: Radius in Pixeln; Lane-Licht: Breite und Höhe. */
const TOWER_CONE_RADIUS = 46;
const LANE_CONE = { width: 300, height: 56 };
/** Nebelbänder: Höhe (y), Geschwindigkeit in Pixel pro Sekunde (negativ = nach links), Anteil der Dichte. */
const FOG_BANDS = [
  { y: 110, speed: 5, weight: 1 },
  { y: 270, speed: -3.5, weight: 0.8 },
  { y: 380, speed: 7, weight: 0.6 },
];
/** Höchste Deckkraft eines Nebelbands bei Dichte 1. */
const FOG_ALPHA = 0.6;
const FIREFLY_ALPHA = 0.9;

interface Cone {
  image: Phaser.GameObjects.Image;
  flicker: FlickerParams;
  /** Anteil an der Grunddeckkraft (Lane-Licht ist schwächer als das der Tower). */
  weight: number;
}

export class AmbienceLayer {
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly cones: Cone[] = [];
  private readonly fog: { sprite: Phaser.GameObjects.TileSprite; speed: number; weight: number }[] = [];
  private readonly fireflySprites: Phaser.GameObjects.Image[] = [];
  private fireflies: Firefly[] = [];
  private current: Ambience;
  private target: Ambience;
  private timeMs = 0;

  /** `seed` ist der Match-Seed (Replays sehen so gleich aus), `bounds` die Fläche der Glühwürmchen. */
  constructor(
    scene: Phaser.Scene,
    seed: number,
    round: number,
    private readonly bounds: Bounds,
    view: Bounds,
  ) {
    ensureTextures(scene);
    this.target = ambienceForRound(round, MAX_ROUNDS, LIGHT_STOPS);
    this.current = this.target;
    this.tint = scene.add.rectangle(0, 0, view.width, view.height, this.current.tint, this.current.darkness).setOrigin(0).setDepth(DEPTH);

    const addCone = (x: number, y: number, width: number, height: number, weight: number, index: number) => {
      const image = scene.add
        .image(x, y, TEXTURE_KEYS.lightCone)
        .setDisplaySize(width, height)
        .setDepth(DEPTH + 1)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.cones.push({ image, flicker: flickerParams(seed + index * 7919), weight });
    };
    FIELD.laneCenters.forEach((y, lane) => {
      addCone(FIELD.ownTowerX, y, TOWER_CONE_RADIUS * 2, TOWER_CONE_RADIUS * 2, 1, lane * 3);
      addCone(FIELD.enemyTowerX, y, TOWER_CONE_RADIUS * 2, TOWER_CONE_RADIUS * 2, 1, lane * 3 + 1);
      addCone((FIELD.ownTowerX + FIELD.enemyTowerX) / 2, y, LANE_CONE.width, LANE_CONE.height, 0.5, lane * 3 + 2);
    });

    for (const band of FOG_BANDS) {
      const sprite = scene.add
        .tileSprite(0, band.y, view.width, FOG_TEXTURE.height, TEXTURE_KEYS.fog)
        .setOrigin(0)
        .setDepth(DEPTH + 2)
        .setTint(LIGHT.fogGrey);
      this.fog.push({ sprite, speed: band.speed, weight: band.weight });
    }

    for (let index = 0; index < MAX_FIREFLIES; index += 1) {
      this.fireflies.push(fireflyStart(seed, index, bounds));
      this.fireflySprites.push(
        scene.add
          .image(0, 0, TEXTURE_KEYS.spark)
          .setDepth(DEPTH + 3)
          .setTint(LIGHT.fireflyYellow)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false),
      );
    }
    this.apply();
  }

  /** Aktuelle (geblendete) Stimmung, z. B. für Tests im Browser. */
  get ambience(): Ambience {
    return this.current;
  }

  /** Setzt die Runde, zu der die Stimmung überblendet wird. */
  setRound(round: number): void {
    this.target = ambienceForRound(round, MAX_ROUNDS, LIGHT_STOPS);
  }

  update(deltaMs: number): void {
    this.timeMs += deltaMs;
    this.current = blendAmbience(this.current, this.target, deltaMs, BLEND_TIME_MS);
    for (const band of this.fog) {
      band.sprite.tilePositionX = advanceDrift(band.sprite.tilePositionX, band.speed, deltaMs, FOG_TEXTURE.width);
    }
    this.fireflies = this.fireflies.map((firefly) => stepFirefly(firefly, deltaMs, this.bounds));
    this.apply();
  }

  private apply(): void {
    const ambience = this.current;
    this.tint.setFillStyle(ambience.tint, ambience.darkness);

    const strength = flickerStrength(ambience);
    const base = CONE_ALPHA.min + (CONE_ALPHA.max - CONE_ALPHA.min) * strength;
    for (const cone of this.cones) {
      const flicker = flickerAt(cone.flicker, this.timeMs, strength);
      cone.image.setTint(ambience.color).setAlpha(Math.min(1, base * cone.weight * flicker));
    }

    for (const band of this.fog) band.sprite.setAlpha(ambience.fog * band.weight * FOG_ALPHA);

    const visible = fireflyCount(ambience.fireflies);
    this.fireflySprites.forEach((sprite, index) => {
      const firefly = this.fireflies[index]!;
      sprite.setVisible(index < visible);
      if (index >= visible) return;
      sprite
        .setPosition(firefly.x, firefly.y)
        .setScale(firefly.radius / 4)
        .setAlpha(FIREFLY_ALPHA * fireflyGlow(firefly));
    });
  }
}
