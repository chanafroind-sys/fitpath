/**
 * What the shopper's numbers establish. Logic only; not one word of copy.
 *
 * Every number compared here was measured from a validated motion at build
 * time, and every comparison is arithmetic. The rules, in the order they are
 * applied:
 *
 * - The opening — doorway width and height — is asked for. Nothing else is:
 *   the other four numbers a maneuver needs are reported as requirements, and
 *   a shopper who enters one turns a requirement into a verdict.
 * - Every maneuver of every body that could go in is evaluated against
 *   whatever was given. A maneuver is **ruled out** only by a number the
 *   shopper actually gave; one the shopper has not given leaves it **open**.
 * - The way in presented is the one that best fits what was given: among
 *   those whose every requirement is met, the engine's own choice; among the
 *   rest, the one whose open requirements an ordinary home is most likely to
 *   meet. When an entered number rules the first one out, the next is
 *   presented instead. Nothing here locks onto one maneuver.
 * - Every maneuver ruled out means the **library** has nothing for these
 *   numbers. The only negative that is a verdict is the closed-form proof,
 *   and it is asked of every body.
 * - A body with a part taken off is a way in only when the part is known to
 *   come off, or the shopper has said so, and only where taking it off
 *   changes the verdict. The wall is mentioned only where a wall a home can
 *   have would change the answer.
 */
import { provableNoFit, selectManeuver } from '@fitpath/engine';
import type { Maneuver } from '@fitpath/engine';
import { KEYS, OPTIONAL_KEYS } from '../types.ts';
import type { Carry, Key, Need, Removable, WallVariant, WidgetManeuver, WidgetProduct } from '../types.ts';

export interface Have {
  doorWidth?: number;
  doorHeight?: number;
  hallwayClearance?: number;
  alongWall?: number;
  roomDepth?: number;
  ceilingHeight?: number;
  /** The shopper's wall, in centimetres, when they gave it. */
  wallThickness?: number;
  /** Parts the shopper has said come off, by name. */
  partsOff?: string[];
  /** Parts the shopper has said do not come off, by name: the question is not asked again. */
  partsOn?: string[];
}

/** Tolerance on a tape measure, and the one the engine's selector uses. */
const TOLERANCE = 1e-9;

/** A requirement met by less than this is met on paper and worth measuring again. */
export const CLOSE_CM = 2;

/** Two needs within this of each other are the same need, for the trade-off line. */
const SAME_CM = 1;

/**
 * What an ordinary home has, used for ONE thing: ranking the open candidates,
 * so the way in presented first is the one whose unmeasured requirements a
 * home is most likely to meet. A maneuver that wants 222 cm of clear floor in
 * front of the door is a worse bet than one that wants a 233 cm ceiling. These
 * values never stand in for a number the shopper did not give, and never
 * decide a verdict.
 */
export const ORDINARY_CM: Need = {
  doorWidth: 80,
  doorHeight: 200,
  hallwayClearance: 120,
  alongWall: 250,
  roomDepth: 300,
  ceilingHeight: 245,
};

/**
 * How a given number stands against a need.
 *
 * `implied` is a need settled by a number the shopper gave for something
 * else: a ceiling is at least as high as the doorway in the wall under it,
 * and a corridor runs along the wall at least as far as the doorway in it is
 * wide. Those are facts about buildings, not assumptions about this one.
 */
export type Fact = 'met' | 'implied' | 'unmet' | 'unknown';

export type Status = 'fits' | 'open' | 'ruled-out' | 'unmeasured';

export interface Evaluation {
  maneuver: WidgetManeuver;
  /** The numbers that hold for the wall in hand; absent when none are measured for it. */
  variant?: WallVariant;
  facts: Record<Key, Fact>;
  /** How much to spare on each requirement a given number meets. */
  margins: Partial<Record<Key, number>>;
  status: Status;
  /** Keys the shopper's numbers fall short of. */
  unmet: Key[];
  /** Keys nothing given settles. */
  unknown: Key[];
}

export type RouteKind = 'proven' | 'no-way' | 'open' | 'fits';

