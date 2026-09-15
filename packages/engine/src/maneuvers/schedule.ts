/**
 * The roll schedule: the narrowest doorway any way of rolling an item as it
 * goes could get it through, worked out as a minimax. Moved here from
 * templates.ts so that a template file can import it without a cycle.
 */
import type { PreparedItem } from '../geometry/collide.ts';
import type { TravelAxis } from './footprint.ts';
import { radians } from '../math/rotation.ts';
import { bandSection, itemLocalBoxes, orientedBounds, rolledExtent } from './footprint.ts';

/** Clearance left between the item and the wall it starts or ends behind. */
export const MARGIN = 2;

/** Position steps along the travel axis while threading, in centimetres. */
export const THREAD_STEP = 1;

/**
 * The most the roll may change per `THREAD_STEP` of travel.
 *
 * A limit on how fast the item may be turned while it is moving, so the
 * schedule is something a person could carry out rather than a sequence of
 * instantaneous flips. It constrains the answer rather than tuning it:
 * relaxing it could only ever let the schedule find a narrower doorway, so a
 * result obtained under it is one that survives it.
 */
export const ROLL_RATE_DEG = 3;

/**
 * Roll angles the schedule may choose from, one degree apart over the circle.
 *
 * The full circle rather than the planner's -90..90, because a maneuver is
 * validated placement by placement against the collider rather than searched on
 * the lattice, so it is not confined to poses the lattice can name. That
 * matters: the three-seater's narrowest cross-section is presented at a roll of
 * about -111 degrees, which the planner cannot express at all.
 */
export const ROLL_CANDIDATES = 360;

/** A standard interior lintel. Rolls needing more headroom than this are no use. */
export const LINTEL = 210;

/** The yaw and tilt family that send one of the item's axes through the doorway. */
export function frameFor(axis: TravelAxis): { yaw: number; tiltAxis: TravelAxis } {
  return axis === 'x' ? { yaw: radians(90), tiltAxis: 'x' } : { yaw: 0, tiltAxis: 'y' };
}

/** How far the item reaches along the doorway's axis, and what it presents. */
export function travelSpan(item: PreparedItem, roll: number, axis: TravelAxis) {
  const { yaw, tiltAxis } = frameFor(axis);
  const b = orientedBounds(item, yaw, roll, tiltAxis);
  return { minY: b.minY, maxY: b.maxY, width: b.maxX - b.minX, height: b.maxZ - b.minZ };
}

export interface RollSchedule {
  travelAxis: TravelAxis;
  /** Position of the item's origin at each step. */
  ys: number[];
  /** Roll held at each step. */
  rolls: number[];
  /** Where the item sits across the doorway at each step. */
  offsets: number[];
  /** The widest doorway the schedule ever demands. */
  bound: number;
  /** The step that demands it. */
  bindingStep: number;
  /**
   * The narrowest each station could be presented on its own, ignoring how the
   * roll got there and how it leaves.
   *
   * This is what identifies the bottleneck. The schedule holds one roll across
   * a neighbourhood of steps, so several steps in a row show the widest figure
   * even though only one of them forces it; the per-station minimum does not,
   * and the run of stations attaining the maximum is the part of the item that
   * actually decides the answer.
   */
  stationFloors: number[];
}

/**
 * The narrowest roll schedule this item admits, worked out station by station.
 *
 * This is the seat-first maneuver, generalised. A sofa's cross-section is not
 * the same all along its length — the middle may be an L of seat and leaning
 * backrest, the ends solid blocks of armrest, legs standing proud underneath —
 * so the roll that presents the narrowest face depends on which part is in the
 * doorway at that moment. Rolling to suit as the item advances is what "lead
 * with the thin part and turn as the thick part arrives" means.
 *
 * Worked out as a minimax path rather than greedily. At each step of travel the
 * band of the item inside the wall is known exactly, and so is the width it
 * would present at each candidate roll. What the schedule minimises is the
 * **widest** doorway it ever demands, which is a bottleneck problem rather than
 * a sum — so the recurrence carries `max(width here, best cost of getting
 * here)` and takes the smallest at the end.
 *
 * The value it returns is therefore a **floor on every roll schedule**, not
 * the score of one: no way of rolling this item as it goes, along this travel
 * axis, can do better. That is what makes it worth publishing beside a
 * maneuver — one that matches it is optimal *among roll schedules*.
 *
 * What it does not bound, and this has been overclaimed once: any motion that
 * changes the item's yaw or its pitch while it is inside the wall. Leaning
 * into the direction of travel moves points along the travel axis, so the
 * band inside the slab is no longer a function of the station alone, and
 * nothing in this recurrence describes it. A claim that nothing narrower is
 * possible has to be made about roll schedules, and only about them.
 *
 * Deterministic: fixed step sizes, fixed candidate order, ties broken by the
 * lowest roll index.
 */
