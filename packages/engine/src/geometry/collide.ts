import type { AxisBox, Box, Environment, Item, Placement, Vec3, WorldBox } from '../types.ts';
import { multiply, placementRotation, rotationFrom, transform } from '../math/rotation.ts';
import { boxReach } from './worldBox.ts';
import { EPSILON, satOverlap } from './sat.ts';

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
 *
 * The flat arrays exist because `collides` is the single hottest function in
 * the engine — tens of millions of calls for one plan — and the object-per-box
 * version spent most of its time allocating short-lived vectors. Same maths,
 * same results (there is a test asserting the two agree), roughly five times
 * the throughput.
 */
export interface PreparedItem {
  item: Item;
  boxes: readonly Box[];
  /**
   * Distance from the item's local origin to its furthest corner.
   *
   * Rotation-invariant, because rotating about the origin cannot change a
   * distance measured from the origin. That invariance is what lets a single
   * precomputed number bound the item at every one of the millions of
   * orientations the planner tries.
   */
  reach: number;
  boxReaches: readonly number[];

  /**
   * The item's bounding box in its OWN frame, before any placement.
   *
   * Pivot moves are anchored on its bottom face: the edges and corners an item
   * actually rests and tips on. Taking them from the local box rather than the
   * world AABB keeps the pitch pivot exact — pitch turns about the item's local
   * Y, and the local bottom edges parallel to that axis are genuine pivot lines
   * whose every point stays fixed, not merely a point that happens to stay put.
   */
  localBounds: AxisBox;

  /** Number of boxes currently in play. */
  count: number;
  /** Local box centres, 3 per box. */
  localCenter: Float64Array;
  /** Local half extents, 3 per box. */
  half: Float64Array;
  /** Local box orientations as 9 numbers per box: three columns, x/y/z each. */
  localAxes: Float64Array;
  /** Bounding-sphere radius per box. */
  boxRadius: Float64Array;
}

export function prepareItem(item: Item, excludeBoxIndices?: readonly number[]): PreparedItem {
  const excluded = excludeBoxIndices ? new Set(excludeBoxIndices) : undefined;
  const boxes = item.boxes.filter((_, i) => !excluded?.has(i));
  const boxReaches = boxes.map(boxReach);
  const reach = boxReaches.reduce((m, r) => Math.max(m, r), 0);

  const count = boxes.length;
  const localCenter = new Float64Array(count * 3);
  const half = new Float64Array(count * 3);
  const localAxes = new Float64Array(count * 9);
  const boxRadius = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const box = boxes[i]!;
    localCenter[i * 3] = box.center.x;
    localCenter[i * 3 + 1] = box.center.y;
    localCenter[i * 3 + 2] = box.center.z;
    half[i * 3] = box.halfExtents.x;
    half[i * 3 + 1] = box.halfExtents.y;
    half[i * 3 + 2] = box.halfExtents.z;
    const m = rotationFrom(box.rotation);
    for (let c = 0; c < 3; c++) {
      localAxes[i * 9 + c * 3] = m[c]!.x;
      localAxes[i * 9 + c * 3 + 1] = m[c]!.y;
      localAxes[i * 9 + c * 3 + 2] = m[c]!.z;
    }
    boxRadius[i] = Math.hypot(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z);
  }

  const localBounds = localBoundsOf(boxes);

  return {
    item,
    boxes,
    reach,
    boxReaches,
    localBounds,
    count,
    localCenter,
    half,
    localAxes,
    boxRadius,
  };
}

