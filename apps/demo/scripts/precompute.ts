/**
 * Build the maneuver library, once, and write it into the demo as data.
 *
 * This is the whole architecture in one script. Everything expensive —
 * instantiating each template for each sofa, validating every placement and
 * every edge against the collider, measuring what each motion demands of a
 * doorway — happens here, at build time, and what ships to a browser is a table
 * of numbers and a few paths to animate.
 *
 * The hero's planner figures are here for the same reason and a stronger one:
 * a 90 cm doorway takes the general planner about ten seconds to fail to
 * answer, and nobody is going to sit through that on a product page. The point
 * of showing it is that it happened, not that it happens now.
 *
 * Run by `npm run precompute`, which `npm run build` runs first. The output is
 * committed so that `npm run dev` works without it.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MODULES,
  SOFAS,
  buildEnvironment,
  buildLibrary,
  plan,
  provableNoFit,
  reportOn,
  verifyPathIn,
} from '../../../packages/engine/src/index.ts';
import { prepareItem } from '../../../packages/engine/src/geometry/collide.ts';
import type { EnvironmentParams } from '../../../packages/engine/src/index.ts';

const WALL = 15;
const HERO_WIDTH = 90;
const HERO_BUDGET = 1_200_000;

/**
 * Round the reported numbers, and NEVER the poses.
 *
 * This started as one line that rounded every number in the payload to four
 * decimals, which seemed harmless and was not. A maneuver's carry stage sets
 * the sofa down so its lowest corner is exactly on the floor; rounding the
 * pitch of that pose from -1.5707963267948966 to -1.5708 moves the angle by
 * 5e-5 radians, and on a 220 cm sofa that swings the far corner 2.4e-4 cm
 * BELOW the floor. Small enough to be invisible, large enough to be a
 * collision — the engine's contact tolerance is 1e-9 — so what shipped was a
 * path the collider rejected, while the path the library had validated stayed
 * behind in the build.
 *
 * The lesson generalises past this file: a pose is not a bag of independent
 * numbers. Its parts were chosen against each other, and rounding one of them
 * on its own breaks the contact the whole thing was resting on. Measurements
 * are for reading and may be rounded; poses are for the collider and may not.
 */
function tidy<T>(value: T, insidePath = false): T {
  if (typeof value === 'number') {
    return (insidePath || !Number.isFinite(value) ? value : Number(value.toFixed(4))) as T;
  }
  if (Array.isArray(value)) return value.map((v) => tidy(v, insidePath)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = tidy(v, insidePath || key === 'path');
    }
    return out as T;
  }
  return value;
}

/**
 * The scene each product page opens with, defined here and nowhere else.
 *
 * These used to live in the demo's catalogue, which meant the scene a maneuver
 * was verified against and the scene it was drawn in were two separate literals
 * that agreed by good intentions. They are one object now: the build checks
 * every maneuver against exactly what the page will show, because it is the
 * same data the page reads.
 *
 * Chosen so the first answer a visitor sees is decisive rather than borderline,
 * and so the doorway is a size that exists in houses.
 */
const withDoor = (openingWidth: number, hallwayWidth: number): EnvironmentParams => ({
  openingWidth,
  openingHeight: 210,
  wallThickness: WALL,
  hallwayWidth,
  hallwayDepth: 360,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
});

const SCENES: Record<string, EnvironmentParams> = {
  'sofa-3-seat': withDoor(110, 240),
  'slim-arm-2-seat': withDoor(80, 240),
  'corner-sofa': withDoor(90, 300),
  'deep-seat-lounge': withDoor(80, 240),
  'recliner-2-seat': withDoor(105, 240),
  'sofa-bed': withDoor(95, 240),
};

const hero: EnvironmentParams = {
  openingWidth: HERO_WIDTH,
  openingHeight: 210,
  wallThickness: WALL,
  hallwayWidth: 300,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
};

console.log('building the library…');
const catalogue = SOFAS.map((item) => {
  const started = performance.now();
  const report = reportOn(item, WALL);
  const { maneuvers } = buildLibrary(prepareItem(item), WALL);
  const modules = (MODULES[item.id] ?? []).map((piece) => ({
    id: piece.id,
    report: reportOn(piece, WALL),
  }));
  console.log(
    `  ${item.name.padEnd(28)} ${(report.narrowest ?? NaN).toFixed(2)} cm  ` +
      `(${(performance.now() - started).toFixed(0)}ms)`,
  );
  return { id: item.id, report, maneuvers, modules };
});

// The hero, both engines, on the same question.
const heroItem = SOFAS[0]!;
const heroEnvironment = buildEnvironment(hero);
const heroEntry = catalogue.find((entry) => entry.id === heroItem.id)!;

const selectionStarted = performance.now();
const heroFits = heroEntry.maneuvers
  .filter(
    (m) =>
      m.requirement.doorWidth <= hero.openingWidth &&
      m.requirement.doorHeight <= hero.openingHeight &&
      m.requirement.hallwayClearance <= hero.hallwayWidth &&
      m.requirement.roomDepth <= hero.roomDepth,
  )
  .sort((a, b) => a.stages.length - b.stages.length)[0];
