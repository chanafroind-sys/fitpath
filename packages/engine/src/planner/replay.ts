import type { Environment, Item, Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import { collides, prepareItem } from '../geometry/collide.ts';
import { createEdgeValidator, interpolate } from './edge.ts';

/** Where a replayed path first meets a solid. */
export interface PathContact {
  /** The path segment it happened on: the motion from `path[segment]` to `path[segment + 1]`. */
  segment: number;
  /**
   * How far along that segment, in [0, 1]. Zero means the segment's own start
   * placement was already blocked, which for `segment === 0` means the path
   * never began.
   */
  t: number;
  /** The first sampled placement found to collide. */
  placement: Placement;
}

/**
 * Replay a path in a DIFFERENT environment and report where it first hits
 * something.
 *
 * This exists because "the doorway was never the problem" is a claim that has
 * to be shown rather than asserted. Take a path the planner found for a wide
 * corridor, run the identical maneuver in a narrow one, and the corridor wall
 * stops it — at a placement this function names, with the same collision test
 * the planner itself uses.
 *
 * The sample spacing is the planner's own anti-tunnelling bound, taken from
 * `createEdgeValidator`, so a replay cannot step over a solid that the search
 * would have refused to cross. The same limitation applies as everywhere else
 * in the engine: it is a sampling bound, not a proof, so a swept volume that
 * clips a corner strictly between two clear samples is not detected. See the
 * README's "Not supported yet".
 *
 * Deterministic: samples run front to back at indices fixed by the bound, and
 * the first colliding one wins.
 *
 * @returns the first contact, or `undefined` when the whole path is clear.
 */
export function firstContactAlongPath(
  item: Item | PreparedItem,
  path: readonly Placement[],
  environment: Environment,
): PathContact | undefined {
  if (path.length === 0) return undefined;

  // Same discriminator the collision layer uses: only a PreparedItem carries
  // the flat typed arrays.
  const prepared: PreparedItem = 'localAxes' in item ? item : prepareItem(item);
  const validator = createEdgeValidator(prepared, environment);

  const first = path[0]!;
  if (collides(prepared, first, environment)) return { segment: 0, t: 0, placement: first };

  for (let segment = 0; segment + 1 < path.length; segment++) {
    const from = path[segment]!;
    const to = path[segment + 1]!;
    const samples = validator.sampleCount(from, to);
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      // The endpoint is used verbatim rather than interpolated at t = 1, so a
      // contact reported exactly at a waypoint is the waypoint itself and not a
      // value a rounding error moved off it.
      const placement = i === samples ? to : interpolate(from, to, t);
      if (collides(prepared, placement, environment)) return { segment, t, placement };
    }
  }

  return undefined;
}
