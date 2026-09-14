import { describe, expect, it } from 'vitest';
import type { Item } from '../src/types.ts';
import type { FurnitureInput, FurnitureModelResult } from '../src/sourcing/types.ts';
import { buildFurnitureModel } from '../src/sourcing/furnitureModel.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import {
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  RECLINER_2_SEAT,
  SLIM_ARM_2_SEAT,
  SOFA_BED,
} from '../src/fixtures/sofas.ts';
import { LISTINGS } from './support/publishedListings.ts';
import { alignedTo, compareOccupancy, itemAabb, surplusByRegion, type Comparison } from './support/occupancy.ts';
import { describeLeak, uncontainedRegions, type Uncontained } from './support/exactContainment.ts';

interface Row {
  id: string;
  note: string;
  model: FurnitureModelResult;
  comparison: Comparison;
  /** Fraction of the produced model that is real material, 0..1. Higher is tighter. */
  tightness: number;
  /** What the bounding box alone would have scored, for the "was this worth it" column. */
  boundingTightness: number;
  gapField: string;
  /** Where the model is still too solid, largest region first. Sampled, descriptive. */
  surplus: readonly { region: string; volumeCm3: number }[];
  /** Exactly computed: every region of the fixture that escapes the model. Must be empty. */
  leaks: readonly Uncontained[];
}

/**
 * Name the part of the model a surplus point sits in.
 *
 * The improvement list answers "what should the shop publish next" out of the
 * fields this contract knows about. When that list empties, the model is still
 * not the sofa, and this says where the remainder is — which is the question
 * "which single field would close the gap" actually asking for a field the
 * contract does not have yet.
 */
function regionNamer(published: FurnitureInput, fixture: Item): (p: { x: number; y: number; z: number }) => string {
  const bounds = itemAabb(fixture);
  const legTop = bounds.min.z + (published.legs?.present === true ? (published.legs.heightCm ?? 0) : 0);
  const seatTop = bounds.min.z + (published.seatHeightCm ?? published.overallHeightCm);
  const backFaceY =
    published.seatDepthCm === undefined ? bounds.max.y : bounds.min.y + published.seatDepthCm;

  return (p) => {
    if (p.z < legTop) return 'under the seat, between the legs';
    if (p.z < seatTop) return p.y < backFaceY ? 'inside the seat body' : 'the rear underside';
    return p.y < backFaceY ? 'around the armrests' : 'the backrest band';
  };
}

/**
 * Every comparison, computed once.
 *
 * It is a few million point-in-box tests, so it runs at module scope and the
 * assertions below read the results rather than recomputing them.
 */
/**
 * "Every number is exact", stated the only way the pipeline accepts it.
 *
 * `toleranceCm: 0` alone will not do it: the roundness floor still lifts any
 * value sitting on a multiple of five, and most of these do. Only an explicit
 * per-field override outranks the floor.
 */
const NO_SLACK: Readonly<Record<string, number>> = {
  overallWidthCm: 0,
  overallDepthCm: 0,
  overallHeightCm: 0,
  seatHeightCm: 0,
  seatDepthCm: 0,
  armrestHeightCm: 0,
  armrestWidthCm: 0,
  backrestThicknessCm: 0,
  'legs.heightCm': 0,
  'legs.insetCm': 0,
};

function rowsAt(overrides: Partial<FurnitureInput>): readonly Row[] {
  return LISTINGS.map(({ fixture, published, note }) => {
  const model = buildFurnitureModel({ ...published, ...overrides });
  const aligned = alignedTo(model.item, fixture);
  return {
    id: published.id!,
    note,
    model,
    // Exact. This is the safety check.
    leaks: uncontainedRegions(fixture, aligned),
    // Sampled. These are the table's numbers, and nothing depends on them.
    comparison: compareOccupancy(aligned, fixture),
    surplus: surplusByRegion(aligned, fixture, regionNamer(published, fixture)),
    tightness: 0,
    boundingTightness: 0,
    gapField: model.improvements[0]?.field ?? 'none — every field this pipeline reads is present',
  };
  }).map((row) => ({
    ...row,
    tightness: row.comparison.referenceCm3 / row.comparison.candidateCm3,
    boundingTightness: row.comparison.referenceCm3 / row.comparison.boundingCm3,
  }));
}

/**
 * The catalogue as the pipeline actually builds it, at the default tolerance.
 *
 * `EXACT` is the same six with the published numbers taken literally. Both are
 * kept because the pair is the answer to "what does safety cost": the gap
 * between them is what two centimetres of doubt about a shop's rounding is
 * worth, and it is smaller than it looks from the rule alone.
 */
const ROWS: readonly Row[] = rowsAt({});
const EXACT: readonly Row[] = rowsAt({
  toleranceCm: 0,
  overallToleranceCm: 0,
  fieldToleranceCm: NO_SLACK,
});

