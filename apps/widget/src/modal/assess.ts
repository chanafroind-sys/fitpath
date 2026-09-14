/**
 * What the shopper's numbers establish, and what to ask for next.
 *
 * The engine needs five corridor dimensions and no shopper will measure five
 * numbers to buy a sofa. So the widget asks for one — the doorway width, which
 * on five of six catalogue sofas is the binding number on its own — answers as
 * much as that answers, and asks for the next number only while the answer is
 * still open. This file is that logic, and it is arithmetic: every number it
 * compares was measured from a validated motion at build time, and every
 * comparison it makes is the one `selectManeuver` makes in the engine. Nothing
 * here is geometry.
 *
 * ## The honesty rules, restated where they are enforced
 *
 * - A maneuver is **ruled out** only by a number the shopper actually gave.
 *   A number the shopper has not given yet leaves it **open**, and a shopper
 *   who confirmed "at least 150 cm" has said nothing about a maneuver that
 *   needs 222.
 * - A body **fits** only when some validated maneuver has every one of its
 *   five requirements met by a known number. There is no "probably".
 * - Every maneuver ruled out means the **library** has nothing for these
 *   numbers. It does not mean the sofa will not go through. The only negative
 *   allowed to read as a verdict is the closed-form proof, `provableNoFit`,
 *   and it is asked at every step it can be.
 */
import { provableNoFit, selectManeuver } from '@fitpath/engine';
import type { Maneuver, NoFitProof } from '@fitpath/engine';
import type { Carry, MeasurementKey, WidgetManeuver, WidgetProduct } from '../types.ts';

export type Key = MeasurementKey;

/** The order the questions come in when nothing else separates them. */
export const ASK_ORDER: readonly Key[] = [
  'doorWidth',
  'hallwayClearance',
  'alongWall',
  'roomDepth',
  'doorHeight',
];

/**
 * A number the shopper gave. `exact: false` means "at least this much" — the
 * shopper tapped a threshold rather than measuring — and it can satisfy a
 * requirement but never rule one out.
 */
export interface Known {
  value: number;
  exact: boolean;
}

export interface Have extends Partial<Record<Key, Known>> {
  /**
   * The shopper's wall, in centimetres, when they gave it. Not one of the five
   * requirements: a maneuver is not ruled out by a thick wall, it is simply
   * not known to hold behind one thicker than it was measured for.
   */
  wallThickness?: number;
}

/** Tolerance on a tape measure, and the same one the engine's selector uses. */
const TOLERANCE = 1e-9;

/** A requirement met by less than this is met on paper and worth re-measuring. */
export const MARGINAL_CM = 2;

/**
 * What an ordinary home has, used for ONE thing: deciding which unknown to ask
 * about first. A requirement that is large against these is the one most likely
 * to fail, so it is the one worth asking about — a sofa that needs a 222 cm tall
 * door should be asked about the door, not the room behind it. These values
 * never stand in for a number the shopper did not give.
 */
const ASK_PRIORITY_SCALE: Record<Key, number> = {
  doorWidth: 80,
  doorHeight: 200,
  hallwayClearance: 120,
  alongWall: 250,
  roomDepth: 300,
};

/** A very tall opening, for a proof that is allowed to depend on width alone. */
const NO_LIMIT = 1e6;

export type ManeuverStatus = 'fits' | 'open' | 'ruled-out';

export interface ManeuverAssessment {
  maneuver: WidgetManeuver;
  status: ManeuverStatus;
  /** Requirements a number the shopper gave falls short of. */
  unmet: Key[];
  /** Requirements nothing the shopper gave settles either way. */
  unknown: Key[];
  /** How much to spare on each requirement that is met, in centimetres. */
  margins: Partial<Record<Key, number>>;
  /**
   * True when the shopper's wall is thicker than this maneuver is known to
   * hold for. The maneuver stays open — thicker is harder, but nobody has
   * measured it — and no question can settle it; only a thicker-wall build can.
   */
  wallUnknown: boolean;
}

export type Verdict = 'proven' | 'fits' | 'open' | 'not-in-library';

