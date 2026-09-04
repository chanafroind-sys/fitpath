import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Item, Placement } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, prepareItem } from '../src/geometry/collide.ts';
import { firstContactAlongPath } from '../src/planner/replay.ts';
import { plan } from '../src/planner/plan.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';

/**
 * The compare view's whole argument: same sofa, same doorway, two corridors.
 * The wide one has a path; replayed in the narrow one, that path hits a wall.
 */
const CORRIDOR: Omit<EnvironmentParams, 'hallwayWidth'> = {
  openingWidth: 110,
  openingHeight: 210,
  wallThickness: 15,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 220,
};

const WIDE = buildEnvironment({ ...CORRIDOR, hallwayWidth: 240 });
const NARROW = buildEnvironment({ ...CORRIDOR, hallwayWidth: 100 });

/** Valid in both corridors, so the two plans start from the same pose. */
const SHARED_START: Placement = { x: 0, y: -50, z: 16, yaw: 0, pitch: 0 };

/** A wall only 2 cm thick, so a replay that only tested waypoints would jump it. */
const THIN_WALL: EnvironmentParams = {
  openingWidth: 80,
  openingHeight: 200,
  wallThickness: 2,
  hallwayWidth: 200,
  hallwayDepth: 400,
  roomDepth: 300,
  roomWidth: 400,
  ceilingHeight: 250,
};

const CUBE: Item = {
  id: 'cube',
  name: 'crate',
  nameHe: 'ארגז',
  boxes: [
    {
      center: { x: 0, y: 0, z: 20 },
      halfExtents: { x: 20, y: 20, z: 20 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
    },
  ],
};

const at = (x: number, y: number, z = 0): Placement => ({ x, y, z, yaw: 0, pitch: 0 });

describe('firstContactAlongPath', () => {
  it('returns undefined for an empty path', () => {
    expect(firstContactAlongPath(CUBE, [], NARROW)).toBeUndefined();
  });

  it('handles a single-placement path that is clear', () => {
    expect(firstContactAlongPath(SOFA_3_SEAT, [SHARED_START], NARROW)).toBeUndefined();
  });

  it('handles a single-placement path that is blocked', () => {
    const inTheWall: Placement = { x: 0, y: 5, z: 16, yaw: 0, pitch: 0 };
    const contact = firstContactAlongPath(SOFA_3_SEAT, [inTheWall], NARROW);
    expect(contact).toEqual({ segment: 0, t: 0, placement: inTheWall });
  });

  it('reports no contact when a path is replayed in the environment it was planned for', () => {
    const result = plan(SOFA_3_SEAT, WIDE, { diagnostics: false, start: SHARED_START });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(firstContactAlongPath(SOFA_3_SEAT, result.path, WIDE)).toBeUndefined();
  });

  it('finds the corridor wall when a wide-hallway path is replayed in a narrow one', () => {
    const result = plan(SOFA_3_SEAT, WIDE, { diagnostics: false, start: SHARED_START });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;

    const contact = firstContactAlongPath(SOFA_3_SEAT, result.path, NARROW);
    expect(contact).toBeDefined();
    if (!contact) return;

    // The shared start is clear in both corridors, so the path must get going
    // before anything stops it.
    expect(contact.segment === 0 && contact.t === 0).toBe(false);
    expect(collides(SOFA_3_SEAT, contact.placement, NARROW)).toBe(true);
    // ...and it is the NARROW corridor doing the stopping, not the doorway.
    expect(collides(SOFA_3_SEAT, contact.placement, WIDE)).toBe(false);
  });

  it('reports contact at the very first placement when the start itself is blocked', () => {
    // Backed against the far wall of a 240 cm corridor, and therefore outside a
    // 100 cm one before the path has moved at all.
    const start: Placement = { x: 0, y: -190, z: 16, yaw: 0, pitch: 0 };
    const result = plan(SOFA_3_SEAT, WIDE, { diagnostics: false, start });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;

    const contact = firstContactAlongPath(SOFA_3_SEAT, result.path, NARROW);
    expect(contact).toEqual({ segment: 0, t: 0, placement: result.path[0] });
  });

  it('samples the interior of a segment, not only its endpoints', () => {
    // Both endpoints sit in open air, one either side of a 2 cm wall, well
    // clear of the opening. Testing waypoints alone would call this clear.
    const environment = buildEnvironment(THIN_WALL);
    const from = at(150, -60);
    const to = at(150, 60);
    expect(collides(CUBE, from, environment)).toBe(false);
    expect(collides(CUBE, to, environment)).toBe(false);

    const contact = firstContactAlongPath(CUBE, [from, to], environment);
    expect(contact).toBeDefined();
    expect(contact?.segment).toBe(0);
    expect(contact?.t).toBeGreaterThan(0);
    expect(contact?.t).toBeLessThan(1);
  });

  it('lets the same crossing through when it goes via the opening', () => {
    const environment = buildEnvironment(THIN_WALL);
    expect(firstContactAlongPath(CUBE, [at(0, -60), at(0, 60)], environment)).toBeUndefined();
  });

  it('accepts a PreparedItem, and agrees with the Item form', () => {
    const environment = buildEnvironment(THIN_WALL);
    const path = [at(150, -60), at(150, 60)];
    expect(firstContactAlongPath(prepareItem(CUBE), path, environment)).toEqual(
      firstContactAlongPath(CUBE, path, environment),
    );
  });

  it('is deterministic', () => {
    const result = plan(SOFA_3_SEAT, WIDE, { diagnostics: false, start: SHARED_START });
    if (!result.feasible) throw new Error('expected a path');
    const once = firstContactAlongPath(SOFA_3_SEAT, result.path, NARROW);
    const twice = firstContactAlongPath(SOFA_3_SEAT, result.path, NARROW);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});
