import { describe, expect, it } from 'vitest';
import type { Item, Placement } from '../src/index.ts';
import {
  SOFA_3_SEAT,
  TRIVIAL_FIT,
  buildEnvironment,
  collides,
  createEdgeValidator,
  interpolate,
  itemWorldBoxes,
  placementRotation,
  plan,
  prepareItem,
  radians,
} from '../src/index.ts';

/**
 * `Placement.roll`: validated and animated, never searched.
 *
 * The field exists for one reason — the lean maneuver is a roll and a pitch
 * at once — and it is dangerous for one reason: the collider builds its
 * rotation inline for speed, and a placement it silently misread would be a
 * pose judged clear that was never checked. So the tests here are about
 * agreement. A rolled placement of the sofa must put every corner exactly
 * where the same placement of a sofa *authored* pre-rolled puts it — the
 * construction every lean measurement used before the field existed — and
 * the collider must say the same thing about both.
 */

/** The same item, authored rotated about its length. */
function preRolled(item: Item, deg: number): Item {
  const rho = radians(deg);
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  return {
    ...item,
    id: `${item.id}-rolled-${deg}`,
    boxes: item.boxes.map((box) => ({
      ...box,
      center: { x: box.center.x, y: box.center.y * c - box.center.z * s, z: box.center.y * s + box.center.z * c },
      rotation: { ...box.rotation, roll: box.rotation.roll + rho },
    })),
  };
}

const sofa = prepareItem(SOFA_3_SEAT);

/** A sweep of poses that stand in for the ones the lean template authors. */
const POSES: { yaw: number; pitch: number; roll: number }[] = [];
for (const yawDeg of [0, 90, 210]) {
  for (const pitchDeg of [-58, -20, 0, 15, 45]) {
    for (const rollDeg of [-80, 10, 90, 280]) {
      POSES.push({ yaw: radians(yawDeg), pitch: radians(pitchDeg), roll: radians(rollDeg) });
    }
  }
}

describe('a placement with a roll', () => {
  it('puts every corner where the same placement of a pre-rolled item puts it', () => {
    for (const pose of POSES) {
      const rolled = itemWorldBoxes(sofa, { x: 12, y: -40, z: 30, yaw: pose.yaw, pitch: pose.pitch, tiltAxis: 'y', roll: pose.roll });
      const authored = itemWorldBoxes(prepareItem(preRolled(SOFA_3_SEAT, (pose.roll * 180) / Math.PI)), {
        x: 12,
        y: -40,
        z: 30,
        yaw: pose.yaw,
        pitch: pose.pitch,
        tiltAxis: 'y',
      });
      for (let b = 0; b < rolled.length; b++) {
        for (const key of ['x', 'y', 'z'] as const) {
          expect(rolled[b]!.center[key]).toBeCloseTo(authored[b]!.center[key], 9);
          expect(rolled[b]!.aabbMin[key]).toBeCloseTo(authored[b]!.aabbMin[key], 9);
          expect(rolled[b]!.aabbMax[key]).toBeCloseTo(authored[b]!.aabbMax[key], 9);
        }
      }
    }
  });

  it('is judged by the collider exactly as the pre-rolled item is, clear or not', () => {
    // A scene the sofa half fits: leaning poses hit the ceiling and the
    // doorway, level ones mostly clear, so the sweep sees both answers.
    const environment = buildEnvironment({
      openingWidth: 100,
      openingHeight: 200,
      wallThickness: 30,
      hallwayWidth: 320,
      hallwayDepth: 420,
      roomDepth: 320,
      roomWidth: 420,
      ceilingHeight: 240,
    });
    let hits = 0;
    let misses = 0;
    for (const pose of POSES) {
      const authored = prepareItem(preRolled(SOFA_3_SEAT, (pose.roll * 180) / Math.PI));
      for (const y of [-180, -100, -10, 15, 120]) {
        for (const z of [50, 100, 140]) {
          const withRoll: Placement = { x: 0, y, z, yaw: pose.yaw, pitch: pose.pitch, tiltAxis: 'y', roll: pose.roll };
          const withoutRoll: Placement = { x: 0, y, z, yaw: pose.yaw, pitch: pose.pitch, tiltAxis: 'y' };
          const a = collides(sofa, withRoll, environment);
          const b = collides(authored, withoutRoll, environment);
          expect(a).toBe(b);
          if (a) hits++;
          else misses++;
        }
      }
    }
    // The sweep has to exercise both answers, or it has tested nothing.
    expect(hits).toBeGreaterThan(20);
    expect(misses).toBeGreaterThan(20);
  });

  it('means exactly what it used to when the roll is absent or zero', () => {
    const base = placementRotation({ yaw: radians(30), pitch: radians(-20) });
    const zero = placementRotation({ yaw: radians(30), pitch: radians(-20), roll: 0 });
    expect(zero).toEqual(base);
    const familyX = placementRotation({ yaw: radians(30), pitch: radians(-20), tiltAxis: 'x' });
    const familyXZero = placementRotation({ yaw: radians(30), pitch: radians(-20), tiltAxis: 'x', roll: 0 });
    expect(familyXZero).toEqual(familyX);
  });

  it('in the tilt family that already turns about local X, only adds to the tilt', () => {
    const summed = placementRotation({ yaw: radians(30), pitch: radians(50), tiltAxis: 'x' });
    const split = placementRotation({ yaw: radians(30), pitch: radians(20), tiltAxis: 'x', roll: radians(30) });
    for (let c = 0; c < 3; c++) {
      expect(split[c]!.x).toBeCloseTo(summed[c]!.x, 12);
      expect(split[c]!.y).toBeCloseTo(summed[c]!.y, 12);
      expect(split[c]!.z).toBeCloseTo(summed[c]!.z, 12);
    }
  });

  it('interpolates, and is dropped again where neither end has it', () => {
    const a: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, tiltAxis: 'y', roll: radians(-80) };
    const b: Placement = { x: 10, y: 0, z: 0, yaw: 0, pitch: radians(40), tiltAxis: 'y', roll: radians(-60) };
    const mid = interpolate(a, b, 0.5);
    expect(mid.roll).toBeCloseTo(radians(-70), 12);
    expect(mid.pitch).toBeCloseTo(radians(20), 12);

    const c: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const d: Placement = { x: 10, y: 0, z: 0, yaw: 0, pitch: radians(40) };
    expect('roll' in interpolate(c, d, 0.5)).toBe(false);
  });

  it('counts toward the anti-tunnelling sample bound like any other rotation', () => {
    const environment = buildEnvironment(TRIVIAL_FIT.params);
    const validator = createEdgeValidator(sofa, environment);
    const still: Placement = { x: 0, y: -100, z: 20, yaw: 0, pitch: 0, tiltAxis: 'y' };
    const rolled: Placement = { ...still, roll: radians(90) };
    expect(validator.sampleCount(still, still)).toBe(1);
    // A quarter turn of a 137 cm reach sweeps over two metres of arc; one
    // sample per third of the thinnest solid is dozens of samples.
    expect(validator.sampleCount(still, rolled)).toBeGreaterThan(20);
  });

  it('is refused by the planner, which has no roll to search', () => {
    const environment = buildEnvironment(TRIVIAL_FIT.params);
    expect(() =>
      plan(TRIVIAL_FIT.item, environment, {
        diagnostics: false,
        start: { x: 0, y: -100, z: 20, yaw: 0, pitch: 0, tiltAxis: 'y', roll: radians(10) },
      }),
    ).toThrow(/roll is not a planner dimension/);
  });
});
