import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Item, Placement } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides } from '../src/geometry/collide.ts';
import { minimumDimension } from '../src/geometry/worldBox.ts';

const PARAMS: EnvironmentParams = {
  openingWidth: 90,
  openingHeight: 200,
  wallThickness: 15,
  hallwayWidth: 140,
  hallwayDepth: 400,
  roomDepth: 350,
  roomWidth: 400,
  ceilingHeight: 250,
};

/** A 10 cm cube standing on the placement origin — small enough to probe corners. */
const PROBE: Item = {
  id: 'probe',
  name: 'probe',
  nameHe: 'בדיקה',
  boxes: [{ center: { x: 0, y: 0, z: 5 }, halfExtents: { x: 5, y: 5, z: 5 }, rotation: { yaw: 0, pitch: 0, roll: 0 } }],
};

const at = (x: number, y: number, z = 0): Placement => ({ x, y, z, yaw: 0, pitch: 0 });

describe('buildEnvironment', () => {
  const env = buildEnvironment(PARAMS);

  it('emits the expected solids', () => {
    // Two wall flanks, a lintel, the hallway far wall, two hallway end caps,
    // two room side walls, the room's back wall, floor and ceiling: eleven. The
    // fourth wall piece — the threshold under the opening — is degenerate and
    // dropped.
    expect(env.solids).toHaveLength(11);
  });

  it('drops the degenerate threshold piece rather than emitting a zero-height solid', () => {
    // Nothing has a zero dimension, which is what keeps thinnestSolid usable as
    // the anti-tunnelling bound.
    for (const solid of env.solids) {
      expect(minimumDimension(solid)).toBeGreaterThan(0);
    }
  });

  it('drops the lintel when the opening reaches the ceiling', () => {
    const full = buildEnvironment({ ...PARAMS, openingHeight: PARAMS.ceilingHeight });
    expect(full.solids).toHaveLength(10);
  });

  it('reports the wall as the thinnest solid', () => {
    // The sampling density for edge validation is derived from this, so it must
    // track the real wall rather than the closing slabs.
    expect(env.thinnestSolid).toBe(PARAMS.wallThickness);
  });

  it('describes the free volumes from the parameters', () => {
    expect(env.hallway).toEqual({
      minX: -200,
      maxX: 200,
      minY: -140,
      maxY: 0,
      minZ: 0,
      maxZ: 250,
    });
    expect(env.room).toEqual({ minX: -200, maxX: 200, minY: 15, maxY: 365, minZ: 0, maxZ: 250 });
    expect(env.opening).toEqual({ minX: -45, maxX: 45, minY: 0, maxY: 15, minZ: 0, maxZ: 200 });
  });

  it('rejects impossible measurements', () => {
    expect(() => buildEnvironment({ ...PARAMS, openingWidth: 0 })).toThrow(/positive/);
    expect(() => buildEnvironment({ ...PARAMS, openingHeight: 400 })).toThrow(/ceilingHeight/);
    expect(() => buildEnvironment({ ...PARAMS, openingWidth: 500 })).toThrow(/hallwayDepth/);
  });
});

describe('collides against a built environment', () => {
  const env = buildEnvironment(PARAMS);

  it('leaves the hallway free', () => {
    expect(collides(PROBE, at(0, -70), env)).toBe(false);
    expect(collides(PROBE, at(-150, -20), env)).toBe(false);
  });

  it('leaves the room free', () => {
    expect(collides(PROBE, at(0, 200), env)).toBe(false);
  });

  it('leaves the doorway itself free', () => {
    expect(collides(PROBE, at(0, 7.5), env)).toBe(false);
  });

  it('blocks the wall beside the opening', () => {
    expect(collides(PROBE, at(60, 7.5), env)).toBe(true);
    expect(collides(PROBE, at(-60, 7.5), env)).toBe(true);
  });

  it('blocks the lintel above the opening', () => {
    expect(collides(PROBE, at(0, 7.5, PARAMS.openingHeight + 1), env)).toBe(true);
    expect(collides(PROBE, at(0, 7.5, PARAMS.openingHeight - 11), env)).toBe(false);
  });

  it('blocks the floor and the ceiling', () => {
    expect(collides(PROBE, at(0, -70, -1), env)).toBe(true);
    expect(collides(PROBE, at(0, -70, PARAMS.ceilingHeight - 9), env)).toBe(true);
    expect(collides(PROBE, at(0, -70, PARAMS.ceilingHeight - 10), env)).toBe(false);
  });

  it('blocks the hallway far wall and both ends', () => {
    expect(collides(PROBE, at(0, -PARAMS.hallwayWidth - 1), env)).toBe(true);
    expect(collides(PROBE, at(-205, -70), env)).toBe(true);
    expect(collides(PROBE, at(205, -70), env)).toBe(true);
  });

  it('blocks the room walls', () => {
    expect(collides(PROBE, at(0, 370), env)).toBe(true);
    expect(collides(PROBE, at(205, 200), env)).toBe(true);
  });

  it('treats resting exactly on the floor as free, not as contact', () => {
    // The probe's underside is exactly at z = 0, flush with the floor slab.
    expect(collides(PROBE, at(0, -70, 0), env)).toBe(false);
  });
});
