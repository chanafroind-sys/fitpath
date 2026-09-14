/**
 * A deterministic occupancy sampler, for **describing** how tight a model is.
 *
 * This file does not decide anything about safety. Containment — "is every
 * cubic centimetre of the real sofa inside the model" — is the subsystem's one
 * invariant and it is computed exactly, in `exactContainment.ts`. A sampled grid
 * cannot answer that question soundly in the safe direction: a cell counts as
 * occupied when anything touches it, on both sides of a comparison, so material
 * near one corner and model near the opposite corner both register and a real
 * leak passes unseen.
 *
 * What sampling is good for is a volume, and volumes are what the comparison
 * table reports. Two items modelled as unions of overlapping boxes cannot have
 * their volumes added up box by box — a sofa's armrests would count twice
 * against its base — and an exact union volume of *rotated* boxes needs a
 * polygon-clipping kernel this repository has no business growing. So the table
 * is sampled, on one grid, for every column.
 *
 * The grid is fixed rather than random: same models in, same numbers out, which
 * is the engine's rule and not a preference. It is also sized to tile the
 * bounding box exactly — the step on each axis is the extent divided by a whole
 * number of cells — so the sampled volume of a plain bounding box equals its
 * arithmetic volume to the last digit, and no column of the table is inflated
 * relative to another by a trailing partial layer of cells. Samples sit at a
 * fixed fraction into each cell, chosen so that no sample lands on a face:
 * every fixture coordinate in this repository is a multiple of 0.5, and a point
 * exactly on a shared boundary would answer according to floating-point noise
 * rather than according to the geometry.
 */

import type { Box, Item, Vec3 } from '../../src/types.ts';
import { rotationFrom } from '../../src/math/rotation.ts';

/** Upper bound on the sample spacing. The real step is the extent divided by a whole number of cells. */
export const MAX_SAMPLE_STEP_CM = 2;

/** Where in each cell the sample sits, as a fraction. Not 0.5, so it misses every face. */
const CELL_FRACTION = 0.4137;

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

function boxCorners(box: Box): Vec3[] {
  const m = rotationFrom(box.rotation);
  const h = box.halfExtents;
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push({
          x: box.center.x + m[0].x * sx * h.x + m[1].x * sy * h.y + m[2].x * sz * h.z,
          y: box.center.y + m[0].y * sx * h.x + m[1].y * sy * h.y + m[2].y * sz * h.z,
          z: box.center.z + m[0].z * sx * h.x + m[1].z * sy * h.y + m[2].z * sz * h.z,
        });
      }
    }
  }
  return out;
}

/** The world-axis-aligned bounds of an item in its own local frame. */
export function itemAabb(item: Item): Aabb {
  let min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  let max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const box of item.boxes) {
    for (const corner of boxCorners(box)) {
      min = { x: Math.min(min.x, corner.x), y: Math.min(min.y, corner.y), z: Math.min(min.z, corner.z) };
      max = { x: Math.max(max.x, corner.x), y: Math.max(max.y, corner.y), z: Math.max(max.z, corner.z) };
    }
  }
  return { min, max };
}

export function extentsOf(item: Item): { widthCm: number; depthCm: number; heightCm: number } {
  const { min, max } = itemAabb(item);
  return { widthCm: max.x - min.x, depthCm: max.y - min.y, heightCm: max.z - min.z };
}

function pointInBox(p: Vec3, box: Box): boolean {
  const m = rotationFrom(box.rotation);
  const dx = p.x - box.center.x;
  const dy = p.y - box.center.y;
  const dz = p.z - box.center.z;
  // The matrix columns are the box's own axes as world directions, so projecting
  // the offset onto each column is exactly the point in the box's local frame.
  const lx = dx * m[0].x + dy * m[0].y + dz * m[0].z;
  const ly = dx * m[1].x + dy * m[1].y + dz * m[1].z;
  const lz = dx * m[2].x + dy * m[2].y + dz * m[2].z;
  return (
    Math.abs(lx) <= box.halfExtents.x &&
    Math.abs(ly) <= box.halfExtents.y &&
    Math.abs(lz) <= box.halfExtents.z
  );
}

export function occupied(p: Vec3, item: Item): boolean {
  return item.boxes.some((box) => pointInBox(p, box));
}

/** Shift every box of an item, so two models of one sofa can be laid on top of each other. */
export function translated(item: Item, by: Vec3): Item {
  return {
    ...item,
    boxes: item.boxes.map((box) => ({
      ...box,
      center: { x: box.center.x + by.x, y: box.center.y + by.y, z: box.center.z + by.z },
    })),
  };
}

/**
 * Put `item` in `reference`'s frame by matching their bounding-box corners.
 *
 * The catalogue does not agree with itself about where an item's origin sits —
 * the three-seat sofa puts it at the top of the legs so that "remove the legs"
 * leaves a body that still rests on the floor, while the rest put it on the
 * floor. Aligning by bounds rather than by origin compares the two drawings of
 * the same physical sofa instead of comparing two conventions.
 */
