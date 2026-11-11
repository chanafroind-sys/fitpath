/**
 * The data contract between the build and the widget.
 *
 * Everything expensive happened at build time: each template instantiated for
 * each item behind each wall a home can have, every placement and edge
 * validated against the collider, every requirement measured from the motion.
 * What ships is a table of numbers per product, small enough to fetch when a
 * modal opens, and a second file of paths that is fetched only when there is
 * something to animate.
 *
 * Nothing here is a verdict. A product file says what maneuvers are known to
 * work and what each one needs; the widget compares numbers against it at
 * runtime (`verdict.ts`) and puts the comparison into words (`copy.ts`).
 */
import type { Item, Placement } from '@fitpath/engine';

/** Bumped when the shape of these files changes, so a stale CDN file is refused. */
export const DATA_VERSION = 3;

/**
 * The six numbers a maneuver asks of a home.
 *
 * The first two are the opening, and the form asks for both. The other four
 * are reported as requirements and may be entered to turn a requirement into
 * a verdict; they are never a precondition for an answer. `ceilingHeight` is
 * not one of the engine's five: it is the highest point the motion reaches,
 * which for a sofa stood on end is a real thing a room can fail.
 */
export type Key = 'doorWidth' | 'doorHeight' | 'hallwayClearance' | 'alongWall' | 'roomDepth' | 'ceilingHeight';

export const KEYS: readonly Key[] = ['doorWidth', 'doorHeight', 'hallwayClearance', 'alongWall', 'roomDepth', 'ceilingHeight'];

/** The two the form asks for. */
export const OPENING_KEYS: readonly Key[] = ['doorWidth', 'doorHeight'];

/** The four that are reported, and may be entered. */
export const OPTIONAL_KEYS: readonly Key[] = ['hallwayClearance', 'alongWall', 'roomDepth', 'ceilingHeight'];

/** What a maneuver needs, in centimetres, one number per key. */
export type Need = Record<Key, number>;

/**
 * One maneuver's numbers behind one wall.
 *
 * A doorway is a tunnel the depth of the wall, and thicker is strictly
 * harder. A variant validated behind `wallCm` holds for any wall up to
 * `holdsForWallsUpTo`, which is `wallCm` when the numbers depend on the
 * thickness and far larger when the motion was rebuilt behind a much thicker
 * wall and needed the same doorway.
 */
export interface WallVariant {
  wallCm: number;
  holdsForWallsUpTo: number;
  need: Need;
  /** True when the item's angle changes while it is inside the opening. */
  turns: boolean;
  /** Key into the paths file, under the carry's id. */
  pathKey: string;
}

export interface WidgetManeuver {
  templateId: string;
  name: string;
  nameHe: string;
  /** The separate motions a person performs, in order. */
  stages: { name: string; nameHe: string }[];
  /**
   * Thinnest wall first. A wall thicker than the last variant's
   * `holdsForWallsUpTo` is not measured for this maneuver.
   */
  variants: WallVariant[];
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
  /** The narrowest doorway any of them clears behind the default wall, if any does. */
  narrowestCm?: number;
  /** The narrowest any roll schedule could reach, valid maneuver or not. */
  floorCm?: number;
}

export type Separates = true | false | 'unknown';

/**
 * A part that comes off, and the body without it.
 *
 * `detachable` is a fact about the product the engine cannot know and a
 * listing sometimes states. `true` is stated by the listing and may be
 * acted on; `'unknown'` is rendered as a question for the shopper and acted
 * on only when they answer yes. A part known not to come off has no entry.
 */
export interface Removable {
  part: string;
  partHe: string;
  detachable: true | 'unknown';
  carry: Carry;
}

export interface WidgetProduct {
  dataVersion: number;
  id: string;
  name: string;
  nameHe: string;
  /** An SVG of the item, drawn from its box model at build time. */
  illustration: string;
  /** The wall the answer assumes when the shopper has not said, in centimetres. */
  wallCm: number;
  /** Every wall the library was built behind, thinnest first; the first is `wallCm`. */
  wallsCm: number[];
  /** The body as one piece. */
  assembled: Carry;
  /**
   * Whether it comes apart into modules that are carried in separately.
   *
   * `'unknown'` is the honest default for a listing that does not say, and it
   * is never treated as either answer.
   */
  separates: Separates;
  /** Present only when `separates` is `true`. Every module has to get through. */
  modules?: Carry[];
  removable: Removable[];
}

/** The motions, keyed by carry id and then `WallVariant.pathKey`. Fetched only to animate. */
export type WidgetPaths = Record<string, Record<string, Placement[]>>;

/** The catalogue's index: which products exist, so a store can list them. */
export interface WidgetIndex {
  dataVersion: number;
  products: { id: string; name: string; nameHe: string }[];
}
