import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Placement } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, collidesReference, itemWorldBoxes, prepareItem } from '../src/geometry/collide.ts';
import { unionAabb } from '../src/geometry/worldBox.ts';
import { ITEMS, REFRIGERATOR, SOFA_3_SEAT, WARDROBE } from '../src/fixtures/items.ts';

const PARAMS: EnvironmentParams = {
  openingWidth: 90,
  openingHeight: 200,
  wallThickness: 15,
  hallwayWidth: 150,
  hallwayDepth: 400,
  roomDepth: 300,
  roomWidth: 350,
  ceilingHeight: 260,
};

/** Fixed, reproducible sweep of placements — no randomness anywhere in this project. */
function* placements(): Generator<Placement> {
  for (let ix = -6; ix <= 6; ix += 3) {
    for (let iy = -5; iy <= 5; iy += 2) {
      for (let iz = 0; iz <= 2; iz++) {
        for (let iyaw = 0; iyaw < 8; iyaw++) {
          for (let ipitch = -2; ipitch <= 2; ipitch++) {
            yield {
              x: ix * 31,
              y: iy * 29,
              z: iz * 37,
              yaw: (iyaw * Math.PI) / 4,
              pitch: (ipitch * Math.PI) / 6,
            };
          }
        }
      }
    }
  }
}

describe('item fixtures', () => {
  // These caught a real bug: the tilted backrest was positioned from its
  // nominal half-extents rather than its rotated ones, which quietly made the
  // sofa 100.5 cm deep and 100.6 cm tall instead of 95 x 85.
  // Local-frame extents along X, Y, Z. The wardrobe's 60 cm depth is on local X
  // and its 180 cm width on local Y, because pitch turns about local Y and that
  // is the axis a person tips a wardrobe over.
  const expected: [string, [number, number, number]][] = [
    [SOFA_3_SEAT.id, [220, 95, 85]],
    [WARDROBE.id, [60, 180, 220]],
    [REFRIGERATOR.id, [70, 75, 185]],
  ];

  for (const [id, [width, depth, height]] of expected) {
    it(`${id} measures exactly ${width} x ${depth} x ${height}`, () => {
      const item = ITEMS.find((i) => i.id === id)!;
      const aabb = unionAabb(
        itemWorldBoxes(prepareItem(item), { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }),
      );
      expect(aabb.maxX - aabb.minX).toBeCloseTo(width, 6);
      expect(aabb.maxY - aabb.minY).toBeCloseTo(depth, 6);
      expect(aabb.maxZ - aabb.minZ).toBeCloseTo(height, 6);
    });
  }

  it('hangs the sofa legs below the origin so removing them still rests on the floor', () => {
    const withLegs = unionAabb(
      itemWorldBoxes(prepareItem(SOFA_3_SEAT), { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }),
    );
    const withoutLegs = unionAabb(
      itemWorldBoxes(prepareItem(SOFA_3_SEAT, [4, 5, 6, 7]), {
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
      }),
    );
    expect(withLegs.minZ).toBeCloseTo(-15, 6);
    expect(withoutLegs.minZ).toBeCloseTo(0, 6);
    expect(withoutLegs.maxZ - withoutLegs.minZ).toBeCloseTo(70, 6);
  });
});

describe('collides', () => {
  const environment = buildEnvironment(PARAMS);

  // The planner calls collides tens of millions of times, so it uses a flat,
  // allocation-free path that exploits the solids being axis-aligned. That is
  // only safe if it agrees with the plain routine everywhere.
  for (const item of ITEMS) {
    it(`agrees with the reference implementation for the ${item.id}`, () => {
      const prepared = prepareItem(item);
      let checked = 0;
      let hits = 0;
      for (const placement of placements()) {
        const fast = collides(prepared, placement, environment);
        const reference = collidesReference(prepared, placement, environment);
        if (fast !== reference) {
          throw new Error(
            `disagreement at ${JSON.stringify(placement)}: fast=${fast} reference=${reference}`,
          );
        }
        checked++;
        if (fast) hits++;
      }
      // A sweep that never touches anything would agree trivially and prove
      // nothing, so assert that it found both kinds of answer.
      expect(checked).toBeGreaterThan(1000);
      expect(hits).toBeGreaterThan(100);
      expect(hits).toBeLessThan(checked);
    });
  }

  it('counts every call when given a counter', () => {
    const counter = { collisionChecks: 0 };
    const prepared = prepareItem(WARDROBE);
    collides(prepared, { x: 0, y: -50, z: 0, yaw: 0, pitch: 0 }, environment, counter);
    collides(prepared, { x: 0, y: -60, z: 0, yaw: 0, pitch: 0 }, environment, counter);
    expect(counter.collisionChecks).toBe(2);
  });
});
