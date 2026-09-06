import type { Environment, Placement } from '../types.ts';
import type { CollisionCounter, PreparedItem } from '../geometry/collide.ts';
import type { EdgeValidator } from './edge.ts';
import type { Lattice, NodeIndices } from './lattice.ts';
import type { SearchOutcome } from './astar.ts';
import { collides, itemWorldBoxes } from '../geometry/collide.ts';
import { contains, unionAabb } from '../geometry/worldBox.ts';
import { inBounds, packKey, placementInto, placementOf, snap, unpackKey, unpackKeyInto } from './lattice.ts';
import {
  Heap,
  IS_CLEAR,
  KNOWN_CLEAR,
  NodeTable,
  expandNeighbours,
  pivotAnchors,
  type Vec3Scratch,
} from './astar.ts';

/**
 * Search from both ends at once.
 *
 * The asymmetry this exists to exploit: **finding a path only requires
 * stumbling on one working sequence; proving there is none requires exhausting
 * the space.** One tree grown from the start has to reach a depth of roughly
 * thirty moves through a branching factor of twenty-two. Two trees that meet in
 * the middle each have to reach fifteen, and fifteen is not half of thirty when
 * the cost is exponential in it.
 *
 * ## What it is allowed to conclude
 *
 * Only "yes". Every edge is validated by the same `EdgeValidator` the ladder
 * uses, so a path this returns is a real path. But the backward tree is grown
 * from a fixed handful of settled poses rather than from the whole goal region,
 * so failing to meet proves nothing whatever, and the caller must fall through
 * to the full search. That is the same standing as the greedy pass.
 *
 * ## Determinism
 *
 * A fixed seed order, a strict alternation of one expansion each, the same
 * fixed neighbour order as the ladder, and the same total order on the heap
 * `(f, then h, then the packed key)`. The two trees never race.
 *
 * ## Why reversing the backward tree is sound
 *
 * An edge is validated by sampling the straight interpolation between two
 * placements, and that segment is the same segment traversed either way — yaw
 * included, since `interpolate` takes the short way round in both directions.
 * So an edge the backward tree cleared from B to A is a motion from A to B.
 */

/** How far past the goal plane to look for a settled pose to seed from. */
const SEED_SCAN = 600;

export interface BidirectionalRequest {
  item: PreparedItem;
  environment: Environment;
  lattice: Lattice;
  validator: EdgeValidator;
  start: NodeIndices;
  maxNodes: number;
  counter: CollisionCounter;
  usePivots: boolean;
}

/**
 * One half of the search: its own parents, costs and frontier.
 *
 * The same open-addressed table of typed arrays the ladder uses. A pair of
 * `Map`s reads more clearly and cost about thirty times as much per node, which
 * on a 60,000-node budget is the difference between two hundred milliseconds
 * and six seconds.
 */
interface Tree {
  table: NodeTable;
  frontier: Heap;
  /** Guides this tree toward the other end. */
  heuristic: (n: NodeIndices) => number;
}

function makeTree(heuristic: (n: NodeIndices) => number): Tree {
  return { table: new NodeTable(), frontier: new Heap(), heuristic };
}

/** Marks a node this tree has actually reached, as opposed to merely tested. */
const REACHED = 8;

/** The cost recorded for a key, or undefined when this tree has not reached it. */
function costOf(tree: Tree, key: number): number | undefined {
  const slot = tree.table.find(key);
  if (slot < 0) return undefined;
  return (tree.table.state[slot]! & REACHED) === 0 ? undefined : tree.table.g[slot]!;
}

/**
 * Settled poses to grow the backward tree from: level, resting on the floor,
 * far enough into the room to be wholly inside it, one per yaw index.
 *
 * Settled rather than arbitrary because that is where a delivery actually ends,
 * and because the path post-processing settles the item anyway — seeding from
 * poses it would have to reach in the end costs nothing and aims the tree
 * somewhere useful.
 */
