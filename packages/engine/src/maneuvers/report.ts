import type { Item } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { ManeuverRequirement } from './types.ts';
import type { TravelAxis } from './footprint.ts';
import { prepareItem } from '../geometry/collide.ts';
import { radians } from '../math/rotation.ts';
import { bandSection, itemLocalBoxes, orientedBounds, rolledExtent } from './footprint.ts';
import { LINTEL, TEMPLATES, bestRollSchedule } from './templates.ts';
import { DEFAULT_WALL_THICKNESS, buildManeuver, wallThicknessBound } from './build.ts';
import { crossingStations, partBreakdown, turnsInTheOpening } from './parts.ts';
import type { CrossingStation, PartLine } from './parts.ts';

/** Stations within this of the worst one count as part of the bottleneck. */
const AT_THE_PEAK = 0.05;

/** A part has to be mostly inside the bottleneck to be the thing that names it. */
const MOSTLY_INSIDE = 0.5;

/** A reduction smaller than this is not worth telling anyone about. */
const WORTH_MENTIONING = 0.5;

export interface BindingPart {
  label: string;
  labelHe: string;
  /** How much of this part lies inside the binding run, from 0 to 1. */
  share: number;
  /** How much of the item's length the part occupies, in centimetres. */
  span: number;
  /** What the floor would be if this part were not there. */
  floorWithout: number;
}

/**
 * The stretch of an item that decides how wide a doorway it needs, and its name.
 *
 * Derived, never written down.
 *
 * The narrowest doorway an item can be got through is the widest that any one
 * band of it demands, once each band is turned to suit itself. So the interesting
 * thing is not the number but **which band**, and what is in it. For a
 * three-seater the answer is a run eight centimetres long at each end where the
 * legs are; for a corner sofa it is the metre where the chaise return joins; for
 * a sofa bed it is the whole thing, and saying so is the honest answer for the
 * hardest case in the catalogue.
 *
 * Two things had to be got right for this to say anything true. It uses each
 * station's own minimum over roll rather than the roll the schedule happens to
 * hold there, because a schedule holds one angle across a neighbourhood and
 * would smear the bottleneck over stations that do not cause it. And a part is
 * named for being *concentrated* in the bottleneck rather than for being
 * expensive to remove — removing the backrest lowers almost any sofa's floor,
 * since the backrest is what makes it tall, but the backrest is not the part
 * anybody means.
 */
export interface BindingStation {
  travelAxis: TravelAxis;
  /** The binding runs, in the item's own frame, along its travel axis. */
  runs: [number, number][];
  /** Their total length as a fraction of the item's own. */
  coverage: number;
  /** The narrowest doorway any roll schedule could manage. */
  floor: number;
  /** The roll at which the binding band is narrowest. */
  rollDeg: number;
  /** The part that names it, when one part is concentrated enough to. */
  part?: BindingPart;
  /** Every part with material in the binding run, most concentrated first. */
  parts: BindingPart[];
}

function withoutBoxes(item: PreparedItem, drop: ReadonlySet<number>): PreparedItem | undefined {
  const boxes = item.item.boxes.filter((_, i) => !drop.has(i));
  if (boxes.length === 0) return undefined;
  return prepareItem({ ...item.item, boxes, removableParts: [] });
}

function floorOf(item: PreparedItem, wallThickness: number): number | undefined {
  return bestRollSchedule(item, wallThickness)?.bound;
}

/**
 * Which stretch of an item decides its width, and what is in it.
 *
 * Asked two ways, because they have different answers and a shopper cares about
 * both. `turned` allows every roll, so it identifies what sets the floor — the
 * narrowest doorway anything could get the item through. `upright` holds the
 * item level, so it identifies what makes the item wide when it is simply
 * carried in, which is the maneuver anyone tries first.
 *
 * For a corner sofa the two differ completely: level, the chaise return makes
 * it 200 cm across; turned on its side, the height of its back sets 85 cm and
 * every station of it is equally to blame.
 */
