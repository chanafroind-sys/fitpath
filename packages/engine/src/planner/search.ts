import type { Environment, Placement } from '../types.ts';
import type { CollisionCounter, PreparedItem } from '../geometry/collide.ts';
import type { Lattice, LatticeRequest, NodeIndices } from './lattice.ts';
import type { SearchOutcome } from './astar.ts';
import { createEdgeValidator } from './edge.ts';
import { assertNested, buildLattice, inBounds, placementOf, snap } from './lattice.ts';
import { defaultStart, searchLattice } from './astar.ts';

export interface SearchRequest {
  /**
   * Lattice levels, coarsest first. The last is the reference resolution and
   * every other level must nest inside it.
   */
  levels: readonly LatticeRequest[];
  /**
   * Stop before the reference level: run every coarse rung but not the fine one.
   *
   * Diagnostics use this to bracket an answer cheaply. Running all the coarse
   * rungs rather than only the coarsest matters: the bracket it produces is the
   * starting point for the full-resolution confirmation, and a loose bracket
   * turns one expensive run into a binary search of them.
   */
  sketchOnly?: boolean;
  maxNodes: number;
  start?: Placement;
}

export interface SearchReport {
  outcome: SearchOutcome;
  /** The lattice that produced the reported outcome. */
  lattice: Lattice;
  counter: CollisionCounter;
  /** True when a level coarser than the reference found the path. */
  solvedOnCoarsePass: boolean;
  /** True when the item could not be stood up anywhere in the hallway at all. */
  noStart: boolean;
  edgeChecks: number;
}

/**
 * Run the search as a ladder, coarsest level first.
 *
 * Success on a coarse level is success, full stop: with every level's steps
 * constrained to exact integer multiples of the reference level's and a shared
 * origin, each coarse node is also a reference node and each coarse edge
 * decomposes into reference edges along the same line, so a coarse path is
 * already a valid path at full resolution and needs no refinement. The reverse
 * does not hold — coarse failure says nothing — which is why a failed level
 * falls through to the next instead of being reported.
 *
 * The ladder matters more than it looks. Cost is uniform and the heuristic only
 * measures progress toward the room, so a maneuver like tipping a wardbrobe up
 * — lift, tilt, lift, tilt, because the lattice moves one axis at a time —
 * looks to A* like a dozen moves that make no progress at all, and the number
 * of ways to spend a dozen such moves is astronomical. Coarsening the steps
 * turns those dozen moves into four, which is a search the heuristic can
 * actually get through.
 */
export function findPath(
  item: PreparedItem,
  environment: Environment,
  request: SearchRequest,
): SearchReport {
  const levels = request.levels;
  const finest = levels[levels.length - 1]!;
  for (const level of levels) assertNested(finest, level);

  const counter: CollisionCounter = { collisionChecks: 0 };
  let edgeChecks = 0;

  // The start is chosen once, at the reference resolution, and snapped onto
  // each coarser level. Choosing it per level would let the levels answer
  // slightly different questions.
  const finestLattice = buildLattice(item, environment, finest);
  const finestStart = resolveStart(item, environment, finestLattice, request.start);
  if (finestStart === undefined) {
    return {
      outcome: { exhausted: true, budgetExhausted: false, nodesGenerated: 0, nodesExpanded: 0 },
      lattice: finestLattice,
      counter,
      solvedOnCoarsePass: false,
      noStart: true,
      edgeChecks: 0,
    };
  }
  const startPlacement = placementOf(finestLattice, finestStart);

  let lastOutcome: SearchOutcome = {
    exhausted: true,
    budgetExhausted: false,
    nodesGenerated: 0,
    nodesExpanded: 0,
  };
  let lastLattice = finestLattice;

  const count =
    request.sketchOnly === true ? Math.max(1, levels.length - 1) : levels.length;
  for (let i = 0; i < count; i++) {
    const level = levels[i]!;
    const isFinest = level === finest;
    const lattice = isFinest ? finestLattice : buildLattice(item, environment, level);
    const start = isFinest ? finestStart : snap(lattice, startPlacement);
    lastLattice = lattice;
    if (!inBounds(lattice, start)) continue;

    const validator = createEdgeValidator(item, environment, counter);
    const outcome = searchLattice(
      item,
      environment,
      lattice,
      validator,
      start,
      request.maxNodes,
      counter,
    );
    edgeChecks += validator.edgeChecks;
    lastOutcome = outcome;

    if (outcome.path !== undefined) {
      return {
        outcome,
        lattice,
        counter,
        solvedOnCoarsePass: !isFinest,
        noStart: false,
        edgeChecks,
      };
    }
  }

  return {
    outcome: lastOutcome,
    lattice: lastLattice,
    counter,
    solvedOnCoarsePass: false,
    noStart: false,
    edgeChecks,
  };
}

/** Convenience for diagnostics: did a path exist at all? */
export function pathExists(
  item: PreparedItem,
  environment: Environment,
  request: SearchRequest,
): boolean {
  return findPath(item, environment, request).outcome.path !== undefined;
}

function resolveStart(
  item: PreparedItem,
  environment: Environment,
  lattice: Lattice,
  requested: Placement | undefined,
): NodeIndices | undefined {
  if (requested === undefined) return defaultStart(item, environment, lattice);
  const snapped = snap(lattice, requested);
  return inBounds(lattice, snapped) ? snapped : undefined;
}
