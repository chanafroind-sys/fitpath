/**
 * The six hand-authored sofas, and the listings a shop would publish for them.
 *
 * Shared by the ground-truth comparison and the input-tolerance sweep, so that
 * both are arguing about the same numbers.
 */

import type { Item } from '../../src/types.ts';
import type { FurnitureInput } from '../../src/sourcing/types.ts';
import { SOFA_3_SEAT } from '../../src/fixtures/items.ts';
import {
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  RECLINER_2_SEAT,
  SLIM_ARM_2_SEAT,
  SOFA_BED,
} from '../../src/fixtures/sofas.ts';

/**
 * The six hand-authored sofas, against the listings a shop would publish for them.
 *
 * The fixtures are ground truth and nothing here may touch them. Each input
 * below is what a retailer would realistically print on the product page for
 * that exact sofa, and every number in it was measured off the fixture rather
 * than chosen to make a test pass:
 *
 * - overall width, depth and height are the fixture's own bounding box;
 * - seat height is the top of the seat above the floor;
 * - seat depth is the free horizontal depth at seat level, front edge to the
 *   front face of the backrest, **rounded down** — a shop rounds, and rounding
 *   a seat depth down thickens the derived backrest, which shrinks the region
 *   the model is allowed to carve. Rounding is only safe in that direction;
 * - armrest width and height are the end panel's, rounded up for the same
 *   reason in reverse: a wider, taller arm carves less.
 *
 * Two things a shop does not publish are therefore absent everywhere: the
 * armrests' depth, and where the legs stand in plan. Both show up below as the
 * gap between the produced model and the fixture.
 */
export interface GroundTruthCase {
  fixture: Item;
  published: FurnitureInput;
  /** Why this listing looks the way it does, in one line, for the failure message. */
  note: string;
}

export const LISTINGS: readonly GroundTruthCase[] = [
  {
    fixture: SOFA_3_SEAT,
    note: 'legs, and a backrest that leans 12 degrees',
    published: {
      id: 'sofa-3-seat',
      name: '3-seat sofa',
      overallWidthCm: 220,
      overallDepthCm: 95,
      overallHeightCm: 85,
      // Seat top is 40 above the body underside, which is 15 above the floor.
      seatHeightCm: 55,
      // The leaning backrest's front face is 71.1 cm back from the front edge at
      // seat level. A shop prints 70.
      seatDepthCm: 70,
      armrests: 'present',
      armrestWidthCm: 10,
      armrestHeightCm: 70,
      // The one fixture in the catalogue that stands on legs, and they unscrew.
      legs: { present: true, heightCm: 15, detachable: true },
      shape: 'straight',
    },
  },
  {
    fixture: SLIM_ARM_2_SEAT,
    note: 'slim arms that stop below the back, on a recessed plinth',
    published: {
      id: 'slim-arm-2-seat',
      name: 'Vetle slim-arm 2-seat',
      overallWidthCm: 160,
      overallDepthCm: 90,
      overallHeightCm: 80,
      seatHeightCm: 46,
      // Free depth at seat level is 75.25; printed as 75.
      seatDepthCm: 75,
      armrests: 'present',
      armrestWidthCm: 8,
      armrestHeightCm: 58,
      // A plinth, not legs. "No legs" is a fact and it closes the question.
      legs: { present: false },
      shape: 'straight',
    },
  },
  {
    fixture: CORNER_SOFA,
    note: 'an L, and nothing published describes the return',
    published: {
      id: 'corner-sofa',
      name: 'Rosendal corner sofa',
      overallWidthCm: 280,
      overallDepthCm: 200,
      overallHeightCm: 85,
      seatHeightCm: 46,
      seatDepthCm: 90,
      armrests: 'present',
      armrestWidthCm: 4,
      armrestHeightCm: 65,
      legs: { present: false },
      shape: 'corner',
    },
  },
  {
    fixture: DEEP_SEAT_LOUNGE,
    note: 'deep and low, wide arms, on a plinth',
    published: {
      id: 'deep-seat-lounge',
      name: 'Havsta deep-seat lounge',
      overallWidthCm: 210,
      overallDepthCm: 110,
      overallHeightCm: 75,
      seatHeightCm: 48,
      seatDepthCm: 80,
      armrests: 'present',
      armrestWidthCm: 16,
      armrestHeightCm: 55,
      legs: { present: false },
      shape: 'straight',
    },
  },
  {
    fixture: RECLINER_2_SEAT,
    note: 'a mechanism housing across the back that nothing in a listing names',
    published: {
      id: 'recliner-2-seat',
      name: 'Brekke 2-seat recliner',
      overallWidthCm: 180,
      overallDepthCm: 100,
      overallHeightCm: 105,
      seatHeightCm: 50,
      seatDepthCm: 70,
      armrests: 'present',
      armrestWidthCm: 4,
      armrestHeightCm: 70,
      legs: { present: false },
      shape: 'straight',
    },
  },
  {
    fixture: SOFA_BED,
    note: 'a folded bed frame filling the body, so there is nothing to carve underneath',
    published: {
      id: 'sofa-bed',
      name: 'Lindholm sofa bed',
      overallWidthCm: 200,
      overallDepthCm: 100,
      overallHeightCm: 90,
      seatHeightCm: 62,
      seatDepthCm: 70,
      armrests: 'present',
      armrestWidthCm: 4,
      armrestHeightCm: 68,
      legs: { present: false },
      shape: 'straight',
    },
  },
];

/**
 * A seventh case, for the sweep only: the three-seat sofa with a leg inset.
 *
 * No shop publishes where the legs stand in plan, so it is absent from all six
 * listings above — which means the under-seat carve, one of the pipeline's five
 * rules, is never exercised against ground truth. It is exactly the field the
 * improvement list asks a store operator for, so an operator supplying it is the
 * realistic way it arrives. The fixture's legs stand 6 cm in on X and 3.5 cm on
 * Y; the sound published figure is the smaller of the two, rounded down.
 */
export const WITH_LEG_INSET: GroundTruthCase = {
  fixture: SOFA_3_SEAT,
  note: 'the same sofa once an operator supplies the leg inset',
  published: {
    ...LISTINGS[0]!.published,
    id: 'sofa-3-seat-with-inset',
    legs: { present: true, heightCm: 15, insetCm: 3, detachable: true },
    fieldSources: { 'legs.insetCm': 'operator-entered' },
  },
};
