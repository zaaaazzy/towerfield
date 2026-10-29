/**
 * Zentrales Farb- und Stilkonzept (siehe docs/grafik-stil.md): Palette, Schriften, Rahmenparameter und Zeichenhelfer.
 * Alle Szenen nehmen Farben und Schriften nur von hier. Die Kartentyp-Farben stehen in `logic/card-style.ts`.
 */
import Phaser from 'phaser';
import type { LightStops } from '../logic/ambience';

/*
 * Tokens nach Rollen. Jede Gruppe ist ein eigenes Objekt und lässt sich später als Ganzes austauschen
 * (z. B. eine Nacht- oder Rundenstimmung); `PALETTE` bleibt als flache Sicht darauf für die bestehenden Szenen.
 */

/** Oberfläche: Hintergründe, Panels, Boden, Wege und Knopfflächen (Verläufe als `top`/`bottom`). */
export const SURFACE = {
  bgDeep: 0x0b0820,
  bgMid: 0x1b1540,
  bgLight: 0x2d2460,
  panel: 0x241c4d,
  panelDark: 0x140f2e,
  /** Boden des Spielfelds und der Wege. */
  ground: 0x1f2a47,
  path: 0x3b3558,
  pathEdge: 0x1a1535,
  disabled: 0x3a3556,
  /** Knopfflächen: Bereit/Ziehen (grün), Abwerfen (Ruhe/Hover), Kartenfilter (alle/aktiv). */
  buttonReady: { top: 0x4fae54, bottom: 0x23602a },
  buttonDiscard: { top: 0x6a4a8a, bottom: 0x35234f },
  buttonDiscardHover: { top: 0xd9a441, bottom: 0x8a5a14 },
  buttonFilterAll: { top: 0x4a4570, bottom: 0x2a2548 },
  buttonFilterActive: { top: 0x5a82d0, bottom: 0x28427f },
} as const;

/** Licht: Abenddämmerung-Schicht (siehe `scenes/ambience-layer.ts`, Werte pro Runde in `logic/ambience.ts`), Glut, Glanz und Schatten. */
export const LIGHT = {
  eveningGold: 0xf2b84b,
  duskViolet: 0x5b3a8e,
  nightBlue: 0x0d1536,
  torchOrange: 0xff8a2b,
  fogGrey: 0xa9aec4,
  fireflyYellow: 0xe8ff7a,
  /** Glut an Bruchstellen: Außenschein und heller Kern. */
  emberGlow: 0xff7a1a,
  emberCore: 0xffd23a,
  /** Energie-Kristall. */
  energy: 0x5ad7ff,
  white: 0xffffff,
  black: 0x000000,
} as const;

/** Material: Metalle (Rahmen), Stein und Rauch. */
export const MATERIAL = {
  gold: 0xf2c14e,
  goldLight: 0xffe08a,
  goldDark: 0x9c6b1f,
  bronze: 0xb87333,
  bronzeDark: 0x5f3513,
  stone: 0x8a86a6,
  stoneDark: 0x4a4668,
  steelLight: 0xc9cde0,
  steelDark: 0x4d5069,
  smoke: 0x3a3a40,
} as const;

/** Team: Spieler- und Gegnerfarben, Gut/Schlecht und die Turm-Spezialisierungsmarken. */
export const TEAM_COLOR = {
  human: 0x35b6ff,
  humanDark: 0x0f5a8f,
  bot: 0xff6a3d,
  botDark: 0x8f2a10,
  good: 0x6bd16f,
  goodDark: 0x2c7a31,
  goodLight: 0x9af0a0,
  bad: 0xef5350,
  badDark: 0x8e1f1d,
  badLight: 0xff8a80,
  /** Markierung im Schild des Towers: Blitz-Turm gelb, Schild-Turm blau. */
  markLightning: 0xffd23a,
  markShield: 0x5ab4ff,
} as const;

/** Palette (flache Sicht auf die Rollen): dunkles Fantasy-Blau/Violett, Gold- und Bronze-Akzente, kräftige Teamfarben. */
export const PALETTE = {
  bgDeep: SURFACE.bgDeep,
  bgMid: SURFACE.bgMid,
  bgLight: SURFACE.bgLight,
  panel: SURFACE.panel,
  panelDark: SURFACE.panelDark,
  ground: SURFACE.ground,
  path: SURFACE.path,
  pathEdge: SURFACE.pathEdge,
  disabled: SURFACE.disabled,
  gold: MATERIAL.gold,
  goldLight: MATERIAL.goldLight,
  goldDark: MATERIAL.goldDark,
  bronze: MATERIAL.bronze,
  bronzeDark: MATERIAL.bronzeDark,
  stone: MATERIAL.stone,
  stoneDark: MATERIAL.stoneDark,
  human: TEAM_COLOR.human,
  humanDark: TEAM_COLOR.humanDark,
  bot: TEAM_COLOR.bot,
  botDark: TEAM_COLOR.botDark,
  good: TEAM_COLOR.good,
  goodDark: TEAM_COLOR.goodDark,
  bad: TEAM_COLOR.bad,
  badDark: TEAM_COLOR.badDark,
  energy: LIGHT.energy,
  white: LIGHT.white,
  black: LIGHT.black,
} as const;

/** Farbstützpunkte für `ambienceForRound`. */
export const LIGHT_STOPS: LightStops = {
  gold: LIGHT.eveningGold,
  dusk: LIGHT.duskViolet,
  night: LIGHT.nightBlue,
  torch: LIGHT.torchOrange,
};

/** Seitenhintergrund hinter dem Canvas (gleich `PALETTE.bgDeep`, auch in `index.html`). */
export const PAGE_BACKGROUND = '#0b0820';