export function alignedTo(item: Item, reference: Item): Item {
  const a = itemAabb(item);
  const b = itemAabb(reference);
  // Centres in plan, floors in z. That is how the two would actually stand next
  // to each other: both are centred on their own footprint, and both rest on the
  // ground. It matters only when the two differ in size — when a listing
  // under-reports a width, or when the model's skin has been grown to absorb
  // that — and matching minima there would slide the model sideways and blame
  // the geometry for an artefact of the comparison.
  return translated(item, {
    x: (b.min.x + b.max.x) / 2 - (a.min.x + a.max.x) / 2,
    y: (b.min.y + b.max.y) / 2 - (a.min.y + a.max.y) / 2,
    z: b.min.z - a.min.z,
  });
}

interface Grid {
  counts: readonly [number, number, number];
  steps: readonly [number, number, number];
  cellCm3: number;
  min: Vec3;
}

/** A grid that tiles [min, max] exactly, with no cell wider than `MAX_SAMPLE_STEP_CM`. */
function gridOver(min: Vec3, max: Vec3): Grid {
  const count = (extent: number): number => Math.max(1, Math.ceil(extent / MAX_SAMPLE_STEP_CM));
  const counts = [count(max.x - min.x), count(max.y - min.y), count(max.z - min.z)] as const;
  const steps = [
    (max.x - min.x) / counts[0],
    (max.y - min.y) / counts[1],
    (max.z - min.z) / counts[2],
  ] as const;
  return { counts, steps, cellCm3: steps[0] * steps[1] * steps[2], min };
}

function sampleAt(grid: Grid, i: number, j: number, k: number): Vec3 {
  return {
    x: grid.min.x + (i + CELL_FRACTION) * grid.steps[0],
    y: grid.min.y + (j + CELL_FRACTION) * grid.steps[1],
    z: grid.min.z + (k + CELL_FRACTION) * grid.steps[2],
  };
}

function unionBounds(a: Item, b: Item): Aabb {
  const x = itemAabb(a);
  const y = itemAabb(b);
  return {
    min: { x: Math.min(x.min.x, y.min.x), y: Math.min(x.min.y, y.min.y), z: Math.min(x.min.z, y.min.z) },
    max: { x: Math.max(x.max.x, y.max.x), y: Math.max(x.max.y, y.max.y), z: Math.max(x.max.z, y.max.z) },
  };
}

export interface Comparison {
  /**
   * Volume of the sampled region: the union bounding box.
   *
   * Because the grid tiles that box exactly, this equals its arithmetic volume,
   * which makes it the honest denominator for "what would the three dimensions
   * alone have scored" and keeps every column of the table on one method.
   */
  boundingCm3: number;
  /** Sampled volume of the reference. */
  referenceCm3: number;
  /** Sampled volume of the candidate. */
  candidateCm3: number;
  /** Sampled volume the candidate carved away: `boundingCm3 - candidateCm3`, by construction. */
  carvedCm3: number;
  /** Sampled volume the candidate has and the reference does not: the price of not knowing. */
  surplusCm3: number;
}

/**
 * Sampled volumes for two items already in the same frame.
 *
 * Descriptive only. Whether the candidate contains the reference is decided in
 * `exactContainment.ts`, not here.
 */
export function compareOccupancy(candidate: Item, reference: Item): Comparison {
  const { min, max } = unionBounds(candidate, reference);
  const grid = gridOver(min, max);

  let referenceCount = 0;
  let candidateCount = 0;
  let surplusCount = 0;
  let cells = 0;

  for (let i = 0; i < grid.counts[0]; i++) {
    for (let j = 0; j < grid.counts[1]; j++) {
      for (let k = 0; k < grid.counts[2]; k++) {
        const p = sampleAt(grid, i, j, k);
        cells += 1;
        const inReference = occupied(p, reference);
        const inCandidate = occupied(p, candidate);
        if (inReference) referenceCount += 1;
        if (inCandidate) candidateCount += 1;
        if (inCandidate && !inReference) surplusCount += 1;
      }
    }
  }

  const boundingCm3 = cells * grid.cellCm3;
  const candidateCm3 = candidateCount * grid.cellCm3;
  return {
    boundingCm3,
    referenceCm3: referenceCount * grid.cellCm3,
    candidateCm3,
    carvedCm3: boundingCm3 - candidateCm3,
    surplusCm3: surplusCount * grid.cellCm3,
  };
}

/**
 * Where the surplus is, bucketed by a caller-supplied name for each point.
 *
 * "The model is 20% too solid" is not actionable; "the extra 20% is all under
 * the seat" names the field to go and ask for. The caller supplies the labels
 * because only it knows what the regions of its own model mean.
 *
 * Returns cubic centimetres per label, largest first.
 */
export function surplusByRegion(
  candidate: Item,
  reference: Item,
  label: (p: Vec3) => string,
): readonly { region: string; volumeCm3: number }[] {
  const { min, max } = unionBounds(candidate, reference);
  const grid = gridOver(min, max);

  const counts = new Map<string, number>();
  for (let i = 0; i < grid.counts[0]; i++) {
    for (let j = 0; j < grid.counts[1]; j++) {
      for (let k = 0; k < grid.counts[2]; k++) {
        const p = sampleAt(grid, i, j, k);
        if (!occupied(p, candidate) || occupied(p, reference)) continue;
        const key = label(p);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .map(([region, count]) => ({ region, volumeCm3: count * grid.cellCm3 }))
    // Ties broken by name, so the order does not depend on Map insertion order.
    .sort((l, r) => r.volumeCm3 - l.volumeCm3 || l.region.localeCompare(r.region));
}
