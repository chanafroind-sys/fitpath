import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildEnvironment } from '../src/environment/build.ts';
import { plan } from '../src/planner/plan.ts';
import { TRIVIAL_FIT } from '../src/fixtures/scenarios.ts';

describe('determinism', () => {
  it('produces a byte-identical path on twenty consecutive runs', () => {
    const environment = buildEnvironment(TRIVIAL_FIT.params);
    const started = performance.now();

    const first = plan(TRIVIAL_FIT.item, environment, { diagnostics: false });
    expect(first.feasible).toBe(true);
    if (!first.feasible) return;

    const reference = JSON.stringify({ path: first.path, steps: first.steps });

    for (let run = 1; run < 20; run++) {
      const result = plan(TRIVIAL_FIT.item, environment, { diagnostics: false });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(JSON.stringify({ path: result.path, steps: result.steps })).toBe(reference);
    }

    console.log(
      `[determinism] 20 runs in ${(performance.now() - started).toFixed(0)} ms, all identical`,
    );
  });

  it('does not depend on the Environment object being reused', () => {
    // A rebuilt environment is a different object with the same numbers; the
    // answer must not vary with identity, or the collision cache keyed on the
    // Environment would be changing results rather than just timings.
    const a = plan(TRIVIAL_FIT.item, buildEnvironment(TRIVIAL_FIT.params), {
      diagnostics: false,
    });
    const b = plan(TRIVIAL_FIT.item, buildEnvironment(TRIVIAL_FIT.params), {
      diagnostics: false,
    });
    // Everything except the wall-clock time, which is measured, not computed.
    const comparable = (r: typeof a): string =>
      JSON.stringify(r, (key, value) => (key === 'millis' ? 0 : value));
    expect(comparable(a)).toBe(comparable(b));
    expect(a.stats.nodesGenerated).toBe(b.stats.nodesGenerated);
    expect(a.stats.collisionChecks).toBe(b.stats.collisionChecks);
  });

  it('contains no randomness anywhere in the engine source', () => {
    // The invariant is written down in CLAUDE.md; this is the part that checks
    // nobody quietly reached for a random tie-break.
    const root = join(import.meta.dirname, '..', 'src');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const source = readFileSync(full, 'utf8');
        if (/Math\s*\.\s*random/.test(source)) offenders.push(full);
        if (/\bcrypto\s*\.\s*getRandomValues/.test(source)) offenders.push(full);
      }
    };

    walk(root);
    expect(offenders).toEqual([]);
  });
});
