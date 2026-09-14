import { describe, expect, it } from 'vitest';
import type { Box, Item } from '../src/types.ts';
import type { FurnitureInput, FurnitureModelResult } from '../src/sourcing/types.ts';
import {
  buildFurnitureModel,
  DEFAULT_INPUT_TOLERANCE_CM,
  DEFAULT_OVERALL_TOLERANCE_CM,
  FURNITURE_PIPELINE_VERSION,
  MIN_PLAUSIBLE_SEAT_BODY_CM,
} from '../src/sourcing/furnitureModel.ts';
import { extentsOf } from './support/occupancy.ts';

/**
 * The three numbers every listing has, and nothing else.
 *
 * Both margins are switched off throughout this file's rule tests, so that each
 * asserts what a carving *rule* does rather than what the rule plus the
 * input-error margins do together. The margins have their own section at the
 * end, where they belong: mixing them in would mean every rule test moved
 * whenever a default was retuned, and none of them would say clearly what it was
 * testing.
 */
/**
 * "Every number here is exact", stated the only way the pipeline accepts it.
 *
 * `toleranceCm: 0` alone is not enough: the roundness floor still lifts any
 * value that sits on a multiple of five, and most of these do. Only an explicit
 * per-field override outranks that floor — deliberately, because the floor
 * exists to stop a tightened default from carving into a number a shop had
 * rounded. So a rule test that wants to state what a rule does, with nothing
 * added, has to say so field by field.
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

const EXACT_INPUT = {
  toleranceCm: 0,
  overallToleranceCm: 0,
  fieldToleranceCm: NO_SLACK,
} as const;

const KOALA_BARE: FurnitureInput = {
  ...EXACT_INPUT,
  id: 'koala-3-seater',
  name: 'Koala 3-seater',
  nameHe: 'ספת קואלה תלת-מושבית',
  overallWidthCm: 300,
  overallDepthCm: 100,
  overallHeightCm: 70,
  seatHeightCm: 44,
  seatDepthCm: 70,
  shape: 'straight',
  separableParts: [
    {
      ...EXACT_INPUT,
      id: 'koala-ottoman',
      name: 'Koala ottoman',
      nameHe: 'הדום קואלה',
      overallWidthCm: 100,
      overallDepthCm: 100,
      overallHeightCm: 44,
    },
  ],
};

const dims = (box: Box) => ({
  widthCm: box.halfExtents.x * 2,
  depthCm: box.halfExtents.y * 2,
  heightCm: box.halfExtents.z * 2,
});

const span = (box: Box) => ({
  x: [box.center.x - box.halfExtents.x, box.center.x + box.halfExtents.x] as const,
  y: [box.center.y - box.halfExtents.y, box.center.y + box.halfExtents.y] as const,
  z: [box.center.z - box.halfExtents.z, box.center.z + box.halfExtents.z] as const,
});

const boxLabelled = (item: Item, label: string): Box[] => item.boxes.filter((b) => b.label === label);

const fieldsOf = (result: FurnitureModelResult): string[] =>
  result.improvements.map((improvement) => improvement.field);

describe('buildFurnitureModel: the Koala worked example', () => {
  /**
   * Test 1 of the brief, exactly.
   *
   * Three overall dimensions, a seat height and a seat depth, and nothing about
   * armrests or legs. Every one of those five numbers is a *size*, and a size
   * locates no air, so there is nothing to carve and the honest model is the
   * bounding box — emitted as one box, so that a caller can tell at a glance it
   * is looking at the floor of what this pipeline can do.
   */
  it('produces the bare bounding box when nothing published locates any air', () => {
    const result = buildFurnitureModel(KOALA_BARE);

    expect(result.item.boxes).toHaveLength(1);
    expect(dims(result.item.boxes[0]!)).toEqual({ widthCm: 300, depthCm: 100, heightCm: 70 });
    expect(result.carves).toEqual([]);
    expect(result.carvedVolumeCm3).toBe(0);
    expect(result.confidence).toBe('bounding-box-only');
    expect(result.flags.map((flag) => flag.code)).toContain('bounding-box-only');
    expect(result.pipelineVersion).toBe(FURNITURE_PIPELINE_VERSION);
  });

  /** The ottoman is carried in on its own, so it is its own item. */
  it('keeps the ottoman a separate item rather than folding it into the sofa', () => {
    const result = buildFurnitureModel(KOALA_BARE);

    expect(result.separableParts).toHaveLength(1);
    const ottoman = result.separableParts[0]!;
    expect(ottoman.item.id).toBe('koala-ottoman');
    expect(ottoman.item.boxes).toHaveLength(1);
    expect(dims(ottoman.item.boxes[0]!)).toEqual({ widthCm: 100, depthCm: 100, heightCm: 44 });

    // And it is nowhere in the sofa: the sofa is still 300 x 100 x 70.
    expect(extentsOf(result.item)).toEqual({ widthCm: 300, depthCm: 100, heightCm: 70 });
  });

  /**
   * The improvement list is the point of the whole exercise.
   *
   * With a seat height and a seat depth already in hand, the single biggest
   * volume still standing on nothing but ignorance is the band above the seat
   * and in front of the backrest — 300 x 70 x 26 cm of it. One yes-or-no answer
   * about armrests empties all of it, so that question ranks first, ahead of
   * armrest height (which empties part of the same band) and legs (which
   * empties a thin ring at the bottom).
   */
  it('ranks armrests first among the fields that would improve it', () => {
    const result = buildFurnitureModel(KOALA_BARE);

    expect(result.improvements[0]!.field).toBe('armrests');
    expect(result.improvements[0]!.rank).toBe(1);
    expect(result.improvements[0]!.estimatedCarveCm3).toBe(300 * 70 * 26);
    expect(fieldsOf(result)).toEqual(['armrests', 'armrestHeightCm', 'legs']);
  });

  /**
   * Test 2 of the brief: the same sofa once two absences are known.
   *
   * "No armrests" and "no legs" are facts, not gaps, and between them they turn
   * the block into an L in profile: a full-depth seat body up to seat height,
   * and the backrest band sitting on top of it at the rear.
   *
   * The seat body is the full 100 cm deep, not the 70 cm of published seat
   * depth, and that is deliberate. A seat depth is measured at seat level: it
   * proves where the backrest's front face is *up there*, and says nothing
   * whatever about the rear underside. On real furniture that underside is
   * usually solid — the Vetle in this repository's own catalogue has a plinth
   * 76 cm deep behind a 70 cm seat — so hollowing it would be carving on an
   * assumption, in the fatal direction. The brief's sketch of this case put the
   * seat box at 70 cm deep; 100 is the same model with the unproven hole left
   * filled in.
   *
   * Stated at `toleranceCm: 0` — these are the numbers the rule produces from
   * numbers taken literally. What the default input-error margin then does to
   * them is asserted in "input tolerance" below.
   */
  it('carves the front-top band into an L once armrests and legs are known absent', () => {
    const result = buildFurnitureModel({
      ...KOALA_BARE,
      legs: { present: false },
      armrests: 'none',
    });

    expect(result.item.boxes).toHaveLength(2);

    const [seat, backrest] = result.item.boxes as readonly [Box, Box];
    expect(seat.label).toBe('the seat');
    expect(dims(seat)).toEqual({ widthCm: 300, depthCm: 100, heightCm: 44 });
    expect(span(seat).z).toEqual([0, 44]);

    expect(backrest.label).toBe('the backrest');
    expect(dims(backrest)).toEqual({ widthCm: 300, depthCm: 30, heightCm: 26 });
    // At the rear, on top: it spans seat height to overall height, and its back
    // face is the sofa's back face.
    expect(span(backrest).z).toEqual([44, 70]);
    expect(span(backrest).y).toEqual([20, 50]);

    expect(result.carvedVolumeCm3).toBe(300 * 70 * 26);
    expect(result.confidence).toBe('high');
    // Every question this model needed has been answered.
    expect(result.improvements).toEqual([]);
  });
});

