import type { Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { TravelAxis } from './footprint.ts';
import { degrees } from '../math/rotation.ts';
import { interpolate } from '../planner/edge.ts';
import { itemLocalBoxes, orientedBounds, slabSection, slabSectionsByBox } from './footprint.ts';

/**
 * The parts an item is actually modelled as, each with its own measurements.
 *
 * "180 x 100 x 105 cm, 6 boxes" is an envelope. It says nothing about why the
 * recliner needs a metre of doorway, and a reader cannot tell from it that the
 * housing across its back is what adds the last ten centimetres. This is the
 * model itself, published: what the parts are, how big each one is, where it
 * sits, and — for the one that decides the answer — by how much.
 *
 * Every figure is read off the boxes. Nothing here is written down twice.
 */
export interface PartLine {
  label: string;
  labelHe: string;
  /** How many boxes carry this name. */
  boxes: number;
  /**
   * The size of ONE of them, not of their union.
   *
   * A pair of armrests is two boxes 220 cm apart; the union of the two is
   * 220 cm long and that is not the size of an armrest. What a reader wants is
   * "two of them, 10 x 95 x 55 each", so these are the extents of the largest
   * single box carrying the name, and `from`/`to` below say how far apart they
   * are spread.
   */
  length: number;
  depth: number;
  height: number;
  /** Where it sits vertically, so "stops 22 cm below the back" is derivable. */
  bottom: number;
  top: number;
  /** How far along the item's length it reaches, for parts that do not span it. */
  from: number;
  to: number;
  /** The lean an author gave it, in degrees, when it has one. */
  leanDeg?: number;
  /** True for the part the binding station is named after. */
  binding: boolean;
  /** How much narrower the item's floor would be without it. */
  bindsBy?: number;
}

/** Group the item's boxes by the name their author gave them. */
export function partBreakdown(
  item: PreparedItem,
  binding?: { label: string; floor: number; floorWithout: number },
): PartLine[] {
  const local = itemLocalBoxes(item);
  const groups = new Map<
    string,
    {
      labelHe: string;
      boxes: number;
      minX: number; maxX: number;
      minY: number; maxY: number;
      minZ: number; maxZ: number;
      lean: number;
      /** Extents of the largest single box, which is what gets reported. */
      one: { length: number; depth: number; height: number; volume: number };
    }
  >();

  for (let i = 0; i < item.item.boxes.length; i++) {
    const declared = item.item.boxes[i]!;
    const world = local[i]!;
    const label = declared.label ?? 'the body';
    // The largest angle its author gave it. A sofa back leans; that is a fact
    // about the furniture and belongs on the page.
    const lean = [declared.rotation.yaw, declared.rotation.pitch, declared.rotation.roll].reduce(
      (worst, angle) => (Math.abs(angle) > Math.abs(worst) ? angle : worst),
      0,
    );

    const size = {
      length: world.aabbMax.x - world.aabbMin.x,
      depth: world.aabbMax.y - world.aabbMin.y,
      height: world.aabbMax.z - world.aabbMin.z,
      volume: 0,
    };
    size.volume = size.length * size.depth * size.height;

    const existing = groups.get(label);
    if (existing === undefined) {
      groups.set(label, {
        labelHe: declared.labelHe ?? 'הגוף',
        boxes: 1,
        one: size,
        minX: world.aabbMin.x, maxX: world.aabbMax.x,
        minY: world.aabbMin.y, maxY: world.aabbMax.y,
        minZ: world.aabbMin.z, maxZ: world.aabbMax.z,
        lean,
      });
    } else {
      existing.boxes++;
      existing.minX = Math.min(existing.minX, world.aabbMin.x);
      existing.maxX = Math.max(existing.maxX, world.aabbMax.x);
      existing.minY = Math.min(existing.minY, world.aabbMin.y);
      existing.maxY = Math.max(existing.maxY, world.aabbMax.y);
      existing.minZ = Math.min(existing.minZ, world.aabbMin.z);
      existing.maxZ = Math.max(existing.maxZ, world.aabbMax.z);
      if (Math.abs(lean) > Math.abs(existing.lean)) existing.lean = lean;
      if (size.volume > existing.one.volume) existing.one = size;
    }
  }

  const out: PartLine[] = [];
  for (const [label, g] of groups) {
    const isBinding = binding !== undefined && binding.label === label;
    out.push({
      label,
      labelHe: g.labelHe,
      boxes: g.boxes,
      length: g.one.length,
      depth: g.one.depth,
      height: g.one.height,
      bottom: g.minZ,
      top: g.maxZ,
      from: g.minX,
      to: g.maxX,
      ...(Math.abs(g.lean) > 1e-9 ? { leanDeg: degrees(g.lean) } : {}),
      binding: isBinding,
      ...(isBinding && binding.floorWithout < binding.floor
        ? { bindsBy: binding.floor - binding.floorWithout }
        : {}),
    });
  }
  // Tallest first: a reader scanning for "what makes this thing big" is looking
  // for the parts that reach furthest, not the ones declared first.
  out.sort((a, b) => b.top - a.top || a.label.localeCompare(b.label));
  return out;
}

/**
 * One moment of the crossing: what is in the doorway, and how the item is held.
 *
 * A maneuver shown as a single step — "carry it through on its side" — hides
 * the thing this engine exists to compute. A reader cannot see from it that
 * the angle is the same from one end of the sofa to the other, and so cannot
 * see that a different maneuver changes the angle *while the item is in the
 * opening*, which no doorway calculator can express at all.
 *
 * So the crossing is broken into stations. At each one: which part of the item
 * is passing through the wall, how wide its section is there, and what angle it
 * is held at. A constant-angle maneuver shows the same angle at every station.
 * A turning one does not. That contrast is the argument.
 */
export interface CrossingStation {
  /** Position along the path, from 0 at the first contact to 1 at the last. */
  t: number;
  /** Where the wall sits along the item's own travel axis, in centimetres. */
  station: number;
  /** Parts with material in the doorway at that moment, tallest first. */
  parts: string[];
  partsHe: string[];
  /** What the section actually needs there. */
  width: number;
  height: number;
  /** The angle the item is held at, in degrees. */
  rollDeg: number;
}

/**
 * Walk a path and report the crossing, station by station.
 *
 * Sampled at the resolution the measurement used, then thinned to `count`
 * evenly spaced stations so the result is readable. Only the samples where the
 * item is actually inside the wall count as crossing.
 */
export function crossingStations(
  item: PreparedItem,
  path: readonly Placement[],
  wallThickness: number,
  travelAxis: TravelAxis,
  count = 7,
): CrossingStation[] {
  const bounds = orientedBounds(item, 0, 0, 'y');
  const itemFrom = travelAxis === 'x' ? bounds.minX : bounds.minY;
  const itemTo = travelAxis === 'x' ? bounds.maxX : bounds.maxY;

  interface Sample {
    index: number;
    placement: Placement;
    width: number;
    height: number;
    station: number;
  }

  // Interpolated, not waypoint by waypoint. The whole crossing of an
  // "on its side" maneuver is a single edge between two waypoints, so reading
  // the waypoints alone would report a two-station crossing — or none, since
  // neither endpoint is inside the wall.
  const samples: Sample[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const move = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const turn = Math.abs(to.yaw - from.yaw) + Math.abs(to.pitch - from.pitch);
    const steps = Math.max(1, Math.ceil((move + turn * item.reach) / 1));
    for (let k = 0; k < steps; k++) {
      const placement = interpolate(from, to, k / steps);
      const section = slabSection(item, placement, 0, wallThickness);
      if (section === undefined) continue;
      // World y = origin + the item's own coordinate along the travel axis, so
      // this is the point of the item the wall's near face is at.
      const station = Math.min(Math.max(-placement.y, itemFrom), itemTo);
      samples.push({
        index: i + k / steps,
        placement,
        width: section.maxX - section.minX,
        height: section.maxZ,
        station,
      });
    }
  }
  if (samples.length === 0) return [];

  const picked: CrossingStation[] = [];
  const wanted = Math.min(count, samples.length);
  for (let k = 0; k < wanted; k++) {
    const sample = samples[Math.round((k * (samples.length - 1)) / Math.max(1, wanted - 1))]!;
    const { placement } = sample;

    // Which parts have material inside the wall at this moment.
    const present = new Map<string, { labelHe: string; top: number }>();
    for (const [index, section] of slabSectionsByBox(item, placement, 0, wallThickness)) {
      const declared = item.item.boxes[index]!;
      const label = declared.label ?? 'the body';
      const existing = present.get(label);
      if (existing === undefined || section.maxZ > existing.top) {
        present.set(label, { labelHe: declared.labelHe ?? 'הגוף', top: section.maxZ });
      }
    }
    const ordered = [...present.entries()].sort((a, b) => b[1].top - a[1].top);

    picked.push({
      t: path.length < 2 ? 0 : sample.index / (path.length - 1),
      station: sample.station,
      parts: ordered.map(([label]) => label),
      partsHe: ordered.map(([, v]) => v.labelHe),
      width: sample.width,
      height: sample.height,
      rollDeg: degrees(placement.pitch),
    });
  }
  return picked;
}

/** Does the item's angle change while it is inside the doorway? */
export function turnsInTheOpening(stations: readonly CrossingStation[]): boolean {
  if (stations.length < 2) return false;
  let low = Infinity;
  let high = -Infinity;
  for (const station of stations) {
    if (station.rollDeg < low) low = station.rollDeg;
    if (station.rollDeg > high) high = station.rollDeg;
  }
  // A degree of slack, so that a maneuver holding one angle is not called a
  // turning one by the sampling.
  return high - low > 1;
}
