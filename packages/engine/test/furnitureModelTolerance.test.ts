import { describe, expect, it } from 'vitest';
import type { FurnitureField } from '../src/sourcing/types.ts';
import {
  buildFurnitureModel,
  DEFAULT_INPUT_TOLERANCE_CM,
  DEFAULT_OVERALL_TOLERANCE_CM,
  ROUNDED_TO_FIVE_TOLERANCE_CM,
  ROUNDED_TO_TEN_TOLERANCE_CM,
} from '../src/sourcing/furnitureModel.ts';
import { LISTINGS, WITH_LEG_INSET } from './support/publishedListings.ts';
import { PERTURBATIONS, perturbableFields, perturbed } from './support/perturb.ts';
import { alignedTo } from './support/occupancy.ts';
import { uncontainedRegions } from './support/exactContainment.ts';

/**
 * What happens to the model when the listing is wrong.
 *
 * The six ground-truth listings are idealised: every number in them was measured
 * off the very fixture they are compared against, so they are error-free input
 * of a quality no shop produces. This file supplies the missing half — the same
 * listings with each field moved by up to five centimetres in turn — and re-runs
 * exact containment on every one.
 *
 * Five, not two. An earlier version of this sweep moved fields by at most two
 * centimetres and concluded that two centimetres of slack closed everything,
 * which is very nearly circular: it validated a margin against exactly the error
 * it was sized for. Five is what the rounding actually spans — a listing rounded
 * to the nearest ten carries up to five centimetres of error, and two thirds of
 * the numbers in these six listings sit on a multiple of five.
 *
 * The seventh case exists because the six do not exercise the under-seat carve:
 * no shop publishes where the legs stand in plan, so that rule would otherwise
 * never meet ground truth at all. It is the thinnest-covered rule in the
 * contract and the highest-value one.
 */

const CASES = [...LISTINGS, WITH_LEG_INSET];

/**
 * Fields that change the size of the bounding box itself.
 *
 * Counted separately throughout, because they fail for a different reason and
 * take a different remedy. A wrong seat depth makes the pipeline derive air that
 * is not there — the pipeline's own exposure, and what `toleranceCm` covers. A
 * wrong overall width just means the listing describes a smaller sofa; no
 * internal conservatism recovers that, and only `overallToleranceCm` can.
 */
const BOUNDING_BOX_FIELDS = new Set<FurnitureField>([
  'overallWidthCm',
  'overallDepthCm',
  'overallHeightCm',
]);

interface SweepResult {
  cases: number;
  carveBreaks: number;
  boundingBoxBreaks: number;
  worstLeakCm3: number;
  byField: ReadonlyMap<FurnitureField, number>;
}

function sweep(toleranceCm: number, overallToleranceCm: number): SweepResult {
  let cases = 0;
  let carveBreaks = 0;
  let boundingBoxBreaks = 0;
  let worstLeakCm3 = 0;
  const byField = new Map<FurnitureField, number>();

  for (const { fixture, published } of CASES) {
    for (const field of perturbableFields(published)) {
      for (const deltaCm of PERTURBATIONS) {
        cases += 1;
        const model = buildFurnitureModel({
          ...perturbed(published, field, deltaCm),
          toleranceCm,
          overallToleranceCm,
        });
        const leaks = uncontainedRegions(fixture, alignedTo(model.item, fixture));
        if (leaks.length === 0) continue;
        if (BOUNDING_BOX_FIELDS.has(field)) boundingBoxBreaks += 1;
        else carveBreaks += 1;
        byField.set(field, (byField.get(field) ?? 0) + 1);
        worstLeakCm3 = Math.max(
          worstLeakCm3,
          leaks.reduce((sum, leak) => sum + leak.volumeCm3, 0),
        );
      }
    }
  }

  return { cases, carveBreaks, boundingBoxBreaks, worstLeakCm3, byField };
}

const CARVE_ONLY = new Map([0, 1, 2, 3, 4, 5, 6].map((t) => [t, sweep(t, 0)]));
const SHIPPED = sweep(DEFAULT_INPUT_TOLERANCE_CM, DEFAULT_OVERALL_TOLERANCE_CM);

