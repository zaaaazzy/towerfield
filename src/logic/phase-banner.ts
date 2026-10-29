/**
 * Banner für Rundenstart, Rundenende und Spielende: Texte, Farbton und Dauer je Ereignis sowie der zeitliche Ablauf
 * (Einfahren, Halten, Ausfahren) aus `delta`. Ohne Phaser, DOM und Canvas, ohne Zufall und Systemzeit; die Szene
 * (`banner-view.ts`) zeichnet nur, was hier berechnet wird.
 */
import type { FxEvent } from './fx-events';
import { type MatchState, MAX_ROUNDS, type Outcome } from './match';
import { getRoundEventDef, isEventRound } from './round-events';

/** Farbton des Banners: Rundenwechsel neutral, Ereignisrunde als Ereignis, Spielende nach Ausgang des Menschen. */
export type BannerTone = 'round' | 'event' | 'victory' | 'defeat' | 'draw';

export interface Banner {
  title: string;
  /** Leer, wenn es nichts zu sagen gibt. */
  subtitle: string;
  tone: BannerTone;
  /** Gesamtdauer von Einfahren bis Ausfahren in Millisekunden. */
  durationMs: number;
}

/** Der Mensch ist Spieler 0; sein Ausgang bestimmt Titel und Farbton des Spielendes. */
const HUMAN_WINS: Outcome = 'player0';

/** Feste Dauer je Ereignisart. */
export const BANNER_DURATION_MS = { 'round-start': 1800, 'round-end': 900, 'match-over': 2400 } as const;
/** Zeit für Ein- und Ausfahren; der Rest der Dauer ist die Haltezeit. */
export const BANNER_SLIDE_MS = 240;

/** Banner zu einem Ereignis des Zustandswechsels, oder `null`, wenn das Ereignis keines braucht. */
export function bannerFor(event: FxEvent, state: MatchState): Banner | null {
  switch (event.kind) {
    case 'round-start': {
      const named = isEventRound(event.round) && state.event !== null;
      return {
        title: `Runde ${event.round}`,
        subtitle: named ? getRoundEventDef(state.event!).name : `von ${MAX_ROUNDS}`,
        tone: named ? 'event' : 'round',
        durationMs: BANNER_DURATION_MS['round-start'],
      };
    }
    case 'round-end':
      return {
        title: `Runde ${event.round} beendet`,
        subtitle: '',
        tone: 'round',
        durationMs: BANNER_DURATION_MS['round-end'],
      };
    case 'match-over': {
      const mine = event.outcome === 'draw' ? 'draw' : event.outcome === HUMAN_WINS ? 'victory' : 'defeat';
      const title = { victory: 'Sieg', defeat: 'Niederlage', draw: 'Unentschieden' }[mine];
      return { title, subtitle: '', tone: mine, durationMs: BANNER_DURATION_MS['match-over'] };
    }
    default:
      return null;
  }
}

/** Laufendes Banner: vergangene Zeit seit dem Start. */
export interface BannerRun {
  banner: Banner;
  elapsedMs: number;
}

export function startBanner(banner: Banner): BannerRun {
  return { banner, elapsedMs: 0 };
}

/** Schreibt die Zeit fort; `null`, sobald die Dauer erreicht ist. */
export function advanceBanner(run: BannerRun, deltaMs: number): BannerRun | null {
  const elapsedMs = run.elapsedMs + Math.max(0, deltaMs);
  return elapsedMs >= run.banner.durationMs ? null : { banner: run.banner, elapsedMs };
}

/** Überspringen (Tippen): das Banner springt an den Beginn des Ausfahrens, falls es noch nicht dort ist. */
export function skipBanner(run: BannerRun): BannerRun {
  const outStart = run.banner.durationMs - BANNER_SLIDE_MS;
  return run.elapsedMs >= outStart ? run : { banner: run.banner, elapsedMs: outStart };
}

/** Sichtbarkeit 0 (draußen) bis 1 (voll da) mit weichem Verlauf; dient als Einfahr- und Ausfahrfortschritt. */
export function bannerSlide(run: BannerRun): number {
  const { elapsedMs, banner } = run;
  const t = Math.min(elapsedMs, banner.durationMs - elapsedMs) / BANNER_SLIDE_MS;
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
