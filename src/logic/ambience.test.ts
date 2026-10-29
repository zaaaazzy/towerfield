import { describe, expect, it } from 'vitest';
import {
  advanceDrift,
  ambienceForRound,
  ambienceProgress,
  blendAmbience,
  DEFAULT_LIGHT_STOPS,
  fireflyCount,
  fireflyGlow,
  fireflyStart,
  flickerAt,
  flickerParams,
  flickerStrength,
  MAX_DARKNESS,
  MAX_FIREFLIES,
  mixColor,
  stepFirefly,
} from './ambience';

const MAX = 8;
const rounds = Array.from({ length: MAX }, (_, i) => i + 1);
const BOUNDS = { width: 360, height: 440 };

describe('ambienceForRound', () => {
  it('Runde 1 ist goldenes Abendlicht mit den kleinsten Werten', () => {
    const first = ambienceForRound(1, MAX);
    expect(first.color).toBe(DEFAULT_LIGHT_STOPS.gold);
    expect(first.tint).toBe(DEFAULT_LIGHT_STOPS.gold);
    for (const round of rounds.slice(1)) {
      const other = ambienceForRound(round, MAX);
      expect(first.darkness).toBeLessThan(other.darkness);
      expect(first.fog).toBeLessThan(other.fog);
      expect(first.fireflies).toBeLessThan(other.fireflies);
    }
  });

  it('die letzte Runde ist die Fackelnacht mit den größten Werten', () => {
    const last = ambienceForRound(MAX, MAX);
    expect(last.color).toBe(DEFAULT_LIGHT_STOPS.torch);
    expect(last.tint).toBe(DEFAULT_LIGHT_STOPS.night);
    expect(last.darkness).toBeCloseTo(MAX_DARKNESS, 10);
    expect(last.fog).toBeCloseTo(0.7, 10);
    expect(last.fireflies).toBe(1);
    for (const round of rounds.slice(0, -1)) {
      const other = ambienceForRound(round, MAX);
      expect(last.darkness).toBeGreaterThan(other.darkness);
      expect(last.fog).toBeGreaterThan(other.fog);
      expect(last.fireflies).toBeGreaterThan(other.fireflies);
    }
  });

  it('Abdunklung, Nebel und Glühwürmchen fallen von Runde 1 bis 8 nie', () => {
    const values = rounds.map((round) => ambienceForRound(round, MAX));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!.darkness).toBeGreaterThanOrEqual(values[i - 1]!.darkness);
      expect(values[i]!.fog).toBeGreaterThanOrEqual(values[i - 1]!.fog);
      expect(values[i]!.fireflies).toBeGreaterThanOrEqual(values[i - 1]!.fireflies);
    }
  });

  it('die mittlere Tönung ist Dämmerviolett', () => {
    expect(ambienceForRound(5, 9).tint).toBe(DEFAULT_LIGHT_STOPS.dusk);
  });

  it('Werte bleiben im Bereich, die Abdunklung unter der Obergrenze', () => {
    for (let round = -3; round <= 12; round += 0.5) {
      const a = ambienceForRound(round, MAX);
      expect(a.darkness).toBeGreaterThan(0);
      expect(a.darkness).toBeLessThanOrEqual(MAX_DARKNESS);
      for (const value of [a.fog, a.fireflies]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('Runden außerhalb von 1..maxRounds ergeben den Randwert', () => {
    expect(ambienceForRound(0, MAX)).toEqual(ambienceForRound(1, MAX));
    expect(ambienceForRound(-5, MAX)).toEqual(ambienceForRound(1, MAX));
    expect(ambienceForRound(99, MAX)).toEqual(ambienceForRound(MAX, MAX));
  });

  it('maxRounds 1, 0, negativ und ungültige Eingaben ergeben gültige Zahlen ohne NaN', () => {
    const inputs: [number, number][] = [[1, 1], [5, 1], [1, 0], [0, 0], [3, -2], [NaN, 8], [3, NaN], [Infinity, 8], [3, Infinity]];
    for (const [round, max] of inputs) {
      const a = ambienceForRound(round, max);
      for (const value of Object.values(a)) expect(Number.isFinite(value)).toBe(true);
      expect(a).toEqual(ambienceForRound(1, MAX));
    }
  });

  it('eigene Farbstützpunkte werden verwendet', () => {
    const stops = { gold: 0x112233, dusk: 0x445566, night: 0x778899, torch: 0xaabbcc };
    expect(ambienceForRound(1, MAX, stops).color).toBe(0x112233);
    expect(ambienceForRound(MAX, MAX, stops).color).toBe(0xaabbcc);
  });
});

describe('ambienceProgress / mixColor / fireflyCount', () => {
  it('Fortschritt liegt zwischen 0 und 1', () => {
    expect(ambienceProgress(1, 8)).toBe(0);
    expect(ambienceProgress(8, 8)).toBe(1);
    expect(ambienceProgress(4.5, 8)).toBeCloseTo(0.5, 10);
  });

  it('mischt Farben kanalweise und begrenzt t', () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColor(0x000000, 0xffffff, 2)).toBe(0xffffff);
    expect(mixColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
    expect(mixColor(0xff0000, 0x0000ff, -1)).toBe(0xff0000);
  });

  it('Glühwürmchenzahl ist begrenzt', () => {
    expect(fireflyCount(0)).toBe(0);
    expect(fireflyCount(1)).toBe(MAX_FIREFLIES);
    expect(fireflyCount(5)).toBe(MAX_FIREFLIES);
    expect(fireflyCount(-1)).toBe(0);
    expect(fireflyCount(0.5)).toBe(MAX_FIREFLIES / 2);
    expect(fireflyCount(ambienceForRound(1, MAX).fireflies)).toBeLessThan(fireflyCount(ambienceForRound(MAX, MAX).fireflies));
  });
});

describe('blendAmbience', () => {
  const from = ambienceForRound(1, MAX);
  const to = ambienceForRound(MAX, MAX);

  it('ohne Zeit bleibt alles, mit Zeitkonstante 0 springt es zum Ziel', () => {
    expect(blendAmbience(from, to, 0, 500)).toEqual(from);
    expect(blendAmbience(from, to, -5, 500)).toEqual(from);
    expect(blendAmbience(from, to, 16, 0)).toEqual(to);
  });

  it('nähert sich dem Ziel, ohne es zu überschreiten', () => {
    const half = blendAmbience(from, to, 500, 500);
    expect(half.darkness).toBeGreaterThan(from.darkness);
    expect(half.darkness).toBeLessThan(to.darkness);
    const far = blendAmbience(from, to, 100000, 500);
    expect(far.darkness).toBeCloseTo(to.darkness, 6);
    expect(far.color).toBe(to.color);
  });

  it('ist bei 30 und 144 Hz nach gleicher Zeit (fast) gleich', () => {
    const run = (hz: number) => {
      let a = from;
      for (let i = 0; i < hz; i += 1) a = blendAmbience(a, to, 1000 / hz, 400);
      return a;
    };
    expect(run(30).darkness).toBeCloseTo(run(144).darkness, 6);
    expect(run(30).fog).toBeCloseTo(run(144).fog, 6);
  });
});

describe('advanceDrift', () => {
  it('bewegt und umschließt in beide Richtungen', () => {
    expect(advanceDrift(0, 10, 1000, 100)).toBeCloseTo(10, 10);
    expect(advanceDrift(95, 10, 1000, 100)).toBeCloseTo(5, 10);
    expect(advanceDrift(5, -10, 1000, 100)).toBeCloseTo(95, 10);
    expect(advanceDrift(5, 10, 1000, 0)).toBe(0);
  });

  it('legt in einer Sekunde bei 30 und 144 Hz denselben Weg zurück', () => {
    const run = (hz: number) => {
      let x = 0;
      for (let i = 0; i < hz; i += 1) x = advanceDrift(x, 7, 1000 / hz, 256);
      return x;
    };
    expect(run(30)).toBeCloseTo(7, 6);
    expect(run(144)).toBeCloseTo(7, 6);
  });
});

describe('Flackern', () => {
  it('ist bei gleichem Seed identisch und bei anderem Seed verschieden', () => {
    const times = [0, 130, 470, 1200, 3300];
    const sample = (seed: number) => times.map((t) => flickerAt(flickerParams(seed), t, 1));
    expect(sample(7)).toEqual(sample(7));
    expect(flickerParams(7)).toEqual(flickerParams(7));
    expect(sample(7)).not.toEqual(sample(8));
  });

  it('bleibt um 1 und wächst mit der Stärke', () => {
    const params = flickerParams(3);
    let lowSwing = 0;
    let highSwing = 0;
    for (let t = 0; t < 5000; t += 17) {
      lowSwing = Math.max(lowSwing, Math.abs(flickerAt(params, t, 0.2) - 1));
      highSwing = Math.max(highSwing, Math.abs(flickerAt(params, t, 1) - 1));
    }
    expect(highSwing).toBeGreaterThan(lowSwing);
    expect(highSwing).toBeLessThanOrEqual(0.35);
    expect(flickerAt(params, 123, 0)).toBe(1);
    expect(flickerAt(params, 123, 9)).toBe(flickerAt(params, 123, 1));
  });

  it('Stärke wächst mit der Abdunklung und liegt in 0..1', () => {
    const first = flickerStrength(ambienceForRound(1, MAX));
    const last = flickerStrength(ambienceForRound(MAX, MAX));
    expect(first).toBeLessThan(last);
    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThanOrEqual(1);
  });
});

describe('Glühwürmchen', () => {
  it('Startwerte sind bei gleichem Seed identisch und bei anderem Seed verschieden', () => {
    expect(fireflyStart(11, 0, BOUNDS)).toEqual(fireflyStart(11, 0, BOUNDS));
    expect(fireflyStart(11, 0, BOUNDS)).not.toEqual(fireflyStart(12, 0, BOUNDS));
    expect(fireflyStart(11, 0, BOUNDS)).not.toEqual(fireflyStart(11, 1, BOUNDS));
  });

  it('starten innerhalb der Fläche mit gültigen Werten', () => {
    for (let index = 0; index < MAX_FIREFLIES; index += 1) {
      const f = fireflyStart(5, index, BOUNDS);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThan(BOUNDS.width);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThan(BOUNDS.height);
      expect(f.periodMs).toBeGreaterThan(0);
      expect(f.radius).toBeGreaterThan(0);
    }
  });

  it('bewegen sich bei 30 und 144 Hz gleich weit und bleiben in der Fläche', () => {
    const start = fireflyStart(9, 3, BOUNDS);
    const run = (hz: number) => {
      let f = start;
      for (let i = 0; i < hz * 10; i += 1) f = stepFirefly(f, 1000 / hz, BOUNDS);
      return f;
    };
    const slow = run(30);
    const fast = run(144);
    expect(slow.x).toBeCloseTo(fast.x, 4);
    expect(slow.y).toBeCloseTo(fast.y, 4);
    expect(slow.phase).toBeCloseTo(fast.phase, 4);
    expect(slow.x).toBeGreaterThanOrEqual(0);
    expect(slow.x).toBeLessThan(BOUNDS.width);
    expect(slow.y).toBeGreaterThanOrEqual(0);
    expect(slow.y).toBeLessThan(BOUNDS.height);
  });

  it('Leuchtkraft liegt in 0..1', () => {
    const f = fireflyStart(1, 0, BOUNDS);
    for (let t = 0; t < 5000; t += 100) {
      const glow = fireflyGlow(stepFirefly(f, t, BOUNDS));
      expect(glow).toBeGreaterThanOrEqual(0);
      expect(glow).toBeLessThanOrEqual(1);
    }
  });
});
