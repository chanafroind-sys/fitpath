import type { AxisBox, Environment, Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { LatticeRequest } from './lattice.ts';
import { angleDelta, radians } from '../math/rotation.ts';
import { itemWorldBoxes } from '../geometry/collide.ts';
import { contains, unionAabb } from '../geometry/worldBox.ts';
import { interpolate } from './edge.ts';
import type { EdgeValidator } from './edge.ts';

/**
 * Re-cut a coarse-rung path at the reference resolution.
 *
 * A coarse rung is allowed to decide *feasibility* — its steps are exact
 * integer multiples of the reference lattice's and it shares the same origin,
 * so a coarse path really is a valid path. It is not allowed to decide what a
 * person is told to do, and the difference is not cosmetic.
 *
 * The 8 cm / 30 degree rung solves a 96 cm doorway by lifting a sofa a metre off
 * the floor and swinging it from 60 degrees of pitch to minus 60. That is a
 * valid motion and an absurd instruction. It happens because smoothing can only
 * cut corners between waypoints it is given, and a coarse path gives it six.
 *
 * So each coarse edge is subdivided into reference-sized pieces before
 * smoothing runs. **This does not change the path**: the pieces lie on the same
 * straight interpolation the edge validator already cleared, so the motion is
 * identical and no new claim is made about it. What changes is how many places
 * the smoother is allowed to cut, which is what turns a staircase over a coarse
 * grid back into the few motions a person would actually perform.
 *
 * Deterministic: the piece count is arithmetic on the two endpoints, and
 * `interpolate` takes yaw the short way round exactly as the validator did.
 */
export function refinePath(path: readonly Placement[], fine: LatticeRequest): Placement[] {
  if (path.length < 2) return path.slice();

  const yawStep = radians(fine.yawStepDeg);
  const pitchStep = radians(fine.pitchStepDeg);

  const out: Placement[] = [path[0]!];
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;

    // How many reference steps this edge spans, taken over every dimension at
    // once — a pivot move changes several, so the widest one governs.
    const pieces = Math.max(
      1,
      Math.ceil(Math.abs(to.x - from.x) / fine.stepX - 1e-9),
      Math.ceil(Math.abs(to.y - from.y) / fine.stepY - 1e-9),
      Math.ceil(Math.abs(to.z - from.z) / fine.stepZ - 1e-9),
      Math.ceil(Math.abs(angleDelta(from.yaw, to.yaw)) / yawStep - 1e-9),
      Math.ceil(Math.abs(to.pitch - from.pitch) / pitchStep - 1e-9),
    );

    for (let k = 1; k <= pieces; k++) {
      out.push(k === pieces ? to : interpolate(from, to, k / pieces));
    }
  }
  return out;
}

/** Blends tried when pulling a waypoint toward rest, strongest first. */
const RELAXATION_BLENDS = [1, 0.75, 0.5, 0.25] as const;

/** Passes over the path. Each one can only improve on the last. */
const RELAXATION_PASSES = 3;

