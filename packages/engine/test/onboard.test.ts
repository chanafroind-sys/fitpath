import { describe, expect, it } from 'vitest';
import type { FurnitureInput } from '../src/sourcing/types.ts';
import type { ItemReport } from '../src/maneuvers/report.ts';
import { onboardBatch, onboardItem } from '../src/sourcing/onboard.ts';
import { measureLegsFromImages, withImageEvidence } from '../src/sourcing/imageEvidence.ts';
import { buildFurnitureModel } from '../src/sourcing/furnitureModel.ts';
import { renderElevation } from './support/rasterise.ts';
import { reportOn } from '../src/maneuvers/report.ts';
import { FURNITURE_PIPELINE_VERSION } from '../src/sourcing/furnitureModel.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import { CORNER_SOFA } from '../src/fixtures/sofas.ts';
import { LISTINGS } from './support/publishedListings.ts';

/**
 * The chain, end to end, measured in the unit a shopper actually experiences.
 *
 * Volume percentages were the wrong currency. A model 21% fatter than the real
 * sofa sounds alarming and may cost nothing at all at the doorway, because what
 * a doorway cares about is one section through one plane. So the question this
 * file asks is the only one that matters commercially: how many centimetres
 * wider a doorway does a model built from published dimensions demand than one
 * built from the hand-authored truth?
 */

const WALL = 15;

/** The best requirement any validated maneuver achieved, for comparing the whole shape. */
function bestRequirement(report: ItemReport) {
  const valid = report.maneuvers.filter((line) => line.valid && line.requirement !== undefined);
  if (valid.length === 0) return undefined;
  return valid.reduce((a, b) => (a.requirement!.doorWidth <= b.requirement!.doorWidth ? a : b)).requirement!;
}

describe('the chain: published dimensions to maneuver library', () => {
  /**
   * **The number this whole subsystem is judged by.**
   *
   * Five of the six catalogue sofas come out of the sourcing pipeline needing
   * *exactly* the doorway the hand-authored fixture needs. Not approximately:
   * the same figure to the hundredth, from the same maneuvers.
   *
   * The Vetle is the exception and costs 2.21 cm, and the reason is legible.
   * Its backrest leans ten degrees, which lets the hand-authored fixture tip
   * through a 77.79 cm doorway; nothing a shop publishes describes a rake, so
   * the model stands the back up straight and pays the difference. That is the
   * honest price of sourcing from published data, and it is 2.21 cm on one sofa
   * in six rather than the 21% of volume the earlier tables implied.
   */
  it.each([
    ['sofa-3-seat', 0],
    ['slim-arm-2-seat', 2.21],
    ['corner-sofa', 0],
    ['deep-seat-lounge', 0],
    ['recliner-2-seat', 0],
    ['sofa-bed', 0],
  ])('costs %s cm of doorway to source from published data: %s', (id, expectedDeltaCm) => {
    const listing = LISTINGS.find((entry) => entry.published.id === id)!;
    const hand = reportOn(listing.fixture, WALL);
    const generated = onboardItem(listing.published, { wallThicknessCm: WALL });

    expect(hand.narrowest).toBeDefined();
    expect(generated.assembled.need.narrowestCm).toBeDefined();
    expect(generated.assembled.need.narrowestCm! - hand.narrowest!).toBeCloseTo(expectedDeltaCm, 2);
  });

  /**
   * And it loses no maneuvers.
   *
   * A narrower figure reached by fewer routes would be a worse library even at
   * the same number: every maneuver is a way a person might actually get the
   * thing in, and the report names them. The generated model validates exactly
   * the same three on every fixture.
   */
  it.each(LISTINGS.map((entry) => [entry.published.id!, entry] as const))(
    'validates the same maneuvers as the hand-authored %s',
    (_id, entry) => {
      const hand = reportOn(entry.fixture, WALL).maneuvers.filter((line) => line.valid).map((line) => line.templateId);
      const generated = onboardItem(entry.published, { wallThicknessCm: WALL }).assembled.need.maneuvers;

      expect([...generated].sort()).toEqual([...hand].sort());
    },
  );
});

