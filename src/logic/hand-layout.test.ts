import { describe, expect, it } from 'vitest';
import type { CardType } from './cards';
import { HAND_LIMIT } from './match';
import {
  cardAt,
  DETAIL_MARGIN,
  DETAIL_MIN_SCALE,
  DETAIL_VIEW,
  DETAIL_WIDTH,
  detailLayout,
  fanLayout,
  GLINT,
  glintPolygon,
  glintProgress,
  HAND_FAN,
  liftedPose,
  type CardPose,
  poseContains,
  sortHand,
} from './hand-layout';

/** Waagerechter und senkrechter Rand der gedrehten Karte. */
function bounds(pose: CardPose): { left: number; right: number; top: number; bottom: number } {
  const hw = HAND_FAN.cardWidth / 2;
  const hh = HAND_FAN.cardHeight / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) {
    xs.push(pose.x + cx * Math.cos(pose.rotation) - cy * Math.sin(pose.rotation));
    ys.push(pose.y + cx * Math.sin(pose.rotation) + cy * Math.cos(pose.rotation));
  }
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

describe('sortHand', () => {
  it('ordnet Einheiten, Line-, Minion- und Tower-Upgrades', () => {
    const types: CardType[] = ['tower-upgrade', 'minion-upgrade', 'summon', 'line-upgrade', 'summon', 'tower-upgrade'];
    expect(sortHand(types).map((index) => types[index])).toEqual([
      'summon',
      'summon',
      'line-upgrade',
      'minion-upgrade',
      'tower-upgrade',
      'tower-upgrade',
    ]);
  });

  it('legt „Minion stärken“ hinter die Minion-Upgrades und vor die Tower-Upgrades', () => {
    const types: CardType[] = ['tower-upgrade', 'minion-buff', 'minion-upgrade', 'summon'];
    expect(sortHand(types).map((index) => types[index])).toEqual([
      'summon',
      'minion-upgrade',
      'minion-buff',
      'tower-upgrade',
    ]);
  });

  it('legt Lane-Karten hinter „Minion stärken“ und vor die Tower-Upgrades', () => {
    const types: CardType[] = ['tower-upgrade', 'lane-card', 'minion-buff', 'summon'];
    expect(sortHand(types).map((index) => types[index])).toEqual(['summon', 'minion-buff', 'lane-card', 'tower-upgrade']);
  });

  it('erhält die Reihenfolge innerhalb eines Typs', () => {
    const types: CardType[] = ['summon', 'tower-upgrade', 'summon', 'tower-upgrade', 'summon'];
    expect(sortHand(types)).toEqual([0, 2, 4, 1, 3]);
  });

  it('lässt eine schon sortierte oder leere Hand unverändert', () => {
    expect(sortHand([])).toEqual([]);
    expect(sortHand(['summon', 'line-upgrade', 'tower-upgrade'])).toEqual([0, 1, 2]);
  });

  it('sortiert Spezialisierungen hinter die Tower-Upgrades', () => {
    const types: CardType[] = ['tower-specialize', 'tower-upgrade', 'summon', 'tower-specialize'];
    expect(sortHand(types).map((index) => types[index])).toEqual([
      'summon',
      'tower-upgrade',
      'tower-specialize',
      'tower-specialize',
    ]);
  });
});

describe('fanLayout', () => {
  it('liefert für 0 Karten nichts und für 1 Karte die gerade Mitte', () => {
    expect(fanLayout(0)).toEqual([]);
    const [only] = fanLayout(1);
    expect(only).toMatchObject({ x: HAND_FAN.areaWidth / 2, y: HAND_FAN.baseY, rotation: 0 });
  });

  it.each([1, 5, HAND_LIMIT])('hält bei %i Karten alle innerhalb der Spielbreite', (count) => {
    for (const pose of fanLayout(count)) {
      const box = bounds(pose);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(HAND_FAN.areaWidth);
    }
  });

  it('neigt die mittlere Karte nicht und die äußeren immer stärker', () => {
    const poses = fanLayout(5);
    expect(poses[2]!.rotation).toBe(0);
    expect(poses[0]!.rotation).toBeLessThan(poses[1]!.rotation);
    expect(poses[1]!.rotation).toBeLessThan(0);
    expect(poses[4]!.rotation).toBeGreaterThan(poses[3]!.rotation);
    expect(poses[3]!.rotation).toBeGreaterThan(0);
    expect(poses[0]!.rotation).toBeCloseTo(-poses[4]!.rotation);
  });

  it('legt die Karten in einen Bogen: Ränder tiefer als die Mitte', () => {
    const poses = fanLayout(5);
    expect(poses[2]!.y).toBe(HAND_FAN.baseY);
    expect(poses[0]!.y).toBeGreaterThan(poses[1]!.y);
    expect(poses[1]!.y).toBeGreaterThan(poses[2]!.y);
    expect(poses[0]!.y).toBeCloseTo(poses[4]!.y);
  });

  it('überlappt die Karten und rückt bei vielen enger zusammen', () => {
    const step = (count: number) => fanLayout(count)[1]!.x - fanLayout(count)[0]!.x;
    for (const count of [2, 5, HAND_LIMIT]) expect(step(count)).toBeLessThan(HAND_FAN.cardWidth);
    expect(step(HAND_LIMIT)).toBeLessThan(step(5));
    expect(step(HAND_LIMIT)).toBeGreaterThan(0);
  });

  it('stapelt von links nach rechts', () => {
    const z = fanLayout(HAND_LIMIT).map((pose) => pose.z);
    expect(z).toEqual([...z].sort((a, b) => a - b));
    expect(new Set(z).size).toBe(HAND_LIMIT);
  });

  it('lässt die Hand bei maximaler Größe über der unteren Leiste enden', () => {
    for (const pose of fanLayout(HAND_LIMIT)) expect(bounds(pose).bottom).toBeLessThan(590);
  });
});

