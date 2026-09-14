/**
 * Build the widget's data: one small file per product, and one file of paths.
 *
 * Everything expensive happens here, once. Each template is instantiated for
 * each sofa, validated placement by placement and edge by edge against the
 * collider, and measured for what it demands of a doorway — and the same again
 * for each module the sofa ships as, and for the body with each removable part
 * taken off. What a browser fetches when the modal opens is a table of numbers;
 * the motions come down separately, and only when there is one to draw.
 *
 * Run by `npm run precompute`, which `npm run build` runs first. The output is
 * committed so a checkout serves without a build step.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WALL_THICKNESS,
  MODULES,
  SOFAS,
  buildEnvironment,
  buildLibrary,
  interpolate,
  itemWorldBoxes,
  prepareItem,
  reportOn,
  unionAabb,
  verifyPathIn,
} from '@fitpath/engine';
import type { Item, ItemReport, Maneuver, Placement } from '@fitpath/engine';
import { illustrate } from '@fitpath/illustrate';
import { DATA_VERSION } from '../src/types.ts';
import type { Carry, Separates, WidgetIndex, WidgetManeuver, WidgetPaths, WidgetProduct } from '../src/types.ts';

/**
 * The wall every maneuver is validated behind. The engine's default, 30 cm,
 * unless the store says otherwise: `FITPATH_WALL_CM=40 npm run precompute`.
 * Thicker walls are strictly harder, so a store with masonry walls builds a
 * thicker library rather than trusting a thinner one; whichever it picks,
 * every maneuver records how thick a wall its numbers hold for, and the
 * modal tells the shopper.
 */
const WALL = Number(process.env['FITPATH_WALL_CM'] ?? DEFAULT_WALL_THICKNESS);
if (!Number.isFinite(WALL) || WALL <= 0) throw new Error(`FITPATH_WALL_CM must be a positive number, got ${process.env['FITPATH_WALL_CM']}`);

/**
 * Whether each product is known to come apart into modules.
 *
 * A fact about the product that the engine has no way of knowing and a shop
 * always does: it is the `separates` field of the sourcing pipeline's input,
 * and in a real onboarding it arrives with the listing. Here it is declared
 * beside the catalogue. `'unknown'` is the honest state for a listing that does
 * not say, and the widget renders it as a question for the retailer rather
 * than as either answer — because printing the easier number beside a sofa that
 * turns out to be welded is the one direction this system must never fail in.
 */
const SEPARATES: Record<string, Separates> = {
  // One body. The legs unscrew, which is a removable part rather than a module.
  'sofa-3-seat': false,
  // The listing says nothing either way.
  'slim-arm-2-seat': 'unknown',
  // Two modules that bolt together, and both are modelled.
  'corner-sofa': true,
  // Nothing on it comes off, per the listing.
  'deep-seat-lounge': false,
  // The mechanism is bolted to the frame; the listing does not say whether the
  // frame itself splits.
  'recliner-2-seat': 'unknown',
  // A folding frame fills the body. One piece.
  'sofa-bed': false,
};

/** The highest any part of the item reaches during the motion, sampled finely. */
function headroomOf(item: Item, path: readonly Placement[]): number {
  let top = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    for (let s = 0; s <= 8; s++) {
      const placement = interpolate(path[i]!, path[i + 1]!, s / 8);
      const z = unionAabb(itemWorldBoxes(item, placement)).maxZ;
      if (z > top) top = z;
    }
  }
  if (path.length === 1) top = unionAabb(itemWorldBoxes(item, path[0]!)).maxZ;
  return Math.ceil(top);
}

function widgetManeuver(item: Item, maneuver: Maneuver, report: ItemReport): WidgetManeuver {
  const line = report.maneuvers.find((l) => l.templateId === maneuver.templateId);
  return {
    templateId: maneuver.templateId,
    name: maneuver.name,
    nameHe: maneuver.nameHe,
    stages: maneuver.stages.map((stage) => ({ name: stage.name, nameHe: stage.nameHe })),
    requirement: maneuver.requirement,
    headroomCm: headroomOf(item, maneuver.path),
    turns: line?.turns === true,
    wallThickness: maneuver.wallThickness,
    holdsForWallsUpTo: maneuver.holdsForWallsUpTo,
  };
}

