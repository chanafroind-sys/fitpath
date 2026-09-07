import type { Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';

/**
 * What a maneuver needs of a doorway and the space either side of it.
 *
 * Four numbers, in centimetres, matching the four a shopper can measure with a
 * tape. `doorWidth` and `doorHeight` are what the item occupies **at the
 * doorway** — the extent of its section through the wall, not of the whole
 * item, which is the distinction that makes threading expressible at all.
 */
export interface ManeuverRequirement {
  doorWidth: number;
  doorHeight: number;
  hallwayClearance: number;
  roomDepth: number;
}

/** One movement within a maneuver, with the footprint it alone demands. */
export interface ManeuverStage {
  id: string;
  name: string;
  nameHe: string;
  /** Range into the maneuver's path, inclusive of both ends. */
  startIndex: number;
  endIndex: number;
  requirement: ManeuverRequirement;
}

/** A template instantiated for one item, validated, and measured. */
export interface Maneuver {
  templateId: string;
  name: string;
  nameHe: string;
  /** The componentwise maximum over the stages. */
  requirement: ManeuverRequirement;
  stages: ManeuverStage[];
  /** The motion itself, so animation and instructions come free. */
  path: Placement[];
}

/** A stage as a template emits it, before validation or measurement. */
export interface StageDraft {
  id: string;
  name: string;
  nameHe: string;
  /**
   * The placements this stage passes through. The first must equal the
   * previous stage's last, so the concatenated path has no gap.
   */
  waypoints: Placement[];
}

/**
 * A maneuver shape, independent of any particular item.
 *
 * `build` is where "instantiate it for this item's actual dimensions" happens:
 * a template is a plan for a motion, and the numbers in it come from the item
 * it is being built for. Returning `undefined` means the shape does not apply.
 *
 * Templates know the wall's thickness and nothing else about the environment.
 * Everything else — where to start, how far to walk in — follows from the
 * item's own size, which is what lets the requirement be *derived* from the
 * motion rather than assumed and then checked against it.
 */
export interface ManeuverTemplate {
  id: string;
  name: string;
  nameHe: string;
  build(item: PreparedItem, wallThickness: number): StageDraft[] | undefined;
}
