import { describe, expect, it } from 'vitest';
import { parseSeed } from './seed';

describe('parseSeed', () => {
  it('liest eine ganze Zahl aus dem Query-String', () => {
    expect(parseSeed('?seed=42')).toBe(42);
    expect(parseSeed('?scene=main&seed=7')).toBe(7);
    expect(parseSeed('seed=0')).toBe(0);
  });

  it('gibt null zurück, wenn der Parameter fehlt oder ungültig ist', () => {
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('?seed=')).toBeNull();
    expect(parseSeed('?seed=abc')).toBeNull();
    expect(parseSeed('?seed=-3')).toBeNull();
    expect(parseSeed('?seed=1.5')).toBeNull();
  });

  it('bildet große Werte wie Date.now() auf 32 Bit ab', () => {
    expect(parseSeed('?seed=4294967297')).toBe(1);
  });
});
