import type { Environment, Item, Placement, Suggestion } from '../types.ts';
import type { LatticeRequest } from '../planner/lattice.ts';
import { prepareItem } from '../geometry/collide.ts';
import { provableNoFit } from '../geometry/crossSection.ts';
import { withParams } from '../environment/build.ts';
import { pathExists } from '../planner/search.ts';

/** How far the opening is allowed to be widened while looking for a number to report. */
export const MAX_EXTRA_OPENING = 20;
/** How far the hallway is allowed to be widened. Corridors vary far more than doors do. */
export const MAX_EXTRA_HALLWAY = 200;

export interface DiagnoseContext {
  item: Item;
  environment: Environment;
  /** Lattice levels, coarsest first, exactly as the main plan used them. */
  levels: readonly LatticeRequest[];
  maxNodes: number;
  start?: Placement;
  /** Run the literal linear scan at full resolution instead of bracketing. */
  exhaustive: boolean;
}

/**
 * Smallest value in [lo, hi] satisfying a monotone predicate, or undefined.
 *
 * Monotonicity is not an assumption here, it is a fact about the problem:
 * widening the opening, widening the hallway and removing a part all *delete*
 * obstacle volume or shrink the item, so the free configuration space only
 * grows. Any path valid at value v is still valid at v+1, because nothing was
 * added that could block it. That makes a binary search exact rather than
 * approximate.
 */
