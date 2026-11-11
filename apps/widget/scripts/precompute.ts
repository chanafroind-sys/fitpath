/**
 * Build the widget's data: one small file per product, and one file of paths.
 *
 * Everything expensive happens here, once. Each template is instantiated for
 * each sofa behind each wall a home can have, validated placement by placement
 * and edge by edge against the collider, and measured for what it demands of
 * a doorway — and the same again for each module the sofa ships as, and for
 * the body with each removable part taken off. What a browser fetches when
 * the modal opens is a table of numbers; the motions come down separately,
 * and only when there is one to draw.
 *
 * Run by `npm run precompute`, which `npm run build` runs first. The output is
 * committed so a checkout serves without a build step.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULES,
  SOFAS,
  WALL_THICKNESSES_IN_HOMES,
  buildEnvironment,
  buildLibraryForWalls,
  interpolate,
  itemWorldBoxes,
  prepareItem,
  reportOn,
  unionAabb,
  verifyPathIn,
} from '@fitpath/engine';
import type { Item, Maneuver, Placement } from '@fitpath/engine';
import { illustrate } from '@fitpath/illustrate';
import { DATA_VERSION } from '../src/types.ts';
import type { Carry, Removable, Separates, WallVariant, WidgetIndex, WidgetManeuver, WidgetPaths, WidgetProduct } from '../src/types.ts';

/**
 * The walls every maneuver is validated behind: the engine's list of what a
 * home has, thinnest first, unless the store says otherwise —
 * `FITPATH_WALLS_CM=12,25,40 npm run precompute`. The first is the wall the
 * answer assumes when the shopper has not said; the rest are what the widget
 * scans to find out whether a thicker wall would change the answer, so that
 * it mentions the wall only where it matters.
 */
const WALLS = (process.env['FITPATH_WALLS_CM'] ?? WALL_THICKNESSES_IN_HOMES.join(','))
  .split(',')
  .map((s) => Number(s.trim()))
  .sort((a, b) => a - b);
if (WALLS.length === 0 || WALLS.some((w) => !Number.isFinite(w) || w <= 0)) {
  throw new Error(`FITPATH_WALLS_CM must be positive numbers, got ${process.env['FITPATH_WALLS_CM']}`);
}
const WALL = WALLS[0]!;

/**
 * Whether each product is known to come apart into modules.
 *
 * A fact about the product that the engine has no way of knowing and a shop
 * always does: it is the `separates` field of the sourcing pipeline's input,
 * and in a real onboarding it arrives with the listing. Here it is declared
 * beside the catalogue. `'unknown'` is the honest state for a listing that does
 * not say, and the widget never treats it as either answer — because printing
 * the easier number beside a sofa that turns out to be welded is the one
 * direction this system must never fail in.
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

/**
 * Whether each removable part is known to come off, per product and part.
 *
 * The fixture says which boxes are the part; the listing says whether they
 * come off. `true` is acted on — the widget may present the body without the
 * part as the way in, saying so. `'unknown'` is rendered as a question for the
 * shopper and acted on only when they answer yes. A part that does not come
 * off is not declared and is never computed.
 */