describe('buildFurnitureModel: the conservative direction', () => {
  /**
   * The invariant, stated as a test rather than as a comment.
   *
   * Adding a field may only ever remove material. If some rule in here ever
   * grows a case where learning something makes the model *bigger*, the model
   * was not a sound superset before and the whole pipeline was lying.
   */
  it('never grows the model when a field is added', () => {
    const bare = buildFurnitureModel(KOALA_BARE);
    const richer: FurnitureInput[] = [
      { ...KOALA_BARE, armrests: 'none' },
      { ...KOALA_BARE, armrests: 'present', armrestWidthCm: 12 },
      { ...KOALA_BARE, armrests: 'present', armrestHeightCm: 60 },
      { ...KOALA_BARE, legs: { present: true, heightCm: 12, insetCm: 6 } },
      { ...KOALA_BARE, legs: { present: false } },
    ];

    for (const input of richer) {
      const result = buildFurnitureModel(input);
      expect(result.carvedVolumeCm3).toBeGreaterThanOrEqual(bare.carvedVolumeCm3);
      expect(result.boundingVolumeCm3).toBe(bare.boundingVolumeCm3);
    }
  });

  /**
   * **The one that must never go green by accident.**
   *
   * An unknown fact is not a licence to remove material. Every one of these
   * inputs is a plausible half-filled listing, and not one of them proves where
   * any air is, so every one of them has to come back as the untouched bounding
   * box. The failure this guards against is not a wrong number, it is a
   * confident "it fits" about a sofa that will not go through the door.
   */
  it.each([
    ['nothing but the three dimensions', {}],
    ['a seat height with no seat depth', { seatHeightCm: 44 }],
    ['a seat depth with no seat height', { seatDepthCm: 70 }],
    ['armrests present, no width and no height', { seatHeightCm: 44, seatDepthCm: 70, armrests: 'present' }],
    ['legs present, no height', { seatHeightCm: 44, seatDepthCm: 70, legs: { present: true } }],
    ['legs present and tall, no inset', { seatHeightCm: 44, seatDepthCm: 70, legs: { present: true, heightCm: 14 } }],
    ['shape unknown', { seatHeightCm: 44, seatDepthCm: 70, shape: 'unknown' }],
  ] as const)('carves nothing given %s', (_why, extra) => {
    const result = buildFurnitureModel({
      ...EXACT_INPUT,
      overallWidthCm: 300,
      overallDepthCm: 100,
      overallHeightCm: 70,
      ...(extra as Partial<FurnitureInput>),
    });

    expect(result.carvedVolumeCm3).toBe(0);
    expect(extentsOf(result.item)).toEqual({ widthCm: 300, depthCm: 100, heightCm: 70 });
  });

  /**
   * `assumed` is a tag this pipeline owns and never uses.
   *
   * It exists in the union so a later stage has a name for a number nobody
   * measured, and so a consumer can refuse to trust one. Its permanent absence
   * from these results is the machine-checkable form of "never carve on an
   * assumption": if a number were ever assumed, this is where it would show up.
   */
  it('tags no number in any produced model as assumed', () => {
    const inputs: FurnitureInput[] = [
      KOALA_BARE,
      { ...KOALA_BARE, armrests: 'none', legs: { present: false } },
      { ...KOALA_BARE, armrests: 'present', armrestWidthCm: 12, armrestHeightCm: 62 },
      { ...KOALA_BARE, legs: { present: true, heightCm: 12, insetCm: 6, detachable: true } },
      { ...KOALA_BARE, shape: 'corner' },
    ];

    for (const input of inputs) {
      const result = buildFurnitureModel(input);
      const tags = [
        ...result.measurements.map((m) => m.provenance),
        ...result.boxProvenance.flatMap((p) => [p.width, p.depth, p.height]),
      ];
      expect(tags).not.toContain('assumed');
      expect(tags.length).toBeGreaterThan(0);
    }
  });
});

