import { describe, expect, it } from 'vitest';
import type { Rotation, Vec3, WorldBox } from '../src/types.ts';
import { toWorldBox } from '../src/geometry/worldBox.ts';
import { satOverlap } from '../src/geometry/sat.ts';
import { radians } from '../src/math/rotation.ts';

const NO_ROTATION: Rotation = { yaw: 0, pitch: 0, roll: 0 };

function box(center: Vec3, halfExtents: Vec3, rotation: Rotation = NO_ROTATION): WorldBox {
  return toWorldBox(
    { center, halfExtents, rotation },
    { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  );
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Every case is asserted both ways round: SAT must not care which box is A. */
function overlap(a: WorldBox, b: WorldBox): boolean {
  const forward = satOverlap(a, b);
  const backward = satOverlap(b, a);
  expect(forward).toBe(backward);
  return forward;
}

describe('satOverlap', () => {
  it('reports a plain overlap', () => {
    expect(overlap(box(v(0, 0, 0), v(1, 1, 1)), box(v(1, 0, 0), v(1, 1, 1)))).toBe(true);
  });

  it('reports a plain separation', () => {
    expect(overlap(box(v(0, 0, 0), v(1, 1, 1)), box(v(3, 0, 0), v(1, 1, 1)))).toBe(false);
  });

  describe('degenerate cases', () => {
    it('faces exactly touching do not overlap', () => {
      // Gap is exactly zero. A sofa that grazes the jamb goes through.
      expect(overlap(box(v(0, 0, 0), v(1, 1, 1)), box(v(2, 0, 0), v(1, 1, 1)))).toBe(false);
    });

    it('faces touching after a rotation still do not overlap', () => {
      const reach = 2 * Math.cos(Math.PI / 4); // half-extent of a 45-degree box along x
      const tilted = box(v(0, 0, 0), v(1, 1, 1), { yaw: radians(45), pitch: 0, roll: 0 });
      expect(overlap(tilted, box(v(reach + 1, 0, 0), v(1, 1, 1)))).toBe(false);
    });

    it('a vertex exactly on a face does not overlap', () => {
      // The 45-degree box's +x corner lands exactly on the other box's -x face,
      // so the only contact is a single point.
      const reach = 2 * Math.cos(Math.PI / 4);
      const tilted = box(v(0, 0, 0), v(1, 1, 1), { yaw: radians(45), pitch: 0, roll: 0 });
      const flat = box(v(reach + 0.5, 0, 0), v(0.5, 5, 5));
      expect(overlap(tilted, flat)).toBe(false);
    });

    it('a vertex just past a face does overlap', () => {
      const reach = 2 * Math.cos(Math.PI / 4);
      const tilted = box(v(0, 0, 0), v(1, 1, 1), { yaw: radians(45), pitch: 0, roll: 0 });
      const flat = box(v(reach + 0.5 - 0.01, 0, 0), v(0.5, 5, 5));
      expect(overlap(tilted, flat)).toBe(true);
    });

    it('parallel boxes separate and overlap correctly', () => {
      // Identical orientations make all nine cross products degenerate at once,
      // so this case is entirely decided by the six face normals.
      const a = box(v(0, 0, 0), v(1, 1, 1));
      expect(overlap(a, box(v(1.5, 1.5, 1.5), v(1, 1, 1)))).toBe(true);
      expect(overlap(a, box(v(2.5, 0, 0), v(1, 1, 1)))).toBe(false);
      expect(overlap(a, box(v(0, 0, 0), v(1, 1, 1)))).toBe(true);
    });

    it('boxes sharing an edge direction separate and overlap correctly', () => {
      // Both are upright, so their +Z edges are parallel: the three cross
      // products involving Z vanish and must be skipped rather than normalised.
      const a = box(v(0, 0, 0), v(1, 1, 1));
      const turned = (cx: number, cz: number): WorldBox =>
        box(v(cx, 0, cz), v(1, 1, 1), { yaw: radians(30), pitch: 0, roll: 0 });
      expect(overlap(a, turned(0, 3))).toBe(false); // separated along the shared axis
      expect(overlap(a, turned(0, 1))).toBe(true);
      expect(overlap(a, turned(3, 0))).toBe(false); // separated in the shared-axis plane
      expect(overlap(a, turned(2, 0))).toBe(true);
    });

    it('a zero-size box behaves as the point it is', () => {
      const point = (p: Vec3): WorldBox => box(p, v(0, 0, 0));
      const solid = box(v(0, 0, 0), v(1, 1, 1));
      expect(overlap(point(v(0, 0, 0)), solid)).toBe(true); // strictly inside
      expect(overlap(point(v(0.5, -0.5, 0.25)), solid)).toBe(true);
      expect(overlap(point(v(2, 0, 0)), solid)).toBe(false); // outside
      expect(overlap(point(v(1, 0, 0)), solid)).toBe(false); // exactly on the face: touching
    });

    it('two coincident zero-size boxes do not overlap', () => {
      const point = box(v(0, 0, 0), v(0, 0, 0));
      expect(overlap(point, box(v(0, 0, 0), v(0, 0, 0)))).toBe(false);
    });

    it('a box flattened in one dimension is still tested exactly', () => {
      // A wall piece can legitimately have zero thickness when the opening
      // reaches the ceiling; it must behave like a plane, not like nothing.
      const sheet = box(v(0, 0, 0), v(5, 0, 5));
      expect(overlap(sheet, box(v(0, 0.5, 0), v(1, 1, 1)))).toBe(true);
      expect(overlap(sheet, box(v(0, 1, 0), v(1, 1, 1)))).toBe(false);
      expect(overlap(sheet, box(v(0, 2, 0), v(1, 1, 1)))).toBe(false);
    });

    it('a deeply nested box overlaps its container', () => {
      expect(overlap(box(v(0, 0, 0), v(0.1, 0.1, 0.1)), box(v(0, 0, 0), v(50, 50, 50)))).toBe(
        true,
      );
    });

    it('an edge-edge separation is caught only by a cross-product axis', () => {
      // Two long bars, one along X and one along Y, tilted so that no face
      // normal separates them but the edge-edge axis does. This is the case the
      // nine cross products exist for.
      const barX = box(v(0, 0, 0), v(5, 0.5, 0.5), { yaw: 0, pitch: radians(45), roll: 0 });
      const barY = box(v(0, 0, 3), v(5, 0.5, 0.5), {
        yaw: radians(90),
        pitch: radians(45),
        roll: 0,
      });
      expect(overlap(barX, barY)).toBe(false);
    });
  });
});
