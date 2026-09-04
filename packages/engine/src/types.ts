/**
 * Every public type in the engine.
 *
 * Units are centimetres and radians throughout the internals. Degrees appear
 * only at the API surface (option names ending in `Deg`) and in the
 * human-readable step text, because that is how people talk about furniture.
 */

/** Right-handed world frame. X and Y are the floor plane, Z is up. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Intrinsic Tait-Bryan angles in radians, composed Z (yaw) then Y (pitch) then
 * X (roll), i.e. R = Rz(yaw) * Ry(pitch) * Rx(roll).
 *
 * Yaw is outermost on purpose: it swings the *already tilted* item about the
 * world vertical, which is exactly the order in which people describe the
 * maneuver ("tilt it up, then swing it round").
 */
export interface Rotation {
  yaw: number;
  pitch: number;
  roll: number;
}

/** An oriented box in the item's own local frame. */
export interface Box {
  center: Vec3;
  halfExtents: Vec3;
  rotation: Rotation;
}

/** A group of boxes that can be unscrewed and carried separately (legs, feet, shelves). */
export interface RemovablePart {
  name: string;
  nameHe: string;
  boxIndices: readonly number[];
}

/**
 * A rigid piece of furniture, modelled as a union of oriented boxes.
 *
 * Convention: the local origin sits at the centre of the item's footprint on
 * the floor, so a Placement's `z` reads directly as "height of the base above
 * the floor", the lattice's z-range stays tight, and pitch tilts the item about
 * a floor-level line a person could point at.
 */
export interface Item {
  id: string;
  name: string;
  nameHe: string;
  boxes: readonly Box[];
  removableParts?: readonly RemovablePart[];
}

/**
 * The configuration. Roll is deliberately absent, fixed at 0.
 *
 * Why two angles: yaw covers turning the item in plan and pitch covers tilting
 * the leading edge up, and those two are the maneuvers people actually perform
 * and describe. Roll — rolling the item onto its side — is a real maneuver, but
 * admitting it makes the lattice six-dimensional, which is the difference
 * between a search that terminates and one that does not. A rolled variant can
 * still be studied by authoring the item pre-rolled. See the README's
 * "Not supported yet".
 */
export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** A box transformed into world space, with the derived quantities the broad phase needs. */
export interface WorldBox {
  center: Vec3;
  /** Unit columns of the box's rotation: its local +X, +Y, +Z as world directions. */
  axes: readonly [Vec3, Vec3, Vec3];
  halfExtents: Vec3;
  /** Bounding-sphere radius about `center`. */
  radius: number;
  aabbMin: Vec3;
  aabbMax: Vec3;
}

/** A world-axis-aligned volume, used for free regions rather than solids. */
export interface AxisBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * The whole scene, described by measurements rather than hand-authored geometry.
 *
 * Layout: the wall lies in the plane y = 0 and occupies y in [0, wallThickness].
 * The hallway is the free slab in front of it (negative y), running along +/-X.
 * The room is behind it (positive y). The opening is centred at x = 0 and sits
 * on the floor.
 */
export interface EnvironmentParams {
  openingWidth: number;
  openingHeight: number;
  wallThickness: number;
  /** Free depth in FRONT of the opening, measured perpendicular to the wall. */
  hallwayWidth: number;
  /** How far the hallway extends along its own length, total, centred on the opening. */
  hallwayDepth: number;
  /** Free depth BEHIND the opening. */
  roomDepth: number;
  roomWidth: number;
  ceilingHeight: number;
}

export interface Environment {
  params: EnvironmentParams;
  /** Every solid obstacle, all world-axis-aligned. */
  solids: readonly WorldBox[];
  /** Free volume of the hallway. */
  hallway: AxisBox;
  /** Free volume of the room. */
  room: AxisBox;
  /** The aperture through the wall, as a free volume. */
  opening: AxisBox;
  /**
   * The smallest dimension of any solid. The anti-tunnelling sample spacing is
   * derived from this: nothing may move further between two samples than a
   * fraction of the thinnest thing it could pass through.
   */
  thinnestSolid: number;
}

export type StepKind = 'advance' | 'retreat' | 'slide' | 'lift' | 'lower' | 'yaw' | 'pitch';

