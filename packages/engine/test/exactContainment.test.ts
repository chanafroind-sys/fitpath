import { describe, expect, it } from 'vitest';
import type { Box, Item } from '../src/types.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import { SLIM_ARM_2_SEAT } from '../src/fixtures/sofas.ts';
import { radians } from '../src/math/rotation.ts';
import { uncontainedRegions } from './support/exactContainment.ts';

/**
 * The containment checker, checked.
 *
 * It is the subsystem's one safety invariant, and an invariant whose checker
 * silently answers "fine" to everything is worse than no invariant at all — it
 * is a green light with the bulb removed. So this file spends most of its length
 * on cases that must FAIL, and only a little on cases that must pass.
 */

function span(
  label: string,
  x: readonly [number, number],
  y: readonly [number, number],
  z: readonly [number, number],
  roll = 0,
): Box {
  return {
    center: { x: (x[0] + x[1]) / 2, y: (y[0] + y[1]) / 2, z: (z[0] + z[1]) / 2 },
    halfExtents: { x: (x[1] - x[0]) / 2, y: (y[1] - y[0]) / 2, z: (z[1] - z[0]) / 2 },
    rotation: { yaw: 0, pitch: 0, roll },
    label,
    labelHe: label,
  };
}

const item = (id: string, ...boxes: Box[]): Item => ({ id, name: id, nameHe: id, boxes });

const leaked = (regions: readonly { volumeCm3: number }[]): number =>
  regions.reduce((sum, region) => sum + region.volumeCm3, 0);

describe('exact containment: cases that must pass', () => {
  it('finds nothing when the reference is strictly inside the candidate', () => {
    const reference = item('inner', span('inner', [-10, 10], [-10, 10], [0, 10]));
    const candidate = item('outer', span('outer', [-20, 20], [-20, 20], [0, 20]));

    expect(uncontainedRegions(reference, candidate)).toEqual([]);
  });

  it('finds nothing when the two are the same box', () => {
    const box = span('same', [-10, 10], [-10, 10], [0, 10]);

    expect(uncontainedRegions(item('a', box), item('b', box))).toEqual([]);
  });

  /** The candidate may need several boxes to cover one of the reference's. */
  it('finds nothing when the cover is split across candidate boxes', () => {
    const reference = item('slab', span('slab', [-10, 10], [-5, 5], [0, 10]));
    const candidate = item(
      'halves',
      span('left', [-10, 0], [-5, 5], [0, 10]),
      span('right', [0, 10], [-5, 5], [0, 10]),
    );

    expect(uncontainedRegions(reference, candidate)).toEqual([]);
  });

  /** Faces that merely touch are not a leak — the engine's contact convention. */
  it('treats a flush face as covered rather than as a hairline leak', () => {
    const reference = item('slab', span('slab', [-10, 10], [-5, 5], [0, 10]));
    const candidate = item('exact', span('exact', [-10, 10], [-5, 5], [0, 10]));

    expect(uncontainedRegions(reference, candidate)).toEqual([]);
  });
});

