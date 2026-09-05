/**
 * The message contract between the page and the planner worker.
 *
 * Everything here is plain data, because it crosses a structured-clone
 * boundary. Note what is NOT sent: the Environment. It is rebuilt on each side
 * from the same EnvironmentParams by the engine's own `buildEnvironment`, so
 * the geometry the page draws and the geometry the planner searched come from
 * one function rather than from two copies that could drift.
 */
import type {
  EnvironmentParams,
  InfeasibleReason,
  PassageOutlook,
  PathContact,
  Placement,
  PlanStats,
  Step,
  Suggestion,
} from '@fitpath/engine';

export type ItemId = 'sofa-3-seat' | 'wardrobe' | 'refrigerator';

export interface PlanRequest {
  id: number;
  itemId: ItemId;
  params: EnvironmentParams;
  /**
   * Where the item starts. Left out, the engine picks its own — backed against
   * the far wall of the corridor, which is a different pose in a 100 cm
   * corridor than in a 240 cm one. The compare view pins it so that the two
   * sides really are the same maneuver.
   */
  start?: Placement;
  /** When a path is found, replay it in this second scene and report the first contact. */
  replayIn?: EnvironmentParams;
  /**
   * Search even when the cheap triage says the scene is hopeless.
   *
   * The triage is a measurement, not a verdict, so refusing outright would be
   * overstepping. This is how the page offers to spend the seconds anyway.
   */
  force?: boolean;
}

export type Verdict =
  | { feasible: true; path: Placement[]; steps: Step[]; stats: PlanStats }
  | {
      feasible: false;
      reason: InfeasibleReason;
      proven: boolean;
      message: string;
      messageHe: string;
      stats: PlanStats;
    }
  /**
   * The search was never started, because a measurement said it was very
   * unlikely to find anything. Not a verdict about the furniture: a statement
   * about how the time was spent.
   */
  | { feasible: false; reason: 'not-searched'; proven: false; outlook: PassageOutlook };

/** A verdict that came out of an actual search, and therefore carries stats. */
export type SearchedVerdict = Exclude<Verdict, { reason: 'not-searched' }>;

export const wasSearched = (verdict: Verdict): verdict is SearchedVerdict =>
  verdict.feasible || verdict.reason !== 'not-searched';

export type WorkerMessage =
  /** Phase one: the answer itself, posted as soon as the search returns. */
  | { kind: 'verdict'; id: number; verdict: Verdict; millis: number }
  /** Phase two, feasible: the same path run in the comparison scene. */
  | { kind: 'replay'; id: number; contact: PathContact | null; millis: number }
  /** Phase two, infeasible: what would change the answer. The expensive part. */
  | { kind: 'diagnostics'; id: number; suggestions: Suggestion[]; truncated: boolean; millis: number }
  | { kind: 'done'; id: number; millis: number }
  | { kind: 'failed'; id: number; message: string };

/**
 * The node cap the demo plans under.
 *
 * The engine's own default is 6,000,000, which on a large corridor means
 * twenty-odd seconds before it gives up — fine for a batch tool, fatal for a
 * page someone is looking at. 1,200,000 settles all five named scenarios with
 * room to spare (the dearest needs 825,087) and caps the pathological case at
 * about six seconds, after which the answer is `search-budget-exhausted`, which
 * the page reports as inconclusive rather than as a no.
 */
export const DEMO_MAX_NODES = 1_200_000;
