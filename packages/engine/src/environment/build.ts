import type { AxisBox, Environment, EnvironmentParams, WorldBox } from '../types.ts';
import { axisAlignedSolid, minimumDimension } from '../geometry/worldBox.ts';

/**
 * Thickness given to the slabs that close the scene off: floor, ceiling, the
 * hallway's far wall, the room's outer walls.
 *
 * Real values, not infinity, because every solid feeds the broad phase and an
 * infinite AABB would make the first rejection tier useless. 50 cm is far
 * thicker than any sample spacing the planner will ever use, so nothing can
 * tunnel through them, and it keeps them out of the `thinnestSolid` reckoning
 * where the actual wall belongs.
 */
const SLAB = 50;

/**
 * Turn a handful of tape-measure numbers into the scene's solid geometry.
 *
 * The scene is parameterised rather than hand-authored so that diagnostics can
 * ask counterfactual questions — "what if the opening were 6 cm wider?" — by
 * rebuilding from changed numbers. Hand-authored geometry would make every such
 * question a hand edit, and the diagnostics would end up guessing instead of
 * computing.
 *
 * Layout, all in centimetres:
 *   - the wall occupies y in [0, wallThickness], the opening is centred at x = 0
 *     and sits on the floor,
 *   - the hallway is the free slab in front of it, y in [-hallwayWidth, 0],
 *     running along +/-X for hallwayDepth in total,
 *   - the room is behind it, y in [wallThickness, wallThickness + roomDepth].
 */
