/**
 * Where the product's integrity lives.
 *
 * Two rules, and they are the reason this file exists instead of the UI just
 * printing whatever the engine handed it:
 *
 *  1. **"No path found" is not "does not fit".** A* exhausting a bounded
 *     lattice proves there is no path ON THAT LATTICE. Only the closed-form
 *     cross-section proof establishes impossibility, and only that one gets to
 *     say so. A third state exists and is not a negative at all: the search can
 *     run out of budget, which concludes nothing.
 *
 *  2. **A coarse-lattice number is one-sided.** The coarse rungs can miss a
 *     path, never invent one, so a threshold found there can be too generous
 *     but never too small. Printing "195 cm" implies a sharpness that was not
 *     bought — the exact answer for that scene is 177 — so those numbers are
 *     rendered as approximations, and rounded UP, which is the direction that
 *     keeps the guarantee intact.
 */
import type { InfeasibleReason, Suggestion } from '@fitpath/engine';
import type { Verdict } from '../engine/protocol.ts';

export type VerdictTone = 'fits' | 'not-found' | 'proven' | 'inconclusive';

export interface VerdictLabel {
  tone: VerdictTone;
  title: string;
  titleHe: string;
  /** One line under the headline. Never overstates what was established. */
  note: string;
  noteHe: string;
}

export function verdictLabel(verdict: Verdict): VerdictLabel {
  if (verdict.feasible) {
    return {
      tone: 'fits',
      title: 'Fits',
      titleHe: 'נכנס',
      note: 'A path was found, and every placement along it was checked for collisions.',
      noteHe: 'נמצא מסלול, וכל מיקום לאורכו נבדק מול התנגשויות.',
    };
  }
  return infeasibleLabel(verdict.reason);
}

function infeasibleLabel(reason: InfeasibleReason): VerdictLabel {
  switch (reason) {
    case 'proven-too-large':
      return {
        tone: 'proven',
        title: "Won't fit — proven",
        titleHe: 'לא ייכנס — הוכחה',
        note: 'Established in closed form, with no search: one of the item’s parts cannot cross the opening at any angle whatsoever.',
        noteHe: 'נקבע בנוסחה סגורה, ללא חיפוש: אחד מחלקי הרהיט אינו יכול לעבור בפתח בשום זווית שהיא.',
      };
    case 'no-path-found':
      return {
        tone: 'not-found',
        title: 'No path found',
        titleHe: 'לא נמצא מסלול',
        note: 'The search covered every reachable configuration on its lattice and found none. That is not a proof that no path exists in continuous space.',
        noteHe: 'החיפוש כיסה כל תצורה ברת-הגעה על הסריג ולא מצא אף אחת. אין בכך הוכחה שלא קיים מסלול במרחב רציף.',
      };
    case 'search-budget-exhausted':
      return {
        tone: 'inconclusive',
        title: 'Inconclusive',
        titleHe: 'ללא הכרעה',
        note: 'The search hit its node budget before settling the question. This is not a no — it is an unfinished search.',
        noteHe: 'החיפוש מיצה את תקציב הצמתים לפני שהכריע. זו אינה תשובה שלילית אלא חיפוש שלא הושלם.',
      };
  }
}

/** Rounded to the centimetre, without a trailing `.0` on whole numbers. */
export function cm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Round a one-sided threshold to a blunter number, UPWARD.
 *
 * Upward matters. A coarse threshold is already generous, so rounding up stays
 * generous; rounding to nearest could land below a value the search actually
 * verified and quietly turn a safe number into an unsafe one.
 */
const roundUpTo5 = (value: number): number => Math.ceil(value / 5) * 5;

export interface SuggestionCopy {
  /** 'fix' when this counterfactual works, 'ruled-out' when it does not, 'unknown' when it never ran. */
  status: 'fix' | 'ruled-out' | 'unknown';
  /** How firmly, in the reader's words. */
  precision: 'exact' | 'approximate' | 'not-evaluated';
  headline: string;
  headlineHe: string;
  /**
   * The engine's own sentence, when it can be shown without implying a
   * sharpness it does not have.
   */
  detail?: string;
  detailHe?: string;
  /** Shown under an approximate number, so the one-sidedness is on the page. */
  caveat?: string;
}

