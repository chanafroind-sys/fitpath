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
  /** Depth in front of the door, toward the hallway. */
  hallwayClearance: number;
  /** Depth behind the door, into the room. */
  roomDepth: number;
  /**
   * How far the motion needs along the wall, on either side of the doorway.
   *
   * The third corridor dimension, and the one that decides whether an item can
   * be turned to face the door at all. It was left generous while every
   * maneuver began with the item already square, because then it never bound.
   * The approach maneuvers stand a sofa on end in the corridor and turn it
   * there, and for those it is the number that matters most.
   */
  alongWall: number;
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
  /**
   * The wall thickness this motion was measured and validated against, in
   * centimetres. A doorway is a tunnel the depth of the wall, and the
   * requirement above is what the item needs while it is inside that tunnel.
   */
  wallThickness: number;
  /**
   * The thickest wall the requirement is known to hold for.
   *
   * Thicker walls are strictly harder: the wall's solid grows and the
   * clearances either side are measured from its faces, so a motion valid
   * behind a thick wall is valid behind a thin one and not the other way
   * round. The requirement is monotone in the thickness, which means two
   * measurements settle it: built again behind a `THICK_WALL_BOUND` wall, a
   * maneuver whose five numbers come out identical needs the same doorway for
   * every thickness in between. Then this is that bound. Otherwise it equals
   * `wallThickness`, and the requirement holds only for walls no thicker than
   * that — which the result says, because an unstated assumption of 30 cm is
   * unsafe for anyone whose wall is 40.
   */
  holdsForWallsUpTo: number;
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
