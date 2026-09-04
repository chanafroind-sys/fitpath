import type { Environment, Item, Placement, Suggestion, SuggestionKind } from '../types.ts';
import type { LatticeRequest } from '../planner/lattice.ts';
import { prepareItem } from '../geometry/collide.ts';
import { provableNoFit } from '../geometry/crossSection.ts';
import { withParams } from '../environment/build.ts';
import { findPath } from '../planner/search.ts';

/** How far the opening is allowed to be widened while looking for a number to report. */
export const MAX_EXTRA_OPENING = 20;
/** How far the hallway is allowed to be widened. Corridors vary far more than doors do. */
export const MAX_EXTRA_HALLWAY = 200;

/**
 * Total nodes the whole diagnostics phase may generate.
 *
 * A NODE budget, not a millisecond budget, and that is the entire point. Node
 * counts are a deterministic function of the input, so the same scene produces
 * the same suggestions — and the same `truncated` flag — on a fast laptop and a
 * loaded CI box alike. A wall-clock budget would make the engine's output depend
 * on how busy the machine was, which is exactly the kind of irreproducibility
 * this project promises not to have.
 *
 * The value is chosen so that the worst scenario here lands comfortably inside
 * three seconds; it buys roughly a second and a half of search.
 */
export const DEFAULT_DIAGNOSTICS_NODE_BUDGET = 1_200_000;

export interface DiagnoseContext {
  item: Item;
  environment: Environment;
  /** Lattice levels, coarsest first, exactly as the main plan used them. */
  levels: readonly LatticeRequest[];
  maxNodes: number;
  pivotMoves: boolean;
  start?: Placement;
  /** Run the literal linear scan at full resolution instead of bracketing. */
  exhaustive: boolean;
  /** Keep searching for thresholds after the first actionable suggestion. */
  allSuggestions: boolean;
  /** Total nodes the diagnostics phase may spend. */
  nodeBudget: number;
}

export interface DiagnosisReport {
  suggestions: Suggestion[];
  /** True when the budget or an early exit left some counterfactual unevaluated. */
  truncated: boolean;
}

/**
 * How much a counterfactual grows the space the planner has to search.
 *
 * This is the single most useful thing to know about a counterfactual, because
 * the cost of proving that it does NOT help is governed by it almost entirely.
 * Taking the legs off shrinks the item and costs about what the original scene
 * cost. Widening a door by up to 20 cm barely moves the needle. Widening a
 * corridor by up to 2 m multiplies the reachable set by an order of magnitude
 * and turns a third of a second into eleven.
 */
type Enlargement = 'shrinks' | 'slight' | 'large';

/** One counterfactual family. */
interface Probe {
  kind: SuggestionKind;
  /** Build the world for a given magnitude. Magnitude is ignored for part removal. */
  environmentFor(value: number): Environment;
  excludeBoxIndices?: readonly number[];
  /** Range of magnitudes to search, inclusive. Absent for part removal. */
  range?: { lo: number; hi: number };
  part?: { name: string; nameHe: string };
  enlargement: Enlargement;
}

type Outcome = 'helps' | 'no' | 'unknown';

interface Finding {
  kind: SuggestionKind;
  outcome: Outcome;
  basis: Suggestion['basis'];
  value?: number;
  part?: { name: string; nameHe: string };
}

/**
 * Work out what would actually make this fit, by re-planning counterfactuals
 * rather than by inspecting the geometry and guessing.
 *
 * Every positive number reported here was produced by a search that succeeded.
 *
 * The shape of the work is dictated by one measurement: a full-resolution proof
 * that no path exists is cheap on the scene as given and ruinous on an enlarged
 * one. Refuting "a 176 cm hallway is not enough" at full resolution costs 3.9
 * million nodes and eleven seconds, against 341 thousand and a third of a second
 * for the scene itself, because widening the corridor is precisely what gives
 * the search more space to rule out. So:
 *
 *   1. Probe every counterfactual once, at its most generous value, on the
 *      coarse rungs. Cheap, and it says which families can help at all.
 *   2. Binary-search the threshold on the coarse rungs, then confirm the winning
 *      value at full resolution. Confirming a positive is fast — A* goes
 *      straight there — whereas refuting the value one centimetre below is the
 *      expensive proof of absence, and it is not attempted.
 *   3. Spend whatever budget is left upgrading the negative claims to full
 *      resolution, in a fixed order.
 *
 * What that costs in rigour is stated rather than hidden: a threshold is the
 * smallest value at which a path was FOUND, and because the coarse lattice is
 * one-sided it can only ever be too generous, never too small. Told to widen a
 * hallway to 177 cm, you will not then discover that 177 cm was not enough.
 */