/** One human-followable move: a run of path states whose dominant axis of motion agrees. */
export interface Step {
  index: number;
  kind: StepKind;
  from: Placement;
  to: Placement;
  /** Signed magnitude: centimetres for translations, degrees for rotations. */
  amount: number;
  en: string;
  he: string;
}

export type SuggestionKind = 'widen-opening' | 'remove-part' | 'widen-hallway';

/** A concrete, computed change to the problem that would make a path appear. */
export interface Suggestion {
  kind: SuggestionKind;
  /** True only when re-planning with this change actually produced a path. */
  helps: boolean;
  en: string;
  he: string;
  /** Present when `helps` and kind is 'widen-opening'. */
  openingWidth?: number;
  extraOpeningWidth?: number;
  /** Present when `helps` and kind is 'widen-hallway'. */
  hallwayWidth?: number;
  extraHallwayWidth?: number;
  /** Present when kind is 'remove-part'. */
  part?: string;
  partHe?: string;
}

/**
 * Why no path was returned.
 *
 * Only `proven-too-large` is a proof. The other two mean "we did not find one",
 * which is a weaker statement — see the README section "No path found is not
 * the same as does not fit".
 */
export type InfeasibleReason = 'proven-too-large' | 'no-path-found' | 'search-budget-exhausted';

export interface LatticeSummary {
  positionStep: number;
  yawStepDeg: number;
  pitchStepDeg: number;
  nodeCount: number;
}

export interface PlanStats {
  nodesGenerated: number;
  nodesExpanded: number;
  collisionChecks: number;
  edgeChecks: number;
  millis: number;
  lattice: LatticeSummary;
  /** True when a coarse pass found the path and the fine lattice was never needed. */
  solvedOnCoarsePass: boolean;
}

export type PlanResult =
  | {
      feasible: true;
      path: Placement[];
      steps: Step[];
      stats: PlanStats;
    }
  | {
      feasible: false;
      reason: InfeasibleReason;
      /**
       * True only for `proven-too-large`. Everything else is the absence of a
       * result, not a proof of impossibility.
       */
      proven: boolean;
      message: string;
      messageHe: string;
      suggestions: Suggestion[];
      stats: PlanStats;
    };

export interface PlanOptions {
  /** Lattice spacing for x, y and z, in centimetres. Default 2. */
  positionStep?: number;
  /** Per-axis overrides, if a scene wants a different resolution vertically. */
  positionStepX?: number;
  positionStepY?: number;
  positionStepZ?: number;
  /** Yaw lattice step in degrees. Must divide 360. Default 15. */
  yawStepDeg?: number;
  /** Pitch lattice step in degrees. Default 15. */
  pitchStepDeg?: number;
  /** Pitch is clamped to +/- this. Default 90. */
  maxPitchDeg?: number;
  /**
   * Coarse pass step multipliers. Must be integers: a coarse lattice is only a
   * sound one-sided approximation when its steps are exact multiples of the
   * fine ones and both share the origin. Enforced at runtime.
   */
  coarsePositionFactor?: number;
  coarseAngleFactor?: number;
  /** Run the coarse pass first. Default true. */
  useCoarsePass?: boolean;
  /**
   * Allow pivot moves: rotating one angular step about a bottom edge or corner,
   * with the translation derived so that anchor stays put. Default true.
   *
   * Turning them off recovers the old strictly-single-axis neighbourhood, which
   * is what the tests use to show what pivoting actually buys.
   */
  pivotMoves?: boolean;
  /** Where the item starts. Defaults to resting on the hallway floor, aligned with the corridor. */
  start?: Placement;
  /** Hard cap on generated nodes, so a bad scene cannot run forever. Default 6_000_000. */
  maxNodes?: number;
  /** Compute diagnostics when no path is found. Default true. */
  diagnostics?: boolean;
  /**
   * Run the literal linear 1 cm scan at full resolution instead of the
   * bracket-then-confirm search. Exact either way; this is far slower.
   */
  exhaustive?: boolean;
  /** Shortcut-smooth the path before segmenting it. Default true. */
  smooth?: boolean;
}