const DETACHABLE: Record<string, Record<string, true | 'unknown'>> = {
  // The store's listing: "The solid beech legs unscrew without tools."
  'sofa-3-seat': { legs: true },
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

/** Every variant is checked again, on the exact objects that will be serialised, in the scene it asks for. */
function verifyInOwnRequirement(item: Item, maneuver: Maneuver, wall: number, headroom: number): void {
  const r = maneuver.requirement;
  const clear = Math.max(60, r.alongWall);
  const environment = buildEnvironment({
    openingWidth: r.doorWidth,
    openingHeight: r.doorHeight,
    wallThickness: wall,
    hallwayWidth: Math.max(1, r.hallwayClearance),
    hallwayDepth: clear,
    roomDepth: Math.max(1, r.roomDepth),
    roomWidth: clear,
    ceilingHeight: headroom + 20,
  });
  const fault = verifyPathIn(prepareItem(item), maneuver.path, environment);
  if (fault !== undefined) {
    throw new Error(`${item.id} / ${maneuver.templateId} behind ${wall} cm: ${fault.kind} ${fault.index} is not clear in its own requirement`);
  }
}

function carryOf(item: Item, paths: WidgetPaths): Carry {
  const started = performance.now();
  const report = reportOn(item, WALL);
  const levels = buildLibraryForWalls(prepareItem(item), WALLS);

  const own: Record<string, Placement[]> = {};
  const maneuvers: WidgetManeuver[] = [];
  const seen = new Map<string, WidgetManeuver>();
  for (const level of levels) {
    for (const maneuver of level.library.maneuvers) {
      let entry = seen.get(maneuver.templateId);
      if (entry === undefined) {
        entry = {
          templateId: maneuver.templateId,
          name: maneuver.name,
          nameHe: maneuver.nameHe,
          stages: maneuver.stages.map((stage) => ({ name: stage.name, nameHe: stage.nameHe })),
          variants: [],
        };
        seen.set(maneuver.templateId, entry);
        maneuvers.push(entry);
      }
      // The same object is kept across levels it is known to hold for; one
      // variant covers them all.
      const last = entry.variants[entry.variants.length - 1];
      if (last !== undefined && last.wallCm === maneuver.wallThickness) continue;

      const headroom = headroomOf(item, maneuver.path);
      verifyInOwnRequirement(item, maneuver, maneuver.wallThickness, headroom);
      const pathKey = `${maneuver.templateId}@${maneuver.wallThickness}`;
      own[pathKey] = maneuver.path;
      const line = report.maneuvers.find((l) => l.templateId === maneuver.templateId);
      const variant: WallVariant = {
        wallCm: maneuver.wallThickness,
        holdsForWallsUpTo: maneuver.holdsForWallsUpTo,
        need: { ...maneuver.requirement, ceilingHeight: headroom },
        turns: line?.turns === true,
        pathKey,
      };
      entry.variants.push(variant);
    }
  }
  paths[item.id] = own;

  // Library order is the engine's template order; a maneuver that only
  // applies behind a thicker wall would otherwise sort by first appearance.
  const order = levels[0]!.library.maneuvers.map((m) => m.templateId);
  maneuvers.sort((a, b) => {
    const ia = order.indexOf(a.templateId);
    const ib = order.indexOf(b.templateId);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });

  const bounds = report.dimensions;
  const variants = maneuvers.reduce((sum, m) => sum + m.variants.length, 0);
  console.log(
    `  ${item.name.padEnd(36)} ${(report.narrowest ?? NaN).toFixed(2).padStart(7)} cm ` +
      `floor ${(report.floor ?? NaN).toFixed(2)}  ${maneuvers.length} ways, ${variants} variants  (${(performance.now() - started).toFixed(0)} ms)`,
  );

  return {
    id: item.id,
    name: item.name,
    nameHe: item.nameHe,
    dimensions: { length: bounds.length, depth: bounds.depth, height: bounds.height },
    item,
    maneuvers,
    ...(report.narrowest !== undefined ? { narrowestCm: report.narrowest } : {}),
    ...(report.floor !== undefined ? { floorCm: report.floor } : {}),
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

console.log(`building the widget library behind walls of ${WALLS.join(', ')} cm…`);
for (const item of SOFAS) {
  const paths: WidgetPaths = {};
  const separates = SEPARATES[item.id];
  if (separates === undefined) throw new Error(`${item.id}: separability not declared`);

  const assembled = carryOf(item, paths);
  const modules = separates === true ? (MODULES[item.id] ?? []).map((piece) => carryOf(piece, paths)) : undefined;
  if (separates === true && (modules === undefined || modules.length === 0)) {
    throw new Error(`${item.id} is declared separable but has no modules modelled`);
  }
  const removable: Removable[] = [];
  for (const part of item.removableParts ?? []) {
    const detachable = DETACHABLE[item.id]?.[part.name];
    if (detachable === undefined) {
      throw new Error(`${item.id}: the fixture marks the ${part.name} removable, but whether they come off is not declared`);
    }
    removable.push({ part: part.name, partHe: part.nameHe, detachable, carry: carryOf(without(item, part), paths) });
  }

  const product: WidgetProduct = {
    dataVersion: DATA_VERSION,
    id: item.id,
    name: item.name,
    nameHe: item.nameHe,
    illustration: illustrate(item, { label: `${item.name}, drawn from its box model` }),
    wallCm: WALL,
    wallsCm: WALLS,
    assembled,
    separates,
    ...(modules !== undefined ? { modules } : {}),
    removable,
  };

  writeFileSync(resolve(out, `${item.id}.json`), JSON.stringify(product));
  writeFileSync(resolve(out, `${item.id}.paths.json`), JSON.stringify(paths));
  index.products.push({ id: item.id, name: item.name, nameHe: item.nameHe });
}
writeFileSync(resolve(out, 'index.json'), JSON.stringify(index, null, 2));
console.log(`wrote ${index.products.length} products to ${out}`);
