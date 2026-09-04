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

/** Split the path wherever the dominant axis of motion changes. */
export function segmentPath(path: Placement[], reach: number): Segment[] {
  if (path.length < 2) return [];

  const segments: Segment[] = [];
  let axis = dominantAxis(path[0]!, path[1]!, reach);
  let startIndex = 0;

  for (let i = 1; i < path.length; i++) {
    const next = i + 1 < path.length ? dominantAxis(path[i]!, path[i + 1]!, reach) : undefined;
    if (next !== axis) {
      segments.push({ axis, from: path[startIndex]!, to: path[i]!, startIndex, endIndex: i });
      if (next === undefined) break;
      axis = next;
      startIndex = i;
    }
  }

  // A segment whose endpoints coincide carries no instruction; it can appear
  // when smoothing collapses a run to nothing.
  return segments.filter((s) => s.startIndex !== s.endIndex);
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
