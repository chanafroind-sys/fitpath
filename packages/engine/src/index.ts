/**
 * @fitpath/engine — can a piece of furniture be maneuvered through a doorway?
 *
 * Pure TypeScript, no DOM, no canvas, no framework, no runtime dependencies.
 * Everything here runs in Node.
 */

export type {
  AxisBox,
  Box,
  Environment,
  EnvironmentParams,
  InfeasibleReason,
  Item,
  LatticeSummary,
  Placement,
  PlanOptions,
  PlanResult,
  PlanStats,
  RemovablePart,
  Rotation,
  Step,
  StepKind,
  Suggestion,
  SuggestionBasis,
  SuggestionKind,
  Vec3,
  WorldBox,
} from './types.ts';

// Geometry
export { EPSILON, satOverlap } from './geometry/sat.ts';
export {
  axisAlignedSolid,
  boxReach,
  contains,
  minimumDimension,
  sortedDimensions,
  toWorldBox,
  unionAabb,
} from './geometry/worldBox.ts';
export {
  collides,
  itemWorldBoxes,
  prepareItem,
  type PreparedItem,
} from './geometry/collide.ts';
export {
  convexHullMinimumWidth,
  passageOutlook,
  type PassageOutlook,
} from './geometry/hullWidth.ts';
export {
  provableNoFit,
  provableNoFitInEnvironment,
  rectangleFitsInRectangle,
  smallestWidthPassingProof,
  type NoFitProof,
} from './geometry/crossSection.ts';

// Environment
export { buildEnvironment, withParams } from './environment/build.ts';

// Planner
export { plan, resolveLattices } from './planner/plan.ts';
export {
  assertNested,
  buildLattice,
  packKey,
  placementOf,
  snap,
  unpackKey,
  type Lattice,
  type LatticeRequest,
  type NodeIndices,
} from './planner/lattice.ts';
export { createEdgeValidator, interpolate, type EdgeValidator } from './planner/edge.ts';
export { defaultStart, searchLattice, type SearchOutcome } from './planner/astar.ts';
export { findPath, pathExists, type SearchReport, type SearchRequest } from './planner/search.ts';
export { firstContactAlongPath, type PathContact } from './planner/replay.ts';
export { shortcutSmooth } from './planner/smooth.ts';
export { dominantAxis, segmentPath, stepKind, type Segment } from './planner/segment.ts';
export { describePath, describeSegment } from './planner/describe.ts';

// Diagnostics
export {
  diagnose,
  DEFAULT_DIAGNOSTICS_NODE_BUDGET,
  MAX_EXTRA_HALLWAY,
  MAX_EXTRA_OPENING,
  type DiagnoseContext,
  type DiagnosisReport,
} from './diagnostics/diagnose.ts';

// Math
export {
  angleDelta,
  degrees,
  radians,
  rotationMatrix,
  wrapAngle,
  type Mat3,
} from './math/rotation.ts';

// Fixtures
export { ITEMS, REFRIGERATOR, SOFA_3_SEAT, WARDROBE } from './fixtures/items.ts';
export {
  IMPOSSIBLE,
  LEGS_MUST_COME_OFF,
  NARROW_HALLWAY,
  SCENARIOS,
  TILT_REQUIRED,
  TRIVIAL_FIT,
  type Scenario,
} from './fixtures/scenarios.ts';
