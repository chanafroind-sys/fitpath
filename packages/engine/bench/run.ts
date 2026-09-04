/**
 * Print the planner's runtime for every named scenario.
 *
 * Run with `npm --workspace @fitpath/engine run bench`. No build step: Node
 * strips the types itself.
 */
import { buildEnvironment } from '../src/environment/build.ts';
import { SCENARIOS } from '../src/fixtures/scenarios.ts';
import { plan } from '../src/planner/plan.ts';

interface Row {
  scenario: string;
  result: string;
  millis: number;
  nodes: number;
  collisions: number;
  steps: string;
}

const rows: Row[] = [];

for (const scenario of SCENARIOS) {
  const environment = buildEnvironment(scenario.params);
  const started = performance.now();
  const result = plan(scenario.item, environment);
  const elapsed = performance.now() - started;

  rows.push({
    scenario: scenario.id,
    result: result.feasible ? 'feasible' : `infeasible (${result.reason})`,
    millis: elapsed,
    nodes: result.stats.nodesGenerated,
    collisions: result.stats.collisionChecks,
    steps: result.feasible ? String(result.steps.length) : '-',
  });

  console.log(`\n=== ${scenario.name} [${scenario.id}] ===`);
  console.log(`expected: ${scenario.expectation}`);
  console.log(`elapsed:  ${elapsed.toFixed(0)} ms`);
  if (result.feasible) {
    console.log(`path:     ${result.path.length} states, ${result.steps.length} steps`);
    console.log(`coarse:   ${result.stats.solvedOnCoarsePass ? 'solved on the coarse pass' : 'needed the fine lattice'}`);
    for (const step of result.steps) {
      console.log(`  ${step.index + 1}. ${step.en}`);
      console.log(`     ${step.he}`);
    }
  } else {
    console.log(`reason:   ${result.reason} (proven: ${result.proven})`);
    console.log(`message:  ${result.message}`);
    for (const suggestion of result.suggestions) {
      console.log(`  - [${suggestion.kind}] ${suggestion.helps ? 'HELPS' : 'no'}: ${suggestion.en}`);
    }
  }
}

console.log('\n\n=== runtime summary ===');
const width = (values: string[]): number => Math.max(...values.map((v) => v.length));
const headers = ['scenario', 'result', 'ms', 'nodes', 'collisions', 'steps'];
const table = rows.map((r) => [
  r.scenario,
  r.result,
  r.millis.toFixed(0),
  r.nodes.toLocaleString('en-US'),
  r.collisions.toLocaleString('en-US'),
  r.steps,
]);
const widths = headers.map((h, i) => Math.max(h.length, width(table.map((row) => row[i]!))));
const line = (cells: string[]): string =>
  cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
console.log(line(headers));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const row of table) console.log(line(row));
