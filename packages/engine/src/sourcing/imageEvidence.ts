/**
 * The image seam, filled in: an elevation photograph becomes `legs.heightCm`
 * and `legs.insetCm`, and nothing else.
 *
 * ## Why only the legs
 *
 * The ground-truth table says the entire remaining gap between a model built
 * from a listing and the real furniture is two things: where the legs stand in
 * plan, and the return leg of an L-shaped sofa. This does the first. It is not
 * general image understanding, it is two measurements — and the leg inset is
 * the one no retailer publishes, so it is the one the image is for.
 *
 * ## What the vision model is allowed to say
 *
 * Discrete answers only, on `ImageClassification`. Is this a front elevation, a
 * side elevation, a plan, or a three-quarter shot; are there legs; are there
 * armrests; is it straight or L-shaped. It never returns a coordinate, a
 * proportion, or a dimension, and nothing it says becomes a number in a model.
 * The numbers all come from counting pixels in `silhouette.ts`.
 *
 * ## What is rejected outright
 *
 * Anything that is not a front or side elevation. A three-quarter shot — which
 * is most product photography — is refused with a reason rather than
 * perspective-corrected, because correcting it means recovering a camera pose
 * from a sofa, and a pose recovered badly does not fail loudly. It quietly
 * returns a leg band a few centimetres too short, which carves material that is
 * really there.
 */

import type { FieldSource, FurnitureInput, LegSpec } from './types.ts';
import { legBandOf, rowProfile, silhouetteOf, type Bitmap, type LegBandReading } from './silhouette.ts';

/** Which view the vision model says a picture is. Only two of these are usable. */
export type ShotType =
  | 'front-elevation'
  | 'side-elevation'
  | 'plan'
  | 'three-quarter'
  | 'detail'
  | 'unusable';

/**
 * Everything the vision model is permitted to contribute.
 *
 * Every field is a choice from a fixed set. There is deliberately nowhere to put
 * a number: if a future version of this interface grows a field whose type is
 * `number`, the split this subsystem rests on has been abandoned.
 */
export interface ImageClassification {
  shot: ShotType;
  legs: 'present' | 'none' | 'unknown';
  armrests: 'present' | 'none' | 'unknown';
  shape: 'straight' | 'corner' | 'chaise' | 'unknown';
}

/** One picture, and what the model said about it. */
export interface ClassifiedImage {
  bitmap: Bitmap;
  classification: ImageClassification;
}

/**
 * How wrong an image-derived measurement is, in centimetres.
 *
 * **Measured, like the input tolerance, not chosen.**
 * `test/imageEvidence.test.ts` renders each catalogue fixture's own elevation at
 * several resolutions and re-measures it, with the threshold pushed both ways to
 * stand in for a soft or shadowed edge. Across the catalogue the worst error in
 * the leg height is under half a centimetre and in the inset under a
 * centimetre — but that is the *quantisation floor*, measured on renders that
 * are perfectly orthographic, perfectly lit and perfectly aligned.
 *
 * The shipped figure is larger than the floor on purpose, and the difference is
 * the terms the fixtures cannot exercise:
 *
 *  - the scale is a published dimension, which carries its own five centimetres
 *    of doubt. A leg band read as 17.6% of height becomes 0.9 cm of error on an
 *    85 cm sofa from that alone, and this term is irreducible because the image
 *    supplies proportions and never a scale;
 *  - a real photograph's edge is soft, and its background is not uniform where
 *    a shadow meets the floor. The threshold sweep measures some of this, not
 *    all of it;
 *  - even a shot a model calls a front elevation usually has a degree or two of
 *    camera elevation. Rejecting three-quarter shots bounds this but does not
 *    remove it, and it is the one term with no measurement here at all.
 *
 * Three centimetres covers the measured floor several times over and the scale
 * term with room to spare. It is deliberately not tighter: an image-derived
 * inset that is too large carves material that is really there, which is the
 * failure this whole subsystem is built to make impossible.
 */
export const IMAGE_MEASUREMENT_TOLERANCE_CM = 3;

