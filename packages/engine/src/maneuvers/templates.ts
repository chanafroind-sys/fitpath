import type { Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { ManeuverTemplate } from './types.ts';
import type { TravelAxis } from './footprint.ts';
import { degrees, radians } from '../math/rotation.ts';
import { orientedBounds } from './footprint.ts';
import { UPRIGHT_LEFT_STANDING, UPRIGHT_THROUGH } from './approach.ts';
import { LEAN_AND_STRAIGHTEN } from './lean.ts';
import { LINTEL, MARGIN, bestRollSchedule, frameFor, travelSpan } from './schedule.ts';
export { LINTEL, MARGIN, THREAD_STEP, bestRollSchedule, rollSchedule, type RollSchedule } from './schedule.ts';

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
export const TEMPLATES: readonly ManeuverTemplate[] = [
  STRAIGHT_IN,
  ON_ITS_SIDE,
  SEAT_FIRST,
  UPRIGHT_THROUGH,
  UPRIGHT_LEFT_STANDING,
  LEAN_AND_STRAIGHTEN,
];

