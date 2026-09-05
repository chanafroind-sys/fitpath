import { describe, expect, it } from 'vitest';
import { rectangleFitsInRectangle, provableNoFit } from '../src/geometry/crossSection.ts';
import { sortedDimensions } from '../src/geometry/worldBox.ts';
import { REFRIGERATOR, SOFA_3_SEAT, WARDROBE } from '../src/fixtures/items.ts';

/**
 * Brute-force reference for the closed form: sweep the rectangle through a
 * quarter turn and see whether its axis-aligned bounding box ever fits.
 *
 * A quarter turn is enough because the bounding box of a rectangle has period
 * 90 degrees, and the two ends of the sweep are the two axis-aligned placements.
 */
function rectangleFitsByScan(p: number, q: number, a: number, b: number, steps = 90000): boolean {
  for (let i = 0; i <= steps; i++) {
    const theta = (Math.PI / 2) * (i / steps);
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    if (p * c + q * s <= a && p * s + q * c <= b) return true;
  }
  return false;
}

/** How much room to spare the best rotation leaves; negative means it does not fit. */
function bestSlack(p: number, q: number, a: number, b: number, steps = 90000): number {
  let best = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const theta = (Math.PI / 2) * (i / steps);
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    const slack = Math.min(a - (p * c + q * s), b - (p * s + q * c));
    if (slack > best) best = slack;
  }
  return best;
}

/**
 * Half-width of a central section of an axis-aligned box, along a direction in
 * the section plane.
 *
 * Computed by LP duality: max{ p.w : n.p = 0, |p_i| <= h_i } equals
 * min over lambda of sum_i h_i * |w_i - lambda * n_i|. That dual is convex and
 * piecewise linear in lambda, so its minimum sits at one of the breakpoints
 * lambda = w_i / n_i. Three candidates, evaluated exactly — no search, no
 * tolerance, and no polygon clipping to get wrong.
 */
function sectionSupport(h: readonly number[], n: readonly number[], w: readonly number[]): number {
  const candidates: number[] = [0];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(n[i]!) > 1e-12) candidates.push(w[i]! / n[i]!);
  }
  let best = Infinity;
  for (const lambda of candidates) {
    let value = 0;
    for (let i = 0; i < 3; i++) value += h[i]! * Math.abs(w[i]! - lambda * n[i]!);
    if (value < best) best = value;
  }
  return best;
}

/** Does the central section with normal `n` fit inside an a x b rectangle, at any angle? */
function sectionFitsInRectangle(
  halfExtents: readonly number[],
  n: readonly number[],
  a: number,
  b: number,
  steps = 720,
): boolean {
  // Any orthonormal basis of the plane will do; build one from the least
  // aligned world axis so the cross products stay well conditioned.
  const smallest = n.map(Math.abs).indexOf(Math.min(...n.map(Math.abs)));
  const seed = [0, 0, 0];
  seed[smallest] = 1;
  const u = [
    seed[1]! * n[2]! - seed[2]! * n[1]!,
    seed[2]! * n[0]! - seed[0]! * n[2]!,
    seed[0]! * n[1]! - seed[1]! * n[0]!,
  ];
  const ulen = Math.hypot(u[0]!, u[1]!, u[2]!);
  const uh = u.map((c) => c / ulen);
  const v = [
    n[1]! * uh[2]! - n[2]! * uh[1]!,
    n[2]! * uh[0]! - n[0]! * uh[2]!,
    n[0]! * uh[1]! - n[1]! * uh[0]!,
  ];

  for (let i = 0; i < steps; i++) {
    const phi = (Math.PI * i) / steps;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const w1 = [uh[0]! * c + v[0]! * s, uh[1]! * c + v[1]! * s, uh[2]! * c + v[2]! * s];
    const w2 = [-uh[0]! * s + v[0]! * c, -uh[1]! * s + v[1]! * c, -uh[2]! * s + v[2]! * c];
    const extent1 = 2 * sectionSupport(halfExtents, n, w1);
    const extent2 = 2 * sectionSupport(halfExtents, n, w2);
    if (extent1 <= a && extent2 <= b) return true;
    if (extent2 <= a && extent1 <= b) return true;
  }
  return false;
}