describe('input tolerance: what error in a listing does', () => {
  /**
   * **The measurement that sets the defaults.**
   *
   * Taking published numbers literally, better than a third of perturbed
   * listings produce a model with a hole in it, and the worst is 75 litres of
   * real sofa outside its own model. That is the "it fits" answer about
   * something that does not, which is the single outcome this subsystem exists
   * to prevent.
   */
  it('breaks containment in 217 of 572 cases when the numbers are taken literally', () => {
    const baseline = CARVE_ONLY.get(0)!;

    expect(baseline.cases).toBe(572);
    expect(baseline.carveBreaks + baseline.boundingBoxBreaks).toBe(217);
    expect(baseline.carveBreaks).toBe(92);
    expect(baseline.boundingBoxBreaks).toBe(125);
    expect(Math.round(baseline.worstLeakCm3)).toBe(75680);
  });

  /**
   * **Five centimetres, and why it is not two.**
   *
   * Four still leaves fourteen carve-derived breaks; five leaves none; six buys
   * nothing. The default is the width of the error the sweep contains, measured,
   * and the sweep's width is set by what rounding actually does to a published
   * number rather than by what was convenient to test.
   */
  it.each([
    [0, 92],
    [1, 74],
    [2, 56],
    [3, 35],
    [4, 14],
    [5, 0],
    [6, 0],
  ])('leaves %s cm of slack with %s carve-derived breaks', (tolerance, expected) => {
    expect(CARVE_ONLY.get(tolerance)!.carveBreaks).toBe(expected);
  });

  it('uses that measured value as the default', () => {
    expect(DEFAULT_INPUT_TOLERANCE_CM).toBe(5);
    expect(CARVE_ONLY.get(DEFAULT_INPUT_TOLERANCE_CM)!.carveBreaks).toBe(0);
  });

  /**
   * **A KNOWN, ACCEPTED RISK — not desired behaviour. Read this before touching
   * the number below.**
   *
   * Thirty-five of five hundred and seventy-two perturbed listings still produce
   * a model with a hole in it at the shipped defaults. Each one is an overall
   * dimension under-reported by three centimetres or more, and each one is a
   * case where this pipeline could answer "it fits" about a sofa that will not
   * go through the door. That is the outcome the rest of this subsystem exists
   * to prevent, and here it is not prevented.
   *
   * It is accepted rather than fixed because the fix is priced and the price is
   * worse: `overallToleranceCm: 5` takes the sweep to zero, and costs about
   * eight points of tightness across the whole catalogue — a model that fat
   * answers "no path found" for a great many sofas that would have fitted.
   * Two centimetres closes the two-centimetre population completely and two
   * thirds of the whole, which is where the trade was struck.
   *
   * This test is green when the risk is *exactly as large as we agreed it was*.
   * If the number falls, something got safer and the figure should be lowered
   * deliberately. If it rises, the risk grew without anyone deciding to let it,
   * and that is a regression whatever else is passing.
   */
  it('characterises the 35 still-unsound cases the shipped defaults knowingly accept', () => {
    expect(SHIPPED.carveBreaks).toBe(0);
    expect(SHIPPED.boundingBoxBreaks).toBe(35);
    expect([...SHIPPED.byField.keys()].every((field) => BOUNDING_BOX_FIELDS.has(field))).toBe(true);
  });

  it('closes every case in the sweep once the skin is grown by the full five', () => {
    const guarded = sweep(5, 5);

    expect(guarded.cases).toBe(572);
    expect(guarded.carveBreaks).toBe(0);
    expect(guarded.boundingBoxBreaks).toBe(0);
    expect(guarded.worstLeakCm3).toBe(0);
  });

  /**
   * Slack has to be monotone, or the default cannot be reasoned about at all.
   *
   * More doubt must never produce more failures. If it ever does, some rule is
   * applying its tolerance in the direction that removes material, and the
   * measured default is meaningless because the curve it was read off is not a
   * curve.
   */
  it('never breaks more as the slack widens', () => {
    const tolerances = [...CARVE_ONLY.keys()].sort((a, b) => a - b);
    for (let i = 1; i < tolerances.length; i++) {
      expect(CARVE_ONLY.get(tolerances[i]!)!.carveBreaks).toBeLessThanOrEqual(
        CARVE_ONLY.get(tolerances[i - 1]!)!.carveBreaks,
      );
    }
  });

  /** The table the defaults were read off, printed where a retune would show it. */
  it('reports the sweep', () => {
    const lines = [...CARVE_ONLY.entries()].map(([tolerance, result]) => {
      const fields = [...result.byField.entries()]
        .filter(([field]) => !BOUNDING_BOX_FIELDS.has(field))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([field, count]) => `${field}:${count}`)
        .join('  ');
      return (
        `  toleranceCm ${String(tolerance).padStart(2)}  overall 0  ->  ` +
        `carve ${String(result.carveBreaks).padStart(2)}   box ${String(result.boundingBoxBreaks).padStart(3)}   ` +
        `of ${result.cases}   ${fields}`
      );
    });
    lines.push(
      `  toleranceCm  ${DEFAULT_INPUT_TOLERANCE_CM}  overall ${DEFAULT_OVERALL_TOLERANCE_CM}  ->  ` +
        `carve ${SHIPPED.carveBreaks}   box  ${SHIPPED.boundingBoxBreaks}   of ${SHIPPED.cases}   <- shipped defaults`,
    );
    // eslint-disable-next-line no-console
    console.log(['', 'perturbation sweep (every field, -5..+5 cm, exact containment):', ...lines, ''].join('\n'));

    expect(lines).toHaveLength(8);
  });
});