describe('exact containment: cases that must fail', () => {
  it('reports the exact volume of a corner that sticks out', () => {
    const reference = item('big', span('big', [0, 10], [0, 10], [0, 10]));
    const candidate = item('small', span('small', [0, 8], [0, 10], [0, 10]));

    const leaks = uncontainedRegions(reference, candidate);
    expect(leaks).not.toEqual([]);
    expect(leaked(leaks)).toBeCloseTo(2 * 10 * 10, 9);
    expect(leaks.every((leak) => leak.exact)).toBe(true);
  });

  /**
   * The case a sampled grid gets wrong, made concrete.
   *
   * Reference material sits in one corner of a 2 cm neighbourhood and candidate
   * material in the opposite corner. They do not overlap at all, but a sampler
   * that asks "is this cell occupied" of each in turn sees both as occupied and
   * calls it contained. The exact check sees a total miss.
   */
  it('catches a reference and a candidate that interleave without overlapping', () => {
    const reference = item('speck', span('speck', [0, 0.5], [0, 0.5], [0, 0.5]));
    const candidate = item('elsewhere', span('elsewhere', [1.5, 2], [1.5, 2], [1.5, 2]));

    const leaks = uncontainedRegions(reference, candidate);
    expect(leaked(leaks)).toBeCloseTo(0.125, 9);
  });

  /** A hole in the middle is still a hole, even with the outside fully covered. */
  it('catches a hole enclosed on every side', () => {
    const reference = item('solid', span('solid', [0, 30], [0, 30], [0, 30]));
    const candidate = item(
      'ring',
      span('below', [0, 30], [0, 30], [0, 10]),
      span('above', [0, 30], [0, 30], [20, 30]),
      span('front', [0, 30], [0, 10], [0, 30]),
      span('back', [0, 30], [20, 30], [0, 30]),
      span('left', [0, 10], [0, 30], [0, 30]),
      span('right', [20, 30], [0, 30], [0, 30]),
    );

    expect(leaked(uncontainedRegions(reference, candidate))).toBeCloseTo(10 * 10 * 10, 9);
  });

  /**
   * **The Vetle plinth: the counterexample that decided the seat box's depth.**
   *
   * The brief's original sketch made the seat box as deep as the *published seat
   * depth* rather than the overall depth, which puts a void under the backrest.
   * That model is built here by hand and checked against the real Vetle, whose
   * plinth is 76 cm deep behind a 75 cm seat. The plinth falls straight through
   * the void — 16,128 cm3 of real furniture outside the model — and this is the
   * assertion that keeps anyone from re-introducing that hollow later.
   */
  it('catches the plinth falling through a seat box cut to the published seat depth', () => {
    // The Vetle is 160 x 90 x 80, seat height 46, published seat depth 75, so
    // the derived backrest band is 15 cm and its front face is at y = 30.
    const shallowSeat = item(
      'vetle-with-a-hollow-rear',
      span('the seat', [-80, 80], [-45, 30], [0, 46]),
      span('the backrest', [-80, 80], [30, 45], [46, 80]),
      span('the armrests', [-80, -72], [-45, 30], [46, 58]),
      span('the armrests', [72, 80], [-45, 30], [46, 58]),
    );

    const leaks = uncontainedRegions(SLIM_ARM_2_SEAT, shallowSeat);
    const plinth = leaks.filter((leak) => leak.referenceLabel === 'the plinth');

    expect(plinth).not.toEqual([]);
    // x 144 wide, the 8 cm of plinth behind the seat box, 14 cm tall.
    expect(leaked(plinth)).toBeCloseTo(144 * 8 * 14, 9);
  });
});

describe('exact containment: the rotated fixtures', () => {
  /**
   * Two fixtures lean their backrests, so the reference is not axis-aligned and
   * the check has to stay exact anyway. It does, by cutting the reference's
   * bounds on the candidate's own face planes — which leaves cells that are each
   * wholly inside or wholly outside the candidate — and then asking the engine's
   * SAT whether any *uncovered* cell holds rotated material. `satOverlap` counts
   * exact touching as no overlap, which is precisely "positive volume".
   */
  it.each([
    ['sofa-3-seat', SOFA_3_SEAT],
    ['slim-arm-2-seat', SLIM_ARM_2_SEAT],
  ] as const)('has a rotated box in %s, so this path is the one that matters', (_id, fixture) => {
    const rotated = fixture.boxes.filter(
      (box) => box.rotation.roll !== 0 || box.rotation.pitch !== 0 || box.rotation.yaw !== 0,
    );

    expect(rotated).not.toEqual([]);
    expect(rotated.every((box) => box.label === 'the backrest')).toBe(true);
  });

  it('contains a leaning backrest inside its own bounding box', () => {
    const leaning = item('back', span('the backrest', [-100, 100], [-9, 9], [-30, 30], radians(-12)));
    // The rolled box's bounds: half-depth and half-height grow as it leans.
    const bounds = item('bounds', span('bounds', [-100, 100], [-15.1, 15.1], [-31.3, 31.3]));

    expect(uncontainedRegions(leaning, bounds)).toEqual([]);
  });

  it('catches a leaning backrest whose top corner is clipped off', () => {
    const leaning = item('back', span('the backrest', [-100, 100], [-9, 9], [-30, 30], radians(-12)));
    // Two centimetres short at the top, which only the leaning corner reaches.
    const clipped = item('bounds', span('bounds', [-100, 100], [-15.1, 15.1], [-31.3, 29.3]));

    const leaks = uncontainedRegions(leaning, clipped);
    expect(leaks).not.toEqual([]);
    expect(leaks.every((leak) => leak.exact)).toBe(false);
  });

  /**
   * The one thing the decomposition genuinely cannot do.
   *
   * Cutting on face planes only partitions space when the faces are axis
   * aligned. Every box this pipeline produces is, so the restriction costs
   * nothing — but it is enforced rather than assumed, because degrading quietly
   * to something approximate is the failure this whole file exists to prevent.
   */
  it('refuses a rotated candidate instead of approximating one', () => {
    const reference = item('slab', span('slab', [-10, 10], [-5, 5], [0, 10]));
    const tilted = item('tilted', span('tilted', [-20, 20], [-20, 20], [0, 20], radians(5)));

    expect(() => uncontainedRegions(reference, tilted)).toThrow(/axis-aligned candidate/);
  });
});
