/**
 * Audio-Einstellungen: Lautstärke für Musik und Effekte (je 0 bis 1) und Stumm-Schalter. Ohne Phaser und ohne DOM:
 * Die Szene liest und schreibt nur den Text im `localStorage`; Validierung, Begrenzung und Umrechnung stehen hier.
 */

export interface AudioSettings {
  music: number;
  effects: number;
  muted: boolean;
}

/** Schlüssel im `localStorage`. */
export const AUDIO_STORAGE_KEY = 'towerfield.audio';

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { music: 0.5, effects: 0.8, muted: false };

/** Anteil der Musiklautstärke im Replay (dort läuft sie leiser, damit die Effekte tragen). */
export const REPLAY_MUSIC_SCALE = 0.4;

/**
 * Begrenzt eine Lautstärke auf 0 bis 1. Was keine endliche Zahl ist (fehlend, Text, NaN), ergibt `fallback`;
 * ±Unendlich wird auf die Grenze gesetzt.
 */
export function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return clampVolume(fallback, 0);
  return Math.min(1, Math.max(0, value));
}

/** Macht aus beliebigen Daten (z. B. gelesenem JSON) gültige Einstellungen; fehlende Felder bekommen Standardwerte. */
export function normalizeSettings(raw: unknown): AudioSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    music: clampVolume(source.music, DEFAULT_AUDIO_SETTINGS.music),
    effects: clampVolume(source.effects, DEFAULT_AUDIO_SETTINGS.effects),
    muted: source.muted === true,
  };
}

/** Liest den gespeicherten Text; `null`, kaputtes JSON oder falsche Typen ergeben die Standardwerte bzw. Teilwerte. */
export function parseSettings(text: string | null): AudioSettings {
  if (text === null) return normalizeSettings(undefined);
  try {
    return normalizeSettings(JSON.parse(text));
  } catch {
    return normalizeSettings(undefined);
  }
}

export function serializeSettings(settings: AudioSettings): string {
  return JSON.stringify(normalizeSettings(settings));
}

export function setMusicVolume(settings: AudioSettings, value: number): AudioSettings {
  return { ...settings, music: clampVolume(value, settings.music) };
}

export function setEffectsVolume(settings: AudioSettings, value: number): AudioSettings {
  return { ...settings, effects: clampVolume(value, settings.effects) };
}

export function toggleMuted(settings: AudioSettings): AudioSettings {
  return { ...settings, muted: !settings.muted };
}

/** Tatsächliche Lautstärken: stumm ergibt 0 für beide; `musicScale` dämpft die Musik (Replay). */
export function effectiveVolumes(settings: AudioSettings, musicScale = 1): { music: number; effects: number } {
  if (settings.muted) return { music: 0, effects: 0 };
  return { music: clampVolume(settings.music * musicScale, 0), effects: clampVolume(settings.effects, 0) };
}

/** Lautstärke aus der Position `x` auf einem Regler, der bei `left` beginnt und `width` breit ist. */
export function volumeAtPosition(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return clampVolume((x - left) / width, 0);
}