export function diagnose(context: DiagnoseContext): DiagnosisReport {
  const { item, environment, start } = context;
  const baseOpening = environment.params.openingWidth;
  const baseHallway = environment.params.hallwayWidth;

  let remaining = context.nodeBudget;
  let truncated = false;
  /** Set when the previous attempt was settled by the closed-form proof rather than by search. */
  let lastWasProof = false;

  /**
   * Run one counterfactual. Returns 'unknown' when the budget cut it short,
   * which is a different thing from 'no' and is never reported as one.
   */
  const attempt = (
    env: Environment,
    excludeBoxIndices: readonly number[] | undefined,
    depth: 'sketch' | 'full',
  ): Outcome => {
    const prepared = prepareItem(item, excludeBoxIndices);
    lastWasProof = false;
    // The closed-form proof settles this counterfactual for free when it fires,
    // and it is a proof, so it does not spend budget — and its negative is
    // exact, not merely "not found", which the basis below has to reflect.
    if (provableNoFit(prepared.boxes, env.params.openingWidth, env.params.openingHeight).proven) {
      lastWasProof = true;
      return 'no';
    }
    if (remaining <= 0) {
      truncated = true;
      return 'unknown';
    }
    const report = findPath(prepared, env, {
      levels: context.levels,
      ...(depth === 'sketch' ? { sketchOnly: true } : {}),
      maxNodes: Math.min(remaining, context.maxNodes),
      pivotMoves: context.pivotMoves,
      ...(start !== undefined ? { start } : {}),
    });
    remaining -= report.outcome.nodesGenerated;
    if (report.outcome.path !== undefined) return 'helps';
    if (report.outcome.budgetExhausted) {
      truncated = true;
      return 'unknown';
    }
    return 'no';
  };

  // Fixed order, cheapest and least space-enlarging first. That ordering is
  // also, conveniently, roughly least-effort-first for the person doing the
  // moving: unscrewing legs, then widening a door, then rebuilding a corridor.
  const probes: Probe[] = [
    ...(item.removableParts ?? []).map(
      (part): Probe => ({
        kind: 'remove-part',
        environmentFor: () => environment,
        excludeBoxIndices: part.boxIndices,
        part: { name: part.name, nameHe: part.nameHe },
        enlargement: 'shrinks',
      }),
    ),
    {
      kind: 'widen-opening',
      environmentFor: (extra) => withParams(environment, { openingWidth: baseOpening + extra }),
      range: { lo: lowestPlausibleOpeningExtra(item, environment), hi: MAX_EXTRA_OPENING },
      enlargement: 'slight',
    },
    {
      kind: 'widen-hallway',
      environmentFor: (extra) => withParams(environment, { hallwayWidth: baseHallway + extra }),
      range: { lo: 1, hi: MAX_EXTRA_HALLWAY },
      enlargement: 'large',
    },
  ];

  // --- Phase 1: can each family help at all? ------------------------------
  //
  // At full resolution for the families that do not blow the search space up,
  // because a positive found here is the answer and finding one is cheap. At
  // coarse resolution for the ones that do, because their negative is what
  // costs, and a coarse negative is still worth reporting.
  //
  // Once an actionable answer is in hand, everything after it drops to coarse:
  // there is no point spending the budget proving that a second, more expensive
  // remedy also fails.
  const findings: Finding[] = [];
  let foundActionable = false;

  for (const probe of probes) {
    const value = probe.range?.hi ?? 0;
    if (probe.range !== undefined && probe.range.lo > probe.range.hi) {
      // Ruled out in closed form at every magnitude; no search could add to it.
      findings.push({
        kind: probe.kind,
        outcome: 'no',
        basis: 'full-resolution',
        ...(probe.part !== undefined ? { part: probe.part } : {}),
      });
      continue;
    }
    const depth: 'sketch' | 'full' =
      probe.enlargement === 'large' || (foundActionable && !context.allSuggestions)
        ? 'sketch'
        : 'full';
    const outcome = attempt(probe.environmentFor(value), probe.excludeBoxIndices, depth);
    if (outcome === 'helps') foundActionable = true;
    findings.push({
      kind: probe.kind,
      outcome,
      basis:
        outcome === 'unknown'
          ? 'not-evaluated'
          : lastWasProof || depth === 'full'
            ? 'full-resolution'
            : 'coarse-lattice',
      ...(probe.part !== undefined ? { part: probe.part } : {}),
    });
  }

  // --- Phase 2: pin down the threshold for the families that can help. ------
  let thresholdDone = false;
  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i]!;
    const finding = findings[i]!;
    if (finding.outcome !== 'helps' || probe.range === undefined) continue;
    if (thresholdDone && !context.allSuggestions) {
      // This family helps too, which is worth saying, but its exact threshold
      // is not worth another search once one usable answer exists.
      truncated = true;
      continue;
    }

    if (context.exhaustive) {
      const exact = linearScanAtFullResolution(probe, attempt);
      if (exact !== undefined) {
        finding.value = exact;
        finding.basis = 'full-resolution';
      }
      thresholdDone = true;
      continue;
    }

    const bracket = bracketOnCoarse(probe, attempt);
    if (bracket === undefined) {
      finding.outcome = 'unknown';
      finding.basis = 'not-evaluated';
      truncated = true;
      continue;
    }
    finding.value = bracket;
    // The bracket came off the coarse rungs, so it is an upper bound: the true
    // threshold could be lower. Confirming the winning value at full resolution
    // is cheap and worth doing; establishing that nothing smaller works is the
    // expensive proof of absence, and it only happens if the budget is
    // generous enough to be asked for.
    const confirmed = attempt(probe.environmentFor(bracket), probe.excludeBoxIndices, 'full');
    if (bracket === probe.range.lo && confirmed === 'helps') {
      // Nothing below `lo` is possible — it was ruled out in closed form, or it
      // is off the end of the range — so this bracket is not an upper bound, it
      // is the answer.
      finding.basis = 'full-resolution';
    } else {
      finding.basis = 'coarse-lattice';
      const refined = refineAtFullResolution(probe, bracket, attempt, () => remaining);
      if (refined !== undefined) {
        finding.value = refined;
        finding.basis = 'full-resolution';
      }
    }
    thresholdDone = true;
  }

  // --- Phase 3: upgrade negatives, but only when nothing actionable was found.
  // If there is already a fix on the table, spending minutes proving that two
  // other fixes would not have worked serves nobody.
  if (!foundActionable || context.allSuggestions) {
    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i]!;
      const finding = findings[i]!;
      if (finding.outcome !== 'no' || finding.basis === 'full-resolution') continue;
      const value = probe.range?.hi ?? 0;
      const upgraded = attempt(probe.environmentFor(value), probe.excludeBoxIndices, 'full');
      if (upgraded === 'helps') {
        // The coarse rungs missed a path the reference lattice finds. That is
        // the documented one-sided error, and the finer answer wins.
        finding.outcome = 'helps';
        finding.basis = 'full-resolution';
        finding.value = probe.range?.hi;
      } else if (upgraded === 'no') {
        finding.basis = 'full-resolution';
      } else {
        truncated = true;
      }
    }
  }

  if (findings.some((f) => f.basis !== 'full-resolution')) truncated = true;

  return {
    suggestions: findings.map((finding) => describe(finding, baseOpening, baseHallway, findings)),
    truncated,
  };
}