describe('buildFurnitureModel: the derivation rules', () => {
  const base: FurnitureInput = {
    overallWidthCm: 200,
    overallDepthCm: 95,
    overallHeightCm: 85,
    shape: 'straight',
    ...EXACT_INPUT,
  };

  /** Rule: backrest thickness = overall depth - seat depth, only when both are published. */
  it('derives the backrest thickness from overall depth minus seat depth', () => {
    const result = buildFurnitureModel({ ...base, seatHeightCm: 45, seatDepthCm: 62, armrests: 'none' });
    const derived = result.measurements.find((m) => m.field === 'backrestThicknessCm');

    expect(derived).toEqual({
      field: 'backrestThicknessCm',
      value: 33,
      provenance: 'derived',
      source: 'retailer-published',
      from: ['overallDepthCm', 'seatDepthCm'],
      toleranceCm: 0,
    });
    expect(dims(boxLabelled(result.item, 'the backrest')[0]!).depthCm).toBe(33);
  });

  /** ...and only when both are published: a seat depth alone derives nothing. */
  it('derives no backrest thickness when only one of the two is published', () => {
    const withoutSeatDepth = buildFurnitureModel({ ...base, seatHeightCm: 45, armrests: 'none' });

    expect(withoutSeatDepth.measurements.some((m) => m.field === 'backrestThicknessCm')).toBe(false);
    expect(withoutSeatDepth.carvedVolumeCm3).toBe(0);
    expect(boxLabelled(withoutSeatDepth.item, 'the backrest')).toEqual([]);
  });

  /** Rule: the backrest band spans seat height to overall height. */
  it('spans the backrest band from seat height to overall height', () => {
    const result = buildFurnitureModel({ ...base, seatHeightCm: 45, seatDepthCm: 62, armrests: 'none' });
    const backrest = boxLabelled(result.item, 'the backrest')[0]!;

    expect(span(backrest).z).toEqual([45, 85]);
    expect(span(backrest).y).toEqual([47.5 - 33, 47.5]);
  });

  /** Rule: carve the front-top region when armrests are known absent. */
  it('empties the whole front-top region when armrests are known absent', () => {
    const result = buildFurnitureModel({ ...base, seatHeightCm: 45, seatDepthCm: 62, armrests: 'none' });

    expect(result.carves.map((carve) => carve.region)).toEqual(['front-top']);
    expect(result.carves[0]!.volumeCm3).toBe(200 * 62 * 40);
    expect(boxLabelled(result.item, 'the armrests')).toEqual([]);
  });

  /** Rule: with an armrest width known, carve between the arms instead. */
  it('carves only between the arms when an armrest width is published', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'present',
      armrestWidthCm: 9,
    });

    const arms = boxLabelled(result.item, 'the armrests');
    expect(arms).toHaveLength(2);
    expect(span(arms[0]!).x).toEqual([-100, -91]);
    expect(span(arms[1]!).x).toEqual([91, 100]);
    // Both arms run the full front depth and the full band height: nothing
    // published says how deep or how tall they are.
    expect(span(arms[0]!).z).toEqual([45, 85]);
    expect(result.carves.map((carve) => carve.region)).toEqual(['between-armrests']);
    expect(result.carves[0]!.volumeCm3).toBe((200 - 18) * 62 * 40);
  });

  /** An armrest height is a separate proof: air above the arms, whatever their width. */
  it('carves above the arms from an armrest height alone', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'present',
      armrestHeightCm: 65,
    });

    expect(result.carves.map((carve) => carve.region)).toEqual(['above-armrests']);
    expect(result.carves[0]!.volumeCm3).toBe(200 * 62 * 20);
    // The arms themselves stay full width, because nothing said how wide they are.
    expect(dims(boxLabelled(result.item, 'the armrests')[0]!).widthCm).toBe(200);
  });

  /**
   * Rule: `present: true` with no height carves nothing.
   *
   * Knowing an item stands on legs, without knowing how tall they are, locates
   * no air at all — there is no band to point at.
   */
  it('carves nothing from legs present with no height', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'none',
      legs: { present: true },
    });

    expect(result.carves.map((carve) => carve.region)).not.toContain('under-seat');
    expect(boxLabelled(result.item, 'the legs')).toEqual([]);
  });

  /**
   * A leg height isolates the band. It does not empty it.
   *
   * This is the rule most likely to look like a bug. A published leg height
   * proves the band under the body is not full-section — but it says nothing
   * about *where in plan* the legs stand, and material whose position is unknown
   * has to be left exactly where the bounding box put it. What the height does
   * buy is a named band, which is what makes "take the legs off" a legal
   * suggestion; and it puts `legs.insetCm`, the field that would actually empty
   * the band, at the top of the improvement list.
   */
  it('isolates the leg band from a leg height but leaves it solid without an inset', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'none',
      legs: { present: true, heightCm: 16, detachable: true },
    });

    const legs = boxLabelled(result.item, 'the legs');
    expect(legs).toHaveLength(1);
    expect(dims(legs[0]!)).toEqual({ widthCm: 200, depthCm: 95, heightCm: 16 });
    expect(result.carves.map((carve) => carve.region)).not.toContain('under-seat');

    // The seat body now starts at the top of the legs rather than at the floor.
    expect(span(boxLabelled(result.item, 'the seat')[0]!).z).toEqual([16, 45]);
    // Detachable legs become a removable part pointing at that band.
    expect(result.item.removableParts).toEqual([{ name: 'legs', nameHe: 'הרגליים', boxIndices: [0] }]);
    expect(result.improvements[0]!.field).toBe('legs.insetCm');
  });

  /** With an inset, the perimeter of the band is proved clear, and that is a carve. */
  it('carves the leg band down to the inset once an inset is published', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'none',
      legs: { present: true, heightCm: 16, insetCm: 7 },
    });

    const legs = boxLabelled(result.item, 'the legs')[0]!;
    expect(dims(legs)).toEqual({ widthCm: 200 - 14, depthCm: 95 - 14, heightCm: 16 });
    expect(result.carves.map((carve) => carve.region)).toContain('under-seat');
    expect(result.carvedVolumeCm3).toBeGreaterThan(0);
  });

  /**
   * Height convention: published heights are measured from the floor and so
   * already include the legs. A leg carve therefore removes material and never
   * changes the overall height.
   */
  it('keeps the overall height when the leg band is carved', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'none',
      legs: { present: true, heightCm: 16, insetCm: 7 },
    });

    expect(extentsOf(result.item).heightCm).toBe(85);
  });

  /**
   * The sanity check the height convention makes possible.
   *
   * Seat height minus leg height is the thickness of the seat body itself. Under
   * about 10 cm the two numbers are not measuring what their names say — most
   * often a "seat height" that is really the frame height. Flagged, never
   * corrected: choosing which of the two to disbelieve would be an assumption.
   */
  it('flags an implausibly thin seat body', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 22,
      seatDepthCm: 62,
      armrests: 'none',
      legs: { present: true, heightCm: 15, insetCm: 7 },
    });

    expect(result.flags.map((flag) => flag.code)).toContain('seat-body-implausibly-thin');
    expect(22 - 15).toBeLessThan(MIN_PLAUSIBLE_SEAT_BODY_CM);
  });

  it('does not flag a normal seat body', () => {
    const result = buildFurnitureModel({
      ...base,
      seatHeightCm: 45,
      seatDepthCm: 62,
      armrests: 'none',
      legs: { present: true, heightCm: 15, insetCm: 7 },
    });

    expect(result.flags.map((flag) => flag.code)).not.toContain('seat-body-implausibly-thin');
  });

  /** Rule: separable parts become separate items, never merged into one body. */
  it('models each separable part in full, as its own item', () => {
    const result = buildFurnitureModel({
      ...base,
      separableParts: [
        { ...EXACT_INPUT, id: 'chaise', overallWidthCm: 95, overallDepthCm: 160, overallHeightCm: 85, seatHeightCm: 45, seatDepthCm: 60, armrests: 'none' },
      ],
    });

    expect(result.separableParts).toHaveLength(1);
    const chaise = result.separableParts[0]!;
    expect(chaise.item.id).toBe('chaise');
    expect(chaise.carvedVolumeCm3).toBeGreaterThan(0);
    expect(chaise.pipelineVersion).toBe(FURNITURE_PIPELINE_VERSION);
    expect(extentsOf(result.item)).toEqual({ widthCm: 200, depthCm: 95, heightCm: 85 });
  });

  it('refuses a separable part that has separable parts of its own', () => {
    expect(() =>
      buildFurnitureModel({
        ...base,
        separableParts: [
          {
            overallWidthCm: 95,
            overallDepthCm: 160,
            overallHeightCm: 85,
            // A nested catalogue, not a piece of furniture.
            separableParts: [{ overallWidthCm: 10, overallDepthCm: 10, overallHeightCm: 10 }],
          } as never,
        ],
      }),
    ).toThrow(/may not nest/);
  });
});

