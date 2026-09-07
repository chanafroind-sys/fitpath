import type { Item } from '../types.ts';
import { radians } from '../math/rotation.ts';
import { SOFA_3_SEAT, part, spanning } from './items.ts';

/**
 * A catalogue of sofas, chosen so that a different part binds in each.
 *
 * The value of a maneuver library is not that it says yes. It is that it says
 * *why*, and the why is different for every one of these: legs on one, armrests
 * on another, a corner on a third, a mechanism housing that cannot come off on
 * a fourth. Every figure the engine reports about them is measured from these
 * boxes, so the boxes have to be an honest drawing of the furniture rather than
 * a shape chosen to make a point.
 */

/**
 * A slim-arm two-seater, 160 x 90 x 80.
 *
 * The counterpart to the three-seater, and here because of its ends. A sofa
 * with solid full-depth armrests running the full height presents the same
 * cross-section at its ends as in its middle, so turning it as it goes buys
 * nothing. This one has 8 cm arm panels that stop 22 cm below the back, and it
 * sits on a recessed plinth rather than on legs that stand proud of the body.
 * Ends and middle therefore both have relief, and different relief, which is
 * the condition for a threading maneuver to be worth anything.
 */
const SLIM_BACK_ROLL = radians(-10);
const SLIM_BACK_HALF_DEPTH = 4.5;
const SLIM_BACK_HALF_HEIGHT = 30;
const SLIM_BACK_ROTATED_HALF_DEPTH =
  Math.abs(Math.cos(SLIM_BACK_ROLL)) * SLIM_BACK_HALF_DEPTH +
  Math.abs(Math.sin(SLIM_BACK_ROLL)) * SLIM_BACK_HALF_HEIGHT;
const SLIM_BACK_ROTATED_HALF_HEIGHT =
  Math.abs(Math.sin(SLIM_BACK_ROLL)) * SLIM_BACK_HALF_DEPTH +
  Math.abs(Math.cos(SLIM_BACK_ROLL)) * SLIM_BACK_HALF_HEIGHT;

export const SLIM_ARM_2_SEAT: Item = {
  id: 'slim-arm-2-seat',
  name: 'Vetle slim-arm 2-seat',
  nameHe: 'ספה דו-מושבית ווטלה',
  boxes: [
    spanning('the plinth', 'הבסיס', [-72, 72], [-38, 38], [0, 14]),
    spanning('the seat', 'המושב', [-72, 72], [-45, 25], [14, 46]),
    part(
      'the backrest',
      'המשענת',
      {
        x: 0,
        y: 45 - SLIM_BACK_ROTATED_HALF_DEPTH,
        z: 80 - SLIM_BACK_ROTATED_HALF_HEIGHT,
      },
      { x: 72, y: SLIM_BACK_HALF_DEPTH, z: SLIM_BACK_HALF_HEIGHT },
      { yaw: 0, pitch: 0, roll: SLIM_BACK_ROLL },
    ),
    spanning('the armrests', 'המשענות', [-80, -72], [-45, 45], [14, 58]),
    spanning('the armrests', 'המשענות', [72, 80], [-45, 45], [14, 58]),
  ],
};

/**
 * An L-shaped corner sofa, 280 x 200 x 85, in two modules.
 *
 * Two limbs at right angles: a 280 cm run with the back along it, and a 105 cm
 * chaise return off one end. Where the return meets the run the item is 200 cm
 * deep, and that band has to cross the doorway like every other band of it.
 *
 * Real corner sofas come apart at that seam, so both forms are modelled: this
 * one as a single rigid body, and the two pieces below. Reporting only the
 * assembled figure would make the item look impossible when a person would undo
 * four bolts.
 */
export const CORNER_SOFA: Item = {
  id: 'corner-sofa',
  name: 'Rosendal corner sofa',
  nameHe: 'ספה פינתית רוזנדל',
  boxes: [
    spanning('the main run', 'המקטע הראשי', [-136, 136], [-100, -10], [0, 14]),
    spanning('the main run', 'המקטע הראשי', [-136, 136], [-80, -5], [14, 46]),
    spanning('the backrest', 'המשענת', [-136, 136], [-100, -80], [14, 85]),
    spanning('the armrests', 'המשענות', [-140, -136], [-100, -5], [0, 65]),
    spanning('the chaise return', 'מקטע השזלונג', [45, 136], [-5, 96], [0, 14]),
    spanning('the chaise return', 'מקטע השזלונג', [45, 136], [-5, 100], [14, 46]),
    spanning('the chaise return', 'מקטע השזלונג', [136, 140], [-5, 100], [0, 65]),
  ],
};

/** The corner sofa's main run on its own, 280 x 95 x 85. */
export const CORNER_MAIN: Item = {
  id: 'corner-sofa-main',
  name: 'Rosendal main run',
  nameHe: 'רוזנדל — המקטע הראשי',
  boxes: [
    spanning('the main run', 'המקטע הראשי', [-136, 136], [-47.5, 42.5], [0, 14]),
    spanning('the main run', 'המקטע הראשי', [-136, 136], [-27.5, 47.5], [14, 46]),
    spanning('the backrest', 'המשענת', [-136, 136], [-47.5, -27.5], [14, 85]),
    spanning('the armrests', 'המשענות', [-140, -136], [-47.5, 47.5], [0, 65]),
  ],
};