export interface Question {
  key: Key;
  /** The threshold that would satisfy the maneuver being pursued. */
  needsCm: number;
  maneuver: WidgetManeuver;
  carry: Carry;
  /**
   * Every remaining unknown of the maneuver, when all of them are ordinary —
   * needs an ordinary home clears without measuring — so they can be
   * confirmed together in one card rather than one at a time. Absent when the
   * question is worth asking on its own, because its need is unusual.
   */
  bundle?: { key: Key; needsCm: number }[];
}

export interface CarryAssessment {
  carry: Carry;
  verdict: Verdict;
  /** Present when the verdict is `proven`. The one negative that is a fact. */
  proof?: NoFitProof;
  /** Every maneuver in the library, in library order. */
  maneuvers: ManeuverAssessment[];
  /** Those that fit, least demanding first — the engine's own ordering. */
  fitting: ManeuverAssessment[];
  /** Those still open, in the order they would be chosen if they fit. */
  candidates: ManeuverAssessment[];
  /** The maneuver on offer (fits) or being pursued (open). */
  chosen?: ManeuverAssessment;
  /** Requirements the chosen maneuver meets by less than `MARGINAL_CM`. */
  marginal: Key[];
  next?: Question;
}

/** A set of bodies that ALL have to get through: the modules of one sofa. */
export interface RouteAssessment {
  carries: CarryAssessment[];
  verdict: Verdict;
  next?: Question;
}

export interface Answer {
  product: WidgetProduct;
  have: Have;
  assembled: CarryAssessment;
  /** Present when the product is known to come apart. */
  modules?: RouteAssessment;
  withoutPart: { part: string; partHe: string; carry: CarryAssessment }[];
  /** The single next thing to ask, while anything worth pursuing is open. */
  next?: Question;
}

function satisfies(known: Known | undefined, need: number): 'met' | 'unmet' | 'unknown' {
  if (known === undefined) return 'unknown';
  if (known.value + TOLERANCE >= need) return 'met';
  return known.exact ? 'unmet' : 'unknown';
}

function assessManeuver(maneuver: WidgetManeuver, have: Have): ManeuverAssessment {
  const unmet: Key[] = [];
  const unknown: Key[] = [];
  const margins: Partial<Record<Key, number>> = {};
  for (const key of ASK_ORDER) {
    const need = maneuver.requirement[key];
    const state = satisfies(have[key], need);
    if (state === 'met') margins[key] = have[key]!.value - need;
    else if (state === 'unmet') unmet.push(key);
    else unknown.push(key);
  }
  const wallUnknown =
    have.wallThickness !== undefined && have.wallThickness > maneuver.holdsForWallsUpTo + TOLERANCE;
  const status: ManeuverStatus =
    unmet.length > 0 ? 'ruled-out' : unknown.length > 0 || wallUnknown ? 'open' : 'fits';
  return { maneuver, status, unmet, unknown, margins, wallUnknown };
}

/**
 * The engine's own preference among maneuvers, reused so the widget can never
 * disagree with it: fewest separate motions first, then the least demanding.
 */
function compare(a: WidgetManeuver, b: WidgetManeuver): number {
  if (a.stages.length !== b.stages.length) return a.stages.length - b.stages.length;
  for (const key of ['doorWidth', 'doorHeight', 'hallwayClearance', 'roomDepth', 'alongWall'] as const) {
    if (a.requirement[key] !== b.requirement[key]) return a.requirement[key] - b.requirement[key];
  }
  return a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0;
}

/** A widget maneuver in the shape the engine's selector takes. Paths are not needed to select. */
function asEngineManeuver(m: WidgetManeuver): Maneuver {
  return {
    templateId: m.templateId,
    name: m.name,
    nameHe: m.nameHe,
    requirement: m.requirement,
    stages: m.stages.map((stage, index) => ({
      id: String(index),
      name: stage.name,
      nameHe: stage.nameHe,
      startIndex: 0,
      endIndex: 0,
      requirement: m.requirement,
    })),
    path: [],
    wallThickness: m.wallThickness,
    holdsForWallsUpTo: m.holdsForWallsUpTo,
  };
}

