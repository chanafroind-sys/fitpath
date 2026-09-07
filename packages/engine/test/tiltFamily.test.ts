import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Placement, Vec3 } from '../src/types.ts';
import type { NodeIndices } from '../src/planner/lattice.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, itemWorldBoxes, prepareItem } from '../src/geometry/collide.ts';
import { contains, unionAabb } from '../src/geometry/worldBox.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { buildLattice, packKey, placementOf, snap, unpackKey } from '../src/planner/lattice.ts';
import { expandNeighbours, pivotAnchorsByFamily } from '../src/planner/astar.ts';
import { plan } from '../src/planner/plan.ts';
import { degrees, radians, rotationMatrix, transform } from '../src/math/rotation.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';

const door = (openingWidth: number): EnvironmentParams => ({
  openingWidth,
  openingHeight: 210,
  wallThickness: 15,
  hallwayWidth: 300,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
});

const FINE = {
  stepX: 2,
  stepY: 2,
  stepZ: 2,
  yawStepDeg: 15,
  pitchStepDeg: 15,
  maxPitchDeg: 90,
};

/** Widest span across the doorway, over every orientation a family admits. */
function narrowestPresentation(families: readonly ('x' | 'y')[]): number {
  let best = Infinity;
  for (const tiltAxis of families) {
    for (let yaw = 0; yaw < 360; yaw += 15) {
      for (let pitch = -90; pitch <= 90; pitch += 15) {
        const placement: Placement = {
          x: 0,
          y: 0,
          z: 0,
          yaw: radians(yaw),
          pitch: radians(pitch),
          tiltAxis,
        };
        const aabb = unionAabb(itemWorldBoxes(SOFA_3_SEAT, placement));
        if (aabb.maxZ - aabb.minZ > 210) continue;
        best = Math.min(best, aabb.maxX - aabb.minX);
      }
    }
  }
  return best;
}

