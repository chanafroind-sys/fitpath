/**
 * Deterministic perturbation of a published listing.
 *
 * Retailers round. To the centimetre routinely, to five centimetres often, and
 * occasionally they measure to a reference the model does not assume — a seat
 * depth to the frame rather than to the cushion face. Every carve derived from
 * such a number inherits that error, and an error in the wrong direction eats
 * real material: if the true seat depth is 68 and the listing says 70, the
 * front-top carve removes two centimetres of actual backrest.
 *
 * So the pipeline has to be tested against input of the quality it will really
 * receive, not against the idealised readings the ground-truth listings are.
 * This enumerates that error. It is an enumeration, not a sample — no seed, no
 * generator, nothing to reproduce — because the engine's rule is that the same
 * input yields the same answer and a fuzzer that finds a bug on Tuesday and not
 * on Wednesday is not a test.
 */

import type { FurnitureInput, FurnitureField } from '../../src/sourcing/types.ts';

/**
 * The offsets applied to each field in turn, in centimetres.
 *
 * Plus or minus five, because that is what the rounding actually spans: a
 * listing rounded to the nearest five carries up to 2.5 cm of error and one
 * rounded to the nearest ten up to 5. Two thirds of the numbers in this
 * repository's own six listings sit on a multiple of five, so the wide end of
 * this range is the common case rather than the exotic one. A sweep that only
 * moved fields by two would have validated a two-centimetre default against
 * two-centimetre errors, which proves nothing.
 */
export const PERTURBATIONS: readonly number[] = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

/** Every field of a listing that carries a number an error could get into. */
const PERTURBABLE: readonly FurnitureField[] = [
  'overallWidthCm',
  'overallDepthCm',
  'overallHeightCm',
  'seatHeightCm',
  'seatDepthCm',
  'armrestWidthCm',
  'armrestHeightCm',
  'legs.heightCm',
  'legs.insetCm',
];

function readField(input: FurnitureInput, field: FurnitureField): number | undefined {
  switch (field) {
    case 'legs.heightCm':
      return input.legs?.heightCm;
    case 'legs.insetCm':
      return input.legs?.insetCm;
    default: {
      const value = (input as unknown as Record<string, unknown>)[field];
      return typeof value === 'number' ? value : undefined;
    }
  }
}

/** Which of a given listing's fields actually carry a number, in a fixed order. */
export function perturbableFields(input: FurnitureInput): readonly FurnitureField[] {
  return PERTURBABLE.filter((field) => readField(input, field) !== undefined);
}

/**
 * One field moved by `deltaCm`, everything else left alone.
 *
 * One field at a time rather than the Cartesian product: with nine fields and
 * five offsets the product is 1.9 million listings per sofa, and the extra
 * coverage is mostly combinations no shop would produce. What one-at-a-time
 * does buy is attribution — every break names the single field that caused it,
 * which is what picks the tolerance.
 */
export function perturbed(
  input: FurnitureInput,
  field: FurnitureField,
  deltaCm: number,
): FurnitureInput {
  const current = readField(input, field);
  if (current === undefined) return input;
  const next = current + deltaCm;

  if (field === 'legs.heightCm' || field === 'legs.insetCm') {
    const key = field === 'legs.heightCm' ? 'heightCm' : 'insetCm';
    return { ...input, legs: { ...input.legs!, [key]: next } };
  }
  return { ...input, [field]: next };
}