describe('liftedPose', () => {
  const poses = fanLayout(5);

  it('ohne Anhebung bleibt die Ruhelage', () => {
    expect(liftedPose(poses[0]!, 0, 5)).toEqual(poses[0]);
  });

  it('hebt nach oben, stellt gerade und legt die Karte vor alle Nachbarn', () => {
    const rest = poses[0]!;
    const lifted = liftedPose(rest, 1, 5);
    expect(lifted.y).toBeLessThan(rest.y);
    expect(lifted.rotation).toBeCloseTo(0);
    expect(lifted.scale).toBeGreaterThan(1);
    for (const other of poses) expect(lifted.z).toBeGreaterThan(other.z);
  });

  it('bleibt auch angehoben im Bild', () => {
    for (const pose of fanLayout(HAND_LIMIT)) {
      const box = bounds(liftedPose(pose, 1, HAND_LIMIT));
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(HAND_FAN.areaWidth);
    }
  });
});

describe('cardAt', () => {
  const poses = fanLayout(5);

  it('trifft in der Überlappung die oberste, also rechte Karte', () => {
    // Linker Rand von Karte 1 liegt noch auf Karte 0: Dort gewinnt Karte 1.
    const second = poses[1]!;
    const x = second.x - 20;
    expect(poseContains(poses[0]!, x, second.y)).toBe(true);
    expect(cardAt(poses, x, second.y)).toBe(1);
  });

  it('trifft den sichtbaren Streifen einer verdeckten Karte', () => {
    const first = poses[0]!;
    expect(cardAt(poses, first.x - 30, first.y)).toBe(0);
  });

  it('liefert null neben der Hand', () => {
    expect(cardAt(poses, 5, 5)).toBeNull();
    expect(cardAt(poses, poses[2]!.x, poses[2]!.y + HAND_FAN.cardHeight)).toBeNull();
  });

  it('berücksichtigt die Neigung: eine Ecke des ungedrehten Rechtecks liegt daneben', () => {
    const edge = poses[0]!;
    const cornerX = edge.x - HAND_FAN.cardWidth / 2 + 1;
    const cornerY = edge.y - HAND_FAN.cardHeight / 2 + 1;
    expect(poseContains({ ...edge, rotation: 0 }, cornerX, cornerY)).toBe(true);
    expect(poseContains(edge, cornerX, cornerY)).toBe(false);
  });

  it('bevorzugt die angehobene Karte, auch wenn sie links liegt', () => {
    const lifted = poses.map((pose, slot) => (slot === 0 ? liftedPose(pose, 1, 5) : pose));
    const point = lifted[0]!;
    expect(cardAt(lifted, point.x + 25, point.y)).toBe(0);
  });

  it('überspringt nicht treffbare Karten und trifft die darunterliegende', () => {
    const second = poses[1]!;
    const x = second.x - 20;
    expect(cardAt(poses, x, second.y, (slot) => slot !== 1)).toBe(0);
  });
});

