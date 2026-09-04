import type { EnvironmentParams, Item } from '../types.ts';
import { REFRIGERATOR, SOFA_3_SEAT, WARDROBE } from './items.ts';

export interface Scenario {
  id: string;
  name: string;
  item: Item;
  params: EnvironmentParams;
  /** What this scenario exists to demonstrate. */
  expectation: string;
}

/**
 * The named cases the engine is judged on.
 *
 * They are exported from the package rather than living in the test folder
 * because the demo app in a later run needs exactly these scenes, and a demo
 * that re-typed the numbers would drift away from what the tests actually
 * cover.
 */

/** 1. Wide door, wide corridor: nothing interesting in the way. */
export const TRIVIAL_FIT: Scenario = {
  id: 'trivial-fit',
  name: 'Trivially fits',
  item: SOFA_3_SEAT,
  params: {
    openingWidth: 120,
    openingHeight: 210,
    wallThickness: 15,
    hallwayWidth: 300,
    hallwayDepth: 500,
    roomDepth: 400,
    roomWidth: 400,
    ceilingHeight: 260,
  },
  expectation: 'feasible with room to spare',
};

/**
 * 2. The wardrobe is 220 cm tall and the opening is 200 cm high, so it cannot
 * go through standing up. Tilting is the whole answer.
 *
 * A wide opening — a double doorway — with a low header at 205 cm. The wardrobe
 * is 220 cm tall, so it cannot go through standing up; tipped onto its back it
 * is 60 cm tall and 180 cm wide, and goes through comfortably.
 *
 * The ceiling is an ordinary 250 cm. That works because tipping this wardrobe
 * backward sweeps the diagonal of its 60 x 220 face, 228 cm, and because pivot
 * moves let it turn about its bottom edge instead of rising first and rotating
 * afterwards.
 *
 * A note on what this scenario cannot be. An AABB's height does not change when
 * you translate it, so during any rotation from upright to on-its-side the
 * ceiling must clear the peak of that face's bounding height — no planner, and
 * no cleverness about coupling rotation to translation, can avoid it. Sending
 * this wardrobe through a 100 cm wide opening would force its 180 cm and 220 cm
 * axes to swap between vertical and horizontal, whose peak is 284 cm. That is
 * impossible below a 284 cm ceiling as a matter of geometry, not of search.
 */
export const TILT_REQUIRED: Scenario = {
  id: 'tilt-required',
  name: 'Fits only when tilted',
  item: WARDROBE,
  params: {
    openingWidth: 200,
    openingHeight: 205,
    wallThickness: 15,
    hallwayWidth: 260,
    hallwayDepth: 420,
    roomDepth: 380,
    roomWidth: 380,
    ceilingHeight: 250,
  },
  expectation: 'feasible under a normal ceiling, by pivoting onto its back',
};

/**
 * 3. The refrigerator's smallest cross-section is 70 x 75 cm. A 50 cm opening
 * cannot take it at any angle, and the closed-form pre-check says so without
 * searching.
 */
export const IMPOSSIBLE: Scenario = {
  id: 'impossible',
  name: 'Cannot fit in any orientation',
  item: REFRIGERATOR,
  params: {
    openingWidth: 50,
    openingHeight: 200,
    wallThickness: 15,
    hallwayWidth: 250,
    hallwayDepth: 400,
    roomDepth: 350,
    roomWidth: 350,
    ceilingHeight: 250,
  },
  expectation: 'proven-too-large, with no search performed',
};

/**
 * 4. The important one.
 *
 * The sofa's 95 x 85 cm cross-section passes a 110 cm opening comfortably, so
 * the doorway is not the problem. But the sofa is 220 cm long and arrives down
 * a corridor with only 100 cm of clearance in front of the door: it can lie
 * along the corridor, and it cannot be turned to face the opening, because
 * turning needs room the corridor does not have. The diagnostics must name the
 * hallway, not the opening.
 *
 * The corridor is 320 cm long rather than 5 m for the same reason as the cellar
 * below: this scenario's answer is a proof of absence, and a proof of absence
 * costs time in proportion to the space it has to rule out. 320 cm still leaves
 * the 220 cm sofa half a metre of travel either way.
 */
export const NARROW_HALLWAY: Scenario = {
  id: 'narrow-hallway',
  name: 'Hallway too narrow to turn in',
  item: SOFA_3_SEAT,
  params: {
    openingWidth: 110,
    openingHeight: 210,
    wallThickness: 15,
    hallwayWidth: 100,
    hallwayDepth: 320,
    roomDepth: 400,
    roomWidth: 400,
    ceilingHeight: 220,
  },
  expectation: 'infeasible, with the hallway identified as the binding constraint',
};

/**
 * 5. A cellar: a low passage leading to a 78 cm hatch.
 *
 * The sofa is 85 cm tall on its legs and 70 cm with them off, and pitching only
 * ever makes a 220 cm long item taller — the vertical extent is
 * 220*sin(p) + 85*cos(p), which is smallest at p = 0. So no tilt and no turn
 * gets 85 cm through a 78 cm hatch, and the legs have to come off.
 *
 * The passage is deliberately small. Proving that no path exists means
 * exhausting every reachable configuration, which costs time in proportion to
 * how much space there is to be reachable; a 5 m corridor with a 2.5 m ceiling
 * turns a one-second proof into a minute of searching without making the
 * scenario say anything more. The 150 cm ceiling also matches the hatch: this
 * is a cellar, not a hallway.
 */
export const LEGS_MUST_COME_OFF: Scenario = {
  id: 'legs-must-come-off',
  name: 'Fits only after removing the legs',
  item: SOFA_3_SEAT,
  params: {
    openingWidth: 120,
    openingHeight: 78,
    wallThickness: 15,
    hallwayWidth: 200,
    hallwayDepth: 280,
    roomDepth: 300,
    roomWidth: 300,
    ceilingHeight: 150,
  },
  expectation: 'infeasible, and removing the legs is what fixes it',
};

export const SCENARIOS: readonly Scenario[] = [
  TRIVIAL_FIT,
  TILT_REQUIRED,
  IMPOSSIBLE,
  NARROW_HALLWAY,
  LEGS_MUST_COME_OFF,
];
