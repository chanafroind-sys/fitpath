import type { Placement } from '../types.ts';
import type { EdgeValidator } from './edge.ts';

/**
 * How far ahead a shortcut may reach in one attempt.
 *
 * Unbounded lookahead makes smoothing quadratic in the path length with a
 * densely sampled collision test at every trial, which on a long lattice path
 * costs more than the search that produced it. Capping the reach and running
 * several passes gets the same compression — a run that survives one pass is
 * re-examined by the next, so long straight sections still collapse — at a cost
 * that stays linear in practice.
 */
const LOOKAHEAD = 48;

/** Give up after this many passes even if the last one still helped. */
const MAX_PASSES = 6;

/**
 * Replace runs of lattice steps with direct connections wherever the direct
 * connection is itself collision-free.
 *
 * The raw A* path is a staircase: it can only move along one axis at a time, so
 * a diagonal slide comes out as dozens of alternating steps and a turn-while-
 * advancing comes out as a comb. Smoothing turns that back into the handful of
 * motions a person would actually make, which is the difference between
 * instructions someone can follow and a transcript of a search.
 *
 * Deterministic by construction: each pass walks the path forward and, from
 * each surviving node, takes the furthest valid connection within the lookahead
 * — furthest first, so no tie-breaking is ever needed.
 */
export function shortcutSmooth(path: Placement[], validator: EdgeValidator): Placement[] {
  if (path.length <= 2) return path.slice();

  let current = path.slice();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next: Placement[] = [current[0]!];
    let i = 0;
    while (i < current.length - 1) {
      const limit = Math.min(current.length - 1, i + LOOKAHEAD);
      let chosen = i + 1;
      for (let j = limit; j > i + 1; j--) {
        if (validator.isValid(current[i]!, current[j]!)) {
          chosen = j;
          break;
        }
      }
      next.push(current[chosen]!);
      i = chosen;
    }
    if (next.length === current.length) return next;
    current = next;
  }
  return current;
}