const selectionMicros = (performance.now() - selectionStarted) * 1000;
if (heroFits === undefined) throw new Error('the hero doorway has no maneuver, which defeats the point');

console.log(`planning the hero the hard way (up to ${HERO_BUDGET.toLocaleString('en-US')} nodes)…`);
const plannerStarted = performance.now();
const planned = plan(heroItem, heroEnvironment, { diagnostics: false, maxNodes: HERO_BUDGET });
const plannerMs = performance.now() - plannerStarted;
console.log(
  `  planner: ${planned.feasible ? 'feasible' : planned.reason} in ${plannerMs.toFixed(0)}ms, ` +
    `${planned.stats.nodesGenerated.toLocaleString('en-US')} nodes`,
);

const payload = tidy({
  wallThickness: WALL,
  scenes: SCENES,
  catalogue,
  hero: {
    params: hero,
    itemId: heroItem.id,
    library: {
      templateId: heroFits.templateId,
      name: heroFits.name,
      nameHe: heroFits.nameHe,
      requirement: heroFits.requirement,
      stages: heroFits.stages,
      path: heroFits.path,
      micros: Math.max(1, Math.round(selectionMicros)),
    },
    planner: {
      feasible: planned.feasible,
      reason: planned.feasible ? 'feasible' : planned.reason,
      nodes: planned.stats.nodesGenerated,
      ms: Math.round(plannerMs),
      budget: HERO_BUDGET,
    },
    // The closed-form proof, asked the same question, so the page can show all
    // three answers side by side and label which one spoke.
    proof: provableNoFit(heroItem.boxes, hero.openingWidth, hero.openingHeight),
  },
});

/**
 * Nothing ships that the collider has not cleared IN THE SCENE IT IS DRAWN IN.
 *
 * The build fails rather than publishing a path that goes through a wall. This
 * is checked on the payload after rounding, not before, because the rounding is
 * exactly the step that broke it once.
 */
const heroItem2 = prepareItem(heroItem);
const heroFault = verifyPathIn(heroItem2, payload.hero.library.path, heroEnvironment);
if (heroFault !== undefined) {
  throw new Error(
    `the hero's animated path is not clear in the scene the page draws: ` +
      `${heroFault.kind} ${heroFault.index}`,
  );
}
console.log(`verified: the hero's ${payload.hero.library.path.length} waypoints are clear as drawn`);

// And every maneuver, in the scene its own product page opens with.
for (const entry of payload.catalogue) {
  const item = SOFAS.find((candidate) => candidate.id === entry.id)!;
  const prepared = prepareItem(item);
  const scene = buildEnvironment(payload.scenes[entry.id] ?? hero);
  for (const maneuver of entry.maneuvers) {
    const requirement = maneuver.requirement;
    const params = payload.scenes[entry.id] ?? hero;
    const applies =
      requirement.doorWidth <= params.openingWidth &&
      requirement.doorHeight <= params.openingHeight &&
      requirement.hallwayClearance <= params.hallwayWidth &&
      requirement.roomDepth <= params.roomDepth;
    if (!applies) continue;
    const fault = verifyPathIn(prepared, maneuver.path, scene);
    if (fault !== undefined) {
      throw new Error(
        `${entry.id} / ${maneuver.templateId} is not clear in its own default scene: ` +
          `${fault.kind} ${fault.index}`,
      );
    }
  }
}
console.log('verified: every maneuver is clear in the scene its product page opens with');

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../src/precomputed.ts');
mkdirSync(dirname(out), { recursive: true });

const banner = `/**
 * GENERATED by scripts/precompute.ts. Do not edit by hand.
 *
 * The maneuver library for every sofa in the catalogue, built and validated
 * offline, plus the hero's two answers to the same question. Regenerated by
 * \`npm run precompute\`, which the build runs first.
 */
import type { ItemReport, Maneuver, ManeuverRequirement, ManeuverStage } from '@fitpath/engine';
import type { EnvironmentParams, NoFitProof, Placement } from '@fitpath/engine';

export interface CatalogueModule {
  id: string;
  report: ItemReport;
}

export interface CatalogueEntry {
  id: string;
  report: ItemReport;
  maneuvers: Maneuver[];
  modules: CatalogueModule[];
}

export interface HeroLibraryAnswer {
  templateId: string;
  name: string;
  nameHe: string;
  requirement: ManeuverRequirement;
  stages: ManeuverStage[];
  path: Placement[];
  /** How long the runtime selection took, in microseconds. */
  micros: number;
}

export interface HeroPlannerAnswer {
  feasible: boolean;
  reason: string;
  nodes: number;
  ms: number;
  budget: number;
}

export interface Precomputed {
  wallThickness: number;
  /** The scene each product page opens with — the one the build verified against. */
  scenes: Record<string, EnvironmentParams>;
  catalogue: CatalogueEntry[];
  hero: {
    params: EnvironmentParams;
    itemId: string;
    library: HeroLibraryAnswer;
    planner: HeroPlannerAnswer;
    proof: NoFitProof;
  };
}

export const PRECOMPUTED: Precomputed = `;

writeFileSync(out, `${banner}${JSON.stringify(payload, null, 2)};\n`, 'utf8');
console.log(`wrote ${out}`);
