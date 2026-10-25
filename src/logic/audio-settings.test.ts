import { describe, expect, it } from 'vitest';
import {
  AUDIO_STORAGE_KEY,
  clampVolume,
  DEFAULT_AUDIO_SETTINGS,
  effectiveVolumes,
  normalizeSettings,
  parseSettings,
  REPLAY_MUSIC_SCALE,
  serializeSettings,
  setEffectsVolume,
  setMusicVolume,
  toggleMuted,
  volumeAtPosition,
} from './audio-settings';

describe('clampVolume', () => {
  it('begrenzt Werte auf 0 bis 1', () => {
    expect(clampVolume(0.4, 1)).toBe(0.4);
    expect(clampVolume(-3, 1)).toBe(0);
    expect(clampVolume(7, 0)).toBe(1);
    expect(clampVolume(Infinity, 0)).toBe(1);
    expect(clampVolume(-Infinity, 1)).toBe(0);
  });

  it('nimmt für fehlende oder ungültige Werte den (selbst begrenzten) Ersatzwert', () => {
    expect(clampVolume(undefined, 0.3)).toBe(0.3);
    expect(clampVolume(NaN, 0.3)).toBe(0.3);
    expect(clampVolume('laut', 0.3)).toBe(0.3);
    expect(clampVolume(null, 0.3)).toBe(0.3);
    expect(clampVolume(undefined, 5)).toBe(1);
    expect(clampVolume(undefined, NaN)).toBe(0);
  });
});

describe('normalizeSettings', () => {
  it('liefert Standardwerte für fehlende oder falsche Eingaben', () => {
    for (const raw of [undefined, null, 5, 'x', []]) expect(normalizeSettings(raw)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('begrenzt ungültige Lautstärken und ersetzt fehlende durch Standardwerte', () => {
    expect(normalizeSettings({ music: 9, effects: -1, muted: true })).toEqual({ music: 1, effects: 0, muted: true });
    expect(normalizeSettings({ music: 'a' })).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('wertet muted nur bei true als stumm', () => {
    expect(normalizeSettings({ muted: 'true' }).muted).toBe(false);
    expect(normalizeSettings({ muted: 1 }).muted).toBe(false);
  });
});

describe('Speichern und Lesen', () => {
  it('liest, was serializeSettings schreibt', () => {
    const settings = { music: 0.25, effects: 0.75, muted: true };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });

  it('fällt bei fehlendem oder kaputtem Text auf die Standardwerte zurück', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseSettings('{kaputt')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('begrenzt gespeicherte Werte außerhalb des Bereichs beim Lesen', () => {
    expect(parseSettings('{"music":3,"effects":-2}')).toEqual({ music: 1, effects: 0, muted: false });
  });

  it('schreibt auch aus ungültigen Einstellungen gültigen Text', () => {
    const text = serializeSettings({ music: 4, effects: NaN, muted: false });
    expect(JSON.parse(text)).toEqual({ music: 1, effects: DEFAULT_AUDIO_SETTINGS.effects, muted: false });
  });

  it('hat einen festen Speicherschlüssel', () => {
    expect(AUDIO_STORAGE_KEY).toBe('towerfield.audio');
  });
});

describe('Regler und Stumm-Schalter', () => {
  it('ändern Musik und Effekte unabhängig voneinander', () => {
    const start = { music: 0.5, effects: 0.5, muted: false };
    expect(setMusicVolume(start, 0.9)).toEqual({ music: 0.9, effects: 0.5, muted: false });
    expect(setEffectsVolume(start, 0.1)).toEqual({ music: 0.5, effects: 0.1, muted: false });
  });

  it('begrenzen neue Werte und behalten den alten bei NaN', () => {
    const start = { music: 0.5, effects: 0.5, muted: false };
    expect(setMusicVolume(start, 3).music).toBe(1);
    expect(setEffectsVolume(start, -3).effects).toBe(0);
    expect(setMusicVolume(start, NaN).music).toBe(0.5);
  });

  it('schaltet stumm und wieder an, ohne die Lautstärken zu verlieren', () => {
    const start = { music: 0.3, effects: 0.6, muted: false };
    const muted = toggleMuted(start);
    expect(muted.muted).toBe(true);
    expect(effectiveVolumes(muted)).toEqual({ music: 0, effects: 0 });
    const back = toggleMuted(muted);
    expect(back).toEqual(start);
    expect(effectiveVolumes(back)).toEqual({ music: 0.3, effects: 0.6 });
  });

  it('dämpft die Musik im Replay, nicht die Effekte', () => {
    const volumes = effectiveVolumes({ music: 0.5, effects: 0.8, muted: false }, REPLAY_MUSIC_SCALE);
    expect(volumes.music).toBeCloseTo(0.5 * REPLAY_MUSIC_SCALE);
    expect(volumes.effects).toBe(0.8);
    expect(effectiveVolumes({ music: 1, effects: 1, muted: false }, 5).music).toBe(1);
  });
});

describe('volumeAtPosition', () => {
  it('rechnet die Zeigerposition auf dem Regler in 0 bis 1 um', () => {
    expect(volumeAtPosition(150, 100, 100)).toBe(0.5);
    expect(volumeAtPosition(50, 100, 100)).toBe(0);
    expect(volumeAtPosition(500, 100, 100)).toBe(1);
  });

  it('liefert 0 bei ungültiger Breite oder Position', () => {
    expect(volumeAtPosition(10, 0, 0)).toBe(0);
    expect(volumeAtPosition(10, 0, NaN)).toBe(0);
    expect(volumeAtPosition(NaN, 0, 100)).toBe(0);
  });
});
