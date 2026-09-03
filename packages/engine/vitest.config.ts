import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Proving a scenario infeasible means exhausting the reachable lattice,
    // which is legitimately slower than a unit test. The planner reports its
    // own runtime; this timeout only exists so a slow machine does not turn a
    // correct-but-slow result into a spurious failure.
    testTimeout: 120_000,
  },
});
