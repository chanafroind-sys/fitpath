import { describe, expect, it } from 'vitest';
import type { PlanResult, Suggestion } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { plan } from '../src/planner/plan.ts';
import {
  IMPOSSIBLE,
  LEGS_MUST_COME_OFF,
  NARROW_HALLWAY,
  TILT_REQUIRED,
  TRIVIAL_FIT,
  type Scenario,
} from '../src/fixtures/scenarios.ts';

/** Runtimes are part of what this project reports, so every case prints its own. */
function run(scenario: Scenario, options: Parameters<typeof plan>[2] = {}): PlanResult {
  const environment = buildEnvironment(scenario.params);
  const started = performance.now();
  const result = plan(scenario.item, environment, options);
  const elapsed = performance.now() - started;
  const outcome = result.feasible ? 'feasible' : `infeasible (${result.reason})`;
  console.log(
    `[${scenario.id}] ${outcome} in ${elapsed.toFixed(0)} ms ` +
      `(${result.stats.nodesGenerated.toLocaleString('en-US')} nodes, ` +
      `${result.stats.collisionChecks.toLocaleString('en-US')} collision checks)`,
  );
  return result;
}

function suggestion(result: PlanResult, kind: Suggestion['kind']): Suggestion {
  if (result.feasible) throw new Error('expected an infeasible result');
  const found = result.suggestions.find((s) => s.kind === kind);
  if (!found) throw new Error(`no ${kind} suggestion; got ${result.suggestions.map((s) => s.kind).join(', ')}`);
  return found;
}

describe('1. trivially fits', () => {
  it('finds a path through a wide opening from a wide hallway', () => {
    const result = run(TRIVIAL_FIT, { diagnostics: false });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.path.length).toBeGreaterThan(1);
    expect(result.steps.length).toBeGreaterThan(0);
    // Every step carries instructions in both languages.
    for (const step of result.steps) {
      expect(step.en.length).toBeGreaterThan(0);
      expect(step.he.length).toBeGreaterThan(0);
      expect(step.he).toMatch(/[֐-׿]/);
    }
    // The path must actually end up in the room.
    const last = result.path[result.path.length - 1]!;
    expect(last.y).toBeGreaterThan(TRIVIAL_FIT.params.wallThickness);
  });
});

describe('2. fits only when tilted', () => {
  it('tilts the wardrobe rather than reporting that it cannot pass', () => {
    const result = run(TILT_REQUIRED, { diagnostics: false });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    // The wardrobe is 220 cm and the opening 200 cm: upright is not an option,
    // so a non-zero pitch has to appear somewhere along the path.
    const maxPitch = Math.max(...result.path.map((p) => Math.abs(p.pitch)));
    expect(maxPitch).toBeGreaterThan(0.1);
    expect(result.steps.some((s) => s.kind === 'pitch')).toBe(true);
  });
});

describe('3. cannot fit in any orientation', () => {
  it('proves it in closed form, without searching', () => {
    const result = run(IMPOSSIBLE);
    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.reason).toBe('proven-too-large');
    expect(result.proven).toBe(true);
    // No search ran at all: the proof needs none.
    expect(result.stats.nodesGenerated).toBe(0);
    // The refrigerator's smallest cross-section is 70 x 75.
    expect(result.message).toContain('70 x 75');
    // And even proven cases never claim more than they should.
    expect(result.message).not.toContain('does not fit');
  });

  it('still reports how much wider the opening would have to be', () => {
    const result = run(IMPOSSIBLE);
    const widen = suggestion(result, 'widen-opening');
    expect(widen.helps).toBe(true);
    // 70 cm is the item's narrowest cross-section dimension, so nothing below
    // that can work; the opening starts at 50.
    expect(widen.openingWidth).toBe(70);
  });
});

