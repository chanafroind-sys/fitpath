import type { Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { ManeuverTemplate } from './types.ts';
import { degrees, radians } from '../math/rotation.ts';
import { bandSection, itemLocalBoxes, orientedBounds, rolledExtent } from './footprint.ts';

/** Clearance left between the item and the wall it starts or ends behind. */
const MARGIN = 2;

/**
 * How far above the floor an item is carried while it is being turned.
 *
 * Waypoints are joined by straight interpolation, and the height at which a
 * rolling body rests is not a straight line in the roll angle — it is a chord
 * against an arc. For this item at the roll step below the gap is about a
 * millimetre, but a millimetre through the floor is a collision like any other,
 * and a person carrying a sofa does not drag it. Constant-orientation stages
 * set the item down properly and do not pay this.
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
 * schedule below is something a person could carry out rather than a sequence
 * of instantaneous flips. It is a constraint on the answer, not a tuning knob:
 * relaxing it can only ever let the schedule find a narrower doorway, so a
 * result obtained under it is a result that survives it.
 */
const ROLL_RATE_DEG = 3;

/**
 * Roll angles the schedule may choose from, one degree apart over the circle.
 *
 * The full circle rather than the planner's -90..90: a maneuver is validated
 * placement by placement against the collider, not searched on the lattice, so
 * it is not confined to the poses the lattice can name. That matters here —
 * this item's narrowest cross-section is presented at a roll of about -111
 * degrees, which the planner cannot express at all.
 */
const ROLL_CANDIDATES = 360;

/** Where the item's underside sits when it is held at this roll, at yaw 90. */
function restingZ(item: PreparedItem, roll: number): number {
  return -orientedBounds(item, radians(90), roll, 'x').minZ;
}

function place(item: PreparedItem, y: number, roll: number, lift: number, x = 0): Placement {
  return {
    x,
    y,
    z: restingZ(item, roll) + lift,
    yaw: radians(90),
    pitch: roll,
    tiltAxis: 'x',
  };
}

/**
 * Turn the item in place, from one roll to another, at a fixed position.
 *
 * Emitted as a run of small steps rather than one big one so that the straight
 * interpolation between waypoints stays close to the turn it is standing in
 * for, and so the animation shows a turn instead of a jump.
 */
function turnInPlace(
  item: PreparedItem,
  y: number,
  from: number,
  to: number,
  lift: number,
  x = 0,
): Placement[] {
  const span = Math.abs(degrees(to) - degrees(from));
  const steps = Math.max(1, Math.ceil(span / ROLL_STEP_DEG));
  const out: Placement[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push(place(item, y, from + ((to - from) * i) / steps, lift, x));
  }
  return out;
}

/**
 * Straight in: line the item up with the doorway and walk it through, level.
 *
 * One stage, because it is one motion. The yaw is whichever of the two square
 * choices presents the narrower face — for a sofa that is turning its length
 * through the door rather than its 220 cm across it.
 */
export const STRAIGHT_IN: ManeuverTemplate = {
  id: 'straight-in',
  name: 'Straight in',
  nameHe: 'ישר פנימה',
  build(item, wallThickness) {
    let best: { yaw: number; width: number } | undefined;
    for (const yawDeg of [90, 0]) {
      const bounds = orientedBounds(item, radians(yawDeg), 0, 'y');
      const width = bounds.maxX - bounds.minX;
      if (best === undefined || width < best.width) best = { yaw: radians(yawDeg), width };
    }
    if (best === undefined) return undefined;

    const bounds = orientedBounds(item, best.yaw, 0, 'y');
    const z = -bounds.minZ;
    const at = (y: number): Placement => ({ x: 0, y, z, yaw: best.yaw, pitch: 0 });

    return [
      {
        id: 'walk-through',
        name: 'Carry it straight through',
        nameHe: 'להעביר אותה ישר דרך הפתח',
        waypoints: [
          at(-bounds.maxY - MARGIN),
          at(wallThickness - bounds.minY + MARGIN),
        ],
      },
    ];
  },
};

/**
 * On its side: tip it over, carry it through, set it down again.
 *
 * Three stages, and the split is not cosmetic — the tipping and the setting
 * down are what need room in front of and behind the wall, while only the
 * middle stage needs the doorway. Measuring them separately is what lets the
 * library say which of a shopper's four numbers is the one that fails.
 */
export const ON_ITS_SIDE: ManeuverTemplate = {
  id: 'on-its-side',
  name: 'On its side',
  nameHe: 'על הצד',
  build(item, wallThickness) {
    let best: { roll: number; width: number } | undefined;
    for (const rollDeg of [-90, 90]) {
      const roll = radians(rollDeg);
      const bounds = orientedBounds(item, radians(90), roll, 'x');
      const width = bounds.maxX - bounds.minX;
      if (best === undefined || width < best.width) best = { roll, width };
    }
    if (best === undefined) return undefined;

    const level = orientedBounds(item, radians(90), 0, 'x');
    const start = -level.maxY - MARGIN;
    const end = wallThickness - level.minY + MARGIN;
    const roll = best.roll;

    const tip = turnInPlace(item, start, 0, roll, CARRY_CLEARANCE);
    const carry = [place(item, start, roll, 0), place(item, end, roll, 0)];
    const down = turnInPlace(item, end, roll, 0, CARRY_CLEARANCE);

    return [
      {
        id: 'tip',
        name: 'Tip it onto its side',
        nameHe: 'להטות אותה על הצד',
        // The lift at the end of the tip is the stage's own last waypoint, so
        // the carry begins from where the tip left it.
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

/**
 * The narrowest roll schedule this item admits, worked out station by station.
 *
 * This is the seat-first maneuver, generalised. A sofa's cross-section is not
 * the same all along its length — the middle is an L of seat and leaning
 * backrest, the ends are solid blocks of armrest, and the legs stand proud
 * underneath — so the roll that presents the narrowest face depends on which
 * part of the item is in the doorway at that moment. Rolling to suit, as the
 * item advances, is what "lead with the thin part and turn as the thick part
 * arrives" means.
 *
 * Worked out as a minimax path rather than greedily. At each step of travel,
 * the band of the item inside the wall is known exactly, and so is the width
 * that band would present at each candidate roll. What the schedule wants to
 * minimise is the **widest** doorway it ever demands, which is a bottleneck
 * problem, not a sum — so the recurrence carries `max(width here, best cost of
 * getting here)` and takes the smallest at the end. Turning is limited to
 * `ROLL_RATE_DEG` per step, which can only make the answer worse, never
 * optimistic.
 *
 * Deterministic: fixed step sizes, fixed candidate order, ties broken by the
 * lowest roll index.
 */
function rollSchedule(
  item: PreparedItem,
  wallThickness: number,
  maxHeight: number,
): { ys: number[]; rolls: number[]; offsets: number[]; bound: number } | undefined {
  const boxes = itemLocalBoxes(item);
  const bounds = orientedBounds(item, 0, 0, 'y');
  const { minX, maxX } = bounds;
  if (!(maxX > minX)) return undefined;

  const first = -maxX - MARGIN;
  const last = wallThickness - minX + MARGIN;
  const steps = Math.max(1, Math.ceil((last - first) / THREAD_STEP));

  const rolls: number[] = [];
  for (let i = 0; i < ROLL_CANDIDATES; i++) rolls.push(radians(i - 180));

  // Rolls at which the item as a whole is too tall for the opening are struck
  // out up front. Using the whole item rather than the band is the conservative
  // direction: the item rests on the floor, so nothing of it at the doorway can
  // reach higher than the item does.
  const tooTall = rolls.map((roll) => {
    const b = orientedBounds(item, radians(90), roll, 'x');
    return b.maxZ - b.minZ > maxHeight;
  });

  const ys: number[] = [];
  const widths: Float64Array[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = first + ((last - first) * i) / steps;
    ys.push(y);
    // The slice of the item currently inside the wall. World y = origin + local
    // x at yaw 90, so the wall's [0, thickness] is this band of the item.
    const points = bandSection(boxes, -y, wallThickness - y);
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
        const c = cost[p]!;
        if (c < bestCost) {
          bestCost = c;
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
  // wall, that sliver is far narrower than the doorway the maneuver is buying,
  // and its centre swings about as it shrinks. Chasing it drags the item
  // sideways, and since waypoints are joined by straight lines, the sections in
  // between end up off-centre — which costs twice the offset in doorway width.
  //
  // So the rule is: stay put unless you have to move. At each step the item may
  // sit anywhere that keeps its section inside the width already being bought,
  // which is an interval; take whichever point of it is nearest to where the
  // item already was. Where the constraint is slack the offset does not move at
  // all, and where it binds it moves exactly as much as it must.
  const half = endCost / 2;
  const offsets: number[] = new Array<number>(steps + 1).fill(0);
  let carried: number | undefined;
  let firstConstrained = -1;
  for (let i = 0; i <= steps; i++) {
    const points = bandSection(boxes, -ys[i]!, wallThickness - ys[i]!);
    if (points.length === 0) {
      offsets[i] = carried ?? 0;
      continue;
    }
    if (firstConstrained < 0) firstConstrained = i;
    const { minU, maxU } = rolledExtent(points, rolls[chosen[i]!]!);
    const lo = Math.min(maxU - half, minU + half);
    const hi = Math.max(maxU - half, minU + half);
    const want = carried === undefined ? (minU + maxU) / 2 : Math.min(Math.max(carried, lo), hi);
    carried = want;
    offsets[i] = want;
  }
  // The approach shares the offset the crossing opens with, so the item is
  // already lined up by the time it reaches the wall.
  if (firstConstrained > 0) {
    for (let i = 0; i < firstConstrained; i++) offsets[i] = offsets[firstConstrained]!;
  }

  return { ys, rolls: chosen.map((r) => rolls[r]!), offsets, bound: endCost };
}

/**
 * Seat-first: lead with the thin part, turn as the thick part arrives.
 *
 * Four stages — take up the leading angle, thread through, straighten, set
 * down — because the turning at either end needs room that the passage itself
 * does not.
 */
export const SEAT_FIRST: ManeuverTemplate = {
  id: 'seat-first',
  name: 'Seat first, turning as it goes',
  nameHe: 'המושב ראשון, תוך סיבוב תוך כדי',
  build(item, wallThickness) {
    // 210 cm is a standard interior lintel. A roll that would need more height
    // than that is no use to a shopper, so it is struck out before the schedule
    // is chosen rather than discovered to be useless afterwards.
    const schedule = rollSchedule(item, wallThickness, 210);
    if (schedule === undefined) return undefined;

    const { ys, rolls, offsets } = schedule;
    const startRoll = rolls[0]!;
    const endRoll = rolls[rolls.length - 1]!;
    const startY = ys[0]!;
    const endY = ys[ys.length - 1]!;

    const thread: Placement[] = ys.map((y, i) =>
      place(item, y, rolls[i]!, CARRY_CLEARANCE, offsets[i]!),
    );

    const takeUp = turnInPlace(item, startY, 0, startRoll, CARRY_CLEARANCE, offsets[0]!);
    const straighten = turnInPlace(item, endY, endRoll, 0, CARRY_CLEARANCE, offsets[offsets.length - 1]!);
    const settled = place(item, endY, 0, 0, offsets[offsets.length - 1]!);

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

export { rollSchedule };
