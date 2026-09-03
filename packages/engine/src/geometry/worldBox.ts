import type { AxisBox, Box, Placement, Vec3, WorldBox } from '../types.ts';
import { IDENTITY, multiply, rotationFrom, rotationMatrix, transform } from '../math/rotation.ts';
import { component } from '../math/vec3.ts';

/**
 * Place one of an item's boxes into world space.
 *
 * The box carries its own orientation inside the item (a backrest is pitched
 * about 12 degrees relative to the seat). Folding that into the placement here,
 * once, means every downstream consumer — SAT, broad phase, the goal test —
 * only ever deals with a single world orientation per box and never has to know
 * that items have internal structure.
 */
export function toWorldBox(box: Box, placement: Placement): WorldBox {
  // Roll is structurally 0 for a Placement; passing it explicitly rather than
  // omitting it keeps the one place that decides this visible.
  const placementRotation = rotationMatrix(placement.yaw, placement.pitch, 0);
  const axes = multiply(placementRotation, rotationFrom(box.rotation));

  const offset = transform(placementRotation, box.center);
  const center: Vec3 = {
    x: placement.x + offset.x,
    y: placement.y + offset.y,
    z: placement.z + offset.z,
  };

  return finishWorldBox(center, axes, box.halfExtents);
}

/**
 * Fill in the quantities every consumer needs but nobody should recompute:
 * the bounding-sphere radius and the world AABB.
 *
 * They are derived here rather than lazily because the broad phase runs
 * millions of times and a lazily-filled field would mean a branch, a write and
 * a megamorphic shape change in the hottest loop in the engine.
 */
function finishWorldBox(
  center: Vec3,
  axes: readonly [Vec3, Vec3, Vec3],
  halfExtents: Vec3,
): WorldBox {
  // The sphere that contains the box is centred on it with radius equal to the
  // half-diagonal, which is rotation-invariant — that invariance is exactly why
  // spheres are the cheapest useful first rejection.
  const radius = Math.sqrt(
    halfExtents.x * halfExtents.x +
      halfExtents.y * halfExtents.y +
      halfExtents.z * halfExtents.z,
  );

  // The AABB half-extent along world axis k is the sum over the box's own axes
  // of |component of that axis along k| * half extent: each local axis
  // contributes its full length projected onto k, and the worst-case corner
  // takes every contribution with the same sign.
  const ex =
    Math.abs(axes[0].x) * halfExtents.x +
    Math.abs(axes[1].x) * halfExtents.y +
    Math.abs(axes[2].x) * halfExtents.z;
  const ey =
    Math.abs(axes[0].y) * halfExtents.x +
    Math.abs(axes[1].y) * halfExtents.y +
    Math.abs(axes[2].y) * halfExtents.z;
  const ez =
    Math.abs(axes[0].z) * halfExtents.x +
    Math.abs(axes[1].z) * halfExtents.y +
    Math.abs(axes[2].z) * halfExtents.z;

  return {
    center,
    axes,
    halfExtents,
    radius,
    aabbMin: { x: center.x - ex, y: center.y - ey, z: center.z - ez },
    aabbMax: { x: center.x + ex, y: center.y + ey, z: center.z + ez },
  };
}

/**
 * A world-axis-aligned solid, expressed as a WorldBox with identity axes.
 *
 * The environment is built entirely from these. Keeping them in the same type
 * as item boxes means one collision routine covers both, instead of an
 * AABB-vs-OBB special case that would have to be kept in agreement with the
 * general one.
 */
export function axisAlignedSolid(bounds: AxisBox): WorldBox {
  const center: Vec3 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const halfExtents: Vec3 = {
    x: (bounds.maxX - bounds.minX) / 2,
    y: (bounds.maxY - bounds.minY) / 2,
    z: (bounds.maxZ - bounds.minZ) / 2,
  };
  return finishWorldBox(center, IDENTITY, halfExtents);
}

/** Smallest full dimension of a box: the value the anti-tunnelling bound cares about. */
export function minimumDimension(box: WorldBox): number {
  return 2 * Math.min(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z);
}

/** Union of AABBs, used to bound a whole item without transforming it twice. */
export function unionAabb(boxes: readonly WorldBox[]): AxisBox {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const b of boxes) {
    if (b.aabbMin.x < minX) minX = b.aabbMin.x;
    if (b.aabbMin.y < minY) minY = b.aabbMin.y;
    if (b.aabbMin.z < minZ) minZ = b.aabbMin.z;
    if (b.aabbMax.x > maxX) maxX = b.aabbMax.x;
    if (b.aabbMax.y > maxY) maxY = b.aabbMax.y;
    if (b.aabbMax.z > maxZ) maxZ = b.aabbMax.z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Full dimensions of a box, sorted ascending — the cross-section proof needs them in that order. */
export function sortedDimensions(box: Box): [number, number, number] {
  const dims: [number, number, number] = [
    2 * box.halfExtents.x,
    2 * box.halfExtents.y,
    2 * box.halfExtents.z,
  ];
  dims.sort((a, b) => a - b);
  return dims;
}

/** Distance of a box's furthest corner from the item's local origin, for the broad phase. */
export function boxReach(box: Box): number {
  const rotated = rotationFrom(box.rotation);
  // The corner offsets are +/- halfExtents along the box's own axes; the
  // furthest is the one that adds every contribution in the same direction.
  let reach = 0;
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const corner = transform(rotated, {
          x: sx * box.halfExtents.x,
          y: sy * box.halfExtents.y,
          z: sz * box.halfExtents.z,
        });
        const dx = box.center.x + corner.x;
        const dy = box.center.y + corner.y;
        const dz = box.center.z + corner.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > reach) reach = d;
      }
    }
  }
  return reach;
}

/** Read an AxisBox bound by axis index, mirroring `component` for Vec3. */
export function axisBounds(box: AxisBox, axis: number): [number, number] {
  if (axis === 0) return [box.minX, box.maxX];
  if (axis === 1) return [box.minY, box.maxY];
  return [box.minZ, box.maxZ];
}

/** True when `inner` lies wholly inside `outer`, with a tolerance in centimetres. */
export function contains(outer: AxisBox, inner: AxisBox, tolerance = 0): boolean {
  return (
    inner.minX >= outer.minX - tolerance &&
    inner.maxX <= outer.maxX + tolerance &&
    inner.minY >= outer.minY - tolerance &&
    inner.maxY <= outer.maxY + tolerance &&
    inner.minZ >= outer.minZ - tolerance &&
    inner.maxZ <= outer.maxZ + tolerance
  );
}

/** Vec3 component accessor re-exported so geometry code has one import for it. */
export { component };
