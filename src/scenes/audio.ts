/**
 * Dünne Phaser-Schicht für Ton: lädt die Audiodateien fehlertolerant, spielt Musikschleife und Effekte ab und zeichnet
 * Regler und Stumm-Schalter. Die Regeln (Zuordnung, Drosselung, Variation, Lautstärken) stehen in
 * `logic/audio-events.ts` und `logic/audio-settings.ts`; hier wird nur gelesen, geschrieben, geladen und abgespielt.
 * Fehlende oder nicht dekodierbare Dateien und ein gesperrter Audiokontext führen zu Stille, nie zu Fehlern.
 */
import Phaser from 'phaser';
import { type AudioEvent, type AudioState, createAudioState, planSounds, SOUND_KEYS } from '../logic/audio-events';
import {
  AUDIO_STORAGE_KEY,
  type AudioSettings,
  effectiveVolumes,
  parseSettings,
  serializeSettings,
  setEffectsVolume,
  setMusicVolume,
  toggleMuted,
  volumeAtPosition,
} from '../logic/audio-settings';
import type { LabelFn } from './labels';
import { drawButton, PALETTE, TEXT } from './theme';

/** Schlüssel des ersten Musikstücks im Audio-Cache. */
export const MUSIC_KEY = 'tavern-loop';
/** Dateien eines Musikstücks, die erste brauchbare gewinnt; Effekte liegen als `assets/audio/<schlüssel>.wav`. */
const musicUrls = (key: string): string[] => ['m4a', 'ogg', 'mp3'].map((ext) => `assets/audio/${key}.${ext}`);
/** Musikstücke, die sich abwechseln; fehlt eines, läuft das andere allein in Schleife. */
const MUSIC_KEYS = [MUSIC_KEY, 'tavern-loop-2'];
const effectUrl = (key: string): string[] => [`assets/audio/${key}.wav`];

/**
 * Audiodatei, die Fehler verschluckt: Holt und dekodiert die erste brauchbare URL selbst. Fehlt die Datei oder lässt sie
 * sich nicht dekodieren, bleibt der Cache-Eintrag leer (Phaser würde dafür `console.error` ausgeben).
 */
class SafeAudioFile extends Phaser.Loader.File {
  private readonly urls: string[];

  constructor(loader: Phaser.Loader.LoaderPlugin, key: string, urls: string[]) {
    // `cache` liest Phaser zur Laufzeit, die Typen kennen das Feld nicht.
    const config = { type: 'safe-audio', cache: loader.cacheManager.audio, key, url: urls[0] };
    super(loader, config as Phaser.Types.Loader.FileConfig);
    this.urls = urls;
  }

  load(): void {
    this.state = Phaser.Loader.FILE_LOADING;
    const context = (this.loader.systems.sound as { context?: AudioContext }).context;
    void firstDecodable(this.urls, context).then((buffer) => {
      this.state = Phaser.Loader.FILE_LOADED;
      if (buffer) this.data = buffer;
      this.loader.nextFile(this, true);
    });
  }
}

async function firstDecodable(urls: string[], context: AudioContext | undefined): Promise<AudioBuffer | null> {
  if (!context) return null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      // Manche Server liefern für unbekannte Pfade die Startseite mit Status 200.
      if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) continue;
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      // Nächste URL probieren; am Ende bleibt es still.
    }
  }
  return null;
}

export function loadSettings(): AudioSettings {
  try {
    return parseSettings(window.localStorage.getItem(AUDIO_STORAGE_KEY));
  } catch {
    return parseSettings(null);
  }
}

function saveSettings(settings: AudioSettings): void {
  try {
    window.localStorage.setItem(AUDIO_STORAGE_KEY, serializeSettings(settings));
  } catch {
    // Speicher gesperrt oder voll: Die Einstellung gilt dann nur für diese Sitzung.
  }
}

type Music = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.NoAudioSound;

export class AudioLayer {
  private settings = loadSettings();
  private state: AudioState;
  private music: Music | null = null;
  private readonly onUnlocked = (): void => this.startMusic();

  /**
   * `seed` für die Variation der Effekte, `musicScale` dämpft die Musik (Replay), `perspective` ist der Spieler, aus
   * dessen Sicht Sieg und Niederlage klingen.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    seed: number,
    private readonly musicScale = 1,
    private readonly perspective = 0,
  ) {
    this.state = createAudioState(seed);
    const sound = scene.sound;
    // Browser sperren Ton bis zur ersten Eingabe: erst dann starten, vorher nichts anfassen (keine Autoplay-Warnung).
    if (sound.locked) sound.once(Phaser.Sound.Events.UNLOCKED, this.onUnlocked);
    else this.startMusic();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stop());
  }

  /** Reiht alle Audiodateien in den `preload()` der Szene ein. */
  static preload(scene: Phaser.Scene): void {
    for (const key of MUSIC_KEYS) scene.load.addFile(new SafeAudioFile(scene.load, key, musicUrls(key)));
    for (const key of SOUND_KEYS) scene.load.addFile(new SafeAudioFile(scene.load, key, effectUrl(key)));
  }

