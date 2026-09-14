/**
 * The data contract between the build and the widget.
 *
 * Everything expensive happened at build time: each template instantiated for
 * each item, every placement and edge validated against the collider, every
 * requirement measured from the motion. What ships is a table of numbers per
 * product, small enough to fetch when a modal opens, and a second file of
 * paths that is fetched only when there is something to animate.
 *
 * Nothing here is a verdict. A product file says what maneuvers are known to
 * work and what each one needs; the widget compares numbers against it at
 * runtime and says, in as many words, what that comparison did and did not
 * establish.
 */
import type { Item, ManeuverRequirement, Placement } from '@fitpath/engine';

/** Bumped when the shape of these files changes, so a stale CDN file is refused. */
export const DATA_VERSION = 2;

/** The five numbers a maneuver asks of a home, in the order they are asked for. */
export type MeasurementKey = keyof ManeuverRequirement;

export interface WidgetManeuver {
  templateId: string;
  name: string;
  nameHe: string;
  /** The separate motions a person performs, in order. */
  stages: { name: string; nameHe: string }[];
  requirement: ManeuverRequirement;
  /**
   * The highest point any part of the item reaches during the motion, in
   * centimetres. Not one of the five requirements — the library validates
   * against a room whose ceiling clears it — but a maneuver that stands a sofa
   * on end reaches 231 cm, and a shopper with a low ceiling deserves to know.
   */
  headroomCm: number;
  /** True when the item's angle changes while it is inside the opening. */
  turns: boolean;
  /** The wall thickness the motion was validated behind, in centimetres. */
  wallThickness: number;
  /**
   * The thickest wall the requirement is known to hold for. Equal to
   * `wallThickness` when the answer depends on that assumption; larger when
   * the motion was rebuilt behind a much thicker wall and needed the same
   * doorway. See the engine's `Maneuver.holdsForWallsUpTo`.
   */
  holdsForWallsUpTo: number;
}

/**
 * One body that has to get through the door: the item as sold, one of its
 * modules, or the item with a part taken off.
 */
export interface Carry {
  id: string;
  name: string;
  nameHe: string;
  /** Length, depth and height, in centimetres. */
  dimensions: { length: number; depth: number; height: number };
  /**
   * The box model, for the closed-form proof and the 3D view. Small: a sofa is
   * eight boxes.
   */
  item: Item;
  /** Maneuvers validated for this body, in library order. */
  maneuvers: WidgetManeuver[];
  /** The narrowest doorway any of them clears, if any does. */
  narrowestCm?: number;
  /** The narrowest any roll schedule could reach, valid maneuver or not. */
  floorCm?: number;
  /** The part that decides the width, when the engine could name one. */
  bindingPart?: { label: string; labelHe: string; floorWithoutCm: number };
  /** The wall assumption in words, from the engine's report. */
  wallStatement: string;
  wallStatementHe: string;
}

export type Separates = true | false | 'unknown';

export interface WidgetProduct {
  dataVersion: number;
  id: string;
  name: string;
  nameHe: string;
  /** An SVG of the item, drawn from its box model at build time. */
  illustration: string;
  /** The wall thickness every maneuver was validated against. */
  wallThicknessCm: number;
  /** The body as one piece. */
  assembled: Carry;
  /**
   * Whether it comes apart into modules that are carried in separately.
   *
   * `'unknown'` is the honest default for a listing that does not say, and it
   * is rendered as a question for the retailer rather than as either answer.
   */
  separates: Separates;
  /** Present only when `separates` is `true`. Every module has to get through. */
  modules?: Carry[];
  /** The body with one removable part taken off, one entry per part. */
  withoutPart: { part: string; partHe: string; carry: Carry }[];
}

/** The motions, keyed by carry id and then template id. Fetched only to animate. */
export type WidgetPaths = Record<string, Record<string, Placement[]>>;

/** The catalogue's index: which products exist, so a store can list them. */
export interface WidgetIndex {
  dataVersion: number;
  products: { id: string; name: string; nameHe: string }[];
}