export function buildEnvironment(params: EnvironmentParams): Environment {
  validate(params);

  const {
    openingWidth,
    openingHeight,
    wallThickness,
    hallwayWidth,
    hallwayDepth,
    roomDepth,
    roomWidth,
    ceilingHeight,
  } = params;

  const halfOpening = openingWidth / 2;
  const halfHallway = hallwayDepth / 2;
  const halfRoom = roomWidth / 2;

  // The scene's outer footprint, so the closing slabs meet without leaving a
  // seam at the corners for the item to squeeze through.
  const outerMinX = Math.min(-halfHallway, -halfRoom) - SLAB;
  const outerMaxX = Math.max(halfHallway, halfRoom) + SLAB;
  const outerMinY = -hallwayWidth - SLAB;
  const outerMaxY = wallThickness + roomDepth + SLAB;

  const solids: WorldBox[] = [];
  const add = (bounds: AxisBox): void => {
    // A piece with a non-positive dimension is not a thin obstacle, it is no
    // obstacle at all: the threshold piece under a door that sits on the floor,
    // or the lintel over an opening that reaches the ceiling. Emitting it would
    // put a zero into `thinnestSolid` and take the anti-tunnelling bound to
    // zero samples per edge, so it is dropped here and named in the README's
    // list of degenerate cases.
    if (bounds.maxX <= bounds.minX) return;
    if (bounds.maxY <= bounds.minY) return;
    if (bounds.maxZ <= bounds.minZ) return;
    solids.push(axisAlignedSolid(bounds));
  };

  // --- The wall, in four pieces around the opening -------------------------
  const wallY = { minY: 0, maxY: wallThickness };
  // left of the opening
  add({ minX: outerMinX, maxX: -halfOpening, ...wallY, minZ: 0, maxZ: ceilingHeight });
  // right of the opening
  add({ minX: halfOpening, maxX: outerMaxX, ...wallY, minZ: 0, maxZ: ceilingHeight });
  // lintel above the opening
  add({
    minX: -halfOpening,
    maxX: halfOpening,
    ...wallY,
    minZ: openingHeight,
    maxZ: ceilingHeight,
  });
  // threshold below the opening — degenerate while the opening sits on the
  // floor, which is always, but it is constructed rather than assumed away so
  // that a raised sill becomes a one-line change here.
  add({ minX: -halfOpening, maxX: halfOpening, ...wallY, minZ: 0, maxZ: 0 });

  // --- The hallway --------------------------------------------------------
  // far wall, parallel to the opening's wall
  add({
    minX: outerMinX,
    maxX: outerMaxX,
    minY: -hallwayWidth - SLAB,
    maxY: -hallwayWidth,
    minZ: -SLAB,
    maxZ: ceilingHeight + SLAB,
  });
  // the two ends of the corridor
  add({
    minX: outerMinX,
    maxX: -halfHallway,
    minY: -hallwayWidth,
    maxY: 0,
    minZ: -SLAB,
    maxZ: ceilingHeight + SLAB,
  });
  add({
    minX: halfHallway,
    maxX: outerMaxX,
    minY: -hallwayWidth,
    maxY: 0,
    minZ: -SLAB,
    maxZ: ceilingHeight + SLAB,
  });

  // --- The room -----------------------------------------------------------
  add({
    minX: outerMinX,
    maxX: -halfRoom,
    minY: wallThickness,
    maxY: outerMaxY,
    minZ: -SLAB,
    maxZ: ceilingHeight + SLAB,
  });
  add({
    minX: halfRoom,
    maxX: outerMaxX,
    minY: wallThickness,
    maxY: outerMaxY,
    minZ: -SLAB,
    maxZ: ceilingHeight + SLAB,
  });
  add({
    minX: outerMinX,
    maxX: outerMaxX,
    minY: wallThickness + roomDepth,
    maxY: outerMaxY,
    minZ: -SLAB,
    maxZ: ceilingHeight + SLAB,
  });

  // --- Floor and ceiling --------------------------------------------------
  add({
    minX: outerMinX,
    maxX: outerMaxX,
    minY: outerMinY,
    maxY: outerMaxY,
    minZ: -SLAB,
    maxZ: 0,
  });
  add({
    minX: outerMinX,
    maxX: outerMaxX,
    minY: outerMinY,
    maxY: outerMaxY,
    minZ: ceilingHeight,
    maxZ: ceilingHeight + SLAB,
  });

  let thinnestSolid = Infinity;
  for (const solid of solids) {
    const d = minimumDimension(solid);
    if (d < thinnestSolid) thinnestSolid = d;
  }

  return {
    params,
    solids,
    hallway: {
      minX: -halfHallway,
      maxX: halfHallway,
      minY: -hallwayWidth,
      maxY: 0,
      minZ: 0,
      maxZ: ceilingHeight,
    },
    room: {
      minX: -halfRoom,
      maxX: halfRoom,
      minY: wallThickness,
      maxY: wallThickness + roomDepth,
      minZ: 0,
      maxZ: ceilingHeight,
    },
    opening: {
      minX: -halfOpening,
      maxX: halfOpening,
      minY: 0,
      maxY: wallThickness,
      minZ: 0,
      maxZ: openingHeight,
    },
    thinnestSolid,
  };
}

/** Rebuild the same scene with one measurement changed. Diagnostics live on this. */
export function withParams(
  environment: Environment,
  overrides: Partial<EnvironmentParams>,
): Environment {
  return buildEnvironment({ ...environment.params, ...overrides });
}

function validate(params: EnvironmentParams): void {
  const positive: (keyof EnvironmentParams)[] = [
    'openingWidth',
    'openingHeight',
    'wallThickness',
    'hallwayWidth',
    'hallwayDepth',
    'roomDepth',
    'roomWidth',
    'ceilingHeight',
  ];
  for (const key of positive) {
    const value = params[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`buildEnvironment: ${key} must be a positive finite number, got ${value}`);
    }
  }
  if (params.openingHeight > params.ceilingHeight) {
    throw new Error('buildEnvironment: openingHeight cannot exceed ceilingHeight');
  }
  if (params.openingWidth > params.hallwayDepth) {
    throw new Error('buildEnvironment: openingWidth cannot exceed hallwayDepth');
  }
  if (params.openingWidth > params.roomWidth) {
    throw new Error('buildEnvironment: openingWidth cannot exceed roomWidth');
  }
}
