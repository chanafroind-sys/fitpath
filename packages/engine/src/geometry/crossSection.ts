import type { Box, Environment } from '../types.ts';
import { sortedDimensions } from './worldBox.ts';
import { EPSILON } from './sat.ts';

/**
 * Can a p x q rectangle be placed inside an a x b rectangle, at any angle?
 *
 * The tilted case is the one that matters and the one people get wrong: a
 * rectangle slightly too long to lie flat can still fit corner to corner. The
 * closed form below is the standard criterion; `rectangleFitsByScan` in the
 * tests re-derives the same answers by brute force so that a transcription slip
 * in the algebra cannot quietly widen every doorway in the engine.
 *
 * Both pairs are sorted first, because the predicate is symmetric under
 * swapping a rectangle's own sides.
 */
export function rectangleFitsInRectangle(p: number, q: number, a: number, b: number): boolean {
  const [small, large] = p <= q ? [p, q] : [q, p];
  const [width, height] = a <= b ? [a, b] : [b, a];

  // The axis-aligned placement. Also the only one available when the rectangle
  // already fits, so it is checked first and costs nothing.
  if (small <= width + EPSILON && large <= height + EPSILON) return true;

  // A rectangle's minimum width over all rotations is its own short side, so if
  // the short side does not fit the container's short side, no angle helps.
  if (small > width + EPSILON) return false;

  // Only the tilted case is left: the rectangle is too long to lie flat.
  const numerator =
    2 * small * large * width +
    (large * large - small * small) * Math.sqrt(small * small + large * large - width * width);
  const denominator = small * small + large * large;
  return height + EPSILON >= numerator / denominator;
}

export interface NoFitProof {
  /** True when passage is impossible for geometric reasons, with no search involved. */
  proven: boolean;
  /** Index into the box list that was checked. */
  boxIndex?: number;
  /** The two smallest dimensions of that box: its minimal cross-section. */
  crossSection?: [number, number];
}

/**
 * A closed-form, search-free proof that an item cannot pass an opening.
 *
 * The argument:
 *   1. To reach the room, every box of the item must cross the wall. Pick any
 *      plane strictly inside the wall slab. The box's centre starts on the
 *      hallway side of that plane and ends on the room side, so at some instant
 *      the centre lies exactly on it.
 *   2. At that instant the box's intersection with the plane is a *central*
 *      section of the box, and it must lie inside the opening rectangle,
 *      because everything else in that plane is solid wall.
 *   3. The smallest rectangle that can contain a central section of a box is
 *      its smallest face — the two smallest dimensions. (Verified numerically
 *      over a dense sweep of section normals in the tests.)
 *   4. The item's section contains that box's section, so if the box's smallest
 *      face cannot fit the opening at any angle, neither can the item.
 *
 * The proof never fixes an orientation, so it holds over all of SO(3) — it is
 * not limited to the roll-free model the planner searches. It also treats the
 * wall as a single plane, which is the sound direction: failing a
 * zero-thickness hole implies failing a hole with depth.
 *
 * It assumes the item is one connected rigid piece, which is what "a piece of
 * furniture" means here.
 */
export function provableNoFit(
  boxes: readonly Box[],
  openingWidth: number,
  openingHeight: number,
): NoFitProof {
  for (let i = 0; i < boxes.length; i++) {
    const [d1, d2] = sortedDimensions(boxes[i]!);
    if (!rectangleFitsInRectangle(d1, d2, openingWidth, openingHeight)) {
      return { proven: true, boxIndex: i, crossSection: [d1, d2] };
    }
  }
  return { proven: false };
}

/** The same proof, taking the opening's measurements from an environment. */
export function provableNoFitInEnvironment(
  boxes: readonly Box[],
  environment: Environment,
): NoFitProof {
  return provableNoFit(
    boxes,
    environment.params.openingWidth,
    environment.params.openingHeight,
  );
}

/**
 * The smallest opening width, to the centimetre, at which the closed-form proof
 * stops firing.
 *
 * Diagnostics use this to tell "the opening is too small, full stop" apart from
 * "the opening is fine, something else is in the way" without running a search.
 */
export function smallestWidthPassingProof(
  boxes: readonly Box[],
  openingHeight: number,
  maxWidth: number,
): number | undefined {
  for (let width = 1; width <= maxWidth; width++) {
    if (!provableNoFit(boxes, width, openingHeight).proven) return width;
  }
  return undefined;
}
