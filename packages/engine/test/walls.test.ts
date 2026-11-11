import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALL_THICKNESS,
  SOFA_3_SEAT,
  THICK_WALL_BOUND,
  WALL_THICKNESSES_IN_HOMES,
  buildLibraryForWalls,
  prepareItem,
  reportOn,
} from '../src/index.ts';

/**
 * The library behind the walls a home has.
 *
 * A consumer that has not been told the wall answers for the thinnest one and
 * finds out whether any thicker one would change its answer. That only works
 * if the levels are built honestly: a maneuver kept from a thinner level must
 * be one whose numbers are known to hold behind the thicker wall, and a
 * maneuver that depends on the wall must be built again behind each.
 */
describe('the default wall', () => {
  it('is an interior partition, and the first of the walls a home has', () => {
    expect(DEFAULT_WALL_THICKNESS).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_WALL_THICKNESS).toBeLessThanOrEqual(20);
    expect(WALL_THICKNESSES_IN_HOMES[0]).toBe(DEFAULT_WALL_THICKNESS);
    for (let i = 1; i < WALL_THICKNESSES_IN_HOMES.length; i++) {
      expect(WALL_THICKNESSES_IN_HOMES[i]!).toBeGreaterThan(WALL_THICKNESSES_IN_HOMES[i - 1]!);
    }
    // The proof device stays out of the range a person is ever shown.
    expect(THICK_WALL_BOUND).toBeGreaterThan(WALL_THICKNESSES_IN_HOMES[WALL_THICKNESSES_IN_HOMES.length - 1]!);
  });

  it('is never printed as a figure of a hundred centimetres', () => {
    const report = reportOn(SOFA_3_SEAT, 12);
    expect(report.wallStatement).not.toContain(String(THICK_WALL_BOUND));
    expect(report.wallStatementHe).not.toContain(String(THICK_WALL_BOUND));
    expect(report.wallStatement).toContain('12 cm');
  });
});

describe('buildLibraryForWalls', () => {
  const levels = buildLibraryForWalls(prepareItem(SOFA_3_SEAT), [12, 30, 40]);
  const at = (wall: number) => levels.find((l) => l.wallThickness === wall)!.library;
  const find = (wall: number, id: string) => at(wall).maneuvers.find((m) => m.templateId === id);

  it('builds thinnest first, one library per wall', () => {
    expect(levels.map((l) => l.wallThickness)).toEqual([12, 30, 40]);
  });

  it('keeps a maneuver that is known to hold behind the thicker wall, as the same object', () => {
    const thin = find(12, 'straight-in')!;
    expect(thin.holdsForWallsUpTo).toBe(THICK_WALL_BOUND);
    expect(find(30, 'straight-in')).toBe(thin);
    expect(find(40, 'straight-in')).toBe(thin);
  });

  it('builds again, behind each thicker wall, the ones whose numbers depend on it', () => {
    const lean12 = find(12, 'lean-and-straighten')!;
    const lean30 = find(30, 'lean-and-straighten')!;
    expect(lean12.holdsForWallsUpTo).toBe(12);
    expect(lean30.holdsForWallsUpTo).toBe(30);
    expect(lean30).not.toBe(lean12);
    expect(lean30.wallThickness).toBe(30);
    // The same doorway width behind either, to within the schedule search's
    // grid — 82.74 behind 12 cm and 82.72 behind 30, each a witness found on
    // a grid rather than an optimum; the height it needs is the one number
    // the tunnel's depth moves.
    expect(Math.abs(lean30.requirement.doorWidth - lean12.requirement.doorWidth)).toBeLessThan(0.05);
    expect(lean30.requirement.doorHeight).toBeGreaterThan(lean12.requirement.doorHeight);
  });

  it('leaves out, behind a wall it does not apply to, a maneuver that applied behind a thinner one', () => {
    expect(find(30, 'lean-and-straighten')).toBeDefined();
    expect(find(40, 'lean-and-straighten')).toBeUndefined();
    expect(at(40).rejected.some((r) => r.templateId === 'lean-and-straighten')).toBe(true);
  });

  it('never keeps a maneuver past the wall it holds for', () => {
    for (const level of levels) {
      for (const m of level.library.maneuvers) {
        expect(m.holdsForWallsUpTo).toBeGreaterThanOrEqual(level.wallThickness);
      }
    }
  });
});
