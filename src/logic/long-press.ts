/**
 * Entscheidung für das Langdrücken auf eine Handkarte: Die Haltezeit wächst über `delta`, jede Bewegung über die
 * Toleranz bricht ab. Ohne Phaser, DOM und Canvas; die Szene liefert nur Zeigerposition und Zeit.
 */

/** Haltezeit in Millisekunden, ab der ein Druck als Langdrücken gilt. */
export const LONG_PRESS_MS = 400;

/** Bewegung in Spielpixeln, ab der der Druck ein Ziehen ist und das Langdrücken abbricht. */
export const LONG_PRESS_TOLERANCE = 8;

/** `pending`: noch offen, `open`: Schwelle erreicht (Detailansicht), `cancelled`: zu weit bewegt. */
export type PressStatus = 'pending' | 'open' | 'cancelled';

export interface PressState {
  heldMs: number;
  startX: number;
  startY: number;
  status: PressStatus;
}

/** Beginn eines Drucks an dieser Stelle. */
export function startPress(x: number, y: number): PressState {
  return { heldMs: 0, startX: x, startY: y, status: 'pending' };
}

/**
 * Schreibt den Druck um `deltaMs` fort. Der Zeiger steht an (x, y). Ein Ergebnis `open` oder `cancelled` bleibt
 * bestehen; die Bewegung hat Vorrang vor der Zeit, damit ein Ziehen nie als Langdrücken zählt.
 */
export function advancePress(press: PressState, deltaMs: number, x: number, y: number): PressState {
  if (press.status !== 'pending') return press;
  const heldMs = press.heldMs + Math.max(0, deltaMs);
  if (Math.hypot(x - press.startX, y - press.startY) >= LONG_PRESS_TOLERANCE) return { ...press, heldMs, status: 'cancelled' };
  return { ...press, heldMs, status: heldMs >= LONG_PRESS_MS ? 'open' : 'pending' };
}