/**
 * Which unknown to ask about first.
 *
 * The doorway width always, when it is not known: it is the one number the
 * form opens with, because on five of six catalogue sofas it decides the answer
 * on its own. After that, the one this maneuver needs most of relative to what
 * homes tend to have. Ties fall back to the fixed order.
 */
function nextUnknown(assessment: ManeuverAssessment): Key | undefined {
  if (assessment.unknown.includes('doorWidth')) return 'doorWidth';
  let best: Key | undefined;
  let bestRatio = -Infinity;
  for (const key of assessment.unknown) {
    const ratio = assessment.maneuver.requirement[key] / ASK_PRIORITY_SCALE[key];
    if (ratio > bestRatio + 1e-9) {
      bestRatio = ratio;
      best = key;
    }
  }
  return best;
}

export function assessCarry(carry: Carry, have: Have): CarryAssessment {
  const maneuvers = carry.maneuvers.map((m) => assessManeuver(m, have));

  // The proof first, because it is the only thing here allowed to say no. It
  // is asked with the numbers the shopper measured; a threshold the shopper
  // merely confirmed ("at least 80") says nothing about a door that is wider,
  // so it is asked with no limit on that side instead.
  const width = have.doorWidth;
  const height = have.doorHeight;
  if (width !== undefined || height !== undefined) {
    const w = width !== undefined && width.exact ? width.value : NO_LIMIT;
    const h = height !== undefined && height.exact ? height.value : NO_LIMIT;
    const proof = provableNoFit(carry.item.boxes, w, h);
    if (proof.proven) {
      return { carry, verdict: 'proven', proof, maneuvers, fitting: [], candidates: [], marginal: [] };
    }
  }

  const fits = maneuvers.filter((m) => m.status === 'fits');
  if (fits.length > 0) {
    // Every requirement of every one of these is met, so the engine's selector
    // keeps them all and puts them in its order. Its ordering is the one the
    // shopper is offered, and it is not reimplemented here.
    const selection = selectManeuver(
      fits.map((m) => asEngineManeuver(m.maneuver)),
      {
        doorWidth: have.doorWidth!.value,
        doorHeight: have.doorHeight!.value,
        hallwayClearance: have.hallwayClearance!.value,
        roomDepth: have.roomDepth!.value,
      },
    );
    const order = selection.found
      ? [selection.maneuver, ...selection.alternatives].map((m) => m.templateId)
      : [];
    const fitting = [...fits].sort(
      (a, b) => order.indexOf(a.maneuver.templateId) - order.indexOf(b.maneuver.templateId),
    );
    const chosen = fitting[0]!;
    return {
      carry,
      verdict: 'fits',
      maneuvers,
      fitting,
      candidates: [],
      chosen,
      marginal: marginalKeys(chosen, have),
    };
  }

  const candidates = maneuvers
    .filter((m) => m.status === 'open')
    .sort((a, b) => compare(a.maneuver, b.maneuver));
  if (candidates.length > 0) {
    // The question goes to the most preferred candidate that a number can
    // still settle. One not measured for the shopper's wall is never asked
    // about: more numbers cannot make it a fit, only a thicker-wall build can.
    // If those are all that is left, the answer stays open with no question.
    const askable = candidates.filter((c) => !c.wallUnknown && nextUnknown(c) !== undefined);
    const chosen = askable[0] ?? candidates[0]!;
    if (askable.length === 0) {
      return { carry, verdict: 'open', maneuvers, fitting: [], candidates, chosen, marginal: marginalKeys(chosen, have) };
    }
    const key = nextUnknown(chosen)!;
    const needsCm = chosen.maneuver.requirement[key];
    // The most demanding unknown is ordinary, so every unknown is: ask for
    // them together. The doorway width is never bundled — it is the number the
    // form opens with, and it is measured, not confirmed.
    const ordinary = key !== 'doorWidth' && needsCm / ASK_PRIORITY_SCALE[key] < 1;
    const bundle = ordinary
      ? ASK_ORDER.filter((k) => chosen.unknown.includes(k)).map((k) => ({ key: k, needsCm: chosen.maneuver.requirement[k] }))
      : undefined;
    return {
      carry,
      verdict: 'open',
      maneuvers,
      fitting: [],
      candidates,
      chosen,
      marginal: marginalKeys(chosen, have),
      next: {
        key,
        needsCm,
        maneuver: chosen.maneuver,
        carry,
        ...(bundle !== undefined && bundle.length > 1 ? { bundle } : {}),
      },
    };
  }

  return { carry, verdict: 'not-in-library', maneuvers, fitting: [], candidates: [], marginal: [] };
}