export interface CarryVerdict {
  carry: Carry;
  kind: RouteKind;
  evaluations: Evaluation[];
  /** The way in for this body, when it has one. */
  presented?: Evaluation;
  proof?: Proof;
}

export interface Proof {
  carry: Carry;
  boxLabel?: string;
  crossSection: [number, number];
  opening: [number, number];
}

/**
 * Bodies that all have to get through: the item as one piece, its modules,
 * or the item with a part taken off.
 */
export interface Route {
  id: string;
  carries: CarryVerdict[];
  kind: RouteKind;
  /** The part taken off, for a route that depends on it. */
  partOff?: string;
  /** For a route whose bodies all have a way in: what the route needs, worst body per key. */
  need?: Need;
}

export interface Condition {
  key: Key;
  need: number;
  /**
   * The most this requirement grows to behind a thicker wall a home can
   * have, while the answer otherwise stays the same — a lean that needs a
   * 215 cm ceiling behind a 12 cm wall needs 244 behind 30. Present only
   * when it grows by more than a centimetre.
   */
  behindThicker?: { need: number; wall: number };
}

export interface Tradeoff {
  maneuver: WidgetManeuver;
  /**
   * Requirements of the presented way in that this one relaxes: what it
   * needs instead, what the presented one needed, and whether the need is
   * gone altogether (settled by the doorway the shopper gave).
   */
  less: { key: Key; need: number; was: number; dropped: boolean }[];
  /** What it asks more of. */
  more: Condition[];
}

/** The closest the library came, when nothing in it fits. */
export interface Nearest {
  route: Route;
  maneuver: WidgetManeuver;
  short: { key: Key; need: number; have: number }[];
}

export type Kind = 'needs-opening' | 'fits' | 'conditions' | 'no-way' | 'proven';

/** A part that changes the verdict, and what the shopper has to say about it. */
export interface PartAdvice {
  part: string;
  /** Stated by the listing, or confirmed by the shopper, or still a question. */
  established: boolean;
  /** What the body needs at the door without the part. */
  doorNeed: number;
  /** The narrowest door any way in needs with the part on, behind this wall; absent when none is measured for it. */
  withOnNeed?: number;
  /** The verdict the route without the part reaches. */
  kind: Kind;
}

export interface WallNote {
  /** The answer holds for any wall up to this thick. */
  holdsUpTo: number;
  /**
   * Behind a thicker wall, the answer becomes this one. Absent when the
   * answer holds behind every wall a home can have and only a condition
   * grows — see `Condition.behindThicker`.
   */
  then?: Verdict;
}

export interface Verdict {
  kind: Kind;
  have: Have;
  /** The wall this answer is for. */
  wall: number;
  wallGiven: boolean;
  /** The way in, for `fits` and `conditions`. */
  route?: Route;
  /** The requirements left to check, for `conditions`; empty for `fits`. */
  conditions: Condition[];
  /** Requirements met by less than `CLOSE_CM`, on the presented way in. */
  close: { key: Key; margin: number }[];
  tradeoff?: Tradeoff;
  /** The closest miss, for `no-way`. */
  nearest?: Nearest;
  proof?: Proof;
  part?: PartAdvice;
  wallNote?: WallNote;
  /**
   * Maneuvers not measured for the wall given, that hold for a thinner one —
   * narrowest first, and saying whether the opening given would have passed
   * behind the thickest wall they are measured for.
   */
  unmeasured: { maneuver: WidgetManeuver; holdsUpTo: number; openingPasses: boolean }[];
  /** Every route evaluated, for the disclosure. */
  routes: Route[];
}

/* ------------------------------------------------------------------------ */

/** The numbers that hold for a wall: the thinnest variant known to cover it. */
export function variantFor(maneuver: WidgetManeuver, wall: number): WallVariant | undefined {
  for (const variant of maneuver.variants) {
    if (wall <= variant.holdsForWallsUpTo + TOLERANCE) return variant;
  }
  return undefined;
}

function implied(key: Key, need: number, have: Have): boolean {
  if (key === 'ceilingHeight' && have.doorHeight !== undefined) return need <= have.doorHeight + TOLERANCE;
  if (key === 'alongWall' && have.doorWidth !== undefined) return need <= have.doorWidth + TOLERANCE;
  return false;
}

