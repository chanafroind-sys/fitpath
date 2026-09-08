import type { Environment, Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import { collides } from '../geometry/collide.ts';
import { createEdgeValidator } from '../planner/edge.ts';

/** Where a path stops being clear, and whether it is a pose or a motion. */
export interface PathFault {
  /** The waypoint, or for an edge the waypoint it starts from. */
  index: number;
  kind: 'placement' | 'edge';
}

/**
 * Does this path actually run in THIS environment?
 *
 * A maneuver's four numbers are a **lower bound** on the doorway it needs, not
 * a description of the doorway it was drawn for. It is validated once, offline,
 * against a synthetic scene built to exactly that bound — and then it gets
 * shown to somebody in the scene they typed in, which is a different scene.
 * Wider, taller and roomier is the safe direction and usually where a shopper
 * lands, but "usually" is not an argument, and a demonstration that shows
 * furniture passing through a wall is worse than no demonstration.
 *
 * So before a path is animated it is re-checked here, against the environment
 * that will be drawn around it, using the same `collides` and the same
 * `EdgeValidator` the library used when it recorded the thing. Cheap — a few
 * hundred edges — and it is the difference between "this satisfies a
 * requirement" and "this is a real route through the opening you gave me".
 *
 * Returns `undefined` when the path is clear end to end.
 */
export function verifyPathIn(
  item: PreparedItem,
  path: readonly Placement[],
  environment: Environment,
): PathFault | undefined {
  for (let i = 0; i < path.length; i++) {
    if (collides(item, path[i]!, environment)) return { index: i, kind: 'placement' };
  }
  const validator = createEdgeValidator(item, environment);
  for (let i = 0; i + 1 < path.length; i++) {
    if (!validator.isValid(path[i]!, path[i + 1]!)) return { index: i, kind: 'edge' };
  }
  return undefined;
}
