/**
 * Published dimensions in, a validated maneuver library out.
 *
 * The two halves of this system were built separately and had never been joined.
 * `buildFurnitureModel` turns what a shop prints into a box model; `reportOn`
 * turns a box model into a validated maneuver library and the narrowest doorway
 * it needs. This is the join, plus the batch entry point an onboarding run
 * actually looks like.
 *
 * ## What it produces, and why twice
 *
 * For every item: the model, and the library for the **assembled body** — the
 * doorway the thing needs as one piece. Where every part of the body is known to
 * come apart, a second set of libraries, one per part, for the doorway each
 * module needs on its own.
 *
 * Both, because they answer different questions and a product page wants to
 * print both sentences: "as one piece it needs 96 cm; module by module, 62 cm".
 * The gap between those two numbers is the whole commercial value of knowing a
 * sofa unbolts, and it is invisible unless both are computed.
 *
 * A body whose parts are `'unknown'` gets only the assembled figure. Treating an
 * unknown as separable would print the easier number beside a sofa that will not
 * come apart, which is the one direction this system is built never to fail in.
 */

import type { Item } from '../types.ts';
import type { FurnitureInput, FurnitureModelResult, ImprovementRequest } from './types.ts';
import type { ItemReport } from '../maneuvers/report.ts';
import { reportOn } from '../maneuvers/report.ts';
import { buildFurnitureModel, FURNITURE_PIPELINE_VERSION } from './furnitureModel.ts';

/** The doorway an item needs, and what it needs it for. */
export interface DoorwayNeed {
  /** Narrowest doorway any validated maneuver clears, in centimetres. Absent when none does. */
  narrowestCm?: number;
  /** Narrowest any roll schedule could reach, valid maneuver or not: the geometric floor. */
  floorCm?: number;
  /** The maneuvers that validated, by template id, in library order. */
  maneuvers: readonly string[];
  /** The ones that did not, and the reason each was refused. */
  rejected: readonly { templateId: string; reason: string }[];
}

function needOf(report: ItemReport): DoorwayNeed {
  return {
    ...(report.narrowest === undefined ? {} : { narrowestCm: report.narrowest }),
    ...(report.floor === undefined ? {} : { floorCm: report.floor }),
    maneuvers: report.maneuvers.filter((line) => line.valid).map((line) => line.templateId),
    rejected: report.maneuvers
      .filter((line) => !line.valid)
      .map((line) => ({ templateId: line.templateId, reason: line.reason ?? 'unknown' })),
  };
}

/** One piece's own carry, when the body comes apart. */
export interface PartCarry {
  id: string;
  name: string;
  need: DoorwayNeed;
  report: ItemReport;
}

export interface OnboardedItem {
  id: string;
  name: string;
  pipelineVersion: string;
  model: FurnitureModelResult;
  /** The assembled body's report and requirement: what it needs as one piece. */
  assembled: { need: DoorwayNeed; report: ItemReport };
  /**
   * Per-part carries, present only when every part of the body separates.
   *
   * `undefined` is not "we did not bother"; it is "this body has to go through
   * whole", which is a different and usually worse answer.
   */
  perPart?: readonly PartCarry[];
  /** Pieces that ship alongside the body, like an ottoman, each with its own carry. */
  shipsAlongside: readonly PartCarry[];
  /**
   * The narrowest doorway that gets this item into the room by any route the
   * system knows: the assembled figure, or the worst module if it comes apart.
   */
  narrowestAnyRouteCm?: number;
  /** What could not be determined, and the single field that would most improve it. */
  unresolved: readonly string[];
  wouldMostImprove?: ImprovementRequest;
}

export interface OnboardOptions {
  /** Wall thickness the maneuvers are validated against, in centimetres. Default 15. */
  wallThicknessCm?: number;
}

/**
 * Run one listing all the way through: dimensions, model, maneuver library.
 */
export function onboardItem(input: FurnitureInput, options: OnboardOptions = {}): OnboardedItem {
  const wall = options.wallThicknessCm ?? 15;
  const model = buildFurnitureModel(input);

  const report = reportOn(model.item, wall);
  const assembled = { need: needOf(report), report };

  const separable = model.separable;
  const perPart = separable
    ? model.parts.map((part) => {
        const partReport = reportOn(namedItem(part.item, part.id, part.name), wall);
        return { id: part.id, name: part.name, need: needOf(partReport), report: partReport };
      })
    : undefined;

  const shipsAlongside = model.shipsAlongside.map((piece) => {
    const pieceReport = reportOn(piece.item, wall);
    return {
      id: piece.item.id,
      name: piece.item.name,
      need: needOf(pieceReport),
      report: pieceReport,
    };
  });

  // Module by module is only an answer if every module has one.
  const moduleWorst =
    perPart !== undefined && perPart.every((part) => part.need.narrowestCm !== undefined)
      ? Math.max(...perPart.map((part) => part.need.narrowestCm!))
      : undefined;
  const candidates = [assembled.need.narrowestCm, moduleWorst].filter(
    (value): value is number => value !== undefined,
  );

  return {
    id: model.item.id,
    name: model.item.name,
    pipelineVersion: FURNITURE_PIPELINE_VERSION,
    model,
    assembled,
    ...(perPart === undefined ? {} : { perPart }),
    shipsAlongside,
    ...(candidates.length === 0 ? {} : { narrowestAnyRouteCm: Math.min(...candidates) }),
    unresolved: unresolvedOf(model, assembled.need),
    ...(model.improvements[0] === undefined ? {} : { wouldMostImprove: model.improvements[0] }),
  };
}

function namedItem(item: Item, id: string, name: string): Item {
  return { ...item, id, name, nameHe: item.nameHe };
}

/** Everything about this item the pipeline could not settle, in plain words. */
function unresolvedOf(model: FurnitureModelResult, need: DoorwayNeed): string[] {
  const out: string[] = [];
  if (need.narrowestCm === undefined) {
    out.push('no maneuver in the library gets this through any doorway; it may need a different route');
  }
  if (model.confidence === 'bounding-box-only') {
    out.push('nothing published proves any material is missing, so the model is the bounding box');
  }
  for (const flag of model.flags) {
    if (flag.severity === 'note') continue;
    out.push(flag.en);
  }
  for (const improvement of model.improvements) {
    out.push(`unpublished: ${improvement.field}`);
  }
  return out;
}

export interface BatchResult {
  pipelineVersion: string;
  items: readonly OnboardedItem[];
  /** Ids that threw, with the message, so one bad listing cannot lose the run. */
  failed: readonly { id: string; message: string }[];
}

/**
 * Onboard a list.
 *
 * The shape a real run takes: N listings in, a model and a maneuver library out
 * for each, and a per-item note of what could not be determined. One listing
 * that throws is recorded and stepped over rather than taking the batch with
 * it — a catalogue import that dies on item 40 of 900 is not an import.
 */
export function onboardBatch(
  inputs: readonly FurnitureInput[],
  options: OnboardOptions = {},
): BatchResult {
  const items: OnboardedItem[] = [];
  const failed: { id: string; message: string }[] = [];

  for (const [index, input] of inputs.entries()) {
    try {
      items.push(onboardItem(input, options));
    } catch (error) {
      failed.push({
        id: input.id ?? `#${index}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { pipelineVersion: FURNITURE_PIPELINE_VERSION, items, failed };
}
