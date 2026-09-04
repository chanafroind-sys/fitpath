import type {
  Environment,
  Item,
  InfeasibleReason,
  PlanOptions,
  PlanResult,
  PlanStats,
  Placement,
  Suggestion,
} from '../types.ts';
import type { LatticeRequest } from './lattice.ts';
import { prepareItem } from '../geometry/collide.ts';
import { provableNoFitInEnvironment } from '../geometry/crossSection.ts';
import { createEdgeValidator } from './edge.ts';
import { findPath } from './search.ts';
import { shortcutSmooth } from './smooth.ts';
import { segmentPath } from './segment.ts';
import { describePath } from './describe.ts';
import { diagnose } from '../diagnostics/diagnose.ts';

const DEFAULTS = {
  positionStep: 2,
  yawStepDeg: 15,
  pitchStepDeg: 15,
  maxPitchDeg: 90,
  coarsePositionFactor: 8,
  coarseAngleFactor: 3,
  useCoarsePass: true,
  maxNodes: 6_000_000,
  diagnostics: true,
  exhaustive: false,
  smooth: true,
} as const;

/**
 * Build the ladder of lattice levels, coarsest first.
 *
 * Three rungs by default — 16 cm / 45 degrees, 8 cm / 30 degrees, then the
 * reference 2 cm / 15 degrees — with an intermediate rung derived by halving
 * the coarse factors. A single coarse rung is not enough: too coarse and it
 * misses the narrow windows a real maneuver threads, too fine and the move
 * count explodes past what the heuristic can guide. Two rungs above the
 * reference cover both without much cost, because a rung that fails is cheap
 * exactly in proportion to how coarse it is.
 */
export function resolveLattices(options: PlanOptions): LatticeRequest[] {
  const step = options.positionStep ?? DEFAULTS.positionStep;
  const fine: LatticeRequest = {
    stepX: options.positionStepX ?? step,
    stepY: options.positionStepY ?? step,
    stepZ: options.positionStepZ ?? step,
    yawStepDeg: options.yawStepDeg ?? DEFAULTS.yawStepDeg,
    pitchStepDeg: options.pitchStepDeg ?? DEFAULTS.pitchStepDeg,
    maxPitchDeg: options.maxPitchDeg ?? DEFAULTS.maxPitchDeg,
  };
  if ((options.useCoarsePass ?? DEFAULTS.useCoarsePass) === false) return [fine];

  const positionFactor = options.coarsePositionFactor ?? DEFAULTS.coarsePositionFactor;
  const angleFactor = options.coarseAngleFactor ?? DEFAULTS.coarseAngleFactor;
  const factors: [number, number][] = [
    [positionFactor, angleFactor],
    [Math.max(1, Math.round(positionFactor / 2)), Math.max(1, Math.round(angleFactor / 2))],
  ];

  const levels: LatticeRequest[] = [];
  for (const [pf, af] of factors) {
    if (pf <= 1 && af <= 1) continue;
    // A yaw step that does not divide 360 cannot be a lattice, because yaw
    // wraps. Rather than reject the whole configuration over a rung that was
    // derived automatically, drop the rung.
    if (360 % (fine.yawStepDeg * af) !== 0) continue;
    levels.push({
      stepX: fine.stepX * pf,
      stepY: fine.stepY * pf,
      stepZ: fine.stepZ * pf,
      yawStepDeg: fine.yawStepDeg * af,
      pitchStepDeg: fine.pitchStepDeg * af,
      maxPitchDeg: fine.maxPitchDeg,
    });
  }
  levels.push(fine);
  return levels;
}

/**
 * Can this item be maneuvered through this opening, and if so, how?
 *
 * Order of business, cheapest and most conclusive first:
 *   1. the closed-form pre-check, which can prove impossibility outright,
 *   2. the coarse lattice, whose successes are real successes,
 *   3. the fine lattice,
 *   4. and, only if all of that comes up empty, diagnostics that compute what
 *      would have to change.
 */
