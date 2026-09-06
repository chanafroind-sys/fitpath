import type { Environment, Placement } from '../types.ts';
import type { CollisionCounter, PreparedItem } from '../geometry/collide.ts';
import type { Lattice, LatticeRequest, NodeIndices } from './lattice.ts';
import type { SearchOutcome } from './astar.ts';
import { createEdgeValidator } from './edge.ts';
import { assertNested, buildLattice, inBounds, placementOf, snap } from './lattice.ts';
import { defaultStart, searchLattice } from './astar.ts';
import { searchBidirectional } from './bidirectional.ts';

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
  /** Allow pivot moves. Default true; the tests turn it off to isolate their effect. */
  pivotMoves?: boolean;
  /**
   * Run the fast passes — greedy, then bidirectional — before the ladder.
   * Default true.
   *
   * Diagnostics turns them off, and the reason is a difference in what the two
   * callers are optimising. A user-facing plan wants ONE answer soon: spending
   * a bounded amount of work on a bet that pays off most of the time is
   * straightforwardly good. The diagnostics phase wants MANY answers inside a
   * fixed node budget, and there a bet that does not pay is taken dozens of
   * times over — measured on the narrow-hallway scenario, leaving them on cost
   * that phase between a fifth and ten times its running time depending on how
   * loaded the machine was, and changed no suggestion it produced.
   */
  fastPasses?: boolean;
  /**
   * Run the bidirectional pass as well as the greedy one. **Default false.**
   *
   * Measured, and the measurement is against it. Its only chance to help is
   * BEFORE a rung's full search, since a full search is complete on its rung and
   * a bidirectional pass over the same lattice cannot find what that already
   * ruled out. So it can only ever pre-empt a search that was going to succeed
   * — and on the 96 cm doorway, the scene a visitor actually runs, it did:
   * 44,271 nodes and six steps including a 120 degree swing, against the
   * ladder's 22,935 nodes and four clean ones. It never settled a scene the
   * ladder could not.
   *
   * Kept, with its tests, because the reasoning that motivates it is sound and
   * because the thing standing between it and paying off is the heuristic, not
   * the algorithm. See the README.
   */
  bidirectional?: boolean;
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
  /** Where the ladder started, at reference resolution. Undefined when there was no start. */
  startPlacement?: Placement;
}

/**
 * Nodes a greedy pass may spend on one rung before giving up.
 *
 * Small on purpose. Its whole value is being cheap enough that failing costs
 * nothing worth measuring, and a greedy search that has not found the goal in
 * this many nodes is not about to.
 */
const GREEDY_MAX_NODES = 20_000;

/**
 * How hard the greedy pass leans on the heuristic.
 *
 * Large enough to be effectively best-first, finite so the ordering stays a
 * total order and the tie-break still decides.
 */
const GREEDY_WEIGHT = 50;

/** Nodes the bidirectional pass may spend on one rung. */
/**
 * Nodes the bidirectional pass may spend on one rung.
 *
 * Tuned on node counts rather than the clock, because node counts are the same
 * on every machine and the wall clock on this one varied by a factor of three
 * between identical runs. At 25,000 the trees stop meeting on the middle rung
 * and `trivially fits` goes from 46,486 nodes to 98,891; 60,000 is where the
 * meetings happen and the budget is still small against the 1,200,000 the
 * reference lattice would otherwise spend.
 */
const BIDIRECTIONAL_MAX_NODES = 60_000;


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
 * measures progress toward the room, so any maneuver that has to be spelled out
 * as a long run of small moves looks to A* like a dozen moves that make no
 * progress at all, and the number of ways to spend a dozen such moves is
 * astronomical. Coarsening the steps turns those dozen moves into four, which
 * is a search the heuristic can actually get through. Pivot moves attack the
 * same problem from the other end, by making the run short to begin with.
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
  /**
   * Nodes spent by passes that did not produce the answer.
   *
   * Carried into whatever outcome is finally returned, because a node count
   * that hides the work the fast passes did would understate what the engine
   * actually cost — and those counts are quoted in the README and shown on the
   * demo's stats line. It is also what `maxNodes` is measured against: the cap
   * is a budget for the whole call, not an allowance each pass gets afresh.
   */
  let spentElsewhere = 0;
  /** What is left of the caller's budget, shared across every pass below. */
  const remaining = (): number => Math.max(0, request.maxNodes - spentElsewhere);

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

    const found = (outcome: SearchOutcome): SearchReport => ({
      outcome: { ...outcome, nodesGenerated: outcome.nodesGenerated + spentElsewhere },
      lattice,
      counter,
      solvedOnCoarsePass: !isFinest,
      noStart: false,
      edgeChecks,
      startPlacement,
    });

    // --- cheap questions first, on this rung, before the expensive one ------
    //
    // Finding a path and proving there is none are different jobs with wildly
    // different costs, and exhausting a rung is the expensive one. A greedy
    // pass rushes at the goal and gives up early: when it works the rung is
    // settled for a fraction of the price, and when it does not the only loss
    // is its small budget.
    //
    // Nothing here can invent a path. Every edge is validated exactly as in the
    // full search, so a fast answer is a real answer, while a fast failure
    // means nothing at all — which is why the full search below still runs.
    // Coarse rungs only. A fast pass is a bet that a path can be stumbled on
    // cheaply, and the reference lattice is where that bet is worst: the space
    // is at its largest, and by the time a scene reaches that rung the coarse
    // ones have already failed to find anything. Measured on the two scenarios
    // that end in a proof of absence, leaving them on there cost between two
    // and four seconds and found nothing.
    if (request.fastPasses !== false && !isFinest) {
      const greedyValidator = createEdgeValidator(item, environment, counter);
      const greedy = searchLattice(
        item,
        environment,
        lattice,
        greedyValidator,
        start,
        Math.min(remaining(), GREEDY_MAX_NODES),
        counter,
        request.pivotMoves !== false,
        GREEDY_WEIGHT,
      );
      edgeChecks += greedyValidator.edgeChecks;
      if (greedy.path !== undefined) return found(greedy);
      spentElsewhere += greedy.nodesGenerated;

      // Then from both ends, when asked for. Off by default: see
      // SearchRequest.bidirectional.
      if (request.bidirectional === true) {
      const bothEndsValidator = createEdgeValidator(item, environment, counter);
      const bothEnds = searchBidirectional({
        item,
        environment,
        lattice,
        validator: bothEndsValidator,
        start,
        maxNodes: Math.min(remaining(), BIDIRECTIONAL_MAX_NODES),
        counter,
        usePivots: request.pivotMoves !== false,
      });
      edgeChecks += bothEndsValidator.edgeChecks;
      if (bothEnds.path !== undefined) return found(bothEnds);
      spentElsewhere += bothEnds.nodesGenerated;
      }
    }

    const validator = createEdgeValidator(item, environment, counter);
    const outcome = searchLattice(
      item,
      environment,
      lattice,
      validator,
      start,
      remaining(),
      counter,
      request.pivotMoves !== false,
    );
    edgeChecks += validator.edgeChecks;
    lastOutcome = outcome;

    if (outcome.path !== undefined) return found(outcome);
    spentElsewhere += outcome.nodesGenerated;
  }

  return {
    // Every failed pass has already been added to `spentElsewhere`, the last
    // one included, so it is the total on its own.
    outcome: { ...lastOutcome, nodesGenerated: spentElsewhere },
    lattice: lastLattice,
    counter,
    solvedOnCoarsePass: false,
    noStart: false,
    edgeChecks,
    startPlacement,
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
