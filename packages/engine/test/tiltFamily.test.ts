import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Placement } from '../src/types.ts';
import type { NodeIndices } from '../src/planner/lattice.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, itemWorldBoxes, prepareItem } from '../src/geometry/collide.ts';
import { contains, unionAabb } from '../src/geometry/worldBox.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { buildLattice, packKey, placementOf, snap, unpackKey } from '../src/planner/lattice.ts';
import { expandNeighbours, pivotAnchorsByFamily } from '../src/planner/astar.ts';
import { plan } from '../src/planner/plan.ts';
import { degrees, radians } from '../src/math/rotation.ts';
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

  it('lays the sofa on its side, and that really does clear a 90 cm doorway', () => {
    const environment = buildEnvironment(door(90));
    const item = prepareItem(SOFA_3_SEAT);
    const validator = createEdgeValidator(item, environment);
    const at = (y: number): Placement => ({
      x: 28,
      y,
      z: 50,
      yaw: radians(90),
      pitch: radians(-90),
      tiltAxis: 'x',
    });

    for (let y = -150; y <= 170; y += 2) {
      expect(`y=${y}: ${collides(item, at(y), environment) ? 'blocked' : 'clear'}`).toBe(
        `y=${y}: clear`,
      );
    }
    expect(validator.isValid(at(-150), at(170))).toBe(true);
    expect(contains(environment.room, unionAabb(itemWorldBoxes(item, at(170))))).toBe(true);
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
