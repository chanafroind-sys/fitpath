import type { Environment } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { Lattice } from './lattice.ts';
import { itemWorldBoxes } from '../geometry/collide.ts';
import { unionAabb } from '../geometry/worldBox.ts';

/**
 * How far the goal is, counting the turning as well as the walking.
 *
 * ## The plateau this exists to close
 *
 * The heuristic it replaces was `max(0, iyGoalMin - iy)`: how many y-steps
 * short of the goal PLANE the item is. `iyGoalMin` has to be taken over the
 * most optimistic orientation or the estimate would overshoot, which for the
 * sofa puts it at y = 30 cm. But the goal TEST wants the whole item inside the
 * room, and for the orientation that actually fits a narrow doorway — laid on
 * its side, 220 cm of it lying along the corridor — that does not happen until
 * y = 126 cm. Between the two the old heuristic reads zero and A* is searching
 * blind, about fifty moves deep at a branching factor of twenty-two.
 *
 * ## What this computes
 *
 *     h(n) = min over orientations o of [ max(0, G(o) - y) + d(orientation(n), o) ]
 *
 * `G(o)` is the smallest y-index at which an item held at orientation `o` is
 * wholly inside the room, and `d` is the number of lattice moves needed to turn
 * from the node's orientation into `o`. So the estimate says: pick whichever
 * orientation you mean to arrive in, pay for the turning, and pay for the
 * walking that orientation still needs.
 *
 * It is **strictly tighter** than what it replaces, which is the same
 * expression with the `d` term dropped and the minimum taken over `G` alone.
 *
 * ## Why it is admissible
 *
 * Any real path ends at some orientation `o*` with `y >= G(o*)`. Getting there
 * needs at least `G(o*) - y` moves that change the y index and at least
 * `d(orientation(n), o*)` that change an angular index, and — pivots aside,
 * below — no single move changes both. So the path is at least as long as the
 * bracket for `o*`, and therefore at least as long as the minimum over all `o`.
 *
 * Two details keep that argument honest:
 *
 * - **`G` uses the y condition only.** Containment also constrains x and z, but
 *   those depend on where the item is placed across the corridor, not on how far
 *   in it has come. Ignoring them makes `G` smaller, which is the safe
 *   direction. What IS folded in is the orientations that can never be a goal at
 *   any position — ones taller than the room or wider than it — since that is a
 *   fact about the orientation rather than the placement.
 * - **Pivot moves are the same pre-existing exception.** A pivot turns and
 *   translates at once, so it can pay down both terms with one move, and no
 *   heuristic that adds them is provably admissible against it. The heuristic
 *   this replaces had the identical hole for the identical reason, and the
 *   README records it: completeness, termination and determinism are
 *   unaffected, and the path was never claimed to be shortest.
 *
 * ## Cost
 *
 * One breadth-first sweep over the orientation graph per orientation — 624 of
 * them on the reference lattice, six edges each — then one linear pass per
 * orientation to fold the result into a row indexed by y. A few milliseconds,
 * against a grid sweep of millions of cells for the distance field that was
 * tried and rejected earlier.
 *
 * Deterministic: fixed orientation order, fixed sweep order, no randomness.
 */

/** Stands in for "this orientation can never be a goal, at any position". */
const NEVER = 1 << 28;

export interface OrientationHeuristic {
  /** Estimated moves remaining from a node, never more than the true count. */
  at(iyaw: number, ipitch: number, itilt: number, iy: number): number;
}

/**
 * Canonical index for an orientation.
 *
 * A level pose belongs to family 0 whichever way it was spelled, matching what
 * `packKey` does, so the two families are one orientation at pitch 0 rather
 * than two that happen to look alike.
 */
function orientationIndex(lattice: Lattice, iyaw: number, ipitch: number, itilt: number): number {
  const p = ipitch - lattice.ipitchMin;
  const t = ipitch === 0 ? 0 : itilt;
  return (t * lattice.npitch + p) * lattice.nyaw + iyaw;
}

