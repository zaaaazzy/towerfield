import { describe, expect, it } from 'vitest';
import { advancePress, LONG_PRESS_MS, LONG_PRESS_TOLERANCE, startPress } from './long-press';

describe('Langdrücken', () => {
  it('startet offen ohne Haltezeit', () => {
    expect(startPress(10, 20)).toEqual({ heldMs: 0, startX: 10, startY: 20, status: 'pending' });
  });

  it('bleibt unter der Schwelle offen', () => {
    const press = advancePress(startPress(10, 20), LONG_PRESS_MS - 1, 10, 20);
    expect(press.status).toBe('pending');
    expect(press.heldMs).toBe(LONG_PRESS_MS - 1);
  });

  it('öffnet ab der Schwelle, auch über mehrere kleine delta', () => {
    let press = startPress(10, 20);
    for (let step = 0; step < 24; step += 1) press = advancePress(press, 16, 10, 20);
    expect(press.status).toBe('pending');
    press = advancePress(press, 16, 10, 20);
    expect(press.status).toBe('open');
    expect(advancePress(startPress(0, 0), LONG_PRESS_MS, 0, 0).status).toBe('open');
  });

  it('toleriert eine kleine Bewegung', () => {
    const press = advancePress(startPress(10, 20), LONG_PRESS_MS, 10 + LONG_PRESS_TOLERANCE - 1, 20);
    expect(press.status).toBe('open');
  });

  it('bricht bei Bewegung über die Toleranz ab, auch über der Schwelle', () => {
    expect(advancePress(startPress(10, 20), 50, 10 + LONG_PRESS_TOLERANCE, 20).status).toBe('cancelled');
    expect(advancePress(startPress(10, 20), LONG_PRESS_MS + 100, 10, 20 - LONG_PRESS_TOLERANCE - 5).status).toBe('cancelled');
  });

  it('behält open und cancelled bei', () => {
    const open = advancePress(startPress(0, 0), LONG_PRESS_MS, 0, 0);
    expect(advancePress(open, 100, 100, 100)).toBe(open);
    const cancelled = advancePress(startPress(0, 0), 10, 50, 0);
    expect(advancePress(cancelled, LONG_PRESS_MS * 2, 0, 0)).toBe(cancelled);
  });

  it('ignoriert negative delta', () => {
    expect(advancePress(startPress(0, 0), -50, 0, 0).heldMs).toBe(0);
  });
});
