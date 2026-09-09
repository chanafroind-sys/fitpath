import type { Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { ManeuverTemplate, StageDraft } from './types.ts';
import { degrees, radians } from '../math/rotation.ts';
import { orientedBounds } from './footprint.ts';

/**
 * Maneuvers that include getting the item into position.
 *
 * Every other template in the library begins with the item already square to
 * the doorway, and holding a 220 cm sofa square to a wall takes 222 cm of floor
 * in front of that wall. That assumption was flagged when the library was
 * built and it has since become its single biggest practical limitation: it
 * turns "your hallway is 120 cm deep" into a refusal, when what a person
 * actually does is stand the sofa on its end, turn it there, and walk it in.
 *
 * These maneuvers model that. Standing an item on end trades floor for
 * ceiling, and it trades depth in front of the wall for length ALONG the wall —
 * which is the third corridor dimension, and the reason the requirement had to
 * grow one.
 *
 * ## The frame
 *
 * A placement's pitch turns about the item's local Y or local X, and which of
 * those becomes a world axis depends on the yaw applied outside it. Two
 * combinations matter here:
 *
 * - **yaw 0, tilt about local Y.** The item lies along the corridor and pitch
 *   turns it about the world Y axis, which stands it on its end where it lies.
 *   Pitch -90 puts its length vertical.
 * - **yaw 90, tilt about local Y.** The same standing pose, spun to face the
 *   doorway. Because the item's length is vertical, that spin sweeps only its
 *   own cross-section rather than its length.
 *
 * Those two are the whole trick: an upright item turns inside a footprint the
 * size of its end, and a flat one does not.
 */

/** Clearance left between the item and the wall it starts or ends behind. */
const MARGIN = 2;

/** Carried, not dragged, while it is being turned. */
const CARRY_CLEARANCE = 2;

/** Angular resolution of a turn, in degrees. */
const TURN_STEP = 5;

/** Where the item's underside sits when held like this. */
function restingZ(item: PreparedItem, yaw: number, pitch: number): number {
  return -orientedBounds(item, yaw, pitch, 'y').minZ;
}

function pose(
  item: PreparedItem,
  x: number,
  y: number,
  yawDeg: number,
  pitchDeg: number,
  lift = CARRY_CLEARANCE,
): Placement {
  const yaw = radians(yawDeg);
  const pitch = radians(pitchDeg);
  return { x, y, z: restingZ(item, yaw, pitch) + lift, yaw, pitch, tiltAxis: 'y' };
}

/** A run of poses interpolating one angle, at a fixed position. */
function sweep(
  item: PreparedItem,
  x: number,
  y: number,
  from: { yaw: number; pitch: number },
  to: { yaw: number; pitch: number },
  lift = CARRY_CLEARANCE,
): Placement[] {
  const span = Math.max(Math.abs(to.yaw - from.yaw), Math.abs(to.pitch - from.pitch));
  const steps = Math.max(1, Math.ceil(span / TURN_STEP));
  const out: Placement[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push(
      pose(
        item,
        x,
        y,
        from.yaw + ((to.yaw - from.yaw) * i) / steps,
        from.pitch + ((to.pitch - from.pitch) * i) / steps,
        lift,
      ),
    );
  }
  return out;
}

/** How far the item reaches, held like this, about its own origin. */
function reachOf(item: PreparedItem, yawDeg: number, pitchDeg: number) {
  const b = orientedBounds(item, radians(yawDeg), radians(pitchDeg), 'y');
  return b;
}

/** Headroom an approach may assume in the corridor and the room. */
const CEILING = 250;

/**
 * The steepest the item can be tipped and still clear the lintel.
 *
 * Standing a long item on its end is the ideal — it turns inside its own
 * cross-section and needs almost no floor — but a 220 cm sofa does not go
 * through a 210 cm doorway standing up, and pretending otherwise would be the
 * kind of confident wrong answer this engine exists to avoid.
 *
 * So the angle is searched rather than assumed: take the steepest tip whose
 * silhouette still passes under the lintel, because steeper means less floor.
 * When the item is short enough, that search returns vertical on its own and
 * the maneuver really is "stand it on its end". When it is not, it returns the
 * angle a person would actually carry it at.
 *
 * `undefined` when tipping buys nothing: a nearly cubic item gains no floor
 * from being turned up, and the result would only duplicate straight-in.
 */
function carryingPitch(item: PreparedItem): { pitchDeg: number; travel: number } | undefined {
  const flat = reachOf(item, 0, 0);
  const length = flat.maxX - flat.minX;
  const height = flat.maxZ - flat.minZ;
  if (length <= height * 1.2) return undefined;

  let best: { pitchDeg: number; travel: number } | undefined;
  for (let pitchDeg = -90; pitchDeg <= -20; pitchDeg += 1) {
    const facing = reachOf(item, 90, pitchDeg);
    // The CEILING, not the lintel. A tipped item's envelope is taller than at
    // either extreme — a 220 cm sofa reaches 231 cm at 70 degrees — but that
    // height is what the corridor has to clear, and the corridor has a ceiling
    // rather than a doorframe. What has to pass under the lintel is the
    // SECTION at the wall, which `buildManeuver` measures from the motion.
    // Testing the envelope against the lintel here is the bounding-box mistake
    // this whole library exists to avoid, and it rejected every long sofa.
    if (facing.maxZ - facing.minZ > CEILING) continue;
    const travel = facing.maxY - facing.minY;
    if (best === undefined || travel < best.travel) best = { pitchDeg, travel };
  }
  // Only worth having if it saves floor against the maneuver it competes with.
  //
  // The comparison is with the item's LENGTH, because that is what the
  // square-to-the-door maneuvers need in front of the wall — a 220 cm sofa
  // asks for 222 cm of hallway. Comparing against its depth instead, as a
  // first version did, rejected exactly the long items this exists for.
  if (best === undefined || best.travel >= length * 0.9) return undefined;
  return best;
}

interface Options {
  id: string;
  name: string;
  nameHe: string;
  /**
   * Whether the item is laid down on the far side, and which way.
   *
   * `'along-the-wall'` turns it parallel to the room's wall before lowering it,
   * which is what makes a shallow room possible: laid that way it needs its own
   * depth behind the door rather than its whole length.
   */
  landing: 'along-the-wall' | 'left-standing';
}

/**
 * Stand it on end, turn it, walk it through, and put it down on the far side.
 *
 * Only applies when the doorway is tall enough to take the item standing up.
 * When it is not, the item has to be tipped down again before it crosses, and
 * that is a different maneuver.
 */
function buildUpright(options: Options) {
  return (item: PreparedItem, wallThickness: number): StageDraft[] | undefined => {
    const carrying = carryingPitch(item);
    if (carrying === undefined) return undefined;
    const pitch = carrying.pitchDeg;
    const upright = pitch <= -85;

    const flat = reachOf(item, 0, 0);
    const standing = reachOf(item, 0, pitch);
    const facing = reachOf(item, 90, pitch);

    // Where it stands while it turns: far enough back that nothing of it, at
    // any angle of the turn, is inside the wall.
    const turningReach = Math.max(standing.maxY, facing.maxY, flat.maxY);
    const stand = -turningReach - MARGIN;

    // Lying along the corridor first, so standing it up costs length along the
    // wall rather than depth in front of it.
    // Carried, not dragged. The height at which a turning body rests is a chord
    // against an arc, so interpolating between two poses that each just touch
    // the floor passes below it — invisibly, and the collider counts it.
    const lyingAlong = sweep(item, 0, stand, { yaw: 0, pitch: 0 }, { yaw: 0, pitch });
    const turnToFace = sweep(item, 0, stand, { yaw: 0, pitch }, { yaw: 90, pitch });

    const carryFrom = pose(item, 0, stand, 90, pitch);
    const carryTo = pose(item, 0, wallThickness - facing.minY + MARGIN, 90, pitch);

    const stages: StageDraft[] = [
      {
        id: 'stand-up',
        name: upright
          ? 'Stand it on its end in the corridor'
          : `Tip it up to ${Math.abs(pitch)}° in the corridor`,
        nameHe: upright
          ? 'להעמיד אותה על הקצה במסדרון'
          : `להטות אותה ל-${Math.abs(pitch)}° במסדרון`,
        waypoints: [pose(item, 0, stand, 0, 0, 0), ...lyingAlong],
      },
      {
        id: 'turn-to-face',
        name: 'Turn it to face the doorway',
        nameHe: 'לסובב אותה אל מול הפתח',
        waypoints: [...turnToFace, carryFrom],
      },
      {
        id: 'carry-through',
        name: upright ? 'Walk it through standing up' : 'Walk it through tipped up',
        nameHe: upright ? 'להעביר אותה דרך הפתח בעמידה' : 'להעביר אותה דרך הפתח בהטיה',
        waypoints: [carryFrom, carryTo],
      },
    ];

    if (options.landing === 'along-the-wall') {
      const room = carryTo.y;
      const turnInRoom = sweep(item, 0, room, { yaw: 90, pitch }, { yaw: 0, pitch });
      const lower = sweep(item, 0, room, { yaw: 0, pitch }, { yaw: 0, pitch: 0 });
      stages.push(
        {
          id: 'turn-in-room',
          name: 'Turn it along the room’s wall',
          nameHe: 'לסובב אותה לאורך קיר החדר',
          waypoints: [carryTo, ...turnInRoom],
        },
        {
          id: 'lay-down',
          name: 'Lay it down along the wall',
          nameHe: 'להניח אותה לאורך הקיר',
          waypoints: [turnInRoom[turnInRoom.length - 1]!, ...lower, pose(item, 0, room, 0, 0, 0)],
        },
      );
    } else {
      // Left standing: the room only has to take its end, not its length.
      // Far enough in that all of it is past the wall, then set down where it
      // stands. The room only has to take its end, not its length.
      const inside = wallThickness - facing.minY + MARGIN;
      stages.push({
        id: 'set-down-standing',
        name: upright ? 'Set it down still standing' : 'Set it down still tipped up',
        nameHe: upright ? 'להניח אותה בעמידה' : 'להניח אותה בהטיה',
        waypoints: [carryTo, pose(item, 0, inside, 90, pitch), pose(item, 0, inside, 90, pitch, 0)],
      });
    }

    return stages;
  };
}

/**
 * Stand it up, turn it, carry it through, and lay it along the room's wall.
 *
 * The one that fixes shallow rooms. Laid parallel to the wall it came through,
 * an item needs its own depth behind the doorway rather than its whole length —
 * about a metre instead of two and a bit.
 */
export const UPRIGHT_THROUGH: ManeuverTemplate = {
  id: 'upright-through',
  name: 'Stood on end, turned, and walked through',
  nameHe: 'בעמידה על הקצה, מסובבת ומועברת',
  build: buildUpright({
    id: 'upright-through',
    name: 'Stood on end, turned, and walked through',
    nameHe: 'בעמידה על הקצה, מסובבת ומועברת',
    landing: 'along-the-wall',
  }),
};

/**
 * The same, but left standing on the far side.
 *
 * For a room too shallow even to lay the thing down along its wall. Whether a
 * shopper wants their sofa left on its end is their business; the engine's job
 * is to say that the doorway was never the problem.
 */
export const UPRIGHT_LEFT_STANDING: ManeuverTemplate = {
  id: 'upright-left-standing',
  name: 'Stood on end and left standing inside',
  nameHe: 'בעמידה על הקצה, נשארת עומדת בפנים',
  build: buildUpright({
    id: 'upright-left-standing',
    name: 'Stood on end and left standing inside',
    nameHe: 'בעמידה על הקצה, נשארת עומדת בפנים',
    landing: 'left-standing',
  }),
};

export { carryingPitch, degrees };