export function rollSchedule(
  item: PreparedItem,
  wallThickness: number,
  maxHeight: number,
  travelAxis: TravelAxis,
): RollSchedule | undefined {
  const boxes = itemLocalBoxes(item);
  const bounds = orientedBounds(item, 0, 0, 'y');
  const min = travelAxis === 'x' ? bounds.minX : bounds.minY;
  const max = travelAxis === 'x' ? bounds.maxX : bounds.maxY;
  if (!(max > min)) return undefined;

  const first = -max - MARGIN;
  const last = wallThickness - min + MARGIN;
  const steps = Math.max(1, Math.ceil((last - first) / THREAD_STEP));

  const rolls: number[] = [];
  for (let i = 0; i < ROLL_CANDIDATES; i++) rolls.push(radians(i - 180));

  // Rolls at which the item as a whole is too tall for the opening are struck
  // out up front. Using the whole item rather than the band is the conservative
  // direction: the item rests on the floor, so nothing of it at the doorway can
  // reach higher than the item does.
  const tooTall = rolls.map((roll) => travelSpan(item, roll, travelAxis).height > maxHeight);

  const ys: number[] = [];
  const bands: ReturnType<typeof bandSection>[] = [];
  const widths: Float64Array[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = first + ((last - first) * i) / steps;
    ys.push(y);
    const points = bandSection(boxes, -y, wallThickness - y, travelAxis);
    bands.push(points);
    const row = new Float64Array(ROLL_CANDIDATES);
    for (let r = 0; r < ROLL_CANDIDATES; r++) {
      row[r] = points.length === 0 ? 0 : rolledExtent(points, rolls[r]!).width;
    }
    widths.push(row);
  }

  const INF = Number.POSITIVE_INFINITY;
  const reach = Math.max(1, Math.round(ROLL_RATE_DEG));
  let cost = new Float64Array(ROLL_CANDIDATES);
  const back: Int32Array[] = [];
  for (let r = 0; r < ROLL_CANDIDATES; r++) cost[r] = tooTall[r] ? INF : widths[0]![r]!;

  for (let i = 1; i <= steps; i++) {
    const next = new Float64Array(ROLL_CANDIDATES).fill(INF);
    const from = new Int32Array(ROLL_CANDIDATES).fill(-1);
    for (let r = 0; r < ROLL_CANDIDATES; r++) {
      if (tooTall[r]) continue;
      let bestCost = INF;
      let bestFrom = -1;
      for (let d = -reach; d <= reach; d++) {
        const p = (r + d + ROLL_CANDIDATES) % ROLL_CANDIDATES;
        if (cost[p]! < bestCost) {
          bestCost = cost[p]!;
          bestFrom = p;
        }
      }
      if (bestFrom < 0 || bestCost === INF) continue;
      next[r] = Math.max(bestCost, widths[i]![r]!);
      from[r] = bestFrom;
    }
    back.push(from);
    cost = next;
  }

  let endIndex = -1;
  let endCost = INF;
  for (let r = 0; r < ROLL_CANDIDATES; r++) {
    if (cost[r]! < endCost) {
      endCost = cost[r]!;
      endIndex = r;
    }
  }
  if (endIndex < 0 || endCost === INF) return undefined;

  const chosen: number[] = new Array<number>(steps + 1);
  chosen[steps] = endIndex;
  for (let i = steps; i > 0; i--) chosen[i - 1] = back[i - 1]![chosen[i]!]!;

  // Where the item has to sit across the doorway at each step.
  //
  // Centring each section exactly would be the obvious rule and is the wrong
  // one. Near the ends of the crossing only a sliver of the item is inside the
  // wall, that sliver is far narrower than the doorway being bought, and its
  // centre swings about as it shrinks. Chasing it drags the item sideways, and
  // since waypoints are joined by straight lines, the sections in between end
  // up off-centre — which costs twice the offset in doorway width.
  //
  // So: stay put unless you have to move. At each step the item may sit
  // anywhere that keeps its section inside the width already being bought,
  // which is an interval; take whichever point of it is nearest to where the
  // item already was.
  const half = endCost / 2;
  const offsets: number[] = new Array<number>(steps + 1).fill(0);
  let carried: number | undefined;
  let firstConstrained = -1;
  let bindingStep = 0;
  let bindingWidth = -1;
  for (let i = 0; i <= steps; i++) {
    const points = bands[i]!;
    if (points.length === 0) {
      offsets[i] = carried ?? 0;
      continue;
    }
    if (firstConstrained < 0) firstConstrained = i;
    const { minU, maxU, width } = rolledExtent(points, rolls[chosen[i]!]!);
    if (width > bindingWidth) {
      bindingWidth = width;
      bindingStep = i;
    }
    const lo = Math.min(-maxU + half, -minU - half);
    const hi = Math.max(-maxU + half, -minU - half);
    const want = carried === undefined ? -(minU + maxU) / 2 : Math.min(Math.max(carried, lo), hi);
    carried = want;
    offsets[i] = want;
  }
  if (firstConstrained > 0) {
    for (let i = 0; i < firstConstrained; i++) offsets[i] = offsets[firstConstrained]!;
  }

  const stationFloors = widths.map((row) => {
    let least = Number.POSITIVE_INFINITY;
    for (let r = 0; r < ROLL_CANDIDATES; r++) {
      if (tooTall[r]) continue;
      if (row[r]! < least) least = row[r]!;
    }
    return Number.isFinite(least) ? least : 0;
  });

  return {
    travelAxis,
    ys,
    rolls: chosen.map((r) => rolls[r]!),
    offsets,
    bound: endCost,
    bindingStep,
    stationFloors,
  };
}

/**
 * The better of the two travel axes, by the doorway each would need.
 *
 * Trying both is not a refinement. An item's longest side is not always the one
 * its author put on local X — the corner sofa's chaise return is longer across
 * than along — and a library that assumed otherwise would quietly report a much
 * wider doorway than the piece actually needs. That is the same failure the
 * second tilt family was turned on to avoid.
 */
export function bestRollSchedule(
  item: PreparedItem,
  wallThickness: number,
  maxHeight = LINTEL,
): RollSchedule | undefined {
  let best: RollSchedule | undefined;
  for (const axis of ['x', 'y'] as const) {
    const schedule = rollSchedule(item, wallThickness, maxHeight, axis);
    if (schedule === undefined) continue;
    if (best === undefined || schedule.bound < best.bound) best = schedule;
  }
  return best;
}
