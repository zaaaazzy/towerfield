/**
 * „Juice“: sichtbares Feedback auf Spielereignisse (Screen-Shake, Hit-Stop, Aufblitzen, Squash & Stretch) und
 * Easing-Kurven. Reine Funktionen ohne Phaser, DOM und Canvas; die Szenen lesen die Werte und zeichnen nur.
 *
 * Eingabe sind die `FxEvent`s aus `fx-events.ts`. Alle Zeiten laufen über `delta` (Millisekunden), nie über Bilder:
 * Dieselbe Spielzeit ergibt bei 30 und bei 144 Bildern pro Sekunde denselben Verlauf. Zufall gibt es nicht, das
 * Wackeln der Kamera ist eine Funktion der verstrichenen Zeit.
 *
 * Hit-Stop betrifft nur die Darstellung: `stepJuice` liefert eine verkürzte Darstellungszeit (`displayDeltaMs`),
 * die Spiellogik (`advance`) bekommt weiter das echte `delta`.
 */
import type { FxEvent } from './fx-events';

/* ---------- Easing ---------- */

/** Begrenzt auf 0 bis 1. */
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Easing-Kurve: bildet Fortschritt 0 bis 1 auf 0 bis 1 ab (`easeOutBack` schwingt kurz darüber). */
export type Easing = (t: number) => number;

export const easeOutQuad: Easing = (t) => {
  const u = 1 - clamp01(t);
  return 1 - u * u;
};

export const easeOutCubic: Easing = (t) => {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
};

export const easeInOutCubic: Easing = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Schießt über das Ziel hinaus (bis etwa 1,1) und federt zurück; für Einblendungen und „Pop“-Effekte. */
export const easeOutBack: Easing = (t) => {
  const overshoot = 1.70158;
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
};

/** Wert zwischen `from` und `to` nach `elapsedMs` von `durationMs`; bei Dauer 0 sofort am Ziel. */
export function tweenValue(from: number, to: number, elapsedMs: number, durationMs: number, ease: Easing = easeOutCubic): number {
  if (durationMs <= 0) return to;
  return from + (to - from) * ease(elapsedMs / durationMs);
}

/* ---------- Einstellungen ---------- */

/** Was sich abschalten lässt. `postFx`: Vignette, Farbkorrektur und Bloom (kostet auf schwachen Geräten Leistung). */
export interface JuiceSettings {
  shake: boolean;
  flash: boolean;
  aberration: boolean;
  hitStop: boolean;
  postFx: boolean;
}

export const JUICE_FULL: JuiceSettings = { shake: true, flash: true, aberration: true, hitStop: true, postFx: true };

/** Bei `prefers-reduced-motion` standardmäßig aus: alles, was wackelt, blitzt oder einfriert. Das ruhige Bild-FX bleibt. */
export const JUICE_REDUCED: JuiceSettings = { shake: false, flash: false, aberration: false, hitStop: false, postFx: true };

const SWITCHES = ['shake', 'flash', 'aberration', 'hitStop', 'postFx'] as const;

/**
 * Einstellungen aus der URL (`?juice=0` schaltet alles ab, `?shake=0`, `?flash=0`, `?aberration=0`, `?hitstop=0`,
 * `?postfx=0` einzeln; `1` schaltet an) auf Basis von `reducedMotion`.
 */
export function parseJuiceSettings(search: string, reducedMotion: boolean): JuiceSettings {
  const params = new URLSearchParams(search);
  const all = params.get('juice');
  const settings: JuiceSettings = { ...(reducedMotion ? JUICE_REDUCED : JUICE_FULL) };
  if (all === '0') return { shake: false, flash: false, aberration: false, hitStop: false, postFx: false };
  if (all === '1') Object.assign(settings, JUICE_FULL);
  for (const key of SWITCHES) {
    const value = params.get(key.toLowerCase());
    if (value === '0') settings[key] = false;
    else if (value === '1') settings[key] = true;
  }
  return settings;
}

/* ---------- Stärke je Ereignis ---------- */

/** Wie kräftig ein Ereignis wirkt. Stärken 0 bis 1, Zeiten in Millisekunden. */
export interface Impact {
  shake: number;
  shakeMs: number;
  hitStopMs: number;
  flash: number;
  aberration: number;
}

export const NO_IMPACT: Impact = { shake: 0, shakeMs: 0, hitStopMs: 0, flash: 0, aberration: 0 };

export const SCREEN_FLASH_MS = 160;
export const ABERRATION_MS = 220;
/** Größter Kameraausschlag in Spielpixeln bei Stärke 1. */
export const MAX_SHAKE_PX = 6;

