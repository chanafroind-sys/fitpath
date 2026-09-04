import type { Environment, Placement } from '../types.ts';
import type { CollisionCounter, PreparedItem } from '../geometry/collide.ts';
import { collides } from '../geometry/collide.ts';
import { angleDelta, wrapAngle } from '../math/rotation.ts';

/**
 * Fraction of the thinnest solid that any point of the item is allowed to move
 * between two consecutive samples along an edge.
 *
 * A third, not a half. The soundness argument only needs the step to be
 * strictly smaller than the obstacle's thickness — a point that moves less than
 * the wall is thick cannot get from one side of it to the other without some
 * sample landing inside — but a half leaves no margin for the fact that the
 * swept-distance bound below is itself an upper estimate rather than an exact
 * arc length. A third buys that margin for a 50% increase in samples.
 */
const SAMPLE_FRACTION = 1 / 3;

export interface EdgeValidator {
  /** Maximum distance any material point may travel between samples, in cm. */
  maxStepDistance: number;
  /** Number of samples an edge between these two placements needs. */
  sampleCount(from: Placement, to: Placement): number;
  /** True when the whole motion from `from` to `to` is clear, endpoints included. */
  isValid(from: Placement, to: Placement): boolean;
  /**
   * The same, but skipping the destination.
   *
   * The lattice search already knows whether a neighbour node is clear — it
   * caches that — so re-testing it here would double the cost of every
   * single-step translation edge, which is most of the search.
   */
  isInteriorValid(from: Placement, to: Placement): boolean;
  /** How many edges have been validated. */
  edgeChecks: number;
}

/**
 * Interpolate between two placements.
 *
 * Yaw goes the short way round, because the item physically turns the short
 * way; interpolating 350 degrees to 10 degrees the long way would sweep the
 * item through 340 degrees of corridor it never actually visits and reject
 * edges that are perfectly fine.
 */
export function interpolate(from: Placement, to: Placement, t: number): Placement {
  return interpolateInto(from, to, t, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
}

/** The same, into a caller-owned object, for the sampling loops. */
export function interpolateInto(
  from: Placement,
  to: Placement,
  t: number,
  out: Placement,
): Placement {
  out.x = from.x + (to.x - from.x) * t;
  out.y = from.y + (to.y - from.y) * t;
  out.z = from.z + (to.z - from.z) * t;
  out.yaw = wrapAngle(from.yaw + angleDelta(from.yaw, to.yaw) * t);
  out.pitch = from.pitch + (to.pitch - from.pitch) * t;
  return out;
}

/**
 * Validate motion by sampling densely enough that nothing can tunnel.
 *
 * The sample count comes from a swept-distance bound. Translating by d moves
 * every point of the item by d. Rotating by an angle theta moves a point at
 * distance R from the rotation centre along an arc of length R*theta, and the
 * item's `reach` is the largest such R. Summing the three contributions
 * over-estimates the true displacement — the motions can partly cancel, never
 * add beyond this — so dividing by the allowed per-sample distance gives a
 * count that is always sufficient and sometimes generous.
 *
 * Honest limits: this is a sampling bound, not a proof. It guarantees that no
 * point moves further than a third of the thinnest solid between samples, which
 * rules out passing clean through a wall. It does not rule out a swept volume
 * clipping a corner between two samples that both sit clear of it. A real
 * guarantee needs continuous collision detection against the swept volume;
 * that is named in the README's limitations rather than papered over here.
 */
export function createEdgeValidator(
  item: PreparedItem,
  environment: Environment,
  counter?: CollisionCounter,
): EdgeValidator {
  const maxStepDistance = environment.thinnestSolid * SAMPLE_FRACTION;
  // One scratch placement per validator, refilled for every sample. Edge
  // validation is the innermost loop in the planner and nothing here outlives
  // the collision test it is passed to.
  const scratch: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  const validator: EdgeValidator = {
    maxStepDistance,
    edgeChecks: 0,

    sampleCount(from: Placement, to: Placement): number {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const translation = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const sweptByYaw = Math.abs(angleDelta(from.yaw, to.yaw)) * item.reach;
      const sweptByPitch = Math.abs(to.pitch - from.pitch) * item.reach;
      const worstCase = translation + sweptByYaw + sweptByPitch;
      return Math.max(1, Math.ceil(worstCase / maxStepDistance));
    },

    isValid(from: Placement, to: Placement): boolean {
      const samples = validator.sampleCount(from, to);
      validator.edgeChecks++;
      // Sample from the far end inward. An edge that fails usually fails
      // because its destination is blocked, so testing the destination first
      // rejects most bad edges after one collision check instead of after the
      // whole sweep.
      for (let i = samples; i >= 1; i--) {
        const placement = i === samples ? to : interpolateInto(from, to, i / samples, scratch);
        if (collides(item, placement, environment, counter)) return false;
      }
      return true;
    },

    isInteriorValid(from: Placement, to: Placement): boolean {
      const samples = validator.sampleCount(from, to);
      validator.edgeChecks++;
      // With a single sample the whole motion is shorter than the allowed
      // per-sample distance, so two clear endpoints leave nothing in between
      // that could be hit: no obstacle is that thin, by construction of
      // maxStepDistance.
      for (let i = samples - 1; i >= 1; i--) {
        if (collides(item, interpolateInto(from, to, i / samples, scratch), environment, counter)) {
          return false;
        }
      }
      return true;
    },
  };

  return validator;
}
