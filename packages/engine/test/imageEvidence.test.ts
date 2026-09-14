import { describe, expect, it } from 'vitest';
import type { Item } from '../src/types.ts';
import type { ClassifiedImage, ImageClassification } from '../src/sourcing/imageEvidence.ts';
import {
  IMAGE_MEASUREMENT_TOLERANCE_CM,
  measureLegsFromImages,
  withImageEvidence,
} from '../src/sourcing/imageEvidence.ts';
import { buildFurnitureModel } from '../src/sourcing/furnitureModel.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import {
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  RECLINER_2_SEAT,
  SLIM_ARM_2_SEAT,
  SOFA_BED,
} from '../src/fixtures/sofas.ts';
import { renderElevation, trueLegBand, type Elevation } from './support/rasterise.ts';
import { LISTINGS } from './support/publishedListings.ts';
import { alignedTo } from './support/occupancy.ts';
import { uncontainedRegions } from './support/exactContainment.ts';

/**
 * The image stage, against the only ground truth this repository has.
 *
 * The six fixtures are the sofas whose real geometry is known exactly, so the
 * honest test of "does the silhouette recover the leg band" is to draw a fixture,
 * measure the drawing, and compare the answer against the boxes it was drawn
 * from. The renders are better images than any shop supplies — orthographic,
 * evenly lit, hard-edged — so what this measures is the quantisation floor, and
 * `IMAGE_MEASUREMENT_TOLERANCE_CM` records which terms it cannot reach.
 */

const elevation = (item: Item, shot: Elevation, pixelsAcross: number, edgeSoftnessPx: number): ClassifiedImage => ({
  bitmap: renderElevation(item, shot, { pixelsAcross, edgeSoftnessPx }),
  classification: {
    shot: shot === 'front' ? 'front-elevation' : 'side-elevation',
    legs: 'unknown',
    armrests: 'unknown',
    shape: 'straight',
  },
});

const dimsOf = (listingId: string) => {
  const published = LISTINGS.find((entry) => entry.published.id === listingId)!.published;
  return {
    overallWidthCm: published.overallWidthCm,
    overallDepthCm: published.overallDepthCm,
    overallHeightCm: published.overallHeightCm,
  };
};

/** Every render setting the validation sweeps, as a deterministic enumeration. */
const RESOLUTIONS = [300, 600, 1200];
const SOFTNESS = [0, 1, 2];

describe('image evidence: measured against the fixtures own elevations', () => {
  const truth = trueLegBand(SOFA_3_SEAT)!;
  const published = dimsOf('sofa-3-seat');

  interface Sample {
    pixelsAcross: number;
    edgeSoftnessPx: number;
    heightCm: number;
    insetCm: number;
  }

  const samples: Sample[] = [];
  for (const pixelsAcross of RESOLUTIONS) {
    for (const edgeSoftnessPx of SOFTNESS) {
      const measured = measureLegsFromImages(
        [
          elevation(SOFA_3_SEAT, 'front', pixelsAcross, edgeSoftnessPx),
          elevation(SOFA_3_SEAT, 'side', pixelsAcross, edgeSoftnessPx),
        ],
        published,
      );
      samples.push({
        pixelsAcross,
        edgeSoftnessPx,
        heightCm: measured.legs!.heightCm!,
        insetCm: measured.legs!.insetCm!,
      });
    }
  }

  /** The fixture's own boxes: legs 15 cm tall, 6 cm in across, 3.5 cm in deep. */
  it('knows what it is being compared against', () => {
    expect(truth).toEqual({ heightCm: 15, insetXCm: 6, insetYCm: 3.5 });
  });

  /**
   * **Every error runs the safe way, at every setting.**
   *
   * A measured leg height below the truth isolates a shorter band than the sofa
   * really has; a measured inset below the truth claims less clearance than the
   * legs really leave. Both leave material in place. The reason it comes out
   * this way is the thresholding: a soft edge spreads the dark item outward, so
   * a blurred leg reads *wider*, and a wider leg is a smaller inset.
   *
   * This is measured across the sweep rather than claimed as a guarantee — but
   * if it ever stops holding, an image is carving material that is really there
   * and that is the failure this subsystem exists to prevent.
   */
  it.each(samples.map((s) => [`${s.pixelsAcross}px soft ${s.edgeSoftnessPx}`, s] as const))(
    'never over-measures the band at %s',
    (_label, sample) => {
      expect(sample.heightCm).toBeLessThanOrEqual(truth.heightCm + 0.05);
      expect(sample.insetCm).toBeLessThanOrEqual(Math.min(truth.insetXCm, truth.insetYCm) + 0.05);
    },
  );

  /**
   * The measured error, pinned. This is the number the tolerance is read off.
   *
   * Worst across the whole sweep: 0.83 cm on the leg height and 0.93 cm on the
   * inset, both at the coarsest resolution with the softest edge. At 1200 px
   * with a hard edge it is a fiftieth of a centimetre.
   */
  it('lands within a centimetre on a perfect render, at every resolution and softness', () => {
    const worstHeight = Math.max(...samples.map((s) => Math.abs(s.heightCm - truth.heightCm)));
    const worstInset = Math.max(
      ...samples.map((s) => Math.abs(s.insetCm - Math.min(truth.insetXCm, truth.insetYCm))),
    );

    expect(worstHeight).toBeLessThan(1);
    expect(worstInset).toBeLessThan(1);
    // ...and the shipped tolerance is comfortably above that floor, because the
    // floor is not the error a real photograph carries.
    expect(IMAGE_MEASUREMENT_TOLERANCE_CM).toBeGreaterThan(worstHeight * 3);
    expect(IMAGE_MEASUREMENT_TOLERANCE_CM).toBe(3);
  });

  /**
   * **The negative result, which matters as much as the positive one.**
   *
   * Five of the six fixtures stand on a plinth or a solid base, not on legs, and
   * on all five the measurement has to come back with nothing. A silhouette
   * analyser that invents a leg band under a sofa bed would carve a hole in the
   * one fixture that has no hollow anywhere in it.
   */
  it.each([
    ['slim-arm-2-seat', SLIM_ARM_2_SEAT],
    ['corner-sofa', CORNER_SOFA],
    ['deep-seat-lounge', DEEP_SEAT_LOUNGE],
    ['recliner-2-seat', RECLINER_2_SEAT],
    ['sofa-bed', SOFA_BED],
  ] as const)('finds no leg band under %s, which has none', (id, item) => {
    expect(trueLegBand(item)).toBeUndefined();

    const measured = measureLegsFromImages(
      [elevation(item, 'front', 600, 0), elevation(item, 'side', 600, 0)],
      dimsOf(id),
    );

    expect(measured.legs).toBeUndefined();
    expect(measured.rejections.map((rejection) => rejection.reason)).toEqual(['no-leg-band', 'no-leg-band']);
  });
});

