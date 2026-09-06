import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Step } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { plan } from '../src/planner/plan.ts';
import { assertPlausible } from '../src/planner/describe.ts';
import { refinePath } from '../src/planner/refine.ts';
import { prepareItem } from '../src/geometry/collide.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { degrees } from '../src/math/rotation.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import { SCENARIOS } from '../src/fixtures/scenarios.ts';

/**
 * The scene from the bug report: a 96 cm doorway, which the sofa's 95 cm depth
 * clears by a centimetre.
 */
const REPORTED: EnvironmentParams = {
  openingWidth: 96,
  openingHeight: 210,
  wallThickness: 15,
  hallwayWidth: 300,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
};

const rotations = (steps: readonly Step[]): Step[] =>
  steps.filter((s) => s.kind === 'yaw' || s.kind === 'pitch');

describe('instructions a person could actually follow', () => {
  const result = plan(SOFA_3_SEAT, buildEnvironment(REPORTED), {
    diagnostics: false,
    maxNodes: 1_200_000,
  });

  it('finds a path at all', () => {
    expect(result.feasible).toBe(true);
  });

  it('never reports a rotation beyond 180 degrees', () => {
    if (!result.feasible) return;
    for (const step of rotations(result.steps)) {
      expect(`${step.kind} ${Math.abs(step.amount) <= 180}`).toBe(`${step.kind} true`);
    }
  });

  it('never leaves the item past vertical', () => {
    // Pitch is clamped to +/-90 by the lattice, so any placement beyond it
    // would mean the path escaped the configuration space it was searched in.
    if (!result.feasible) return;
    for (const p of result.path) {
      expect(Math.abs(degrees(p.pitch))).toBeLessThanOrEqual(90 + 1e-9);
    }
  });

  it('does not repeat one magnitude across consecutive steps on different axes', () => {
    // The report's signature was "forward 120 cm", then "rotate 120 degrees",
    // then "tilt 120 degrees". One number arriving three times across three
    // axes is lattice arithmetic leaking through, not a maneuver.
    if (!result.feasible) return;
    for (let i = 1; i < result.steps.length; i++) {
      const a = result.steps[i - 1]!;
      const b = result.steps[i]!;
      if (a.kind === b.kind) continue;
      const same = Math.abs(Math.round(a.amount)) === Math.abs(Math.round(b.amount));
      expect(`${a.kind}->${b.kind}: ${same ? 'repeats' : 'distinct'}`).toBe(
        `${a.kind}->${b.kind}: distinct`,
      );
    }
  });

  it('ends with the item level and resting on the floor', () => {
    // A* stops at the first pose whose bounding box is inside the room, and
    // tipping the item up shrinks that box — so without settling, the path ends
    // with a sofa standing on end a metre off the floor.
    if (!result.feasible) return;
    const last = result.path[result.path.length - 1]!;
    expect(degrees(last.pitch)).toBeCloseTo(0, 6);
  });
});

describe('assertPlausible', () => {
  const step = (kind: Step['kind'], amount: number): Step => ({
    index: 0,
    kind,
    from: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    to: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    amount,
    en: '',
    he: '',
  });

  it('passes a rotation at the limit', () => {
    expect(() => assertPlausible([step('yaw', 180)])).not.toThrow();
    expect(() => assertPlausible([step('pitch', -180)])).not.toThrow();
  });

  it('throws on a rotation beyond it', () => {
    expect(() => assertPlausible([step('yaw', 181)])).toThrow(/beyond the 180 degree maximum/);
  });

  it('ignores translations, which are measured in centimetres', () => {
    expect(() => assertPlausible([step('advance', 400)])).not.toThrow();
  });
});

describe('refinePath', () => {
  const fine = { stepX: 2, stepY: 2, stepZ: 2, yawStepDeg: 15, pitchStepDeg: 15, maxPitchDeg: 90 };

  it('leaves a path of one placement alone', () => {
    const one = [{ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }];
    expect(refinePath(one, fine)).toEqual(one);
  });

  it('cuts a coarse translation into reference-sized pieces', () => {
    const path = [
      { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
      { x: 0, y: 16, z: 0, yaw: 0, pitch: 0 },
    ];
    const refined = refinePath(path, fine);
    expect(refined).toHaveLength(9);
    expect(refined[0]).toEqual(path[0]);
    expect(refined[8]).toEqual(path[1]);
    expect(refined[1]!.y).toBeCloseTo(2, 9);
  });

  it('cuts a coarse rotation by the reference angle', () => {
    const path = [
      { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
      { x: 0, y: 0, z: 0, yaw: Math.PI / 2, pitch: 0 },
    ];
    // 90 degrees at 15 degrees a step.
    expect(refinePath(path, fine)).toHaveLength(7);
  });

  it('keeps the endpoints exactly, so the motion is unchanged', () => {
    const path = [
      { x: -48, y: -248, z: 16, yaw: 0, pitch: 0 },
      { x: 0, y: -128, z: 72, yaw: 0.5, pitch: 0.5 },
      { x: 8, y: -64, z: 40, yaw: 1.0, pitch: -0.25 },
    ];
    const refined = refinePath(path, fine);
    expect(refined[0]).toEqual(path[0]);
    expect(refined.at(-1)).toEqual(path[2]);
    expect(refined).toContainEqual(path[1]);
  });

  it('produces placements that are all still collision-free', () => {
    // Subdivision must not invent a placement the original motion did not
    // already pass through, so every piece has to be clear.
    const scenario = SCENARIOS.find((s) => s.id === 'trivial-fit')!;
    const environment = buildEnvironment(scenario.params);
    const result = plan(scenario.item, environment, { diagnostics: false });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;

    const prepared = prepareItem(scenario.item);
    const validator = createEdgeValidator(prepared, environment);
    const refined = refinePath(result.path, fine);
    for (let i = 0; i + 1 < refined.length; i++) {
      expect(validator.isValid(refined[i]!, refined[i + 1]!)).toBe(true);
    }
  });
});
