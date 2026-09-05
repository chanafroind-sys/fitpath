/**
 * Turning a path into something that can be scrubbed.
 *
 * The engine returns a path as a list of placements, not as an animation: no
 * durations, no easing, no notion of time. Playback has to invent that, and the
 * only honest way to invent it is to make time proportional to how far the item
 * actually moves — including how far a rotation drags its furthest corner,
 * which is why a 30° turn of a 220 cm sofa takes longer to play than a 30 cm
 * slide. That is the engine's own swept-distance measure, taken from the same
 * `reach` its anti-tunnelling bound uses.
 *
 * Every placement in between comes from the engine's `interpolate`, so the
 * animation walks the same line the edge validator checked — yaw included,
 * which goes the short way round.
 */
import { angleDelta, interpolate, prepareItem } from '@fitpath/engine';
import type { Item, Placement, Step } from '@fitpath/engine';

export interface Timeline {
  /** Cumulative fraction at each path node. Length matches the path; first is 0, last is 1. */
  marks: readonly number[];
  /** Total swept distance in centimetres. */
  sweep: number;
  placementAt(fraction: number): Placement;
}

function sweptDistance(from: Placement, to: Placement, reach: number): number {
  const translation = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const yaw = Math.abs(angleDelta(from.yaw, to.yaw)) * reach;
  const pitch = Math.abs(to.pitch - from.pitch) * reach;
  return translation + yaw + pitch;
}

export function buildTimeline(item: Item, path: readonly Placement[]): Timeline {
  const { reach } = prepareItem(item);
  const lengths: number[] = [];
  let sweep = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const d = sweptDistance(path[i]!, path[i + 1]!, reach);
    lengths.push(d);
    sweep += d;
  }

  const marks: number[] = [0];
  let running = 0;
  for (const d of lengths) {
    running += d;
    // A path of coincident placements has no length to divide by. Falling back
    // to equal spacing keeps the scrubber usable instead of producing NaN.
    marks.push(sweep > 0 ? running / sweep : marks.length / Math.max(1, lengths.length));
  }
  if (marks.length > 0) marks[marks.length - 1] = 1;

  return {
    marks,
    sweep,
    placementAt(fraction: number): Placement {
      if (path.length === 0) return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
      if (path.length === 1) return path[0]!;
      const f = Math.min(1, Math.max(0, fraction));
      let i = 0;
      while (i + 2 < path.length && f > marks[i + 1]!) i++;
      const span = marks[i + 1]! - marks[i]!;
      const local = span > 0 ? (f - marks[i]!) / span : 0;
      return interpolate(path[i]!, path[i + 1]!, Math.min(1, Math.max(0, local)));
    },
  };
}

/** Where each engine step begins and ends on the scrubbed timeline. */
export interface StepRange {
  from: number;
  to: number;
}

const samePlacement = (a: Placement, b: Placement): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.pitch === b.pitch;

/**
 * Line the engine's steps up against the timeline.
 *
 * Steps are runs of the same path, so each one's endpoints are path nodes and
 * can be found by value. When a match cannot be found the step is given the
 * whole range rather than dropped: a step list that silently lost an entry
 * would be worse than one that highlights too much.
 */
export function stepRanges(steps: readonly Step[], path: readonly Placement[], timeline: Timeline): StepRange[] {
  const indexOf = (placement: Placement, fallback: number): number => {
    const found = path.findIndex((p) => samePlacement(p, placement));
    return found >= 0 ? found : fallback;
  };
  return steps.map((step) => {
    const from = indexOf(step.from, 0);
    const to = indexOf(step.to, path.length - 1);
    return { from: timeline.marks[from] ?? 0, to: timeline.marks[to] ?? 1 };
  });
}
