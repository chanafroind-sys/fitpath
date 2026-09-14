/**
 * The vocabulary of the retailer bridge.
 *
 * Everything here is data about *what a shop published*, never geometry. The
 * geometry lives in `../types.ts`, and this subsystem's only job is to turn one
 * into the other.
 */

import type { Item } from '../types.ts';

/**
 * Where a number came from, as far as the produced model is concerned.
 *
 * - `published` — a shop wrote this number down and we copied it.
 * - `derived` — arithmetic on published numbers, e.g. overall depth minus seat
 *   depth. Still a measurement: no judgement was applied.
 * - `assumed` — a number nobody measured.
 *
 * `assumed` exists in the union so that there is a name for it and so that a
 * consumer can refuse to trust a model containing one. **No number in a model
 * produced by this pipeline is ever tagged `assumed`**, and a named test pins
 * that. See the module comment on `furnitureModel.ts` for why.
 */
export type Provenance = 'published' | 'derived' | 'assumed';

/**
 * Where a published number came from *upstream*.
 *
 * This is the seam an image-analysis stage plugs into. That stage will measure
 * the same fields off a product photo and hand them over tagged
 * `image-derived`; nothing in this round reads an image, and there is no image
 * code anywhere in this subsystem. The seam is here so that when it arrives no
 * consumer of a model has to change: an image-derived number is a measurement
 * like any other, it lands in the produced model with provenance `derived`, and
 * it clears exactly the same plausibility gates as a shop's own figure.
 */
export type FieldSource = 'retailer-published' | 'operator-entered' | 'image-derived';

/** Every input field a source can speak about: the keys of `FurnitureInput`, flattened. */
export type FurnitureField =
  | 'overallWidthCm'
  | 'overallDepthCm'
  | 'overallHeightCm'
  | 'seatHeightCm'
  | 'seatDepthCm'
  | 'armrestHeightCm'
  | 'armrestWidthCm'
  | 'backrestThicknessCm'
  | 'armrests'
  | 'legs.present'
  | 'legs.heightCm'
  | 'legs.insetCm'
  | 'legs.detachable'
  | 'shape';

/** Whether the item has armrests at all. Absence is a *fact*, and it carves. */
export type ArmrestPresence = 'present' | 'none' | 'unknown';

/** The plan silhouette. Anything but `straight` means a limb this round cannot model. */
export type FurnitureShape = 'straight' | 'corner' | 'chaise' | 'unknown';

/**
 * What a shop says about the legs.
 *
 * `present` is deliberately a tri-state rather than a boolean. "We do not know
 * whether it has legs" and "it has no legs" are different facts and they carve
 * differently — the first carves nothing, the second confirms the body reaches
 * the floor and closes the question.
 */
export interface LegSpec {
  present: true | false | 'unknown';
  /** Floor to the underside of the body. */
  heightCm?: number;
  /**
   * How far in from the footprint's edge the legs stand, on both plan axes.
   *
   * This is the field that makes a leg carve possible. A leg height alone
   * proves the band under the body is not full-section, but says nothing about
   * *where* in plan the material is, and material of unknown position has to be
   * left where it is. An inset proves there is nothing within `insetCm` of the
   * perimeter, and that is a carve.
   */
  insetCm?: number;
  /** True when the legs unscrew, which makes the leg band a `RemovablePart`. */
  detachable?: boolean;
}

/** What a retailer publishes. Three numbers are required; everything else is a bonus. */
export interface FurnitureInput {
  id?: string;
  name?: string;
  nameHe?: string;

  overallWidthCm: number;
  overallDepthCm: number;
  overallHeightCm: number;

  /** Floor to the top of the seat cushion. */
  seatHeightCm?: number;
  /** Front edge to the front face of the backrest, measured at seat level. */
  seatDepthCm?: number;
  /** Floor to the top of the armrest. */
  armrestHeightCm?: number;
  /** The width of ONE armrest. */
  armrestWidthCm?: number;
  /** Published directly by some shops; otherwise derived from depth minus seat depth. */
  backrestThicknessCm?: number;