/** Textfarben als CSS-Strings (Phaser-Text braucht Strings). */
export const TEXT = {
  main: '#f6efdc',
  dim: '#a39cc8',
  gold: '#ffd76a',
  good: '#8be38f',
  bad: '#ff8a80',
  human: '#6fcbff',
  bot: '#ff9a78',
  dark: '#140f2e',
  outline: '#140f2e',
};

/**
 * Schriften: nur Systemschriften, damit das Spiel auch offline ohne Webfont gleich aussieht.
 * `heading` ist eine Serifenschrift (Kartennamen, Titel), `body` eine gut lesbare Grotesk.
 */
export const FONTS = {
  heading: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
  body: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
};

/** Rahmenparameter für Karten, Panels und Balken. */
export const FRAME = {
  radius: 6,
  panelRadius: 8,
  outer: 2,
  inner: 1,
  barHeight: 6,
};

export function lerpColor(from: number, to: number, t: number): number {
  const a = Phaser.Display.Color.IntegerToRGB(from);
  const b = Phaser.Display.Color.IntegerToRGB(to);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return Phaser.Display.Color.GetColor(mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b));
}

/** Senkrechter Verlauf als Farbbänder (funktioniert mit WebGL und Canvas). */
export function fillGradient(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  top: number,
  bottom: number,
  alpha = 1,
  steps = 6,
): void {
  const bands = Math.max(1, Math.min(steps, Math.floor(height)));
  for (let band = 0; band < bands; band += 1) {
    const y0 = y + (band * height) / bands;
    const y1 = y + ((band + 1) * height) / bands;
    g.fillStyle(lerpColor(top, bottom, bands === 1 ? 0 : band / (bands - 1)), alpha).fillRect(x, y0, width, y1 - y0 + 0.5);
  }
}

export type FrameMetal = 'gold' | 'bronze' | 'steel';

const METALS: Record<FrameMetal, { light: number; dark: number }> = {
  gold: { light: PALETTE.goldLight, dark: PALETTE.goldDark },
  bronze: { light: PALETTE.bronze, dark: PALETTE.bronzeDark },
  steel: { light: MATERIAL.steelLight, dark: MATERIAL.steelDark },
};

/** Gerahmtes Panel: Metallrand (zweifach, hell/dunkel), Füllung mit Verlauf. `border` überschreibt das Metall. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { metal?: FrameMetal; border?: number; top?: number; bottom?: number; alpha?: number; radius?: number } = {},
): void {
  const radius = options.radius ?? FRAME.panelRadius;
  const metal = METALS[options.metal ?? 'gold'];
  const alpha = options.alpha ?? 1;
  const dark = options.border ?? metal.dark;
  const light = options.border ?? metal.light;
  g.fillStyle(PALETTE.black, 0.35 * alpha).fillRoundedRect(x + 1, y + 3, width, height, radius);
  g.fillStyle(dark, alpha).fillRoundedRect(x, y, width, height, radius);
  g.fillStyle(light, alpha).fillRoundedRect(x + 1, y + 1, width - 2, height - 2, Math.max(1, radius - 1));
  const inset = FRAME.outer;
  g.fillStyle(dark, alpha).fillRoundedRect(x + inset, y + inset, width - inset * 2, height - inset * 2, Math.max(1, radius - 2));
  fillGradient(
    g,
    x + inset + 1,
    y + inset + 1,
    width - (inset + 1) * 2,
    height - (inset + 1) * 2,
    options.top ?? PALETTE.panel,
    options.bottom ?? PALETTE.panelDark,
    alpha,
    8,
  );
}

/** Balken in Metallrahmen mit Verlaufsfüllung; `ratio` zwischen 0 und 1. */
export function drawBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
  fill: { top: number; bottom: number },
  metal: FrameMetal = 'gold',
): void {
  const colors = METALS[metal];
  const round = Math.min(FRAME.radius / 2, height / 2 + 1);
  g.fillStyle(PALETTE.black, 0.3).fillRoundedRect(x - 1, y, width + 2, height + 2, round);
  g.fillStyle(colors.dark, 1).fillRoundedRect(x - 1, y - 1, width + 2, height + 2, round);
  g.fillStyle(PALETTE.panelDark, 1).fillRoundedRect(x, y, width, height, Math.max(1, round - 1));
  const filled = Math.max(0, Math.min(1, ratio)) * width;
  if (filled > 0) {
    fillGradient(g, x, y, filled, height, fill.top, fill.bottom, 1, 3);
    g.fillStyle(PALETTE.white, 0.25).fillRect(x, y, filled, 1);
  }
  g.lineStyle(1, colors.light, 0.9).strokeRoundedRect(x - 0.5, y - 0.5, width + 1, height + 1, round);
}

/** Füllung des Lebensbalkens: grün, bei wenig Leben rot. */
export function healthFill(ratio: number): { top: number; bottom: number } {
  return ratio > 0.35 ? { top: TEAM_COLOR.goodLight, bottom: TEAM_COLOR.goodDark } : { top: TEAM_COLOR.badLight, bottom: TEAM_COLOR.badDark };
}

/** Knopf mit Metallrand; `enabled = false` zeigt ihn gedämpft. */
export function drawButton(
  g: Phaser.GameObjects.Graphics,
  rect: { x: number; y: number; width: number; height: number },
  options: { enabled?: boolean; top?: number; bottom?: number } = {},
): void {
  const enabled = options.enabled ?? true;
  drawPanel(g, rect.x, rect.y, rect.width, rect.height, {
    metal: enabled ? 'gold' : 'steel',
    top: enabled ? (options.top ?? SURFACE.buttonReady.top) : PALETTE.disabled,
    bottom: enabled ? (options.bottom ?? SURFACE.buttonReady.bottom) : PALETTE.panelDark,
    radius: 8,
  });
}
