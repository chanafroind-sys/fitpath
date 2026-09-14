/**
 * Exact containment: is every cubic centimetre of one item inside another?
 *
 * This is the single safety invariant of the sourcing subsystem, so it does not
 * rest on sampling. A sampled grid marks a cell occupied if *anything* touches
 * it, on both sides of the comparison, so real material near one corner of a
 * cell and model material near the opposite corner both register as occupied
 * and containment passes when it has actually failed. That error runs in the
 * fatal direction — a hole in the model is how a planner comes to answer "it
 * fits" about a sofa that will not go through — so it is computed exactly here.
 *
 * ## How it is exact with a rotated reference box
 *
 * Every box the pipeline produces is axis-aligned (asserted below, not assumed).
 * Two of the hand-authored fixtures are not: the three-seat sofa's backrest and
 * the Vetle's are rolled about their long axis, because a sofa back leans. So
 * the method has to be exact for an oriented reference box against an
 * axis-aligned candidate, and it is:
 *
 * 1. Take every face plane of every candidate box, per axis, clipped to the
 *    reference box's own bounding box. Those planes cut the reference box's
 *    bounds into a non-uniform grid of cells.
 * 2. Because *every* candidate face is a cell boundary, each candidate box
 *    either contains a given cell whole or misses its interior entirely. So a
 *    cell is covered by the candidate, or it is not; there is no partial case,
 *    and no approximation has been made.
 * 3. Containment fails exactly when some uncovered cell holds reference
 *    material with positive volume. For an axis-aligned reference box that is a
 *    clip, and the leaked volume comes out exact. For a rotated one it is a box
 *    against a box, which is what the engine's own SAT decides — and `satOverlap`
 *    already treats exact touching as not overlapping, which is precisely the
 *    "positive volume" test wanted here.
 *
 * The only tolerance anywhere is the engine's own EPSILON (1e-9 cm), applied
 * with the engine's own convention that contact is not overlap. A leak thinner
 * than that is not a leak; it is the floating-point noise floor.
 */

import type { AxisBox, Box, Item, Placement } from '../../src/types.ts';
import { EPSILON, satOverlap } from '../../src/geometry/sat.ts';
import { axisAlignedSolid, toWorldBox } from '../../src/geometry/worldBox.ts';

/** An item's own local frame, expressed as a placement that changes nothing. */
const AT_ORIGIN: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

export interface Uncontained {
  /** Index of the reference box that has material outside the candidate. */
  referenceBoxIndex: number;
  referenceLabel: string | undefined;
  /** The region that leaked. Axis-aligned, because the candidate's faces cut it. */
  cell: AxisBox;
  /**
   * Volume of the leak.
   *
   * Exact when the reference box is axis-aligned. When it is rotated this is the
   * cell's own volume, which is an upper bound on the leak — the leak is known
   * to be positive, and the report only ever needs to say "there is one".
   */
  volumeCm3: number;
  exact: boolean;
}

function isAxisAligned(box: Box): boolean {
  return box.rotation.yaw === 0 && box.rotation.pitch === 0 && box.rotation.roll === 0;
}

function boundsOf(box: Box): AxisBox {
  const world = toWorldBox(box, AT_ORIGIN);
  return {
    minX: world.aabbMin.x,
    maxX: world.aabbMax.x,
    minY: world.aabbMin.y,
    maxY: world.aabbMax.y,
    minZ: world.aabbMin.z,
    maxZ: world.aabbMax.z,
  };
}

/** Cut planes on one axis: the candidate's faces, clipped to the reference's span. */
function cutsBetween(low: number, high: number, faces: readonly number[]): number[] {
  const inside = faces.filter((face) => face > low + EPSILON && face < high - EPSILON);
  const all = [low, ...inside, high].sort((a, b) => a - b);
  // Collapse faces that coincide, so no zero-width cell is ever produced.
  return all.filter((value, index) => index === 0 || value - all[index - 1]! > EPSILON);
}

function covers(outer: AxisBox, cell: AxisBox): boolean {
  return (
    outer.minX <= cell.minX + EPSILON &&
    outer.maxX >= cell.maxX - EPSILON &&
    outer.minY <= cell.minY + EPSILON &&
    outer.maxY >= cell.maxY - EPSILON &&
    outer.minZ <= cell.minZ + EPSILON &&
    outer.maxZ >= cell.maxZ - EPSILON
  );
}