export function evaluate(maneuver: WidgetManeuver, have: Have, wall: number): Evaluation {
  const variant = variantFor(maneuver, wall);
  const facts = {} as Record<Key, Fact>;
  const margins: Partial<Record<Key, number>> = {};
  const unmet: Key[] = [];
  const unknown: Key[] = [];
  if (variant === undefined) {
    for (const key of KEYS) facts[key] = 'unknown';
    return { maneuver, facts, margins, status: 'unmeasured', unmet, unknown: [...KEYS] };
  }
  for (const key of KEYS) {
    const need = variant.need[key];
    const given = have[key];
    if (given !== undefined) {
      if (given + TOLERANCE >= need) {
        facts[key] = 'met';
        margins[key] = given - need;
      } else {
        facts[key] = 'unmet';
        unmet.push(key);
      }
    } else if (implied(key, need, have)) {
      facts[key] = 'implied';
    } else {
      facts[key] = 'unknown';
      unknown.push(key);
    }
  }
  const status: Status = unmet.length > 0 ? 'ruled-out' : unknown.length > 0 ? 'open' : 'fits';
  return { maneuver, variant, facts, margins, status, unmet, unknown };
}

/** How demanding a maneuver's open requirements are, against an ordinary home. Lower is a better bet. */
function demand(evaluation: Evaluation): number {
  let worst = 0;
  for (const key of evaluation.unknown) {
    const ratio = evaluation.variant!.need[key] / ORDINARY_CM[key];
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/** Among open candidates: the best bet first, then the engine's own order. */
function compareOpen(a: Evaluation, b: Evaluation): number {
  const da = demand(a);
  const db = demand(b);
  if (Math.abs(da - db) > 1e-9) return da - db;
  return compareSimplicity(a, b);
}

/** The engine's preference, restated for a variant: fewest motions, then least demanding. */
function compareSimplicity(a: Evaluation, b: Evaluation): number {
  if (a.maneuver.stages.length !== b.maneuver.stages.length) return a.maneuver.stages.length - b.maneuver.stages.length;
  for (const key of KEYS) {
    const d = a.variant!.need[key] - b.variant!.need[key];
    if (Math.abs(d) > 1e-9) return d;
  }
  return a.maneuver.templateId < b.maneuver.templateId ? -1 : a.maneuver.templateId > b.maneuver.templateId ? 1 : 0;
}

/** A widget maneuver in the shape the engine's selector takes. Paths are not needed to select. */
function asEngineManeuver(evaluation: Evaluation): Maneuver {
  const m = evaluation.maneuver;
  const v = evaluation.variant!;
  return {
    templateId: m.templateId,
    name: m.name,
    nameHe: m.nameHe,
    requirement: v.need,
    stages: m.stages.map((stage, index) => ({
      id: String(index),
      name: stage.name,
      nameHe: stage.nameHe,
      startIndex: 0,
      endIndex: 0,
      requirement: v.need,
    })),
    path: [],
    wallThickness: v.wallCm,
    holdsForWallsUpTo: v.holdsForWallsUpTo,
  };
}

export function assessCarry(carry: Carry, have: Have, wall: number): CarryVerdict {
  const evaluations = carry.maneuvers.map((m) => evaluate(m, have, wall));

  // The proof first, because it is the only thing here allowed to say no.
  const proof = provableNoFit(carry.item.boxes, have.doorWidth!, have.doorHeight!);
  if (proof.proven) {
    const box = proof.boxIndex === undefined ? undefined : carry.item.boxes[proof.boxIndex];
    return {
      carry,
      kind: 'proven',
      evaluations,
      proof: {
        carry,
        ...(box?.label !== undefined ? { boxLabel: box.label } : {}),
        crossSection: proof.crossSection!,
        opening: [have.doorWidth!, have.doorHeight!],
      },
    };
  }

  const fits = evaluations.filter((e) => e.status === 'fits');
  if (fits.length > 0) {
    // Every requirement of every one of these is met, so the engine's own
    // selector orders them; the widget does not reimplement its preference.
    const selection = selectManeuver(fits.map(asEngineManeuver), {
      doorWidth: have.doorWidth!,
      doorHeight: have.doorHeight!,
      hallwayClearance: have.hallwayClearance ?? Infinity,
      roomDepth: have.roomDepth ?? Infinity,
    });
    const first = selection.found ? selection.maneuver.templateId : fits[0]!.maneuver.templateId;
    return { carry, kind: 'fits', evaluations, presented: fits.find((e) => e.maneuver.templateId === first)! };
  }

  const open = evaluations.filter((e) => e.status === 'open').sort(compareOpen);
  if (open.length > 0) return { carry, kind: 'open', evaluations, presented: open[0]! };

  return { carry, kind: 'no-way', evaluations };
}

const RANK: Record<RouteKind, number> = { proven: 0, 'no-way': 1, open: 2, fits: 3 };

function assessRoute(id: string, carries: Carry[], have: Have, wall: number, partOff?: string): Route {
  const assessed = carries.map((carry) => assessCarry(carry, have, wall));
  let kind: RouteKind = 'fits';
  for (const c of assessed) if (RANK[c.kind] < RANK[kind]) kind = c.kind;
  let need: Need | undefined;
  if (kind === 'fits' || kind === 'open') {
    need = { ...assessed[0]!.presented!.variant!.need };
    for (const c of assessed.slice(1)) {
      for (const key of KEYS) need[key] = Math.max(need[key], c.presented!.variant!.need[key]);
    }
  }
  return {
    id,
    carries: assessed,
    kind,
    ...(partOff !== undefined ? { partOff } : {}),
    ...(need !== undefined ? { need } : {}),
  };
}

/** Among routes of the same kind: the better bet on what is still open, then the unmodified one. */
function compareRoutes(a: Route, b: Route): number {
  if (RANK[a.kind] !== RANK[b.kind]) return RANK[b.kind] - RANK[a.kind];
  const worst = (route: Route): number =>
    Math.max(...route.carries.map((c) => (c.presented === undefined ? Infinity : demand(c.presented))));
  const da = worst(a);
  const db = worst(b);
  if (Math.abs(da - db) > 1e-9) return da - db;
  return (a.partOff === undefined ? 0 : 1) - (b.partOff === undefined ? 0 : 1);
}

function conditionsOf(route: Route): Condition[] {
  const out: Condition[] = [];
  for (const key of OPTIONAL_KEYS) {
    let need: number | undefined;
    for (const c of route.carries) {
      const e = c.presented!;
      if (e.facts[key] !== 'unknown') continue;
      const n = e.variant!.need[key];
      if (need === undefined || n > need) need = n;
    }
    if (need !== undefined) out.push({ key, need });
  }
  return out;
}

function closeOf(route: Route): { key: Key; margin: number }[] {
  const out: { key: Key; margin: number }[] = [];
  for (const key of KEYS) {
    let margin: number | undefined;
    for (const c of route.carries) {
      const m = c.presented!.margins[key];
      if (m !== undefined && (margin === undefined || m < margin)) margin = m;
    }
    if (margin !== undefined && margin < CLOSE_CM) out.push({ key, margin });
  }
  return out;
}

/**
 * Another way in that asks for something different: less of one thing the
 * presented way needs, more of another. Said in one line so the shopper knows
 * there is a choice. A way in that asks for less and nothing more would have
 * been presented instead; one that asks for more and nothing less is only
 * an alternative, and stays in the list.
 */
function tradeoffOf(route: Route): Tradeoff | undefined {
  if (route.carries.length !== 1) return undefined;
  const carry = route.carries[0]!;
  const a = carry.presented!;
  const others = carry.evaluations
    .filter((e) => e !== a && (e.status === 'open' || e.status === 'fits'))
    .sort(compareOpen);
  for (const b of others) {
    const less: Tradeoff['less'] = [];
    const more: Condition[] = [];
    for (const key of a.unknown) {
      const need = b.variant!.need[key];
      const was = a.variant!.need[key];
      if (need < was - SAME_CM) less.push({ key, need, was, dropped: b.facts[key] !== 'unknown' });
    }
    for (const key of b.unknown) {
      if (b.variant!.need[key] > a.variant!.need[key] + SAME_CM) more.push({ key, need: b.variant!.need[key] });
    }
    if (less.length > 0 && more.length > 0) return { maneuver: b.maneuver, less, more };
  }
  return undefined;
}

/** The closest miss across routes: fewest numbers short, then the least short. */
function nearestOf(routes: Route[], have: Have): Nearest | undefined {
  let best: Nearest | undefined;
  let bestCount = Infinity;
  let bestTotal = Infinity;
  for (const route of routes) {
    for (const c of route.carries) {
      for (const e of c.evaluations) {
        if (e.status !== 'ruled-out') continue;
        const short = e.unmet.map((key) => ({ key, need: e.variant!.need[key], have: have[key]! }));
        const total = short.reduce((sum, s) => sum + (s.need - s.have), 0);
        if (short.length < bestCount || (short.length === bestCount && total < bestTotal - 1e-9)) {
          best = { route, maneuver: e.maneuver, short };
          bestCount = short.length;
          bestTotal = total;
        }
      }
    }
  }
  return best;
}

function unmeasuredOf(routes: Route[], have: Have): Verdict['unmeasured'] {
  const out: Verdict['unmeasured'] = [];
  for (const route of routes) {
    for (const c of route.carries) {
      for (const e of c.evaluations) {
        if (e.status !== 'unmeasured') continue;
        const last = e.maneuver.variants[e.maneuver.variants.length - 1];
        if (last === undefined) continue;
        const openingPasses =
          have.doorWidth! + TOLERANCE >= last.need.doorWidth && have.doorHeight! + TOLERANCE >= last.need.doorHeight;
        out.push({ maneuver: e.maneuver, holdsUpTo: last.holdsForWallsUpTo, openingPasses });
      }
    }
  }
  return out.sort((a, b) => {
    const wa = a.maneuver.variants[a.maneuver.variants.length - 1]!.need.doorWidth;
    const wb = b.maneuver.variants[b.maneuver.variants.length - 1]!.need.doorWidth;
    return wa - wb;
  });
}

function toKind(kind: RouteKind): Kind {
  return kind === 'fits' ? 'fits' : kind === 'open' ? 'conditions' : kind === 'proven' ? 'proven' : 'no-way';
}

/**
 * The answer for one wall. Everything except the wall note, which compares
 * answers for different walls and so is layered on top.
 */
function decideAt(product: WidgetProduct, have: Have, wall: number, wallGiven: boolean): Verdict {
  const base: Verdict = { kind: 'needs-opening', have, wall, wallGiven, conditions: [], close: [], unmeasured: [], routes: [] };
  if (have.doorWidth === undefined || have.doorHeight === undefined) return base;

  // The bodies that go in as sold: the whole, or its modules if it comes apart.
  const primary: Route[] = [assessRoute('assembled', [product.assembled], have, wall)];
  if (product.separates === true && product.modules !== undefined && product.modules.length > 0) {
    primary.push(assessRoute('modules', product.modules, have, wall));
  }
  primary.sort(compareRoutes);
  const routes = [...primary];

  // A part taken off is a way in only where the body as sold has none, and
  // only when the part is known to come off or the shopper has said so.
  let part: PartAdvice | undefined;
  const best = primary[0]!;
  if (best.kind === 'no-way' || best.kind === 'proven') {
    for (const removable of product.removable) {
      if (removable.detachable !== true && (have.partsOn ?? []).includes(removable.part)) continue;
      const route = assessRoute(`without-${removable.part}`, [removable.carry], have, wall, removable.part);
      routes.push(route);
      if (route.kind !== 'open' && route.kind !== 'fits') continue;
      const established = removable.detachable === true || (have.partsOff ?? []).includes(removable.part);
      const measured = best.carries
        .flatMap((c) => c.evaluations)
        .filter((e) => e.variant !== undefined)
        .map((e) => e.variant!.need.doorWidth);
      part = {
        part: removable.part,
        established,
        doorNeed: route.need!.doorWidth,
        ...(measured.length > 0 ? { withOnNeed: Math.min(...measured) } : {}),
        kind: toKind(route.kind),
      };
      break;
    }
  }

  const available = routes.filter((r) => r.partOff === undefined || (part?.established === true && r.partOff === part.part));
  const presented = [...available].sort(compareRoutes)[0]!;
  const kind = toKind(presented.kind);
  const verdict: Verdict = { ...base, kind, routes, unmeasured: unmeasuredOf(available, have), ...(part !== undefined ? { part } : {}) };

  if (kind === 'fits' || kind === 'conditions') {
    verdict.route = presented;
    verdict.conditions = kind === 'conditions' ? conditionsOf(presented) : [];
    verdict.close = closeOf(presented);
    const tradeoff = tradeoffOf(presented);
    if (tradeoff !== undefined) verdict.tradeoff = tradeoff;
  } else if (kind === 'proven') {
    verdict.proof = presented.carries.find((c) => c.proof !== undefined)!.proof!;
  } else {
    const nearest = nearestOf(available, have);
    if (nearest !== undefined) verdict.nearest = nearest;
  }
  return verdict;
}

/**
 * What the answer says, in the fewest terms that could differ, for the wall
 * scan: the verdict, the way in, and the threshold a miss is measured
 * against. A requirement that merely grows behind a thicker wall is not a
 * different answer; it is the same answer with a larger number, and it is
 * carried on the condition itself.
 */
function signature(v: Verdict): string {
  const tenth = (n: number): number => Math.round(n * 10) / 10;
  return JSON.stringify([
    v.kind,
    v.route?.id,
    v.route?.carries.map((c) => c.presented?.maneuver.templateId),
    v.nearest?.short.map((s) => [s.key, tenth(s.need)]),
    v.part?.doorNeed === undefined ? undefined : tenth(v.part.doorNeed),
  ]);
}

/** A condition grows by more than this behind a thicker wall before it is worth saying. */
const GROWS_CM = 1;

/**
 * The answer, for the wall the shopper gave or the ordinary one if not — and
 * in the latter case, whether any wall a home can have would change it.
 */
export function decide(product: WidgetProduct, have: Have): Verdict {
  const wallGiven = have.wallThickness !== undefined;
  const wall = have.wallThickness ?? product.wallCm;
  const verdict = decideAt(product, have, wall, wallGiven);
  if (wallGiven || verdict.kind === 'needs-opening') return verdict;

  const own = signature(verdict);
  let holdsUpTo = wall;
  let then: Verdict | undefined;
  for (const thicker of product.wallsCm.filter((t) => t > wall).sort((a, b) => a - b)) {
    const other = decideAt(product, have, thicker, false);
    if (signature(other) !== own) {
      then = other;
      break;
    }
    // The same answer behind a thicker wall: a requirement may still have grown.
    for (const condition of verdict.conditions) {
      const grown = other.conditions.find((c) => c.key === condition.key);
      if (grown === undefined) continue;
      const known = condition.behindThicker?.need ?? condition.need;
      if (grown.need > known + GROWS_CM) condition.behindThicker = { need: grown.need, wall: thicker };
    }
    holdsUpTo = thicker;
  }
  if (then !== undefined) verdict.wallNote = { holdsUpTo, then };
  else if (verdict.conditions.some((c) => c.behindThicker !== undefined)) verdict.wallNote = { holdsUpTo };
  return verdict;
}

/** The narrowest doorway any route of the product is known to clear behind the default wall. */
export function narrowestKnown(product: WidgetProduct): number | undefined {
  const moduleWorst =
    product.modules !== undefined && product.modules.every((m) => m.narrowestCm !== undefined)
      ? Math.max(...product.modules.map((m) => m.narrowestCm!))
      : undefined;
  const candidates = [
    product.assembled.narrowestCm,
    moduleWorst,
    ...product.removable.filter((r) => r.detachable === true).map((r) => r.carry.narrowestCm),
  ].filter((v): v is number => v !== undefined);
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

export type { Removable };