describe('input tolerance: the roundness floor', () => {
  const listing = LISTINGS[0]!.published;

  /**
   * A number's own roundness may raise its tolerance. It may never lower it.
   *
   * That asymmetry is the whole design. "This value is a multiple of ten, so it
   * was probably rounded to ten and could be five out" only ever keeps material,
   * so being wrong about it costs pessimism. The tempting mirror image — "this
   * value is an odd centimetre, so it is precise, so tighten it" — would remove
   * material on the strength of a digit, and it is not implemented and should
   * not be: an odd value comes just as readily from a unit conversion, from a
   * spec sheet that had already rounded a range, or from a measurement taken to
   * a different reference than a rule assumes. None of that is visible in the
   * number. A source that knows its figures are tight says so with
   * `fieldToleranceCm`, which is evidence rather than inference.
   */
  it('raises a multiple of five to 2.5 and a multiple of ten to 5', () => {
    expect(ROUNDED_TO_FIVE_TOLERANCE_CM).toBe(2.5);
    expect(ROUNDED_TO_TEN_TOLERANCE_CM).toBe(5);

    const tight = buildFurnitureModel({ ...listing, toleranceCm: 0.5 });

    // 55 and 15 are multiples of five; 70 and 10 are multiples of ten.
    expect(tight.tolerance.byField.seatHeightCm).toBe(2.5);
    expect(tight.tolerance.byField['legs.heightCm']).toBe(2.5);
    expect(tight.tolerance.byField.seatDepthCm).toBe(5);
    expect(tight.tolerance.byField.armrestWidthCm).toBe(5);
    expect(tight.tolerance.defaultCm).toBe(0.5);
  });

  it('leaves an unround number on the default', () => {
    // The Vetle's seat height is 46 and its armrests are 8 cm: neither is round,
    // so neither earns anything and both sit at whatever the caller set.
    const tight = buildFurnitureModel({ ...LISTINGS[1]!.published, toleranceCm: 0.5 });

    expect(tight.tolerance.byField.seatHeightCm).toBeUndefined();
    expect(tight.tolerance.byField.armrestWidthCm).toBeUndefined();
  });

  /** An explicit override is evidence and beats an inference, in either direction. */
  it('lets a per-field override win over the floor', () => {
    const measuredByHand = buildFurnitureModel({
      ...listing,
      toleranceCm: 0.5,
      fieldToleranceCm: { seatDepthCm: 0.2 },
      fieldSources: { seatDepthCm: 'operator-entered' },
    });

    expect(measuredByHand.tolerance.byField.seatDepthCm).toBe(0.2);
    // ...and the fields nobody spoke for still get their floor.
    expect(measuredByHand.tolerance.byField.armrestWidthCm).toBe(5);
  });

  /** Dormant at the shipped default, which is already at the floor's ceiling. */
  it('changes nothing at the shipped default', () => {
    expect(buildFurnitureModel(listing).tolerance.byField).toEqual({});
  });

  /**
   * The floor is what makes tightening the default safe.
   *
   * A caller with a tape-measured catalogue can drop `toleranceCm` to half a
   * centimetre and still not be punished for the numbers that were only ever
   * round: those keep the slack their roundness earns. Without the floor, that
   * same setting would carve into every value a shop had rounded to ten.
   */
  it('keeps a tightened default from carving into a rounded number', () => {
    let brokenWithout = 0;
    let brokenWith = 0;

    for (const { fixture, published } of CASES) {
      for (const field of perturbableFields(published)) {
        if (BOUNDING_BOX_FIELDS.has(field)) continue;
        for (const deltaCm of PERTURBATIONS) {
          const input = { ...perturbed(published, field, deltaCm), overallToleranceCm: 0 };
          // Same tight default; the only difference is whether the floor may lift it.
          const withFloor = buildFurnitureModel({ ...input, toleranceCm: 0.5 });
          const withoutFloor = buildFurnitureModel({
            ...input,
            toleranceCm: 0.5,
            fieldToleranceCm: Object.fromEntries(
              perturbableFields(published).map((name) => [name, 0.5]),
            ),
          });
          if (uncontainedRegions(fixture, alignedTo(withFloor.item, fixture)).length > 0) brokenWith += 1;
          if (uncontainedRegions(fixture, alignedTo(withoutFloor.item, fixture)).length > 0) brokenWithout += 1;
        }
      }
    }

    expect(brokenWith).toBeLessThan(brokenWithout);
  });
});