/**
 * Smallest magnitude that works, bracketed on the coarse rungs.
 *
 * Monotonicity is not an assumption, it is a fact about the problem: widening
 * the opening, widening the hallway and removing a part all delete obstacle
 * volume or shrink the item, so the free configuration space only grows. Any
 * path valid at value v is still valid at v+1, because nothing was added that
 * could block it. That is what makes a binary search exact rather than
 * approximate.
 */
function bracketOnCoarse(
  probe: Probe,
  attempt: (env: Environment, exclude: readonly number[] | undefined, depth: 'sketch' | 'full') => Outcome,
): number | undefined {
  const { lo, hi } = probe.range!;
  if (lo > hi) return undefined;
  if (attempt(probe.environmentFor(hi), probe.excludeBoxIndices, 'sketch') !== 'helps') {
    return undefined;
  }
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    // Anything but a definite success moves the search upward. An 'unknown'
    // therefore makes the answer more generous, never less — the safe
    // direction, since the number is advice about how much to widen something.
    if (attempt(probe.environmentFor(mid), probe.excludeBoxIndices, 'sketch') === 'helps') {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/**
 * Sharpen a coarse bracket at full resolution, if the budget is generous.
 *
 * Off by default, and the measurements say why. Near the threshold the
 * reference lattice is slow even when a path EXISTS — at the boundary of the
 * narrow-hallway scenario a single probe costs about ten seconds, because A*
 * has to explore nearly the whole reachable set before it threads the gap. So
 * pinning a threshold to the centimetre at full resolution costs tens of
 * seconds however it is arranged, and no ordering trick avoids it.
 *
 * Callers who want the exact number can pay for it by raising
 * `diagnosticsNodeBudget`. The result stays deterministic either way, because
 * the gate is a node count.
 */
function refineAtFullResolution(
  probe: Probe,
  bracket: number,
  attempt: (env: Environment, exclude: readonly number[] | undefined, depth: 'sketch' | 'full') => Outcome,
  remaining: () => number,
): number | undefined {
  const { lo } = probe.range!;
  if (bracket <= lo) return undefined;
  // A binary search over the remaining span needs roughly log2(span) probes,
  // and near the boundary each costs millions of nodes. Only start if there is
  // plausibly enough budget to finish; a half-finished refinement would spend
  // everything and improve nothing.
  const probesNeeded = Math.ceil(Math.log2(Math.max(2, bracket - lo + 1)));
  if (remaining() < probesNeeded * REFINEMENT_PROBE_ESTIMATE) return undefined;

  let low = lo;
  let high = bracket;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    // Anything short of a definite success moves the search upward, so a
    // budget-starved probe can only make the answer more generous.
    if (attempt(probe.environmentFor(mid), probe.excludeBoxIndices, 'full') === 'helps') {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/** Rough nodes one near-threshold full-resolution probe costs. Measured, not guessed. */
const REFINEMENT_PROBE_ESTIMATE = 3_500_000;

/** The literal 1 cm scan at full resolution, for `exhaustive: true`. */
function linearScanAtFullResolution(
  probe: Probe,
  attempt: (env: Environment, exclude: readonly number[] | undefined, depth: 'sketch' | 'full') => Outcome,
): number | undefined {
  const { lo, hi } = probe.range!;
  for (let value = lo; value <= hi; value++) {
    if (attempt(probe.environmentFor(value), probe.excludeBoxIndices, 'full') === 'helps') {
      return value;
    }
  }
  return undefined;
}

/**
 * Widths at which the closed-form proof still fires cannot possibly work, so the
 * search never asks about them. Exact, not a heuristic.
 */
function lowestPlausibleOpeningExtra(item: Item, environment: Environment): number {
  let extra = 1;
  while (
    extra <= MAX_EXTRA_OPENING &&
    provableNoFit(
      item.boxes,
      environment.params.openingWidth + extra,
      environment.params.openingHeight,
    ).proven
  ) {
    extra++;
  }
  return extra;
}

function describe(
  finding: Finding,
  baseOpening: number,
  baseHallway: number,
  all: readonly Finding[],
): Suggestion {
  const evaluated = finding.basis !== 'not-evaluated';
  const coarseOnly = finding.basis === 'coarse-lattice';
  const hedge = coarseOnly ? ' (established on the coarse lattice)' : '';
  const hedgeHe = coarseOnly ? ' (נקבע על הסריג הגס)' : '';

  const base: Pick<Suggestion, 'kind' | 'helps' | 'evaluated' | 'basis'> = {
    kind: finding.kind,
    helps: finding.outcome === 'helps',
    evaluated,
    basis: finding.basis,
  };

  if (!evaluated) {
    return {
      ...base,
      ...(finding.part !== undefined ? { part: finding.part.name, partHe: finding.part.nameHe } : {}),
      en: `Not evaluated: the diagnostics budget was spent before this counterfactual was reached.`,
      he: `לא נבדק: תקציב האבחון מוצה לפני שהגיע התור של האפשרות הזאת.`,
    };
  }

  if (finding.kind === 'remove-part') {
    const name = finding.part?.name ?? 'part';
    const nameHe = finding.part?.nameHe ?? 'החלק';
    return {
      ...base,
      part: name,
      partHe: nameHe,
      en:
        finding.outcome === 'helps'
          ? `Removing the ${name} is enough on its own: a path was found with them off${hedge}.`
          : `Removing the ${name} does not help: no path was found with them off either${hedge}.`,
      he:
        finding.outcome === 'helps'
          ? `הסרת ${nameHe} מספיקה כשלעצמה: נמצא מסלול בלעדיהן${hedgeHe}.`
          : `הסרת ${nameHe} אינה עוזרת: גם בלעדיהן לא נמצא מסלול${hedgeHe}.`,
    };
  }

  if (finding.kind === 'widen-opening') {
    if (finding.outcome !== 'helps') {
      return {
        ...base,
        en: `Widening the opening does not help: no path was found at any width up to ${baseOpening + MAX_EXTRA_OPENING} cm (${MAX_EXTRA_OPENING} cm wider)${hedge}.`,
        he: `הרחבת הפתח אינה עוזרת: לא נמצא מסלול באף רוחב עד ${baseOpening + MAX_EXTRA_OPENING} ס״מ (${MAX_EXTRA_OPENING} ס״מ יותר)${hedgeHe}.`,
      };
    }
    if (finding.value === undefined) {
      return {
        ...base,
        en: `Widening the opening helps, but the exact width was not searched for: another fix was already found. Pass allSuggestions to get the number.`,
        he: `הרחבת הפתח עוזרת, אך הרוחב המדויק לא חושב: כבר נמצא פתרון אחר. יש להעביר allSuggestions כדי לקבל את המספר.`,
      };
    }
    return {
      ...base,
      openingWidth: baseOpening + finding.value,
      extraOpeningWidth: finding.value,
      en: `Widening the opening by ${finding.value} cm, to ${baseOpening + finding.value} cm, is enough: a path was found at that width, and none at ${baseOpening + finding.value - 1} cm${hedge}.`,
      he: `הרחבת הפתח ב-${finding.value} ס״מ, ל-${baseOpening + finding.value} ס״מ, מספיקה: נמצא מסלול ברוחב הזה, ולא ברוחב ${baseOpening + finding.value - 1} ס״מ${hedgeHe}.`,
    };
  }

  // widen-hallway
  const openingHelps = all.some((f) => f.kind === 'widen-opening' && f.outcome === 'helps');
  if (finding.outcome !== 'helps') {
    return {
      ...base,
      en: `Widening the hallway does not help: no path was found with up to ${MAX_EXTRA_HALLWAY} cm of extra clearance in front of the door${hedge}.`,
      he: `הרחבת המסדרון אינה עוזרת: לא נמצא מסלול גם עם עוד ${MAX_EXTRA_HALLWAY} ס״מ מרווח מול הדלת${hedgeHe}.`,
    };
  }
  if (finding.value === undefined) {
    return {
      ...base,
      en: `Widening the hallway helps, but the exact clearance was not searched for: another fix was already found. Pass allSuggestions to get the number.`,
      he: `הרחבת המסדרון עוזרת, אך המרווח המדויק לא חושב: כבר נמצא פתרון אחר. יש להעביר allSuggestions כדי לקבל את המספר.`,
    };
  }
  const binding = !openingHelps;
  return {
    ...base,
    hallwayWidth: baseHallway + finding.value,
    extraHallwayWidth: finding.value,
    en: binding
      ? `The hallway is the binding constraint, not the opening. It needs ${finding.value} cm more clearance in front of the door — ${baseHallway + finding.value} cm instead of ${baseHallway} cm — and then a path exists. The item passes through the opening itself; it simply cannot be turned to face it in a corridor this narrow${hedge}.`
      : `Widening the hallway also works: ${finding.value} cm more clearance in front of the door, ${baseHallway + finding.value} cm instead of ${baseHallway} cm${hedge}.`,
    he: binding
      ? `המסדרון הוא האילוץ הכובל, לא הפתח. דרושים עוד ${finding.value} ס״מ מרווח מול הדלת — ${baseHallway + finding.value} ס״מ במקום ${baseHallway} ס״מ — ואז קיים מסלול. הרהיט עצמו עובר בפתח; פשוט אי אפשר לסובב אותו אל מול הפתח במסדרון צר כל כך${hedgeHe}.`
      : `גם הרחבת המסדרון עוזרת: עוד ${finding.value} ס״מ מרווח מול הדלת, ${baseHallway + finding.value} ס״מ במקום ${baseHallway} ס״מ${hedgeHe}.`,
  };
}