/** Where the item's underside sits when it is level, so "resting" has a number. */
function restingHeight(item: PreparedItem): number {
  const bounds = unionAabb(itemWorldBoxes(item, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
  return -bounds.minZ;
}

function roomBox(environment: Environment): AxisBox {
  return environment.room;
}

/**
 * Pull the path back toward the floor and toward level.
 *
 * Smoothing removes waypoints; it never moves one. So a route that lifts a sofa
 * a metre in the air and swings it through 120 degrees of pitch survives
 * smoothing intact — every waypoint is necessary to the *shape* the search
 * happened to find, even though the shape itself is silly.
 *
 * This asks a different question of each waypoint: could you be lower, and
 * flatter, and still get from your neighbour to your neighbour? A waypoint is
 * only moved when both of its edges revalidate, so the result is a path in
 * exactly the same sense as the one that went in. The last waypoint is also
 * required to still be a goal — inside the room — or the path would end
 * somewhere it had not arrived.
 *
 * Deterministic: fixed blends, strongest first, fixed pass count.
 */
export function relaxPath(
  item: PreparedItem,
  environment: Environment,
  path: readonly Placement[],
  validator: EdgeValidator,
): Placement[] {
  if (path.length < 2) return path.slice();

  const restZ = restingHeight(item);
  const room = roomBox(environment);
  const current = path.slice();

  const settled = (p: Placement): Placement => ({ ...p, z: restZ, pitch: 0 });

  const isGoal = (p: Placement): boolean =>
    contains(room, unionAabb(itemWorldBoxes(item, p)));

  for (let pass = 0; pass < RELAXATION_PASSES; pass++) {
    let changed = false;

    for (let i = 1; i < current.length; i++) {
      const before = current[i - 1]!;
      const here = current[i]!;
      const after = i + 1 < current.length ? current[i + 1] : undefined;
      // Two things to ask of a waypoint: could you be lower and flatter, and
      // could you be closer to the straight line between your neighbours? The
      // first removes lifts and tilts that exist only to satisfy the goal test;
      // the second removes detours the coarse lattice forced — a turn to 30
      // degrees on the way to minus 90, say.
      const towardRest = settled(here);
      const towardLine =
        after !== undefined ? interpolate(before, after, 0.5) : undefined;

      let moved = false;
      for (const aim of [towardRest, towardLine]) {
        if (aim === undefined || moved) continue;
        for (const blend of RELAXATION_BLENDS) {
          const candidate = interpolate(here, aim, blend);
          if (after === undefined && !isGoal(candidate)) continue;
          if (!validator.isValid(before, candidate)) continue;
          if (after !== undefined && !validator.isValid(candidate, after)) continue;
          current[i] = candidate;
          moved = true;
          changed = true;
          break;
        }
      }
    }

    if (!changed) break;
  }

  return current;
}

/** How far past the first goal the item may be carried to find somewhere to set it down. */
const SETTLE_REACH = 400;

/** Step used when looking for that spot, in centimetres. */
const SETTLE_STEP = 2;

/**
 * Carry the item in far enough to put it down.
 *
 * A* stops at the first configuration whose bounding box lies inside the room,
 * and this is where that bites: **tipping the item up shrinks its bounding
 * box**, so standing a sofa on end is a cheaper way to "be in the room" than
 * carrying it another half metre and setting it down. The search is right — that
 * is a goal by the definition it was given — and the instruction that comes out
 * of it, "tilt the back edge up about 120 degrees", is ridiculous.
 *
 * So once a path is found, look for a settled pose beyond its end: same
 * bearing, level, resting on the floor, far enough in to be wholly inside the
 * room. If one is reachable in a single validated motion, append it. Smoothing
 * then has somewhere better to aim, and the lift and the tilt that existed only
 * to shrink a bounding box get cut away.
 *
 * This never changes the answer. It appends a motion, and only one the edge
 * validator has cleared and the goal test still accepts.
 */
export function settlePath(
  item: PreparedItem,
  environment: Environment,
  path: readonly Placement[],
  validator: EdgeValidator,
): Placement[] {
  const last = path[path.length - 1];
  if (last === undefined) return path.slice();

  const restZ = restingHeight(item);
  const room = environment.room;

  const inRoom = (p: Placement): boolean =>
    contains(room, unionAabb(itemWorldBoxes(item, p)));

  /** Every placement in `legs` reachable in turn, starting from `last`. */
  const walk = (legs: readonly Placement[]): Placement[] | undefined => {
    let from = last;
    for (const leg of legs) {
      if (!validator.isValid(from, leg)) return undefined;
      from = leg;
    }
    return [...path, ...legs];
  };

  for (let dy = 0; dy <= SETTLE_REACH; dy += SETTLE_STEP) {
    const y = last.y + dy;
    const target: Placement = { x: last.x, y, z: restZ, yaw: last.yaw, pitch: 0 };
    if (!inRoom(target)) continue;

    // Straight in and down, when the room allows it.
    const direct = walk([target]);
    if (direct !== undefined) return direct;

    // Otherwise carry it in, level it in the air, and only then lower it.
    // Interpolating height and pitch together swings the low end below the
    // floor, which is why the one-motion version fails on a long item.
    const carried: Placement = { ...last, y };
    const levelled: Placement = { x: last.x, y, z: last.z, yaw: last.yaw, pitch: 0 };
    const staged = walk([carried, levelled, target]);
    if (staged !== undefined) return staged;
  }
  return path.slice();
}
