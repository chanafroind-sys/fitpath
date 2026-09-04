import type { Box, Item, Rotation, Vec3 } from '../types.ts';
import { radians } from '../math/rotation.ts';

const UPRIGHT: Rotation = { yaw: 0, pitch: 0, roll: 0 };

function box(center: Vec3, halfExtents: Vec3, rotation: Rotation = UPRIGHT): Box {
  return { center, halfExtents, rotation };
}

// The backrest leans back 12 degrees about the sofa's long axis, which changes
// how much depth and height it occupies. Its centre is derived from the rotated
// half-extents rather than written down as a rounded number, so the sofa's
// overall size comes out at exactly 220 x 95 x 85 instead of a few hundredths
// over — a fixture that is almost the right size is a fixture that makes every
// clearance test slightly wrong.
const BACKREST_ROLL = radians(-12);
const BACKREST_HALF_DEPTH = 9;
const BACKREST_HALF_HEIGHT = 30;
const BACKREST_ROTATED_HALF_DEPTH =
  Math.abs(Math.cos(BACKREST_ROLL)) * BACKREST_HALF_DEPTH +
  Math.abs(Math.sin(BACKREST_ROLL)) * BACKREST_HALF_HEIGHT;
const BACKREST_ROTATED_HALF_HEIGHT =
  Math.abs(Math.sin(BACKREST_ROLL)) * BACKREST_HALF_DEPTH +
  Math.abs(Math.cos(BACKREST_ROLL)) * BACKREST_HALF_HEIGHT;

/**
 * A three-seat sofa, 220 x 95 x 85, as eight boxes.
 *
 * Local frame: +X along the length, +Y toward the back, +Z up, origin at the
 * centre of the body's underside — that is, at the top of the legs. Putting the
 * origin there rather than on the floor is what makes "remove the legs" a
 * meaningful operation: the legs hang below z = 0, so taking them off leaves a
 * body that still rests correctly when the placement's z drops to zero, instead
 * of a body left floating 15 cm in the air.
 *
 * The backrest carries its own roll of 12 degrees. A sofa back leans; modelling
 * it upright would overstate the depth at seat height and understate it at the
 * top, and the top is exactly where a doorway lintel meets it.
 */
export const SOFA_3_SEAT: Item = {
  id: 'sofa-3-seat',
  name: '3-seat sofa',
  nameHe: 'ספה תלת-מושבית',
  boxes: [
    // seat block: the full length, from the front edge back under the backrest
    box({ x: 0, y: -7.5, z: 20 }, { x: 110, y: 40, z: 20 }),
    // Backrest, leaning back 12 degrees about the sofa's long axis. Negative
    // roll tips the top toward +Y, which is the back. Its centre is placed so
    // that the rotated box lands exactly on the sofa's 95 cm depth and 70 cm
    // body height.
    box(
      {
        x: 0,
        y: 47.5 - BACKREST_ROTATED_HALF_DEPTH,
        z: 70 - BACKREST_ROTATED_HALF_HEIGHT,
      },
      { x: 110, y: BACKREST_HALF_DEPTH, z: BACKREST_HALF_HEIGHT },
      { yaw: 0, pitch: 0, roll: BACKREST_ROLL },
    ),
    // armrests: full depth, and they define the sofa's 95 cm depth
    box({ x: -105, y: 0, z: 27.5 }, { x: 5, y: 47.5, z: 27.5 }),
    box({ x: 105, y: 0, z: 27.5 }, { x: 5, y: 47.5, z: 27.5 }),
    // legs, hanging below the body. Indices 4-7.
    box({ x: -100, y: -40, z: -7.5 }, { x: 4, y: 4, z: 7.5 }),
    box({ x: 100, y: -40, z: -7.5 }, { x: 4, y: 4, z: 7.5 }),
    box({ x: -100, y: 40, z: -7.5 }, { x: 4, y: 4, z: 7.5 }),
    box({ x: 100, y: 40, z: -7.5 }, { x: 4, y: 4, z: 7.5 }),
  ],
  removableParts: [{ name: 'legs', nameHe: 'הרגליים', boxIndices: [4, 5, 6, 7] }],
};

/**
 * A wardrobe, 180 wide x 60 deep x 220 tall. Taller than a standard door, which
 * is the point.
 *
 * Local frame: +X is its 60 cm DEPTH, +Y its 180 cm width, +Z its height. That
 * assignment is the whole fixture, so it is worth saying why.
 *
 * Pitch turns about the item's local Y. Whatever an author puts on local Y is
 * therefore the edge the item tips over. Put the 180 cm width there and pitch
 * tips the wardrobe sideways, sweeping the diagonal of its 180 x 220 face —
 * 284 cm, which no normal room can clear, so the engine would report that a
 * perfectly ordinary wardrobe cannot be tilted at all. Put the 60 cm depth
 * there, as here, and pitch tips it backward onto its back, sweeping the
 * diagonal of its 60 x 220 face: 228 cm, which fits under a 250 cm ceiling.
 *
 * Backward is also what a person actually does. The lesson generalises: an
 * item's local Y should be the axis it pivots about when tilted, and getting
 * that wrong does not produce a slightly worse answer, it produces a confident
 * and wrong "no path found".
 *
 * With roll fixed at zero this choice is exclusive — an item can tip one way or
 * the other, not both. See the README's "Not supported yet".
 */
export const WARDROBE: Item = {
  id: 'wardrobe',
  name: 'wardrobe',
  nameHe: 'ארון בגדים',
  boxes: [box({ x: 0, y: 0, z: 110 }, { x: 30, y: 90, z: 110 })],
};

/** A refrigerator, 70 x 75 x 185. One solid block, no removable parts. */
export const REFRIGERATOR: Item = {
  id: 'refrigerator',
  name: 'refrigerator',
  nameHe: 'מקרר',
  boxes: [box({ x: 0, y: 0, z: 92.5 }, { x: 35, y: 37.5, z: 92.5 })],
};

/** Every fixture, in a fixed order — tests and benchmarks iterate this. */
export const ITEMS: readonly Item[] = [SOFA_3_SEAT, WARDROBE, REFRIGERATOR];
