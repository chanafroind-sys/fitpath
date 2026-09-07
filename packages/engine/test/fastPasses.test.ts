import { describe, expect, it } from 'vitest';
import type { EnvironmentParams } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, prepareItem } from '../src/geometry/collide.ts';
import { createEdgeValidator } from '../src/planner/edge.ts';
import { plan, resolveLattices } from '../src/planner/plan.ts';
import { buildLattice, snap } from '../src/planner/lattice.ts';
import { defaultStart } from '../src/planner/astar.ts';
import { searchBidirectional } from '../src/planner/bidirectional.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';
import { SCENARIOS } from '../src/fixtures/scenarios.ts';

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

/**
 * The line the fast passes must not cross — and it is two lines, not one.
 *
 * A 220 x 95 x 85 sofa has two relevant figures. Its smallest face is 85 cm
 * across; its smallest face *reachable with roll fixed at zero* is 95 cm,
 * because at yaw 90 the 95 cm depth lies across the doorway and pitch turns
 * about that very axis, so tilting cannot shrink it.
 *
 * Those two figures produce two different kinds of negative, and merging them
 * would be a mistake: one is geometry and the other is a modelling choice.
 */
describe('a faster yes must not become a wrong yes', () => {
  it('still fits through 96 cm, where there is one centimetre to spare', () => {
    const result = plan(SOFA_3_SEAT, buildEnvironment(door(96)), {
      diagnostics: false,
      maxNodes: 1_200_000,
    });
    expect(result.feasible).toBe(true);
  });

  /**
   * Below 85 cm nothing helps. The sofa's smallest face is 95 x 85, so no
   * rotation about any axis — including ones this engine does not search —
   * presents anything narrower than 85 cm. This negative is permanent, and a
   * path through it would mean the item was being let through a wall.
   */
  it('never reports a path through 80 cm, which no rotation whatsoever admits', () => {
    const result = plan(SOFA_3_SEAT, buildEnvironment(door(80)), {
      diagnostics: false,
      maxNodes: 60_000,
    });
    expect(result.feasible).toBe(false);
  });

  /**
   * SEARCH-LIMITED NEGATIVES. NOT MODEL-LIMITED, AND NOT TRUE.
   *
   * These three were labelled model-limited when the engine searched one tilt
   * family and could not express the sideways pose at all. That label is now
   * wrong: both families are searched by default, the pose is representable,
   * and a straight sideways run through each of these doorways has been
   * constructed and put through the same `EdgeValidator` the planner uses —
   * see "the sideways run really does clear" in tiltFamily.test.ts.
   *
   * So a path exists and the engine does not find it. What comes back is
   * `search-budget-exhausted`, which is the honest thing to return and is not
   * the same claim as "no path found": the budget ran out, nothing was proved.
   * The barrier is measured and written up in the README — the sideways pose
   * needs its origin inside a 25 to 30 cm window that no coarse rung's grid
   * contains, so only the 2 cm reference rung represents it, and that rung's
   * full search runs to billions of nodes.
   *
   * These assertions are a record of a known gap, not a specification. When the
   * search gets there they must flip to feasible, and the flip is the fix
   * landing. The one that must never flip is 80 cm above.
   */
  for (const width of [86, 90, 94]) {
    it(`does not find the sideways route through ${width} cm, though one exists`, () => {
      const result = plan(SOFA_3_SEAT, buildEnvironment(door(width)), {
        diagnostics: false,
        maxNodes: 60_000,
      });
      expect(result.feasible).toBe(false);
      // And when it fails it must fail honestly: budget, not proof.
      if (!result.feasible) expect(result.reason).not.toBe('proven-too-large');
    });
  }
});

describe('the fast passes return real paths', () => {
  // The feasible scenarios only: there is no path to revalidate in the others,
  // and re-planning them here would double the suite's running time to assert
  // nothing.
  for (const scenario of SCENARIOS.filter((s) => s.id === 'trivial-fit' || s.id === 'tilt-required')) {
    it(`every edge of the ${scenario.id} path revalidates`, () => {
      const environment = buildEnvironment(scenario.params);
      const result = plan(scenario.item, environment, { diagnostics: false });
      if (!result.feasible) return;

      const item = prepareItem(scenario.item);
      const validator = createEdgeValidator(item, environment);
      for (const placement of result.path) {
        expect(collides(item, placement, environment)).toBe(false);
      }
      for (let i = 0; i + 1 < result.path.length; i++) {
        expect(validator.isValid(result.path[i]!, result.path[i + 1]!)).toBe(true);
      }
    });
  }
});

describe('determinism survives the fast passes', () => {
  /** Everything but the stopwatch, which is the one field allowed to differ. */
  const withoutTiming = (result: unknown): string =>
    JSON.stringify(result, (key, value) => (key === 'millis' ? 0 : value));

  it('gives the same path twice for a scene a fast pass settles', () => {
    const environment = buildEnvironment(door(110));
    const once = plan(SOFA_3_SEAT, environment, { diagnostics: false });
    const twice = plan(SOFA_3_SEAT, environment, { diagnostics: false });
    expect(withoutTiming(once)).toBe(withoutTiming(twice));
  });

  it('gives the same answer twice for a scene none of them settles', () => {
    const environment = buildEnvironment(door(90));
    const options = { diagnostics: false, maxNodes: 60_000 } as const;
    const once = plan(SOFA_3_SEAT, environment, options);
    const twice = plan(SOFA_3_SEAT, environment, options);
    expect(withoutTiming(once)).toBe(withoutTiming(twice));
  });
});

describe('searchBidirectional', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'trivial-fit')!;
  const environment = buildEnvironment(scenario.params);
  const item = prepareItem(scenario.item);
  const levels = resolveLattices({});
  const lattice = buildLattice(item, environment, levels[0]!);

  const run = (maxNodes: number) => {
    const start = defaultStart(item, environment, lattice)!;
    return searchBidirectional({
      item,
      environment,
      lattice,
      validator: createEdgeValidator(item, environment),
      start,
      maxNodes,
      counter: { collisionChecks: 0 },
      usePivots: true,
    });
  };

  it('meets in the middle and returns a path that revalidates end to end', () => {
    const outcome = run(60_000);
    expect(outcome.path).toBeDefined();
    if (outcome.path === undefined) return;

    const validator = createEdgeValidator(item, environment);
    for (let i = 0; i + 1 < outcome.path.length; i++) {
      expect(validator.isValid(outcome.path[i]!, outcome.path[i + 1]!)).toBe(true);
    }
  });

  it('starts where it was asked to and ends inside the room', () => {
    const outcome = run(60_000);
    if (outcome.path === undefined) return;
    const start = snap(lattice, outcome.path[0]!);
    expect(start).toEqual(defaultStart(item, environment, lattice));
    const last = outcome.path[outcome.path.length - 1]!;
    expect(last.y).toBeGreaterThan(scenario.params.wallThickness);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run(60_000))).toBe(JSON.stringify(run(60_000)));
  });

  it('reports nothing rather than guessing when its budget is tiny', () => {
    const outcome = run(4);
    expect(outcome.path).toBeUndefined();
    // A failure here says nothing about the scene, so it must not look like a
    // proof of absence.
    expect(outcome.exhausted).toBe(false);
  });
});