describe('buildFurnitureModel: L-shapes', () => {
  const corner: FurnitureInput = {
    id: 'rosendal',
    ...EXACT_INPUT,
    overallWidthCm: 280,
    overallDepthCm: 200,
    overallHeightCm: 85,
    seatHeightCm: 46,
    seatDepthCm: 90,
    armrests: 'present',
    armrestWidthCm: 4,
    armrestHeightCm: 65,
    shape: 'corner',
  };

  /**
   * A corner sofa is not a box with pieces missing, it is two limbs at right
   * angles, and the corner void opposite the return is most of what makes it
   * awkward. Nothing in this contract describes the return leg, so the only
   * sound answer is the bounding box — a superset of the real shape, therefore
   * never a false "it fits", and a 280 x 200 cm slab standing in for two limbs
   * under a metre wide. It has to say so, loudly, or a caller will mistake it
   * for a model of the sofa.
   */
  it.each(['corner', 'chaise'] as const)('emits the bounding box and flags it loudly for shape %s', (shape) => {
    const result = buildFurnitureModel({ ...corner, shape });

    expect(result.item.boxes).toHaveLength(1);
    expect(extentsOf(result.item)).toEqual({ widthCm: 280, depthCm: 200, heightCm: 85 });
    expect(result.carves).toEqual([]);
    expect(result.confidence).toBe('bounding-box-only');

    const flag = result.flags.find((f) => f.code === 'l-shape-not-modelled');
    expect(flag?.severity).toBe('loud');
    expect(flag?.en).toMatch(/near-useless/);
  });

  /** And the return leg goes to the top of the list of what to ask for. */
  it('puts the return leg dimensions first among the improvements', () => {
    const result = buildFurnitureModel(corner);

    expect(result.improvements[0]!.field).toBe('returnLegDimensions');
    expect(result.improvements[0]!.rank).toBe(1);
  });

  /** The same numbers on a straight sofa carve normally: the flag is about the shape. */
  it('carves the same input normally when the shape is straight', () => {
    const straight = buildFurnitureModel({ ...corner, shape: 'straight' });

    expect(straight.carvedVolumeCm3).toBeGreaterThan(0);
    expect(straight.flags.map((f) => f.code)).not.toContain('l-shape-not-modelled');
  });
});