export type RejectionReason =
  | 'not-an-elevation'
  | 'no-silhouette'
  | 'no-leg-band'
  | 'legs-said-absent'
  | 'inset-needs-both-elevations';

export interface ImageEvidenceResult {
  /** Fields to merge into a `FurnitureInput`. Empty when nothing could be measured. */
  legs?: Pick<LegSpec, 'heightCm' | 'insetCm'>;
  /** The per-field sources and tolerances these numbers must be merged with. */
  fieldSources: Partial<Record<'legs.heightCm' | 'legs.insetCm', FieldSource>>;
  fieldToleranceCm: Partial<Record<'legs.heightCm' | 'legs.insetCm', number>>;
  /** What was measured, as fractions, before any published dimension touched it. */
  readings: readonly { elevation: 'front' | 'side'; band: LegBandReading }[];
  /** Why a field is missing. Always populated when something was refused. */
  rejections: readonly { reason: RejectionReason; en: string; he: string }[];
}

const USABLE: ReadonlySet<ShotType> = new Set<ShotType>(['front-elevation', 'side-elevation']);

/**
 * Measure the leg band from one or more classified images.
 *
 * `legs.heightCm` needs one elevation: the band's height is a vertical
 * measurement and either view shows it.
 *
 * `legs.insetCm` needs **both**. A front elevation proves how far the legs stand
 * in from the ends; it says nothing about how far they stand in from the front
 * and back faces, and `insetCm` is one number that the model applies to both
 * plan axes. The three-seat fixture is the case in point — its legs sit 6 cm in
 * on one axis and 3.5 cm on the other, so a front elevation alone would claim
 * 6 cm of clearance on an axis that has 3.5. With both views the smaller wins,
 * which is the only sound way to collapse two numbers into one.
 */
