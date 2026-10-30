import { describe, expect, it } from 'vitest';
import type { FxEvent } from './fx-events';
import {
  ABERRATION_MS,
  applySettings,
  clamp01,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  impactFor,
  impactStrength,
  JUICE_FULL,
  JUICE_REDUCED,
  MAX_SHAKE_PX,
  minionKey,
  newJuice,
  NO_IMPACT,
  parseJuiceSettings,
  pulseValue,
  SCREEN_FLASH_MS,
  shakeOffset,
  squashFor,
  squashScale,
  stepJuice,
  strongestImpact,
  triggerJuice,
  tweenValue,
  updateSquashes,
} from './juice';

const hit: FxEvent = { kind: 'minion-damage', owner: 0, minionId: 1, line: 0, position: 40, amount: 5, source: 'melee' };
const towerHit: FxEvent = { kind: 'tower-damage', owner: 1, line: 0, tower: 0, amount: 10 };
const death: FxEvent = { kind: 'minion-death', owner: 0, minionId: 1, line: 0, position: 40 };
const explosion: FxEvent = { kind: 'explosion', owner: 0, minionId: 2, line: 0, position: 40, radius: 8 };
const towerDown: FxEvent = { kind: 'tower-down', owner: 1, line: 0, tower: 0 };
const matchOver: FxEvent = { kind: 'match-over', outcome: 'player0' };
const summon: FxEvent = { kind: 'summon', owner: 0, minionId: 3, line: 0, position: 10 };
const heal: FxEvent = { kind: 'minion-heal', owner: 0, minionId: 4, line: 0, position: 12, amount: 3 };

describe('Easing', () => {
  it('beginnt bei 0 und endet bei 1', () => {
    for (const ease of [easeOutQuad, easeOutCubic, easeInOutCubic, easeOutBack]) {
      expect(ease(0)).toBeCloseTo(0, 10);
      expect(ease(1)).toBeCloseTo(1, 10);
    }
  });

  it('begrenzt den Fortschritt auf 0 bis 1', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('ease-out startet schnell: in der Mitte schon über der Hälfte', () => {
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75, 10);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
  });

  it('ease-in-out ist symmetrisch um die Mitte', () => {
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 10);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 10);
  });

  it('back-out schießt über 1 hinaus und kehrt zurück', () => {
    expect(easeOutBack(0.6)).toBeGreaterThan(1);
    expect(easeOutBack(0.6)).toBeLessThan(1.15);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
  });

  it('tweenValue interpoliert nach Zeit und springt bei Dauer 0 ans Ziel', () => {
    expect(tweenValue(10, 20, 0, 100)).toBe(10);
    expect(tweenValue(10, 20, 100, 100)).toBe(20);
    expect(tweenValue(10, 20, 50, 100, (t) => t)).toBe(15);
    expect(tweenValue(10, 20, 50, 100)).toBeGreaterThan(15);
    expect(tweenValue(10, 20, 0, 0)).toBe(20);
  });
});

describe('parseJuiceSettings', () => {
  it('ist ohne Parameter voll an, bei reduzierter Bewegung ohne Shake, Flash, Aberration und Hit-Stop', () => {
    expect(parseJuiceSettings('', false)).toEqual(JUICE_FULL);
    expect(parseJuiceSettings('?seed=3', true)).toEqual(JUICE_REDUCED);
    expect(JUICE_REDUCED).toMatchObject({ shake: false, flash: false, aberration: false });
  });

  it('juice=0 schaltet alles ab, juice=1 hebt die reduzierte Bewegung auf', () => {
    expect(parseJuiceSettings('?juice=0', false)).toEqual({ shake: false, flash: false, aberration: false, hitStop: false, postFx: false });
    expect(parseJuiceSettings('?juice=1', true)).toEqual(JUICE_FULL);
  });

  it('einzelne Schalter lassen sich aus- und einschalten, unbekannte Werte zählen nicht', () => {
    expect(parseJuiceSettings('?shake=0&aberration=0&postfx=0&hitstop=0&flash=0', false)).toEqual({
      shake: false,
      flash: false,
      aberration: false,
      hitStop: false,
      postFx: false,
    });
    expect(parseJuiceSettings('?shake=1&flash=1', true)).toMatchObject({ shake: true, flash: true, aberration: false });
    expect(parseJuiceSettings('?shake=vielleicht', false).shake).toBe(true);
  });
});

