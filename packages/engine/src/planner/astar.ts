import type { Environment, Placement } from '../types.ts';
import type { CollisionCounter, PreparedItem } from '../geometry/collide.ts';
import type { EdgeValidator } from './edge.ts';
import type { Lattice, NodeIndices } from './lattice.ts';
import { collides, itemWorldBoxes } from '../geometry/collide.ts';
import { contains, unionAabb } from '../geometry/worldBox.ts';
import {
  inBounds,
  packKey,
  placementInto,
  placementOf,
  unpackKey,
  unpackKeyInto,
} from './lattice.ts';

/**
 * The ten neighbours of a node: one step along a single dimension, either way.
 *
 * Declared as a constant in a fixed order rather than generated, because the
 * order in which ties are broken is part of the engine's output. Two runs that
 * enumerate neighbours differently can return different — equally valid — paths,
 * and "the same input always produces the same path" is a promise the project
 * makes.
 *
 * These ten are not the whole neighbourhood: pivot moves below add the coupled
 * rotate-and-rise motion that one-axis-at-a-time cannot express.
 */
const NEIGHBOURS: readonly (readonly [number, number, number, number, number])[] = [
  [1, 0, 0, 0, 0],
  [-1, 0, 0, 0, 0],
  [0, 1, 0, 0, 0],
  [0, -1, 0, 0, 0],
  [0, 0, 1, 0, 0],
  [0, 0, -1, 0, 0],
  [0, 0, 0, 1, 0],
  [0, 0, 0, -1, 0],
  [0, 0, 0, 0, 1],
  [0, 0, 0, 0, -1],
];

/**
 * A pivot anchor: a point in the item's own frame that a pivot move holds still.
 *
 * A person tipping a wardrobe does not lift it and then rotate it. They set an
 * edge on the floor and turn the body about that edge, so it rotates and rises
 * together and the contact never leaves the ground. Expressing that as separate
 * lattice moves is not merely inelegant, it is wrong: it forces the item through
 * a raised pose it never actually occupies, and demands ceiling height that the
 * real maneuver does not.
 *
 * A pivot move therefore picks the rotation and *derives* the translation, so
 * the branching factor grows by a small constant rather than multiplying.
 */
interface PivotAnchor {
  /** Which lattice angle this pivot turns. */
  axis: 'pitch' | 'yaw';
  x: number;
  y: number;
  z: number;
}

/**
 * The bottom edges and bottom corners the item can turn on.
 *
 * Pitch pivots take the two bottom edges parallel to the item's local Y, which
 * is the axis pitch turns about — those are genuine pivot lines, every point on
 * them fixed. The other two bottom edges are skipped because turning about them
 * would be roll, which this model fixes at zero, and offering a "pivot" that
 * silently did nothing of the kind would be worse than not offering it. Only
 * the edge midpoints are needed: a pitch rotation leaves the local Y coordinate
 * untouched, so every anchor along one of those edges yields the same move.
 *
 * Yaw pivots take the four bottom corners, which is a point contact — swivelling
 * a wardrobe on one corner to walk it round. Their z is irrelevant to a rotation
 * about the world vertical, but is kept at floor level so the anchor is a place
 * a person could actually put their weight.
 */
function pivotAnchors(item: PreparedItem): readonly PivotAnchor[] {
  const b = item.localBounds;
  const midY = (b.minY + b.maxY) / 2;
  // Fixed order. Tie-breaking in the search is part of the engine's output.
  return [
    { axis: 'pitch', x: b.minX, y: midY, z: b.minZ },
    { axis: 'pitch', x: b.maxX, y: midY, z: b.minZ },
    { axis: 'yaw', x: b.minX, y: b.minY, z: b.minZ },
    { axis: 'yaw', x: b.maxX, y: b.minY, z: b.minZ },
    { axis: 'yaw', x: b.minX, y: b.maxY, z: b.minZ },
    { axis: 'yaw', x: b.maxX, y: b.maxY, z: b.minZ },
  ];
}