  armrests?: ArmrestPresence;
  legs?: LegSpec;
  shape?: FurnitureShape;

  separableParts?: readonly SeparablePartInput[];

  /** Per-field upstream source. Absent means `retailer-published`. See `FieldSource`. */
  fieldSources?: Partial<Record<FurnitureField, FieldSource>>;

  /**
   * How wrong a published number is allowed to be, in centimetres.
   *
   * Retailers round — to the centimetre routinely, to five centimetres often —
   * and they occasionally measure to a different reference than the one a rule
   * assumes. Every carve derived from such a number inherits that error, and an
   * error in the wrong direction eats real material: a true seat depth of 68
   * published as 70 makes the front-top carve remove two centimetres of actual
   * backrest.
   *
   * So every carve is shrunk by this much, always in the direction that keeps
   * material. It is never applied in the direction that removes any. Setting it
   * to 0 says the numbers are exact, which is a claim about the source, not a
   * default.
   *
   * Defaults to `DEFAULT_INPUT_TOLERANCE_CM`, which was chosen by measurement:
   * it is the smallest value at which the whole perturbation sweep in
   * `test/furnitureModelTolerance.test.ts` still contains its fixture.
   */
  toleranceCm?: number;

  /**
   * Per-field override of `toleranceCm`.
   *
   * A tape measure in a shop is worth ±0.5; a figure scraped off a listing is
   * worth ±2. Tightening a tolerance is a claim about a specific source, which
   * is why it is stated per field rather than inferred from how round the
   * number looks. Pairs naturally with `fieldSources`.
   */
  fieldToleranceCm?: Partial<Record<FurnitureField, number>>;

  /**
   * How far the three overall dimensions may under-state the real item, per face.
   *
   * A separate knob, and default 0, because it is a different kind of error.
   * `toleranceCm` protects the model against wrong *relationships* between
   * published numbers — that is the pipeline's own exposure, since the pipeline
   * is what derives air from those relationships. An under-reported overall
   * dimension is not that: it means the listing describes a smaller sofa than
   * the one in the shop, and no amount of internal conservatism can recover the
   * difference. The only remedy is to grow the bounding box, and growing it
   * silently would answer a question nobody asked — "will this 302 cm sofa fit"
   * when the user asked about a 300 cm one.
   *
   * When set, it pushes the model's outer skin out by this much on each side
   * and at the top. The floor stays where it is: an item stands on it. Internal
   * partitions do not move.
   */
  overallToleranceCm?: number;
}

/**
 * A piece that ships and is carried separately: an ottoman, a chaise module.
 *
 * It is its own item with its own dimensions, and it is modelled by the same
 * function. Merging it into the parent's body would invent material between the
 * two pieces that does not exist, and it would hide the fact that the awkward
 * piece can go through the door on its own. Nesting is refused: a part with
 * parts of its own is a catalogue structure, not a piece of furniture.
 */
export interface SeparablePartInput extends Omit<FurnitureInput, 'separableParts'> {
  separableParts?: undefined;
}

/** One number in the produced model, and where it came from. */
export interface MeasurementProvenance {
  field: string;
  value: number;
  provenance: Provenance;
  source: FieldSource;
  /** The input fields this value was computed from. Its own name, when copied. */
  from: readonly string[];
  /**
   * The slack this number was used with, in centimetres.
   *
   * Zero means the model took it literally. Anything above zero means a carve
   * that depended on it was pulled back by that much, so the geometry standing
   * on this number is deliberately looser than the number itself.
   */
  toleranceCm: number;
}

/** The provenance of one box's three extents, aligned by index with `item.boxes`. */
export interface BoxProvenance {
  label: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  width: Provenance;
  depth: Provenance;
  height: Provenance;
  from: readonly string[];
  /**
   * Slack baked into this box's extents, in centimetres.
   *
   * The field that tells a box carved against an exact input apart from one
   * carved under tolerance: `0` means every face of this box sits exactly where
   * the published numbers put it, and anything above zero means at least one
   * face was moved outward to absorb input error.
   */
  toleranceCm: number;
}