/** Grundstärken; `explosion` und `tower-down` liegen bewusst über Turm-Treffer und Minion-Tod. */
const IMPACTS = {
  towerDamage: { shake: 0.2, shakeMs: 140, hitStopMs: 30, flash: 0, aberration: 0 },
  minionDeath: { shake: 0.15, shakeMs: 110, hitStopMs: 35, flash: 0, aberration: 0 },
  shieldBlock: { shake: 0.1, shakeMs: 90, hitStopMs: 20, flash: 0, aberration: 0 },
  explosion: { shake: 0.6, shakeMs: 300, hitStopMs: 90, flash: 0.45, aberration: 0.5 },
  towerDown: { shake: 0.8, shakeMs: 380, hitStopMs: 120, flash: 0.4, aberration: 0.7 },
  matchOver: { shake: 0.5, shakeMs: 420, hitStopMs: 150, flash: 0.55, aberration: 0 },
} as const satisfies Record<string, Impact>;

/** Größter Zuschlag auf die Turm-Treffer-Stärke durch hohen Schaden. */
const TOWER_DAMAGE_BONUS_MAX = 0.15;
/** Zuschlag je Lane-Einheit Explosionsradius, gedeckelt bei Stärke 1. */
const EXPLOSION_RADIUS_BONUS = 0.02;

/** Stärke eines einzelnen Ereignisses; Ereignisse ohne Wucht (normaler Minion-Treffer, Heilung, Rundenwechsel) liefern `NO_IMPACT`. */
export function impactFor(event: FxEvent): Impact {
  switch (event.kind) {
    case 'tower-damage':
      return { ...IMPACTS.towerDamage, shake: IMPACTS.towerDamage.shake + Math.min(TOWER_DAMAGE_BONUS_MAX, event.amount * 0.005) };
    case 'minion-death':
      return IMPACTS.minionDeath;
    case 'shield-block':
      return IMPACTS.shieldBlock;
    case 'explosion':
      return { ...IMPACTS.explosion, shake: Math.min(1, IMPACTS.explosion.shake + event.radius * EXPLOSION_RADIUS_BONUS) };
    case 'tower-down':
      return IMPACTS.towerDown;
    case 'match-over':
      return IMPACTS.matchOver;
    default:
      return NO_IMPACT;
  }
}

/** Ein Maß für die Gesamtwucht (zum Vergleichen und für Tests): Wackeln, Stopp, Blitz und Aberration zusammen. */
export function impactStrength(impact: Impact): number {
  return impact.shake + impact.hitStopMs / 200 + impact.flash + impact.aberration;
}

/** Der stärkste Wert je Feld über alle Ereignisse des Bilds (mehrere Treffer addieren sich nicht auf). */
export function strongestImpact(events: readonly FxEvent[]): Impact {
  let result = NO_IMPACT;
  for (const event of events) {
    const impact = impactFor(event);
    result = {
      shake: Math.max(result.shake, impact.shake),
      shakeMs: Math.max(result.shakeMs, impact.shakeMs),
      hitStopMs: Math.max(result.hitStopMs, impact.hitStopMs),
      flash: Math.max(result.flash, impact.flash),
      aberration: Math.max(result.aberration, impact.aberration),
    };
  }
  return result;
}

/** Schaltet abgeschaltete Wirkungen auf 0. */
export function applySettings(impact: Impact, settings: JuiceSettings): Impact {
  return {
    shake: settings.shake ? impact.shake : 0,
    shakeMs: settings.shake ? impact.shakeMs : 0,
    hitStopMs: settings.hitStop ? impact.hitStopMs : 0,
    flash: settings.flash ? impact.flash : 0,
    aberration: settings.aberration ? impact.aberration : 0,
  };
}

/* ---------- Zustand und Fortschreibung ---------- */

/** Ein abklingender Impuls: Anfangsstärke, Restzeit und Gesamtdauer. */
export interface Pulse {
  strength: number;
  remainingMs: number;
  totalMs: number;
}

const IDLE_PULSE: Pulse = { strength: 0, remainingMs: 0, totalMs: 0 };

/** Aktuelle Stärke: fällt vom Anfangswert mit `easeOutQuad` auf 0 (schnell zu Beginn, weich am Ende). */
export function pulseValue(pulse: Pulse): number {
  if (pulse.totalMs <= 0 || pulse.remainingMs <= 0) return 0;
  const progress = 1 - pulse.remainingMs / pulse.totalMs;
  return pulse.strength * (1 - easeOutQuad(progress));
}

/** Startet einen Impuls nur, wenn er den laufenden übertrifft; ein schwacher Treffer unterbricht keine Explosion. */
function startPulse(current: Pulse, strength: number, totalMs: number): Pulse {
  if (strength <= 0 || strength < pulseValue(current)) return current;
  return { strength, remainingMs: totalMs, totalMs };
}

const stepPulse = (pulse: Pulse, deltaMs: number): Pulse =>
  pulse.remainingMs > deltaMs ? { ...pulse, remainingMs: pulse.remainingMs - deltaMs } : IDLE_PULSE;

/** Laufende Effekte der Szene. Hit-Stop zählt in echter Zeit herunter. */
export interface JuiceState {
  shake: Pulse;
  flash: Pulse;
  aberration: Pulse;
  hitStopMs: number;
}

export const newJuice = (): JuiceState => ({ shake: IDLE_PULSE, flash: IDLE_PULSE, aberration: IDLE_PULSE, hitStopMs: 0 });

