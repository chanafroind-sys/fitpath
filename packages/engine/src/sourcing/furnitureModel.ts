/**
 * The bridge from a retailer's published dimensions to an engine `Item`.
 *
 * ## The governing principle
 *
 * Width, depth and height alone can never produce anything better than the
 * bounding box. Every improvement over the bounding box comes from a field that
 * proves where material *is not*: a leg height proves air underneath, "no
 * armrests" together with a seat depth proves air at the front-top, an armrest
 * width proves air between the arms. So this function starts from the bounding
 * box and carves, and it carves only where something published proves the air.
 *
 * ## The invariant
 *
 * **Never carve on an assumption.** When a fact is unknown, the material stays.
 *
 * The asymmetry is the whole reason. A model that is too solid answers "no path
 * found" for a sofa that would have fitted: annoying, and the caller can see it
 * happen. A model that is too hollow answers "it fits" for a sofa that does
 * not: someone books a van. Every rule below is written to fail in the first
 * direction, and `test/furnitureModelGroundTruth.test.ts` pins it by asserting
 * that every model this pipeline produces is a geometric *superset* of the
 * hand-authored fixture it stands in for.
 *
 * Two consequences of the invariant are worth stating up front, because both
 * look at first like the function is being lazy:
 *
 * 1. **A leg height on its own carves nothing in plan.** It proves the band
 *    under the body is not full-section, but not *where* in that band the
 *    material stands. `legs.insetCm` is what proves the perimeter is clear, and
 *    without it the band is isolated and labelled — which is enough to make
 *    "take the legs off" a legal suggestion — but not hollowed.
 * 2. **The body stays solid underneath the backrest.** A published seat depth
 *    proves where the backrest's front face is *at seat level*; it says nothing
 *    about what is below seat level at the rear, and on real furniture that is
 *    usually a full-depth base — the Vetle's plinth is 76 cm deep behind a 70 cm
 *    seat. So the seat box is full depth and the backrest sits on top of it.
 *
 * ## Input is not exact
 *
 * Retailers round, and they occasionally measure to a different reference than a
 * rule assumes. Every carve derived from a published number inherits that error,
 * so every carve is pulled back by `toleranceCm` — always in the direction that
 * keeps material, never once in the direction that removes any. The default is
 * measured rather than chosen: see `DEFAULT_INPUT_TOLERANCE_CM`.
 *
 * ## Frame
 *
 * Local +X is the width, +Y runs from the front face toward the back, +Z is up,
 * and the origin is the centre of the footprint on the floor — the convention in
 * `../types.ts`. All published heights are measured from the floor and therefore
 * already include the legs, so a leg carve removes material and never changes
 * the overall height.
 *
 * No DOM, no canvas, no randomness, no dependencies. Same input, same model.
 */

import type { Box, Item, RemovablePart } from '../types.ts';
import type {
  ArmrestPresence,
  BoxProvenance,
  Carve,
  ConfidenceTier,
  FieldSource,
  FurnitureField,
  FurnitureInput,
  FurnitureModelResult,
  ImprovementField,
  ImprovementRequest,
  MeasurementProvenance,
  ModelFlag,
  SeparablePartInput,
  ToleranceReport,
} from './types.ts';

/**
 * Bump on any change to the carving rules.
 *
 * A catalogue stores the version alongside each model so it can tell which of
 * its entries were built under the old rules and re-run exactly those. The
 * major number moves whenever a stored model built by an older pipeline is not
 * merely different from what this one would produce, but **unsound** — a model
 * with air in it where the furniture has material. Such a model cannot be left
 * in a catalogue to be compared against a doorway; it has to be rebuilt.
 *
 * ## 2.0.0
 *
 * Everything that moved between 1.0.0 and 2.0.0 moved in that direction, so a
 * 1.0.0 model is not a slightly looser 2.0.0 model, it is one that can answer
 * "it fits" about a sofa that does not:
 *
 * - carves were taken from published numbers literally; they are now pulled
 *   back by `toleranceCm`, default 5 (see `DEFAULT_INPUT_TOLERANCE_CM`);
 * - the outer skin was exactly the published size; it now grows by
 *   `overallToleranceCm`, default 2;
 * - a value's own roundness now puts a floor under its tolerance;
 * - a published `armrestWidthCm` of 0 was read as the *fact* "no armrests" and
 *   emptied the whole band above the seat, armrests and all. It is now a
 *   measurement of zero, which carries slack like any other number.
 *
 * Nothing has been built with 1.0.0 yet, which is exactly why the discipline is
 * cheap to establish now.
 */
export const FURNITURE_PIPELINE_VERSION = 'furniture-model/2.0.0';

/**
 * The thinnest a seat body can plausibly be: seat height minus leg height.
 *
 * Below this the two numbers are describing different things — a "seat height"
 * that is really the seat *frame* height, or a leg height that includes the
 * base. Flagged rather than corrected: guessing which of the two is wrong would
 * be exactly the assumption this file refuses to make.
 */
export const MIN_PLAUSIBLE_SEAT_BODY_CM = 10;

/**
 * How wrong a published number is assumed to be, in centimetres, unless the
 * caller says otherwise.
 *
 * **Chosen by measurement, not by taste.** `test/furnitureModelTolerance.test.ts`
 * moves every published field of every catalogue listing by up to five
 * centimetres in either direction and re-runs exact containment. Five is the
 * smallest value at which every carve-derived break disappears; four still
 * leaves fourteen.
 *
 * It was two, until the sweep was widened. Two was validated against errors of
 * at most two, which is close to circular — and the reason to widen is in the
 * data: more than two thirds of the numbers in this repository's own six
 * listings sit on a multiple of five, and a value rounded to the nearest ten
 * carries up to five centimetres of error on that account alone. A default that
 * covered only the unrounded population would have been a default for the rare
 * case.
 *
 * It costs about a seventh of the carved volume. Every fixture still comes out
 * substantially tighter than its own bounding box, which is the test of whether
 * the carving rules are still earning their keep.
 */
export const DEFAULT_INPUT_TOLERANCE_CM = 5;

/**
 * How far the overall dimensions are assumed to under-state the item, per face.
 *
 * On by default, at two centimetres. The argument for leaving it off was that a
 * model grown to 304 cm answers a question about a different sofa than the 300
 * cm one the caller asked about — true, and the wrong side of this subsystem's
 * trade. A sofa published as 300 that is really 302 is precisely the case where
 * the answer comes back "it fits" about something that does not, and that is the
 * one outcome this whole file is built to prevent. Two centimetres on a three
 * metre sofa is seven tenths of one per cent, against forty-two of two hundred
 * and sixty sweep cases that fail without it.
 *
 * The growth is never silent: it raises `bounding-box-grown`, and the boxes it
 * touched carry it in their provenance. A caller who genuinely knows a listing
 * is exact sets it to 0.
 */
