import { describe, expect, it } from 'vitest';
import type { Box, EnvironmentParams, Item, Placement } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides } from '../src/geometry/collide.ts';
import { convexHullMinimumWidth, passageOutlook } from '../src/geometry/hullWidth.ts';
import { provableNoFit } from '../src/geometry/crossSection.ts';
import { REFRIGERATOR, SOFA_3_SEAT, WARDROBE } from '../src/fixtures/items.ts';
import { SCENARIOS } from '../src/fixtures/scenarios.ts';

describe('convexHullMinimumWidth', () => {
  it('measures each fixture at its thinnest', () => {
    // The sofa's thinnest direction is its height, legs included: 15 cm of leg
    // below the local origin and 70 cm of body above it.
    expect(convexHullMinimumWidth(SOFA_3_SEAT.boxes)).toBeCloseTo(85, 6);
    expect(convexHullMinimumWidth(WARDROBE.boxes)).toBeCloseTo(60, 6);
    expect(convexHullMinimumWidth(REFRIGERATOR.boxes)).toBeCloseTo(70, 6);
  });

  it('drops to the body height once the legs come off', () => {
    const legless = SOFA_3_SEAT.boxes.filter((_, i) => ![4, 5, 6, 7].includes(i));
    expect(convexHullMinimumWidth(legless)).toBeCloseTo(70, 6);
  });

  it('is an upper bound that does not move as the sampling is refined', () => {
    // Every fixture's thinnest direction is an axis, so the coarsest lattice
    // already lands on it. A finer one can only ever report the same or less.
    for (const item of [SOFA_3_SEAT, WARDROBE, REFRIGERATOR]) {
      const coarse = convexHullMinimumWidth(item.boxes, 12);
      const fine = convexHullMinimumWidth(item.boxes, 96);
      expect(fine).toBeLessThanOrEqual(coarse + 1e-9);
      expect(fine).toBeCloseTo(coarse, 6);
    }
  });

  it('is deterministic', () => {
    expect(convexHullMinimumWidth(SOFA_3_SEAT.boxes)).toBe(
      convexHullMinimumWidth(SOFA_3_SEAT.boxes),
    );
  });

  it('returns zero for an item with no boxes', () => {
    expect(convexHullMinimumWidth([])).toBe(0);
  });
});

/**
 * The reason this file exists: hull width is triage, never a proof.
 *
 * A helix is fatter than the opening in every direction and goes through it
 * anyway, by screwing. If the hull width were ever allowed to justify
 * "proven-too-large", this is the shape it would be confidently wrong about.
 */
describe('a hull that is too wide proves nothing', () => {
  const RADIUS = 40;
  const CUBE = 6;
  const PITCH = 120; // cm advanced per full turn
  const K = PITCH / (2 * Math.PI); // cm advanced per radian
  const PHI_MAX = 2 * 2 * Math.PI; // two turns
  const Z0 = 50; // height of the helix axis
  const WALL = 4;

  /** A chain of overlapping cubes wound about the item's local Y axis. */
  const HELIX: Item = {
    id: 'helix',
    name: 'helix',
    nameHe: 'סליל',
    boxes: ((): Box[] => {
      const boxes: Box[] = [];
      for (let phi = 0; phi <= PHI_MAX + 1e-9; phi += 0.1) {
        boxes.push({
          center: { x: RADIUS * Math.cos(phi), y: K * phi, z: RADIUS * Math.sin(phi) },
          halfExtents: { x: CUBE / 2, y: CUBE / 2, z: CUBE / 2 },
          rotation: { yaw: 0, pitch: 0, roll: 0 },
        });
      }
      return boxes;
    })(),
  };

  const PARAMS: EnvironmentParams = {
    openingWidth: 60,
    openingHeight: 100,
    wallThickness: WALL,
    hallwayWidth: 360,
    hallwayDepth: 240,
    roomDepth: 340,
    roomWidth: 240,
    ceilingHeight: 150,
  };

  const environment = buildEnvironment(PARAMS);

  /**
   * A pure screw about the world Y axis — which is the axis through the wall.
   * At yaw 0 the engine's pitch turns about exactly that axis, so the model
   * expresses this motion directly. The translation is matched to the helix's
   * own pitch, which is what makes it thread rather than sweep.
   */
  const Y0 = -K * (Math.PI / 2);
  const placementAt = (theta: number): Placement => ({
    x: 0,
    y: -K * theta + Y0,
    z: Z0,
    yaw: 0,
    pitch: theta,
  });

  const MARGIN = 2;
  const thetaStart = PHI_MAX - Math.PI / 2 + MARGIN;
  const thetaEnd = -Math.PI / 2 - WALL / K - MARGIN;

  const yRange = (theta: number): [number, number] => {
    const p = placementAt(theta);
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of HELIX.boxes) {
      lo = Math.min(lo, p.y + b.center.y - b.halfExtents.y);
      hi = Math.max(hi, p.y + b.center.y + b.halfExtents.y);
    }
    return [lo, hi];
  };

  it('is wider than the opening in every direction', () => {
    const width = convexHullMinimumWidth(HELIX.boxes);
    expect(width).toBeGreaterThan(PARAMS.openingWidth);
    expect(width).toBeCloseTo(86, 0);
  });

  it('starts wholly in the hallway and ends wholly in the room', () => {
    expect(yRange(thetaStart)[1]).toBeLessThan(0);
    expect(yRange(thetaEnd)[0]).toBeGreaterThan(WALL);
  });

  it('screws through the opening without touching anything', () => {
    const steps = 2000;
    for (let i = 0; i <= steps; i++) {
      const theta = thetaStart + ((thetaEnd - thetaStart) * i) / steps;
      expect(collides(HELIX, placementAt(theta), environment)).toBe(false);
    }
  });

  it('is not claimed to be impossible by the sound closed-form check', () => {
    // The section argument is the one the engine is allowed to trust, and it
    // correctly declines to refute a shape that genuinely passes.
    expect(provableNoFit(HELIX.boxes, PARAMS.openingWidth, PARAMS.openingHeight).proven).toBe(false);
  });
});

