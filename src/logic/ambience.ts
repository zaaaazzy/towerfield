/**
 * Lichtstimmung über die Runden: von goldenem Abendlicht (Runde 1) zur Fackelnacht (letzte Runde).
 * Reine Funktionen ohne Phaser, DOM und Canvas; die Szene (`scenes/ambience-layer.ts`) zeichnet nur, was hier berechnet wird.
 * Zufall läuft über einen Seed (`nextRandom`), Bewegung und Überblendung über `delta`.
 */
import { clamp, nextRandom } from './game-state';

/** Farbstützpunkte der Stimmung als 0xRRGGBB (die Szene übergibt `LIGHT_STOPS` aus `scenes/theme.ts`). */
export interface LightStops {
  /** Abendgold: Licht und Tönung in Runde 1. */
  gold: number;
  /** Dämmerviolett: Tönung in der Mitte. */
  dusk: number;
  /** Nachtblau: Tönung in der letzten Runde. */
  night: number;
  /** Fackelorange: Lichtfarbe in der letzten Runde. */
  torch: number;
}

/** Standardwerte, gleich den Licht-Tokens in `scenes/theme.ts` (dort gepflegt). */
export const DEFAULT_LIGHT_STOPS: LightStops = { gold: 0xf2b84b, dusk: 0x5b3a8e, night: 0x0d1536, torch: 0xff8a2b };

export interface Ambience {
  /** Lichtfarbe der Lichtkegel (Gold bis Fackelorange). */
  color: number;
  /** Farbe der Tönung über dem Spielfeld (Gold, Violett, Nachtblau). */
  tint: number;
  /** Deckkraft der Tönung, 0 bis `MAX_DARKNESS`. */
  darkness: number;
  /** Nebeldichte, 0 bis 1. */
  fog: number;
  /** Anteil der Glühwürmchen an `MAX_FIREFLIES`, 0 bis 1. */
  fireflies: number;
}

/** Obergrenze der Abdunklung, damit Karten, Einheiten und Texte lesbar bleiben. */
export const MAX_DARKNESS = 0.5;
export const MIN_DARKNESS = 0.06;
export const MIN_FOG = 0.08;
export const MAX_FOG = 0.7;
export const MIN_FIREFLIES = 0.1;
/** Höchste Zahl gleichzeitiger Glühwürmchen. */
export const MAX_FIREFLIES = 24;

/** Mischt zwei Farben (0xRRGGBB) kanalweise; `t` wird auf 0..1 begrenzt. */
export function mixColor(from: number, to: number, t: number): number {
  const k = clamp(t, 0, 1);
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * k);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Fortschritt 0..1 der Runde im Match; ungültige Eingaben und `maxRounds <= 1` ergeben 0. */
export function ambienceProgress(round: number, maxRounds: number): number {
  if (!Number.isFinite(round) || !Number.isFinite(maxRounds) || maxRounds <= 1) return 0;
  return clamp((round - 1) / (maxRounds - 1), 0, 1);
}

/** Werte der Lichtstimmung für eine Runde; alle Werte wachsen stetig und monoton mit der Runde. */
export function ambienceForRound(round: number, maxRounds: number, stops: LightStops = DEFAULT_LIGHT_STOPS): Ambience {
  const t = ambienceProgress(round, maxRounds);
  const eased = t * t * (3 - 2 * t);
  const tint = t < 0.5 ? mixColor(stops.gold, stops.dusk, t * 2) : mixColor(stops.dusk, stops.night, (t - 0.5) * 2);
  return {
    color: mixColor(stops.gold, stops.torch, t),
    tint,
    darkness: MIN_DARKNESS + (MAX_DARKNESS - MIN_DARKNESS) * eased,
    fog: MIN_FOG + (MAX_FOG - MIN_FOG) * t,
    fireflies: MIN_FIREFLIES + (1 - MIN_FIREFLIES) * t,
  };
}

/** Zahl der sichtbaren Glühwürmchen für einen Anteil (0..1), höchstens `MAX_FIREFLIES`. */
export function fireflyCount(share: number): number {
  return Math.round(clamp(share, 0, 1) * MAX_FIREFLIES);
}