describe('buildFurnitureModel: provenance, versioning and the image seam', () => {
  const input: FurnitureInput = {
    overallWidthCm: 200,
    overallDepthCm: 95,
    overallHeightCm: 85,
    seatHeightCm: 45,
    seatDepthCm: 62,
    armrests: 'present',
    armrestWidthCm: 9,
    armrestHeightCm: 65,
    legs: { present: true, heightCm: 16, insetCm: 7 },
    shape: 'straight',
    ...EXACT_INPUT,
  };

  it('carries a provenance tag for every extent of every box', () => {
    const result = buildFurnitureModel(input);

    expect(result.boxProvenance).toHaveLength(result.item.boxes.length);
    for (const [index, prov] of result.boxProvenance.entries()) {
      const box = result.item.boxes[index]!;
      expect(prov.label).toBe(box.label);
      expect(prov.widthCm).toBe(box.halfExtents.x * 2);
      expect(prov.depthCm).toBe(box.halfExtents.y * 2);
      expect(prov.heightCm).toBe(box.halfExtents.z * 2);
      expect(prov.from.length).toBeGreaterThan(0);
    }
  });

  it('names every carve with the published fields that proved it', () => {
    const result = buildFurnitureModel(input);

    expect(result.carves.length).toBeGreaterThan(0);
    for (const carve of result.carves) {
      expect(carve.provedBy.length).toBeGreaterThan(0);
      expect(carve.volumeCm3).toBeGreaterThan(0);
      expect(carve.en.length).toBeGreaterThan(0);
      expect(carve.he.length).toBeGreaterThan(0);
    }
  });

  /**
   * The version string itself, pinned to the literal.
   *
   * Asserting against the constant would be a tautology — it would pass whatever
   * the constant said. A catalogue decides which of its stored models to re-run
   * by comparing this string, so the string is the contract, and changing it has
   * to be a deliberate edit to a test rather than a side effect of editing a
   * rule.
   */
  it('pins the pipeline version string', () => {
    expect(FURNITURE_PIPELINE_VERSION).toBe('furniture-model/3.0.0');
    expect(buildFurnitureModel(input).pipelineVersion).toBe('furniture-model/3.0.0');
  });

  it('stamps the pipeline version on the model and on every separable part', () => {
    const result = buildFurnitureModel({
      ...input,
      separableParts: [{ ...EXACT_INPUT, overallWidthCm: 90, overallDepthCm: 90, overallHeightCm: 42 }],
    });

    expect(result.pipelineVersion).toBe(FURNITURE_PIPELINE_VERSION);
    expect(result.separableParts[0]!.pipelineVersion).toBe(FURNITURE_PIPELINE_VERSION);
  });

  /**
   * The seam an image stage will plug into, exercised without any image code.
   *
   * A number measured off a photograph is a measurement — it lands in the model
   * and it carves like any other — but the shop did not publish it, so it does
   * not get to wear the shop's tag. That distinction is the entire contract
   * between this round and the next one, and it is testable today.
   */
  it('marks a field routed through the image seam as derived rather than published', () => {
    const result = buildFurnitureModel({
      ...input,
      fieldSources: { armrestWidthCm: 'image-derived', seatHeightCm: 'operator-entered' },
    });

    const armWidth = result.measurements.find((m) => m.field === 'armrestWidthCm')!;
    expect(armWidth.source).toBe('image-derived');
    expect(armWidth.provenance).toBe('derived');

    const seatHeight = result.measurements.find((m) => m.field === 'seatHeightCm')!;
    expect(seatHeight.source).toBe('operator-entered');
    expect(seatHeight.provenance).toBe('published');

    // A derived number is only as direct as its least direct input.
    const width = result.measurements.find((m) => m.field === 'overallWidthCm')!;
    expect(width.source).toBe('retailer-published');
    expect(width.provenance).toBe('published');
  });

  /** Same input, same model. The engine's rule, and this subsystem is not exempt. */
  it('is deterministic', () => {
    expect(JSON.stringify(buildFurnitureModel(input))).toBe(JSON.stringify(buildFurnitureModel(input)));
  });

  it.each([
    ['a zero width', { overallWidthCm: 0 }],
    ['a negative depth', { overallDepthCm: -10 }],
    ['a missing height', { overallHeightCm: Number.NaN }],
  ] as const)('refuses %s outright', (_why, broken) => {
    expect(() => buildFurnitureModel({ ...input, ...(broken as Partial<FurnitureInput>) })).toThrow(RangeError);
  });

  /**
   * An implausible field is ignored, not repaired.
   *
   * A seat depth that is not less than the overall depth is a listing error, and
   * there is no way to tell which of the two numbers is wrong. Dropping the
   * field leaves the material in place, which is the safe direction; guessing a
   * correction is the unsafe one.
   */
  it.each([
    ['a seat depth at least the overall depth', { seatDepthCm: 95 }],
    ['a seat height at least the overall height', { seatHeightCm: 85 }],
    ['armrests that would meet in the middle', { armrestWidthCm: 100 }],
  ] as const)('ignores %s and says so', (_why, broken) => {
    const result = buildFurnitureModel({ ...input, ...(broken as Partial<FurnitureInput>) });

    expect(result.flags.map((flag) => flag.code)).toContain('field-ignored-implausible');
    expect(extentsOf(result.item)).toEqual({ widthCm: 200, depthCm: 95, heightCm: 85 });
  });
});

