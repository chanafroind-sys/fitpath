import type { Box, Item } from '../types.ts';
import { rotationFrom } from '../math/rotation.ts';

/**
 * How wide the item is, in the direction it is thinnest.
 *
 * ## What this is for, and what it is emphatically NOT for
 *
 * This is a **triage measurement**. It decides whether a search is worth
 * starting. It must never decide an answer, and nothing here may be used to
 * justify the word "proven".
 *
 * The tempting argument — "the item is 85 cm across at its narrowest and the
 * opening is only 76 cm, so it cannot possibly go through" — is **false** for a
 * non-convex body. `test/hullWidth.test.ts` contains the counterexample: a
 * helix whose convex hull is 86 cm at its narrowest screws cleanly through a
 * 60 cm opening, the way a bolt goes through a nut, and the engine's own
 * `collides` confirms every placement along that motion is clear. A body can be
 * far larger than a hole in every direction and still thread it, because what
 * has to fit through the hole is the body's *section* at each instant, and the
 * section of a non-convex body can be arbitrarily smaller than the body.
 *
 * The sound closed-form refutation lives in `crossSection.ts` and works on
 * sections, not on hulls. This file is the estimate that keeps a hopeless scene
 * from costing seven seconds before the planner admits it does not know.
 *
 * ## What it computes
 *
 * The width of a convex body in direction `u` is the gap between its two
 * supporting planes perpendicular to `u`, and it depends only on the body's
 * extreme points — so the box corners are enough and no hull needs building.
 * The minimum is taken over a fixed lattice of directions on the hemisphere
 * (width is symmetric under `u -> -u`).
 *
 * **The sampled minimum is an upper bound on the true minimum**, because a
 * minimum over a subset of directions cannot be smaller than the minimum over
 * all of them. It converges from above as the sampling is refined. For the
 * fixtures here it is exact at every density tried, because their thinnest
 * direction is an axis; for an item whose thinnest direction is oblique the
 * figure can read slightly high. Since the only consumer is a decision about
 * how much time to spend, reading slightly high costs a search that would
 * probably have failed anyway.
 *
 * Deterministic: a fixed direction lattice, no randomness, same input to the
 * last bit on every machine.
 */

/** Directions per quarter-turn of latitude. 48 gives about 5,900 directions. */
const DEFAULT_RESOLUTION = 48;

/** Every corner of every box, in the item's own frame. */
function cornerPoints(boxes: readonly Box[]): Float64Array {
  const out = new Float64Array(boxes.length * 8 * 3);
  let at = 0;
  for (const box of boxes) {
    const m = rotationFrom(box.rotation);
    const { x: hx, y: hy, z: hz } = box.halfExtents;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ax = sx * hx;
          const ay = sy * hy;
          const az = sz * hz;
          out[at++] = box.center.x + m[0].x * ax + m[1].x * ay + m[2].x * az;
          out[at++] = box.center.y + m[0].y * ax + m[1].y * ay + m[2].y * az;
          out[at++] = box.center.z + m[0].z * ax + m[1].z * ay + m[2].z * az;
        }
      }
    }
  }
  return out;
}

/**
 * The smallest width of the boxes' convex hull, over a fixed lattice of
 * directions. See the file comment: an upper bound, and never a proof.
 */
export function convexHullMinimumWidth(
  boxes: readonly Box[],
  resolution: number = DEFAULT_RESOLUTION,
): number {
  if (boxes.length === 0) return 0;
  const points = cornerPoints(boxes);
  const count = points.length / 3;

  let best = Infinity;
  const bands = Math.max(1, Math.floor(resolution));

  // The upper hemisphere, latitude band by latitude band. Longitude samples are
  // scaled by sin(theta) so the directions stay roughly evenly spread rather
  // than crowding at the pole.
  for (let i = 0; i <= bands; i++) {
    const cosT = i / bands;
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const rings = Math.max(1, Math.round(4 * bands * sinT));
    for (let j = 0; j < rings; j++) {
      const phi = (j / rings) * 2 * Math.PI;
      const nx = sinT * Math.cos(phi);
      const ny = sinT * Math.sin(phi);
      const nz = cosT;

      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < count; k++) {
        const d = points[k * 3]! * nx + points[k * 3 + 1]! * ny + points[k * 3 + 2]! * nz;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
      const width = hi - lo;
      if (width < best) best = width;
    }
  }
  return best;
}

/**
 * Whether a scene is worth searching at all.
 *
 * A **heuristic**, and the distinction matters enough to repeat: `'hopeless'`
 * is not a verdict and not a proof. It means "the planner is very unlikely to
 * find anything here, and finding out costs seconds". A caller that reports it
 * to a person must say the search was skipped, not that the item does not fit.
 *
 * `outlook` is about the item **exactly as authored**, because that is the
 * search that is about to run. A removable part is reported separately, in
 * `relievedBy`: taking the sofa's legs off drops it from 85 cm to 70 cm, which
 * turns a hopeless 76 cm doorway into one worth trying. Folding that into
 * `outlook` would be answering a different question from the one asked, and
 * would send the planner off to spend seven seconds on the legs-on item that
 * the measurement already says is too fat.
 */
export interface PassageOutlook {
  outlook: 'hopeless' | 'worth-searching';
  /** Minimum hull width of the item as authored. */
  hullMinimumWidth: number;
  /** The dimension the item has to get past however it is turned. */
  openingSmallerSide: number;
  /**
   * A removable part whose absence would bring the item under
   * `openingSmallerSide`. Present only when one actually does.
   */
  relievedBy?: {
    part: string;
    partHe: string;
    hullMinimumWidth: number;
  };
}

export function passageOutlook(
  item: Item,
  openingWidth: number,
  openingHeight: number,
  resolution: number = DEFAULT_RESOLUTION,
): PassageOutlook {
  const hullMinimumWidth = convexHullMinimumWidth(item.boxes, resolution);
  const openingSmallerSide = Math.min(openingWidth, openingHeight);

  let relievedBy: PassageOutlook['relievedBy'];
  for (const part of item.removableParts ?? []) {
    const excluded = new Set(part.boxIndices);
    const kept = item.boxes.filter((_, index) => !excluded.has(index));
    if (kept.length === 0) continue;
    const width = convexHullMinimumWidth(kept, resolution);
    if (width <= openingSmallerSide && (relievedBy === undefined || width < relievedBy.hullMinimumWidth)) {
      relievedBy = { part: part.name, partHe: part.nameHe, hullMinimumWidth: width };
    }
  }

  return {
    outlook: hullMinimumWidth > openingSmallerSide ? 'hopeless' : 'worth-searching',
    hullMinimumWidth,
    openingSmallerSide,
    ...(relievedBy !== undefined ? { relievedBy } : {}),
  };
}