describe('passageOutlook', () => {
  it('calls the reported case hopeless: a 220x95x85 sofa at a 76 cm door', () => {
    const outlook = passageOutlook(SOFA_3_SEAT, 76, 210);
    expect(outlook.outlook).toBe('hopeless');
    expect(outlook.hullMinimumWidth).toBeCloseTo(85, 6);
    expect(outlook.openingSmallerSide).toBe(76);
  });

  it('reports the removable part that would relieve it, without acting on it', () => {
    // 85 cm as authored, 70 cm with the legs off, against a 76 cm door. The
    // outlook stays hopeless — that is the search about to run — but the way
    // out is named.
    const outlook = passageOutlook(SOFA_3_SEAT, 76, 210);
    expect(outlook.outlook).toBe('hopeless');
    expect(outlook.relievedBy?.part).toBe('legs');
    expect(outlook.relievedBy?.hullMinimumWidth).toBeCloseTo(70, 6);
  });

  it('leaves relievedBy unset when no part is enough', () => {
    // 69 cm clears neither 85 nor 70.
    expect(passageOutlook(SOFA_3_SEAT, 69, 210).relievedBy).toBeUndefined();
    // ...and the refrigerator has nothing to remove at all.
    expect(passageOutlook(REFRIGERATOR, 50, 200).relievedBy).toBeUndefined();
  });

  it('switches just below and just above the threshold', () => {
    // The sofa as authored is 85 cm at its narrowest.
    expect(passageOutlook(SOFA_3_SEAT, 84, 210).outlook).toBe('hopeless');
    expect(passageOutlook(SOFA_3_SEAT, 85, 210).outlook).toBe('worth-searching');
    // The refrigerator is 70.
    expect(passageOutlook(REFRIGERATOR, 69, 210).outlook).toBe('hopeless');
    expect(passageOutlook(REFRIGERATOR, 70, 210).outlook).toBe('worth-searching');
  });

  it('reads the smaller side of the opening, whichever it is', () => {
    expect(passageOutlook(REFRIGERATOR, 210, 69).outlook).toBe('hopeless');
    expect(passageOutlook(REFRIGERATOR, 69, 210).outlook).toBe('hopeless');
  });

  it('leaves the scenarios that turn on the corridor to the planner', () => {
    // These three are decided by space to maneuver, not by raw size, and the
    // triage must not take them away: their whole value is what the search
    // finds. `impossible` is excluded because the closed-form proof answers it
    // before any triage runs.
    for (const id of ['trivial-fit', 'tilt-required', 'narrow-hallway']) {
      const scenario = SCENARIOS.find((s) => s.id === id)!;
      const outlook = passageOutlook(
        scenario.item,
        scenario.params.openingWidth,
        scenario.params.openingHeight,
      );
      expect(`${id}:${outlook.outlook}`).toBe(`${id}:worth-searching`);
    }
  });

  it('triages the cellar hatch, and names the legs on the way past', () => {
    // A 78 cm hatch against an 85 cm sofa. The planner would take about three
    // seconds to reach the same place; the measurement gets there at once, and
    // says what to do about it.
    const scenario = SCENARIOS.find((s) => s.id === 'legs-must-come-off')!;
    const outlook = passageOutlook(scenario.item, scenario.params.openingWidth, scenario.params.openingHeight);
    expect(outlook.outlook).toBe('hopeless');
    expect(outlook.relievedBy?.part).toBe('legs');
  });
});