/** A region the bounding box lost, and the published fact that proved it was air. */
export interface Carve {
  region: 'under-seat' | 'front-top' | 'between-armrests' | 'above-armrests';
  volumeCm3: number;
  provedBy: readonly string[];
  /** How much this carve was pulled back to absorb error in the fields that proved it. */
  toleranceCm: number;
  /**
   * What this region's carve would have been with the numbers taken literally.
   *
   * Compare the *sum* across carves, not one term. Slack moves the boundaries
   * that define the regions, so volume migrates between them: allowing an
   * armrest to be taller than published shrinks the carve above the arms and
   * enlarges the carve between them, and either term alone can go up. Only the
   * total is the quantity with a guaranteed direction, and `ToleranceReport.costCm3`
   * is that total.
   */
  untoleranced: number;
  en: string;
  he: string;
}

/** The single field that would most improve this model, and the next, and the next. */
export type ImprovementField =
  | 'returnLegDimensions'
  | 'armrests'
  | 'armrestWidthCm'
  | 'armrestHeightCm'
  | 'seatDepthCm'
  | 'seatHeightCm'
  | 'legs'
  | 'legs.insetCm';

export interface ImprovementRequest {
  rank: number;
  field: ImprovementField;
  /**
   * How much material this field could prove is air, in cubic centimetres.
   *
   * A ranking figure, not a measurement. It is computed from nominal
   * proportions for the unknown quantities — a sofa's legs are about 15 cm, an
   * armrest about 10 cm — because ordering "which question to ask next" needs
   * an order, not an answer. Nothing here ever reaches the geometry.
   */
  estimatedCarveCm3: number;
  en: string;
  he: string;
}

export type FlagSeverity = 'note' | 'warning' | 'loud';

export type FlagCode =
  | 'bounding-box-only'
  | 'l-shape-not-modelled'
  | 'seat-body-implausibly-thin'
  | 'field-ignored-implausible'
  | 'bounding-box-grown';

export interface ModelFlag {
  code: FlagCode;
  severity: FlagSeverity;
  en: string;
  he: string;
}

/**
 * How much of the bounding box this model improved on, as a tier.
 *
 * `bounding-box-only` is not a failure. It is the honest answer when nothing
 * published proves any material is missing, and it is still a sound model — it
 * just answers "no path found" more often than the furniture deserves.
 */
export type ConfidenceTier = 'bounding-box-only' | 'low' | 'medium' | 'high';

/** The slack the model was built with, as it was actually resolved. */
export interface ToleranceReport {
  /** What an unlisted field got. */
  defaultCm: number;
  /** Per-face growth of the outer skin. Zero unless the caller asked for it. */
  overallCm: number;
  /** Only the fields that were overridden, so the common case is an empty object. */
  byField: Readonly<Partial<Record<FurnitureField, number>>>;
  /** Total volume that tolerance handed back to the model rather than carving away. */
  costCm3: number;
}

export interface FurnitureModelResult {
  /** Bump this when a rule changes, so a catalogue knows what to re-run. */
  pipelineVersion: string;
  /** The slack every carve in this model was built with. */
  tolerance: ToleranceReport;
  item: Item;
  /** Separable pieces, each modelled in full by the same pipeline. Never merged in. */
  separableParts: readonly FurnitureModelResult[];
  boundingBox: { widthCm: number; depthCm: number; heightCm: number };
  boundingVolumeCm3: number;
  /** Volume of the bounding box that published facts proved was air. */
  carvedVolumeCm3: number;
  carves: readonly Carve[];
  measurements: readonly MeasurementProvenance[];
  boxProvenance: readonly BoxProvenance[];
  confidence: ConfidenceTier;
  /** Ranked, best first. Exactly what a store operator would be asked to fill in. */
  improvements: readonly ImprovementRequest[];
  flags: readonly ModelFlag[];
}