/** Union of the boxes' own axis-aligned extents, in the item's local frame. */
function localBoundsOf(boxes: readonly Box[]): AxisBox {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const box of boxes) {
    const m = rotationFrom(box.rotation);
    const h = box.halfExtents;
    const ex = Math.abs(m[0].x) * h.x + Math.abs(m[1].x) * h.y + Math.abs(m[2].x) * h.z;
    const ey = Math.abs(m[0].y) * h.x + Math.abs(m[1].y) * h.y + Math.abs(m[2].y) * h.z;
    const ez = Math.abs(m[0].z) * h.x + Math.abs(m[1].z) * h.y + Math.abs(m[2].z) * h.z;
    if (box.center.x - ex < minX) minX = box.center.x - ex;
    if (box.center.y - ey < minY) minY = box.center.y - ey;
    if (box.center.z - ez < minZ) minZ = box.center.z - ez;
    if (box.center.x + ex > maxX) maxX = box.center.x + ex;
    if (box.center.y + ey > maxY) maxY = box.center.y + ey;
    if (box.center.z + ez > maxZ) maxZ = box.center.z + ez;
  }
  if (boxes.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function asPrepared(item: Item | PreparedItem): PreparedItem {
  return 'localAxes' in item ? (item as PreparedItem) : prepareItem(item as Item);
}

/**
 * The environment's solids in flat arrays.
 *
 * Cached against the Environment object itself, because diagnostics build a
 * fresh Environment per counterfactual and then hammer it with millions of
 * collision tests; rebuilding these arrays per test would cost more than the
 * tests do.
 */
interface PreparedEnvironment {
  count: number;
  min: Float64Array;
  max: Float64Array;
  center: Float64Array;
  half: Float64Array;
  radius: Float64Array;
}

const environmentCache = new WeakMap<Environment, PreparedEnvironment>();

function prepareEnvironment(environment: Environment): PreparedEnvironment {
  const cached = environmentCache.get(environment);
  if (cached) return cached;

  const solids = environment.solids;
  const count = solids.length;
  const prepared: PreparedEnvironment = {
    count,
    min: new Float64Array(count * 3),
    max: new Float64Array(count * 3),
    center: new Float64Array(count * 3),
    half: new Float64Array(count * 3),
    radius: new Float64Array(count),
  };
  for (let s = 0; s < count; s++) {
    const solid = solids[s]!;
    prepared.min[s * 3] = solid.aabbMin.x;
    prepared.min[s * 3 + 1] = solid.aabbMin.y;
    prepared.min[s * 3 + 2] = solid.aabbMin.z;
    prepared.max[s * 3] = solid.aabbMax.x;
    prepared.max[s * 3 + 1] = solid.aabbMax.y;
    prepared.max[s * 3 + 2] = solid.aabbMax.z;
    prepared.center[s * 3] = solid.center.x;
    prepared.center[s * 3 + 1] = solid.center.y;
    prepared.center[s * 3 + 2] = solid.center.z;
    prepared.half[s * 3] = solid.halfExtents.x;
    prepared.half[s * 3 + 1] = solid.halfExtents.y;
    prepared.half[s * 3 + 2] = solid.halfExtents.z;
    prepared.radius[s] = solid.radius;
  }
  environmentCache.set(environment, prepared);
  return prepared;
}

/**
 * Transform every box of the item into world space at the given placement.
 *
 * The readable, object-returning form. Used by the goal test, the lattice
 * bounds and the step descriptions — everywhere that runs thousands of times
 * rather than millions. `collides` deliberately does not use it.
 */
export function itemWorldBoxes(item: Item | PreparedItem, placement: Placement): WorldBox[] {
  const prepared = asPrepared(item);
  const placementMatrix = placementRotation(placement);

  const out: WorldBox[] = [];
  for (let i = 0; i < prepared.boxes.length; i++) {
    const box = prepared.boxes[i]!;
    const axes = multiply(placementMatrix, rotationFrom(box.rotation));
    const offset = transform(placementMatrix, box.center);
    const center: Vec3 = {
      x: placement.x + offset.x,
      y: placement.y + offset.y,
      z: placement.z + offset.z,
    };
    const h = box.halfExtents;
    const radius = Math.hypot(h.x, h.y, h.z);
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
 * Does the item, placed like this, hit anything?
 *
 * Four tiers, cheapest first, because the planner asks this question tens of
 * millions of times and the answer is nearly always "no, and not even close":
 *   1. the item's whole bounding sphere against each solid's AABB,
 *   2. each box's bounding sphere against the solid's,
 *   3. AABB against AABB,
 *   4. the separating axes that tiers 1-3 have not already ruled out.
 *
 * Tier 4 is cheaper here than the general routine for a reason worth stating:
 * every solid is world-axis-aligned, so the dot products between the solid's
 * axes and the item box's axes are just the components of the item box's axes.
 * The 3x3 matrix SAT would otherwise build is already sitting there. And the
 * three separating axes belonging to the solid are exactly the world axes,
 * which tier 3 has just tested — so of the fifteen candidate axes, three are
 * free, three are already done, and only the nine cross products remain.
 */
export function collides(
  item: Item | PreparedItem,
  placement: Placement,
  environment: Environment,
  counter?: CollisionCounter,
): boolean {
  const prepared = asPrepared(item);
  const env = prepareEnvironment(environment);
  if (counter) counter.collisionChecks++;

  const px = placement.x;
  const py = placement.y;
  const pz = placement.z;

  // Tier 1, before any box is transformed: which solids are even in range?
  const reach = prepared.reach;
  const reachSquared = reach * reach;
  let nearbyCount = 0;
  const nearby = scratchNearby(env.count);
  for (let s = 0; s < env.count; s++) {
    const s3 = s * 3;
    let d = 0;
    if (px < env.min[s3]!) d += (env.min[s3]! - px) ** 2;
    else if (px > env.max[s3]!) d += (px - env.max[s3]!) ** 2;
    if (py < env.min[s3 + 1]!) d += (env.min[s3 + 1]! - py) ** 2;
    else if (py > env.max[s3 + 1]!) d += (py - env.max[s3 + 1]!) ** 2;
    if (pz < env.min[s3 + 2]!) d += (env.min[s3 + 2]! - pz) ** 2;
    else if (pz > env.max[s3 + 2]!) d += (pz - env.max[s3 + 2]!) ** 2;
    if (d <= reachSquared) nearby[nearbyCount++] = s;
  }
  if (nearbyCount === 0) return false;

  // The placement's rotation as nine scalars, written out rather than built
  // through the matrix helpers because this is the innermost loop in the engine
  // and the helper form allocates three vectors per call.
  const ca = Math.cos(placement.yaw);
  const sa = Math.sin(placement.yaw);
  const cb = Math.cos(placement.pitch);
  const sb = Math.sin(placement.pitch);

  let p00: number;
  let p01: number;
  let p02: number;
  let p10: number;
  let p11: number;
  let p12: number;
  let p20: number;
  let p21: number;
  let p22: number;

  if (placement.tiltAxis === 'x') {
    // Columns of Rz(yaw) * Rx(pitch).
    p00 = ca;
    p01 = sa;
    p02 = 0;
    p10 = -sa * cb;
    p11 = ca * cb;
    p12 = sb;
    p20 = sa * sb;
    p21 = -ca * sb;
    p22 = cb;
  } else {
    // Columns of Rz(yaw) * Ry(pitch).
    p00 = ca * cb;
    p01 = sa * cb;
    p02 = -sb;
    p10 = -sa;
    p11 = ca;
    p12 = 0;
    p20 = ca * sb;
    p21 = sa * sb;
    p22 = cb;
  }

  for (let b = 0; b < prepared.count; b++) {
    const b3 = b * 3;
    const b9 = b * 9;
    const hx = prepared.half[b3]!;
    const hy = prepared.half[b3 + 1]!;
    const hz = prepared.half[b3 + 2]!;

    // World axes of this box: the placement rotation applied to its own.
    const l00 = prepared.localAxes[b9]!;
    const l01 = prepared.localAxes[b9 + 1]!;
    const l02 = prepared.localAxes[b9 + 2]!;
    const l10 = prepared.localAxes[b9 + 3]!;
    const l11 = prepared.localAxes[b9 + 4]!;
    const l12 = prepared.localAxes[b9 + 5]!;
    const l20 = prepared.localAxes[b9 + 6]!;
    const l21 = prepared.localAxes[b9 + 7]!;
    const l22 = prepared.localAxes[b9 + 8]!;

    const a0x = p00 * l00 + p10 * l01 + p20 * l02;
    const a0y = p01 * l00 + p11 * l01 + p21 * l02;
    const a0z = p02 * l00 + p12 * l01 + p22 * l02;
    const a1x = p00 * l10 + p10 * l11 + p20 * l12;
    const a1y = p01 * l10 + p11 * l11 + p21 * l12;
    const a1z = p02 * l10 + p12 * l11 + p22 * l12;
    const a2x = p00 * l20 + p10 * l21 + p20 * l22;
    const a2y = p01 * l20 + p11 * l21 + p21 * l22;
    const a2z = p02 * l20 + p12 * l21 + p22 * l22;

    const lcx = prepared.localCenter[b3]!;
    const lcy = prepared.localCenter[b3 + 1]!;
    const lcz = prepared.localCenter[b3 + 2]!;
    const cx = px + p00 * lcx + p10 * lcy + p20 * lcz;
    const cy = py + p01 * lcx + p11 * lcy + p21 * lcz;
    const cz = pz + p02 * lcx + p12 * lcy + p22 * lcz;

    const q0x = Math.abs(a0x);
    const q0y = Math.abs(a0y);
    const q0z = Math.abs(a0z);
    const q1x = Math.abs(a1x);
    const q1y = Math.abs(a1y);
    const q1z = Math.abs(a1z);
    const q2x = Math.abs(a2x);
    const q2y = Math.abs(a2y);
    const q2z = Math.abs(a2z);

    const ex = q0x * hx + q1x * hy + q2x * hz;
    const ey = q0y * hx + q1y * hy + q2y * hz;
    const ez = q0z * hx + q1z * hy + q2z * hz;
    const radius = prepared.boxRadius[b]!;

    for (let n = 0; n < nearbyCount; n++) {
      const s = nearby[n]!;
      const s3 = s * 3;

      const dx = env.center[s3]! - cx;
      const dy = env.center[s3 + 1]! - cy;
      const dz = env.center[s3 + 2]! - cz;

      // Tier 2: bounding spheres.
      const sum = radius + env.radius[s]!;
      if (dx * dx + dy * dy + dz * dz > sum * sum) continue;

      const bhx = env.half[s3]!;
      const bhy = env.half[s3 + 1]!;
      const bhz = env.half[s3 + 2]!;

      // Tier 3: the world axes. These are exactly the solid's three face
      // normals, so passing this test discharges three of the fifteen.
      if (Math.abs(dx) - (ex + bhx) > -EPSILON) continue;
      if (Math.abs(dy) - (ey + bhy) > -EPSILON) continue;
      if (Math.abs(dz) - (ez + bhz) > -EPSILON) continue;

      // Tier 4a: the item box's own three face normals.
      const t0 = dx * a0x + dy * a0y + dz * a0z;
      if (Math.abs(t0) - (hx + bhx * q0x + bhy * q0y + bhz * q0z) > -EPSILON) continue;
      const t1 = dx * a1x + dy * a1y + dz * a1z;
      if (Math.abs(t1) - (hy + bhx * q1x + bhy * q1y + bhz * q1z) > -EPSILON) continue;
      const t2 = dx * a2x + dy * a2y + dz * a2z;
      if (Math.abs(t2) - (hz + bhx * q2x + bhy * q2y + bhz * q2z) > -EPSILON) continue;

      // Tier 4b: the nine edge-edge cross products, axis = a_i x e_j.
      //
      // Because the solid is axis-aligned, the matrix of dot products between
      // the two frames is just the item box's axes read component-wise, which
      // is already in R and absR below. The formulas are the standard ones:
      // for the axis a_i x e_j, with i1 = i+1 and i2 = i+2 modulo 3,
      //   ra   = ah[i1]*|a_i2[j]| + ah[i2]*|a_i1[j]|
      //   rb   = bh[j1]*|a_i[j2]| + bh[j2]*|a_i[j1]|
      //   dist = |t[i2]*a_i1[j] - t[i1]*a_i2[j]|
      R[0] = a0x; R[1] = a0y; R[2] = a0z;
      R[3] = a1x; R[4] = a1y; R[5] = a1z;
      R[6] = a2x; R[7] = a2y; R[8] = a2z;
      absR[0] = q0x; absR[1] = q0y; absR[2] = q0z;
      absR[3] = q1x; absR[4] = q1y; absR[5] = q1z;
      absR[6] = q2x; absR[7] = q2y; absR[8] = q2z;
      ah[0] = hx; ah[1] = hy; ah[2] = hz;
      bh[0] = bhx; bh[1] = bhy; bh[2] = bhz;
      tt[0] = t0; tt[1] = t1; tt[2] = t2;

      let separated = false;
      for (let i = 0; i < 3 && !separated; i++) {
        const i1 = i === 2 ? 0 : i + 1;
        const i2 = i === 0 ? 2 : i - 1;
        for (let j = 0; j < 3; j++) {
          const rij = R[i * 3 + j]!;
          // |a_i x e_j|^2 = 1 - (a_i . e_j)^2, both being unit vectors. When
          // they are parallel the axis vanishes and carries no information the
          // six face normals have not already provided.
          const lengthSquared = 1 - rij * rij;
          if (lengthSquared < EPSILON * EPSILON) continue;

          const j1 = j === 2 ? 0 : j + 1;
          const j2 = j === 0 ? 2 : j - 1;
          const ra = ah[i1]! * absR[i2 * 3 + j]! + ah[i2]! * absR[i1 * 3 + j]!;
          const rb = bh[j1]! * absR[i * 3 + j2]! + bh[j2]! * absR[i * 3 + j1]!;
          const distance = Math.abs(tt[i2]! * R[i1 * 3 + j]! - tt[i1]! * R[i2 * 3 + j]!);
          // The axis is not normalised, so the tolerance scales with its length.
          if (distance - (ra + rb) > -EPSILON * Math.sqrt(lengthSquared)) {
            separated = true;
            break;
          }
        }
      }
      if (separated) continue;

      return true;
    }
  }
  return false;
}

// Scratch for the cross-product axes. Module-level and reused: the engine is
// single-threaded and these never outlive the call that fills them, so this
// turns nine small allocations per box per test into none.
const R = new Float64Array(9);
const absR = new Float64Array(9);
const ah = new Float64Array(3);
const bh = new Float64Array(3);
const tt = new Float64Array(3);

/**
 * Scratch buffer for the broad phase's shortlist.
 *
 * Reused across calls because `collides` is called tens of millions of times
 * per plan and a fresh array per call was, measurably, most of its cost. Safe
 * because the engine is single-threaded and the buffer never outlives the call.
 */
let nearbyBuffer = new Int32Array(64);
function scratchNearby(size: number): Int32Array {
  if (nearbyBuffer.length < size) nearbyBuffer = new Int32Array(size);
  return nearbyBuffer;
}

/** The general routine, kept for the public API and for cross-checking the fast path. */
export function collidesReference(
  item: Item | PreparedItem,
  placement: Placement,
  environment: Environment,
): boolean {
  const boxes = itemWorldBoxes(item, placement);
  for (const box of boxes) {
    for (const solid of environment.solids) {
      if (satOverlap(box, solid)) return true;
    }
  }
  return false;
}
