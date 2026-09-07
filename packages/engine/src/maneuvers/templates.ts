import type { Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { ManeuverTemplate } from './types.ts';
import type { TravelAxis } from './footprint.ts';
import { degrees, radians } from '../math/rotation.ts';
import { bandSection, itemLocalBoxes, orientedBounds, rolledExtent } from './footprint.ts';

/** Clearance left between the item and the wall it starts or ends behind. */
const MARGIN = 2;

/**
 * How far above the floor an item is carried while it is being turned.
 *
 * Waypoints are joined by straight interpolation, and the height at which a
 * rolling body rests is not a straight line in the roll angle — it is a chord
 * against an arc. At the roll step below the gap is about a millimetre, but a
 * millimetre through the floor is a collision like any other, and a person
 * carrying a sofa does not drag it. Constant-orientation stages set the item
 * down properly and do not pay this.
 */
const CARRY_CLEARANCE = 2;

/** Roll steps are taken this far apart while turning in place. */
const ROLL_STEP_DEG = 5;

/** Position steps along the travel axis while threading, in centimetres. */
const THREAD_STEP = 1;

/**
 * The most the roll may change per `THREAD_STEP` of travel.
 *
 * A limit on how fast the item may be turned while it is moving, so the
 * schedule is something a person could carry out rather than a sequence of
 * instantaneous flips. It constrains the answer rather than tuning it:
 * relaxing it could only ever let the schedule find a narrower doorway, so a
 * result obtained under it is one that survives it.
 */
const ROLL_RATE_DEG = 3;

/**
 * Roll angles the schedule may choose from, one degree apart over the circle.
 *
 * The full circle rather than the planner's -90..90, because a maneuver is
 * validated placement by placement against the collider rather than searched on
 * the lattice, so it is not confined to poses the lattice can name. That
 * matters: the three-seater's narrowest cross-section is presented at a roll of
 * about -111 degrees, which the planner cannot express at all.
 */
const ROLL_CANDIDATES = 360;

/** A standard interior lintel. Rolls needing more headroom than this are no use. */
const LINTEL = 210;

/** The yaw and tilt family that send one of the item's axes through the doorway. */
function frameFor(axis: TravelAxis): { yaw: number; tiltAxis: TravelAxis } {
  return axis === 'x' ? { yaw: radians(90), tiltAxis: 'x' } : { yaw: 0, tiltAxis: 'y' };
}

/** Where the item's underside sits when it is held at this roll. */
function restingZ(item: PreparedItem, roll: number, axis: TravelAxis): number {
  const { yaw, tiltAxis } = frameFor(axis);
  return -orientedBounds(item, yaw, roll, tiltAxis).minZ;
}

function place(
  item: PreparedItem,
  y: number,
  roll: number,
  lift: number,
  x: number,
  axis: TravelAxis,
): Placement {
  const { yaw, tiltAxis } = frameFor(axis);
  return { x, y, z: restingZ(item, roll, axis) + lift, yaw, pitch: roll, tiltAxis };
}

/**
 * Turn the item in place, from one roll to another, at a fixed position.
 *
 * Emitted as a run of small steps rather than one big one so the straight
 * interpolation between waypoints stays close to the turn it stands in for, and
 * so the animation shows a turn instead of a jump.
 */
function turnInPlace(
  item: PreparedItem,
  y: number,
  from: number,
  to: number,
  lift: number,
  x: number,
  axis: TravelAxis,
): Placement[] {
  const span = Math.abs(degrees(to) - degrees(from));
  const steps = Math.max(1, Math.ceil(span / ROLL_STEP_DEG));
  const out: Placement[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push(place(item, y, from + ((to - from) * i) / steps, lift, x, axis));
  }
  return out;
}

/** How far the item reaches along the doorway's axis, and what it presents. */
function travelSpan(item: PreparedItem, roll: number, axis: TravelAxis) {
  const { yaw, tiltAxis } = frameFor(axis);
  const b = orientedBounds(item, yaw, roll, tiltAxis);
  return { minY: b.minY, maxY: b.maxY, width: b.maxX - b.minX, height: b.maxZ - b.minZ };
}

/**
 * Straight in: line the item up with the doorway and walk it through, level.
 *
 * One stage, because it is one motion. The axis is whichever square choice
 * presents the narrower face — for a long sofa that means turning its length
 * through the door rather than carrying its length across it.
 */
export const STRAIGHT_IN: ManeuverTemplate = {
  id: 'straight-in',
  name: 'Straight in',
  nameHe: 'ישר פנימה',
  build(item, wallThickness) {
    let best: { axis: TravelAxis; width: number } | undefined;
    for (const axis of ['x', 'y'] as const) {
      const { width } = travelSpan(item, 0, axis);
      if (best === undefined || width < best.width) best = { axis, width };
    }
    if (best === undefined) return undefined;

    const axis = best.axis;
    const span = travelSpan(item, 0, axis);
    const at = (y: number): Placement => place(item, y, 0, 0, 0, axis);

    return [
      {
        id: 'walk-through',
        name: 'Carry it straight through',
        nameHe: 'להעביר אותה ישר דרך הפתח',
        waypoints: [at(-span.maxY - MARGIN), at(wallThickness - span.minY + MARGIN)],
      },
    ];
  },
};

/**
 * On its side: tip it over, carry it through, set it down again.
 *
 * Three stages, and the split is not cosmetic. Tipping and setting down are
 * what need room in front of and behind the wall, while only the middle stage
 * needs the doorway. Measuring them separately is what lets the library say
 * which of a shopper's four numbers is the one that fails.
 */
export const ON_ITS_SIDE: ManeuverTemplate = {
  id: 'on-its-side',
  name: 'On its side',
  nameHe: 'על הצד',
  build(item, wallThickness) {
    let best: { axis: TravelAxis; roll: number; width: number } | undefined;
    for (const axis of ['x', 'y'] as const) {
      for (const rollDeg of [-90, 90]) {
        const roll = radians(rollDeg);
        const span = travelSpan(item, roll, axis);
        if (span.height > LINTEL) continue;
        if (best === undefined || span.width < best.width) {
          best = { axis, roll, width: span.width };
        }
      }
    }
    if (best === undefined) return undefined;

    const { axis, roll } = best;
    const level = travelSpan(item, 0, axis);
    const rolled = travelSpan(item, roll, axis);
    const start = -Math.max(level.maxY, rolled.maxY) - MARGIN;
    const end = wallThickness - Math.min(level.minY, rolled.minY) + MARGIN;

    const tip = turnInPlace(item, start, 0, roll, CARRY_CLEARANCE, 0, axis);
    const carry = [place(item, start, roll, 0, 0, axis), place(item, end, roll, 0, 0, axis)];
    const down = turnInPlace(item, end, roll, 0, CARRY_CLEARANCE, 0, axis);

    return [
      {
        id: 'tip',
        name: 'Tip it onto its side',
        nameHe: 'להטות אותה על הצד',
        waypoints: [...tip, carry[0]!],
      },
      {
        id: 'carry',
        name: 'Carry it through on its side',
        nameHe: 'להעביר אותה דרך הפתח על הצד',
        waypoints: carry,
      },
      {
        id: 'set-down',
        name: 'Stand it back up in the room',
        nameHe: 'להחזיר אותה לעמידה בחדר',
        waypoints: [carry[1]!, ...down],
      },
    ];
  },
};

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
 * The value it returns is therefore a **floor on every schedule**, not the
 * score of one: no way of turning this item as it goes can do better. That is
 * what makes it worth publishing beside a maneuver — one that matches it is
 * optimal, and a claim of anything narrower would have to be wrong.
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

/**
 * Seat-first: lead with the thin part, turn as the thick part arrives.
 *
 * Four stages — take up the leading angle, thread through, straighten, set
 * down — because the turning at either end needs room the passage itself does
 * not.
 */
export const SEAT_FIRST: ManeuverTemplate = {
  id: 'seat-first',
  name: 'Seat first, turning as it goes',
  nameHe: 'המושב ראשון, תוך סיבוב תוך כדי',
  build(item, wallThickness) {
    const schedule = bestRollSchedule(item, wallThickness, LINTEL);
    if (schedule === undefined) return undefined;

    const { ys, rolls, offsets, travelAxis } = schedule;
    const startRoll = rolls[0]!;
    const endRoll = rolls[rolls.length - 1]!;
    const startY = ys[0]!;
    const endY = ys[ys.length - 1]!;
    const startX = offsets[0]!;
    const endX = offsets[offsets.length - 1]!;

    const thread = ys.map((y, i) =>
      place(item, y, rolls[i]!, CARRY_CLEARANCE, offsets[i]!, travelAxis),
    );
    const takeUp = turnInPlace(item, startY, 0, startRoll, CARRY_CLEARANCE, startX, travelAxis);
    const straighten = turnInPlace(item, endY, endRoll, 0, CARRY_CLEARANCE, endX, travelAxis);
    const settled = place(item, endY, 0, 0, endX, travelAxis);

    return [
      {
        id: 'take-up',
        name: 'Turn it to lead with the thin edge',
        nameHe: 'לסובב אותה כך שהקצה הצר מוביל',
        waypoints: [...takeUp, thread[0]!],
      },
      {
        id: 'thread',
        name: 'Thread it through, turning as it goes',
        nameHe: 'להשחיל אותה דרך הפתח תוך סיבוב',
        waypoints: thread,
      },
      {
        id: 'straighten',
        name: 'Straighten it up in the room',
        nameHe: 'ליישר אותה בחדר',
        waypoints: [thread[thread.length - 1]!, ...straighten],
      },
      {
        id: 'set-down',
        name: 'Set it down',
        nameHe: 'להניח אותה',
        waypoints: [straighten[straighten.length - 1]!, settled],
      },
    ];
  },
};

/** The library, in a fixed order. */
export const TEMPLATES: readonly ManeuverTemplate[] = [STRAIGHT_IN, ON_ITS_SIDE, SEAT_FIRST];

export { LINTEL, MARGIN, THREAD_STEP };