function goalSeeds(
  item: PreparedItem,
  environment: Environment,
  lattice: Lattice,
): NodeIndices[] {
  const bounds = unionAabb(itemWorldBoxes(item, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
  const restZ = -bounds.minZ;
  const seeds: NodeIndices[] = [];

  for (let iyaw = 0; iyaw < lattice.nyaw; iyaw++) {
    const template = snap(lattice, { x: 0, y: 0, z: restZ, yaw: 0, pitch: 0 });
    const candidate: NodeIndices = {
      ix: template.ix,
      iy: lattice.iyGoalMin,
      iz: template.iz,
      iyaw,
      ipitch: template.ipitch,
    };

    const limit = Math.ceil(SEED_SCAN / lattice.stepY);
    for (let step = 0; step <= limit; step++) {
      candidate.iy = lattice.iyGoalMin + step;
      if (!inBounds(lattice, candidate)) break;
      const placement = placementOf(lattice, candidate);
      if (!contains(environment.room, unionAabb(itemWorldBoxes(item, placement)))) continue;
      if (collides(item, placement, environment)) continue;
      seeds.push({ ...candidate });
      break;
    }
  }
  return seeds;
}

export function searchBidirectional(request: BidirectionalRequest): SearchOutcome {
  const { item, environment, lattice, validator, start, maxNodes, counter } = request;
  const anchors = request.usePivots ? pivotAnchors(item) : [];

  const seeds = goalSeeds(item, environment, lattice);
  let nodesGenerated = 0;
  let nodesExpanded = 0;
  const nothing: SearchOutcome = {
    exhausted: false,
    budgetExhausted: false,
    nodesGenerated: 0,
    nodesExpanded: 0,
  };
  if (seeds.length === 0) return nothing;

  const startPlacement = placementOf(lattice, start);
  if (collides(item, startPlacement, environment, counter)) return nothing;

  // Forward is pulled toward the room; backward is pulled toward the start's y.
  const forward = makeTree((n) => Math.max(0, lattice.iyGoalMin - n.iy));
  const backward = makeTree((n) => Math.abs(n.iy - start.iy));

  const startKey = packKey(lattice, start);
  const startSlot = forward.table.create(startKey);
  forward.table.g[startSlot] = 0;
  forward.table.state[startSlot] = REACHED | KNOWN_CLEAR | IS_CLEAR;
  forward.frontier.push(0, 0, startKey);
  nodesGenerated++;

  for (const seed of seeds) {
    const key = packKey(lattice, seed);
    if (costOf(backward, key) !== undefined) continue;
    const seedSlot = backward.table.create(key);
    backward.table.g[seedSlot] = 0;
    backward.table.state[seedSlot] = REACHED | KNOWN_CLEAR | IS_CLEAR;
    const h = backward.heuristic(seed);
    backward.frontier.push(h, h, key);
    nodesGenerated++;
  }

  const here: NodeIndices = { ix: 0, iy: 0, iz: 0, iyaw: 0, ipitch: 0 };
  const there: NodeIndices = { ix: 0, iy: 0, iz: 0, iyaw: 0, ipitch: 0 };
  const offset: Vec3Scratch = { x: 0, y: 0, z: 0 };
  const herePlacement: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const therePlacement: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  /** Walk parents to the root of one tree. */
  const chain = (tree: Tree, from: number): number[] => {
    const keys = [from];
    let cursor = from;
    for (;;) {
      const slot = tree.table.find(cursor);
      if (slot < 0) break;
      const next = tree.table.parent[slot]!;
      if (next < 0) break;
      keys.push(next);
      cursor = next;
    }
    return keys;
  };

  const join = (meet: number): Placement[] => {
    const toStart = chain(forward, meet).reverse();
    const toGoal = chain(backward, meet).slice(1);
    return [...toStart, ...toGoal].map((k) => placementOf(lattice, unpackKey(lattice, k)));
  };

  /** Expand the best node of one tree. Returns a meeting key when the trees touch. */
  const step = (tree: Tree, other: Tree): number | undefined | false => {
    if (tree.frontier.size === 0) return undefined;
    const key = tree.frontier.pop();
    nodesExpanded++;

    unpackKeyInto(lattice, key, here);
    placementInto(lattice, here, herePlacement);

    const g = costOf(tree, key)!;
    let met: number | undefined;
    let ranOut = false;

    expandNeighbours(lattice, anchors, here, herePlacement, there, offset, () => {
      if (met !== undefined) return false;
      if (!inBounds(lattice, there)) return true;
      const nextKey = packKey(lattice, there);
      if (nextKey === key) return true;

      // A slot is kept even for a candidate that turns out to be blocked, so
      // that its collision result is cached. Without this, a node in a crowded
      // region is re-tested every time any of its twenty-two neighbours offers
      // it, which is where this search spent most of its time. `create` resets
      // the slot, so it may only be called for a key the table has not seen.
      let slot = tree.table.find(nextKey);
      if (slot < 0) slot = tree.table.create(nextKey);
      else if ((tree.table.state[slot]! & REACHED) !== 0) return true;

      const state = tree.table.state[slot]!;
      let clear: boolean;
      if ((state & KNOWN_CLEAR) !== 0) {
        clear = (state & IS_CLEAR) !== 0;
      } else {
        placementInto(lattice, there, therePlacement);
        clear = !collides(item, therePlacement, environment, counter);
        tree.table.state[slot] = state | KNOWN_CLEAR | (clear ? IS_CLEAR : 0);
      }
      if (!clear) return true;

      if (nodesGenerated >= maxNodes) {
        ranOut = true;
        return false;
      }

      placementInto(lattice, there, therePlacement);
      // Both endpoints are known clear here, so only the motion between them is
      // left — the same split the ladder makes.
      if (!validator.isInteriorValid(herePlacement, therePlacement)) return true;

      nodesGenerated++;
      tree.table.g[slot] = g + 1;
      tree.table.parent[slot] = key;
      tree.table.state[slot] = tree.table.state[slot]! | REACHED;
      const h = tree.heuristic(there);
      tree.frontier.push(g + 1 + h, h, nextKey);

      if (costOf(other, nextKey) !== undefined) met = nextKey;
      return true;
    });

    if (met !== undefined) return met;
    return ranOut ? false : undefined;
  };

  // Strict alternation, forward first. Neither tree may run ahead of the other,
  // which is what keeps the meeting point in the middle and the result the same
  // on every machine.
  while (nodesGenerated < maxNodes) {
    const f = step(forward, backward);
    if (f === false) break;
    if (typeof f === 'number') {
      return { path: join(f), exhausted: false, budgetExhausted: false, nodesGenerated, nodesExpanded };
    }
    const b = step(backward, forward);
    if (b === false) break;
    if (typeof b === 'number') {
      return { path: join(b), exhausted: false, budgetExhausted: false, nodesGenerated, nodesExpanded };
    }
    if (forward.frontier.size === 0 || backward.frontier.size === 0) break;
  }

  return { exhausted: false, budgetExhausted: false, nodesGenerated, nodesExpanded };
}
