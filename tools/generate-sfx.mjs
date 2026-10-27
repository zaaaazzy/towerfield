/**
 * Erzeugt die Kampf- und Aktionseffekte unter `public/assets/audio/*.wav` rein rechnerisch (Sinus, Rauschen, Hüllkurven).
 * Es gibt keine fremden Samples; die Dateien sind selbst erzeugt und stehen unter CC0 (siehe `docs/audio-quellen.md`).
 * Aufruf: `node tools/generate-sfx.mjs` (deterministisch: gleiche Ausgabe bei jedem Lauf).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'audio');

/** Fester Zufallsgenerator (mulberry32), damit das Rauschen bei jedem Lauf gleich ist. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

/** Baut `seconds` Sekunden Ton: `fn(t, i)` liefert den Wert in [-1, 1]. */
function render(seconds, fn) {
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) out[i] = fn(i / RATE, i);
  return out;
}

const decay = (t, rate) => Math.exp(-t * rate);
const sine = (freq, t) => Math.sin(2 * Math.PI * freq * t);
/** Weiches Ein- und Ausblenden, damit nichts knackt. */
const edges = (t, length) => Math.min(1, t / 0.004, (length - t) / 0.01);

/** Einfacher Tiefpass (Einpol): `amount` nahe 1 = dumpfer. */
function lowpass(samples, amount) {
  let last = 0;
  return samples.map((value) => (last = last * amount + value * (1 - amount)));
}

function mix(...tracks) {
  const length = Math.max(...tracks.map((track) => track.length));
  const out = new Float32Array(length);
  for (const track of tracks) for (let i = 0; i < track.length; i += 1) out[i] += track[i];
  return out;
}

/** Eine Folge von Tönen (Frequenz, Dauer), jeder klingt mit eigener Hüllkurve ab. */
function notes(list, { wave = sine, tail = 6, gain = 0.5 } = {}) {
  const total = list.reduce((sum, [, length]) => sum + length, 0) + 0.2;
  const out = new Float32Array(Math.floor(total * RATE));
  let start = 0;
  for (const [freq, length] of list) {
    const from = Math.floor(start * RATE);
    const count = Math.floor((length + 0.2) * RATE);
    for (let i = 0; i < count && from + i < out.length; i += 1) {
      const t = i / RATE;
      out[from + i] += wave(freq, t) * decay(t, tail) * Math.min(1, t / 0.005) * gain;
    }
    start += length;
  }
  return out;
}

const soft = (freq, t) => sine(freq, t) + 0.35 * sine(freq * 2, t) + 0.15 * sine(freq * 3, t);

