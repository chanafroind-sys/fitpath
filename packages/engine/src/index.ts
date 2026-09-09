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
  openingAdmits,
  provableNoFit,
  provableNoFitInEnvironment,
  rectangleFitsInRectangle,
  smallestWidthPassingProof,
  type NoFitProof,
  type OpeningProof,
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
export { refinePath } from './planner/refine.ts';
export { shortcutSmooth } from './planner/smooth.ts';
export { dominantAxis, segmentPath, stepKind, type Segment } from './planner/segment.ts';
export { assertPlausible, describePath, describeSegment } from './planner/describe.ts';

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
  placementRotation,
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

export {
  buildLibrary,
  buildManeuver,
  type Library,
  type ManeuverOutcome,
} from './maneuvers/build.ts';
export {
  ON_ITS_SIDE,
  SEAT_FIRST,
  STRAIGHT_IN,
  TEMPLATES,
  bestRollSchedule,
  rollSchedule,
  type RollSchedule,
} from './maneuvers/templates.ts';
export {
  selectManeuver,
  type Measurements,
  type Rejection,
  type Selection,
  type Shortfall,
} from './maneuvers/select.ts';
export type {
  Maneuver,
  ManeuverRequirement,
  ManeuverStage,
  ManeuverTemplate,
  StageDraft,
} from './maneuvers/types.ts';
export {
  bandSection,
  itemLocalBoxes,
  orientedBounds,
  rolledExtent,
  slabSection,
  slabSectionsByBox,
  type Section,
  type SectionPoint,
} from './maneuvers/footprint.ts';

export {
  bindingStation,
  reportOn,
  type BindingPart,
  type BindingStation,
  type ItemReport,
  type ManeuverLine,
  type RemovablePartLine,
} from './maneuvers/report.ts';
export {
  CORNER_MAIN,
  CORNER_RETURN,
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  MODULES,
  RECLINER_2_SEAT,
  SLIM_ARM_2_SEAT,
  SOFAS,
  SOFA_BED,
} from './fixtures/sofas.ts';
export { verifyPathIn, type PathFault } from './maneuvers/verify.ts';
export {
  crossingStations,
  partBreakdown,
  turnsInTheOpening,
  type CrossingStation,
  type PartLine,
} from './maneuvers/parts.ts';
