import type { EnvironmentParams, Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { Maneuver, ManeuverRequirement, ManeuverStage, ManeuverTemplate } from './types.ts';
import { buildEnvironment } from '../environment/build.ts';
import { collides, itemWorldBoxes } from '../geometry/collide.ts';
import { contains, unionAabb } from '../geometry/worldBox.ts';
import { createEdgeValidator, interpolate } from '../planner/edge.ts';
import { angleDelta } from '../math/rotation.ts';
import { slabSection } from './footprint.ts';
import { TEMPLATES } from './templates.ts';

/**
 * How far any material point may move between two measurement samples.
 *
 * Finer than anything the edge validator uses — its spacing comes from the
 * thinnest solid in the scene, which for a 15 cm wall is 5 cm — because these
 * samples are not looking for collisions but for the largest footprint the
 * motion ever demands, and a maximum found by sampling is only ever an
 * underestimate. A quarter of a centimetre keeps that error below the precision
 * anyone measures a doorway to.
 */
const MEASURE_STEP = 0.25;

/** Requirements are rounded up to this many centimetres, never down. */
const PRECISION = 0.01;

function ceilTo(value: number): number {
  return Math.ceil(value / PRECISION) * PRECISION;
}

function samplesBetween(item: PreparedItem, from: Placement, to: Placement): number {
  const translation = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const turn = Math.abs(angleDelta(from.yaw, to.yaw)) + Math.abs(to.pitch - from.pitch);
  return Math.max(1, Math.ceil((translation + turn * item.reach) / MEASURE_STEP));
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.yaw === b.yaw &&
    a.pitch === b.pitch &&
    (a.tiltAxis ?? 'y') === (b.tiltAxis ?? 'y')
  );
}

interface Extents {
  /** Section at the wall: signed x range and the height it reaches. */
  minX: number;
  maxX: number;
  maxZ: number;
  /** Whole item: how far back into the hallway and forward into the room. */
  back: number;
  forward: number;
  /**
   * How far the whole item reaches sideways, and how high.
   *
   * Kept as a signed range rather than a distance from the centre, because the
   * path is slid sideways after it is measured and an asymmetric item does not
   * reach the same distance either way. Recording only the larger of the two
   * would size the corridor from where the item used to be.
   */
  wholeMinX: number;
  wholeMaxX: number;
  topZ: number;
}

const EMPTY: Extents = {
  minX: Infinity,
  maxX: -Infinity,
  maxZ: 0,
  back: 0,
  forward: 0,
  wholeMinX: Infinity,
  wholeMaxX: -Infinity,
  topZ: 0,
};

function absorb(item: PreparedItem, placement: Placement, wallThickness: number, into: Extents): void {
  const section = slabSection(item, placement, 0, wallThickness);
  if (section !== undefined) {
    if (section.minX < into.minX) into.minX = section.minX;
    if (section.maxX > into.maxX) into.maxX = section.maxX;
    if (section.maxZ > into.maxZ) into.maxZ = section.maxZ;
  }
  const whole = unionAabb(itemWorldBoxes(item, placement));
  if (-whole.minY > into.back) into.back = -whole.minY;
  if (whole.maxY - wallThickness > into.forward) into.forward = whole.maxY - wallThickness;
  if (whole.minX < into.wholeMinX) into.wholeMinX = whole.minX;
  if (whole.maxX > into.wholeMaxX) into.wholeMaxX = whole.maxX;
  if (whole.maxZ > into.topZ) into.topZ = whole.maxZ;
}

function merge(a: Extents, b: Extents): Extents {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ),
    back: Math.max(a.back, b.back),
    forward: Math.max(a.forward, b.forward),
    wholeMinX: Math.min(a.wholeMinX, b.wholeMinX),
    wholeMaxX: Math.max(a.wholeMaxX, b.wholeMaxX),
    topZ: Math.max(a.topZ, b.topZ),
  };
}

/**
 * What this stretch of the motion demands, given where the path sits in x.
 *
 * The opening is centred on x = 0, so what a section needs is twice its
 * furthest reach from the centre — not its own width, which would understate an
 * off-centre stage.
 */
function requirementOf(extents: Extents, shift: number): ManeuverRequirement {
  const reach =
    extents.minX === Infinity
      ? 0
      : Math.max(Math.abs(extents.minX + shift), Math.abs(extents.maxX + shift));
  return {
    doorWidth: ceilTo(2 * reach),
    doorHeight: ceilTo(extents.maxZ),
    hallwayClearance: ceilTo(Math.max(0, extents.back)),
    roomDepth: ceilTo(Math.max(0, extents.forward)),
  };
}

export type ManeuverOutcome =
  | { ok: true; maneuver: Maneuver }
  | { ok: false; templateId: string; name: string; reason: string };

/**
 * Instantiate one template for one item, then prove it works.
 *
 * The proving is the point, and it is why a library entry is not just a
 * calculation. A template is a shape of motion written for a family of items;
 * whether it survives contact with *this* item — armrests 4 cm taller, a
 * backrest that leans further — is a question about geometry that only the
 * collider can answer. So every waypoint is tested with `collides` and every
 * edge with the same `EdgeValidator` the planner uses, in an environment built
 * to exactly the requirement the motion was measured to need. Nothing is
 * recorded unless it passes.
 *
 * The requirement is **derived from the motion**, not assumed and then checked:
 * sample the path finely, measure the section where it crosses the wall and the
 * item's reach either side, and take the largest. Then build that environment
 * and see whether the motion still runs in it. If the derivation were wrong in
 * the optimistic direction, validation would fail — which is the check that
 * makes the four numbers mean something.
 */