export const DEFAULT_OVERALL_TOLERANCE_CM = 2;

/**
 * The slack a published value's own roundness earns it, at minimum.
 *
 * A number that is a multiple of five was probably rounded to five, and carries
 * up to 2.5 cm of error on that account alone; a multiple of ten, up to 5 cm.
 * The catalogue bears this out — of the fifty-odd numbers in the six listings,
 * more than two thirds land on a multiple of five.
 *
 * **This inference may only ever raise a tolerance, never lower one**, which is
 * what makes it safe. The tempting other half — "an odd centimetre value is
 * precise, so tighten its tolerance" — is not implemented and should not be. It
 * carries all of the risk and the least evidence: an odd value just as often
 * comes from a unit conversion (28 in = 71.12 cm), from a spec sheet that had
 * already rounded a range, or from a measurement taken to a different reference
 * than the one a rule assumes, and none of those are visible in the digits. A
 * source that knows its numbers are precise says so with `fieldToleranceCm`,
 * which is evidence rather than inference, and which always wins outright.
 */
export const ROUNDED_TO_FIVE_TOLERANCE_CM = 2.5;
export const ROUNDED_TO_TEN_TOLERANCE_CM = 5;

/**
 * Nominal proportions, used only to rank the improvement list.
 *
 * These never touch geometry. Ranking "which single field would most improve
 * this model" needs a rough size for the carve a missing field would unlock,
 * and a rough size is all these are. A test pins that no produced number is
 * tagged `assumed`, which is the machine-checkable version of that promise.
 */
const NOMINAL_LEG_HEIGHT_CM = 15;
const NOMINAL_LEG_INSET_CM = 8;
const NOMINAL_ARMREST_WIDTH_CM = 10;
const NOMINAL_SEAT_HEIGHT_FRACTION = 0.6;
const NOMINAL_SEAT_DEPTH_FRACTION = 0.72;
/** Of the front-top band, the share that sits above a typical armrest. */
const NOMINAL_ABOVE_ARMREST_FRACTION = 0.3;

