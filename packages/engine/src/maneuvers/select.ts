import type { Maneuver, ManeuverRequirement } from './types.ts';

/** The four numbers a shopper measures with a tape. */
export interface Measurements {
  doorWidth: number;
  doorHeight: number;
  hallwayClearance: number;
  roomDepth: number;
}

/** Which of the four a maneuver asks more of than the shopper has. */
export type Shortfall = {
  [K in keyof Measurements]?: { needs: number; has: number };
};

export interface Rejection {
  templateId: string;
  name: string;
  nameHe: string;
  shortfall: Shortfall;
}

export type Selection =
  | {
      found: true;
      maneuver: Maneuver;
      /** Every other maneuver that also fits, in the same order. */
      alternatives: Maneuver[];
    }
  | {
      found: false;
      /**
       * Why each maneuver in the library was ruled out.
       *
       * This is **not** a verdict that the item does not fit. It says only that
       * no maneuver in the library covers this doorway, which is a statement
       * about the library. The caller must fall back to the planner, and only
       * `provableNoFit` may ever report a definite no.
       */
      rejected: Rejection[];
    };

const KEYS = ['doorWidth', 'doorHeight', 'hallwayClearance', 'roomDepth'] as const;

/** Tolerance on a tape measure, and the same one the collider treats as contact. */
const TOLERANCE = 1e-9;

function shortfallOf(requirement: ManeuverRequirement, have: Measurements): Shortfall {
  const out: Shortfall = {};
  for (const key of KEYS) {
    if (requirement[key] > have[key] + TOLERANCE) {
      out[key] = { needs: requirement[key], has: have[key] };
    }
  }
  return out;
}

/**
 * How simple a maneuver is to carry out, lowest first.
 *
 * Stage count leads, because among maneuvers that all fit, the one worth
 * telling someone about is the one with the fewest separate motions in it — not
 * the one that would squeeze through the narrowest door. Walking a sofa
 * straight through a 110 cm doorway beats threading it through the same
 * doorway, even though threading would also clear an 85 cm one.
 *
 * The remaining keys break ties in a fixed order, and the template id breaks
 * the last of them, so the choice is total and deterministic.
 */
function compare(a: Maneuver, b: Maneuver): number {
  if (a.stages.length !== b.stages.length) return a.stages.length - b.stages.length;
  for (const key of KEYS) {
    if (a.requirement[key] !== b.requirement[key]) return a.requirement[key] - b.requirement[key];
  }
  return a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0;
}

/**
 * Pick a maneuver for these measurements.
 *
 * A comparison of a few numbers against a few numbers. No search, no geometry,
 * no collision test — all of that happened once, offline, when the library was
 * built and every maneuver in it was validated placement by placement. What is
 * left at runtime is arithmetic, which is why it is instant and why the answer
 * can be explained in a sentence.
 */
export function selectManeuver(
  library: readonly Maneuver[],
  have: Measurements,
): Selection {
  const fits: Maneuver[] = [];
  const rejected: Rejection[] = [];

  for (const maneuver of library) {
    const shortfall = shortfallOf(maneuver.requirement, have);
    if (Object.keys(shortfall).length === 0) fits.push(maneuver);
    else {
      rejected.push({
        templateId: maneuver.templateId,
        name: maneuver.name,
        nameHe: maneuver.nameHe,
        shortfall,
      });
    }
  }

  if (fits.length === 0) return { found: false, rejected };
  const ordered = [...fits].sort(compare);
  return { found: true, maneuver: ordered[0]!, alternatives: ordered.slice(1) };
}