describe('image evidence: what it refuses', () => {
  const published = dimsOf('sofa-3-seat');
  const classify = (overrides: Partial<ImageClassification>): ImageClassification => ({
    shot: 'front-elevation',
    legs: 'unknown',
    armrests: 'unknown',
    shape: 'straight',
    ...overrides,
  });

  /**
   * A three-quarter shot is refused, not unwarped.
   *
   * Correcting one means recovering a camera pose from a sofa, and a pose
   * recovered badly does not fail loudly — it returns a leg band a few
   * centimetres short and says nothing. Every number here is a fraction of the
   * silhouette, and a shot with perspective in it has no single scale for those
   * fractions to be of.
   */
  it.each(['three-quarter', 'plan', 'detail', 'unusable'] as const)('refuses a %s outright', (shot) => {
    const measured = measureLegsFromImages(
      [{ bitmap: renderElevation(SOFA_3_SEAT, 'front', { pixelsAcross: 400 }), classification: classify({ shot }) }],
      published,
    );

    expect(measured.legs).toBeUndefined();
    expect(measured.rejections[0]!.reason).toBe('not-an-elevation');
    expect(measured.rejections[0]!.en).toMatch(/perspective/);
  });

  /**
   * **One elevation gives the height. It does not give the inset.**
   *
   * A front view proves how far the legs stand in from the ends and says nothing
   * about how far they stand in from the front and back, while the model applies
   * one `insetCm` to both plan axes. This fixture is the case in point: 6 cm in
   * across, 3.5 cm in deep. A front view alone would hand over 6 and the model
   * would carve 6 off an axis that has 3.5.
   */
  it('reports a height from one elevation but withholds the inset', () => {
    const frontOnly = measureLegsFromImages([elevation(SOFA_3_SEAT, 'front', 600, 0)], published);

    expect(frontOnly.legs?.heightCm).toBeCloseTo(15, 1);
    expect(frontOnly.legs?.insetCm).toBeUndefined();
    expect(frontOnly.rejections.map((r) => r.reason)).toContain('inset-needs-both-elevations');
  });

  /** With both, the smaller inset wins, which is the only sound way to collapse two into one. */
  it('takes the tighter of the two axes when both elevations are there', () => {
    const both = measureLegsFromImages(
      [elevation(SOFA_3_SEAT, 'front', 1200, 0), elevation(SOFA_3_SEAT, 'side', 1200, 0)],
      published,
    );

    // 3.5 deep is tighter than 6 across, so 3.5 is the claim.
    expect(both.legs!.insetCm!).toBeLessThanOrEqual(3.5);
    expect(both.legs!.insetCm!).toBeGreaterThan(3);
  });

  it('says so when the classifier reports no legs', () => {
    const measured = measureLegsFromImages(
      [{ bitmap: renderElevation(SOFA_3_SEAT, 'front', {}), classification: classify({ legs: 'none' }) }],
      published,
    );

    expect(measured.legs).toBeUndefined();
    expect(measured.rejections[0]!.reason).toBe('legs-said-absent');
  });
});

