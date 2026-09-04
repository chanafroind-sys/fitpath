import { describe, expect, it } from 'vitest';
import { buildEnvironment } from '../src/environment/build.ts';
import { plan } from '../src/planner/plan.ts';
import { NARROW_HALLWAY } from '../src/fixtures/scenarios.ts';

const environment = buildEnvironment(NARROW_HALLWAY.params);

function infeasible(options: Parameters<typeof plan>[2]) {
  const result = plan(NARROW_HALLWAY.item, environment, options);
  if (result.feasible) throw new Error('expected the narrow hallway to be infeasible');
  return result;
}

describe('diagnostics budget', () => {
  it('is spent in nodes, not milliseconds, so the result is machine-independent', () => {
    // This is the whole reason the budget is a node count. Two runs of the same
    // input must agree on every suggestion AND on the truncation flag; a
    // wall-clock budget would make both depend on how busy the machine was.
    const a = infeasible({ diagnosticsNodeBudget: 250_000 });
    const b = infeasible({ diagnosticsNodeBudget: 250_000 });
    expect(JSON.stringify(a.suggestions)).toBe(JSON.stringify(b.suggestions));
    expect(a.truncated).toBe(b.truncated);
  });

  it('reports truncation rather than pretending a starved run proved something', () => {
    const starved = infeasible({ diagnosticsNodeBudget: 1 });
    expect(starved.truncated).toBe(true);

    // A counterfactual that never ran must not be dressed up as a negative
    // result. `helps` false plus `evaluated` false is "we did not look", and
    // the text has to say so.
    const unevaluated = starved.suggestions.filter((s) => !s.evaluated);
    expect(unevaluated.length).toBeGreaterThan(0);
    for (const suggestion of unevaluated) {
      expect(suggestion.basis).toBe('not-evaluated');
      expect(suggestion.helps).toBe(false);
      expect(suggestion.en).toContain('Not evaluated');
      expect(suggestion.he).toMatch(/[֐-׿]/);
    }
  });

  it('still returns a suggestion for every family even when starved', () => {
    // Partial results, not missing ones: a caller should never have to guess
    // whether a family was checked and dismissed or simply skipped.
    const starved = infeasible({ diagnosticsNodeBudget: 1 });
    const kinds = starved.suggestions.map((s) => s.kind).sort();
    expect(kinds).toEqual(['remove-part', 'widen-hallway', 'widen-opening']);
  });

  it('never reports a threshold that does not actually work', () => {
    // The one property that matters for advice: whatever width comes back,
    // widening to it really does produce a path. A coarse bracket may be too
    // generous; it may never be too small.
    for (const diagnosticsNodeBudget of [400_000, 1_200_000]) {
      const result = infeasible({ diagnosticsNodeBudget });
      const hallway = result.suggestions.find((s) => s.kind === 'widen-hallway')!;
      if (!hallway.helps || hallway.hallwayWidth === undefined) continue;
      const check = plan(
        NARROW_HALLWAY.item,
        buildEnvironment({ ...NARROW_HALLWAY.params, hallwayWidth: hallway.hallwayWidth }),
        { diagnostics: false },
      );
      expect(check.feasible).toBe(true);
    }
  });

  it('marks a coarse-bracketed threshold as coarse, and a proof-backed one as exact', () => {
    const result = infeasible({});
    const hallway = result.suggestions.find((s) => s.kind === 'widen-hallway')!;
    // Bracketed on the coarse rungs under the default budget.
    expect(hallway.helps).toBe(true);
    expect(['coarse-lattice', 'full-resolution']).toContain(hallway.basis);

    // The negatives that were settled on the reference lattice say so.
    const opening = result.suggestions.find((s) => s.kind === 'widen-opening')!;
    expect(opening.helps).toBe(false);
    expect(opening.basis).toBe('full-resolution');
  });

  it('a larger budget can only sharpen the answer, never contradict it', () => {
    const small = infeasible({ diagnosticsNodeBudget: 400_000 });
    const large = infeasible({ diagnosticsNodeBudget: 2_000_000 });
    const width = (r: typeof small): number | undefined =>
      r.suggestions.find((s) => s.kind === 'widen-hallway')?.hallwayWidth;
    const a = width(small);
    const b = width(large);
    if (a !== undefined && b !== undefined) {
      // More budget can only find a smaller sufficient width, never a larger one.
      expect(b).toBeLessThanOrEqual(a);
    }
  });
});