describe('buildFurnitureModel against the six hand-authored fixtures', () => {
  /**
   * **The conservative-direction test. The one that must never go green by luck.**
   *
   * For every fixture, every cubic centimetre of the hand-authored sofa has to
   * be inside the model built from its listing. Not "roughly", not "within a
   * tolerance" — a single missing voxel is a hole in the model where the real
   * sofa has material, and a hole is exactly how a planner comes to answer "it
   * fits" about something that does not.
   *
   * It is computed exactly, by `uncontainedRegions` — no sampling anywhere near
   * it. A grid cannot answer this soundly: a cell counts as occupied when
   * anything touches it, on both sides, so real material at one corner and model
   * material at the opposite corner both register and a genuine leak passes. The
   * error would run in the fatal direction, which is the one direction this
   * subsystem exists to rule out.
   *
   * Containment is also the stronger claim than the volume comparison the brief
   * asks for: two shapes can have the right volumes and still be in the wrong
   * places. The volumes are in the table below, and nothing rests on them.
   */
  it.each(ROWS.map((row) => [row.id, row.note, row] as const))(
    'produces a model that contains all of %s — %s',
    (_id, _note, row) => {
      expect(row.leaks.map(describeLeak)).toEqual([]);
    },
  );

  /**
   * And with the numbers taken literally, too.
   *
   * The listings above are idealised readings of the fixtures, so this is the
   * easy case — tolerance is what covers the listings a shop really writes, and
   * `furnitureModelTolerance.test.ts` is where that is measured. Containment has
   * to hold in both, or the tolerance would be papering over a rule that was
   * already wrong on perfect input.
   */
  it.each(EXACT.map((row) => [row.id, row] as const))(
    'contains all of %s at zero tolerance as well',
    (_id, row) => {
      expect(row.leaks.map(describeLeak)).toEqual([]);
    },
  );

  /**
   * The per-fixture table, pinned.
   *
   * `tightness` is how much of the produced model is real material: 1.00 would
   * mean the listing reproduced the fixture exactly, and the bounding-box column
   * is what the same sofa scores with the three dimensions alone. The gap
   * between the two columns is the entire value of this subsystem, and the
   * `gapField` column is what it would take to close the rest.
   *
   * Columns are at the default tolerance, with the zero-slack tightness beside
   * them so the cost of the margin is visible in the same row.
   *
   * **Every column comes from one method: the sampled grid in
   * `support/occupancy.ts`, at 2 cm or finer.** That includes the bounding-box
   * column, so `box - carved` equals `model` on every row by construction and
   * no two columns can be compared across a change of units. The grid tiles each
   * bounding box exactly, so the box column also equals width x depth x height
   * arithmetically — the two methods agree there, which is the only place they
   * can be made to.
   *
   * The figures move only when a rule changes, which is the point of pinning them.
   */
  it.each([
    // id,          tightness at defaults, at zero slack, bounding box, ask for, largest residual
    ['sofa-3-seat', 0.552, 0.661, 0.445, 'legs.insetCm', 'under the seat, between the legs'],
    ['slim-arm-2-seat', 0.585, 0.820, 0.422, 'none', 'around the armrests'],
    ['corner-sofa', 0.350, 0.389, 0.350, 'returnLegDimensions', 'the backrest band'],
    ['deep-seat-lounge', 0.767, 0.976, 0.619, 'none', 'around the armrests'],
    ['recliner-2-seat', 0.672, 0.889, 0.478, 'none', 'around the armrests'],
    ['sofa-bed', 0.780, 0.996, 0.639, 'none', 'around the armrests'],
  ] as const)(
    'lands %s at the pinned tightness',
    (id, tightness, exactTightness, boundingTightness, gapField, residual) => {
      const row = ROWS.find((candidate) => candidate.id === id)!;
      const exact = EXACT.find((candidate) => candidate.id === id)!;

      expect(row.tightness).toBeCloseTo(tightness, 2);
      expect(exact.tightness).toBeCloseTo(exactTightness, 2);
      expect(row.boundingTightness).toBeCloseTo(boundingTightness, 2);
      expect(row.gapField.startsWith(gapField)).toBe(true);
      expect(row.surplus[0]?.region ?? 'none').toBe(residual);

      // Slack costs tightness and never buys any: the model can only get fatter.
      expect(row.tightness).toBeLessThanOrEqual(exact.tightness);
      // ...and it never costs so much that the carving stops being worth doing.
      expect(row.tightness).toBeGreaterThanOrEqual(row.boundingTightness);
    },
  );

  /**
   * What safety costs, as one number.
   *
   * Five centimetres of doubt about every published field, plus two centimetres
   * of growth on the skin, gives back about a seventh of the carved volume and
   * leaves the catalogue an eighth fatter overall. It does not destroy the
   * carving value: the recliner still loses 615 of its 2048 litres to proven
   * air, and every straight sofa still comes out well inside its own bounding
   * box. Had this come out the other way — a safe margin that carved almost
   * nothing — the honest conclusion would have been that the subsystem needs
   * better input rather than a smaller margin, and this is the assertion that
   * would have said so.
   */
  it('keeps most of the carve while surviving listings that are wrong', () => {
    const carvedAtDefault = ROWS.reduce((sum, row) => sum + row.comparison.carvedCm3, 0);
    const carvedExact = EXACT.reduce((sum, row) => sum + row.comparison.carvedCm3, 0);
    const modelAtDefault = ROWS.reduce((sum, row) => sum + row.comparison.candidateCm3, 0);
    const modelExact = EXACT.reduce((sum, row) => sum + row.comparison.candidateCm3, 0);

    expect(carvedAtDefault).toBeLessThan(carvedExact);
    // At least six sevenths of the carve survives the margins.
    expect(carvedAtDefault / carvedExact).toBeGreaterThan(0.85);
    // And the catalogue is no more than a fifth fatter for it. It was an eighth
    // when the skin grew a flat two centimetres; making that growth honour the
    // same roundness rule the carves use is most of the difference, and is
    // measured in the sweep rather than argued about.
    expect(modelAtDefault / modelExact).toBeLessThan(1.22);
    // Still far more carved than the bounding box would manage, which is none.
    expect(carvedAtDefault).toBeGreaterThan(2_000_000);
  });

  /**
   * A model built from a listing has to be worth building.
   *
   * Every straight sofa in the catalogue must come out strictly tighter than its
   * own bounding box — otherwise the carving rules earned nothing and the
   * subsystem is just an expensive way to multiply three numbers. The corner
   * sofa is exempt and says so: it *is* its bounding box, on purpose.
   */
  it.each(ROWS.filter((row) => row.model.confidence !== 'bounding-box-only').map((row) => [row.id, row] as const))(
    'beats the bare bounding box on %s',
    (_id, row) => {
      expect(row.tightness).toBeGreaterThan(row.boundingTightness);
      expect(row.model.carvedVolumeCm3).toBeGreaterThan(0);
    },
  );

  it('leaves the corner sofa as its bounding box, loudly', () => {
    const row = ROWS.find((candidate) => candidate.id === 'corner-sofa')!;

    expect(row.model.confidence).toBe('bounding-box-only');
    expect(row.model.item.boxes).toHaveLength(1);
    expect(row.model.flags.map((flag) => flag.code)).toContain('l-shape-not-modelled');
    // Sound, and that is all it is: the bounding box holds the whole sofa with
    // most of its volume to spare.
    expect(row.leaks).toEqual([]);
    expect(row.tightness).toBeLessThan(0.5);
  });

  /** The fixtures are ground truth. Nothing in this pipeline may have touched them. */
  it('leaves the hand-authored fixtures untouched', () => {
    expect(SOFA_3_SEAT.boxes).toHaveLength(8);
    expect(SOFA_3_SEAT.removableParts).toEqual([{ name: 'legs', nameHe: 'הרגליים', boxIndices: [4, 5, 6, 7] }]);
    expect(SLIM_ARM_2_SEAT.boxes).toHaveLength(5);
    expect(CORNER_SOFA.boxes).toHaveLength(7);
    expect(DEEP_SEAT_LOUNGE.boxes).toHaveLength(5);
    expect(RECLINER_2_SEAT.boxes).toHaveLength(6);
    expect(SOFA_BED.boxes).toHaveLength(5);
  });

  /**
   * The table, printed.
   *
   * Not an assertion — the assertions are above. This is the artefact the brief
   * asks for, written where whoever changes a rule will see what it did.
   */
  it('reports the comparison table', () => {
    const exactOf = (id: string): Row => EXACT.find((row) => row.id === id)!;
    const lines = ROWS.map((row) =>
      [
        row.id.padEnd(18),
        `real ${Math.round(row.comparison.referenceCm3 / 1000)
          .toString()
          .padStart(4)}L`,
        `model ${Math.round(row.comparison.candidateCm3 / 1000)
          .toString()
          .padStart(4)}L`,
        `box ${Math.round(row.comparison.boundingCm3 / 1000)
          .toString()
          .padStart(4)}L`,
        `carved ${Math.round(row.comparison.carvedCm3 / 1000)
          .toString()
          .padStart(4)}L`,
        `tight ${(row.tightness * 100).toFixed(1).padStart(5)}%`,
        `(exact ${(exactOf(row.id).tightness * 100).toFixed(1).padStart(5)}%)`,
        `(box ${(row.boundingTightness * 100).toFixed(1).padStart(5)}%)`,
        row.model.confidence.padEnd(18),
        `ask for: ${row.gapField}`,
        `| residual: ${row.surplus
          .slice(0, 2)
          .map((entry) => `${entry.region} ${Math.round(entry.volumeCm3 / 1000)}L`)
          .join(', ')}`,
      ].join('  '),
    );
    // eslint-disable-next-line no-console
    console.log(['', 'ground truth vs published listings:', ...lines, ''].join('\n'));

    expect(lines).toHaveLength(6);
  });
});
