import { describe, expect, it } from 'vitest';
import type { Item, ManeuverTemplate, Placement } from '../src/index.ts';
import {
  SOFA_3_SEAT,
  buildEnvironment,
  buildManeuver,
  interpolate,
  itemWorldBoxes,
  prepareItem,
  radians,
  reportOn,
  unionAabb,
  verifyPathIn,
} from '../src/index.ts';
import witness from './support/leanWitness280.json' with { type: 'json' };

/**
 * **The library is missing a maneuver, and this is the path that proves it.**
 *
 * For three rounds the three-seater's 85.01 cm was treated as the floor: the
 * best of five templates, and the minimax over every roll schedule agreed to
 * the hundredth. That minimax is a floor over *roll* — rotation about the
 * travel axis — and over nothing else. A lean into the direction of travel
 * moves points *along* the travel axis, so what is inside the wall slab is no
 * longer a function of the station, and the recurrence does not describe it.
 * It was reported as a floor on every way of turning the sofa. It is not.
 *
 * The motion here was found by a minimax over lean schedules with a sideways
 * slide, at a fixed roll of 280 degrees — ten degrees short of flat on its
 * side — with the sofa authored pre-rolled so the engine's own `pitch` is the
 * lean (bench/lean-minimax.ts). The sofa leans up to 58 degrees into the
 * doorway as its leading leg station crosses, so that the leg is through
 * before the backrest's top arrives; levels for the middle; and leans the
 * other way for the trailing end. It goes through **83.05 cm** in a 30 cm
 * wall. Same in a 15 cm wall; a 40 cm wall takes it away again (95.98).
 *
 * The fixture is the path itself, 283 placements, and the test is the
 * collider: every waypoint against `collides`, every edge against the same
 * `EdgeValidator` the planner uses, in an environment whose opening is the
 * width claimed. A path that validates is a path. What this does NOT show is
 * where the true floor is: 83.05 is a witness, and the family it was found in
 * — one roll, lean up to 60 degrees at 3 degrees per centimetre, sliding at
 * 2 — is a family, not the space of all motions.
 *
 * The legs are still most of the story: with them off the body goes through
 * 70. The lean recovers about two of the fifteen centimetres they cost.
 */

/** The same sofa, authored rolled about its length so that pitch is a lean. */
function preRolled(item: Item, deg: number): Item {
  const rho = radians(deg);
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  return {
    ...item,
    id: `${item.id}-rolled-${deg}`,
    name: `${item.name}, rolled ${deg} degrees`,
    boxes: item.boxes.map((box) => ({
      ...box,
      center: { x: box.center.x, y: box.center.y * c - box.center.z * s, z: box.center.y * s + box.center.z * c },
      rotation: { ...box.rotation, roll: box.rotation.roll + rho },
    })),
  };
}

const WALL = witness.wall;
const path = witness.path as Placement[];
const sofa = prepareItem(preRolled(SOFA_3_SEAT, witness.rhoDeg));

describe('the lean-and-straighten witness', () => {
  it('is 83.05 cm, in a 30 cm wall, with the real legs on', () => {
    expect(witness.rhoDeg).toBe(280);
    expect(witness.legs).toBe(true);
    expect(WALL).toBe(30);
    expect(witness.bound).toBeLessThan(83.05);
    expect(path).toHaveLength(283);
  });

  it('clears the collider at every waypoint and along every edge through an 83.05 cm opening', () => {
    const environment = buildEnvironment({
      openingWidth: 83.05,
      openingHeight: 210,
      wallThickness: WALL,
      hallwayWidth: 400,
      hallwayDepth: 400,
      roomDepth: 400,
      roomWidth: 400,
      ceilingHeight: 260,
    });
    expect(verifyPathIn(sofa, path, environment)).toBeUndefined();
  });

  it('is a real path and not a rounding artefact: 84 cm clears too, 82 cm does not', () => {
    const at = (openingWidth: number) =>
      buildEnvironment({
        openingWidth,
        openingHeight: 210,
        wallThickness: WALL,
        hallwayWidth: 400,
        hallwayDepth: 400,
        roomDepth: 400,
        roomWidth: 400,
        ceilingHeight: 260,
      });
    expect(verifyPathIn(sofa, path, at(84))).toBeUndefined();
    expect(verifyPathIn(sofa, path, at(82))).toBeDefined();
  });

  it('really leans: the pitch reaches 58 degrees and returns to level, twice', () => {
    const degrees = path.map((p) => Math.round((p.pitch * 180) / Math.PI));
    expect(Math.max(...degrees)).toBe(58);
    expect(Math.min(...degrees)).toBe(-58);
    // Level through the middle of the sofa, where nothing is gained by tipping it.
    const middle = path.filter((p) => p.y > -20 && p.y < 60);
    expect(middle.every((p) => p.pitch === 0)).toBe(true);
  });

  it('measures, by buildManeuver, a doorway narrower than the library floor — and says what it costs', () => {
    const template: ManeuverTemplate = {
      id: 'lean-and-straighten',
      name: 'Lean into the doorway and straighten inside it',
      nameHe: 'להטות לתוך הפתח וליישר בתוכו',
      build: () => [{ id: 'all', name: 'all', nameHe: 'הכול', waypoints: path.map((p) => ({ ...p })) }],
    };
    const outcome = buildManeuver(sofa, template, WALL);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const r = outcome.maneuver.requirement;
    expect(r.doorWidth).toBeCloseTo(83.01, 2);
    // The library, measured the same way: its floor is still the roll floor,
    // 85.00, and its narrowest is now the lean template's own schedule, which
    // centres a little better than this bench path and lands at 82.72.
    const library = reportOn(SOFA_3_SEAT, WALL);
    expect(library.floor!).toBeCloseTo(85.0, 2);
    expect(library.narrowest!).toBeCloseTo(82.72, 2);
    expect(library.narrowest!).toBeLessThanOrEqual(r.doorWidth);
    expect(r.doorWidth).toBeLessThan(library.floor! - 1.9);
    // What the lean costs: a doorway half again as tall, and a ceiling to lean under.
    expect(r.doorHeight).toBeGreaterThan(147);
    let headroom = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      for (let k = 0; k <= 4; k++) {
        headroom = Math.max(headroom, unionAabb(itemWorldBoxes(sofa, interpolate(path[i]!, path[i + 1]!, k / 4))).maxZ);
      }
    }
    expect(headroom).toBeGreaterThan(243);
    expect(headroom).toBeLessThan(250);
  });

  it('is not something the planner can express for the sofa as authored: two tilt families, no roll', () => {
    // The motion needs a roll of 280 degrees AND a pitch about the axis across
    // the doorway at the same time. A Placement has yaw and one pitch, about
    // local Y or local X, and the two families meet only at level. Authoring
    // the roll into the item is what made it expressible; nothing in the
    // planner's search space for SOFA_3_SEAT itself contains this path.
    const leaning = path.find((p) => Math.abs(p.pitch) > radians(50))!;
    expect(leaning.tiltAxis).toBe('y');
    expect(Math.abs(leaning.pitch)).toBeGreaterThan(0);
    expect(sofa.item.boxes[0]!.rotation.roll).toBeCloseTo(radians(280), 12);
    expect(SOFA_3_SEAT.boxes[0]!.rotation.roll).toBe(0);
  });
});
