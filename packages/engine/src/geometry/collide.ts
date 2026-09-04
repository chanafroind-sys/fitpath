import type { Box, Environment, Item, Placement, Vec3, WorldBox } from '../types.ts';
import { multiply, rotationFrom, rotationMatrix, transform } from '../math/rotation.ts';
import { boxReach } from './worldBox.ts';
import { satOverlap } from './sat.ts';

/** Somewhere to count work without threading a return value through every call. */
export interface CollisionCounter {
  collisionChecks: number;
}

/**
 * An item with the per-item constants the hot loop would otherwise recompute
 * millions of times, plus the box subset currently in play.
 *
 * The subset matters because diagnostics re-plan with a removable part taken
 * off. Modelling that as a filtered box list rather than a mutated Item keeps
 * the original fixture immutable, which is one less way for a diagnostic run to
 * change the answer of the run that follows it.
 */
export interface PreparedItem {
  item: Item;
  boxes: readonly Box[];
  /** Pre-rotated box orientations, so a placement only composes one matrix per box. */
  boxRotations: readonly ReturnType<typeof rotationFrom>[];
  /**
   * Distance from the item's local origin to its furthest corner.
   *
   * Rotation-invariant, because rotating about the origin cannot change a
   * distance measured from the origin. That invariance is what lets a single
   * precomputed number bound the item at every one of the millions of
   * orientations the planner tries.
   */
  reach: number;
  /** Per-box version of the same, for the second-level rejection. */
  boxReaches: readonly number[];
}

export function prepareItem(item: Item, excludeBoxIndices?: readonly number[]): PreparedItem {
  const excluded = excludeBoxIndices ? new Set(excludeBoxIndices) : undefined;
  const boxes = item.boxes.filter((_, i) => !excluded?.has(i));
  const boxRotations = boxes.map((b) => rotationFrom(b.rotation));
  const boxReaches = boxes.map(boxReach);
  const reach = boxReaches.reduce((m, r) => Math.max(m, r), 0);
  return { item, boxes, boxRotations, reach, boxReaches };
}

function asPrepared(item: Item | PreparedItem): PreparedItem {
  return 'boxes' in item && 'reach' in item ? (item as PreparedItem) : prepareItem(item as Item);
}

/** Transform every box of the item into world space at the given placement. */
export function itemWorldBoxes(item: Item | PreparedItem, placement: Placement): WorldBox[] {
  const prepared = asPrepared(item);
  // One placement rotation for the whole item: it is identical for every box,
  // and building it per box was the single largest avoidable cost in the
  // planner's inner loop.
  const placementRotation = rotationMatrix(placement.yaw, placement.pitch, 0);

  const out: WorldBox[] = [];
  for (let i = 0; i < prepared.boxes.length; i++) {
    const box = prepared.boxes[i]!;
    const axes = multiply(placementRotation, prepared.boxRotations[i]!);
    const offset = transform(placementRotation, box.center);
    const center: Vec3 = {
      x: placement.x + offset.x,
      y: placement.y + offset.y,
      z: placement.z + offset.z,
    };
    const h = box.halfExtents;
    const radius = Math.sqrt(h.x * h.x + h.y * h.y + h.z * h.z);
    const ex = Math.abs(axes[0].x) * h.x + Math.abs(axes[1].x) * h.y + Math.abs(axes[2].x) * h.z;
    const ey = Math.abs(axes[0].y) * h.x + Math.abs(axes[1].y) * h.y + Math.abs(axes[2].y) * h.z;
    const ez = Math.abs(axes[0].z) * h.x + Math.abs(axes[1].z) * h.y + Math.abs(axes[2].z) * h.z;
    out.push({
      center,
      axes,
      halfExtents: h,
      radius,
      aabbMin: { x: center.x - ex, y: center.y - ey, z: center.z - ez },
      aabbMax: { x: center.x + ex, y: center.y + ey, z: center.z + ez },
    });
  }
  return out;
}

/**
 * Squared distance from a point to a world-axis-aligned box.
 *
 * The first rejection in the broad phase: if the item's bounding sphere does
 * not reach a solid at all, nothing about the item's orientation can make it
 * touch, and that single test discards most of the environment for most
 * placements.
 */
function pointToAabbDistanceSquared(p: Vec3, box: WorldBox): number {
  let d = 0;
  if (p.x < box.aabbMin.x) d += (box.aabbMin.x - p.x) ** 2;
  else if (p.x > box.aabbMax.x) d += (p.x - box.aabbMax.x) ** 2;
  if (p.y < box.aabbMin.y) d += (box.aabbMin.y - p.y) ** 2;
  else if (p.y > box.aabbMax.y) d += (p.y - box.aabbMax.y) ** 2;
  if (p.z < box.aabbMin.z) d += (box.aabbMin.z - p.z) ** 2;
  else if (p.z > box.aabbMax.z) d += (p.z - box.aabbMax.z) ** 2;
  return d;
}

/**
 * AABBs overlap, with the same contact convention as SAT: touching is not
 * overlapping, so a strict comparison is what we want and no epsilon is needed
 * here. This test is only a filter; SAT makes the final call.
 */
function aabbOverlap(a: WorldBox, b: WorldBox): boolean {
  return (
    a.aabbMin.x < b.aabbMax.x &&
    a.aabbMax.x > b.aabbMin.x &&
    a.aabbMin.y < b.aabbMax.y &&
    a.aabbMax.y > b.aabbMin.y &&
    a.aabbMin.z < b.aabbMax.z &&
    a.aabbMax.z > b.aabbMin.z
  );
}

/**
 * Does the item, placed like this, hit anything?
 *
 * Three tiers, cheapest first, because the planner asks this question tens of
 * millions of times and the answer is usually "no, and not even close":
 *   1. the item's whole bounding sphere against the solid's AABB,
 *   2. each box's bounding sphere against the solid's,
 *   3. AABB against AABB, then full SAT.
 * Returns on the first genuine overlap; there is never a reason to find the
 * second one.
 */
export function collides(
  item: Item | PreparedItem,
  placement: Placement,
  environment: Environment,
  counter?: CollisionCounter,
): boolean {
  const prepared = asPrepared(item);
  if (counter) counter.collisionChecks++;

  const origin: Vec3 = { x: placement.x, y: placement.y, z: placement.z };
  const solids = environment.solids;

  // Tier 1 is done per solid before any box is transformed, so a placement far
  // from a given solid costs six comparisons rather than a matrix multiply.
  const nearby: WorldBox[] = [];
  const reachSquared = prepared.reach * prepared.reach;
  for (let s = 0; s < solids.length; s++) {
    const solid = solids[s]!;
    if (pointToAabbDistanceSquared(origin, solid) <= reachSquared) nearby.push(solid);
  }
  if (nearby.length === 0) return false;

  const boxes = itemWorldBoxes(prepared, placement);
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!;
    for (let s = 0; s < nearby.length; s++) {
      const solid = nearby[s]!;
      const dx = solid.center.x - box.center.x;
      const dy = solid.center.y - box.center.y;
      const dz = solid.center.z - box.center.z;
      const sum = box.radius + solid.radius;
      if (dx * dx + dy * dy + dz * dz > sum * sum) continue;
      if (!aabbOverlap(box, solid)) continue;
      if (satOverlap(box, solid)) return true;
    }
  }
  return false;
}
