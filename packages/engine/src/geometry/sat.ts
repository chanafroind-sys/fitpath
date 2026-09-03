import type { WorldBox } from '../types.ts';

/**
 * The single shared tolerance for every geometric comparison in the engine, in
 * centimetres.
 *
 * Why this value. Our coordinates are room-sized: a few hundred centimetres, so
 * magnitudes reach ~1e3. The projections in the SAT below are sums of a handful
 * of products of such numbers, so the accumulated double-precision error is on
 * the order of 1e3 * 2^-52, roughly 1e-13 cm. EPSILON sits four orders of
 * magnitude above that noise floor, so it never mistakes rounding for contact,
 * and eight orders below a millimetre, so it never hides a gap or an overlap
 * that any tape measure — or any doorway — could tell apart.
 *
 * A single constant rather than per-call-site tolerances because a mismatched
 * pair of epsilons is exactly how a geometry kernel starts reporting that a box
 * both does and does not touch a wall depending on which routine asked.
 */
export const EPSILON = 1e-9;

/**
 * Separating Axis Theorem for two oriented boxes.
 *
 * Two convex bodies are disjoint if and only if some axis exists on which their
 * projections do not overlap. For two boxes it is enough to test 15 candidates:
 * the 3 face normals of A, the 3 face normals of B, and the 9 cross products of
 * one edge direction from each. Face normals catch face-vertex separations;
 * the cross products catch edge-edge separations, which no face normal sees.
 *
 * Contact convention: exact touching counts as NOT overlapping. A sofa that
 * grazes the door jamb goes through, and a wall built flush against the floor
 * must not report that it collides with the floor. Concretely, an axis
 * separates when the projected gap exceeds -EPSILON, so up to EPSILON of
 * interpenetration is forgiven.
 *
 * Implementation note: the 15 axes are not built as vectors. Every projection
 * radius and centre distance can be read off the 3x3 matrix of dot products
 * between the two boxes' axes, which turns 15 vector constructions plus 90 dot
 * products into one 3x3 matrix and some indexing. It is the same 15 axes, in
 * the same order, with the arithmetic done once instead of per axis.
 */
export function satOverlap(a: WorldBox, b: WorldBox): boolean {
  // r[i][j] = dot(a.axes[i], b.axes[j]). Because both frames are orthonormal,
  // this matrix is itself a rotation, which is what makes the cross-product
  // radii below collapse to two terms each.
  const r: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const absR: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    const ai = a.axes[i]!;
    for (let j = 0; j < 3; j++) {
      const bj = b.axes[j]!;
      const v = ai.x * bj.x + ai.y * bj.y + ai.z * bj.z;
      r[i]![j] = v;
      absR[i]![j] = Math.abs(v);
    }
  }

  // Centre offset, expressed in A's frame, so A's own projections are trivial.
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const dz = b.center.z - a.center.z;
  const t: [number, number, number] = [
    dx * a.axes[0].x + dy * a.axes[0].y + dz * a.axes[0].z,
    dx * a.axes[1].x + dy * a.axes[1].y + dz * a.axes[1].z,
    dx * a.axes[2].x + dy * a.axes[2].y + dz * a.axes[2].z,
  ];

  const ah: [number, number, number] = [a.halfExtents.x, a.halfExtents.y, a.halfExtents.z];
  const bh: [number, number, number] = [b.halfExtents.x, b.halfExtents.y, b.halfExtents.z];

  // Axes 1-3: A's face normals. These are unit vectors, so the tolerance is
  // EPSILON as-is.
  for (let i = 0; i < 3; i++) {
    const ra = ah[i]!;
    const rb = bh[0]! * absR[i]![0]! + bh[1]! * absR[i]![1]! + bh[2]! * absR[i]![2]!;
    if (Math.abs(t[i]!) - (ra + rb) > -EPSILON) return false;
  }

  // Axes 4-6: B's face normals, also unit.
  for (let j = 0; j < 3; j++) {
    const ra = ah[0]! * absR[0]![j]! + ah[1]! * absR[1]![j]! + ah[2]! * absR[2]![j]!;
    const rb = bh[j]!;
    const distance = Math.abs(t[0]! * r[0]![j]! + t[1]! * r[1]![j]! + t[2]! * r[2]![j]!);
    if (distance - (ra + rb) > -EPSILON) return false;
  }

  // Axes 7-15: cross products of one edge direction from each box.
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;

      // |a.axes[i] x b.axes[j]|^2 = 1 - dot(a.axes[i], b.axes[j])^2, because
      // both are unit vectors. When the two edge directions are parallel the
      // cross product vanishes and carries no information at all.
      const lengthSquared = 1 - r[i]![j]! * r[i]![j]!;
      if (lengthSquared < EPSILON * EPSILON) {
        // Skipping is safe, not a shortcut: when an edge of A is parallel to an
        // edge of B, any separation that this degenerate axis could have
        // witnessed is already witnessed by one of the six face normals — the
        // two boxes share an edge direction, so their configuration is
        // effectively a 2D problem in the perpendicular plane, and face normals
        // are complete there. Testing the near-zero vector instead would divide
        // signal by noise and report contact between boxes that are metres
        // apart.
        continue;
      }
      const axisLength = Math.sqrt(lengthSquared);

      const ra = ah[i1]! * absR[i2]![j]! + ah[i2]! * absR[i1]![j]!;
      const rb = bh[j1]! * absR[i]![j2]! + bh[j2]! * absR[i]![j1]!;
      const distance = Math.abs(t[i2]! * r[i1]![j]! - t[i1]! * r[i2]![j]!);

      // The candidate axis is not normalised, so the tolerance must be scaled
      // by its length to stay the same physical distance.
      if (distance - (ra + rb) > -EPSILON * axisLength) return false;
    }
  }

  // No axis separated them, so by the theorem they overlap.
  return true;
}
