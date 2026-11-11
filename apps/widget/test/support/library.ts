import { CORNER_MAIN, CORNER_RETURN, CORNER_SOFA, SOFA_3_SEAT } from '@fitpath/engine';
import type { Item } from '@fitpath/engine';
import type { Verdict } from '../../src/modal/verdict.ts';
import type { Carry, Need, WallVariant, WidgetManeuver, WidgetProduct } from '../../src/types.ts';

/**
 * Hand-written libraries, so each case reads as a table.
 *
 * The numbers are the three-seater's real ones behind a 12 cm wall, rounded,
 * but nothing here depends on the build having run: the point of these tests
 * is the verdict logic — what is presented, what falls back, what is
 * mentioned and what is not — which is the part a change of wording must
 * never move. The geometry has its own tests.
 */
export const need = (doorWidth: number, doorHeight: number, front: number, along: number, behind: number, ceiling: number): Need => ({
  doorWidth,
  doorHeight,
  hallwayClearance: front,
  alongWall: along,
  roomDepth: behind,
  ceilingHeight: ceiling,
});

/** A maneuver whose numbers hold behind any wall. */
export const anyWall = (id: string, stages: number, n: Need): WidgetManeuver => ({
  templateId: id,
  name: id,
  nameHe: id,
  stages: Array.from({ length: stages }, (_, i) => ({ name: `step ${i}`, nameHe: `שלב ${i}` })),
  variants: [{ wallCm: 12, holdsForWallsUpTo: 100, need: n, turns: false, pathKey: `${id}@12` }],
});

/** A maneuver measured behind each wall separately; `null` where it does not apply. */
export const perWall = (id: string, stages: number, byWall: [number, Need | null][]): WidgetManeuver => ({
  templateId: id,
  name: id,
  nameHe: id,
  stages: Array.from({ length: stages }, (_, i) => ({ name: `step ${i}`, nameHe: `שלב ${i}` })),
  variants: byWall
    .filter((entry): entry is [number, Need] => entry[1] !== null)
    .map(([wallCm, n]): WallVariant => ({ wallCm, holdsForWallsUpTo: wallCm, need: n, turns: true, pathKey: `${id}@${wallCm}` })),
});

export const SOFA_LIBRARY: WidgetManeuver[] = [
  anyWall('straight-in', 1, need(95.01, 85, 222, 95.01, 222, 85)),
  anyWall('on-its-side', 3, need(85.01, 95, 222, 150, 222, 118)),
  anyWall('seat-first', 4, need(85.04, 117.81, 222, 165, 222, 125)),
  perWall('upright-through', 5, [
    [12, need(95, 222, 122.18, 260.77, 119.51, 233)],
    [40, need(95, 222, 122.18, 260.77, 119.51, 233)],
  ]),
  perWall('upright-left-standing', 4, [
    [12, need(95, 222, 122.18, 260.77, 87.01, 233)],
    [40, need(95, 222, 122.18, 260.77, 87.01, 233)],
  ]),
  perWall('lean', 5, [
    [12, need(82.74, 112, 236, 197.5, 236, 244)],
    [20, need(82.72, 125, 236, 197.5, 236, 244)],
    [30, need(82.72, 147.96, 236, 197.5, 236, 244)],
    [40, null],
  ]),
];

export const LEGS_OFF: WidgetManeuver[] = [
  anyWall('straight-in', 1, need(95.01, 70, 222, 95.01, 222, 70)),
  anyWall('on-its-side', 3, need(70.01, 95, 222, 165, 222, 112)),
  anyWall('seat-first', 4, need(70.01, 97, 222, 165, 222, 112)),
];

export function carry(id: string, item: Item, maneuvers: WidgetManeuver[]): Carry {
  const widths = maneuvers.map((m) => m.variants[0]!.need.doorWidth);
  return {
    id,
    name: id,
    nameHe: id,
    dimensions: { length: 220, depth: 95, height: 85 },
    item,
    maneuvers,
    ...(widths.length > 0 ? { narrowestCm: Math.min(...widths) } : {}),
    floorCm: 85,
  };
}

export function product(overrides: Partial<WidgetProduct> = {}): WidgetProduct {
  return {
    dataVersion: 3,
    id: 'sofa',
    name: '3-seat sofa',
    nameHe: 'ספה',
    illustration: '<svg/>',
    wallCm: 12,
    wallsCm: [12, 20, 30, 40],
    assembled: carry('sofa', SOFA_3_SEAT, SOFA_LIBRARY),
    separates: false,
    removable: [],
    ...overrides,
  };
}

export const withLegs = (detachable: true | 'unknown'): WidgetProduct =>
  product({ removable: [{ part: 'legs', partHe: 'הרגליים', detachable, carry: carry('sofa-without-legs', SOFA_3_SEAT, LEGS_OFF) }] });

export const presented = (v: Verdict): string | undefined => v.route?.carries[0]?.presented?.maneuver.templateId;


/** A corner sofa in two modules, the main run deciding. */
export const CORNER_MODULES: Carry[] = [
  carry('main', CORNER_MAIN, [anyWall('on-its-side', 3, need(85.01, 95, 278, 180, 278, 130))]),
  carry('return', CORNER_RETURN, [anyWall('seat-first', 4, need(64.57, 107.66, 107, 141.45, 107, 118))]),
];

export const cornerSofa = (): WidgetProduct =>
  product({
    id: 'corner',
    assembled: carry('corner', CORNER_SOFA, [anyWall('on-its-side', 3, need(85.01, 200, 282, 285, 282, 220))]),
    separates: true,
    modules: CORNER_MODULES,
  });