export function buildManeuver(
  item: PreparedItem,
  template: ManeuverTemplate,
  wallThickness: number,
): ManeuverOutcome {
  const fail = (reason: string): ManeuverOutcome => ({
    ok: false,
    templateId: template.id,
    name: template.name,
    reason,
  });

  const drafts = template.build(item, wallThickness);
  if (drafts === undefined || drafts.length === 0) {
    return fail('the template does not apply to this item');
  }

  // --- concatenate, dropping the shared boundary waypoints ------------------
  const path: Placement[] = [];
  const ranges: { startIndex: number; endIndex: number }[] = [];
  for (const draft of drafts) {
    if (draft.waypoints.length < 2) return fail(`stage "${draft.id}" has no motion in it`);
    const startIndex = path.length === 0 ? 0 : path.length - 1;
    for (const waypoint of draft.waypoints) {
      const last = path[path.length - 1];
      if (last !== undefined && samePlacement(last, waypoint)) continue;
      path.push(waypoint);
    }
    ranges.push({ startIndex, endIndex: path.length - 1 });
  }
  if (path.length < 2) return fail('the stages collapsed to a single placement');

  // --- measure, stage by stage --------------------------------------------
  const perStage: Extents[] = ranges.map(() => ({ ...EMPTY }));
  for (let s = 0; s < ranges.length; s++) {
    const { startIndex, endIndex } = ranges[s]!;
    const into = perStage[s]!;
    for (let i = startIndex; i < endIndex; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      const n = samplesBetween(item, from, to);
      for (let k = 0; k <= n; k++) absorb(item, interpolate(from, to, k / n), wallThickness, into);
    }
  }
  const total = perStage.reduce(merge, { ...EMPTY });
  if (total.minX === Infinity) return fail('the motion never reaches the doorway');

  // Slide the whole path sideways so the doorway it needs is centred on the
  // opening, which is what makes the requirement the narrowest one that works.
  const shift = -(total.minX + total.maxX) / 2;
  for (const placement of path) placement.x += shift;

  const requirement = requirementOf(total, shift);
  const stages: ManeuverStage[] = drafts.map((draft, s) => ({
    id: draft.id,
    name: draft.name,
    nameHe: draft.nameHe,
    startIndex: ranges[s]!.startIndex,
    endIndex: ranges[s]!.endIndex,
    requirement: requirementOf(perStage[s]!, shift),
  }));

  // --- validate in exactly that environment --------------------------------
  // The two dimensions the library does not claim — how far the corridor runs
  // along its own length, and how wide the room is — are set generously from
  // the motion, so that the four numbers above are the only things under test.
  // Measured AFTER the shift, or an asymmetric item is given a corridor sized
  // for where it used to be and then reported as colliding with the end of it.
  const reach = Math.max(
    Math.abs(total.wholeMinX + shift),
    Math.abs(total.wholeMaxX + shift),
  );
  const clear = Math.max(60, reach * 2 + 40);
  const params: EnvironmentParams = {
    openingWidth: requirement.doorWidth,
    openingHeight: requirement.doorHeight,
    wallThickness,
    hallwayWidth: Math.max(requirement.hallwayClearance, 1),
    hallwayDepth: clear,
    roomDepth: Math.max(requirement.roomDepth, 1),
    roomWidth: clear,
    ceilingHeight: Math.max(requirement.doorHeight, total.topZ) + 20,
  };

  const environment = buildEnvironment(params);
  const validator = createEdgeValidator(item, environment);

  for (let i = 0; i < path.length; i++) {
    if (collides(item, path[i]!, environment)) {
      return fail(`waypoint ${i} collides in the environment it says it needs`);
    }
  }
  for (let i = 0; i + 1 < path.length; i++) {
    if (!validator.isValid(path[i]!, path[i + 1]!)) {
      return fail(`the motion from waypoint ${i} to ${i + 1} is blocked`);
    }
  }

  const first = unionAabb(itemWorldBoxes(item, path[0]!));
  if (first.maxY > 0) return fail('the motion does not begin wholly in the hallway');
  if (!contains(environment.room, unionAabb(itemWorldBoxes(item, path[path.length - 1]!)))) {
    return fail('the motion does not end wholly inside the room');
  }

  return {
    ok: true,
    maneuver: {
      templateId: template.id,
      name: template.name,
      nameHe: template.nameHe,
      requirement,
      stages,
      path,
    },
  };
}

export interface Library {
  maneuvers: Maneuver[];
  rejected: { templateId: string; name: string; reason: string }[];
}

/** Build every template for one item, keeping only the ones that validate. */
export function buildLibrary(
  item: PreparedItem,
  wallThickness = 15,
  templates: readonly ManeuverTemplate[] = TEMPLATES,
): Library {
  const maneuvers: Maneuver[] = [];
  const rejected: Library['rejected'] = [];
  for (const template of templates) {
    const outcome = buildManeuver(item, template, wallThickness);
    if (outcome.ok) maneuvers.push(outcome.maneuver);
    else rejected.push({ templateId: outcome.templateId, name: outcome.name, reason: outcome.reason });
  }
  return { maneuvers, rejected };
}