/** Übernimmt die Wirkung der Ereignisse dieses Bilds (nach Einstellungen). */
export function triggerJuice(state: JuiceState, events: readonly FxEvent[], settings: JuiceSettings): JuiceState {
  const impact = applySettings(strongestImpact(events), settings);
  return {
    shake: startPulse(state.shake, impact.shake, impact.shakeMs),
    flash: startPulse(state.flash, impact.flash, SCREEN_FLASH_MS),
    aberration: startPulse(state.aberration, impact.aberration, ABERRATION_MS),
    hitStopMs: Math.max(state.hitStopMs, impact.hitStopMs),
  };
}

/**
 * Kameraversatz in Pixeln zu Stärke (0 bis 1) und verstrichener Zeit: zwei unterschiedlich schnelle Schwingungen,
 * kein Zufall. Gleiche Zeit ergibt immer denselben Versatz.
 */
export function shakeOffset(strength: number, elapsedMs: number): { x: number; y: number } {
  const amplitude = strength * MAX_SHAKE_PX;
  // `+ 0` macht aus -0 (negativer Sinus mal 0) wieder 0.
  return { x: Math.sin(elapsedMs * 0.11) * amplitude + 0, y: Math.cos(elapsedMs * 0.17) * amplitude + 0 };
}

export interface JuiceStep {
  state: JuiceState;
  /** Zeit für die Darstellung: `deltaMs` abzüglich des Hit-Stops. Die Spiellogik bekommt weiter das volle `deltaMs`. */
  displayDeltaMs: number;
  shake: { x: number; y: number };
  /** Deckkraft des Blitzes, 0 bis 1. */
  flash: number;
  /** Stärke der chromatischen Aberration, 0 bis 1. */
  aberration: number;
}

/** Schreibt alle Effekte um `deltaMs` fort und liefert die Werte für dieses Bild. */
export function stepJuice(state: JuiceState, deltaMs: number): JuiceStep {
  const frozenMs = Math.min(deltaMs, state.hitStopMs);
  const shake = stepPulse(state.shake, deltaMs);
  const flash = stepPulse(state.flash, deltaMs);
  const aberration = stepPulse(state.aberration, deltaMs);
  return {
    state: { shake, flash, aberration, hitStopMs: state.hitStopMs - frozenMs },
    displayDeltaMs: deltaMs - frozenMs,
    shake: shakeOffset(pulseValue(shake), shake.totalMs - shake.remainingMs),
    flash: pulseValue(flash),
    aberration: pulseValue(aberration),
  };
}

/* ---------- Squash & Stretch ---------- */

/** Höchstverformung (Faktoren auf Breite und Höhe) und Dauer, bis die Figur wieder normal ist. */
export interface Squash {
  x: number;
  y: number;
  durationMs: number;
}

/** Laufende Verformung einer Figur. */
export interface SquashRun {
  squash: Squash;
  ageMs: number;
}

type SquashKind = 'summon' | 'minion-damage' | 'minion-heal';

/** Beschwörung streckt hoch, Treffer staucht flach, Heilung hebt leicht an. */
const SQUASHES: Record<SquashKind, Squash> = {
  summon: { x: 0.7, y: 1.35, durationMs: 320 },
  'minion-damage': { x: 1.18, y: 0.82, durationMs: 160 },
  'minion-heal': { x: 0.92, y: 1.12, durationMs: 240 },
};

/** Verformung zu einem Ereignis, `null` bei Ereignissen ohne Figur. */
export function squashFor(event: FxEvent): Squash | null {
  return event.kind in SQUASHES ? SQUASHES[event.kind as SquashKind] : null;
}

/** Gemeinsamer Schlüssel einer Einheit (Besitzer und Id) für Tabellen der Darstellung. */
export const minionKey = (owner: number, minionId: number): string => `${owner}:${minionId}`;

/** Aktueller Skalierungsfaktor: beginnt bei der Höchstverformung und federt mit `easeOutBack` auf 1 (schwingt kurz darüber). */
export function squashScale(run: SquashRun): { x: number; y: number } {
  const k = 1 - easeOutBack(run.ageMs / run.squash.durationMs);
  return { x: 1 + (run.squash.x - 1) * k, y: 1 + (run.squash.y - 1) * k };
}

/** Alter der Verformungen wächst mit `deltaMs`, fertige verschwinden; jedes passende Ereignis startet sie neu. */
export function updateSquashes(
  squashes: ReadonlyMap<string, SquashRun>,
  events: readonly FxEvent[],
  deltaMs: number,
): Map<string, SquashRun> {
  const next = new Map<string, SquashRun>();
  for (const [key, run] of squashes) {
    const ageMs = run.ageMs + deltaMs;
    if (ageMs < run.squash.durationMs) next.set(key, { squash: run.squash, ageMs });
  }
  for (const event of events) {
    if (event.kind === 'summon' || event.kind === 'minion-damage' || event.kind === 'minion-heal') {
      next.set(minionKey(event.owner, event.minionId), { squash: SQUASHES[event.kind], ageMs: 0 });
    }
  }
  return next;
}
