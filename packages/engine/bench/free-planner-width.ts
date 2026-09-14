// The free planner, not the library: one doorway width, real wall thickness, the
// fixture with real legs. Prints a JSON line so a batch of these can be tabulated.
import { SOFA_3_SEAT, buildEnvironment, plan } from '../src/index.ts';
import type { Item } from '../src/index.ts';

const width = Number(process.argv[2]);
const wall = Number(process.argv[3] ?? 30);
const maxNodes = Number(process.argv[4] ?? 6_000_000);
const variant = process.argv[5] ?? 'upright';
/** How far the on-side item is rolled about its length, in degrees; 90 is flat on its side. */
const rollDeg = Number(process.argv[6] ?? 90);

// The same sofa authored already on its side, so the planner's pitch (about
// the item's local Y, at yaw 90) becomes a lean into the direction of travel
// while it lies on its side — the pose the planner cannot otherwise reach,
// because it has no roll and its two tilt families meet only at level.
function preRolled(item: Item): Item {
  const rho = (rollDeg * Math.PI) / 180;
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  return {
    ...item,
    id: `${item.id}-rolled-${rollDeg}`,
    name: `${item.name}, authored rolled ${rollDeg} degrees`,
    boxes: item.boxes.map((box) => ({
      ...box,
      // rotate the centre about local X: (y, z) -> (y c - z s, y s + z c)
      center: { x: box.center.x, y: box.center.y * c - box.center.z * s, z: box.center.y * s + box.center.z * c },
      rotation: { ...box.rotation, roll: box.rotation.roll + rho },
    })),
  };
}

const item = variant === 'on-side' ? preRolled(SOFA_3_SEAT) : SOFA_3_SEAT;
const env = buildEnvironment({
  openingWidth: width,
  openingHeight: 210,
  wallThickness: wall,
  hallwayWidth: 300,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
});
const started = performance.now();
const result = plan(item, env, { diagnostics: false, maxNodes });
const ms = Math.round(performance.now() - started);
const summary = result.feasible
  ? {
      width, wall, variant, rollDeg, feasible: true, ms, nodes: result.stats.nodesGenerated,
      steps: result.steps.map((s) => s.en),
      path: result.path.length,
      coarse: result.stats.solvedOnCoarsePass,
      lattice: result.stats.lattice,
    }
  : { width, wall, variant, rollDeg, feasible: false, reason: result.reason, proven: result.proven, ms, nodes: result.stats.nodesGenerated, lattice: result.stats.lattice };
console.log(JSON.stringify(summary));
