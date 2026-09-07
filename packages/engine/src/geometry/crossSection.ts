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

export interface OpeningProof {
  /** True when the item is proven to pass the opening, with no search involved. */
  passes: boolean;
  /** Which axis of the item's bounding box leads through: 0 = x, 1 = y, 2 = z. */
  travelAxis?: 0 | 1 | 2;
  /** The two dimensions that choice presents to the opening. */
  presented?: [number, number];
}

/**
 * A closed-form, search-free proof that an item **does** pass an opening.
 *
 * This is the other direction from `provableNoFit`, and the direction the
 * bounding box is actually good for. The item sits rigidly inside its bounding
 * box, so any motion that carries the box through carries the item through with
 * it. If the box goes, the item goes.
 *
 * The converse does not hold and must not be assumed. A bounding box that
 * cannot pass proves **nothing**: a non-convex item can thread an opening its
 * box could never enter, by leading with a thin part and turning as the thick
 * part arrives, so that its full cross-section is never in the doorway plane at
 * one time. This is not a technicality. The sofa fixture's mid-length section
 * is an L — a seat and a leaning backrest — 95 cm across as authored but 66 cm
 * across when rolled 111 degrees, and its bounding box is 95 either way.
 *
 * So a failure here is a **hint**, never a verdict: it says a straight walk
 * through will not do it and a threading path may be needed. The only thing
 * allowed to report a negative is `provableNoFit`, whose argument runs the
 * other way — per box, on central sections, sound over all of SO(3).
 *
 * The test: the box travels along one of its three axes, presenting the other
 * two, and a `p x q` rectangle enters a `W x H` opening axis-aligned if
 * `(p <= W and q <= H)` or `(q <= W and p <= H)`.
 *
 * Two deliberate conservatisms, both in the safe direction for a positive
 * screen — they can only make it decline to fire, never fire wrongly:
 *
 * - **Axis-aligned only.** A rectangle tilted in the opening's plane genuinely
 *   can fit where the axis-aligned placement does not, and this engine has the
 *   exact criterion for it in `rectangleFitsInRectangle`, brute-force verified.
 *   Using it here would make this screen strictly stronger. It is left out
 *   because a tilted entry is a maneuver rather than a straight walk-through,
 *   and this function's job is to certify the easy case cheaply.
 * - **The item's authored frame.** The bounding box is taken as the author drew
 *   it. Some other orientation may have a smaller box.
 *
 * And what it proves is about the **opening**, not about the environment: it
 * says the aperture admits the item, not that a path to it exists. A hallway
 * too narrow to line the item up in still has no path, which is exactly the
 * `narrow-hallway` fixture — a 110 cm opening this screen passes, and no route.
 */
export function openingAdmits(
  dimensions: readonly [number, number, number],
  openingWidth: number,
  openingHeight: number,
): OpeningProof {
  for (let axis = 0; axis < 3; axis++) {
    const p = dimensions[((axis + 1) % 3) as 0 | 1 | 2];
    const q = dimensions[((axis + 2) % 3) as 0 | 1 | 2];
    const fits =
      (p <= openingWidth + EPSILON && q <= openingHeight + EPSILON) ||
      (q <= openingWidth + EPSILON && p <= openingHeight + EPSILON);
    if (fits) return { passes: true, travelAxis: axis as 0 | 1 | 2, presented: [p, q] };
  }
  return { passes: false };
}