/** Fixed order, so two fields with equal estimates always rank the same way. */
const IMPROVEMENT_ORDER: readonly ImprovementField[] = [
  'returnLegDimensions',
  'armrests',
  'armrestWidthCm',
  'armrestHeightCm',
  'seatDepthCm',
  'seatHeightCm',
  'legs',
  'legs.insetCm',
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function spanBox(
  label: string,
  labelHe: string,
  x: readonly [number, number],
  y: readonly [number, number],
  z: readonly [number, number],
): Box {
  return {
    center: { x: (x[0] + x[1]) / 2, y: (y[0] + y[1]) / 2, z: (z[0] + z[1]) / 2 },
    halfExtents: { x: (x[1] - x[0]) / 2, y: (y[1] - y[0]) / 2, z: (z[1] - z[0]) / 2 },
    rotation: { yaw: 0, pitch: 0, roll: 0 },
    label,
    labelHe,
  };
}

/** A published number is usable only if it is a finite, non-negative measurement. */
function measured(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Push a box's outer faces out to the grown skin, leaving internal ones alone.
 *
 * Growth has to move only the skin. Moving an internal partition — the front
 * face of the backrest band, say — would shift where the model thinks the
 * backrest starts, which is a carving decision and not something a doubt about
 * the overall depth is entitled to make. The floor is never moved: an item
 * stands on it.
 */
function grown(box: Box, half: { x: number; y: number; z: number }, by: number): Box {
  if (by === 0) return box;
  const lo = { x: box.center.x - box.halfExtents.x, y: box.center.y - box.halfExtents.y, z: box.center.z - box.halfExtents.z };
  const hi = { x: box.center.x + box.halfExtents.x, y: box.center.y + box.halfExtents.y, z: box.center.z + box.halfExtents.z };
  const at = (value: number, surface: number): boolean => Math.abs(value - surface) < 1e-9;

  const x: [number, number] = [at(lo.x, -half.x) ? -half.x - by : lo.x, at(hi.x, half.x) ? half.x + by : hi.x];
  const y: [number, number] = [at(lo.y, -half.y) ? -half.y - by : lo.y, at(hi.y, half.y) ? half.y + by : hi.y];
  const z: [number, number] = [lo.z, at(hi.z, half.z * 2) ? half.z * 2 + by : hi.z];

  return spanBox(box.label!, box.labelHe!, x, y, z);
}

function requireTolerance(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative number of centimetres, got ${String(value)}`);
  }
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive number of centimetres, got ${String(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Turn published retailer dimensions into an engine `Item`, plus the paperwork
 * that says how much of it was measured and what to ask for next.
 */
export function buildFurnitureModel(input: FurnitureInput): FurnitureModelResult {
  const width = requirePositive(input.overallWidthCm, 'overallWidthCm');
  const depth = requirePositive(input.overallDepthCm, 'overallDepthCm');
  const height = requirePositive(input.overallHeightCm, 'overallHeightCm');

  const flags: ModelFlag[] = [];
  const measurements: MeasurementProvenance[] = [];
  const carves: Carve[] = [];

  const defaultTolerance = requireTolerance(input.toleranceCm ?? DEFAULT_INPUT_TOLERANCE_CM, 'toleranceCm');
  const overallTolerance = requireTolerance(
    input.overallToleranceCm ?? DEFAULT_OVERALL_TOLERANCE_CM,
    'overallToleranceCm',
  );
  /** What the listing actually says for a field, so its roundness can be read. */
  const publishedValue = (field: FurnitureField): number | undefined => {
    if (field === 'legs.heightCm') return input.legs?.heightCm;
    if (field === 'legs.insetCm') return input.legs?.insetCm;
    const value = (input as unknown as Record<string, unknown>)[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  /** The floor a value's own roundness puts under its tolerance. Never a ceiling. */
  const roundingFloor = (field: FurnitureField): number => {
    const value = publishedValue(field);
    // Zero is not evidence of rounding, it is evidence of nothing.
    if (value === undefined || value === 0) return 0;
    if (value % 10 === 0) return ROUNDED_TO_TEN_TOLERANCE_CM;
    if (value % 5 === 0) return ROUNDED_TO_FIVE_TOLERANCE_CM;
    return 0;
  };

  /**
   * The slack a field's number is used with. Always widens the model, never
   * narrows it.
   *
   * An explicit per-field override wins outright, including when it is tighter
   * than the roundness floor — someone who says they measured a 200 cm sofa with
   * a tape is making a claim the pipeline has no business overruling. Absent
   * that, the field gets the wider of the default and what its roundness earns.
   */
  const toleranceOf = (field: FurnitureField): number => {
    const override = input.fieldToleranceCm?.[field];
    if (override !== undefined) return requireTolerance(override, `fieldToleranceCm.${field}`);
    return Math.max(defaultTolerance, roundingFloor(field));
  };
  const usedTolerances = new Map<FurnitureField, number>();
  /** Read a tolerance and remember that this field's number was used loosely. */
  const slackFor = (...fields: readonly FurnitureField[]): number => {
    let widest = 0;
    for (const field of fields) {
      const value = toleranceOf(field);
      usedTolerances.set(field, value);
      widest = Math.max(widest, value);
    }
    return widest;
  };

  const sourceOf = (field: FurnitureField): FieldSource =>
    input.fieldSources?.[field] ?? 'retailer-published';

  /** A number copied straight from the input, whoever measured it. */
  const publish = (field: FurnitureField, value: number): void => {
    const source = sourceOf(field);
    measurements.push({
      field,
      value,
      // An image-derived figure is a real measurement, but it was not published
      // by the shop, so it does not get to wear the shop's tag.
      provenance: source === 'image-derived' ? 'derived' : 'published',
      source,
      from: [field],
      toleranceCm: 0,
    });
  };

  const derive = (field: string, value: number, from: readonly string[]): void => {
    // A derived value is only as direct as its least direct input.
    const source: FieldSource = from.some((f) => sourceOf(f as FurnitureField) === 'image-derived')
      ? 'image-derived'
      : from.some((f) => sourceOf(f as FurnitureField) === 'operator-entered')
        ? 'operator-entered'
        : 'retailer-published';
    measurements.push({ field, value, provenance: 'derived', source, from, toleranceCm: 0 });
  };

  const ignore = (field: string, why: string, whyHe: string): void => {
    flags.push({
      code: 'field-ignored-implausible',
      severity: 'warning',
      en: `${field} was ignored: ${why}. The material it would have carved stays.`,
      he: `${field} לא נלקח בחשבון: ${whyHe}. החומר שהיה נגרע נשאר במקומו.`,
    });
  };

  publish('overallWidthCm', width);
  publish('overallDepthCm', depth);
  publish('overallHeightCm', height);

  const halfW = width / 2;
  const halfD = depth / 2;
  const frontY = -halfD;
  const backY = halfD;

  const shape = input.shape ?? 'unknown';

  // -- separable parts, first, because they are separate items ---------------
  const separableParts = (input.separableParts ?? []).map((part) => buildSeparablePart(part));

  // -- the L-shape escape hatch ---------------------------------------------
  //
  // A corner or chaise sofa is not a box with pieces missing, it is two limbs at
  // right angles, and the void in the corner opposite the return is most of what
  // makes it awkward. Nothing in this contract describes the return leg, so the
  // only sound thing to emit is the bounding box — a superset of the real shape,
  // therefore never a false "it fits". It is also close to useless: it claims a
  // 280 x 200 slab has to cross the doorway when the real item is two limbs
  // under a metre wide. Say so loudly rather than let a caller mistake it for a
  // model.
  const lShapeUnmodelled = shape === 'corner' || shape === 'chaise';
  if (lShapeUnmodelled) {
    flags.push({
      code: 'l-shape-not-modelled',
      severity: 'loud',
      en:
        `Shape is "${shape}" and nothing published describes the return leg, so this is the ` +
        `bounding box and nothing more: a ${width} x ${depth} cm slab standing in for two limbs. ` +
        `It is sound — it can never claim something fits that does not — and it is near-useless ` +
        `in practice. Supply the return leg's own width and depth before trusting any answer ` +
        `about a doorway.`,
      he:
        `הצורה היא "${shape}" ואין נתון שמתאר את המקטע הניצב, ולכן זו תיבה חוסמת בלבד: ` +
        `לוח ${width} על ${depth} ס"מ במקום שתי זרועות. המודל בטוח — הוא לעולם לא יטען ` +
        `שמשהו נכנס כשהוא לא — והוא כמעט חסר תועלת. יש להזין את רוחב ועומק המקטע הניצב.`,
    });
  }

  // -- what the input actually proves ---------------------------------------
  const armrests = resolveArmrests(input);

  let seatHeight: number | undefined;
  if (measured(input.seatHeightCm)) {
    if (input.seatHeightCm >= height) {
      ignore('seatHeightCm', 'it is not below the overall height', 'הוא אינו נמוך מהגובה הכולל');
    } else {
      seatHeight = input.seatHeightCm;
      publish('seatHeightCm', seatHeight);
    }
  }

  let backrestThickness: number | undefined;
  if (measured(input.backrestThicknessCm) && input.backrestThicknessCm < depth) {
    backrestThickness = input.backrestThicknessCm;
    publish('backrestThicknessCm', backrestThickness);
  } else if (measured(input.seatDepthCm)) {
    if (input.seatDepthCm >= depth) {
      ignore('seatDepthCm', 'it is not less than the overall depth', 'הוא אינו קטן מהעומק הכולל');
    } else {
      publish('seatDepthCm', input.seatDepthCm);
      // Rule: backrest thickness = overall depth - seat depth, and only when
      // both are published. Neither number on its own says anything about where
      // the backrest starts.
      backrestThickness = depth - input.seatDepthCm;
      derive('backrestThicknessCm', backrestThickness, ['overallDepthCm', 'seatDepthCm']);
    }
  }

  let armrestHeight: number | undefined;
  if (measured(input.armrestHeightCm)) {
    if (input.armrestHeightCm > height) {
      ignore('armrestHeightCm', 'it exceeds the overall height', 'הוא גבוה מהגובה הכולל');
    } else {
      armrestHeight = input.armrestHeightCm;
      publish('armrestHeightCm', armrestHeight);
    }
  }

  let armrestWidth: number | undefined;
  if (measured(input.armrestWidthCm)) {
    if (input.armrestWidthCm * 2 >= width) {
      ignore('armrestWidthCm', 'two of them would fill the width', 'שתיהן היו ממלאות את כל הרוחב');
    } else {
      armrestWidth = input.armrestWidthCm;
      publish('armrestWidthCm', armrestWidth);
    }
  }

  const legs = resolveLegs(input, height, seatHeight, publish, ignore, flags);

  // The L-shape case emits the bounding box and stops. Carving a straight sofa's
  // front-top out of a corner sofa would carve the wrong limb.
  const mayCarve = !lShapeUnmodelled;

  // -- build the boxes -------------------------------------------------------
  const boxes: Box[] = [];
  const provenance: BoxProvenance[] = [];
  let removableParts: RemovablePart[] | undefined;

  const emit = (box: Box, prov: Omit<BoxProvenance, 'widthCm' | 'depthCm' | 'heightCm'>): number => {
    boxes.push(box);
    provenance.push({
      ...prov,
      widthCm: box.halfExtents.x * 2,
      depthCm: box.halfExtents.y * 2,
      heightCm: box.halfExtents.z * 2,
    });
    return boxes.length - 1;
  };

  // The seat body starts at the top of whatever the leg band actually became,
  // filled in once that is known.
  let legBandTop = 0;
  // An over-reported seat height carves what is really still seat, so the solid
  // body keeps going for another tolerance beyond it.
  const seatSplitZ =
    mayCarve && seatHeight !== undefined
      ? Math.min(height, seatHeight + slackFor('seatHeightCm'))
      : height;
  const bodyTop = seatSplitZ;

  // The leg band. It exists as its own box whenever a leg height is published,
  // because that is what makes the legs nameable and removable. It is narrowed
  // only when an inset proves the perimeter is clear.
  if (mayCarve && legs.bandTop !== undefined) {
    // An over-reported inset carves into real leg, so pull it back. An
    // over-reported leg height carves the perimeter of a band that is really
    // solid body, so lower the band's ceiling by the same reasoning. When the
    // tolerance swallows the inset entirely there is no carve left, and the band
    // reverts to its published height and full width — still named, still
    // removable, just not hollowed.
    const rawInset = legs.insetCm ?? 0;
    const inset = rawInset > 0 ? Math.max(0, rawInset - slackFor('legs.insetCm')) : 0;
    const bandTop =
      inset > 0 ? Math.max(0, legs.bandTop - slackFor('legs.heightCm')) : legs.bandTop;
    const carvesUnderSeat = inset > 0 && bandTop > 0;
    const bandInset = carvesUnderSeat ? inset : 0;
    const bandCeiling = carvesUnderSeat ? bandTop : legs.bandTop;
    const legSlack = carvesUnderSeat
      ? Math.max(slackFor('legs.insetCm'), slackFor('legs.heightCm'))
      : 0;
    const bandIndex = emit(
      spanBox(
        'the legs',
        'הרגליים',
        [-halfW + bandInset, halfW - bandInset],
        [frontY + bandInset, backY - bandInset],
        [0, bandCeiling],
      ),
      {
        label: 'the legs',
        width: carvesUnderSeat ? 'derived' : 'published',
        depth: carvesUnderSeat ? 'derived' : 'published',
        height: 'published',
        toleranceCm: legSlack,
        from: carvesUnderSeat
          ? ['overallWidthCm', 'overallDepthCm', 'legs.insetCm', 'legs.heightCm']
          : ['overallWidthCm', 'overallDepthCm', 'legs.heightCm'],
      },
    );

    if (carvesUnderSeat) {
      const ring = (by: number, top: number): number =>
        (width * depth - Math.max(0, width - 2 * by) * Math.max(0, depth - 2 * by)) * top;
      carves.push({
        region: 'under-seat',
        volumeCm3: ring(inset, bandTop),
        untoleranced: ring(rawInset, legs.bandTop),
        toleranceCm: legSlack,
        provedBy: ['legs.present', 'legs.heightCm', 'legs.insetCm'],
        en:
          `The legs stand ${rawInset} cm in from the edge, so the outer ${inset} cm of the ` +
          `${bandTop} cm band under the body is air on every side.`,
        he:
          `הרגליים מוסטות ${rawInset} ס"מ פנימה, ולכן ${inset} הס"מ החיצוניים של רצועת ` +
          `${bandTop} הס"מ שמתחת לגוף הם אוויר מכל צד.`,
      });
    }

    legBandTop = bandCeiling;
    if (legs.detachable) {
      removableParts = [{ name: 'legs', nameHe: 'הרגליים', boxIndices: [bandIndex] }];
    }
  }

  // The body. Full depth on purpose: a seat depth proves where the backrest's
  // front face is at seat level, and nothing at all about the rear underside.
  emit(spanBox('the seat', 'המושב', [-halfW, halfW], [frontY, backY], [legBandTop, bodyTop]), {
    label: 'the seat',
    width: 'published',
    depth: 'published',
    // The box's own height is `bodyTop - legBandTop`. That is a published number
    // only when it happens to be one of the published heights outright; the
    // moment a leg band is subtracted from it, it is arithmetic.
    height: legBandTop === 0 ? 'published' : 'derived',
    // The body's ceiling sits a tolerance above the published seat height, and
    // its floor a tolerance below the published leg height. Neither moved in a
    // direction that removes material, but both moved.
    toleranceCm: bodyTop === height ? 0 : Math.max(slackFor('seatHeightCm'), legBandTop > 0 ? slackFor('legs.heightCm') : 0),
    from:
      bodyTop === height
        ? ['overallWidthCm', 'overallDepthCm', 'overallHeightCm']
        : ['overallWidthCm', 'overallDepthCm', 'seatHeightCm', ...(legBandTop > 0 ? ['legs.heightCm'] : [])],
  });

  // Everything above seat height.
  if (mayCarve && seatHeight !== undefined && seatSplitZ < height) {
    if (backrestThickness === undefined) {
      // No proof of where the backrest starts, so the whole band stays solid.
      // Emitting it as one box rather than none is what keeps the union equal to
      // the bounding box.
      emit(
        spanBox('the back and arms', 'המשענת והידיות', [-halfW, halfW], [frontY, backY], [seatSplitZ, height]),
        {
          label: 'the back and arms',
          width: 'published',
          depth: 'published',
          height: 'derived',
          toleranceCm: 0,
          from: ['overallWidthCm', 'overallDepthCm', 'overallHeightCm', 'seatHeightCm'],
        },
      );
    } else {
      // An over-reported seat depth thins the derived backrest, which carves
      // into the real one. Thicken the band by the slack in whichever numbers
      // produced it, so its front face never lands behind the real one.
      const backrestSlack = measured(input.backrestThicknessCm)
        ? slackFor('backrestThicknessCm')
        : slackFor('overallDepthCm', 'seatDepthCm');
      const backFaceY = Math.max(frontY, backY - backrestThickness - backrestSlack);

      // Rule: the backrest band spans seat height to overall height.
      emit(
        spanBox('the backrest', 'המשענת', [-halfW, halfW], [backFaceY, backY], [seatSplitZ, height]),
        {
          label: 'the backrest',
          width: 'published',
          depth: 'derived',
          height: 'derived',
          toleranceCm: Math.max(backrestSlack, slackFor('seatHeightCm')),
          from: ['overallWidthCm', 'backrestThicknessCm', 'seatHeightCm', 'overallHeightCm'],
        },
      );

      emitFrontTop({
        armrests,
        armrestWidth,
        armrestHeight,
        seatSplitZ,
        seatSplitExact: seatHeight,
        backFaceExact: Math.max(frontY, backY - backrestThickness),
        height,
        width,
        halfW,
        frontY,
        backFaceY,
        slackFor,
        emit,
        carves,
      });
    }
  }

  // -- collapse when nothing was proved -------------------------------------
  //
  // A model that carved nothing IS the bounding box, and saying so in one box
  // rather than three is not cosmetic: a caller can test `boxes.length === 1`
  // and know it is looking at the floor of what this pipeline can do.
  const carvedVolumeCm3 = carves.reduce((sum, carve) => sum + carve.volumeCm3, 0);

  let finalBoxes: readonly Box[] = boxes;
  let finalProvenance: readonly BoxProvenance[] = provenance;
  if (carvedVolumeCm3 === 0 && removableParts === undefined) {
    finalBoxes = [
      spanBox('the whole body', 'הגוף כולו', [-halfW, halfW], [frontY, backY], [0, height]),
    ];
    finalProvenance = [
      {
        label: 'the whole body',
        widthCm: width,
        depthCm: depth,
        heightCm: height,
        width: 'published',
        depth: 'published',
        height: 'published',
        toleranceCm: 0,
        from: ['overallWidthCm', 'overallDepthCm', 'overallHeightCm'],
      },
    ];
  }

  // Growth of the outer skin, last, so that nothing above had to reason about
  // two coordinate systems. Default zero, so by default this changes nothing.
  if (overallTolerance > 0) {
    const half = { x: halfW, y: halfD, z: height / 2 };
    finalBoxes = finalBoxes.map((box) => grown(box, half, overallTolerance));
    finalProvenance = finalProvenance.map((prov, index) => ({
      ...prov,
      widthCm: finalBoxes[index]!.halfExtents.x * 2,
      depthCm: finalBoxes[index]!.halfExtents.y * 2,
      heightCm: finalBoxes[index]!.halfExtents.z * 2,
      toleranceCm: Math.max(prov.toleranceCm, overallTolerance),
    }));
    flags.push({
      code: 'bounding-box-grown',
      severity: 'note',
      en:
        `The outer skin was pushed out ${overallTolerance} cm on each side and at the top, ` +
        `so this model stands in for an item up to ${width + 2 * overallTolerance} x ` +
        `${depth + 2 * overallTolerance} x ${height + overallTolerance} cm rather than the ` +
        'published size. Internal partitions did not move.',
      he:
        `המעטפת החיצונית הורחבה ב-${overallTolerance} ס"מ בכל צד ובחלק העליון, ולכן המודל ` +
        `מייצג פריט של עד ${width + 2 * overallTolerance} על ${depth + 2 * overallTolerance} על ` +
        `${height + overallTolerance} ס"מ ולא את המידות שפורסמו. החלוקות הפנימיות לא זזו.`,
    });
  }

  const modelledWidth = width + 2 * overallTolerance;
  const modelledDepth = depth + 2 * overallTolerance;
  const modelledHeight = height + overallTolerance;

  // What tolerance handed back to the model rather than carving away.
  const untolerancedCarve = carves.reduce((sum, carve) => sum + carve.untoleranced, 0);
  const tolerance: ToleranceReport = {
    defaultCm: defaultTolerance,
    overallCm: overallTolerance,
    // Every field whose slack is not simply the default: an explicit override,
    // or a floor its own roundness earned it.
    byField: Object.fromEntries(
      [...usedTolerances.entries()].filter(([, value]) => value !== defaultTolerance),
    ),
    costCm3: Math.max(0, untolerancedCarve - carvedVolumeCm3),
  };

  // Every field that fed a carve carries the slack it was used with, so a number
  // taken literally is distinguishable from one the geometry stood back from.
  const measurementsWithSlack = measurements.map((entry) => ({
    ...entry,
    toleranceCm: usedTolerances.get(entry.field as FurnitureField) ?? entry.toleranceCm,
  }));

  if (carvedVolumeCm3 === 0 && !lShapeUnmodelled) {
    flags.push({
      code: 'bounding-box-only',
      severity: 'warning',
      en:
        'Nothing published proves any material is missing, so this model is the bounding box. ' +
        'It is sound and it is pessimistic: it will report "no path found" for doorways this ' +
        'item would actually clear.',
      he:
        'אין נתון שמוכיח היעדר חומר, ולכן המודל הוא התיבה החוסמת. הוא בטוח והוא פסימי: ' +
        'הוא ידווח "לא נמצא מסלול" גם בפתחים שהפריט היה עובר בהם.',
    });
  }

  const item: Item = {
    id: input.id ?? 'furniture',
    name: input.name ?? 'furniture',
    nameHe: input.nameHe ?? 'רהיט',
    boxes: finalBoxes,
    ...(removableParts ? { removableParts } : {}),
  };

  const improvements = rankImprovements({
    input,
    width,
    depth,
    height,
    seatHeight,
    backrestThickness,
    armrests,
    armrestWidth,
    armrestHeight,
    legs,
    lShapeUnmodelled,
  });

  return {
    pipelineVersion: FURNITURE_PIPELINE_VERSION,
    tolerance,
    item,
    separableParts,
    boundingBox: { widthCm: modelledWidth, depthCm: modelledDepth, heightCm: modelledHeight },
    boundingVolumeCm3: modelledWidth * modelledDepth * modelledHeight,
    carvedVolumeCm3,
    carves,
    measurements: measurementsWithSlack,
    boxProvenance: finalProvenance,
    confidence: tierFor({
      carvedVolumeCm3,
      lShapeUnmodelled,
      splitProved: seatHeight !== undefined && backrestThickness !== undefined,
      armrestsProved: armrests !== 'unknown' && (armrests === 'none' || armrestWidth !== undefined),
      legsProved: legsAreSettled(input, legs),
    }),
    improvements,
    flags,
  };
}