export function bindingStation(
  item: PreparedItem,
  wallThickness: number,
  mode: 'turned' | 'upright' = 'turned',
): BindingStation | undefined {
  const schedule = bestRollSchedule(item, wallThickness);
  if (schedule === undefined) return undefined;

  const { travelAxis, ys, bound } = schedule;
  const stationFloors =
    mode === 'turned'
      ? schedule.stationFloors
      : ys.map((y) => {
          const band = bandSection(itemLocalBoxes(item), -y, wallThickness - y, travelAxis);
          return band.length === 0 ? 0 : rolledExtent(band, 0).width;
        });
  const local = itemLocalBoxes(item);
  const extent = (index: number): [number, number] => {
    const b = local[index]!;
    return travelAxis === 'x' ? [b.aabbMin.x, b.aabbMax.x] : [b.aabbMin.y, b.aabbMax.y];
  };

  // The runs of stations that force the widest opening.
  //
  // Runs, plural, and that is the whole difficulty. A three-seater's legs are
  // at both ends, so the bottleneck is two short stretches a metre apart; the
  // smallest interval containing both is the entire sofa, which would report
  // that every part of it binds equally. So the intervals are collected and
  // merged, and it is their total length that says how much of the item is
  // really the problem.
  let peak = -Infinity;
  for (const value of stationFloors) if (value > peak) peak = value;

  const bounds = orientedBounds(item, 0, 0, 'y');
  const itemFrom = travelAxis === 'x' ? bounds.minX : bounds.minY;
  const itemTo = travelAxis === 'x' ? bounds.maxX : bounds.maxY;

  const raw: [number, number][] = [];
  let worst = 0;
  for (let i = 0; i < stationFloors.length; i++) {
    if (stationFloors[i]! > stationFloors[worst]!) worst = i;
    if (stationFloors[i]! < peak - AT_THE_PEAK) continue;
    const low = Math.max(itemFrom, -ys[i]!);
    const high = Math.min(itemTo, wallThickness - ys[i]!);
    if (high > low) raw.push([low, high]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  for (const [low, high] of raw) {
    const last = runs[runs.length - 1];
    if (last !== undefined && low <= last[1]) last[1] = Math.max(last[1], high);
    else runs.push([low, high]);
  }
  const covered = runs.reduce((sum, [low, high]) => sum + (high - low), 0);
  const coverage = itemTo > itemFrom ? covered / (itemTo - itemFrom) : 1;

  // The roll that presents the worst band most narrowly, for the record.
  const worstBand = bandSection(local, -ys[worst]!, wallThickness - ys[worst]!, travelAxis);
  let rollDeg = 0;
  let narrowest = Infinity;
  if (mode === 'turned') {
    for (let d = -180; d < 180; d++) {
      const roll = radians(d);
      const { width, height } = rolledExtent(worstBand, roll);
      if (height > LINTEL) continue;
      if (width < narrowest) {
        narrowest = width;
        rollDeg = d;
      }
    }
  } else {
    narrowest = worstBand.length === 0 ? 0 : rolledExtent(worstBand, 0).width;
  }

  // Which parts live in those runs, and how much of each of them does.
  const inRuns = (lo: number, hi: number): number => {
    let total = 0;
    for (const [low, high] of runs) total += Math.max(0, Math.min(hi, high) - Math.max(lo, low));
    return total;
  };

  const groups = new Map<
    string,
    { labelHe: string; indices: Set<number>; inside: number; total: number }
  >();
  for (let i = 0; i < item.item.boxes.length; i++) {
    const [lo, hi] = extent(i);
    const box = item.item.boxes[i]!;
    const label = box.label ?? 'the body';
    const existing = groups.get(label);
    if (existing === undefined) {
      groups.set(label, {
        labelHe: box.labelHe ?? 'הגוף',
        indices: new Set([i]),
        inside: inRuns(lo, hi),
        total: hi - lo,
      });
    } else {
      existing.indices.add(i);
      existing.inside += inRuns(lo, hi);
      existing.total += hi - lo;
    }
  }

  const parts: BindingPart[] = [];
  for (const [label, group] of groups) {
    if (group.inside <= 0) continue;
    // In upright mode the removal experiment would answer a different question
    // than the one being asked — what the item needs when TURNED — so it is not
    // run, and the part is named on concentration alone.
    const reduced = mode === 'turned' ? withoutBoxes(item, group.indices) : undefined;
    const floorWithout = reduced === undefined ? peak : (floorOf(reduced, wallThickness) ?? peak);
    parts.push({
      label,
      labelHe: group.labelHe,
      share: group.total === 0 ? 0 : group.inside / group.total,
      span: group.total,
      floorWithout,
    });
  }
  // Most concentrated in the bottleneck first. Between parts that are equally
  // concentrated — a sofa's armrests and its legs are both wholly inside the
  // run they share — the one whose absence would help most, which is the one a
  // person could actually act on.
  parts.sort((a, b) => b.share - a.share || a.floorWithout - b.floorWithout || a.span - b.span);

  // The part that names the bottleneck: the one most concentrated in it whose
  // absence would actually move the number. Concentration alone is not enough —
  // a sofa bed's armrests sit wholly inside its binding run and account for
  // none of its width — and a reduction alone is not enough either, since
  // taking the back off almost any sofa makes it shorter and therefore
  // narrower on its side, which is true and useless.
  const named = parts.find(
    (part) =>
      part.share >= MOSTLY_INSIDE &&
      (mode === 'upright' || part.floorWithout < peak - WORTH_MENTIONING),
  );

  return {
    travelAxis,
    runs,
    coverage,
    floor: mode === 'turned' ? bound : peak,
    rollDeg,
    parts,
    ...(named !== undefined ? { part: named } : {}),
  };
}

export interface ManeuverLine {
  templateId: string;
  name: string;
  nameHe: string;
  stages: number;
  valid: boolean;
  requirement?: ManeuverRequirement;
  reason?: string;
  /**
   * The crossing, broken up, so a reader can see the angle hold or change.
   *
   * This is what separates this engine from a doorway calculator, and it was
   * invisible while the crossing was rendered as one step called "carry it
   * through on its side". A constant-angle maneuver shows the same angle at
   * every station; a threading one does not.
   */
  stations?: CrossingStation[];
  /** True when the item's angle changes while it is inside the opening. */
  turns?: boolean;
  /** The thickest wall the requirement is known to hold for. See `Maneuver.holdsForWallsUpTo`. */
  holdsForWallsUpTo?: number;
}

export interface RemovablePartLine {
  name: string;
  nameHe: string;
  floorWithout: number;
}

export interface ItemReport {
  id: string;
  name: string;
  nameHe: string;
  /** Length, depth and height as the author drew them, in centimetres. */
  dimensions: { length: number; depth: number; height: number };
  /** The wall thickness every figure below was measured against. */
  wallThickness: number;
  /**
   * The assumption, in words, so that a page publishing the figures publishes
   * it with them: which maneuvers hold for any wall, and which only for one no
   * thicker than `wallThickness`.
   */
  wallStatement: string;
  wallStatementHe: string;
  boxCount: number;
  /** The model itself: what the item is made of, part by part. */
  parts: PartLine[];
  removableParts: RemovablePartLine[];
  maneuvers: ManeuverLine[];
  /** The narrowest doorway any validated maneuver clears, if any does. */
  narrowest?: number;
  /** The narrowest doorway any roll schedule could manage, valid or not. */
  floor?: number;
  /** What sets the floor, with every roll allowed. */
  binding?: BindingStation;
  /** What makes the item wide when it is carried in level, which is different. */
  upright?: BindingStation;
}

/**
 * Everything the library knows about one item, in the order a person reads it.
 *
 * Published on a product page, so every number on it comes from the same
 * measurement the maneuvers did. The gap between `narrowest` and `floor` is the
 * one to watch: it says whether the maneuvers in the library reach what the
 * item's geometry allows, or whether there is a maneuver nobody has written yet.
 */
export function reportOn(item: Item, wallThickness = DEFAULT_WALL_THICKNESS): ItemReport {
  const prepared = prepareItem(item);
  const bounds = orientedBounds(prepared, 0, 0, 'y');

  const travelAxis = bestRollSchedule(prepared, wallThickness)?.travelAxis ?? 'x';

  const maneuvers: ManeuverLine[] = [];
  let narrowest: number | undefined;
  for (const template of TEMPLATES) {
    const outcome = buildManeuver(prepared, template, wallThickness);
    if (outcome.ok) {
      const { requirement, stages, path } = outcome.maneuver;
      const stations = crossingStations(prepared, path, wallThickness, travelAxis);
      maneuvers.push({
        templateId: template.id,
        name: template.name,
        nameHe: template.nameHe,
        stages: stages.length,
        valid: true,
        requirement,
        stations,
        turns: turnsInTheOpening(stations),
        holdsForWallsUpTo: template.wallSensitive
          ? wallThickness
          : wallThicknessBound(prepared, template, outcome.maneuver),
      });
      if (narrowest === undefined || requirement.doorWidth < narrowest) {
        narrowest = requirement.doorWidth;
      }
    } else {
      maneuvers.push({
        templateId: template.id,
        name: template.name,
        nameHe: template.nameHe,
        stages: 0,
        valid: false,
        reason: outcome.reason,
      });
    }
  }

  const removableParts: RemovablePartLine[] = [];
  for (const removable of item.removableParts ?? []) {
    const reduced = withoutBoxes(prepared, new Set(removable.boxIndices));
    const floorWithout = reduced === undefined ? undefined : floorOf(reduced, wallThickness);
    if (floorWithout !== undefined) {
      removableParts.push({ name: removable.name, nameHe: removable.nameHe, floorWithout });
    }
  }

  const binding = bindingStation(prepared, wallThickness, 'turned');
  const upright = bindingStation(prepared, wallThickness, 'upright');
  const { wallStatement, wallStatementHe } = wallStatements(maneuvers, wallThickness);

  return {
    id: item.id,
    name: item.name,
    nameHe: item.nameHe,
    dimensions: {
      length: bounds.maxX - bounds.minX,
      depth: bounds.maxY - bounds.minY,
      height: bounds.maxZ - bounds.minZ,
    },
    wallThickness,
    wallStatement,
    wallStatementHe,
    boxCount: item.boxes.length,
    parts: partBreakdown(
      prepared,
      binding?.part !== undefined
        ? { label: binding.part.label, floor: binding.floor, floorWithout: binding.part.floorWithout }
        : undefined,
    ),
    removableParts,
    maneuvers,
    ...(narrowest !== undefined ? { narrowest } : {}),
    ...(binding !== undefined ? { floor: binding.floor, binding } : {}),
    ...(upright !== undefined ? { upright } : {}),
  };
}

/**
 * The wall assumption, said out loud.
 *
 * Which maneuvers need the same doorway behind any wall, and which were
 * measured behind this one and are not known to hold behind a thicker one.
 * A page that publishes the figures should publish this beside them.
 */
function wallStatements(
  maneuvers: readonly ManeuverLine[],
  wallThickness: number,
): { wallStatement: string; wallStatementHe: string } {
  const valid = maneuvers.filter((m) => m.valid);
  const anyWall = valid.filter((m) => (m.holdsForWallsUpTo ?? 0) > wallThickness);
  const thisWall = valid.filter((m) => (m.holdsForWallsUpTo ?? 0) <= wallThickness);
  const bound = anyWall.reduce((least, m) => Math.min(least, m.holdsForWallsUpTo ?? Infinity), Infinity);
  const list = (lines: ManeuverLine[], he: boolean): string =>
    lines.map((m) => `“${he ? m.nameHe : m.name}”`).join(', ');

  let en = `Measured against a wall ${wallThickness} cm thick. `;
  let he = `נמדד מול קיר בעובי ${wallThickness} ס״מ. `;
  if (valid.length === 0) {
    en += 'No maneuver validated.';
    he += 'אף תמרון לא אומת.';
  } else if (thisWall.length === 0) {
    en += `Every maneuver needs the same doorway behind any wall up to ${bound} cm thick.`;
    he += `כל תמרון דורש את אותו פתח מאחורי כל קיר בעובי של עד ${bound} ס״מ.`;
  } else if (anyWall.length === 0) {
    en += `Every figure holds only for a wall no thicker than ${wallThickness} cm; a thicker wall is strictly harder and has not been measured.`;
    he += `כל הנתונים תקפים רק לקיר שעוביו אינו עולה על ${wallThickness} ס״מ; קיר עבה יותר קשה יותר ולא נמדד.`;
  } else {
    en +=
      `${list(anyWall, false)} ${anyWall.length === 1 ? 'needs' : 'need'} the same doorway behind any wall up to ${bound} cm thick; ` +
      `${list(thisWall, false)} ${thisWall.length === 1 ? 'holds' : 'hold'} only for a wall no thicker than ${wallThickness} cm — a thicker wall is strictly harder and has not been measured.`;
    he +=
      `${list(anyWall, true)} — אותו פתח מאחורי כל קיר בעובי של עד ${bound} ס״מ; ` +
      `${list(thisWall, true)} — רק לקיר שעוביו אינו עולה על ${wallThickness} ס״מ; קיר עבה יותר קשה יותר ולא נמדד.`;
  }
  return { wallStatement: en, wallStatementHe: he };
}

export { WORTH_MENTIONING };
