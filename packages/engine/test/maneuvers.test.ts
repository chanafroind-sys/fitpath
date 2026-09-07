import { describe, expect, it } from 'vitest';
import type { Item } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, prepareItem } from '../src/geometry/collide.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { buildLibrary, buildManeuver } from '../src/maneuvers/build.ts';
import { ON_ITS_SIDE, SEAT_FIRST, STRAIGHT_IN, TEMPLATES, bestRollSchedule } from '../src/maneuvers/templates.ts';
import { selectManeuver } from '../src/maneuvers/select.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';

const WALL = 15;
const sofa = prepareItem(SOFA_3_SEAT);

/** The same sofa with its own removable part taken off. */
const LEGLESS: Item = {
  ...SOFA_3_SEAT,
  id: 'sofa-3-seat-legless',
  boxes: SOFA_3_SEAT.boxes.slice(0, 4),
  removableParts: [],
};

function requirementOf(item = sofa, template = ON_ITS_SIDE) {
  const outcome = buildManeuver(item, template, WALL);
  if (!outcome.ok) throw new Error(`${template.id}: ${outcome.reason}`);
  return outcome.maneuver;
}

describe('the maneuver library', () => {
  it('validates all three templates for the sofa, and measures what each needs', () => {
    const { maneuvers, rejected } = buildLibrary(sofa, WALL);
    expect(rejected).toEqual([]);
    expect(maneuvers.map((m) => m.templateId)).toEqual([
      'straight-in',
      'on-its-side',
      'seat-first',
    ]);

    const [straight, side, seat] = maneuvers as [
      (typeof maneuvers)[0],
      (typeof maneuvers)[0],
      (typeof maneuvers)[0],
    ];

    // Turn it square to the door and walk in: the 95 cm depth is what the
    // doorway sees, and the 85 cm height is what the lintel sees.
    expect(straight.requirement.doorWidth).toBeCloseTo(95.01, 2);
    expect(straight.requirement.doorHeight).toBeCloseTo(85.0, 2);

    // On its side those two swap over.
    expect(side.requirement.doorWidth).toBeCloseTo(85.01, 2);
    expect(side.requirement.doorHeight).toBeCloseTo(95.0, 2);

    // And threading gets to the same width by a longer road, needing a much
    // taller opening on the way. See the test below for why it can do no better.
    expect(seat.requirement.doorWidth).toBeCloseTo(85.04, 2);
    expect(seat.requirement.doorHeight).toBeCloseTo(117.81, 2);
  });

  /**
   * The one that decides whether threading is worth having for this item.
   *
   * `rollSchedule` returns the minimax value over the whole crossing: the
   * narrowest doorway any roll schedule could get this item through, station by
   * station, at one degree of resolution over the full circle. It is a floor on
   * every schedule, not the score of one — so a maneuver matching it is optimal
   * and a claim of anything narrower would have to be wrong.
   *
   * For this sofa it is 85 cm, the same width the item shows lying flat on its
   * side, and the reason is in the next test.
   */
  it('threading cannot beat lying on its side, and its own bound says so', () => {
    const schedule = bestRollSchedule(sofa, WALL, 210);
    expect(schedule).toBeDefined();
    expect(schedule!.bound).toBeCloseTo(85.0, 2);

    const seat = requirementOf(sofa, SEAT_FIRST);
    const side = requirementOf(sofa, ON_ITS_SIDE);
    // The maneuver achieves its bound, to within the straight interpolation
    // between waypoints.
    expect(seat.requirement.doorWidth).toBeLessThan(schedule!.bound + 0.1);
    // And so ties rather than wins.
    expect(seat.requirement.doorWidth).toBeGreaterThanOrEqual(side.requirement.doorWidth);
  });

  /**
   * Why it ties: the legs.
   *
   * The middle of a sofa is an L — seat and leaning backrest — and rolled past
   * the upright it tucks into 66 cm, far under the 95 it shows square on. That
   * is the geometry threading exists to exploit. It buys nothing here because
   * the legs stand 15 cm proud at each end, every station of the item has to
   * cross the wall, and no roll makes a leg station narrower than 85. Take the
   * legs off and the floor drops to the body's own 70, and threading reaches it.
   */
  it('the legs are what set the floor, not the shape of the middle', () => {
    const legless = prepareItem(LEGLESS);
    expect(bestRollSchedule(legless, WALL, 210)!.bound).toBeCloseTo(70.0, 2);
    expect(requirementOf(legless, ON_ITS_SIDE).requirement.doorWidth).toBeCloseTo(70.01, 2);
    expect(requirementOf(legless, SEAT_FIRST).requirement.doorWidth).toBeCloseTo(70.01, 2);
    // Straight in cannot use the difference at all: it never turns the item.
    expect(requirementOf(legless, STRAIGHT_IN).requirement.doorWidth).toBeCloseTo(95.01, 2);
  });

  /**
   * The requirement is the narrowest that works, not a padded one.
   *
   * Recorded numbers are a promise. This checks the promise from both sides:
   * the motion runs in exactly the environment it asks for, and it does not run
   * in one a centimetre tighter.
   */
  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    'the %s requirement is tight in both directions',
    (_id, template) => {
      const outcome = buildManeuver(sofa, template, WALL);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const { requirement, path } = outcome.maneuver;

      const scene = (doorWidth: number) =>
        buildEnvironment({
          openingWidth: doorWidth,
          openingHeight: requirement.doorHeight,
          wallThickness: WALL,
          hallwayWidth: requirement.hallwayClearance,
          hallwayDepth: 400,
          roomDepth: requirement.roomDepth,
          roomWidth: 400,
          ceilingHeight: requirement.doorHeight + 40,
        });

      const runs = (doorWidth: number): boolean => {
        const environment = scene(doorWidth);
        const validator = createEdgeValidator(sofa, environment);
        for (const placement of path) {
          if (collides(sofa, placement, environment)) return false;
        }
        for (let i = 0; i + 1 < path.length; i++) {
          if (!validator.isValid(path[i]!, path[i + 1]!)) return false;
        }
        return true;
      };

      expect(runs(requirement.doorWidth)).toBe(true);
      expect(runs(requirement.doorWidth - 1)).toBe(false);
    },
  );

  it('is deterministic: the same item builds the same library twice', () => {
    const a = buildLibrary(sofa, WALL);
    const b = buildLibrary(sofa, WALL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('choosing a maneuver at runtime', () => {
  const library = buildLibrary(sofa, WALL).maneuvers;
  const roomy = { doorHeight: 210, hallwayClearance: 300, roomDepth: 400 };

  it('takes the simplest maneuver that fits, not the one that fits the tightest', () => {
    // Straight in also needs the widest door, and at 110 cm all three work.
    // What a person wants told to them is the one with the fewest motions.
    const selection = selectManeuver(library, { doorWidth: 110, ...roomy });
    expect(selection.found).toBe(true);
    if (!selection.found) return;
    expect(selection.maneuver.templateId).toBe('straight-in');
    expect(selection.alternatives.map((m) => m.templateId)).toEqual([
      'on-its-side',
      'seat-first',
    ]);
  });

  it('falls to turning the item over once straight in stops working', () => {
    const selection = selectManeuver(library, { doorWidth: 86, ...roomy });
    expect(selection.found).toBe(true);
    if (!selection.found) return;
    expect(selection.maneuver.templateId).toBe('on-its-side');
    expect(selection.maneuver.requirement.doorWidth).toBeLessThanOrEqual(86);
  });

  /**
   * The honesty rule, as a test.
   *
   * Below 85 cm nothing in the library covers the doorway, and the answer to
   * that is "no maneuver in the library fits" — a statement about the library.
   * It is not a verdict about the sofa, the caller is expected to fall back to
   * the planner, and only `provableNoFit` may ever report a definite no. So the
   * result carries no `feasible` field to be misread as one; it carries the
   * reasons, which is what an explanation is made of.
   */
  it('reports a miss as a miss, naming which measurement fell short', () => {
    const selection = selectManeuver(library, { doorWidth: 80, ...roomy });
    expect(selection.found).toBe(false);
    if (selection.found) return;

    expect(selection.rejected).toHaveLength(3);
    for (const rejection of selection.rejected) {
      expect(rejection.shortfall.doorWidth).toBeDefined();
      expect(rejection.shortfall.doorWidth!.has).toBe(80);
      expect(rejection.shortfall.doorWidth!.needs).toBeGreaterThan(80);
    }
    // Nothing here is a claim about the item.
    expect(Object.keys(selection)).toEqual(['found', 'rejected']);
  });

  it('names the corridor when the corridor is the problem, not the door', () => {
    const selection = selectManeuver(library, {
      doorWidth: 110,
      doorHeight: 210,
      hallwayClearance: 100,
      roomDepth: 400,
    });
    expect(selection.found).toBe(false);
    if (selection.found) return;
    for (const rejection of selection.rejected) {
      expect(rejection.shortfall.doorWidth).toBeUndefined();
      expect(rejection.shortfall.hallwayClearance).toBeDefined();
    }
  });
});