describe('the second tilt family', () => {
  it('is what turns a 95 cm sofa into an 85 cm one', () => {
    // One family: pitch turns about local Y, which for this fixture tips the
    // sofa onto its back. The 95 cm depth stays across the doorway whatever the
    // pitch, because pitch turns about that very axis.
    expect(narrowestPresentation(['y'])).toBeCloseTo(95, 6);
    // Both families: local X is the 220 cm length, so tilting about it lays the
    // sofa on its side and puts the 85 cm height across the doorway.
    expect(narrowestPresentation(['x', 'y'])).toBeCloseTo(85, 6);
  });

  /**
   * The floor beneath both families, and beneath any model this engine might
   * grow later.
   *
   * Swept over full SO(3) — yaw, pitch AND roll, which is wider than the
   * placement model the planner searches — the sofa cannot be held so as to
   * present less than 85 cm to a 210 cm lintel. So 85.00 is not an artefact of
   * fixing roll at zero; it is the item. The README quotes this number, and a
   * quoted number with nothing checking it is a number that drifts.
   *
   * What sets it is the legs: on its side the body is 70 cm across and the legs
   * stand 15 cm proud of it. Both halves of that are asserted, because the
   * explanation is the useful part.
   */
  it('cannot be held narrower than 85 cm at any rotation whatsoever, and the legs are why', () => {
    const corners = itemWorldBoxes(prepareItem(SOFA_3_SEAT), {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    }).map((b) => {
      const [ax, ay, az] = b.axes;
      const h = b.halfExtents;
      const out: Vec3[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        out.push({
          x: b.center.x + sx * ax.x * h.x + sy * ay.x * h.y + sz * az.x * h.z,
          y: b.center.y + sx * ax.y * h.x + sy * ay.y * h.y + sz * az.y * h.z,
          z: b.center.z + sx * ax.z * h.x + sy * ay.z * h.y + sz * az.z * h.z,
        });
      }
      return out;
    });

    // 6 degrees, which lands on the optimum at yaw 90 / pitch 18 / roll 90.
    const narrowest = (boxes: readonly number[]): number => {
      let best = Infinity;
      for (let yaw = 0; yaw < 360; yaw += 6) {
        for (let pitch = -90; pitch <= 90; pitch += 6) {
          for (let roll = 0; roll < 360; roll += 6) {
            const R = rotationMatrix(radians(yaw), radians(pitch), radians(roll));
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (const bi of boxes) for (const c of corners[bi]!) {
              const w = transform(R, c);
              if (w.x < minX) minX = w.x;
              if (w.x > maxX) maxX = w.x;
              if (w.z < minZ) minZ = w.z;
              if (w.z > maxZ) maxZ = w.z;
            }
            if (maxZ - minZ > 210) continue;
            if (maxX - minX < best) best = maxX - minX;
          }
        }
      }
      return best;
    };

    const ALL = corners.map((_, i) => i);
    expect(narrowest(ALL)).toBeCloseTo(85, 2);
    // Take the legs off — indices 4 to 7, the fixture's own removable part —
    // and the same sweep drops to the body's 70 cm.
    expect(narrowest([0, 1, 2, 3])).toBeCloseTo(70, 2);
  });

  it('doubles the state space rather than multiplying it by twelve', () => {
    const item = prepareItem(SOFA_3_SEAT);
    const environment = buildEnvironment(door(90));
    const one = buildLattice(item, environment, { ...FINE, secondTiltFamily: false });
    const two = buildLattice(item, environment, { ...FINE, secondTiltFamily: true });
    expect(one.ntilt).toBe(1);
    expect(two.ntilt).toBe(2);

    // A shade over two, not exactly two, and the excess is honest rather than
    // slack: lattice bounds are computed per orientation, and the sideways
    // orientations reach further across and higher than any the first family
    // offers, so the position ranges widen a little as well. The claim being
    // pinned is the order of the cost — a second family, not a third angle.
    const growth = two.nodeCount / one.nodeCount;
    expect(growth).toBeGreaterThan(2);
    expect(growth).toBeLessThan(3);
  });

  it('keeps the heuristic bound unchanged, so nothing got weaker', () => {
    const item = prepareItem(SOFA_3_SEAT);
    const environment = buildEnvironment(door(90));
    const one = buildLattice(item, environment, { ...FINE, secondTiltFamily: false });
    const two = buildLattice(item, environment, { ...FINE, secondTiltFamily: true });
    expect(two.iyGoalMin).toBe(one.iyGoalMin);
  });

  it('packs both spellings of a level pose onto one node', () => {
    // At pitch 0 the families describe the same orientation. If they packed to
    // two keys the search would treat one pose as two nodes and could "cross
    // families" without moving.
    const item = prepareItem(SOFA_3_SEAT);
    const lattice = buildLattice(item, buildEnvironment(door(90)), {
      ...FINE,
      secondTiltFamily: true,
    });
    const level = { x: 0, y: -100, z: 16, yaw: radians(90), pitch: 0 } as const;
    const asY = snap(lattice, { ...level, tiltAxis: 'y' });
    const asX = snap(lattice, { ...level, tiltAxis: 'x' });
    expect(packKey(lattice, asX)).toBe(packKey(lattice, asY));
  });

  it('round-trips a tilted pose through the key, family included', () => {
    const item = prepareItem(SOFA_3_SEAT);
    const lattice = buildLattice(item, buildEnvironment(door(90)), {
      ...FINE,
      secondTiltFamily: true,
    });
    const sideways: Placement = {
      x: 28,
      y: -150,
      z: 50,
      yaw: radians(90),
      pitch: radians(-90),
      tiltAxis: 'x',
    };
    const node = snap(lattice, sideways);
    expect(node.itilt).toBe(1);
    expect(unpackKey(lattice, packKey(lattice, node))).toEqual(node);
    const back = placementOf(lattice, node);
    expect(back.tiltAxis).toBe('x');
    expect(degrees(back.pitch)).toBeCloseTo(-90, 6);
  });

  it('can only be entered from level, and never left except through level', () => {
    const item = prepareItem(SOFA_3_SEAT);
    const environment = buildEnvironment(door(90));
    const lattice = buildLattice(item, environment, { ...FINE, secondTiltFamily: true });
    const anchors = pivotAnchorsByFamily(item);

    const successors = (here: NodeIndices): NodeIndices[] => {
      const out: NodeIndices[] = [];
      const there: NodeIndices = { ix: 0, iy: 0, iz: 0, iyaw: 0, ipitch: 0, itilt: 0 };
      const offset = { x: 0, y: 0, z: 0 };
      expandNeighbours(lattice, anchors, here, placementOf(lattice, here), there, offset, () => {
        out.push({ ...there });
        return true;
      });
      return out;
    };

    const level: NodeIndices = { ix: 0, iy: -50, iz: 8, iyaw: 6, ipitch: 0, itilt: 0 };
    const fromLevel = successors(level);
    expect(fromLevel.some((n) => n.itilt === 1)).toBe(true);
    expect(fromLevel.some((n) => n.itilt === 0)).toBe(true);

    const tilted: NodeIndices = { ...level, ipitch: -2, itilt: 1 };
    // Off level, every successor either stays in family 1 or comes back to
    // level, which is family 0 by construction.
    for (const n of successors(tilted)) {
      expect(`${n.ipitch === 0 ? 'level' : `family ${n.itilt}`}`).not.toBe('family 0');
    }
  });

  /**
   * The witness behind the "search-limited" label in fastPasses.test.ts.
   *
   * Each of these is a straight run at a fixed orientation — the sofa on its
   * side, 85 cm of height presented to the doorway instead of 95 cm of depth —
   * carried from the hallway to wholly inside the room, and put through the
   * same `EdgeValidator` the planner uses on every edge it considers. A run
   * that validates is a path. The planner not finding it is a fact about the
   * planner.
   *
   * The x offsets differ by doorway because a narrower opening leaves less room
   * either side; they were found by scanning the corridor on a fixed 2 cm grid,
   * not fitted.
   */
  for (const [openingWidth, x] of [
    [94, 24],
    [90, 26],
    [86, 28],
  ] as const) {
    it(`the sideways run really does clear a ${openingWidth} cm doorway`, () => {
      const environment = buildEnvironment(door(openingWidth));
      const item = prepareItem(SOFA_3_SEAT);
      const validator = createEdgeValidator(item, environment);
      const at = (y: number): Placement => ({
        x,
        y,
        z: 48,
        yaw: radians(90),
        pitch: radians(-90),
        tiltAxis: 'x',
      });

      for (let y = -150; y <= 170; y += 2) {
        expect(`y=${y}: ${collides(item, at(y), environment) ? 'blocked' : 'clear'}`).toBe(
          `y=${y}: clear`,
        );
      }
      expect(validator.isValid(at(-150), at(180))).toBe(true);
      expect(contains(environment.room, unionAabb(itemWorldBoxes(item, at(180))))).toBe(true);
    });
  }

  /**
   * And the floor beneath them, measured rather than assumed.
   *
   * 84 cm has no straight run at any orientation the lattice admits, and the
   * reason is the legs: on its side the sofa's body is 70 cm across, but the
   * legs stand 15 cm proud of it, and every station of the item has to cross
   * the wall. 85.00 cm is where that stops being possible.
   */
  it('has no sideways run through 84 cm, because the legs stand 15 cm proud', () => {
    const environment = buildEnvironment(door(84));
    const item = prepareItem(SOFA_3_SEAT);
    const validator = createEdgeValidator(item, environment);
    for (let pitchDeg = -90; pitchDeg <= 90; pitchDeg += 15) {
      if (pitchDeg === 0) continue;
      for (const tiltAxis of ['x', 'y'] as const) {
        for (let x = -60; x <= 60; x += 2) {
          for (let z = 0; z <= 140; z += 2) {
            const at = (y: number): Placement => ({
              x, y, z, yaw: radians(90), pitch: radians(pitchDeg), tiltAxis,
            });
            expect(validator.isValid(at(-150), at(180))).toBe(false);
          }
        }
      }
    }
  });

  /**
   * The one that must never flip.
   *
   * 85 cm is the sofa's smallest face. Below it no rotation about any axis
   * helps, so neither family — nor roll, nor anything else — gets it through.
   * A path here would mean the new moves were letting the item through a wall.
   */
  it('does not let an 80 cm doorway pass, with both families searched', () => {
    const result = plan(SOFA_3_SEAT, buildEnvironment(door(80)), {
      diagnostics: false,
      maxNodes: 60_000,
      secondTiltFamily: true,
    });
    expect(result.feasible).toBe(false);
  });

  it('leaves every level placement meaning exactly what it used to', () => {
    // `tiltAxis` is optional and absent means 'y', so every placement written
    // before the families existed still denotes the same orientation.
    const withoutAxis: Placement = { x: 1, y: 2, z: 3, yaw: radians(30), pitch: radians(20) };
    const withY: Placement = { ...withoutAxis, tiltAxis: 'y' };
    expect(unionAabb(itemWorldBoxes(SOFA_3_SEAT, withoutAxis))).toEqual(
      unionAabb(itemWorldBoxes(SOFA_3_SEAT, withY)),
    );
  });
});