describe('rectangleFitsInRectangle', () => {
  it('accepts the plain axis-aligned fit', () => {
    expect(rectangleFitsInRectangle(50, 80, 60, 90)).toBe(true);
  });

  it('rejects when the short side alone is too wide', () => {
    // A rectangle's minimum width over all rotations is its own short side.
    expect(rectangleFitsInRectangle(70, 75, 50, 2000)).toBe(false);
  });

  it('accepts a diagonal fit that no axis-aligned placement allows', () => {
    // A 1 x 20 strip is too long to lie flat in 15 x 15, but it goes in corner
    // to corner: at 45 degrees its bounding box is about 14.85 on a side.
    expect(rectangleFitsInRectangle(1, 20, 15, 15)).toBe(true);
    expect(rectangleFitsByScan(1, 20, 15, 15)).toBe(true);
    // ...and one strip longer does not.
    expect(rectangleFitsInRectangle(1, 22, 15, 15)).toBe(false);
    expect(rectangleFitsByScan(1, 22, 15, 15)).toBe(false);
  });

  it('rejects a near-square that is only just too big', () => {
    // 10 x 14 cannot go into 12 x 12 at any angle: adding the two bounding-box
    // constraints gives 24(cos+sin) <= 24, which only holds axis-aligned.
    expect(rectangleFitsInRectangle(10, 14, 12, 12)).toBe(false);
    expect(rectangleFitsByScan(10, 14, 12, 12)).toBe(false);
  });

  it('agrees with a brute-force angular scan across a grid of shapes', () => {
    const sides = [5, 17, 45, 60, 95, 120, 220];
    let compared = 0;
    for (const p of sides) {
      for (const q of sides) {
        for (const a of sides) {
          for (const b of sides) {
            const slack = bestSlack(p, q, a, b, 20000);
            // Skip cases sitting on the knife edge, where the closed form and a
            // sampled sweep may legitimately disagree: the sampled maximum can
            // sit a fraction of a step below the true one at a kink.
            if (Math.abs(slack) < 1e-2) continue;
            compared++;
            expect(
              rectangleFitsInRectangle(p, q, a, b),
              `${p}x${q} into ${a}x${b} (slack ${slack.toFixed(4)})`,
            ).toBe(slack >= 0);
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });
});

describe('minimal central section of a box', () => {
  /**
   * The pre-check's linchpin: the smallest rectangle that can hold a central
   * section of a box is its smallest face. Verified here over a dense sweep of
   * section normals, for the shapes the engine actually reasons about.
   */
  const shapes: [string, [number, number, number]][] = [
    ['sofa body', [220, 95, 70]],
    ['wardrobe', [180, 60, 220]],
    ['refrigerator', [70, 75, 185]],
    ['cube', [50, 50, 50]],
    ['slab', [200, 200, 4]],
    ['rod', [3, 3, 400]],
  ];

  for (const [label, dims] of shapes) {
    it(`no central section of the ${label} beats its smallest face`, () => {
      const half = dims.map((d) => d / 2);
      const sorted = [...dims].sort((a, b) => a - b);
      const [d1, d2] = sorted as [number, number, number];
      const margin = 0.5;

      // The face itself is achievable: take the normal along the longest side.
      const longestAxis = dims.indexOf(Math.max(...dims));
      const faceNormal = [0, 0, 0];
      faceNormal[longestAxis] = 1;
      expect(sectionFitsInRectangle(half, faceNormal, d1, d2)).toBe(true);

      // And nothing does better: sweep normals over a hemisphere.
      for (let i = 0; i <= 24; i++) {
        const polar = (Math.PI / 2) * (i / 24);
        for (let j = 0; j < 48; j++) {
          const azimuth = (2 * Math.PI * j) / 48;
          const n = [
            Math.sin(polar) * Math.cos(azimuth),
            Math.sin(polar) * Math.sin(azimuth),
            Math.cos(polar),
          ];
          expect(
            sectionFitsInRectangle(half, n, d1 - margin, d2 - margin),
            `${label} section at polar ${polar.toFixed(3)} azimuth ${azimuth.toFixed(3)}`,
          ).toBe(false);
        }
      }
    });
  }
});

describe('provableNoFit', () => {
  it('proves the refrigerator cannot pass a 50 cm opening', () => {
    // Its smallest cross-section is 70 x 75; no rotation makes 70 into 50.
    const proof = provableNoFit(REFRIGERATOR.boxes, 50, 200);
    expect(proof.proven).toBe(true);
    expect(proof.crossSection).toEqual([70, 75]);
  });

  it('does not fire for the refrigerator at a normal doorway', () => {
    expect(provableNoFit(REFRIGERATOR.boxes, 80, 200).proven).toBe(false);
  });

  it('does not fire for the sofa at a low opening — that is a search question', () => {
    // Every individual box of the sofa is small enough to cross the plane; the
    // difficulty is getting the assembled item through, which no closed form
    // decides.
    expect(provableNoFit(SOFA_3_SEAT.boxes, 120, 78).proven).toBe(false);
  });

  it('proves the wardrobe cannot pass an opening narrower than its 60 cm depth', () => {
    const proof = provableNoFit(WARDROBE.boxes, 55, 210);
    expect(proof.proven).toBe(true);
    expect(proof.crossSection).toEqual([60, 180]);
  });
});

/**
 * The single most common real query: a three-seat sofa against a standard
 * 76 cm interior door.
 *
 * It is tempting to settle this in closed form — the sofa is 85 cm across at
 * its narrowest and the door is 76 cm — but that reasoning is about the item's
 * convex hull, and the hull is not what has to fit through the hole. What has
 * to fit is the item's SECTION at the instant it crosses the wall plane, and a
 * sofa is not convex: a plane through its seating well cuts an L-shaped profile
 * roughly 95 x 70, which turned on its side clears a 76 x 210 doorway.
 *
 * So the honest answer is that this scene is a search question, not a proof
 * question, and `provableNoFit` must decline it. Reporting "proven" here would
 * be the one failure mode this engine is built to avoid.
 */
describe('a sofa at a standard 76 cm door', () => {
  const DOOR_WIDTH = 76;
  const DOOR_HEIGHT = 210;

  it('is not proven impossible, because no single box is too large', () => {
    expect(provableNoFit(SOFA_3_SEAT.boxes, DOOR_WIDTH, DOOR_HEIGHT).proven).toBe(false);
  });

  it('names the box that comes closest: the seat block, at 40 x 80', () => {
    // The widest "smallest face" in the item is what the per-box argument turns
    // on, and it is the seat block. That is the threshold below.
    const faces = SOFA_3_SEAT.boxes.map((box) => sortedDimensions(box).slice(0, 2) as [number, number]);
    const widest = faces.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(widest).toEqual([40, 80]);
  });

  it('fires just below that threshold and declines just above it', () => {
    // 39 cm cannot take the seat block's 40 x 80 face at any angle; 40 cm can,
    // and then every other box fits too, so nothing is proven.
    const below = provableNoFit(SOFA_3_SEAT.boxes, 39, DOOR_HEIGHT);
    expect(below.proven).toBe(true);
    expect(below.crossSection).toEqual([40, 80]);

    expect(provableNoFit(SOFA_3_SEAT.boxes, 40, DOOR_HEIGHT).proven).toBe(false);
  });

  it('stays undecided across the whole range of ordinary interior doors', () => {
    for (let width = 40; width <= 100; width++) {
      expect(`${width}:${provableNoFit(SOFA_3_SEAT.boxes, width, DOOR_HEIGHT).proven}`)
        .toBe(`${width}:false`);
    }
  });
});