describe('image evidence: merging into a listing', () => {
  const published = dimsOf('sofa-3-seat');
  const listing = LISTINGS[0]!.published;
  const evidence = measureLegsFromImages(
    [elevation(SOFA_3_SEAT, 'front', 1200, 0), elevation(SOFA_3_SEAT, 'side', 1200, 0)],
    published,
  );

  /**
   * An image fills gaps. It does not overrule a shop.
   *
   * A published leg height was measured on the object with a tape; a proportion
   * read off a photograph is not better evidence than that. What the image is
   * for is `legs.insetCm`, which no retailer publishes at all — and which the
   * ground-truth table names as the single largest remaining gap on the one
   * legged fixture in the catalogue.
   */
  it('keeps the published height and contributes only the inset', () => {
    const merged = withImageEvidence(listing, evidence);

    expect(merged.legs!.heightCm).toBe(15);
    expect(merged.fieldSources!['legs.heightCm']).toBeUndefined();
    expect(merged.legs!.insetCm).toBeGreaterThan(3);
    expect(merged.fieldSources!['legs.insetCm']).toBe('image-derived');
  });

  /** An image-derived number goes through the same machinery as any other. */
  it('lands in the model tagged derived, carrying the image tolerance', () => {
    const model = buildFurnitureModel(withImageEvidence(listing, evidence));
    const inset = model.measurements.find((entry) => entry.field === 'legs.insetCm')!;

    expect(inset.provenance).toBe('derived');
    expect(inset.source).toBe('image-derived');
    expect(inset.toleranceCm).toBe(IMAGE_MEASUREMENT_TOLERANCE_CM);
    expect(model.tolerance.byField['legs.insetCm']).toBe(IMAGE_MEASUREMENT_TOLERANCE_CM);
  });

  /**
   * **And it must not break containment.**
   *
   * The whole point of the image stage is to unlock a carve, and a carve is
   * where this subsystem can hurt someone. The measured inset, put through the
   * tolerance machinery, still has to leave a model that holds every cubic
   * centimetre of the real sofa.
   */
  it('still contains the fixture exactly once the carve it unlocks is made', () => {
    const withImage = buildFurnitureModel(withImageEvidence(listing, evidence));
    const leaks = uncontainedRegions(SOFA_3_SEAT, alignedTo(withImage.item, SOFA_3_SEAT));

    expect(leaks).toEqual([]);
  });

  /**
   * What the image actually bought, as a number.
   *
   * The inset is 3.5 cm and the tolerance is 3, so what survives is a half
   * centimetre of provable clearance — enough to isolate the band and name it,
   * not enough to carve much. That is an honest result rather than a
   * disappointing one: the field that would carve properly here is a leg inset
   * measured with a tape, and the image is a floor under it rather than a
   * replacement for it.
   */
  it('reports how much carve the measured inset survives the tolerance to deliver', () => {
    const without = buildFurnitureModel(listing);
    const withImage = buildFurnitureModel(withImageEvidence(listing, evidence));

    const underSeat = (model: typeof without): number =>
      model.carves.filter((carve) => carve.region === 'under-seat').reduce((sum, c) => sum + c.volumeCm3, 0);

    // The listing alone publishes no inset, so the band is named but solid.
    expect(underSeat(without)).toBe(0);
    // The image supplies one, and a carve appears where there was none.
    expect(underSeat(withImage)).toBeGreaterThan(0);
    expect(withImage.carvedVolumeCm3).toBeGreaterThan(without.carvedVolumeCm3);

    // But only a sliver of it: a measured 3.5 cm inset less 3 cm of image
    // tolerance leaves half a centimetre of provable clearance. That is an
    // honest result rather than a disappointing one — the band is isolated and
    // named either way, which is what makes "take the legs off" a legal
    // suggestion, and the field that would carve properly here is a leg inset
    // someone measured with a tape. The image is a floor under that, not a
    // replacement for it.
    expect(underSeat(withImage)).toBeLessThan(underSeat(without) + 40_000);
    expect(withImage.item.boxes.some((box) => box.label === 'the legs')).toBe(true);
  });
});