function carryOf(item: Item, paths: WidgetPaths): Carry {
  const started = performance.now();
  const report = reportOn(item, WALL);
  const { maneuvers } = buildLibrary(prepareItem(item), WALL);

  // Nothing ships that the collider has not cleared in the scene it asks for.
  // `buildManeuver` already did this; doing it again on the exact objects that
  // will be serialised is what catches a slip between the two.
  const prepared = prepareItem(item);
  for (const maneuver of maneuvers) {
    const r = maneuver.requirement;
    const clear = Math.max(60, r.alongWall);
    const environment = buildEnvironment({
      openingWidth: r.doorWidth,
      openingHeight: r.doorHeight,
      wallThickness: WALL,
      hallwayWidth: Math.max(1, r.hallwayClearance),
      hallwayDepth: clear,
      roomDepth: Math.max(1, r.roomDepth),
      roomWidth: clear,
      ceilingHeight: headroomOf(item, maneuver.path) + 20,
    });
    const fault = verifyPathIn(prepared, maneuver.path, environment);
    if (fault !== undefined) {
      throw new Error(`${item.id} / ${maneuver.templateId}: ${fault.kind} ${fault.index} is not clear in its own requirement`);
    }
  }

  paths[item.id] = Object.fromEntries(maneuvers.map((m) => [m.templateId, m.path]));

  const bounds = report.dimensions;
  const binding = report.binding?.part;
  console.log(
    `  ${item.name.padEnd(36)} ${(report.narrowest ?? NaN).toFixed(2).padStart(7)} cm ` +
      `floor ${(report.floor ?? NaN).toFixed(2)}  (${(performance.now() - started).toFixed(0)} ms)`,
  );

  return {
    id: item.id,
    name: item.name,
    nameHe: item.nameHe,
    dimensions: { length: bounds.length, depth: bounds.depth, height: bounds.height },
    item,
    maneuvers: maneuvers.map((m) => widgetManeuver(item, m, report)),
    ...(report.narrowest !== undefined ? { narrowestCm: report.narrowest } : {}),
    ...(report.floor !== undefined ? { floorCm: report.floor } : {}),
    ...(binding !== undefined
      ? { bindingPart: { label: binding.label, labelHe: binding.labelHe, floorWithoutCm: binding.floorWithout } }
      : {}),
    wallStatement: report.wallStatement,
    wallStatementHe: report.wallStatementHe,
  };
}

/** The item with one removable part taken off, as an item in its own right. */
function without(item: Item, part: { name: string; nameHe: string; boxIndices: readonly number[] }): Item {
  const drop = new Set(part.boxIndices);
  return {
    id: `${item.id}-without-${part.name}`,
    name: `${item.name} without the ${part.name}`,
    nameHe: `${item.nameHe} ללא ${part.nameHe}`,
    boxes: item.boxes.filter((_, index) => !drop.has(index)),
    removableParts: [],
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/data');
mkdirSync(out, { recursive: true });

const index: WidgetIndex = { dataVersion: DATA_VERSION, products: [] };

console.log('building the widget library…');
for (const item of SOFAS) {
  const paths: WidgetPaths = {};
  const separates = SEPARATES[item.id];
  if (separates === undefined) throw new Error(`${item.id}: separability not declared`);

  const assembled = carryOf(item, paths);
  const modules = separates === true ? (MODULES[item.id] ?? []).map((piece) => carryOf(piece, paths)) : undefined;
  if (separates === true && (modules === undefined || modules.length === 0)) {
    throw new Error(`${item.id} is declared separable but has no modules modelled`);
  }
  const withoutPart = (item.removableParts ?? []).map((part) => ({
    part: part.name,
    partHe: part.nameHe,
    carry: carryOf(without(item, part), paths),
  }));

  const product: WidgetProduct = {
    dataVersion: DATA_VERSION,
    id: item.id,
    name: item.name,
    nameHe: item.nameHe,
    illustration: illustrate(item, { label: `${item.name}, drawn from its box model` }),
    wallThicknessCm: WALL,
    assembled,
    separates,
    ...(modules !== undefined ? { modules } : {}),
    withoutPart,
  };

  writeFileSync(resolve(out, `${item.id}.json`), JSON.stringify(product));
  writeFileSync(resolve(out, `${item.id}.paths.json`), JSON.stringify(paths));
  index.products.push({ id: item.id, name: item.name, nameHe: item.nameHe });
}
writeFileSync(resolve(out, 'index.json'), JSON.stringify(index, null, 2));
console.log(`wrote ${index.products.length} products to ${out}`);