/**
 * The chaise return on its own, 95 x 105 x 85.
 *
 * Note which way round it is. This piece is longer across than along, so its
 * travel axis is its local Y where every other fixture here uses local X. It
 * earns its place partly for that: a library that only worked for items whose
 * author happened to put the length on X would be the same mistake the second
 * tilt family was turned on to avoid.
 */
export const CORNER_RETURN: Item = {
  id: 'corner-sofa-return',
  name: 'Rosendal chaise return',
  nameHe: 'רוזנדל — מקטע השזלונג',
  boxes: [
    spanning('the chaise return', 'מקטע השזלונג', [-47.5, 43.5], [-52.5, 48.5], [0, 14]),
    spanning('the chaise return', 'מקטע השזלונג', [-47.5, 43.5], [-52.5, 52.5], [14, 46]),
    spanning('the armrests', 'המשענות', [43.5, 47.5], [-52.5, 52.5], [0, 65]),
  ],
};

/**
 * A deep-seat lounge sofa, 210 x 110 x 75.
 *
 * Low and deep, which reverses the usual relationship. It is 110 cm front to
 * back and only 75 cm tall, so depth is what decides whether it goes through a
 * door standing up, and turning it over helps more here than anywhere else in
 * the catalogue.
 */
export const DEEP_SEAT_LOUNGE: Item = {
  id: 'deep-seat-lounge',
  name: 'Havsta deep-seat lounge',
  nameHe: 'ספת לאונג עמוקה הבסטה',
  boxes: [
    spanning('the plinth', 'הבסיס', [-100, 100], [-50, 50], [0, 10]),
    spanning('the seat', 'המושב', [-89, 89], [-55, 25], [10, 48]),
    spanning('the backrest', 'המשענת', [-105, 105], [25, 55], [10, 75]),
    spanning('the armrests', 'המשענות', [-105, -89], [-55, 55], [10, 55]),
    spanning('the armrests', 'המשענות', [89, 105], [-55, 55], [10, 55]),
  ],
};

/**
 * A two-seat recliner, 180 x 100 x 105.
 *
 * The mechanism lives in a housing across the back and it does not come off: it
 * is the reclining action, bolted to the frame. Solid full-depth arms, and the
 * tallest back in the catalogue. Nothing about this one is removable, which is
 * why it is here.
 */
export const RECLINER_2_SEAT: Item = {
  id: 'recliner-2-seat',
  name: 'Brekke 2-seat recliner',
  nameHe: 'ספת ריקליינר דו-מושבית ברקה',
  boxes: [
    spanning('the base', 'הבסיס', [-86, 86], [-50, 40], [0, 12]),
    spanning('the seat', 'המושב', [-86, 86], [-50, 20], [12, 50]),
    spanning('the backrest', 'המשענת', [-86, 86], [20, 40], [12, 105]),
    spanning('the recliner housing', 'בית המנגנון', [-70, 70], [40, 50], [25, 70]),
    spanning('the armrests', 'המשענות', [-90, -86], [-50, 40], [0, 70]),
    spanning('the armrests', 'המשענות', [86, 90], [-50, 40], [0, 70]),
  ],
};

/**
 * A sofa bed, 200 x 100 x 90.
 *
 * The folded bed frame fills the body, so there is no hollow under the seat to
 * turn into clearance and nothing to unbolt. It is here because a catalogue
 * containing only winnable cases would not be an honest one.
 */
export const SOFA_BED: Item = {
  id: 'sofa-bed',
  name: 'Lindholm sofa bed',
  nameHe: 'ספה נפתחת לינדהולם',
  boxes: [
    spanning('the folded bed frame', 'מנגנון המיטה', [-96, 96], [-50, 50], [0, 42]),
    spanning('the seat', 'המושב', [-96, 96], [-50, 30], [42, 62]),
    spanning('the backrest', 'המשענת', [-96, 96], [20, 50], [42, 90]),
    spanning('the armrests', 'המשענות', [-100, -96], [-50, 50], [0, 68]),
    spanning('the armrests', 'המשענות', [96, 100], [-50, 50], [0, 68]),
  ],
};

/** The catalogue, in a fixed order. */
export const SOFAS: readonly Item[] = [
  SOFA_3_SEAT,
  SLIM_ARM_2_SEAT,
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  RECLINER_2_SEAT,
  SOFA_BED,
];

/**
 * Items that ship as separate pieces, and what those pieces are.
 *
 * Keyed by the assembled item's id. Nothing here is a `removablePart`: a
 * removable part comes off and leaves a smaller item behind, while these are
 * two items that are carried in separately and bolted together on the far side.
 */
export const MODULES: Readonly<Record<string, readonly Item[]>> = {
  [CORNER_SOFA.id]: [CORNER_MAIN, CORNER_RETURN],
};