export function measureLegsFromImages(
  images: readonly ClassifiedImage[],
  published: Pick<FurnitureInput, 'overallWidthCm' | 'overallDepthCm' | 'overallHeightCm'>,
): ImageEvidenceResult {
  const rejections: { reason: RejectionReason; en: string; he: string }[] = [];
  const readings: { elevation: 'front' | 'side'; band: LegBandReading }[] = [];

  for (const image of images) {
    const { shot, legs } = image.classification;

    if (!USABLE.has(shot)) {
      rejections.push({
        reason: 'not-an-elevation',
        en:
          `A "${shot}" is not measurable. Only a front or side elevation is, because everything ` +
          'here is measured as a fraction of the silhouette and a shot with perspective in it has ' +
          'no single scale. Correcting one would mean recovering the camera pose from the sofa, ' +
          'and a pose recovered badly returns a leg band a few centimetres short without saying so.',
        he:
          `תצלום מסוג "${shot}" אינו ניתן למדידה. רק היטל חזית או היטל צד, משום שהכול נמדד ביחס ` +
          'לצללית, ובתצלום עם פרספקטיבה אין קנה מידה אחד. תיקון פרספקטיבה היה מחייב שחזור מיקום ' +
          'המצלמה, ושחזור שגוי מחזיר רצועת רגליים קצרה מדי בלי להודיע על כך.',
      });
      continue;
    }

    if (legs === 'none') {
      rejections.push({
        reason: 'legs-said-absent',
        en: 'The picture was classified as having no legs, so there is no band to measure.',
        he: 'התצלום סווג כחסר רגליים, ולכן אין רצועה למדוד.',
      });
      continue;
    }

    const silhouette = silhouetteOf(image.bitmap);
    if (silhouette === undefined) {
      rejections.push({
        reason: 'no-silhouette',
        en: 'Nothing separated from the background, so there is no silhouette to measure.',
        he: 'שום דבר לא הופרד מהרקע, ולכן אין צללית למדוד.',
      });
      continue;
    }

    const band = legBandOf(rowProfile(silhouette));
    if (band === undefined) {
      rejections.push({
        reason: 'no-leg-band',
        en:
          'The silhouette is solid to the floor. That is the right answer for a plinth or a sofa ' +
          'bed, and it is not a failure — there is simply no air under this one to find.',
        he:
          'הצללית מלאה עד הרצפה. זו התשובה הנכונה עבור בסיס או ספה נפתחת, וזה אינו כישלון — ' +
          'פשוט אין כאן אוויר למצוא.',
      });
      continue;
    }

    readings.push({ elevation: shot === 'front-elevation' ? 'front' : 'side', band });
  }

  if (readings.length === 0) {
    return { fieldSources: {}, fieldToleranceCm: {}, readings, rejections };
  }

  // The band's height is the same measurement in either view, so the smallest
  // reading is the sound one: it claims the least air.
  const heightCm = Math.min(
    ...readings.map((reading) => reading.band.heightFraction * published.overallHeightCm),
  );

  const front = readings.find((reading) => reading.elevation === 'front');
  const side = readings.find((reading) => reading.elevation === 'side');

  const legs: { heightCm: number; insetCm?: number } = { heightCm };
  const fieldSources: ImageEvidenceResult['fieldSources'] = { 'legs.heightCm': 'image-derived' };
  const fieldToleranceCm: ImageEvidenceResult['fieldToleranceCm'] = {
    'legs.heightCm': IMAGE_MEASUREMENT_TOLERANCE_CM,
  };

  if (front !== undefined && side !== undefined) {
    legs.insetCm = Math.min(
      front.band.insetFraction * published.overallWidthCm,
      side.band.insetFraction * published.overallDepthCm,
    );
    fieldSources['legs.insetCm'] = 'image-derived';
    fieldToleranceCm['legs.insetCm'] = IMAGE_MEASUREMENT_TOLERANCE_CM;
  } else {
    rejections.push({
      reason: 'inset-needs-both-elevations',
      en:
        'Only one elevation was usable, so the leg height is reported and the inset is not. One ' +
        'view proves how far the legs stand in on one plan axis and says nothing about the other, ' +
        'while the model applies a single inset to both. The three-seat fixture stands 6 cm in ' +
        'across and 3.5 cm deep, so a front view alone would claim clearance that is not there.',
      he:
        'רק היטל אחד היה שמיש, ולכן מדווח גובה הרגל ולא ההסטה. היטל יחיד מוכיח את ההסטה בציר ' +
        'אחד בלבד, בעוד המודל מחיל הסטה אחת על שני הצירים.',
    });
  }

  return { legs, fieldSources, fieldToleranceCm, readings, rejections };
}

/**
 * Fold image evidence into a listing, without letting it overwrite a shop.
 *
 * A published number stays: it was measured on the actual object with a tape,
 * and a proportion read off a photograph is not better evidence than that. The
 * image fills gaps — which is the whole of its value here, since `legs.insetCm`
 * is a field no retailer publishes at all.
 */
export function withImageEvidence(
  input: FurnitureInput,
  evidence: ImageEvidenceResult,
): FurnitureInput {
  if (evidence.legs === undefined) return input;

  const existing = input.legs;
  const heightCm = existing?.heightCm ?? evidence.legs.heightCm;
  const insetCm = existing?.insetCm ?? evidence.legs.insetCm;

  // Only tag and loosen the fields the image actually supplied.
  const contributed = {
    'legs.heightCm': existing?.heightCm === undefined && evidence.legs.heightCm !== undefined,
    'legs.insetCm': existing?.insetCm === undefined && evidence.legs.insetCm !== undefined,
  };

  const fieldSources = { ...input.fieldSources };
  const fieldToleranceCm = { ...input.fieldToleranceCm };
  for (const field of ['legs.heightCm', 'legs.insetCm'] as const) {
    if (!contributed[field]) continue;
    fieldSources[field] = evidence.fieldSources[field];
    fieldToleranceCm[field] = evidence.fieldToleranceCm[field];
  }

  return {
    ...input,
    legs: {
      present: existing?.present ?? true,
      ...(heightCm === undefined ? {} : { heightCm }),
      ...(insetCm === undefined ? {} : { insetCm }),
      ...(existing?.detachable === undefined ? {} : { detachable: existing.detachable }),
    },
    fieldSources,
    fieldToleranceCm,
  };
}
