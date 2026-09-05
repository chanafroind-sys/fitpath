/**
 * A small pool of planner workers, and a promise-shaped view of one plan.
 *
 * Two workers, because the compare view asks two questions at once and the
 * expensive one (proving no path exists in a narrow corridor) takes about ten
 * times as long as the cheap one. Running them side by side means the page is
 * ready when the slow answer lands rather than after both have queued.
 */
import type { PathContact, Suggestion } from '@fitpath/engine';
import type { PlanRequest, Verdict, WorkerMessage } from './protocol.ts';

export interface PlanHandlers {
  onVerdict?(verdict: Verdict, millis: number): void;
  onReplay?(contact: PathContact | null, millis: number): void;
  onDiagnostics?(suggestions: Suggestion[], truncated: boolean, millis: number): void;
  onDone?(millis: number): void;
  onFailed?(message: string): void;
}

interface Job {
  request: PlanRequest;
  handlers: PlanHandlers;
}

const POOL_SIZE = 2;

let nextId = 1;

interface Slot {
  worker: Worker;
  busy: Job | undefined;
}

const slots: Slot[] = [];
const queue: Job[] = [];
/** Requests whose caller has moved on. Their messages are read and discarded. */
const abandoned = new Set<number>();

function spawn(): Slot {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const slot: Slot = { worker, busy: undefined };

  worker.onmessage = (event: MessageEvent<WorkerMessage>): void => {
    const message = event.data;
    const job = slot.busy;
    const live = job !== undefined && job.request.id === message.id && !abandoned.has(message.id);

    if (live) {
      const { handlers } = job;
      switch (message.kind) {
        case 'verdict':
          handlers.onVerdict?.(message.verdict, message.millis);
          break;
        case 'replay':
          handlers.onReplay?.(message.contact, message.millis);
          break;
        case 'diagnostics':
          handlers.onDiagnostics?.(message.suggestions, message.truncated, message.millis);
          break;
        case 'done':
          handlers.onDone?.(message.millis);
          break;
        case 'failed':
          handlers.onFailed?.(message.message);
          break;
      }
    }

    if (message.kind === 'done' || message.kind === 'failed') {
      abandoned.delete(message.id);
      slot.busy = undefined;
      pump();
    }
  };

  worker.onerror = (event: ErrorEvent): void => {
    const job = slot.busy;
    if (job !== undefined && !abandoned.has(job.request.id)) {
      job.handlers.onFailed?.(event.message || 'The planner worker stopped unexpectedly.');
    }
    slot.busy = undefined;
    pump();
  };

  slots.push(slot);
  return slot;
}

function pump(): void {
  while (queue.length > 0) {
    const free = slots.find((s) => s.busy === undefined) ?? (slots.length < POOL_SIZE ? spawn() : undefined);
    if (free === undefined) return;
    const job = queue.shift()!;
    free.busy = job;
    free.worker.postMessage(job.request);
  }
}

/** A running plan. Cancelling only stops the page listening; the worker finishes its turn. */
export interface RunningPlan {
  id: number;
  cancel(): void;
}

export function runPlan(request: Omit<PlanRequest, 'id'>, handlers: PlanHandlers): RunningPlan {
  const id = nextId++;
  queue.push({ request: { ...request, id }, handlers });
  pump();
  return {
    id,
    cancel(): void {
      const queued = queue.findIndex((job) => job.request.id === id);
      if (queued >= 0) {
        queue.splice(queued, 1);
        return;
      }
      abandoned.add(id);
    },
  };
}