describe('impactFor', () => {
  it('ein normaler Minion-Treffer und Rundenereignisse haben keine Wucht', () => {
    expect(impactFor(hit)).toEqual(NO_IMPACT);
    expect(impactFor({ kind: 'round-start', round: 1 })).toEqual(NO_IMPACT);
    expect(impactFor(heal)).toEqual(NO_IMPACT);
  });

  it('ein Turm-Treffer löst Screen-Shake und Hit-Stop aus, größerer Schaden wackelt stärker', () => {
    const small = impactFor({ ...towerHit, amount: 1 } as FxEvent);
    const big = impactFor({ ...towerHit, amount: 500 } as FxEvent);
    expect(small.shake).toBeGreaterThan(0);
    expect(small.hitStopMs).toBeGreaterThan(0);
    expect(big.shake).toBeGreaterThan(small.shake);
    expect(big.shake).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it('Explosion und tower-down sind stärker als ein Turm-Treffer, Minion-Tod und normaler Treffer', () => {
    const base = Math.max(impactStrength(impactFor(hit)), impactStrength(impactFor(towerHit)), impactStrength(impactFor(death)));
    expect(impactStrength(impactFor(explosion))).toBeGreaterThan(base);
    expect(impactStrength(impactFor(towerDown))).toBeGreaterThan(base);
    expect(impactStrength(impactFor(explosion))).toBeGreaterThan(impactStrength(impactFor(hit)));
    expect(impactStrength(impactFor(towerDown))).toBeGreaterThan(impactStrength(impactFor(hit)));
    expect(impactFor(explosion).shake).toBeGreaterThan(impactFor(towerHit).shake);
    expect(impactFor(towerDown).shake).toBeGreaterThan(impactFor(explosion).shake);
  });

  it('der Explosionsradius verstärkt das Wackeln bis höchstens 1', () => {
    const small = impactFor({ ...explosion, radius: 2 } as FxEvent).shake;
    const large = impactFor({ ...explosion, radius: 12 } as FxEvent).shake;
    expect(large).toBeGreaterThan(small);
    expect(impactFor({ ...explosion, radius: 1000 } as FxEvent).shake).toBe(1);
  });

  it('Minion-Tod, Schildblock und Spielende haben je eigene Wucht', () => {
    expect(impactFor(death).shake).toBeGreaterThan(0);
    expect(impactFor({ kind: 'shield-block', owner: 0, line: 0, tower: 0 }).hitStopMs).toBeGreaterThan(0);
    expect(impactFor(matchOver).flash).toBeGreaterThan(0);
  });
});

describe('strongestImpact und applySettings', () => {
  it('ohne Ereignisse keine Wucht, sonst der Höchstwert je Feld', () => {
    expect(strongestImpact([])).toEqual(NO_IMPACT);
    const merged = strongestImpact([towerHit, explosion, death]);
    expect(merged.shake).toBe(impactFor(explosion).shake);
    expect(merged.hitStopMs).toBe(impactFor(explosion).hitStopMs);
    expect(merged.shakeMs).toBe(impactFor(explosion).shakeMs);
  });

  it('abgeschaltete Wirkungen werden 0', () => {
    const impact = impactFor(towerDown);
    expect(applySettings(impact, JUICE_FULL)).toEqual(impact);
    const off = applySettings(impact, { ...JUICE_FULL, shake: false, flash: false, aberration: false, hitStop: false });
    expect(off).toEqual(NO_IMPACT);
  });
});

describe('Impulse und Zustand', () => {
  it('pulseValue fällt von der Stärke auf 0', () => {
    expect(pulseValue({ strength: 0.8, remainingMs: 100, totalMs: 100 })).toBeCloseTo(0.8, 10);
    expect(pulseValue({ strength: 0.8, remainingMs: 50, totalMs: 100 })).toBeCloseTo(0.2, 10);
    expect(pulseValue({ strength: 0.8, remainingMs: 0, totalMs: 100 })).toBe(0);
    expect(pulseValue({ strength: 0.8, remainingMs: 10, totalMs: 0 })).toBe(0);
  });

  it('ohne Ereignisse bleibt alles ruhig', () => {
    const step = stepJuice(triggerJuice(newJuice(), [hit], JUICE_FULL), 16);
    expect(step.shake).toEqual({ x: 0, y: 0 });
    expect(step.flash).toBe(0);
    expect(step.aberration).toBe(0);
    expect(step.displayDeltaMs).toBe(16);
  });

  it('ein tower-down startet Shake, Flash, Aberration und Hit-Stop', () => {
    const state = triggerJuice(newJuice(), [towerDown], JUICE_FULL);
    expect(state.shake.strength).toBe(impactFor(towerDown).shake);
    expect(state.flash.totalMs).toBe(SCREEN_FLASH_MS);
    expect(state.aberration.totalMs).toBe(ABERRATION_MS);
    expect(state.hitStopMs).toBe(impactFor(towerDown).hitStopMs);
    const step = stepJuice(state, 16);
    expect(Math.hypot(step.shake.x, step.shake.y)).toBeGreaterThan(0);
    expect(Math.hypot(step.shake.x, step.shake.y)).toBeLessThanOrEqual(MAX_SHAKE_PX);
    expect(step.flash).toBeGreaterThan(0);
    expect(step.aberration).toBeGreaterThan(0);
  });

  it('mit abgeschalteten Einstellungen passiert nichts', () => {
    const off = { shake: false, flash: false, aberration: false, hitStop: false, postFx: true };
    const state = triggerJuice(newJuice(), [towerDown, explosion], off);
    expect(state).toEqual(newJuice());
  });

  it('ein schwächerer Treffer unterbricht keinen stärkeren Impuls, ein stärkerer ersetzt ihn', () => {
    const strong = triggerJuice(newJuice(), [towerDown], JUICE_FULL);
    expect(triggerJuice(strong, [towerHit], JUICE_FULL).shake).toEqual(strong.shake);
    const weak = triggerJuice(newJuice(), [towerHit], JUICE_FULL);
    expect(triggerJuice(weak, [towerDown], JUICE_FULL).shake.strength).toBe(impactFor(towerDown).shake);
  });

  it('der Impuls endet nach seiner Dauer und der Versatz ist dann 0', () => {
    let state = triggerJuice(newJuice(), [towerDown], JUICE_FULL);
    state = stepJuice(state, 1000).state;
    expect(state.shake.remainingMs).toBe(0);
    const step = stepJuice(state, 16);
    expect(step.shake).toEqual({ x: 0, y: 0 });
  });

  it('Hit-Stop verkürzt nur die Darstellungszeit und zählt in echter Zeit herunter', () => {
    const state = triggerJuice(newJuice(), [towerDown], JUICE_FULL);
    const stop = impactFor(towerDown).hitStopMs;
    const first = stepJuice(state, 50);
    expect(first.displayDeltaMs).toBe(0);
    expect(first.state.hitStopMs).toBe(stop - 50);
    const second = stepJuice(first.state, 100);
    expect(second.displayDeltaMs).toBe(100 - (stop - 50));
    expect(second.state.hitStopMs).toBe(0);
  });

  it('Dauer von Shake und Hit-Stop hängt nicht von der Bildrate ab', () => {
    const run = (frameMs: number) => {
      let state = triggerJuice(newJuice(), [towerDown], JUICE_FULL);
      let shownMs = 0;
      let shakingMs = 0;
      for (let elapsed = 0; elapsed < 600; elapsed += frameMs) {
        const step = stepJuice(state, frameMs);
        state = step.state;
        shownMs += step.displayDeltaMs;
        if (state.shake.remainingMs > 0) shakingMs += frameMs;
      }
      return { shownMs, shakingMs };
    };
    const slow = run(40);
    const fast = run(8);
    expect(slow.shownMs).toBe(fast.shownMs);
    expect(slow.shownMs).toBe(600 - impactFor(towerDown).hitStopMs);
    expect(Math.abs(slow.shakingMs - fast.shakingMs)).toBeLessThanOrEqual(40);
  });

  it('shakeOffset ist zeitabhängig, aber ohne Zufall', () => {
    expect(shakeOffset(0.5, 37)).toEqual(shakeOffset(0.5, 37));
    expect(shakeOffset(0.5, 37)).not.toEqual(shakeOffset(0.5, 80));
    expect(shakeOffset(0, 37)).toEqual({ x: 0, y: 0 });
    expect(Math.abs(shakeOffset(1, 123).x)).toBeLessThanOrEqual(MAX_SHAKE_PX);
  });
});

describe('Squash & Stretch', () => {
  it('nur Beschwörung, Treffer und Heilung verformen eine Figur', () => {
    expect(squashFor(summon)!.y).toBeGreaterThan(1);
    expect(squashFor(summon)!.x).toBeLessThan(1);
    expect(squashFor(hit)!.y).toBeLessThan(1);
    expect(squashFor(hit)!.x).toBeGreaterThan(1);
    expect(squashFor(heal)).not.toBeNull();
    expect(squashFor(death)).toBeNull();
    expect(squashFor(towerDown)).toBeNull();
  });

  it('beginnt bei der Höchstverformung und endet bei 1', () => {
    const squash = squashFor(hit)!;
    expect(squashScale({ squash, ageMs: 0 })).toEqual({ x: squash.x, y: squash.y });
    const end = squashScale({ squash, ageMs: squash.durationMs });
    expect(end.x).toBeCloseTo(1, 10);
    expect(end.y).toBeCloseTo(1, 10);
  });

  it('federt über das Ziel hinaus (Gegenschwung)', () => {
    const squash = squashFor(hit)!;
    const mid = squashScale({ squash, ageMs: squash.durationMs * 0.6 });
    expect(mid.y).toBeGreaterThan(1);
    expect(mid.x).toBeLessThan(1);
  });

  it('updateSquashes startet je Ereignis, altert mit delta und entfernt Fertige', () => {
    const started = updateSquashes(new Map(), [hit, summon, death], 16);
    expect([...started.keys()].sort()).toEqual([minionKey(0, 1), minionKey(0, 3)]);
    expect(started.get(minionKey(0, 1))!.ageMs).toBe(0);
    const aged = updateSquashes(started, [], 100);
    expect(aged.get(minionKey(0, 1))!.ageMs).toBe(100);
    const later = updateSquashes(aged, [], 100);
    expect(later.has(minionKey(0, 1))).toBe(false);
    expect(later.has(minionKey(0, 3))).toBe(true);
    const restarted = updateSquashes(aged, [hit], 16);
    expect(restarted.get(minionKey(0, 1))!.ageMs).toBe(0);
  });
});