export function plan(
  item: Item,
  environment: Environment,
  options: PlanOptions = {},
): PlanResult {
  const startedAt = performance.now();
  const levels = resolveLattices(options);
  const fine = levels[levels.length - 1]!;
  const maxNodes = options.maxNodes ?? DEFAULTS.maxNodes;
  const wantDiagnostics = options.diagnostics ?? DEFAULTS.diagnostics;

  const prepared = prepareItem(item);

  const runDiagnostics = (): Suggestion[] =>
    wantDiagnostics
      ? diagnose({
          item,
          environment,
          levels,
          maxNodes,
          exhaustive: options.exhaustive ?? DEFAULTS.exhaustive,
          ...(options.start !== undefined ? { start: options.start } : {}),
        })
      : [];

  /** Stats for an answer that needed no search at all. */
  const statsWithoutSearch = (): PlanStats => ({
    nodesGenerated: 0,
    nodesExpanded: 0,
    collisionChecks: 0,
    edgeChecks: 0,
    millis: performance.now() - startedAt,
    lattice: {
      positionStep: fine.stepX,
      yawStepDeg: fine.yawStepDeg,
      pitchStepDeg: fine.pitchStepDeg,
      nodeCount: 0,
    },
    solvedOnCoarsePass: false,
  });

  // 1. The one answer that is a proof rather than an absence of a result.
  const proof = provableNoFitInEnvironment(item.boxes, environment);
  if (proof.proven) {
    const [d1, d2] = proof.crossSection!;
    const suggestions = runDiagnostics();
    return {
      feasible: false,
      reason: 'proven-too-large',
      proven: true,
      message:
        `No path found, and none exists. One part of the ${item.name} measures ${d1} x ${d2} cm ` +
        `across its smallest cross-section, which cannot pass a ${environment.params.openingWidth} x ` +
        `${environment.params.openingHeight} cm opening at any angle, in any orientation.`,
      messageHe:
        `לא נמצא מסלול, וגם לא קיים כזה. חלק מה${item.nameHe} מודד ${d1} על ${d2} ס״מ בחתך הרוחב ` +
        `הקטן ביותר שלו, ולא ניתן להעביר אותו בפתח ${environment.params.openingWidth} על ` +
        `${environment.params.openingHeight} ס״מ בשום זווית ובשום כיוון.`,
      suggestions,
      stats: statsWithoutSearch(),
    };
  }

  // 2 and 3. Coarse, then fine.
  const report = findPath(prepared, environment, {
    levels,
    maxNodes,
    ...(options.start !== undefined ? { start: options.start } : {}),
  });

  const stats: PlanStats = {
    nodesGenerated: report.outcome.nodesGenerated,
    nodesExpanded: report.outcome.nodesExpanded,
    collisionChecks: report.counter.collisionChecks,
    edgeChecks: report.edgeChecks,
    millis: 0,
    lattice: {
      positionStep: report.lattice.stepX,
      yawStepDeg: (report.lattice.yawStep * 180) / Math.PI,
      pitchStepDeg: (report.lattice.pitchStep * 180) / Math.PI,
      nodeCount: report.lattice.nodeCount,
    },
    solvedOnCoarsePass: report.solvedOnCoarsePass,
  };

  if (report.outcome.path !== undefined) {
    // Smoothing needs its own validator: the search's counters are part of the
    // reported statistics and post-processing is not search work.
    const validator = createEdgeValidator(prepared, environment);
    const raw = report.outcome.path;
    const smoothed = (options.smooth ?? DEFAULTS.smooth)
      ? shortcutSmooth(raw, validator)
      : raw;
    const steps = describePath(prepared, segmentPath(smoothed, prepared.reach));
    stats.millis = performance.now() - startedAt;
    return { feasible: true, path: smoothed, steps, stats };
  }

  const reason: InfeasibleReason = report.outcome.budgetExhausted
    ? 'search-budget-exhausted'
    : 'no-path-found';

  const message = buildFailureMessage(item, environment, report.noStart, reason, fine, maxNodes);
  const suggestions = runDiagnostics();
  stats.millis = performance.now() - startedAt;

  return {
    feasible: false,
    reason,
    proven: false,
    message: message.en,
    messageHe: message.he,
    suggestions,
    stats,
  };
}

function buildFailureMessage(
  item: Item,
  _environment: Environment,
  noStart: boolean,
  reason: InfeasibleReason,
  fine: LatticeRequest,
  maxNodes: number,
): { en: string; he: string } {
  if (noStart) {
    return {
      en:
        `No path found: the ${item.name} cannot be placed anywhere in the hallway to start from. ` +
        `Nothing about the doorway has been tested.`,
      he:
        `לא נמצא מסלול: אי אפשר להעמיד את ה${item.nameHe} בשום מקום במסדרון כנקודת התחלה. ` +
        `הפתח עצמו כלל לא נבדק.`,
    };
  }
  if (reason === 'search-budget-exhausted') {
    return {
      en:
        `No path found before the node budget of ${maxNodes.toLocaleString('en-US')} was reached. ` +
        `The search was stopped, not completed, so this says nothing about whether a path exists.`,
      he:
        `לא נמצא מסלול לפני שמוצה תקציב ${maxNodes.toLocaleString('en-US')} הצמתים. ` +
        `החיפוש נעצר ולא הושלם, ולכן אין כאן שום קביעה לגבי קיומו של מסלול.`,
    };
  }
  return {
    en:
      `No path found. The search covered every reachable configuration on a lattice of ` +
      `${fine.stepX} cm positions and ${fine.yawStepDeg}° angles. That proves there is no path ` +
      `on that lattice; it is not a proof that no path exists in continuous space.`,
    he:
      `לא נמצא מסלול. החיפוש כיסה כל תצורה בת-השגה בסריג של ${fine.stepX} ס״מ ו-${fine.yawStepDeg}°. ` +
      `זו הוכחה שאין מסלול על הסריג הזה; אין זו הוכחה שלא קיים מסלול במרחב הרציף.`,
  };
}

export type { Placement };