describe('the chain: a corner sofa described as parts', () => {
  const asBoundingBox = LISTINGS.find((entry) => entry.published.id === 'corner-sofa')!.published;

  /** The same sofa as the shop sells it: a run, and a right-facing chaise that unbolts. */
  const asParts: FurnitureInput = {
    id: 'corner-sofa',
    name: 'Rosendal corner sofa',
    parts: [
      {
        id: 'main-run',
        name: 'main run',
        separates: true,
        overallWidthCm: 280,
        overallDepthCm: 95,
        overallHeightCm: 85,
        seatHeightCm: 46,
        seatDepthCm: 70,
        armrests: 'present',
        armrestWidthCm: 4,
        armrestHeightCm: 65,
        legs: { present: false },
        shape: 'straight',
      },
      {
        id: 'chaise',
        name: 'chaise return',
        separates: true,
        attachment: { to: 'main-run', side: 'right' },
        overallWidthCm: 95,
        overallDepthCm: 105,
        overallHeightCm: 85,
        seatHeightCm: 46,
        seatDepthCm: 70,
        armrests: 'present',
        armrestWidthCm: 4,
        armrestHeightCm: 65,
        legs: { present: false },
        shape: 'straight',
      },
    ],
  };

  /** Two limbs at right angles, occupying exactly the footprint the fixture does. */
  it('assembles to the fixture bounding box without anyone stating it', () => {
    const model = onboardItem(asParts).model;

    expect(model.boundingBox).toEqual({ widthCm: 280, depthCm: 200, heightCm: 85 });
    expect(model.parts.map((part) => part.id)).toEqual(['main-run', 'chaise']);
    expect(model.flags.map((flag) => flag.code)).not.toContain('l-shape-not-modelled');
  });

  /**
   * **What describing the parts is worth, measured.**
   *
   * Not the doorway *width*: 85 cm either way, and that is why the bounding-box
   * corner sofa has seemed to work fine all along. The width is set by the
   * sofa's 85 cm height in every description — the item goes through on its
   * side — so the L-shape never enters that number.
   *
   * It is worth everything in the other three. The assembled body wants a
   * doorway 200 cm tall and 282 cm of hallway to turn in; the chaise on its own
   * wants 107 cm of height and 97 cm of hallway. That is the difference between
   * "needs a clear 2.8 m run at the door" and "carry it round the corner", and
   * no volume percentage would have shown it.
   */
  it('changes the height and the hallway, not the width', () => {
    const assembled = bestRequirement(onboardItem(asParts).assembled.report)!;
    const modules = onboardItem(asParts).perPart!.map((part) => bestRequirement(part.report)!);

    expect(assembled.doorWidth).toBeCloseTo(85.0, 1);
    expect(assembled.doorHeight).toBeCloseTo(200, 0);
    expect(assembled.hallwayClearance).toBeCloseTo(282, 0);

    // Module by module, every one of those three collapses.
    expect(Math.max(...modules.map((r) => r.doorWidth))).toBeCloseTo(85.0, 1);
    expect(Math.max(...modules.map((r) => r.doorHeight))).toBeLessThan(110);
    expect(Math.min(...modules.map((r) => r.hallwayClearance))).toBeLessThan(100);
  });

  /** The bounding box and the parts description agree on the assembled figure. */
  it('gives the same assembled answer as the bounding box did', () => {
    const box = onboardItem(asBoundingBox).assembled.need.narrowestCm!;
    const parts = onboardItem(asParts).assembled.need.narrowestCm!;
    const hand = reportOn(CORNER_SOFA, WALL).narrowest!;

    expect(parts).toBeCloseTo(box, 2);
    expect(parts).toBeCloseTo(hand, 2);
  });

  /**
   * **`separates` is the largest single field in the contract.**
   *
   * Identical dimensions, identical arrangement, one boolean apart. Known to
   * unbolt, the answer is two ordinary carries. Not known, the body crosses the
   * doorway whole — and `'unknown'` is treated as *not*, because printing the
   * easier number beside a sofa that turns out to be welded is the one failure
   * this system is built never to produce.
   */
  it.each([
    [true, true],
    [false, false],
    ['unknown' as const, false],
  ])('offers a per-part carry only when every part separates (%s)', (separates, expected) => {
    const item = onboardItem({
      ...asParts,
      parts: asParts.parts!.map((part) => ({ ...part, separates })),
    });

    expect(item.model.separable).toBe(expected);
    expect(item.perPart !== undefined).toBe(expected);
    if (!expected) {
      expect(item.model.flags.map((flag) => flag.code)).toContain('assembled-rigid');
    }
  });

  it('refuses an arrangement nobody sells rather than approximating it', () => {
    expect(() =>
      onboardItem({
        ...asParts,
        parts: [
          asParts.parts![0]!,
          asParts.parts![1]!,
          { ...asParts.parts![1]!, id: 'third', attachment: { to: 'chaise', side: 'right' } },
        ],
      }),
    ).toThrow(/itself attached/);
  });
});