describe('4. fits through the opening but the hallway is too narrow to turn in', () => {
  // The most important case in the project: the opening is innocent and the
  // diagnostics have to say so.
  const result = run(NARROW_HALLWAY);

  it('reports no path found, and does not overclaim', () => {
    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.reason).toBe('no-path-found');
    // The search exhausted a lattice, which is not a proof about continuous
    // space, and the result must not pretend otherwise.
    expect(result.proven).toBe(false);
    expect(result.message).toContain('no path');
    expect(result.message).not.toContain('does not fit');
  });

  it('identifies the HALLWAY as the binding constraint, not the opening', () => {
    const hallway = suggestion(result, 'widen-hallway');
    const opening = suggestion(result, 'widen-opening');

    expect(opening.helps).toBe(false);
    expect(hallway.helps).toBe(true);
    expect(hallway.en).toContain('hallway is the binding constraint');
    expect(hallway.he).toMatch(/[֐-׿]/);
  });

  it('gives a concrete hallway width that works', () => {
    const hallway = suggestion(result, 'widen-hallway');
    expect(hallway.hallwayWidth).toBeGreaterThan(NARROW_HALLWAY.params.hallwayWidth);
    expect(hallway.extraHallwayWidth).toBeGreaterThan(0);
    expect(Number.isInteger(hallway.extraHallwayWidth)).toBe(true);
  });

  it('confirms the reported hallway width actually works', () => {
    // The number has to be usable advice: widen to this and the item goes in.
    const hallway = suggestion(result, 'widen-hallway');
    const width = hallway.hallwayWidth!;
    const works = plan(
      NARROW_HALLWAY.item,
      buildEnvironment({ ...NARROW_HALLWAY.params, hallwayWidth: width }),
      { diagnostics: false },
    );
    expect(works.feasible).toBe(true);

    // Under the default budget the threshold is bracketed on the coarse rungs,
    // which is one-sided: the number can be too generous, never too small. It
    // must say so rather than implying an exactness it does not have.
    if (hallway.basis === 'coarse-lattice') {
      expect(hallway.en).toContain('coarse lattice');
      expect(width).toBeGreaterThanOrEqual(177);
    } else {
      // Refined at full resolution: then one centimetre less must genuinely fail.
      const justUnder = plan(
        NARROW_HALLWAY.item,
        buildEnvironment({ ...NARROW_HALLWAY.params, hallwayWidth: width - 1 }),
        { diagnostics: false },
      );
      expect(justUnder.feasible).toBe(false);
    }
  });

  it('keeps diagnostics inside the wall-clock budget', () => {
    const environment = buildEnvironment(NARROW_HALLWAY.params);
    const started = performance.now();
    plan(NARROW_HALLWAY.item, environment);
    const withDiagnostics = performance.now() - started;

    const bare = performance.now();
    plan(NARROW_HALLWAY.item, environment, { diagnostics: false });
    const withoutDiagnostics = performance.now() - bare;

    const diagnosticsOnly = withDiagnostics - withoutDiagnostics;
    console.log(`[narrow-hallway/diagnostics] ${diagnosticsOnly.toFixed(0)} ms`);
    // Generous against a loaded CI box; the measured figure is about 2.3 s.
    expect(diagnosticsOnly).toBeLessThan(8000);
  });
});

describe('5. fits only after removing the legs', () => {
  const result = run(LEGS_MUST_COME_OFF);

  it('reports no path found with the legs on', () => {
    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.reason).toBe('no-path-found');
  });

  it('says removing the legs is what fixes it', () => {
    const legs = suggestion(result, 'remove-part');
    expect(legs.helps).toBe(true);
    expect(legs.part).toBe('legs');
    expect(legs.he).toMatch(/[֐-׿]/);
  });

  it('does not blame the opening width or the hallway', () => {
    // The opening is 120 cm wide and the sofa's cross-section is 95 cm: width
    // was never the problem, height was, and the diagnostics must not offer a
    // wider door as a fix.
    expect(suggestion(result, 'widen-opening').helps).toBe(false);
    expect(suggestion(result, 'widen-hallway').helps).toBe(false);
  });

  it('stops once it has an actionable answer, and says that it did', () => {
    // Taking the legs off is the first family tried and it works, so the two
    // more expensive remedies are not proved impossible at full resolution —
    // which would cost minutes to establish and change nobody's decision.
    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.truncated).toBe(true);
    const legs = suggestion(result, 'remove-part');
    expect(legs.helps).toBe(true);
    expect(legs.basis).toBe('full-resolution');
  });

  it('confirms the legless sofa really does get through', () => {
    const environment = buildEnvironment(LEGS_MUST_COME_OFF.params);
    const legless = {
      ...LEGS_MUST_COME_OFF.item,
      boxes: LEGS_MUST_COME_OFF.item.boxes.filter((_, i) => i < 4),
      removableParts: [],
    };
    const started = performance.now();
    const withoutLegs = plan(legless, environment, { diagnostics: false });
    console.log(`[legs-must-come-off/legless] ${withoutLegs.feasible ? 'feasible' : 'infeasible'} in ${(performance.now() - started).toFixed(0)} ms`);
    expect(withoutLegs.feasible).toBe(true);
  });
});
