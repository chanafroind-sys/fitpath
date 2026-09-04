import type { Environment, Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import { itemWorldBoxes } from '../geometry/collide.ts';
import { unionAabb } from '../geometry/worldBox.ts';
import { radians } from '../math/rotation.ts';

/**
 * The discretised configuration space.
 *
 * Every coordinate is derived from an integer index times a step, with the
 * origin fixed at world zero and angle zero. Two consequences, both load-bearing:
 *
 *   - No drift. A placement is recomputed from its indices every time rather
 *     than accumulated by repeated addition, so the same node is bit-identical
 *     no matter which path reached it. That is half of the determinism
 *     guarantee.
 *   - Coarse lattices nest inside fine ones. When a coarse step is an exact
 *     integer multiple of the fine step and both share this origin, every
 *     coarse node is also a fine node and every coarse edge decomposes into
 *     consecutive fine edges along the same straight line. That is what makes
 *     the coarse pass a one-sided approximation: it can miss a path, never
 *     invent one.
 */
export interface Lattice {
  stepX: number;
  stepY: number;
  stepZ: number;
  /** Radians. */
  yawStep: number;
  pitchStep: number;

  ixMin: number;
  iyMin: number;
  izMin: number;
  ipitchMin: number;

  nx: number;
  ny: number;
  nz: number;
  /** Yaw wraps, so its index range always covers a full turn. */
  nyaw: number;
  npitch: number;

  /** Product of the five extents: the size of the space A* may not exceed. */
  nodeCount: number;

  /**
   * Smallest y-index at which the item could possibly be clear of the wall.
   * The A* heuristic is built from this.
   */
  iyGoalMin: number;
}

export interface LatticeRequest {
  stepX: number;
  stepY: number;
  stepZ: number;
  yawStepDeg: number;
  pitchStepDeg: number;
  maxPitchDeg: number;
}

/** Indices identifying one node. */
export interface NodeIndices {
  ix: number;
  iy: number;
  iz: number;
  iyaw: number;
  ipitch: number;
}

const MAX_SAFE_NODES = 2 ** 50;

/**
 * Bound the lattice to the space the item could actually occupy.
 *
 * Not "the hallway plus the room padded by the item's radius", which is the
 * lazy bound and is wildly loose for a 220 cm sofa: instead, for every
 * orientation the lattice admits, work out where the item's own bounding box
 * would have to sit for the item to be inside the free space at all, and take
 * the union over orientations. For a tall wardrobe that removes most of the
 * vertical range outright, because a wardrobe standing upright simply cannot
 * have its base 150 cm off the floor.
 */
export function buildLattice(
  item: PreparedItem,
  environment: Environment,
  request: LatticeRequest,
): Lattice {
  const yawStep = radians(request.yawStepDeg);
  const pitchStep = radians(request.pitchStepDeg);

  const nyaw = Math.round((Math.PI * 2) / yawStep);
  if (Math.abs(nyaw * yawStep - Math.PI * 2) > 1e-9) {
    throw new Error(`yawStepDeg must divide 360, got ${request.yawStepDeg}`);
  }
  const ipitchMax = Math.floor(radians(request.maxPitchDeg) / pitchStep + 1e-9);
  const ipitchMin = -ipitchMax;

  // The free space, as one bounding box. The opening is inside the union of the
  // other two, but including it keeps this honest if the layout ever changes.
  const freeMinX = Math.min(environment.hallway.minX, environment.room.minX, environment.opening.minX);
  const freeMaxX = Math.max(environment.hallway.maxX, environment.room.maxX, environment.opening.maxX);
  const freeMinY = Math.min(environment.hallway.minY, environment.room.minY, environment.opening.minY);
  const freeMaxY = Math.max(environment.hallway.maxY, environment.room.maxY, environment.opening.maxY);
  const freeMinZ = Math.min(environment.hallway.minZ, environment.room.minZ, environment.opening.minZ);
  const freeMaxZ = Math.max(environment.hallway.maxZ, environment.room.maxZ, environment.opening.maxZ);

  let xLow = Infinity;
  let xHigh = -Infinity;
  let yLow = Infinity;
  let yHigh = -Infinity;
  let zLow = Infinity;
  let zHigh = -Infinity;
  // The tightest y at which the item can be wholly past the wall, over all
  // orientations: the most optimistic orientation sets the bound, because the
  // heuristic must never overestimate.
  let goalYLow = Infinity;

  for (let ipitch = ipitchMin; ipitch <= ipitchMax; ipitch++) {
    for (let iyaw = 0; iyaw < nyaw; iyaw++) {
      const probe: Placement = {
        x: 0,
        y: 0,
        z: 0,
        yaw: iyaw * yawStep,
        pitch: ipitch * pitchStep,
      };
      const aabb = unionAabb(itemWorldBoxes(item, probe));
      xLow = Math.min(xLow, freeMinX - aabb.minX);
      xHigh = Math.max(xHigh, freeMaxX - aabb.maxX);
      yLow = Math.min(yLow, freeMinY - aabb.minY);
      yHigh = Math.max(yHigh, freeMaxY - aabb.maxY);
      zLow = Math.min(zLow, freeMinZ - aabb.minZ);
      zHigh = Math.max(zHigh, freeMaxZ - aabb.maxZ);
      goalYLow = Math.min(goalYLow, environment.room.minY - aabb.minY);
    }
  }

  const ixMin = Math.ceil(xLow / request.stepX - 1e-9);
  const ixMax = Math.floor(xHigh / request.stepX + 1e-9);
  const iyMin = Math.ceil(yLow / request.stepY - 1e-9);
  const iyMax = Math.floor(yHigh / request.stepY + 1e-9);
  const izMin = Math.ceil(zLow / request.stepZ - 1e-9);
  const izMax = Math.floor(zHigh / request.stepZ + 1e-9);

  const nx = Math.max(0, ixMax - ixMin + 1);
  const ny = Math.max(0, iyMax - iyMin + 1);
  const nz = Math.max(0, izMax - izMin + 1);
  const npitch = ipitchMax - ipitchMin + 1;

  const nodeCount = nx * ny * nz * nyaw * npitch;
  if (nodeCount > MAX_SAFE_NODES) {
    // Beyond this the packed key stops being an exact integer and two distinct
    // configurations could collide onto one node, which would silently corrupt
    // the search rather than merely slow it down.
    throw new Error(
      `lattice too large to key exactly (${nodeCount} nodes); coarsen the steps or shrink the scene`,
    );
  }

  return {
    stepX: request.stepX,
    stepY: request.stepY,
    stepZ: request.stepZ,
    yawStep,
    pitchStep,
    ixMin,
    iyMin,
    izMin,
    ipitchMin,
    nx,
    ny,
    nz,
    nyaw,
    npitch,
    nodeCount,
    iyGoalMin: Math.ceil(goalYLow / request.stepY - 1e-9),
  };
}

/** Pack five indices into one exact integer, for use as a Map key. */
export function packKey(lattice: Lattice, n: NodeIndices): number {
  const a = n.ix - lattice.ixMin;
  const b = n.iy - lattice.iyMin;
  const c = n.iz - lattice.izMin;
  const d = n.iyaw;
  const e = n.ipitch - lattice.ipitchMin;
  return a + lattice.nx * (b + lattice.ny * (c + lattice.nz * (d + lattice.nyaw * e)));
}

export function unpackKey(lattice: Lattice, key: number): NodeIndices {
  const a = key % lattice.nx;
  let rest = (key - a) / lattice.nx;
  const b = rest % lattice.ny;
  rest = (rest - b) / lattice.ny;
  const c = rest % lattice.nz;
  rest = (rest - c) / lattice.nz;
  const d = rest % lattice.nyaw;
  const e = (rest - d) / lattice.nyaw;
  return {
    ix: a + lattice.ixMin,
    iy: b + lattice.iyMin,
    iz: c + lattice.izMin,
    iyaw: d,
    ipitch: e + lattice.ipitchMin,
  };
}

export function placementOf(lattice: Lattice, n: NodeIndices): Placement {
  return {
    x: n.ix * lattice.stepX,
    y: n.iy * lattice.stepY,
    z: n.iz * lattice.stepZ,
    yaw: n.iyaw * lattice.yawStep,
    pitch: n.ipitch * lattice.pitchStep,
  };
}

/**
 * The same, written into a caller-owned object.
 *
 * The search evaluates tens of millions of placements and never keeps one, so
 * allocating a fresh object for each was pure garbage-collector load. Callers
 * that do keep the result use `placementOf`.
 */
export function placementInto(lattice: Lattice, n: NodeIndices, out: Placement): Placement {
  out.x = n.ix * lattice.stepX;
  out.y = n.iy * lattice.stepY;
  out.z = n.iz * lattice.stepZ;
  out.yaw = n.iyaw * lattice.yawStep;
  out.pitch = n.ipitch * lattice.pitchStep;
  return out;
}

/** Unpack into a caller-owned object, for the same reason. */
export function unpackKeyInto(lattice: Lattice, key: number, out: NodeIndices): NodeIndices {
  const a = key % lattice.nx;
  let rest = (key - a) / lattice.nx;
  const b = rest % lattice.ny;
  rest = (rest - b) / lattice.ny;
  const c = rest % lattice.nz;
  rest = (rest - c) / lattice.nz;
  const d = rest % lattice.nyaw;
  const e = (rest - d) / lattice.nyaw;
  out.ix = a + lattice.ixMin;
  out.iy = b + lattice.iyMin;
  out.iz = c + lattice.izMin;
  out.iyaw = d;
  out.ipitch = e + lattice.ipitchMin;
  return out;
}

export function inBounds(lattice: Lattice, n: NodeIndices): boolean {
  return (
    n.ix >= lattice.ixMin &&
    n.ix < lattice.ixMin + lattice.nx &&
    n.iy >= lattice.iyMin &&
    n.iy < lattice.iyMin + lattice.ny &&
    n.iz >= lattice.izMin &&
    n.iz < lattice.izMin + lattice.nz &&
    n.ipitch >= lattice.ipitchMin &&
    n.ipitch < lattice.ipitchMin + lattice.npitch
  );
}

/**
 * Snap a placement onto the lattice.
 *
 * Used for the caller-supplied start. Rounding rather than flooring so that a
 * start given in real coordinates lands on the nearest representable node
 * instead of always drifting toward the origin.
 */
export function snap(lattice: Lattice, placement: Placement): NodeIndices {
  const twoPi = Math.PI * 2;
  const yaw = ((placement.yaw % twoPi) + twoPi) % twoPi;
  return {
    ix: Math.round(placement.x / lattice.stepX),
    iy: Math.round(placement.y / lattice.stepY),
    iz: Math.round(placement.z / lattice.stepZ),
    iyaw: Math.round(yaw / lattice.yawStep) % lattice.nyaw,
    ipitch: Math.round(placement.pitch / lattice.pitchStep),
  };
}

/**
 * Assert that a coarse lattice nests inside a fine one.
 *
 * The soundness of the whole coarse-to-fine scheme rests on this, and it is the
 * kind of invariant that a plausible-looking option change breaks silently, so
 * it is checked rather than documented and hoped for.
 */
export function assertNested(fine: LatticeRequest, coarse: LatticeRequest): void {
  const check = (name: string, fineStep: number, coarseStep: number): void => {
    const ratio = coarseStep / fineStep;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9 || Math.round(ratio) < 1) {
      throw new Error(
        `coarse ${name} (${coarseStep}) must be a positive integer multiple of the fine step (${fineStep})`,
      );
    }
  };
  check('stepX', fine.stepX, coarse.stepX);
  check('stepY', fine.stepY, coarse.stepY);
  check('stepZ', fine.stepZ, coarse.stepZ);
  check('yawStepDeg', fine.yawStepDeg, coarse.yawStepDeg);
  check('pitchStepDeg', fine.pitchStepDeg, coarse.pitchStepDeg);
}