describe('buildFurnitureModel: a published zero is a measurement', () => {
  const vetle: FurnitureInput = {
    id: 'vetle',
    overallWidthCm: 160,
    overallDepthCm: 90,
    overallHeightCm: 80,
    seatHeightCm: 46,
    seatDepthCm: 75,
    armrests: 'present',
    armrestHeightCm: 58,
    shape: 'straight',
    // The skin is left where the listing puts it, so the widths below are the
    // armrest rule's arithmetic and not the growth margin's.
    overallToleranceCm: 0,
  };

  /**
   * **The degenerate case, named before it was fixed.**
   *
   * A published armrest width of zero used to be read as the *fact* "no
   * armrests", on the reasoning that it was a shop saying so in numbers. That
   * was a hole in the fatal direction, and the reason is the tolerance work: a
   * fact carries no slack, so a real 4 cm armrest mis-stated as 0 emptied the
   * entire band above the seat — arms included — with nothing to pull the carve
   * back. The extended perturbation sweep found it by subtracting 4 from a
   * published 4.
   *
   * A zero is now what it looks like: a measurement of zero, which under a
   * tolerance of `t` describes an armrest up to `t` wide. Only `armrests: 'none'`
   * states the fact, and only a fact carves without slack.
   */
  it('does not read a zero armrest width as the fact that there are no armrests', () => {
    const zeroWidth = buildFurnitureModel({ ...vetle, armrestWidthCm: 0, toleranceCm: 4 });
    const arms = boxLabelled(zeroWidth.item, 'the armrests');

    // Four centimetres of armrest kept, because four centimetres is what the
    // slack allows the published zero to really be.
    expect(arms).toHaveLength(2);
    expect(dims(arms[0]!).widthCm).toBe(4);
    expect(zeroWidth.carves.map((carve) => carve.region)).not.toContain('front-top');
  });

  /** Said as a fact, it still carves the whole band — that path is unchanged. */
  it('still empties the band when the listing states there are none', () => {
    const stated = buildFurnitureModel({ ...vetle, armrests: 'none', toleranceCm: 4 });

    expect(boxLabelled(stated.item, 'the armrests')).toEqual([]);
    expect(stated.carves.map((carve) => carve.region)).toContain('front-top');
  });

  /** With no slack the arithmetic agrees with the old reading, which is why it was easy to miss. */
  it('reaches the same empty band from a zero width when nothing is allowed to be wrong', () => {
    const zeroWidth = buildFurnitureModel({ ...vetle, ...EXACT_INPUT, armrestWidthCm: 0 });

    expect(boxLabelled(zeroWidth.item, 'the armrests')).toEqual([]);
    expect(zeroWidth.carves.map((carve) => carve.region)).toContain('front-top');
  });
});

