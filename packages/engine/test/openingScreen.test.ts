import { describe, expect, it } from 'vitest';
import type { Placement } from '../src/types.ts';
import { openingAdmits } from '../src/geometry/crossSection.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, itemWorldBoxes, prepareItem } from '../src/geometry/collide.ts';
import { contains, unionAabb } from '../src/geometry/worldBox.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { plan } from '../src/planner/plan.ts';
import { radians } from '../src/math/rotation.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import { SCENARIOS } from '../src/fixtures/scenarios.ts';

/** The item's bounding box, as its author drew it. */
function dimensions(item: typeof SOFA_3_SEAT): [number, number, number] {
  const b = unionAabb(itemWorldBoxes(prepareItem(item), { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
  return [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ];
}

describe('the positive opening screen', () => {
  it('passes a box that walks straight through, and names the axis it travels on', () => {
    // 220 x 95 x 85 through 96 x 210: lead with the length, present 95 x 85.
    const proof = openingAdmits([220, 95, 85], 96, 210);
    expect(proof.passes).toBe(true);
    expect(proof.travelAxis).toBe(0);
    expect(proof.presented).toEqual([95, 85]);
  });

  it('accepts either way up, since an opening does not care which side is which', () => {
    // 95 across a 96 opening and 85 up a 210 one, or 85 across and 95 up.
    expect(openingAdmits([220, 95, 85], 96, 210).passes).toBe(true);
    expect(openingAdmits([220, 95, 85], 90, 210).passes).toBe(true);
    expect(openingAdmits([220, 95, 85], 84, 210).passes).toBe(false);
  });

  it('declines when no axis of travel presents a face that fits', () => {
    expect(openingAdmits([220, 95, 85], 80, 210).passes).toBe(false);
  });

  it('counts contact as passing, exactly as the collision test does', () => {
    expect(openingAdmits([220, 95, 85], 95, 85).passes).toBe(true);
  });

  /**
   * The direction the bounding box is good for, stated as a test.
   *
   * A pass has to mean the item really goes through, so take the screen at its
   * word and build the motion it claims: hold the sofa at the orientation the
   * screen names and translate it from the hallway to inside the room, through
   * an opening it passes by one centimetre. Every edge validated.
   */
  it('a pass really is a straight walk-through, checked against the collider', () => {
    const environment = buildEnvironment({
      openingWidth: 96,
      openingHeight: 210,
      wallThickness: 15,
      hallwayWidth: 300,
      hallwayDepth: 320,
      roomDepth: 400,
      roomWidth: 400,
      ceilingHeight: 250,
    });
    expect(openingAdmits(dimensions(SOFA_3_SEAT), 96, 210).passes).toBe(true);

    const item = prepareItem(SOFA_3_SEAT);
    const validator = createEdgeValidator(item, environment);
    // Travel axis 0 is the sofa's length, so yaw 90 points it at the door.
    const at = (y: number): Placement => ({ x: 0, y, z: 15, yaw: radians(90), pitch: 0 });
    for (let y = -150; y <= 190; y += 2) {
      expect(`y=${y}: ${collides(item, at(y), environment) ? 'blocked' : 'clear'}`).toBe(
        `y=${y}: clear`,
      );
    }
    expect(validator.isValid(at(-150), at(190))).toBe(true);
    expect(contains(environment.room, unionAabb(itemWorldBoxes(item, at(190))))).toBe(true);
  });

  /**
   * The direction it is NOT good for, and the reason this is a screen and never
   * a verdict.
   *
   * The sofa's mid-length section is an L — a seat and a leaning backrest. Its
   * bounding box is 95 x 70, so the narrowest that box will ever present is
   * 70 cm, on its side. The L inside it goes to 66 cm when rolled past the
   * upright, because rolling tucks the backrest over the seat in a way no box
   * can follow. A 68 cm opening therefore fails the screen and admits the
   * shape, which is the whole reason a failure may not be reported as a
   * negative.
   */
  it('failing proves nothing: the shape inside the box can be narrower than it', () => {
    const seatAndBackrest = { ...SOFA_3_SEAT, boxes: SOFA_3_SEAT.boxes.slice(0, 2) };
    const [, depth, height] = dimensions(seatAndBackrest);
    expect(depth).toBeCloseTo(95, 6);
    expect(height).toBeCloseTo(70, 6);
    // 70 across still clears anything 70 or wider, so the box is not useless.
    expect(openingAdmits(dimensions(seatAndBackrest), 70, 210).passes).toBe(true);
    // Below that it gives up, and the shape does not.
    expect(openingAdmits(dimensions(seatAndBackrest), 68, 210).passes).toBe(false);

    // But rolled, that same section is narrower than the box it lives in.
    const boxes = itemWorldBoxes(prepareItem(seatAndBackrest), {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    });
    let narrowest = Infinity;
    for (let deg = -180; deg <= 180; deg += 0.25) {
      const t = (deg * Math.PI) / 180;
      let min = Infinity;
      let max = -Infinity;
      for (const b of boxes) {
        const [ax, ay, az] = b.axes;
        const h = b.halfExtents;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const y = b.center.y + sx * ax.y * h.x + sy * ay.y * h.y + sz * az.y * h.z;
          const z = b.center.z + sx * ax.z * h.x + sy * ay.z * h.y + sz * az.z * h.z;
          const u = y * Math.cos(t) - z * Math.sin(t);
          if (u < min) min = u;
          if (u > max) max = u;
        }
      }
      narrowest = Math.min(narrowest, max - min);
    }
    expect(narrowest).toBeLessThan(68);
  });

  /**
   * And what a pass does NOT license.
   *
   * It is a statement about the aperture, not about the environment. The
   * narrow-hallway scenario has a 110 cm opening this screen passes and no path
   * at all, because there is nowhere to line the sofa up.
   */
  it('is about the opening, not the room: a pass is not a verdict of feasible', () => {
    const scenario = SCENARIOS.find((s) => s.id === 'narrow-hallway')!;
    expect(
      openingAdmits(
        dimensions(scenario.item),
        scenario.params.openingWidth,
        scenario.params.openingHeight,
      ).passes,
    ).toBe(true);

    const result = plan(scenario.item, buildEnvironment(scenario.params), {
      diagnostics: false,
      maxNodes: 1_200_000,
    });
    expect(result.feasible).toBe(false);
  });
});