const SOUNDS = {
  'melee-hit': () => {
    const noise = rng(1);
    const crack = lowpass(render(0.14, () => noise()), 0.55);
    return mix(
      render(0.14, (t, i) => crack[i] * decay(t, 38) * 0.8),
      render(0.14, (t) => sine(150 - t * 400, t) * decay(t, 30) * 0.8),
    );
  },
  arrow: () => {
    const noise = rng(2);
    const air = render(0.3, () => noise());
    return render(0.3, (t, i) => {
      const smoothed = (air[i] + (air[i - 1] ?? 0) + (air[i - 2] ?? 0)) / 3;
      return (smoothed * Math.sin((Math.PI * t) / 0.3) ** 2 * 0.7 + sine(1800 - t * 2500, t) * decay(t, 18) * 0.2);
    });
  },
  lightning: () => {
    const noise = rng(3);
    return render(0.4, (t) => {
      const buzz = Math.sign(sine(110, t)) * 0.3 + sine(1320 + 400 * sine(31, t), t) * 0.3;
      const crackle = noise() > 0.82 ? noise() : 0;
      return (buzz * decay(t, 7) + crackle * decay(t, 10) * 0.9) * 0.8;
    });
  },
  'shield-block': () =>
    render(0.4, (t) => {
      const ring = sine(820, t) + 0.7 * sine(1260, t) + 0.5 * sine(1870, t) + 0.3 * sine(2750, t);
      return ring * decay(t, 14) * 0.28;
    }),
  heal: () => notes([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.2]], { wave: soft, tail: 7, gain: 0.35 }),
  summon: () =>
    render(0.45, (t) => {
      const freq = 220 + 900 * t ** 0.7;
      return (sine(freq, t) * 0.5 + sine(freq * 1.5, t) * 0.25) * Math.sin((Math.PI * t) / 0.45) ** 1.5 * 0.7;
    }),
  'minion-death': () => {
    const noise = rng(4);
    return render(0.4, (t) => (sine(320 * Math.exp(-t * 4), t) * 0.6 + noise() * 0.25 * decay(t, 25)) * decay(t, 7));
  },
  explosion: () => {
    const noise = rng(5);
    const rumble = lowpass(render(0.8, () => noise()), 0.86);
    return render(0.8, (t, i) => (rumble[i] * 4.5 + sine(70 * Math.exp(-t * 2), t) * 0.7) * decay(t, 5) * 0.9);
  },
  'tower-hit': () => {
    const noise = rng(6);
    const crack = lowpass(render(0.25, () => noise()), 0.8);
    return render(0.25, (t, i) => (sine(90 - t * 80, t) * 0.8 + crack[i] * 2) * decay(t, 16) * 0.8);
  },
  'tower-down': () => {
    const noise = rng(7);
    const rubble = lowpass(render(1.1, () => noise()), 0.8);
    return render(1.1, (t, i) => (rubble[i] * 3.5 * Math.min(1, t / 0.02) + sine(55 * Math.exp(-t * 1.2), t) * 0.8) * decay(t, 3));
  },
  'card-play': () => {
    const noise = rng(8);
    return render(0.14, (t) => {
      const flick = noise() - 0.9 * noise();
      return flick * Math.sin((Math.PI * t) / 0.14) * 0.35 + sine(900 + t * 2000, t) * decay(t, 40) * 0.12;
    });
  },
  'round-start': () => notes([[330, 0.22], [494, 0.4]], { wave: (f, t) => soft(f, t) + 0.2 * Math.sign(sine(f, t)), tail: 4, gain: 0.3 }),
  'round-end': () => notes([[494, 0.2], [330, 0.4]], { wave: soft, tail: 5, gain: 0.35 }),
  victory: () =>
    notes([[523, 0.16], [659, 0.16], [784, 0.16], [1047, 0.5]], { wave: soft, tail: 3.5, gain: 0.3 }),
  defeat: () =>
    notes([[392, 0.25], [349, 0.25], [311, 0.25], [262, 0.6]], { wave: soft, tail: 3, gain: 0.35 }),
};

/** Schreibt 16-Bit-PCM-WAV, mono; normalisiert auf einen Spitzenwert von 0,8. */
function wav(samples) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? 0.8 / peak : 1;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => {
    const t = i / RATE;
    const length = samples.length / RATE;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value * scale * edges(t, length))) * 32767), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Diese Effekte sind Kenney-Samples (CC0, siehe `docs/anwendung-audio.md`) und liegen fertig im Repository; der
 * Generator überschreibt sie nicht. Die Formeln oben bleiben als Ersatz, falls ein Sample wieder entfällt.
 */
const SAMPLED = new Set([
  'melee-hit',
  'arrow',
  'shield-block',
  'tower-hit',
  'tower-down',
  'minion-death',
  'card-play',
  'round-start',
  'round-end',
]);

mkdirSync(OUT, { recursive: true });
for (const [name, build] of Object.entries(SOUNDS)) {
  if (SAMPLED.has(name)) continue;
  const file = wav(build());
  writeFileSync(join(OUT, `${name}.wav`), file);
  console.log(`${name}.wav  ${file.length} Bytes`);
}
