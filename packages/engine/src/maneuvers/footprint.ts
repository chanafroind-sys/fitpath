import type { Placement, Vec3, WorldBox } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import { itemWorldBoxes } from '../geometry/collide.ts';

/**
 * Exact measurement of what an item occupies where it crosses the wall.
 *
 * The whole maneuver library rests on one distinction: the item's **section**
 * through the doorway is not its bounding box. A sofa halfway through a door is
 * 220 cm long, and only the 15 cm of it inside the wall has to fit the opening.
 * Measuring the bounding box instead would make every threading maneuver look
 * impossible, which is the mistake the library exists to avoid.
 *
 * So the section is computed exactly, by clipping. The intersection of a convex
 * box with a slab is a convex polytope whose vertices are the box's own corners
 * lying inside the slab, plus the points where its edges cross the slab's two
 * faces. The extent over those vertices is the extent over the whole clipped
 * solid, because a convex set attains its extremes at its vertices. No
 * sampling, no tolerance.
 */

const CORNER_SIGNS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
];

/**
 * Corner index pairs that share an edge.
 *
 * In the ordering above each coordinate's sign is one bit of the index, so two
 * corners are adjacent exactly when their indices differ in a single bit.
 */
const EDGES: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      const d = i ^ j;
      if (d === 1 || d === 2 || d === 4) out.push([i, j]);
    }
  }
  return out;
})();

export function boxCorners(box: WorldBox): Vec3[] {
  const [ax, ay, az] = box.axes;
  const h = box.halfExtents;
  return CORNER_SIGNS.map(([sx, sy, sz]) => ({
    x: box.center.x + sx * ax.x * h.x + sy * ay.x * h.y + sz * az.x * h.z,
    y: box.center.y + sx * ax.y * h.x + sy * ay.y * h.y + sz * az.y * h.z,
    z: box.center.z + sx * ax.z * h.x + sy * ay.z * h.y + sz * az.z * h.z,
  }));
}

export interface Section {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The item's section where it crosses `minY <= y <= maxY`, or `undefined` when
 * it does not reach that slab at all.
 */
export function slabSection(
  item: PreparedItem,
  placement: Placement,
  minY: number,
  maxY: number,
): Section | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;

  const take = (x: number, z: number): void => {
    any = true;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };

  for (const box of itemWorldBoxes(item, placement)) {
    if (box.aabbMax.y < minY || box.aabbMin.y > maxY) continue;
    const corners = boxCorners(box);
    for (const c of corners) {
      if (c.y >= minY && c.y <= maxY) take(c.x, c.z);
    }
    for (const [i, j] of EDGES) {
      const a = corners[i]!;
      const b = corners[j]!;
      for (const plane of [minY, maxY]) {
        const da = a.y - plane;
        const db = b.y - plane;
        if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
        if (da === db) continue;
        const t = da / (da - db);
        if (t < 0 || t > 1) continue;
        take(a.x + t * (b.x - a.x), a.z + t * (b.z - a.z));
      }
    }
  }

  return any ? { minX, maxX, minZ, maxZ } : undefined;
}

/** A point of the item's cross-section, in the item's own frame. */
export interface SectionPoint {
  y: number;
  z: number;
}

/**
 * The item's cross-section over a band of its own length, `x` in `[from, to]`.
 *
 * Used to work out, station by station, how narrow the item could be presented
 * there if it were rolled to suit. Same clipping argument as `slabSection`, one
 * frame earlier: this is about the item's shape, not about where it has got to.
 */
export function bandSection(
  boxes: readonly WorldBox[],
  from: number,
  to: number,
): SectionPoint[] {
  const out: SectionPoint[] = [];
  for (const box of boxes) {
    if (box.aabbMax.x < from || box.aabbMin.x > to) continue;
    const corners = boxCorners(box);
    for (const c of corners) {
      if (c.x >= from && c.x <= to) out.push({ y: c.y, z: c.z });
    }
    for (const [i, j] of EDGES) {
      const a = corners[i]!;
      const b = corners[j]!;
      for (const plane of [from, to]) {
        const da = a.x - plane;
        const db = b.x - plane;
        if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
        if (da === db) continue;
        const t = da / (da - db);
        if (t < 0 || t > 1) continue;
        out.push({ y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
      }
    }
  }
  return out;
}

/**
 * How wide and tall that cross-section would be if the item were rolled.
 *
 * At yaw 90 in the second tilt family, a placement's pitch turns the item about
 * the axis pointing through the doorway, so this is exactly what the doorway
 * would have to admit. The world mapping is `x = -(y cos p - z sin p)` and
 * `z = y sin p + z cos p`; a sign has no effect on an extent.
 */
export interface RolledExtent {
  width: number;
  height: number;
  /**
   * The section's range along the doorway's width, in the rolled frame.
   *
   * World x is `-u`, so an item is centred in the opening when its placement's
   * x equals `(minU + maxU) / 2`. Threading needs that: as the item turns, the
   * middle of its section moves, and a carrier slides it sideways to keep it in
   * the doorway. A maneuver that only ever turned would have to buy a doorway
   * wide enough for the section wherever it happened to sit.
   */
  minU: number;
  maxU: number;
}

export function rolledExtent(
  points: readonly SectionPoint[],
  roll: number,
): RolledExtent {
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = p.y * c - p.z * s;
    const v = p.y * s + p.z * c;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { width: maxU - minU, height: maxV - minV, minU, maxU };
}

/** The item's boxes in its own frame, which is where cross-sections live. */
export function itemLocalBoxes(item: PreparedItem): WorldBox[] {
  return itemWorldBoxes(item, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
}

/** The item's axis-aligned bounds when held at this orientation, origin at 0. */
export function orientedBounds(
  item: PreparedItem,
  yaw: number,
  pitch: number,
  tiltAxis: 'x' | 'y',
): Section & { minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const box of itemWorldBoxes(item, { x: 0, y: 0, z: 0, yaw, pitch, tiltAxis })) {
    if (box.aabbMin.x < minX) minX = box.aabbMin.x;
    if (box.aabbMax.x > maxX) maxX = box.aabbMax.x;
    if (box.aabbMin.y < minY) minY = box.aabbMin.y;
    if (box.aabbMax.y > maxY) maxY = box.aabbMax.y;
    if (box.aabbMin.z < minZ) minZ = box.aabbMin.z;
    if (box.aabbMax.z > maxZ) maxZ = box.aabbMax.z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}