/** Blendet die Stimmung weich zum Ziel: exponentiell mit Zeitkonstante `tauMs`, unabhängig von der Bildrate. */
export function blendAmbience(current: Ambience, target: Ambience, deltaMs: number, tauMs: number): Ambience {
  const k = deltaMs <= 0 ? 0 : tauMs <= 0 ? 1 : 1 - Math.exp(-deltaMs / tauMs);
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    color: mixColor(current.color, target.color, k),
    tint: mixColor(current.tint, target.tint, k),
    darkness: mix(current.darkness, target.darkness),
    fog: mix(current.fog, target.fog),
    fireflies: mix(current.fireflies, target.fireflies),
  };
}

/** Verschiebt `offset` um `speed` (Pixel pro Sekunde) und hält ihn in 0..period (Nebel, der im Kreis zieht). */
export function advanceDrift(offset: number, speed: number, deltaMs: number, period: number): number {
  if (period <= 0) return 0;
  const next = (offset + (speed * deltaMs) / 1000) % period;
  return next < 0 ? next + period : next;
}

/** Feste Parameter eines Fackelflackerns: drei Schwingungen mit eigener Frequenz und Phase. */
export interface FlickerParams {
  freq: [number, number, number];
  phase: [number, number, number];
}

/** Leitet die Flackerparameter aus dem Seed ab (gleicher Seed, gleiche Parameter). */
export function flickerParams(seed: number): FlickerParams {
  const params: FlickerParams = { freq: [0, 0, 0], phase: [0, 0, 0] };
  let state = seed;
  for (let index = 0; index < 3; index += 1) {
    const f = nextRandom(state);
    const p = nextRandom(f.seed);
    state = p.seed;
    // Grundfrequenzen um 2, 5 und 11 Hz, je bis zu 40 % verschoben.
    params.freq[index] = [2, 5, 11][index]! * (0.8 + f.value * 0.4) * Math.PI * 2;
    params.phase[index] = p.value * Math.PI * 2;
  }
  return params;
}

/** Fackel-Helligkeit zur Zeit `timeMs`: um 1 herum, Ausschlag höchstens `0.35 * strength` (`strength` 0..1). */
export function flickerAt(params: FlickerParams, timeMs: number, strength: number): number {
  const seconds = timeMs / 1000;
  const wave =
    0.5 * Math.sin(params.freq[0] * seconds + params.phase[0]) +
    0.3 * Math.sin(params.freq[1] * seconds + params.phase[1]) +
    0.2 * Math.sin(params.freq[2] * seconds + params.phase[2]);
  return 1 + 0.35 * clamp(strength, 0, 1) * wave;
}

/** Stärke des Flackerns: gering am Abend, stark in der Fackelnacht (aus der Abdunklung abgeleitet). */
export function flickerStrength(ambience: Ambience): number {
  return clamp((ambience.darkness - MIN_DARKNESS) / (MAX_DARKNESS - MIN_DARKNESS), 0, 1) * 0.8 + 0.2;
}

export interface Bounds {
  width: number;
  height: number;
}

/** Ein Glühwürmchen: Ort, Geschwindigkeit (Pixel pro Sekunde), Pulsphase und -dauer, Radius. */
export interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  periodMs: number;
  radius: number;
}

/** Startwerte des `index`-ten Glühwürmchens; hängt nur von Seed, Index und Fläche ab. */
export function fireflyStart(seed: number, index: number, bounds: Bounds): Firefly {
  let state = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  const draw = (): number => {
    const next = nextRandom(state);
    state = next.seed;
    return next.value;
  };
  const x = draw() * bounds.width;
  const y = draw() * bounds.height;
  const angle = draw() * Math.PI * 2;
  const speed = 4 + draw() * 8;
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    phase: draw() * Math.PI * 2,
    periodMs: 1800 + draw() * 2400,
    radius: 1.5 + draw() * 1.5,
  };
}

/** Bewegt ein Glühwürmchen um `deltaMs`; am Rand taucht es auf der Gegenseite wieder auf. */
export function stepFirefly(firefly: Firefly, deltaMs: number, bounds: Bounds): Firefly {
  return {
    ...firefly,
    x: advanceDrift(firefly.x, firefly.vx, deltaMs, bounds.width),
    y: advanceDrift(firefly.y, firefly.vy, deltaMs, bounds.height),
    phase: firefly.phase + (deltaMs * Math.PI * 2) / firefly.periodMs,
  };
}

/** Leuchtkraft 0..1 des Glühwürmchens: sanftes Pulsieren über die Pulsphase. */
export function fireflyGlow(firefly: Firefly): number {
  return 0.5 + 0.5 * Math.sin(firefly.phase);
}
