import { describe, expect, it } from 'vitest';
import type { FxEvent } from './fx-events';
import { createMatch, type MatchState, MAX_ROUNDS } from './match';
import {
  advanceBanner,
  BANNER_DURATION_MS,
  BANNER_SLIDE_MS,
  bannerFor,
  bannerSlide,
  skipBanner,
  startBanner,
} from './phase-banner';

const base = createMatch(1);
const inRound = (round: number, event: MatchState['event'] = null): MatchState => ({ ...base, round, event });

describe('bannerFor', () => {
  it('Rundenstart in einer Ereignisrunde nennt das gezogene Ereignis', () => {
    const banner = bannerFor({ kind: 'round-start', round: 3 }, inRound(3, 'tower-shield'));
    expect(banner).toEqual({ title: 'Runde 3', subtitle: 'Tower-Schild', tone: 'event', durationMs: 1800 });
  });

  it('Rundenstart ohne Ereignis zeigt nur die Rundenzahl von MAX_ROUNDS', () => {
    const banner = bannerFor({ kind: 'round-start', round: 2 }, inRound(2))!;
    expect(banner.title).toBe('Runde 2');
    expect(banner.subtitle).toBe(`von ${MAX_ROUNDS}`);
    expect(banner.tone).toBe('round');
  });

  it('Ereignisrunde ohne gezogenes Ereignis fällt auf den normalen Banner zurück', () => {
    expect(bannerFor({ kind: 'round-start', round: 6 }, inRound(6))!.tone).toBe('round');
  });

  it('Rundenende ist kürzer als Rundenstart', () => {
    const end = bannerFor({ kind: 'round-end', round: 4 }, inRound(4))!;
    const start = bannerFor({ kind: 'round-start', round: 4 }, inRound(4))!;
    expect(end.title).toBe('Runde 4 beendet');
    expect(end.subtitle).toBe('');
    expect(end.durationMs).toBeLessThan(start.durationMs);
  });

  it('Spielende hat je Ausgang eigenen Titel und Farbton aus Sicht des Menschen', () => {
    const results = (['player0', 'player1', 'draw'] as const).map(
      (outcome) => bannerFor({ kind: 'match-over', outcome }, base)!,
    );
    expect(results.map((banner) => banner.title)).toEqual(['Sieg', 'Niederlage', 'Unentschieden']);
    expect(results.map((banner) => banner.tone)).toEqual(['victory', 'defeat', 'draw']);
  });

  it('liefert für andere Ereignisse keinen Banner', () => {
    const event: FxEvent = { kind: 'tower-down', owner: 1, line: 0, tower: 0 };
    expect(bannerFor(event, base)).toBeNull();
  });

  it('ist deterministisch und hat nur positive Dauern', () => {
    const events: FxEvent[] = [
      { kind: 'round-start', round: 3 },
      { kind: 'round-end', round: 3 },
      { kind: 'match-over', outcome: 'draw' },
    ];
    for (const event of events) {
      const state = inRound(3, 'energy');
      expect(bannerFor(event, state)).toEqual(bannerFor(event, state));
      expect(bannerFor(event, state)!.durationMs).toBeGreaterThan(0);
    }
    expect(Object.values(BANNER_DURATION_MS).every((ms) => ms > 2 * BANNER_SLIDE_MS)).toBe(true);
  });
});

describe('Banner-Ablauf', () => {
  const banner = bannerFor({ kind: 'round-start', round: 1 }, inRound(1))!;

  it('fährt ein, hält und fährt aus, gemessen in delta', () => {
    let run = startBanner(banner);
    expect(bannerSlide(run)).toBe(0);
    run = advanceBanner(run, BANNER_SLIDE_MS)!;
    expect(bannerSlide(run)).toBe(1);
    run = advanceBanner(run, 600)!;
    expect(bannerSlide(run)).toBe(1);
    run = advanceBanner(run, banner.durationMs - BANNER_SLIDE_MS - 600 - 60)!;
    expect(bannerSlide(run)).toBeGreaterThan(0);
    expect(bannerSlide(run)).toBeLessThan(1);
    expect(advanceBanner(run, 60)).toBeNull();
  });

  it('ignoriert negative delta', () => {
    const run = advanceBanner(startBanner(banner), -50)!;
    expect(run.elapsedMs).toBe(0);
  });

  it('Überspringen springt an den Beginn des Ausfahrens und ändert dort nichts mehr', () => {
    const skipped = skipBanner(startBanner(banner));
    expect(skipped.elapsedMs).toBe(banner.durationMs - BANNER_SLIDE_MS);
    expect(skipBanner(skipped)).toBe(skipped);
    expect(advanceBanner(skipped, BANNER_SLIDE_MS)).toBeNull();
  });
});