describe('buildFurnitureModel: input tolerance', () => {
  /** The Koala again, with both absences known — the two-box L, now with slack. */
  const koalaL: FurnitureInput = {
    overallToleranceCm: 0,
    // Silenced so these tests speak about `toleranceCm` alone; the floor is the
    // subject of its own describe block below.
    fieldToleranceCm: undefined,
    id: 'koala-3-seater',
    overallWidthCm: 300,
    overallDepthCm: 100,
    overallHeightCm: 70,
    seatHeightCm: 44,
    seatDepthCm: 70,
    legs: { present: false },
    armrests: 'none',
    shape: 'straight',
  };

  const boxOf = (result: FurnitureModelResult, label: string): Box =>
    result.item.boxes.find((box) => box.label === label)!;

  /**
   * The default is a measurement, not a preference.
   *
   * `test/furnitureModelTolerance.test.ts` moves every published field of every
   * catalogue listing by up to five centimetres and re-checks exact containment.
   * Five is the value at which the carve-derived failures reach zero; four still
   * leaves fourteen. Five rather than two because two was only ever validated
   * against errors of two, which proves very little — and because two thirds of
   * the numbers in the catalogue's own listings sit on a multiple of five, where
   * rounding alone is worth up to that much.
   */
  it('defaults to five centimetres of slack, and at least two on the overall dimensions', () => {
    expect(DEFAULT_INPUT_TOLERANCE_CM).toBe(5);
    expect(DEFAULT_OVERALL_TOLERANCE_CM).toBe(2);
    expect(buildFurnitureModel(koalaL).tolerance.defaultCm).toBe(5);
  });

  /**
   * The skin grows on the same roundness rule the carves use.
   *
   * They were briefly inconsistent — the carve logic was told a published 300
   * might be five centimetres wrong while the skin was told it might be two —
   * and one number cannot be wrong by different amounts depending on which part
   * of the pipeline is reading it.
   */
  it('grows each face by what that dimension\'s own roundness earns', () => {
    // 300, 100 and 70 are all multiples of ten, so every face earns the full five.
    const rounded = buildFurnitureModel({ ...koalaL, overallToleranceCm: undefined });
    expect(rounded.tolerance.overallCm).toEqual({ width: 5, depth: 5, height: 5 });
    // Five on each end and each side, five at the top, nothing below the floor.
    expect(extentsOf(rounded.item)).toEqual({ widthCm: 310, depthCm: 110, heightCm: 75 });

    // A height that is only a multiple of five earns half as much.
    const halfRounded = buildFurnitureModel({
      ...koalaL,
      overallToleranceCm: undefined,
      overallHeightCm: 75,
    });
    expect(halfRounded.tolerance.overallCm).toEqual({ width: 5, depth: 5, height: 2.5 });

    // 301, 99 and 71 look like nobody rounded them, so they get the base.
    const unround = buildFurnitureModel({
      ...koalaL,
      overallToleranceCm: undefined,
      overallWidthCm: 301,
      overallDepthCm: 99,
      overallHeightCm: 71,
    });
    expect(unround.tolerance.overallCm).toEqual({ width: 2, depth: 2, height: 2 });
  });

  it('lets an explicit overall tolerance win over the roundness of a dimension', () => {
    const stated = buildFurnitureModel({ ...koalaL, overallToleranceCm: 1 });

    expect(stated.tolerance.overallCm).toEqual({ width: 1, depth: 1, height: 1 });
  });

  /**
   * **The rule, in one assertion: slack may only ever keep material.**
   *
   * Every carve at the default has to be no larger than the same carve with the
   * numbers taken literally. If some future rule applies its tolerance the other
   * way round, this is what catches it — and the thing it would be doing is
   * removing real furniture on the strength of a rounded number.
   */
  it('never carves more under tolerance than it would with exact numbers', () => {
    const inputs: FurnitureInput[] = [
      koalaL,
      { ...koalaL, armrests: 'present', armrestWidthCm: 12, armrestHeightCm: 60 },
      { ...koalaL, armrests: 'present', armrestHeightCm: 60 },
      { ...koalaL, legs: { present: true, heightCm: 14, insetCm: 6 } },
    ];

    for (const input of inputs) {
      let previous = Number.POSITIVE_INFINITY;
      for (const tolerance of [0, 0.5, 1, 2, 4]) {
        const loose = buildFurnitureModel({ ...input, toleranceCm: tolerance });
        // Monotone in the total, which is the quantity with a direction. Not in
        // any single carve: slack moves the boundaries that define the regions,
        // so letting an armrest be taller than published shrinks the carve above
        // the arms and enlarges the one between them. Both are still carved, and
        // the arms themselves grew — which is what the total records.
        expect(loose.carvedVolumeCm3).toBeLessThanOrEqual(previous);
        previous = loose.carvedVolumeCm3;
      }
    }
  });

  /** Each boundary moves the way that keeps material, and by exactly the slack. */
  it('moves the seat split up and the backrest face forward', () => {
    const exact = buildFurnitureModel({ ...koalaL, ...EXACT_INPUT });
    const loose = buildFurnitureModel({
      ...koalaL,
      toleranceCm: 2,
      // Both numbers this test moves are round, so the floor is stated away and
      // the two centimetres on show are the knob's.
      fieldToleranceCm: { ...NO_SLACK, seatHeightCm: 2, seatDepthCm: 2, overallDepthCm: 2 },
    });

    // Exact: seat 300 x 100 x 44, backrest 300 x 30 x 26 at the rear on top.
    expect(dims(boxOf(exact, 'the seat'))).toEqual({ widthCm: 300, depthCm: 100, heightCm: 44 });
    expect(dims(boxOf(exact, 'the backrest'))).toEqual({ widthCm: 300, depthCm: 30, heightCm: 26 });

    // Loose: the solid body reaches 2 cm higher, and the backrest band is 2 cm
    // thicker at its front face. Both directions add material.
    expect(dims(boxOf(loose, 'the seat'))).toEqual({ widthCm: 300, depthCm: 100, heightCm: 46 });
    expect(dims(boxOf(loose, 'the backrest'))).toEqual({ widthCm: 300, depthCm: 32, heightCm: 24 });
    expect(span(boxOf(loose, 'the backrest')).y).toEqual([18, 50]);
  });

  it('keeps a wider armrest than the listing claims', () => {
    const loose = buildFurnitureModel({
      ...koalaL,
      armrests: 'present',
      armrestWidthCm: 10,
      armrestHeightCm: 60,
      toleranceCm: 2,
      // 10 and 60 are round, so without this the floor would lift both to 5 and
      // the arithmetic under test would be the floor's rather than the knob's.
      fieldToleranceCm: { armrestWidthCm: 2, armrestHeightCm: 2, seatDepthCm: 2, overallDepthCm: 2 },
    });
    const arms = loose.item.boxes.filter((box) => box.label === 'the armrests');

    expect(arms).toHaveLength(2);
    // 10 published, 12 modelled: two centimetres of doubt kept as material.
    expect(span(arms[0]!).x).toEqual([-150, -138]);
    expect(span(arms[1]!).x).toEqual([138, 150]);
    // ...and the arm is allowed to be two centimetres taller than published.
    expect(span(arms[0]!).z).toEqual([46, 62]);
  });

  it('pulls a published leg inset back, and drops the carve when slack swallows it', () => {
    const legs = { present: true as const, heightCm: 14, insetCm: 6 };
    const tight = buildFurnitureModel({ ...koalaL, legs, toleranceCm: 2 });
    const swallowed = buildFurnitureModel({ ...koalaL, legs, toleranceCm: 6 });
    // 14 and 6 are both unround, so the floor has nothing to say about either.

    // 6 cm published, 4 cm modelled.
    expect(dims(boxLabelled(tight.item, 'the legs')[0]!)).toEqual({
      widthCm: 300 - 8,
      depthCm: 100 - 8,
      heightCm: 12,
    });

    // With more slack than inset there is nothing provable left, so the band
    // reverts to full width at its published height and carves nothing.
    expect(swallowed.carves.map((carve) => carve.region)).not.toContain('under-seat');
    expect(dims(boxLabelled(swallowed.item, 'the legs')[0]!)).toEqual({
      widthCm: 300,
      depthCm: 100,
      heightCm: 14,
    });
  });

  /** A tolerance is a claim about a source, so it can be made per field. */
  it('takes a per-field override for a number someone actually measured', () => {
    const result = buildFurnitureModel({
      ...koalaL,
      toleranceCm: 2,
      fieldToleranceCm: { seatDepthCm: 0.5, overallDepthCm: 0.5, seatHeightCm: 2 },
      fieldSources: { seatDepthCm: 'operator-entered' },
    });

    // 30 cm derived, plus half a centimetre rather than two.
    expect(dims(boxOf(result, 'the backrest')).depthCm).toBe(30.5);
    expect(result.tolerance.byField.seatDepthCm).toBe(0.5);
    expect(result.tolerance.byField.overallDepthCm).toBe(0.5);
    expect(result.tolerance.defaultCm).toBe(2);
  });

  /**
   * The output has to say which numbers the geometry stood back from.
   *
   * A box carved against an exact input and one carved under tolerance are
   * different claims about the furniture, and a consumer that cannot tell them
   * apart cannot tell how much of the model is measurement.
   */
  it('surfaces the slack in the provenance of every number that carried it', () => {
    const exact = buildFurnitureModel({ ...koalaL, ...EXACT_INPUT });
    const loose = buildFurnitureModel({ ...koalaL, toleranceCm: 2, fieldToleranceCm: { ...NO_SLACK, seatDepthCm: 2, overallDepthCm: 2, seatHeightCm: 2 } });

    expect(exact.boxProvenance.every((prov) => prov.toleranceCm === 0)).toBe(true);
    expect(exact.carves.every((carve) => carve.toleranceCm === 0)).toBe(true);

    expect(loose.boxProvenance.some((prov) => prov.toleranceCm > 0)).toBe(true);
    expect(loose.carves.every((carve) => carve.toleranceCm === 2)).toBe(true);
    const seatDepth = loose.measurements.find((m) => m.field === 'seatDepthCm')!;
    expect(seatDepth.toleranceCm).toBe(2);
    // What the slack cost, in cubic centimetres of carve handed back.
    expect(loose.tolerance.costCm3).toBeGreaterThan(0);
    expect(loose.tolerance.costCm3).toBe(exact.carvedVolumeCm3 - loose.carvedVolumeCm3);
  });

  /**
   * The overall dimensions are a different kind of error, and get a different knob.
   *
   * Slack on a carve protects the model against a wrong *relationship* between
   * published numbers, which is the pipeline's own exposure because the pipeline
   * is what derives air from those relationships. An under-reported overall
   * dimension is not that — it means the listing describes a smaller sofa, and
   * no internal conservatism recovers the difference. Growing the box is the
   * only remedy, and it answers a different question, so it is opt-in.
   */
  it('grows only the outer skin when asked, and leaves the partitions alone', () => {
    const plain = buildFurnitureModel({ ...koalaL, ...EXACT_INPUT });
    const grownModel = buildFurnitureModel({ ...koalaL, ...EXACT_INPUT, overallToleranceCm: 2 });

    expect(extentsOf(plain.item)).toEqual({ widthCm: 300, depthCm: 100, heightCm: 70 });
    // Two centimetres on each side, two at the top, nothing below: it stands on
    // the floor.
    expect(extentsOf(grownModel.item)).toEqual({ widthCm: 304, depthCm: 104, heightCm: 72 });
    expect(span(boxOf(grownModel, 'the seat')).z).toEqual([0, 44]);
    // The backrest's front face — an internal partition — has not moved. Its
    // back face has: that one is the skin.
    expect(span(boxOf(grownModel, 'the backrest')).y).toEqual([20, 52]);
    expect(grownModel.flags.map((flag) => flag.code)).toContain('bounding-box-grown');
    expect(grownModel.tolerance.overallCm).toEqual({ width: 2, depth: 2, height: 2 });
  });

  it.each([
    ['a negative tolerance', { toleranceCm: -1 }],
    ['a negative overall tolerance', { overallToleranceCm: -0.5 }],
    ['a negative per-field tolerance', { fieldToleranceCm: { seatDepthCm: -2 } }],
  ] as const)('refuses %s', (_why, broken) => {
    expect(() => buildFurnitureModel({ ...koalaL, ...(broken as Partial<FurnitureInput>) })).toThrow(RangeError);
  });
});
