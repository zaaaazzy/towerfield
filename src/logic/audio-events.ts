/**
 * Töne zu Spielereignissen: ordnet FX-Ereignisse (`fx-events.ts`) Sound-Schlüsseln zu, drosselt gleichzeitige Effekte
 * und wählt Tonhöhe und Lautstärke je Ton über den Seed. Ohne Phaser, ohne DOM; Zeit läuft über `delta`.
 */
import type { FxEvent } from './fx-events';
import { nextRandom } from './game-state';

export type SoundKey =
  | 'melee-hit'
  | 'arrow'
  | 'lightning'
  | 'shield-block'
  | 'heal'
  | 'summon'
  | 'minion-death'
  | 'explosion'
  | 'tower-hit'
  | 'tower-down'
  | 'card-play'
  | 'round-start'
  | 'round-end'
  | 'victory'
  | 'defeat';

/** Alle Effekt-Schlüssel; die Szene lädt zu jedem eine Datei `assets/audio/<schlüssel>.wav`. */
export const SOUND_KEYS: readonly SoundKey[] = [
  'melee-hit',
  'arrow',
  'lightning',
  'shield-block',
  'heal',
  'summon',
  'minion-death',
  'explosion',
  'tower-hit',
  'tower-down',
  'card-play',
  'round-start',
  'round-end',
  'victory',
  'defeat',
];

/** Ereignisse für den Ton: alle FX-Ereignisse plus das Ausspielen einer Karte (kein Zustandsunterschied). */
export type AudioEvent = FxEvent | { kind: 'card-play' };

/**
 * Sound-Schlüssel eines Ereignisses (genau einer). `perspective` ist der Spieler, aus dessen Sicht Sieg und Niederlage
 * klingen; ein Unentschieden klingt wie ein Rundenende.
 */
export function soundKeyFor(event: AudioEvent, perspective = 0): SoundKey {
  switch (event.kind) {
    case 'summon':
      return 'summon';
    case 'minion-damage':
      return event.source === 'arrow' ? 'arrow' : event.source === 'lightning' ? 'lightning' : 'melee-hit';
    case 'minion-heal':
      return 'heal';
    case 'minion-death':
      return 'minion-death';
    case 'explosion':
      return 'explosion';
    case 'tower-damage':
      return 'tower-hit';
    case 'tower-down':
      return 'tower-down';
    case 'shield-block':
      return 'shield-block';
    case 'card-play':
      return 'card-play';
    case 'round-start':
      return 'round-start';
    case 'round-end':
      return 'round-end';
    case 'match-over':
      if (event.outcome === 'draw') return 'round-end';
      return event.outcome === (perspective === 0 ? 'player0' : 'player1') ? 'victory' : 'defeat';
  }
}

/** Grenzen der Drosselung: Fenster in Millisekunden, Töne insgesamt und je Schlüssel pro Fenster. */
export const THROTTLE = { windowMs: 250, maxTotal: 6, maxPerKey: 2 } as const;

/** Signale, die nie unter der Gesamtgrenze verloren gehen (Rundenwechsel, Spielende, Turmfall); je Schlüssel gilt sie. */
const PRIORITY: ReadonlySet<SoundKey> = new Set(['round-start', 'round-end', 'victory', 'defeat', 'tower-down']);

/** Wertebereich der Variation: Abspielgeschwindigkeit (Tonhöhe) um ±`RATE_SPREAD`, Lautstärke zwischen `VOLUME_MIN` und 1. */
export const RATE_SPREAD = 0.08;
export const VOLUME_MIN = 0.8;

export interface AudioState {
  /** Zufallszustand für die Variation (siehe `nextRandom`). */
  seed: number;
  /** Zeit seit Beginn in Millisekunden (aus `delta` aufsummiert). */
  nowMs: number;
  /** Zeitpunkte der Töne im aktuellen Fenster. */
  recent: { key: SoundKey; atMs: number }[];
}

/** Ein Ton, den die Szene abspielen soll: Schlüssel, Lautstärkefaktor (0 bis 1) und Abspielgeschwindigkeit. */
export interface SoundPlay {
  key: SoundKey;
  volume: number;
  rate: number;
}

export function createAudioState(seed: number): AudioState {
  return { seed: seed >>> 0, nowMs: 0, recent: [] };
}

/**
 * Ein Bild: lässt `deltaMs` verstreichen, wählt aus den Ereignissen die Töne unter den Drosselgrenzen und würfelt für
 * jeden zugelassenen Ton Tonhöhe und Lautstärke. Verworfene Ereignisse verbrauchen keinen Zufall; dieselben Ereignisse
 * und derselbe Seed ergeben also dieselben Töne.
 */
export function planSounds(
  state: AudioState,
  events: readonly AudioEvent[],
  deltaMs: number,
  perspective = 0,
): { state: AudioState; plays: SoundPlay[] } {
  const nowMs = state.nowMs + Math.max(0, deltaMs);
  const recent = state.recent.filter((entry) => nowMs - entry.atMs < THROTTLE.windowMs);
  let seed = state.seed;
  const plays: SoundPlay[] = [];
  for (const event of events) {
    const key = soundKeyFor(event, perspective);
    if (recent.filter((entry) => entry.key === key).length >= THROTTLE.maxPerKey) continue;
    if (!PRIORITY.has(key) && recent.length >= THROTTLE.maxTotal) continue;
    const rate = nextRandom(seed);
    const volume = nextRandom(rate.seed);
    seed = volume.seed;
    recent.push({ key, atMs: nowMs });
    plays.push({
      key,
      rate: 1 + (rate.value * 2 - 1) * RATE_SPREAD,
      volume: VOLUME_MIN + volume.value * (1 - VOLUME_MIN),
    });
  }
  return { state: { seed, nowMs, recent }, plays };
}
