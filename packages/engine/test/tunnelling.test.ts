import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Item, Placement } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { prepareItem, collides } from '../src/geometry/collide.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { radians } from '../src/math/rotation.ts';

/** A wall only 2 cm thick: thin enough that a careless edge check would jump it. */
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

const at = (x: number, y: number, z = 0, yaw = 0, pitch = 0): Placement => ({
  x,
  y,
  z,
  yaw,
  pitch,
});

describe('anti-tunnelling', () => {
  const environment = buildEnvironment(THIN_WALL);
  const item = prepareItem(CUBE);
  const validator = createEdgeValidator(item, environment);

  it('spaces samples by a fraction of the thinnest solid', () => {
    expect(environment.thinnestSolid).toBe(2);
    expect(validator.maxStepDistance).toBeCloseTo(2 / 3, 10);
  });

  it('rejects a fast diagonal edge that crosses the 2 cm wall', () => {
    // Both endpoints sit in open air — one in the hallway, one in the room —
    // well clear of the opening, so a check that only looked at the endpoints
    // would wave this straight through.
    const from = at(130, -60);
    const to = at(170, 60);
    expect(collides(item, from, environment)).toBe(false);
    expect(collides(item, to, environment)).toBe(false);

    expect(validator.isValid(from, to)).toBe(false);
  });

  it('rejects a straight edge that crosses the wall beside the opening', () => {
    const from = at(150, -40);
    const to = at(150, 40);
    expect(collides(item, from, environment)).toBe(false);
    expect(collides(item, to, environment)).toBe(false);
    expect(validator.isValid(from, to)).toBe(false);
  });

  it('accepts the same crossing when it goes through the opening', () => {
    const from = at(0, -40);
    const to = at(0, 40);
    expect(validator.isValid(from, to)).toBe(true);
  });

  it('samples a long edge densely enough to make crossing impossible', () => {
    // The bound is a swept distance: no material point may travel more than
    // maxStepDistance between samples, so the count scales with the motion.
    const from = at(130, -60);
    const to = at(170, 60);
    const distance = Math.hypot(170 - 130, 60 - -60);
    expect(validator.sampleCount(from, to)).toBeGreaterThanOrEqual(
      distance / validator.maxStepDistance,
    );
  });

  it('counts a rotation by the arc its furthest point sweeps, not by its angle', () => {
    // A 15 degree turn of a large item drags its corners a long way. Treating
    // rotation as cheap because the number of radians is small is exactly how a
    // planner ends up with a path that sweeps through a door frame.
    const pivot = at(0, -60);
    const turned = at(0, -60, 0, radians(15));
    const arc = radians(15) * item.reach;
    expect(validator.sampleCount(pivot, turned)).toBeGreaterThanOrEqual(
      arc / validator.maxStepDistance,
    );
    expect(validator.sampleCount(pivot, turned)).toBeGreaterThan(1);
  });
});