describe('onboarding a list', () => {
  const inputs: FurnitureInput[] = LISTINGS.map((entry) => entry.published);

  it('produces a model and a library for every item, and records the version', () => {
    const batch = onboardBatch(inputs, { wallThicknessCm: WALL });

    expect(batch.items).toHaveLength(6);
    expect(batch.failed).toEqual([]);
    expect(batch.pipelineVersion).toBe(FURNITURE_PIPELINE_VERSION);
    for (const item of batch.items) {
      expect(item.model.item.boxes.length).toBeGreaterThan(0);
      expect(item.assembled.need.maneuvers.length).toBeGreaterThan(0);
      expect(item.pipelineVersion).toBe(FURNITURE_PIPELINE_VERSION);
    }
  });

  /** Per item: what could not be settled, and the one field that would help most. */
  it('reports what it could not determine, item by item', () => {
    const batch = onboardBatch(inputs, { wallThicknessCm: WALL });
    const threeSeat = batch.items.find((item) => item.id === 'sofa-3-seat')!;

    expect(threeSeat.unresolved.some((line) => line.includes('legs.insetCm'))).toBe(true);
    expect(threeSeat.wouldMostImprove?.field).toBe('legs.insetCm');

    const corner = batch.items.find((item) => item.id === 'corner-sofa')!;
    expect(corner.wouldMostImprove?.field).toBe('returnLegDimensions');
  });

  /**
   * One bad listing is stepped over, not fatal.
   *
   * A catalogue import that dies on item 40 of 900 is not an import. The failure
   * is recorded against the id so somebody can go and fix that one row.
   */
  it('records a listing that throws and carries on', () => {
    const batch = onboardBatch([
      inputs[0]!,
      { id: 'broken', overallWidthCm: 0, overallDepthCm: 100, overallHeightCm: 70 },
      inputs[1]!,
    ]);

    expect(batch.items).toHaveLength(2);
    expect(batch.failed).toEqual([{ id: 'broken', message: expect.stringContaining('overallWidthCm') }]);
  });

  it('is deterministic', () => {
    const once = onboardBatch(inputs).items.map((item) => item.narrowestAnyRouteCm);
    const twice = onboardBatch(inputs).items.map((item) => item.narrowestAnyRouteCm);

    expect(once).toEqual(twice);
  });

  /** An ottoman ships alongside and gets its own carry, never fused into the body. */
  it('gives a piece that ships alongside its own doorway figure', () => {
    const item = onboardItem({
      id: 'koala',
      parts: [
        { id: 'body', separates: false, overallWidthCm: 300, overallDepthCm: 100, overallHeightCm: 70 },
        { id: 'ottoman', separates: true, overallWidthCm: 100, overallDepthCm: 100, overallHeightCm: 44 },
      ],
    });

    expect(item.shipsAlongside).toHaveLength(1);
    expect(item.shipsAlongside[0]!.need.narrowestCm).toBeDefined();
    expect(item.model.boundingBox).toEqual({ widthCm: 300, depthCm: 100, heightCm: 70 });
  });

  /** The hand-authored fixture is untouched by any of this. */
  it('leaves the fixtures alone', () => {
    expect(SOFA_3_SEAT.boxes).toHaveLength(8);
    expect(CORNER_SOFA.boxes).toHaveLength(7);
  });
});