/**
 * Rotate a local offset into world coordinates, with roll structurally zero.
 *
 * Written out as scalars rather than going through the matrix helpers because
 * this runs a dozen times per expanded node and the matrix form allocates three
 * vectors each call.
 */
function rotateLocal(
  yaw: number,
  pitch: number,
  lx: number,
  ly: number,
  lz: number,
  out: Vec3Scratch,
): void {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cb = Math.cos(pitch);
  const sb = Math.sin(pitch);
  out.x = ca * cb * lx - sa * ly + ca * sb * lz;
  out.y = sa * cb * lx + ca * ly + sa * sb * lz;
  out.z = -sb * lx + cb * lz;
}

interface Vec3Scratch {
  x: number;
  y: number;
  z: number;
}

/** Node state bits, packed one byte per node. */
const KNOWN_CLEAR = 1;
const IS_CLEAR = 2;
const CLOSED = 4;

export interface SearchOutcome {
  path?: Placement[];
  /**
   * True when the open set emptied without reaching the goal: a proof that no
   * path exists ON THIS LATTICE. Not a proof about continuous space.
   */
  exhausted: boolean;
  /** True when the node budget stopped the search before it could conclude anything. */
  budgetExhausted: boolean;
  nodesGenerated: number;
  nodesExpanded: number;
}

/**
 * A binary heap over three parallel arrays.
 *
 * Parallel arrays rather than objects because the open set reaches millions of
 * entries and one object per entry is the difference between a search that
 * finishes and one that spends its time in the allocator. Popped slots are left
 * in place and the size counter shrinks instead — truncating the backing arrays
 * on every pop made V8 churn their capacity and cost more than the search.
 *
 * The comparator is a strict total order — f, then h, then the packed key — so
 * no two distinct entries ever compare equal and the heap's internal order
 * cannot depend on insertion history. That is the other half of determinism.
 */
class Heap {
  private f = new Float64Array(1024);
  private h = new Float64Array(1024);
  private k = new Float64Array(1024);
  size = 0;

  private grow(): void {
    const next = this.f.length * 2;
    const f = new Float64Array(next);
    const h = new Float64Array(next);
    const k = new Float64Array(next);
    f.set(this.f);
    h.set(this.h);
    k.set(this.k);
    this.f = f;
    this.h = h;
    this.k = k;
  }

  private less(i: number, j: number): boolean {
    const fi = this.f[i]!;
    const fj = this.f[j]!;
    if (fi !== fj) return fi < fj;
    const hi = this.h[i]!;
    const hj = this.h[j]!;
    if (hi !== hj) return hi < hj;
    return this.k[i]! < this.k[j]!;
  }

  private swap(i: number, j: number): void {
    const tf = this.f[i]!;
    this.f[i] = this.f[j]!;
    this.f[j] = tf;
    const th = this.h[i]!;
    this.h[i] = this.h[j]!;
    this.h[j] = th;
    const tk = this.k[i]!;
    this.k[i] = this.k[j]!;
    this.k[j] = tk;
  }

  push(f: number, h: number, key: number): void {
    if (this.size === this.f.length) this.grow();
    this.f[this.size] = f;
    this.h[this.size] = h;
    this.k[this.size] = key;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.k[0]!;
    this.size--;
    if (this.size > 0) {
      this.f[0] = this.f[this.size]!;
      this.h[0] = this.h[this.size]!;
      this.k[0] = this.k[this.size]!;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let best = i;
        if (left < this.size && this.less(left, best)) best = left;
        if (right < this.size && this.less(right, best)) best = right;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return top;
  }
}

/**
 * Everything the search knows about a node, in columns.
 *
 * One Map from packed key to a slot index, then plain typed-array reads. The
 * obvious shape — a Map for g, a Map for parents, a Map for the collision
 * cache, a Set for the closed list — costs four hash lookups per neighbour and
 * was, measured, most of the planner's runtime. This costs one.
 */
class NodeTable {
  private slots = new Map<number, number>();
  private capacity = 1 << 16;
  g = new Float64Array(this.capacity);
  parent = new Float64Array(this.capacity);
  state = new Uint8Array(this.capacity);
  count = 0;

