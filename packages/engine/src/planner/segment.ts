import type { Placement, StepKind } from '../types.ts';
import { angleDelta } from '../math/rotation.ts';

export type MotionAxis = 'x' | 'y' | 'z' | 'yaw' | 'pitch';

export interface Segment {
  axis: MotionAxis;
  from: Placement;
  to: Placement;
  /** Index range in the source path, so callers can recover the intermediate states. */
  startIndex: number;
  endIndex: number;
}

/**
 * Which single motion dominates a transition.
 *
 * Rotations are converted into the distance the item's furthest point actually
 * sweeps before being compared with the translations. Comparing radians against
 * centimetres directly would be a category error, and in practice it would rank
 * a 15 degree turn of a 220 cm sofa — which drags a corner through 30 cm of
 * corridor — as less significant than a 2 cm nudge.
 */
export function dominantAxis(from: Placement, to: Placement, reach: number): MotionAxis {
  const candidates: [MotionAxis, number][] = [
    ['x', Math.abs(to.x - from.x)],
    ['y', Math.abs(to.y - from.y)],
    ['z', Math.abs(to.z - from.z)],
    ['yaw', Math.abs(angleDelta(from.yaw, to.yaw)) * reach],
    ['pitch', Math.abs(to.pitch - from.pitch) * reach],
  ];
  let best = candidates[0]!;
  for (const candidate of candidates) {
    // Strictly greater, so an exact tie keeps the earlier axis and the choice
    // never depends on array order changing under a refactor.
    if (candidate[1] > best[1]) best = candidate;
  }
  return best[0];
}

/**
 * Which way the item is moving along one axis: +1, -1, or 0 for neither.
 *
 * Needed because a segment is described by its NET change from end to end, so a
 * run that tilts up and then back down again reads as a single instruction to
 * tilt by nothing. "Tilt the front edge up about 0 degrees" is not an
 * instruction. Two motions in opposite directions are two instructions, and the
 * split below is what keeps them that way.
 */
function direction(axis: MotionAxis, from: Placement, to: Placement): number {
  const delta =
    axis === 'yaw' ? angleDelta(from.yaw, to.yaw) : axis === 'pitch' ? to.pitch - from.pitch : to[axis] - from[axis];
  if (delta > 1e-9) return 1;
  if (delta < -1e-9) return -1;
  return 0;
}

/** Split the path wherever the dominant axis of motion, or its direction, changes. */
export function segmentPath(path: Placement[], reach: number): Segment[] {
  if (path.length < 2) return [];

  const segments: Segment[] = [];
  let axis = dominantAxis(path[0]!, path[1]!, reach);
  let heading = direction(axis, path[0]!, path[1]!);
  let startIndex = 0;

  for (let i = 1; i < path.length; i++) {
    const nextAxis = i + 1 < path.length ? dominantAxis(path[i]!, path[i + 1]!, reach) : undefined;
    const nextHeading =
      nextAxis === undefined ? 0 : direction(nextAxis, path[i]!, path[i + 1]!);
    // A heading of zero carries no information, so it never forces a split.
    const reversed =
      nextAxis === axis && heading !== 0 && nextHeading !== 0 && nextHeading !== heading;
    if (nextAxis !== axis || reversed) {
      segments.push({ axis, from: path[startIndex]!, to: path[i]!, startIndex, endIndex: i });
      if (nextAxis === undefined) break;
      axis = nextAxis;
      heading = nextHeading;
      startIndex = i;
    } else if (heading === 0) {
      heading = nextHeading;
    }
  }

  // A segment that moves the item nowhere carries no instruction. Coinciding
  // endpoints are the obvious case, but relaxation can also leave a run whose
  // net motion rounds to nothing while its indices still differ — which reads
  // as "Lower it about 0 cm", an instruction to do nothing.
  return segments.filter((s) => s.startIndex !== s.endIndex && sweptDistance(s, reach) > 0.5);
}

/** How far the item's furthest point actually travels across a segment. */
function sweptDistance(segment: Segment, reach: number): number {
  const { from, to } = segment;
  return (
    Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) +
    Math.abs(angleDelta(from.yaw, to.yaw)) * reach +
    Math.abs(to.pitch - from.pitch) * reach
  );
}

/** Map a motion axis plus its direction onto the vocabulary the descriptions use. */
export function stepKind(axis: MotionAxis, from: Placement, to: Placement): StepKind {
  switch (axis) {
    case 'x':
      return 'slide';
    case 'y':
      return to.y >= from.y ? 'advance' : 'retreat';
    case 'z':
      return to.z >= from.z ? 'lift' : 'lower';
    case 'yaw':
      return 'yaw';
    case 'pitch':
      return 'pitch';
  }
}
