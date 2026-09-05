/**
 * The planner, off the main thread.
 *
 * A plan takes anywhere from 20 ms to about three seconds. Run synchronously on
 * the main thread, the three-second case freezes the page solid — no spinner,
 * no scroll, nothing — which is the difference between a demo and a hang.
 *
 * The work is split into two posted phases rather than one, because the two
 * halves have very different costs and the first is the one people are waiting
 * for. `plan` with diagnostics off answers "does it fit" in a few hundred
 * milliseconds; working out what would FIX an infeasible scene means re-planning
 * counterfactuals and costs seconds. Posting the verdict first means the page
 * can show it while the diagnostics are still running.
 */
import {
  DEFAULT_DIAGNOSTICS_NODE_BUDGET,
  REFRIGERATOR,
  SOFA_3_SEAT,
  WARDROBE,
  buildEnvironment,
  diagnose,
  firstContactAlongPath,
  plan,
  resolveLattices,
} from '@fitpath/engine';
import type { Item, PlanOptions } from '@fitpath/engine';
import { DEMO_MAX_NODES } from './protocol.ts';
import type { ItemId, PlanRequest, WorkerMessage } from './protocol.ts';

const ITEMS: Record<ItemId, Item> = {
  'sofa-3-seat': SOFA_3_SEAT,
  wardrobe: WARDROBE,
  refrigerator: REFRIGERATOR,
};

/** `self` in a module worker. Typed through the DOM lib rather than pulling in the WebWorker lib. */
const ctx = self as unknown as Worker;

const post = (message: WorkerMessage): void => ctx.postMessage(message);

function run(request: PlanRequest): void {
  const item = ITEMS[request.itemId];
  const environment = buildEnvironment(request.params);
  const options: PlanOptions = {
    diagnostics: false,
    maxNodes: DEMO_MAX_NODES,
    ...(request.start !== undefined ? { start: request.start } : {}),
  };

  const startedAt = performance.now();
  const result = plan(item, environment, options);
  const verdictMillis = performance.now() - startedAt;

  post({
    kind: 'verdict',
    id: request.id,
    millis: verdictMillis,
    verdict: result.feasible
      ? { feasible: true, path: result.path, steps: result.steps, stats: result.stats }
      : {
          feasible: false,
          reason: result.reason,
          proven: result.proven,
          message: result.message,
          messageHe: result.messageHe,
          stats: result.stats,
        },
  });

  if (result.feasible) {
    if (request.replayIn !== undefined) {
      const at = performance.now();
      const contact = firstContactAlongPath(item, result.path, buildEnvironment(request.replayIn));
      post({
        kind: 'replay',
        id: request.id,
        contact: contact ?? null,
        millis: performance.now() - at,
      });
    }
  } else if (result.reason === 'search-budget-exhausted') {
    // Diagnostics answer "what would fix this scene". Asking that about a scene
    // the search never settled would dress an unknown up as a finding, so it is
    // skipped and the page says the search ran out instead.
    post({ kind: 'diagnostics', id: request.id, suggestions: [], truncated: true, millis: 0 });
  } else {
    const at = performance.now();
    const report = diagnose({
      item,
      environment,
      levels: resolveLattices(options),
      maxNodes: DEMO_MAX_NODES,
      pivotMoves: true,
      exhaustive: false,
      allSuggestions: false,
      nodeBudget: DEFAULT_DIAGNOSTICS_NODE_BUDGET,
      ...(request.start !== undefined ? { start: request.start } : {}),
    });
    post({
      kind: 'diagnostics',
      id: request.id,
      suggestions: report.suggestions,
      truncated: report.truncated,
      millis: performance.now() - at,
    });
  }

  post({ kind: 'done', id: request.id, millis: performance.now() - startedAt });
}

ctx.onmessage = (event: MessageEvent<PlanRequest>): void => {
  try {
    run(event.data);
  } catch (error) {
    post({
      kind: 'failed',
      id: event.data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