export function buildOrientationHeuristic(
  item: PreparedItem,
  environment: Environment,
  lattice: Lattice,
): OrientationHeuristic {
  const { nyaw, npitch, ntilt, ipitchMin, iyMin, ny, stepY } = lattice;
  const orientations = ntilt * npitch * nyaw;
  const room = environment.room;
  const roomWidth = room.maxX - room.minX;
  const roomHeight = room.maxZ - room.minZ;

  // --- G: the y-index at which each orientation is far enough in -----------
  const goalY = new Int32Array(orientations).fill(NEVER);
  for (let itilt = 0; itilt < ntilt; itilt++) {
    for (let ipitch = ipitchMin; ipitch < ipitchMin + npitch; ipitch++) {
      for (let iyaw = 0; iyaw < nyaw; iyaw++) {
        const index = orientationIndex(lattice, iyaw, ipitch, itilt);
        if (goalY[index] !== NEVER) continue;
        const aabb = unionAabb(
          itemWorldBoxes(item, {
            x: 0,
            y: 0,
            z: 0,
            yaw: iyaw * lattice.yawStep,
            pitch: ipitch * lattice.pitchStep,
            tiltAxis: (ipitch === 0 ? 0 : itilt) === 1 ? 'x' : 'y',
          }),
        );
        // Orientations that could never be inside the room however they are
        // placed. This is a property of the shape at that angle, not of where
        // it is, so ruling them out tightens the estimate soundly.
        if (aabb.maxX - aabb.minX > roomWidth) continue;
        if (aabb.maxZ - aabb.minZ > roomHeight) continue;
        goalY[index] = Math.ceil((room.minY - aabb.minY) / stepY - 1e-9);
      }
    }
  }

  // --- d: lattice distance between orientations ----------------------------
  // Six neighbours: yaw either way (wrapping), pitch either way, and at pitch
  // zero the pitch moves may enter either family.
  const neighbours: Int32Array[] = [];
  for (let itilt = 0; itilt < ntilt; itilt++) {
    for (let ipitch = ipitchMin; ipitch < ipitchMin + npitch; ipitch++) {
      for (let iyaw = 0; iyaw < nyaw; iyaw++) {
        const from = orientationIndex(lattice, iyaw, ipitch, itilt);
        if (neighbours[from] !== undefined) continue;
        const out: number[] = [
          orientationIndex(lattice, (iyaw + 1) % nyaw, ipitch, itilt),
          orientationIndex(lattice, (iyaw - 1 + nyaw) % nyaw, ipitch, itilt),
        ];
        for (const step of [-1, 1]) {
          const next = ipitch + step;
          if (next < ipitchMin || next >= ipitchMin + npitch) continue;
          if (ipitch === 0) {
            // Leaving level chooses the family.
            for (let family = 0; family < ntilt; family++) {
              out.push(orientationIndex(lattice, iyaw, next, family));
            }
          } else {
            out.push(orientationIndex(lattice, iyaw, next, itilt));
          }
        }
        neighbours[from] = Int32Array.from(out);
      }
    }
  }

  // --- fold both into one row of estimates per orientation -----------------
  const table = new Int32Array(orientations * ny).fill(NEVER);
  const distance = new Int32Array(orientations);
  const queue = new Int32Array(orientations);
  const order = Array.from({ length: orientations }, (_, i) => i).sort(
    (a, b) => goalY[a]! - goalY[b]!,
  );

  for (let source = 0; source < orientations; source++) {
    if (neighbours[source] === undefined) continue;
    distance.fill(-1);
    distance[source] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = source;
    while (head < tail) {
      const at = queue[head++]!;
      const next = distance[at]! + 1;
      for (const to of neighbours[at]!) {
        if (distance[to] !== -1) continue;
        distance[to] = next;
        queue[tail++] = to;
      }
    }

    // Orientations already far enough in at this y contribute their turning
    // cost alone, and more of them qualify as y grows — so sweep y upward
    // keeping a running best.
    const row = source * ny;
    let reached = NEVER;
    let cursor = 0;
    for (let k = 0; k < ny; k++) {
      const iy = iyMin + k;
      while (cursor < order.length && goalY[order[cursor]!]! <= iy) {
        const o = order[cursor++]!;
        const d = distance[o]!;
        if (d >= 0 && d < reached) reached = d;
      }
      table[row + k] = reached;
    }

    // The rest still owe walking as well as turning. Sweeping y downward keeps
    // the best `G + d` among orientations not yet reached at that y.
    let pending = NEVER;
    cursor = order.length - 1;
    for (let k = ny - 1; k >= 0; k--) {
      const iy = iyMin + k;
      while (cursor >= 0 && goalY[order[cursor]!]! > iy) {
        const o = order[cursor--]!;
        const d = distance[o]!;
        const g = goalY[o]!;
        if (d >= 0 && g < NEVER && g + d < pending) pending = g + d;
      }
      const owed = pending >= NEVER ? NEVER : pending - iy;
      if (owed < table[row + k]!) table[row + k] = owed;
    }
  }

  return {
    at(iyaw: number, ipitch: number, itilt: number, iy: number): number {
      const k = iy - iyMin;
      if (k < 0 || k >= ny) return 0;
      const value = table[orientationIndex(lattice, iyaw, ipitch, itilt) * ny + k]!;
      return value >= NEVER ? NEVER : value;
    },
  };
}

export { NEVER as UNREACHABLE_ORIENTATION };