describe('the chain: what the under-seat carve is worth', () => {
  /**
   * **A thread left open for three rounds, closed by a measurement.**
   *
   * The silhouette analyser extracts a leg inset accurately and had never been
   * shown to change an answer — and it was validated on a catalogue where five
   * of six sofas stand on a plinth. So: the one fixture with legs, modelled four
   * ways, from a solid leg band up to the fixture's own four posts, and the
   * narrowest doorway each needs.
   *
   *   A  listing, band solid, no inset            85.01   on-its-side
   *   B  + image-measured inset (3.48 - 3 tol)    85.01   on-its-side
   *   C  + operator inset 3.5, no tolerance       85.01   on-its-side
   *   D  hand-authored fixture, real four posts   85.01   on-its-side
   *
   * Zero. Not on the image path, not on a tape-measured inset, and not on the
   * real geometry either — D is the ceiling of what any leg measurement could
   * ever deliver, and it is the same 85.01 by the same maneuver. The doorway is
   * set by the sofa's 85 cm height, exactly as the corner sofa's was; it goes
   * through on its side and the legs never enter that number.
   *
   * Two things did move, and neither changes the answer. `seat-first` alone
   * needs 85.01 / 88.88 / 88.63 / 85.04 across A-D: the single-inset contract
   * models legs as one centred slab, and a centred slab tilts differently from
   * four corner posts, so it reads *worse* than either the solid band or the
   * truth — never the binding maneuver, so harmless, but a limit of the
   * contract worth knowing. And the real posts need 150 cm along the wall where
   * every generated variant needs 180: the value of true leg geometry is in
   * `alongWall`, and a single inset cannot carry it.
   *
   * The image path is parked on this. It is correct, measured, and changes
   * nothing a shopper can feel.
   */
  it('changes the narrowest doorway by 0.00 cm, all the way up to the real leg geometry', () => {
    const listing = LISTINGS[0]!.published;
    const dims = { overallWidthCm: 220, overallDepthCm: 95, overallHeightCm: 85 };
    const image = measureLegsFromImages(
      [
        {
          bitmap: renderElevation(SOFA_3_SEAT, 'front', { pixelsAcross: 1200 }),
          classification: { shot: 'front-elevation', legs: 'present', armrests: 'present', shape: 'straight' },
        },
        {
          bitmap: renderElevation(SOFA_3_SEAT, 'side', { pixelsAcross: 1200 }),
          classification: { shot: 'side-elevation', legs: 'present', armrests: 'present', shape: 'straight' },
        },
      ],
      dims,
    );

    const solidBand = reportOn(buildFurnitureModel(listing).item, WALL);
    const imageInset = reportOn(buildFurnitureModel(withImageEvidence(listing, image)).item, WALL);
    const tapeInset = reportOn(
      buildFurnitureModel({ ...listing, legs: { ...listing.legs!, insetCm: 3.5 } }).item,
      WALL,
    );
    const realPosts = reportOn(SOFA_3_SEAT, WALL);

    const validIds = (report: ItemReport) =>
      report.maneuvers.filter((line) => line.valid).map((line) => line.templateId).sort();

    for (const report of [solidBand, imageInset, tapeInset, realPosts]) {
      expect(report.narrowest).toBeCloseTo(85.01, 2);
      expect(validIds(report)).toEqual(validIds(realPosts));
    }
    // The carve really was made: this is not zero because nothing happened.
    expect(buildFurnitureModel(withImageEvidence(listing, image)).carvedVolumeCm3).toBeGreaterThan(
      buildFurnitureModel(listing).carvedVolumeCm3,
    );
  });
});