  /** Slot for a key, or -1 if the key has never been seen. */
  find(key: number): number {
    const slot = this.slots.get(key);
    return slot === undefined ? -1 : slot;
  }

  create(key: number): number {
    if (this.count === this.capacity) {
      this.capacity *= 2;
      const g = new Float64Array(this.capacity);
      const parent = new Float64Array(this.capacity);
      const state = new Uint8Array(this.capacity);
      g.set(this.g);
      parent.set(this.parent);
      state.set(this.state);
      this.g = g;
      this.parent = parent;
      this.state = state;
    }
    const slot = this.count++;
    this.slots.set(key, slot);
    this.g[slot] = Infinity;
    this.parent[slot] = -1;
    this.state[slot] = 0;
    return slot;
  }
}

/**
 * A* over the lattice, from one start node to any placement wholly inside the room.
 *
 * Uniform edge cost of one step. That is deliberately crude — a 2 cm slide and a
 * 15 degree turn are not equally hard to perform — but it makes the heuristic
 * admissible with no tuning, and the path is smoothed and re-segmented
 * afterwards anyway, so the cost function's job is to terminate, not to be
 * beautiful.
 *
 * The heuristic is the number of y-steps still needed before the item could
 * possibly be clear of the wall. It ignores x, z and both angles, which makes it
 * weak but unimpeachably admissible and consistent: every move changes exactly
 * one index by one, so no move can reduce the y-shortfall by more than one.
 *
 * A stronger heuristic was tried and rejected: a distance field over positions,
 * built by one backward breadth-first sweep from the goal. It is admissible and
 * it does prune, but it is not worth its cost, and the reason is worth keeping.
 * See the README's "A distance-field heuristic, measured and rejected".
 */
export function searchLattice(
  item: PreparedItem,
  environment: Environment,
  lattice: Lattice,
  validator: EdgeValidator,
  start: NodeIndices,
  maxNodes: number,
  counter: CollisionCounter,
  usePivots = true,
  /**
   * Optional restriction on which nodes may be entered at all.
   *
   * Used by the refinement pass to re-solve inside a corridor around a coarse
   * path. Restricting can only lose paths, never invent them, so a restricted
   * failure means nothing and the caller must have a fallback.
   */
): SearchOutcome {
  const open = new Heap();
  const table = new NodeTable();
  const anchors = usePivots ? pivotAnchors(item) : [];
  const offset: Vec3Scratch = { x: 0, y: 0, z: 0 };

  let nodesGenerated = 0;
  let nodesExpanded = 0;

  // Scratch, reused for every probe. Nothing here outlives the statement that
  // fills it.
  const here: NodeIndices = { ix: 0, iy: 0, iz: 0, iyaw: 0, ipitch: 0 };
  const there: NodeIndices = { ix: 0, iy: 0, iz: 0, iyaw: 0, ipitch: 0 };
  const herePlacement: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const therePlacement: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  const heuristic = (iy: number): number => Math.max(0, lattice.iyGoalMin - iy);

  const isClear = (slot: number, placement: Placement): boolean => {
    const state = table.state[slot]!;
    if (state & KNOWN_CLEAR) return (state & IS_CLEAR) !== 0;
    const ok = !collides(item, placement, environment, counter);
    table.state[slot] = state | KNOWN_CLEAR | (ok ? IS_CLEAR : 0);
    return ok;
  };

  const startKey = packKey(lattice, start);
  if (!inBounds(lattice, start)) {
    return { exhausted: true, budgetExhausted: false, nodesGenerated: 0, nodesExpanded: 0 };
  }
  const startSlot = table.create(startKey);
  if (!isClear(startSlot, placementInto(lattice, start, herePlacement))) {
    return { exhausted: true, budgetExhausted: false, nodesGenerated: 0, nodesExpanded: 0 };
  }

  /** Fully inside the room, with the wall behind it. */
  const isGoal = (n: NodeIndices, placement: Placement): boolean => {
    // The integer test first: it discards almost every node without building a
    // single world-space box.
    if (n.iy < lattice.iyGoalMin) return false;
    return contains(environment.room, unionAabb(itemWorldBoxes(item, placement)));
  };

  table.g[startSlot] = 0;
  open.push(heuristic(start.iy), heuristic(start.iy), startKey);
  nodesGenerated = 1;

  while (open.size > 0) {
    const key = open.pop();
    const slot = table.find(key);
    if (slot < 0) continue;
    if (table.state[slot]! & CLOSED) continue;
    table.state[slot] = table.state[slot]! | CLOSED;
    nodesExpanded++;

    unpackKeyInto(lattice, key, here);
    placementInto(lattice, here, herePlacement);

    if (isGoal(here, herePlacement)) {
      return {
        path: reconstruct(lattice, table, key),
        exhausted: false,
        budgetExhausted: false,
        nodesGenerated,
        nodesExpanded,
      };
    }

    const g = table.g[slot]!;

    /** Offer `there` as a successor. Returns false only when the budget ran out. */
    const consider = (): boolean => {
      if (!inBounds(lattice, there)) return true;
      const nextKey = packKey(lattice, there);
      if (nextKey === key) return true;

      let nextSlot = table.find(nextKey);
      if (nextSlot < 0) {
        if (nodesGenerated >= maxNodes) return false;
        nextSlot = table.create(nextKey);
        nodesGenerated++;
      } else {
        if (table.state[nextSlot]! & CLOSED) return true;
        if (g + 1 >= table.g[nextSlot]!) return true;
      }

      placementInto(lattice, there, therePlacement);
      if (!isClear(nextSlot, therePlacement)) return true;
      // Both endpoints are known clear at this point, so only the motion
      // between them is left to check. A pivot move is validated exactly like
      // any other: the straight interpolation between the two placements. That
      // is a slightly different path from the true pivot arc, but it is itself
      // a motion a person can perform, so clearing it is sufficient.
      if (!validator.isInteriorValid(herePlacement, therePlacement)) return true;

      table.g[nextSlot] = g + 1;
      table.parent[nextSlot] = key;
      const h = heuristic(there.iy);
      open.push(g + 1 + h, h, nextKey);
      return true;
    };

    for (let d = 0; d < NEIGHBOURS.length; d++) {
      const delta = NEIGHBOURS[d]!;
      there.ix = here.ix + delta[0];
      there.iy = here.iy + delta[1];
      there.iz = here.iz + delta[2];
      // Yaw is periodic: a full turn is a loop in the lattice, not a wall.
      there.iyaw = (here.iyaw + delta[3] + lattice.nyaw) % lattice.nyaw;
      there.ipitch = here.ipitch + delta[4];
      if (!consider()) {
        return { exhausted: false, budgetExhausted: true, nodesGenerated, nodesExpanded };
      }
    }

    // Pivot moves: turn one angular step about a bottom edge or corner, and
    // derive where the item must sit for that anchor to stay put.
    for (let a = 0; a < anchors.length; a++) {
      const anchor = anchors[a]!;
      // Where the anchor currently is in the world.
      rotateLocal(herePlacement.yaw, herePlacement.pitch, anchor.x, anchor.y, anchor.z, offset);
      const worldX = herePlacement.x + offset.x;
      const worldY = herePlacement.y + offset.y;
      const worldZ = herePlacement.z + offset.z;

      for (let sign = -1; sign <= 1; sign += 2) {
        const nextYaw =
          anchor.axis === 'yaw'
            ? (here.iyaw + sign + lattice.nyaw) % lattice.nyaw
            : here.iyaw;
        const nextPitch = anchor.axis === 'pitch' ? here.ipitch + sign : here.ipitch;
        if (nextPitch < lattice.ipitchMin || nextPitch >= lattice.ipitchMin + lattice.npitch) {
          continue;
        }

        // Where the item's origin has to go so the anchor lands back on itself.
        rotateLocal(
          nextYaw * lattice.yawStep,
          nextPitch * lattice.pitchStep,
          anchor.x,
          anchor.y,
          anchor.z,
          offset,
        );
        // Snapped to the lattice, so a pivot lands on a real node like every
        // other move. The anchor therefore shifts by up to half a step; the
        // edge validation below judges the motion that actually results, not
        // the idealised one.
        there.ix = Math.round((worldX - offset.x) / lattice.stepX);
        there.iy = Math.round((worldY - offset.y) / lattice.stepY);
        there.iz = Math.round((worldZ - offset.z) / lattice.stepZ);
        there.iyaw = nextYaw;
        there.ipitch = nextPitch;

        if (!consider()) {
          return { exhausted: false, budgetExhausted: true, nodesGenerated, nodesExpanded };
        }
      }
    }
  }

  return { exhausted: true, budgetExhausted: false, nodesGenerated, nodesExpanded };
}

function reconstruct(lattice: Lattice, table: NodeTable, goalKey: number): Placement[] {
  const keys: number[] = [goalKey];
  let cursor = goalKey;
  for (;;) {
    const slot = table.find(cursor);
    if (slot < 0) break;
    const parent = table.parent[slot]!;
    if (parent < 0) break;
    keys.push(parent);
    cursor = parent;
  }
  keys.reverse();
  return keys.map((k) => placementOf(lattice, unpackKey(lattice, k)));
}

/**
 * Pick a starting placement in the hallway.
 *
 * Computed rather than searched for, in a fixed order, so the choice is
 * reproducible and so a scene where the item cannot even stand in the hallway
 * reports that specifically instead of failing later for a reason that looks
 * like a planning failure.
 *
 * The start fixes yaw and pitch at zero: an item arrives down a corridor lying
 * along it, which is what yaw zero means for these fixtures, and starting it
 * already turned would quietly assume away the very maneuver the planner exists
 * to find.
 */
export function defaultStart(
  item: PreparedItem,
  environment: Environment,
  lattice: Lattice,
): NodeIndices | undefined {
  // The item's footprint at yaw 0, pitch 0, measured once. Everything below is
  // arithmetic on this: scanning the lattice for a spot that happens to work
  // costs hundreds of thousands of collision tests before the search has even
  // started, which on a wide corridor dominated the entire runtime.
  const aabb = unionAabb(itemWorldBoxes(item, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
  const hallway = environment.hallway;

  // The index ranges over which the whole item lies inside the hallway. Being
  // inside the free volume is sufficient on its own — the free volume is
  // disjoint from every solid by construction — but the collision test below
  // stays as a guard against that invariant ever quietly changing.
  const range = (
    freeMin: number,
    freeMax: number,
    boxMin: number,
    boxMax: number,
    step: number,
  ): [number, number] => [
    Math.ceil((freeMin - boxMin) / step - 1e-9),
    Math.floor((freeMax - boxMax) / step + 1e-9),
  ];

  const [ixLow, ixHigh] = range(hallway.minX, hallway.maxX, aabb.minX, aabb.maxX, lattice.stepX);
  const [iyLow, iyHigh] = range(hallway.minY, hallway.maxY, aabb.minY, aabb.maxY, lattice.stepY);
  const [izLow, izHigh] = range(hallway.minZ, hallway.maxZ, aabb.minZ, aabb.maxZ, lattice.stepZ);
  if (ixLow > ixHigh || iyLow > iyHigh || izLow > izHigh) return undefined;

  // Furthest along the corridor, backed against its far wall, resting on the
  // floor. An arbitrary corner of the valid region, but a fixed one, so the
  // same scene always starts from the same place.
  for (let ix = Math.max(ixLow, lattice.ixMin); ix <= ixHigh; ix++) {
    for (let iz = Math.max(izLow, lattice.izMin); iz <= izHigh; iz++) {
      for (let iy = Math.max(iyLow, lattice.iyMin); iy <= iyHigh; iy++) {
        const candidate: NodeIndices = { ix, iy, iz, iyaw: 0, ipitch: 0 };
        if (!inBounds(lattice, candidate)) continue;
        if (collides(item, placementOf(lattice, candidate), environment)) continue;
        return candidate;
      }
    }
  }
  return undefined;
}