/** Overlap of two axis boxes on one axis, or 0 when they merely touch. */
function overlapOn(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const span = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return span > EPSILON ? span : 0;
}

/**
 * Every region of `reference` that lies outside `candidate`.
 *
 * An empty result is the claim the subsystem lives or dies by: the produced
 * model is a geometric superset of the real furniture, so it can be too
 * pessimistic about a doorway but never too optimistic.
 *
 * Throws if the candidate is not made of axis-aligned boxes — the decomposition
 * above depends on it, and silently degrading to something approximate is the
 * one thing this file exists to prevent.
 */
export function uncontainedRegions(reference: Item, candidate: Item): Uncontained[] {
  const rotated = candidate.boxes.findIndex((box) => !isAxisAligned(box));
  if (rotated >= 0) {
    throw new Error(
      `exact containment needs an axis-aligned candidate, but box ${rotated} ` +
        `("${candidate.boxes[rotated]!.label ?? 'unlabelled'}") is rotated`,
    );
  }

  const candidateBounds = candidate.boxes.map(boundsOf);
  const faces = {
    x: candidateBounds.flatMap((b) => [b.minX, b.maxX]),
    y: candidateBounds.flatMap((b) => [b.minY, b.maxY]),
    z: candidateBounds.flatMap((b) => [b.minZ, b.maxZ]),
  };

  const leaks: Uncontained[] = [];

  for (const [index, box] of reference.boxes.entries()) {
    const bounds = boundsOf(box);
    const axisAligned = isAxisAligned(box);
    const solid = axisAligned ? undefined : toWorldBox(box, AT_ORIGIN);

    const xs = cutsBetween(bounds.minX, bounds.maxX, faces.x);
    const ys = cutsBetween(bounds.minY, bounds.maxY, faces.y);
    const zs = cutsBetween(bounds.minZ, bounds.maxZ, faces.z);

    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < ys.length; j++) {
        for (let k = 0; k + 1 < zs.length; k++) {
          const cell: AxisBox = {
            minX: xs[i]!,
            maxX: xs[i + 1]!,
            minY: ys[j]!,
            maxY: ys[j + 1]!,
            minZ: zs[k]!,
            maxZ: zs[k + 1]!,
          };
          if (candidateBounds.some((outer) => covers(outer, cell))) continue;

          if (axisAligned) {
            // The reference box IS its bounds, so the leak is a clip and its
            // volume is exact.
            const dx = overlapOn(cell.minX, cell.maxX, bounds.minX, bounds.maxX);
            const dy = overlapOn(cell.minY, cell.maxY, bounds.minY, bounds.maxY);
            const dz = overlapOn(cell.minZ, cell.maxZ, bounds.minZ, bounds.maxZ);
            if (dx === 0 || dy === 0 || dz === 0) continue;
            leaks.push({
              referenceBoxIndex: index,
              referenceLabel: box.label,
              cell,
              volumeCm3: dx * dy * dz,
              exact: true,
            });
          } else {
            // A rotated reference box against an axis-aligned cell: the engine's
            // own SAT, whose contact convention already means "positive volume".
            if (!satOverlap(solid!, axisAlignedSolid(cell))) continue;
            leaks.push({
              referenceBoxIndex: index,
              referenceLabel: box.label,
              cell,
              volumeCm3: (cell.maxX - cell.minX) * (cell.maxY - cell.minY) * (cell.maxZ - cell.minZ),
              exact: false,
            });
          }
        }
      }
    }
  }

  return leaks;
}

/** A one-line description of a leak, for a failure message worth reading. */
export function describeLeak(leak: Uncontained): string {
  const { cell } = leak;
  return (
    `${leak.exact ? '' : 'up to '}${leak.volumeCm3.toFixed(2)} cm3 of ` +
    `"${leak.referenceLabel ?? `box ${leak.referenceBoxIndex}`}" is outside the model, in ` +
    `x [${cell.minX.toFixed(2)}, ${cell.maxX.toFixed(2)}] ` +
    `y [${cell.minY.toFixed(2)}, ${cell.maxY.toFixed(2)}] ` +
    `z [${cell.minZ.toFixed(2)}, ${cell.maxZ.toFixed(2)}]`
  );
}