function smallestSatisfying(
  lo: number,
  hi: number,
  predicate: (value: number) => boolean,
): number | undefined {
  if (lo > hi) return undefined;
  if (!predicate(hi)) return undefined;
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (predicate(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Bracket with the coarse lattice, then settle the answer at full resolution.
 *
 * The coarse lattice is the only approximation in the engine and it is
 * one-sided: it can miss a path, never invent one. So a coarse success is a
 * real success and needs no confirmation, while a coarse failure has to be
 * re-asked at full resolution before it can be believed.
 *
 * That asymmetry is what makes this cheap. The coarse binary search finds a
 * value that certainly works; the only open question is whether something
 * smaller works too, so full resolution is asked exactly that — does the value
 * one centimetre below also work? — and usually stops there. Twenty
 * full-resolution runs become two.
 */
function smallestWorkingValue(
  lo: number,
  hi: number,
  coarsePredicate: (value: number) => boolean,
  finePredicate: (value: number) => boolean,
  exhaustive: boolean,
): number | undefined {
  if (lo > hi) return undefined;

  if (exhaustive) {
    for (let value = lo; value <= hi; value++) {
      if (finePredicate(value)) return value;
    }
    return undefined;
  }

  const bracket = smallestSatisfying(lo, hi, coarsePredicate);
  if (bracket === undefined) {
    // Coarse failure proves nothing, so the top of the range still has to be
    // asked at full resolution before "nothing helps" can be said.
    if (!finePredicate(hi)) return undefined;
    return smallestSatisfying(lo, hi, finePredicate);
  }
  if (bracket === lo) return bracket;
  if (!finePredicate(bracket - 1)) return bracket;
  return smallestSatisfying(lo, bracket - 1, finePredicate);
}

/**
 * Work out what would actually make this fit, by re-planning counterfactuals
 * rather than by inspecting the geometry and guessing.
 *
 * Every number reported here was produced by a search that succeeded.
 */
export function diagnose(context: DiagnoseContext): Suggestion[] {
  const { item, environment, maxNodes, start } = context;
  const baseOpening = environment.params.openingWidth;
  const baseHallway = environment.params.hallwayWidth;

  const attempt = (
    env: Environment,
    excludeBoxIndices: readonly number[] | undefined,
    depth: 'sketch' | 'full',
  ): boolean => {
    const prepared = prepareItem(item, excludeBoxIndices);
    // The closed-form proof settles this counterfactual for free when it fires.
    // Without it, asking "would a wider hallway help?" about an item that
    // cannot fit the opening at all means exhausting an enormous corridor to
    // rediscover something a single rectangle comparison already knows.
    if (provableNoFit(prepared.boxes, env.params.openingWidth, env.params.openingHeight).proven) {
      return false;
    }
    return pathExists(prepared, env, {
      levels: context.levels,
      ...(depth === 'sketch' ? { sketchOnly: true } : {}),
      maxNodes,
      ...(start !== undefined ? { start } : {}),
    });
  };

  const suggestions: Suggestion[] = [];

  // --- Would a wider opening help? ----------------------------------------
  // Widths at which the closed-form proof still fires cannot possibly work, so
  // they are skipped without a search. This is exact, not a heuristic.
  let lowestPlausibleExtra = 1;
  while (
    lowestPlausibleExtra <= MAX_EXTRA_OPENING &&
    provableNoFit(item.boxes, baseOpening + lowestPlausibleExtra, environment.params.openingHeight)
      .proven
  ) {
    lowestPlausibleExtra++;
  }

  const openingExtra = smallestWorkingValue(
    lowestPlausibleExtra,
    MAX_EXTRA_OPENING,
    (extra) => attempt(withParams(environment, { openingWidth: baseOpening + extra }), undefined, 'sketch'),
    (extra) => attempt(withParams(environment, { openingWidth: baseOpening + extra }), undefined, 'full'),
    context.exhaustive,
  );

  if (openingExtra !== undefined) {
    suggestions.push({
      kind: 'widen-opening',
      helps: true,
      openingWidth: baseOpening + openingExtra,
      extraOpeningWidth: openingExtra,
      en: `Widening the opening by ${openingExtra} cm, to ${baseOpening + openingExtra} cm, is enough: a path was found at that width and not at ${baseOpening + openingExtra - 1} cm.`,
      he: `הרחבת הפתח ב-${openingExtra} ס״מ, ל-${baseOpening + openingExtra} ס״מ, מספיקה: נמצא מסלול ברוחב הזה ולא ברוחב ${baseOpening + openingExtra - 1} ס״מ.`,
    });
  } else {
    suggestions.push({
      kind: 'widen-opening',
      helps: false,
      en: `Widening the opening does not help: no path was found at any width up to ${baseOpening + MAX_EXTRA_OPENING} cm (${MAX_EXTRA_OPENING} cm wider).`,
      he: `הרחבת הפתח אינה עוזרת: לא נמצא מסלול באף רוחב עד ${baseOpening + MAX_EXTRA_OPENING} ס״מ (${MAX_EXTRA_OPENING} ס״מ יותר).`,
    });
  }

  // --- Would taking something off help? -----------------------------------
  for (const part of item.removableParts ?? []) {
    const helps = attempt(environment, part.boxIndices, 'full');
    suggestions.push({
      kind: 'remove-part',
      helps,
      part: part.name,
      partHe: part.nameHe,
      en: helps
        ? `Removing the ${part.name} is enough on its own: a path was found with them off.`
        : `Removing the ${part.name} does not help: no path was found with them off either.`,
      he: helps
        ? `הסרת ${part.nameHe} מספיקה כשלעצמה: נמצא מסלול בלעדיהן.`
        : `הסרת ${part.nameHe} אינה עוזרת: גם בלעדיהן לא נמצא מסלול.`,
    });
  }

  // --- Is the corridor the real problem? ----------------------------------
  const hallwayExtra = smallestWorkingValue(
    1,
    MAX_EXTRA_HALLWAY,
    (extra) => attempt(withParams(environment, { hallwayWidth: baseHallway + extra }), undefined, 'sketch'),
    (extra) => attempt(withParams(environment, { hallwayWidth: baseHallway + extra }), undefined, 'full'),
    context.exhaustive,
  );

  const openingHelps = suggestions.some((s) => s.kind === 'widen-opening' && s.helps);
  if (hallwayExtra !== undefined) {
    const binding = !openingHelps;
    suggestions.push({
      kind: 'widen-hallway',
      helps: true,
      hallwayWidth: baseHallway + hallwayExtra,
      extraHallwayWidth: hallwayExtra,
      en: binding
        ? `The hallway is the binding constraint, not the opening. It needs ${hallwayExtra} cm more clearance in front of the door — ${baseHallway + hallwayExtra} cm instead of ${baseHallway} cm — and then a path exists. The item passes through the opening itself; it simply cannot be turned to face it in a corridor this narrow.`
        : `Widening the hallway also works: ${hallwayExtra} cm more clearance in front of the door, ${baseHallway + hallwayExtra} cm instead of ${baseHallway} cm.`,
      he: binding
        ? `המסדרון הוא האילוץ הכובל, לא הפתח. דרושים עוד ${hallwayExtra} ס״מ מרווח מול הדלת — ${baseHallway + hallwayExtra} ס״מ במקום ${baseHallway} ס״מ — ואז קיים מסלול. הרהיט עצמו עובר בפתח; פשוט אי אפשר לסובב אותו אל מול הפתח במסדרון צר כל כך.`
        : `גם הרחבת המסדרון עוזרת: עוד ${hallwayExtra} ס״מ מרווח מול הדלת, ${baseHallway + hallwayExtra} ס״מ במקום ${baseHallway} ס״מ.`,
    });
  } else {
    suggestions.push({
      kind: 'widen-hallway',
      helps: false,
      en: `Widening the hallway does not help: no path was found with up to ${MAX_EXTRA_HALLWAY} cm of extra clearance in front of the door.`,
      he: `הרחבת המסדרון אינה עוזרת: לא נמצא מסלול גם עם עוד ${MAX_EXTRA_HALLWAY} ס״מ מרווח מול הדלת.`,
    });
  }

  return suggestions;
}