  /** Aktuelle Einstellungen (nur lesen, z. B. für den Smoke-Test). */
  get current(): AudioSettings {
    return this.settings;
  }

  /** Ob die Musikschleife gerade abgespielt wird (nur lesen, z. B. für den Smoke-Test). */
  get musicPlaying(): boolean {
    return this.music?.isPlaying ?? false;
  }

  private startMusic(): void {
    if (this.music) return;
    const keys = MUSIC_KEYS.filter((key) => this.scene.cache.audio.exists(key));
    if (keys.length > 0) this.playTrack(keys, 0);
  }

  /** Spielt ein Stück; bei mehreren folgt nach dessen Ende das nächste, ein einzelnes läuft in Schleife. */
  private playTrack(keys: readonly string[], index: number): void {
    try {
      const music = this.scene.sound.add(keys[index], {
        loop: keys.length === 1,
        volume: effectiveVolumes(this.settings, this.musicScale).music,
      });
      music.once(Phaser.Sound.Events.COMPLETE, () => {
        if (this.music !== music) return;
        music.destroy();
        this.music = null;
        this.playTrack(keys, (index + 1) % keys.length);
      });
      this.music = music;
      music.play();
    } catch {
      this.music = null;
    }
  }

  private stop(): void {
    this.scene.sound.off(Phaser.Sound.Events.UNLOCKED, this.onUnlocked);
    this.music?.destroy();
    this.music = null;
  }

  private change(next: AudioSettings): void {
    this.settings = next;
    saveSettings(next);
    if (this.music) this.music.volume = effectiveVolumes(next, this.musicScale).music;
  }

  toggleMute(): void {
    this.change(toggleMuted(this.settings));
  }

  setMusic(value: number): void {
    this.change(setMusicVolume(this.settings, value));
  }

  setEffects(value: number): void {
    this.change(setEffectsVolume(this.settings, value));
  }

  /** Pro Bild: lässt die Ereignisse durch die Logik laufen und spielt die zugelassenen Töne ab. */
  play(events: readonly AudioEvent[], deltaMs: number): void {
    const planned = planSounds(this.state, events, deltaMs, this.perspective);
    this.state = planned.state;
    const effects = effectiveVolumes(this.settings, this.musicScale).effects;
    if (effects <= 0 || this.scene.sound.locked) return;
    for (const play of planned.plays) {
      if (!this.scene.cache.audio.exists(play.key)) continue;
      try {
        this.scene.sound.play(play.key, { volume: effects * play.volume, rate: play.rate });
      } catch {
        // Ton nicht abspielbar: überspringen.
      }
    }
  }
}

/** Anordnung von Stumm-Schalter und Reglern (Spielkoordinaten) im oberen Rand. */
export const AUDIO_UI = {
  mute: { x: 6, y: 3, width: 66, height: 26 },
  music: { x: 286, y: 2, width: 70, height: 14 },
  effects: { x: 286, y: 16, width: 70, height: 14 },
  /** Schiene des Reglers innerhalb seiner Zeile. */
  trackOffset: 26,
  trackWidth: 40,
};

export type AudioControl = 'mute' | 'music' | 'effects';

const contains = (rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** Welches Bedienelement liegt unter dem Punkt? */
export function audioControlAt(x: number, y: number): AudioControl | null {
  for (const control of ['mute', 'music', 'effects'] as const) if (contains(AUDIO_UI[control], x, y)) return control;
  return null;
}

/** Lautstärke, die ein Zeiger bei `x` auf dem Regler `control` einstellt. */
export function sliderValueAt(control: 'music' | 'effects', x: number): number {
  return volumeAtPosition(x, AUDIO_UI[control].x + AUDIO_UI.trackOffset, AUDIO_UI.trackWidth);
}

/** Zeichnet Stumm-Schalter und die beiden Regler. */
export function drawAudioControls(g: Phaser.GameObjects.Graphics, label: LabelFn, settings: AudioSettings): void {
  const mute = AUDIO_UI.mute;
  drawButton(g, mute, settings.muted ? { top: 0x7a3a3a, bottom: 0x4a1f1f } : { top: 0x4a4570, bottom: 0x2a2548 });
  label(settings.muted ? 'Stumm' : 'Ton an', mute.x + mute.width / 2, mute.y + mute.height / 2, { size: 11 });
  (['music', 'effects'] as const).forEach((control) => {
    const row = AUDIO_UI[control];
    const value = settings[control];
    const centerY = row.y + row.height / 2;
    const left = row.x + AUDIO_UI.trackOffset;
    label(control === 'music' ? 'Musik' : 'FX', row.x + 2, centerY, { size: 8, color: TEXT.dim, origin: 0 });
    g.fillStyle(PALETTE.panelDark, 1).fillRoundedRect(left, centerY - 2, AUDIO_UI.trackWidth, 4, 2);
    g.fillStyle(settings.muted ? PALETTE.disabled : PALETTE.gold, 1).fillRoundedRect(left, centerY - 2, AUDIO_UI.trackWidth * value, 4, 2);
    g.fillStyle(PALETTE.white, 1).fillCircle(left + AUDIO_UI.trackWidth * value, centerY, 4);
  });
}