export function suggestionCopy(suggestion: Suggestion, params: { openingWidth: number; hallwayWidth: number }): SuggestionCopy {
  if (!suggestion.evaluated) {
    return {
      status: 'unknown',
      precision: 'not-evaluated',
      headline: 'Not evaluated',
      headlineHe: 'לא נבדק',
      detail: suggestion.en,
      detailHe: suggestion.he,
    };
  }

  const approximate = suggestion.basis === 'coarse-lattice';
  const precision: SuggestionCopy['precision'] = approximate ? 'approximate' : 'exact';
  const caveat = approximate
    ? 'Approximate, and generous by construction: the coarse lattice can miss a path but never invent one, so the real threshold is this or lower — never higher.'
    : undefined;

  // A negative carries no threshold, so there is no precision to misstate and
  // the engine's own wording (which hedges itself) is the clearest thing to show.
  if (!suggestion.helps) {
    return {
      status: 'ruled-out',
      precision,
      headline: ruledOutHeadline(suggestion),
      headlineHe: ruledOutHeadlineHe(suggestion),
      detail: suggestion.en,
      detailHe: suggestion.he,
    };
  }

  if (suggestion.kind === 'remove-part') {
    const part = suggestion.part ?? 'part';
    return {
      status: 'fix',
      precision,
      headline: `Take the ${part} off — that alone is enough`,
      headlineHe: `להסיר את ${suggestion.partHe ?? 'החלק'} — זה לבדו מספיק`,
      detail: suggestion.en,
      detailHe: suggestion.he,
      ...(caveat !== undefined ? { caveat } : {}),
    };
  }

  if (suggestion.kind === 'widen-opening') {
    if (suggestion.openingWidth === undefined || suggestion.extraOpeningWidth === undefined) {
      return {
        status: 'fix',
        precision: 'not-evaluated',
        headline: 'A wider opening works, but the width was not searched for',
        headlineHe: 'פתח רחב יותר עוזר, אך הרוחב לא חושב',
        detail: suggestion.en,
        detailHe: suggestion.he,
      };
    }
    const width = approximate ? roundUpTo5(suggestion.openingWidth) : suggestion.openingWidth;
    const extra = width - params.openingWidth;
    return {
      status: 'fix',
      precision,
      headline: approximate
        ? `Widen the opening to about ${cm(width)} cm — roughly ${cm(extra)} cm more`
        : `Widen the opening to ${cm(width)} cm — ${cm(extra)} cm more`,
      headlineHe: approximate
        ? `להרחיב את הפתח לכ-${cm(width)} ס״מ — בערך ${cm(extra)} ס״מ יותר`
        : `להרחיב את הפתח ל-${cm(width)} ס״מ — ${cm(extra)} ס״מ יותר`,
      ...(approximate ? {} : { detail: suggestion.en, detailHe: suggestion.he }),
      ...(caveat !== undefined ? { caveat } : {}),
    };
  }

  if (suggestion.hallwayWidth === undefined || suggestion.extraHallwayWidth === undefined) {
    return {
      status: 'fix',
      precision: 'not-evaluated',
      headline: 'A wider hallway works, but the clearance was not searched for',
      headlineHe: 'מסדרון רחב יותר עוזר, אך המרווח לא חושב',
      detail: suggestion.en,
      detailHe: suggestion.he,
    };
  }

  const width = approximate ? roundUpTo5(suggestion.hallwayWidth) : suggestion.hallwayWidth;
  const extra = width - params.hallwayWidth;
  return {
    status: 'fix',
    precision,
    headline: approximate
      ? `The hallway is the binding constraint. It needs about ${cm(width)} cm of clearance in front of the door — roughly ${cm(extra)} cm more`
      : `The hallway is the binding constraint. It needs ${cm(width)} cm of clearance in front of the door — ${cm(extra)} cm more`,
    headlineHe: approximate
      ? `המסדרון הוא האילוץ הכובל. דרושים כ-${cm(width)} ס״מ מרווח מול הדלת — בערך ${cm(extra)} ס״מ יותר`
      : `המסדרון הוא האילוץ הכובל. דרושים ${cm(width)} ס״מ מרווח מול הדלת — ${cm(extra)} ס״מ יותר`,
    ...(approximate ? {} : { detail: suggestion.en, detailHe: suggestion.he }),
    ...(caveat !== undefined ? { caveat } : {}),
  };
}

function ruledOutHeadline(suggestion: Suggestion): string {
  switch (suggestion.kind) {
    case 'remove-part':
      return `Taking the ${suggestion.part ?? 'part'} off does not help`;
    case 'widen-opening':
      return 'A wider opening does not help';
    case 'widen-hallway':
      return 'A wider hallway does not help';
  }
}

function ruledOutHeadlineHe(suggestion: Suggestion): string {
  switch (suggestion.kind) {
    case 'remove-part':
      return `הסרת ${suggestion.partHe ?? 'החלק'} אינה עוזרת`;
    case 'widen-opening':
      return 'פתח רחב יותר אינו עוזר';
    case 'widen-hallway':
      return 'מסדרון רחב יותר אינו עוזר';
  }
}

export const PRECISION_BADGE: Record<SuggestionCopy['precision'], string> = {
  exact: 'exact',
  approximate: 'approximate',
  'not-evaluated': 'not evaluated',
};

export function shekels(value: number): string {
  return `₪${value.toLocaleString('en-US')}`;
}

export function seconds(millis: number): string {
  return millis < 950 ? `${Math.round(millis)} ms` : `${(millis / 1000).toFixed(1)} s`;
}