// ---------------------------------------------------------------------------
// The front-top region: the one place armrest facts do their work
// ---------------------------------------------------------------------------

interface FrontTopArgs {
  armrests: ArmrestPresence;
  armrestWidth: number | undefined;
  armrestHeight: number | undefined;
  /** Top of the solid body: the published seat height plus its own tolerance. */
  seatSplitZ: number;
  /** The same two boundaries with the numbers taken literally, for the `untoleranced` figures. */
  seatSplitExact: number;
  backFaceExact: number;
  height: number;
  width: number;
  halfW: number;
  frontY: number;
  backFaceY: number;
  slackFor: (...fields: readonly FurnitureField[]) => number;
  emit: (box: Box, prov: Omit<BoxProvenance, 'widthCm' | 'depthCm' | 'heightCm'>) => number;
  carves: Carve[];
}

/**
 * Everything above the seat and in front of the backrest.
 *
 * That region contains exactly one thing on a sofa: the armrests. So the
 * armrest facts are the only ones that can carve it, and each of them carves a
 * different part —
 *
 * - armrests known absent: the whole region is air.
 * - an armrest width: air *between* the arms.
 * - an armrest height: air *above* the arms.
 *
 * Any of these missing and the corresponding material stays.
 */
function emitFrontTop(args: FrontTopArgs): void {
  const {
    armrests,
    armrestWidth,
    armrestHeight,
    seatSplitZ,
    seatSplitExact,
    backFaceExact,
    height,
    width,
    halfW,
    frontY,
    backFaceY,
    slackFor,
    emit,
    carves,
  } = args;

  const frontDepth = backFaceY - frontY;
  const bandHeight = height - seatSplitZ;
  if (frontDepth <= 0 || bandHeight <= 0) return;

  // The same region with every number taken literally: what each carve below
  // would have been, so the cost of the slack is a figure and not an adjective.
  const exactFrontDepth = Math.max(0, backFaceExact - frontY);
  const exactBandHeight = Math.max(0, height - seatSplitExact);

  // The region's own two boundaries already carry the slack in the seat height
  // and the seat depth; whatever is carved inside it inherits that.
  const regionSlack = Math.max(slackFor('seatHeightCm'), slackFor('seatDepthCm'));

  if (armrests === 'none') {
    carves.push({
      region: 'front-top',
      volumeCm3: width * frontDepth * bandHeight,
      // "No armrests" is a fact rather than a measurement, so nothing is pulled
      // back on its account — but the region's own two boundaries moved, and
      // this is the carve those boundaries would have made untouched.
      untoleranced: width * exactFrontDepth * exactBandHeight,
      toleranceCm: regionSlack,
      provedBy: ['armrests', 'seatDepthCm', 'seatHeightCm'],
      en:
        'No armrests, and the seat depth says where the backrest starts, so everything above ' +
        `the seat and in front of the backrest — ${width} x ${frontDepth} x ${bandHeight} cm — ` +
        'is air.',
      he:
        'אין ידיות, והעומק של המושב מגדיר היכן מתחילה המשענת, ולכן כל מה שמעל המושב ולפני ' +
        `המשענת — ${width} על ${frontDepth} על ${bandHeight} ס"מ — הוא אוויר.`,
    });
    return;
  }

  // Arms top out at their published height; with none published they could
  // reach the top of the item, and so they do. An under-reported arm height
  // would carve the top of a real arm, so the arm is allowed to be that much
  // taller than the listing says.
  const armSlack = slackFor('armrestHeightCm');
  const armTop =
    armrestHeight === undefined
      ? height
      : Math.min(height, Math.max(armrestHeight + armSlack, seatSplitZ));
  const armTopExact =
    armrestHeight === undefined
      ? height
      : Math.min(height, Math.max(armrestHeight, seatSplitExact));

  // An under-reported arm width would carve into a real arm, so the arm kept in
  // the model is that much wider. If the slack would make the two arms meet,
  // there is no width carve left to make.
  const widthSlack = slackFor('armrestWidthCm');
  const keptArmWidth = armrestWidth === undefined ? undefined : armrestWidth + widthSlack;
  // A kept width of zero means the arms have no substance to model: the band
  // between them is the whole band, which is the 'none' case reached by
  // arithmetic rather than by reading a category out of a number.
  const armsFitApart = keptArmWidth !== undefined && keptArmWidth > 0 && keptArmWidth * 2 < width;
  const armsAreNothing = keptArmWidth !== undefined && keptArmWidth <= 0;

  if (armsAreNothing) {
    carves.push({
      region: 'front-top',
      volumeCm3: width * frontDepth * bandHeight,
      untoleranced: width * exactFrontDepth * exactBandHeight,
      toleranceCm: Math.max(widthSlack, regionSlack),
      provedBy: ['armrestWidthCm', 'seatDepthCm', 'seatHeightCm'],
      en:
        'The published armrest width is zero and no slack was allowed for it, so the band ' +
        'above the seat and in front of the backrest is empty.',
      he:
        'רוחב הידית שפורסם הוא אפס ולא ניתן לו מרווח, ולכן הרצועה שמעל המושב ולפני המשענת ריקה.',
    });
    return;
  }

  if (armTop > seatSplitZ) {
    if (armsFitApart) {
      emit(
        spanBox('the armrests', 'הידיות', [-halfW, -halfW + keptArmWidth!], [frontY, backFaceY], [seatSplitZ, armTop]),
        {
          label: 'the armrests',
          width: 'published',
          depth: 'derived',
          height: armrestHeight === undefined ? 'derived' : 'published',
          toleranceCm: Math.max(widthSlack, armSlack, regionSlack),
          from: ['armrestWidthCm', 'backrestThicknessCm', 'seatHeightCm', 'armrestHeightCm'],
        },
      );
      emit(
        spanBox('the armrests', 'הידיות', [halfW - keptArmWidth!, halfW], [frontY, backFaceY], [seatSplitZ, armTop]),
        {
          label: 'the armrests',
          width: 'published',
          depth: 'derived',
          height: armrestHeight === undefined ? 'derived' : 'published',
          toleranceCm: Math.max(widthSlack, armSlack, regionSlack),
          from: ['armrestWidthCm', 'backrestThicknessCm', 'seatHeightCm', 'armrestHeightCm'],
        },
      );
      carves.push({
        region: 'between-armrests',
        volumeCm3: (width - 2 * keptArmWidth!) * frontDepth * (armTop - seatSplitZ),
        untoleranced:
          Math.max(0, width - 2 * armrestWidth!) * exactFrontDepth * Math.max(0, armTopExact - seatSplitExact),
        toleranceCm: Math.max(widthSlack, regionSlack),
        provedBy: ['armrestWidthCm', 'seatDepthCm', 'seatHeightCm'],
        en:
          `Each armrest is ${armrestWidth} cm wide, so the ${width - 2 * keptArmWidth!} cm ` +
          'between them is air from the seat up.',
        he: `כל ידית ברוחב ${armrestWidth} ס"מ, ולכן ${width - 2 * keptArmWidth!} הס"מ שביניהן הם אוויר מהמושב ומעלה.`,
      });
    } else {
      // Arms present, width unknown: they could be any width, so the band stays
      // full width. Its height is still bounded by the published armrest height.
      emit(
        spanBox('the armrests', 'הידיות', [-halfW, halfW], [frontY, backFaceY], [seatSplitZ, armTop]),
        {
          label: 'the armrests',
          width: 'published',
          depth: 'derived',
          height: armrestHeight === undefined ? 'derived' : 'published',
          toleranceCm: Math.max(armSlack, regionSlack),
          from: ['overallWidthCm', 'backrestThicknessCm', 'seatHeightCm', 'armrestHeightCm'],
        },
      );
    }
  }

  if (armTop < height) {
    carves.push({
      region: 'above-armrests',
      volumeCm3: width * frontDepth * (height - armTop),
      untoleranced: width * exactFrontDepth * Math.max(0, height - armTopExact),
      toleranceCm: Math.max(armSlack, regionSlack),
      provedBy: ['armrestHeightCm', 'seatDepthCm'],
      en:
        `The armrests top out at ${armTop} cm and the backrest is behind them, so the ` +
        `${height - armTop} cm above them and in front of the backrest is air.`,
      he:
        `הידיות מסתיימות בגובה ${armTop} ס"מ והמשענת מאחוריהן, ולכן ${height - armTop} ` +
        `הס"מ שמעליהן ולפני המשענת הם אוויר.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Reading the input
// ---------------------------------------------------------------------------

/**
 * Whether the item has armrests, from what the listing actually says.
 *
 * Only `armrests: 'none'` is read as the *fact* that there are none. A published
 * width of zero used to be read that way too — "a shop saying no arms in
 * numbers" — and that was a hole in the fatal direction, because a fact carries
 * no tolerance: a width of 4 cm mis-stated as 0 emptied the whole band above the
 * seat, armrests and all. The extended perturbation sweep found it.
 *
 * A zero is now what it looks like: a measurement of zero, which under a
 * tolerance of `t` means an armrest up to `t` wide. That is arithmetic rather
 * than interpretation, it costs nothing when the shop meant it (the band is
 * carved anyway, less the tolerance), and it removes the last place where this
 * file inferred a category from a number.
 */
function resolveArmrests(input: FurnitureInput): ArmrestPresence {
  if (input.armrests === 'none') return 'none';
  if (input.armrests === 'present') return 'present';
  if (measured(input.armrestWidthCm) || measured(input.armrestHeightCm)) return 'present';
  return 'unknown';
}

interface ResolvedLegs {
  /** Top of the leg band. Undefined when no leg height is proved. */
  bandTop?: number;
  insetCm?: number;
  detachable: boolean;
}

function resolveLegs(
  input: FurnitureInput,
  height: number,
  seatHeight: number | undefined,
  publish: (field: FurnitureField, value: number) => void,
  ignore: (field: string, why: string, whyHe: string) => void,
  flags: ModelFlag[],
): ResolvedLegs {
  const spec = input.legs;
  if (spec === undefined || spec.present !== true) return { detachable: false };
  if (!measured(spec.heightCm) || spec.heightCm === 0) {
    // Rule: `present: true` with no height carves nothing. Knowing there are
    // legs without knowing how tall they are locates no air at all.
    return { detachable: false };
  }
  const legHeight = spec.heightCm;
  if (legHeight >= height || (seatHeight !== undefined && legHeight >= seatHeight)) {
    ignore(
      'legs.heightCm',
      'the legs are not shorter than the body above them',
      'הרגליים אינן נמוכות מהגוף שמעליהן',
    );
    return { detachable: false };
  }
  publish('legs.heightCm', legHeight);

  // Height convention: published heights are measured from the floor and so
  // already include the legs. Seat height minus leg height is therefore the
  // thickness of the seat body itself, and a seat body under ~10 cm means the
  // two numbers are not measuring what their names say.
  if (seatHeight !== undefined && seatHeight - legHeight < MIN_PLAUSIBLE_SEAT_BODY_CM) {
    flags.push({
      code: 'seat-body-implausibly-thin',
      severity: 'warning',
      en:
        `Seat height ${seatHeight} cm minus leg height ${legHeight} cm leaves a seat body of ` +
        `${seatHeight - legHeight} cm, under the ${MIN_PLAUSIBLE_SEAT_BODY_CM} cm a seat can ` +
        'plausibly be. One of the two is probably measuring something else.',
      he:
        `גובה מושב ${seatHeight} ס"מ פחות גובה רגל ${legHeight} ס"מ משאיר גוף מושב של ` +
        `${seatHeight - legHeight} ס"מ, מתחת ל-${MIN_PLAUSIBLE_SEAT_BODY_CM} ס"מ הסבירים. ` +
        'ככל הנראה אחד משני המספרים מודד משהו אחר.',
    });
  }

  let inset: number | undefined;
  if (measured(spec.insetCm) && spec.insetCm > 0) {
    const smallestHalfSpan = Math.min(input.overallWidthCm, input.overallDepthCm) / 2;
    if (spec.insetCm >= smallestHalfSpan) {
      ignore('legs.insetCm', 'it would meet in the middle', 'הוא היה נפגש באמצע');
    } else {
      inset = spec.insetCm;
      publish('legs.insetCm', inset);
    }
  }

  return { bandTop: legHeight, insetCm: inset, detachable: spec.detachable === true };
}

function legsAreSettled(input: FurnitureInput, legs: ResolvedLegs): boolean {
  if (input.legs?.present === false) return true;
  return legs.bandTop !== undefined && legs.insetCm !== undefined;
}

function buildSeparablePart(part: SeparablePartInput): FurnitureModelResult {
  if (part.separableParts !== undefined) {
    throw new RangeError('separableParts may not nest: a part with parts of its own is a catalogue, not an item');
  }
  return buildFurnitureModel({ ...part, separableParts: undefined });
}

// ---------------------------------------------------------------------------
// Confidence and the improvement list
// ---------------------------------------------------------------------------

function tierFor(args: {
  carvedVolumeCm3: number;
  lShapeUnmodelled: boolean;
  splitProved: boolean;
  armrestsProved: boolean;
  legsProved: boolean;
}): ConfidenceTier {
  if (args.lShapeUnmodelled || args.carvedVolumeCm3 === 0) return 'bounding-box-only';
  const proofs = [args.splitProved, args.armrestsProved, args.legsProved].filter(Boolean).length;
  if (proofs >= 3) return 'high';
  if (proofs === 2) return 'medium';
  return 'low';
}

interface RankArgs {
  input: FurnitureInput;
  width: number;
  depth: number;
  height: number;
  seatHeight: number | undefined;
  backrestThickness: number | undefined;
  armrests: ArmrestPresence;
  armrestWidth: number | undefined;
  armrestHeight: number | undefined;
  legs: ResolvedLegs;
  lShapeUnmodelled: boolean;
}

/**
 * Which single field would most improve this model, ranked by how much material
 * it could prove is air.
 *
 * The same list drives two things: the questions a store operator is asked to
 * fill in, and — later — which measurement the image stage should go looking
 * for first. Both want the same order, which is why it is one list.
 */
function rankImprovements(args: RankArgs): readonly ImprovementRequest[] {
  const { input, width, depth, height, seatHeight, backrestThickness, armrests, legs } = args;
  const candidates: { field: ImprovementField; estimate: number; en: string; he: string }[] = [];

  const effectiveSeatHeight = seatHeight ?? height * NOMINAL_SEAT_HEIGHT_FRACTION;
  const effectiveSeatDepth = measured(input.seatDepthCm)
    ? input.seatDepthCm
    : depth * NOMINAL_SEAT_DEPTH_FRACTION;
  const frontDepth = backrestThickness === undefined ? effectiveSeatDepth : depth - backrestThickness;
  const bandHeight = Math.max(0, height - effectiveSeatHeight);
  const frontTopVolume = width * frontDepth * bandHeight;

  if (args.lShapeUnmodelled) {
    candidates.push({
      field: 'returnLegDimensions',
      // The return leg is what the bounding box gets wrong, and it gets it wrong
      // by the whole corner void — always the largest single gap on an L.
      estimate: width * depth * height,
      en:
        'The return leg\'s own width and depth. Without them the model is a solid slab where ' +
        'the real item is two limbs, and every doorway answer about it is worthless.',
      he:
        'רוחב ועומק המקטע הניצב. בלעדיהם המודל הוא לוח מלא במקום שתי זרועות, וכל תשובה על פתח היא חסרת ערך.',
    });
  }

  if (armrests === 'unknown') {
    candidates.push({
      field: 'armrests',
      estimate: frontTopVolume,
      en: 'Whether it has armrests at all. "No" empties the whole band above the seat and in front of the backrest.',
      he: 'האם יש ידיות בכלל. "לא" מרוקן את כל הרצועה שמעל המושב ולפני המשענת.',
    });
  } else if (armrests === 'present' && args.armrestWidth === undefined) {
    candidates.push({
      field: 'armrestWidthCm',
      estimate: Math.max(0, width - 2 * NOMINAL_ARMREST_WIDTH_CM) * frontDepth * bandHeight,
      en: 'The width of one armrest. It proves the span between the arms is air.',
      he: 'רוחב ידית אחת. הוא מוכיח שהמרווח שבין הידיות הוא אוויר.',
    });
  }

  if (armrests !== 'none' && args.armrestHeight === undefined) {
    candidates.push({
      field: 'armrestHeightCm',
      estimate: frontTopVolume * NOMINAL_ABOVE_ARMREST_FRACTION,
      en: 'The armrest height. It proves the air above the arms and in front of the backrest.',
      he: 'גובה הידית. הוא מוכיח את האוויר שמעל הידיות ולפני המשענת.',
    });
  }

  if (backrestThickness === undefined) {
    candidates.push({
      field: 'seatDepthCm',
      estimate: frontTopVolume,
      en:
        'The seat depth. On its own it carves nothing; it is what tells the backrest apart from ' +
        'the arms, and every armrest fact needs that before it can carve anything.',
      he:
        'עומק המושב. לבדו אינו גורע דבר; הוא מה שמפריד בין המשענת לידיות, וכל נתון על הידיות זקוק לו.',
    });
  }

  if (seatHeight === undefined) {
    candidates.push({
      field: 'seatHeightCm',
      estimate: width * depth * height * (1 - NOMINAL_SEAT_HEIGHT_FRACTION),
      en: 'The seat height. Nothing above the seat can be carved until the model knows where the seat is.',
      he: 'גובה המושב. אי אפשר לגרוע דבר מעל המושב לפני שידוע היכן המושב.',
    });
  }

  const ringVolume = (inset: number, bandTop: number): number =>
    (width * depth - Math.max(0, width - 2 * inset) * Math.max(0, depth - 2 * inset)) * bandTop;

  if (legs.bandTop !== undefined && legs.insetCm === undefined) {
    candidates.push({
      field: 'legs.insetCm',
      estimate: ringVolume(NOMINAL_LEG_INSET_CM, legs.bandTop),
      en:
        `The legs are ${legs.bandTop} cm tall, but nothing says where in plan they stand, so ` +
        'that band is still solid. How far in from the edge they sit is what empties it.',
      he:
        `הרגליים בגובה ${legs.bandTop} ס"מ, אך אין נתון היכן הן ניצבות במישור, ולכן הרצועה עדיין מלאה. ` +
        'המרחק שלהן מהקצה הוא מה שירוקן אותה.',
    });
  } else if (input.legs?.present !== false && legs.bandTop === undefined) {
    candidates.push({
      field: 'legs',
      estimate: ringVolume(NOMINAL_LEG_INSET_CM, NOMINAL_LEG_HEIGHT_CM),
      en: 'Whether it stands on legs, how tall they are, and how far in they sit.',
      he: 'האם היא עומדת על רגליים, מה גובהן, וכמה הן מוסטות פנימה.',
    });
  }

  candidates.sort((a, b) => {
    if (b.estimate !== a.estimate) return b.estimate - a.estimate;
    return IMPROVEMENT_ORDER.indexOf(a.field) - IMPROVEMENT_ORDER.indexOf(b.field);
  });

  return candidates.map((candidate, index) => ({
    rank: index + 1,
    field: candidate.field,
    estimatedCarveCm3: candidate.estimate,
    en: candidate.en,
    he: candidate.he,
  }));
}
