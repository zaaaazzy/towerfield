import Phaser from 'phaser';
import { FONTS, TEXT } from './theme';

export interface LabelOptions {
  size?: number;
  color?: string;
  origin?: number;
  width?: number;
  /** `heading` (Serifenschrift für Titel und Namen) oder `body` (Standard). */
  font?: keyof typeof FONTS;
  bold?: boolean;
  alpha?: number;
  /** Dicke der dunklen Kontur; 0 schaltet sie ab. */
  stroke?: number;
}

/** Tiefe der Beschriftungen: über Grafik und Hintergrund, unter Effekten. */
const LABEL_DEPTH = 10;

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
      // Auflösung 2: schärfere Schrift bei Skalierung auf hochauflösende Bildschirme.
      object = this.scene.add.text(0, 0, '', { fontFamily: FONTS.body, align: 'center', resolution: 2 });
      object.setDepth(LABEL_DEPTH);
      this.texts.push(object);
    }
    this.cursor += 1;
    object
      .setText(text)
      .setPosition(x, y)
      .setFontFamily(FONTS[options.font ?? 'body'])
      .setFontStyle(options.bold ? 'bold' : '')
      .setFontSize(options.size ?? 12)
      .setColor(options.color ?? TEXT.main)
      .setStroke(TEXT.outline, options.stroke ?? 2)
      .setAlpha(options.alpha ?? 1)
      .setOrigin(options.origin ?? 0.5, 0.5)
      .setWordWrapWidth(options.width ?? 0)
      .setVisible(true);
  }

  hideUnused(): void {
    for (let index = this.cursor; index < this.texts.length; index += 1) this.texts[index]!.setVisible(false);
  }
}

export type LabelFn = LabelPool['label'];