describe('detailLayout', () => {
  it('ist mindestens doppelt so breit wie eine Handkarte', () => {
    const detail = detailLayout();
    expect(detail.width).toBeGreaterThanOrEqual(HAND_FAN.cardWidth * DETAIL_MIN_SCALE);
    expect(detail.scale).toBeGreaterThanOrEqual(DETAIL_MIN_SCALE);
    expect(detail.width).toBe(DETAIL_WIDTH);
  });

  it('behält das Seitenverhältnis der Handkarte', () => {
    const detail = detailLayout();
    expect(detail.width / detail.height).toBeCloseTo(HAND_FAN.cardWidth / HAND_FAN.cardHeight, 6);
    expect(detail.height).toBeCloseTo(HAND_FAN.cardHeight * detail.scale, 6);
  });

  it('passt mit Rand vollständig in die Spielfläche und liegt waagerecht mittig', () => {
    const detail = detailLayout();
    expect(detail.x).toBe(DETAIL_VIEW.width / 2);
    expect(detail.x - detail.width / 2).toBeGreaterThanOrEqual(DETAIL_MARGIN);
    expect(detail.x + detail.width / 2).toBeLessThanOrEqual(DETAIL_VIEW.width - DETAIL_MARGIN);
    expect(detail.y - detail.height / 2).toBeGreaterThanOrEqual(DETAIL_MARGIN);
    expect(detail.y + detail.height / 2).toBeLessThanOrEqual(DETAIL_VIEW.height - DETAIL_MARGIN);
  });

  it('schrumpft auf einer kleinen Fläche, bleibt aber innerhalb der Ränder', () => {
    const view = { width: 200, height: 400 };
    const detail = detailLayout(view);
    expect(detail.width).toBe(view.width - 2 * DETAIL_MARGIN);
    expect(detail.y + detail.height / 2).toBeLessThanOrEqual(view.height - DETAIL_MARGIN);
    const tall = detailLayout({ width: 360, height: 200 });
    expect(tall.height).toBeLessThanOrEqual(200 - 2 * DETAIL_MARGIN);
    expect(tall.width / tall.height).toBeCloseTo(HAND_FAN.cardWidth / HAND_FAN.cardHeight, 6);
  });
});

describe('Glanzband', () => {
  const sweepMs = GLINT.periodMs * GLINT.sweepFraction;

  it('läuft von 0 bis 1 und pausiert danach', () => {
    expect(glintProgress(0)).toBe(0);
    expect(glintProgress(sweepMs / 2)).toBeCloseTo(0.5, 6);
    expect(glintProgress(sweepMs)).toBeNull();
    expect(glintProgress(GLINT.periodMs - 1)).toBeNull();
    expect(glintProgress(GLINT.periodMs + sweepMs / 2)).toBeCloseTo(0.5, 6);
    expect(glintProgress(-GLINT.periodMs + 10)).toBeCloseTo(10 / sweepMs, 6);
  });

  it('liefert in der Pause kein Vieleck', () => {
    expect(glintPolygon(220, 308, sweepMs + 1)).toEqual([]);
  });

  it('beginnt und endet außerhalb der Karte', () => {
    expect(glintPolygon(220, 308, 0)).toEqual([]);
    // Kurz vor dem Ende ist nur noch ein Splitter am rechten Rand übrig.
    const sliver = glintPolygon(220, 308, sweepMs - 1);
    for (const p of sliver) expect(p.x).toBeGreaterThan(220 / 2 - 5);
  });

  it('bleibt in der Kartenfläche und wandert nach rechts', () => {
    const width = 220;
    const height = 308;
    const centers = [0.25, 0.5, 0.75].map((share) => {
      const polygon = glintPolygon(width, height, sweepMs * share);
      expect(polygon.length).toBeGreaterThanOrEqual(3);
      for (const p of polygon) {
        expect(p.x).toBeGreaterThanOrEqual(-width / 2 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(width / 2 + 1e-9);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(height / 2 + 1e-9);
      }
      return polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    });
    expect(centers[0]!).toBeLessThan(centers[1]!);
    expect(centers[1]!).toBeLessThan(centers[2]!);
  });

  it('ist ein schräges Band: oben und unten liegt es versetzt', () => {
    const polygon = glintPolygon(220, 308, sweepMs * 0.5);
    const top = polygon.filter((p) => p.y === -154);
    const bottom = polygon.filter((p) => p.y === 154);
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    expect(Math.min(...bottom.map((p) => p.x))).toBeGreaterThan(Math.min(...top.map((p) => p.x)));
  });

  it('wird mit kleinerem Anteil schmaler', () => {
    const area = (points: { x: number; y: number }[]): number =>
      Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length]!.y - points[(i + 1) % points.length]!.x * p.y, 0)) / 2;
    const wide = glintPolygon(220, 308, sweepMs * 0.5, 0.3);
    const narrow = glintPolygon(220, 308, sweepMs * 0.5, 0.1);
    expect(area(narrow)).toBeLessThan(area(wide));
  });
});