function marginalKeys(assessment: ManeuverAssessment, have: Have): Key[] {
  const out: Key[] = [];
  for (const key of ASK_ORDER) {
    const margin = assessment.margins[key];
    // A confirmed threshold has no margin to speak of: "at least 150" met 150.
    if (margin !== undefined && have[key]?.exact && margin < MARGINAL_CM) out.push(key);
  }
  return out;
}

/**
 * Several bodies that all have to get through, as one answer.
 *
 * A negative on any one of them is a negative for the route, and the proof
 * outranks a library miss because it is the stronger statement. Among open
 * carries the question asked is the one with the most demanding requirement,
 * since a "yes" to it satisfies the smaller ones for free.
 */
export function assessRoute(carries: Carry[], have: Have): RouteAssessment {
  const assessed = carries.map((carry) => assessCarry(carry, have));
  let verdict: Verdict = 'fits';
  if (assessed.some((c) => c.verdict === 'proven')) verdict = 'proven';
  else if (assessed.some((c) => c.verdict === 'not-in-library')) verdict = 'not-in-library';
  else if (assessed.some((c) => c.verdict === 'open')) verdict = 'open';

  let next: Question | undefined;
  if (verdict === 'open') {
    let bestRatio = -Infinity;
    for (const c of assessed) {
      if (c.next === undefined) continue;
      const ratio = c.next.needsCm / ASK_PRIORITY_SCALE[c.next.key];
      if (ratio > bestRatio + 1e-9) {
        bestRatio = ratio;
        next = c.next;
      }
    }
  }
  return { carries: assessed, verdict, ...(next !== undefined ? { next } : {}) };
}

/**
 * Everything the numbers so far establish about this product, and the one
 * question worth asking next.
 *
 * The assembled body is pursued first. Only once it has been ruled out — by a
 * number, or by the proof — do the questions move to the ways round it: the
 * modules, if the product is known to come apart, and then each removable part.
 */
export function assess(product: WidgetProduct, have: Have): Answer {
  const assembled = assessCarry(product.assembled, have);
  const modules = product.modules !== undefined ? assessRoute(product.modules, have) : undefined;
  const withoutPart = product.withoutPart.map((entry) => ({
    part: entry.part,
    partHe: entry.partHe,
    carry: assessCarry(entry.carry, have),
  }));

  let next: Question | undefined;
  if (assembled.verdict === 'open') next = assembled.next;
  else if (assembled.verdict !== 'fits') {
    if (modules?.verdict === 'open') next = modules.next;
    else {
      const open = withoutPart.find((entry) => entry.carry.verdict === 'open');
      next = open?.carry.next;
    }
  }

  return {
    product,
    have,
    assembled,
    ...(modules !== undefined ? { modules } : {}),
    withoutPart,
    ...(next !== undefined ? { next } : {}),
  };
}

/** The narrowest doorway any route in the answer is known to clear. */
export function narrowestKnown(answer: Answer): number | undefined {
  // Modules only count together, so the module figure is the widest of them.
  const moduleWorst =
    answer.product.modules !== undefined &&
    answer.product.modules.every((m) => m.narrowestCm !== undefined)
      ? Math.max(...answer.product.modules.map((m) => m.narrowestCm!))
      : undefined;
  const candidates = [
    answer.product.assembled.narrowestCm,
    moduleWorst,
    ...answer.product.withoutPart.map((entry) => entry.carry.narrowestCm),
  ].filter((v): v is number => v !== undefined);
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}
