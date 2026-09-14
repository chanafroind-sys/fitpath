/**
 * The pitch-and-straighten question, answered as a minimax over lean AND
 * sideways position, at a fixed roll and travel axis, with a witness.
 *
 * Two earlier versions of this measurement were wrong in instructive ways.
 * Sampling the section at stations missed the moment, between two samples,
 * when a leg and the backrest's top were inside the slab together. Costing
 * each edge by the union of its sections fixed that and still overclaimed,
 * because adjacent edges wanted the item at different sideways positions and
 * a sofa cannot jump across a doorway between one centimetre of travel and
 * the next. So the sideways position is a state here, it moves at a bounded
 * rate like the lean, and an edge's cost is the half-width the opening needs
 * with the item sliding linearly from one position to the next — measured on
 * samples no further apart than the engine's own MEASURE_STEP.
 *
 * The result is a floor over this family — lean schedules with a sideways
 * slide, at one roll, along one travel axis, on this grid — and a path the
 * collider then checks. It bounds nothing outside that family.
 */
import { writeFileSync } from 'node:fs';
import {
  SOFA_3_SEAT,
  buildEnvironment,
  buildManeuver,
  interpolate,
  itemWorldBoxes,
  orientedBounds,
  prepareItem,
  radians,
  slabSection,
  unionAabb,
  verifyPathIn,
} from '../src/index.ts';
import type { Item, ManeuverTemplate, Placement } from '../src/index.ts';

const wall = Number(process.argv[2] ?? 30);
const rhoDeg = Number(process.argv[3] ?? 270);
const legs = (process.argv[4] ?? 'on') === 'on';
const PHI_STEP = Number(process.argv[5] ?? 2);
const PHI_MAX = Number(process.argv[6] ?? 60);
const LINTEL = 210;
const RATE = 3;
const SLIDE_RATE = 2;
const X_STEP = 0.5;
const X_MAX = 60;
const CARRY = 2;
const MEASURE_STEP = 0.25;
const STATION = 1;

function preRolled(item: Item, deg: number): Item {
  const rho = radians(deg);
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  return {
    ...item,
    id: `${item.id}-rho${deg}`,
    boxes: item.boxes.map((box) => ({
      ...box,
      center: { x: box.center.x, y: box.center.y * c - box.center.z * s, z: box.center.y * s + box.center.z * c },
      rotation: { ...box.rotation, roll: box.rotation.roll + rho },
    })),
  };
}

const base: Item = legs
  ? SOFA_3_SEAT
  : { ...SOFA_3_SEAT, id: 'sofa-legless', boxes: SOFA_3_SEAT.boxes.slice(0, 4), removableParts: [] };
const item = prepareItem(preRolled(base, rhoDeg));
const yaw = radians(90);

const phis: number[] = [];
for (let p = -PHI_MAX; p <= PHI_MAX; p += PHI_STEP) phis.push(p);
const xs: number[] = [];
for (let x = -X_MAX; x <= X_MAX; x += X_STEP) xs.push(x);
const rests = phis.map((phi) => -orientedBounds(item, yaw, radians(phi), 'y').minZ + CARRY);
const place = (y: number, pi: number, x = 0): Placement => ({
  x,
  y,
  z: rests[pi]!,
  yaw,
  pitch: radians(phis[pi]!),
  tiltAxis: 'y',
});

const farthest = Math.max(
  ...phis.map((phi) => {
    const b = orientedBounds(item, yaw, radians(phi), 'y');
    return Math.max(-b.minY, b.maxY);
  }),
);
const ys: number[] = [];
for (let y = -Math.ceil(farthest) - 2; y <= wall + Math.ceil(farthest) + 2; y += STATION) ys.push(y);

/** Per-sample section intervals along an edge at x = 0; 'lintel' when it is exceeded. */
interface Samples {
  minX: Float64Array;
  maxX: Float64Array;
}
function sampleEdge(a: Placement, b: Placement): Samples | 'lintel' | undefined {
  const turn = Math.abs(b.pitch - a.pitch);
  const n = Math.max(1, Math.ceil((Math.abs(b.y - a.y) + turn * item.reach) / MEASURE_STEP));
  const minX = new Float64Array(n + 1).fill(Infinity);
  const maxX = new Float64Array(n + 1).fill(-Infinity);
  let any = false;
  for (let k = 0; k <= n; k++) {
    const p = k === 0 ? a : k === n ? b : interpolate(a, b, k / n);
    const s = slabSection(item, p, 0, wall);
    if (s === undefined) continue;
    if (s.maxZ > LINTEL + 1e-9) return 'lintel';
    minX[k] = s.minX;
    maxX[k] = s.maxX;
    any = true;
  }
  return any ? { minX, maxX } : undefined;
}

/** The half-width the opening needs while the item slides from xa to xb along this edge. */
function need(samples: Samples, xa: number, xb: number): number {
  const n = samples.minX.length - 1;
  let worst = 0;
  for (let k = 0; k <= n; k++) {
    const lo = samples.minX[k]!;
    if (lo === Infinity) continue;
    const x = xa + ((xb - xa) * k) / n;
    const left = -(lo + x);
    const right = samples.maxX[k]! + x;
    if (left > worst) worst = left;
    if (right > worst) worst = right;
  }
  return worst;
}

const started = performance.now();
const NP = phis.length;
const NX = xs.length;
const phiReach = Math.max(1, Math.round((RATE * STATION) / PHI_STEP));
const xReach = Math.max(1, Math.round((SLIDE_RATE * STATION) / X_STEP));

// cost[pi * NX + xi]: the half-width needed so far, ending at this state.
let cost = new Float64Array(NP * NX).fill(0);
let tilt = new Float64Array(NP * NX);
for (let pi = 0; pi < NP; pi++) for (let xi = 0; xi < NX; xi++) tilt[pi * NX + xi] = Math.abs(phis[pi]!);
const back: Int32Array[] = [];
let edges = 0;

for (let i = 1; i < ys.length; i++) {
  const next = new Float64Array(NP * NX).fill(Infinity);
  const nextTilt = new Float64Array(NP * NX).fill(Infinity);
  const from = new Int32Array(NP * NX).fill(-1);
  for (let pi = 0; pi < NP; pi++) {
    const to0 = place(ys[i]!, pi);
    for (let dp = -phiReach; dp <= phiReach; dp++) {
      const q = pi + dp;
      if (q < 0 || q >= NP) continue;
      const samples = sampleEdge(place(ys[i - 1]!, q), to0);
      edges++;
      if (samples === 'lintel') continue;
      for (let xi = 0; xi < NX; xi++) {
        const s = pi * NX + xi;
        for (let dx = -xReach; dx <= xReach; dx++) {
          const xq = xi + dx;
          if (xq < 0 || xq >= NX) continue;
          const prev = q * NX + xq;
          const c0 = cost[prev]!;
          if (c0 === Infinity) continue;
          const edgeNeed = samples === undefined ? 0 : need(samples, xs[xq]!, xs[xi]!);
          const c = c0 > edgeNeed ? c0 : edgeNeed;
          const t = tilt[prev]! + Math.abs(phis[pi]!);
          if (c < next[s]! - 1e-9 || (Math.abs(c - next[s]!) <= 1e-9 && t < nextTilt[s]!)) {
            next[s] = c;
            nextTilt[s] = t;
            from[s] = prev;
          }
        }
      }
    }
  }
  back.push(from);
  cost = next;
  tilt = nextTilt;
}

let end = 0;
for (let s = 1; s < NP * NX; s++) {
  if (cost[s]! < cost[end]! - 1e-9 || (Math.abs(cost[s]! - cost[end]!) <= 1e-9 && tilt[s]! < tilt[end]!)) end = s;
}
const bound = 2 * cost[end]!;
const chosen = new Array<number>(ys.length);
chosen[ys.length - 1] = end;
for (let i = ys.length - 1; i > 0; i--) chosen[i - 1] = back[i - 1]![chosen[i]!]!;

console.log(
  `wall ${wall}, roll ${rhoDeg}, legs ${legs ? 'on' : 'off'}, lean grid ${PHI_STEP} deg to ${PHI_MAX}, slide ${SLIDE_RATE} cm/cm: ` +
    `bound ${bound.toFixed(2)} cm (${ys.length} stations, ${edges} edges sampled, ${((performance.now() - started) / 1000).toFixed(0)} s)`,
);
const trace: string[] = [];
for (let i = 0; i < ys.length; i += 10) {
  const s = chosen[i]!;
  trace.push(`${ys[i]}:${phis[Math.floor(s / NX)]}/${xs[s % NX]}`);
}
console.log(`lean/slide by station (y:deg/cm): ${trace.join(' ')}`);

const path = ys.map((y, i) => {
  const s = chosen[i]!;
  return place(y, Math.floor(s / NX), xs[s % NX]!);
});
const opening = bound + 0.01;
const environment = buildEnvironment({
  openingWidth: opening,
  openingHeight: LINTEL,
  wallThickness: wall,
  hallwayWidth: 400,
  hallwayDepth: 400,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 260,
});
const fault = verifyPathIn(item, path, environment);
if (fault === undefined) {
  console.log(`VALIDATED by the collider: ${path.length} waypoints and every edge clear through a ${opening.toFixed(2)} x ${LINTEL} opening in a ${wall} cm wall`);
} else {
  const p = path[fault.index]!;
  console.log(`NOT VALID: ${fault.kind} at waypoint ${fault.index} (y=${p.y}, lean ${(p.pitch * 180 / Math.PI).toFixed(0)} deg, x ${p.x})`);
}

// What the motion asks of a home, measured by the engine the way every library
// maneuver is: the path as a one-stage template through `buildManeuver`, which
// derives the five numbers from the motion and validates it in exactly that
// environment. And the headroom, which the five numbers do not carry.
const asTemplate: ManeuverTemplate = {
  id: 'lean-and-straighten',
  name: 'Lean into the doorway and straighten inside it',
  nameHe: 'להטות לתוך הפתח וליישר בתוכו',
  build: () => [{ id: 'all', name: 'all', nameHe: 'הכול', waypoints: path.map((p) => ({ ...p })) }],
};
const measured = buildManeuver(item, asTemplate, wall);
let top = 0;
for (let i = 0; i + 1 < path.length; i++) {
  for (let k = 0; k <= 4; k++) top = Math.max(top, unionAabb(itemWorldBoxes(item, interpolate(path[i]!, path[i + 1]!, k / 4))).maxZ);
}
if (measured.ok) {
  const r = measured.maneuver.requirement;
  console.log(
    `requirement by buildManeuver: door ${r.doorWidth.toFixed(2)} x ${r.doorHeight.toFixed(2)}, in front ${r.hallwayClearance.toFixed(2)}, ` +
      `along ${r.alongWall.toFixed(2)}, behind ${r.roomDepth.toFixed(2)}; headroom ${top.toFixed(1)} cm; validated in that environment`,
  );
} else {
  console.log(`buildManeuver refused it: ${measured.reason}; headroom ${top.toFixed(1)} cm`);
}
const outFile = process.argv[7];
if (outFile !== undefined) {
  writeFileSync(outFile, JSON.stringify({ wall, rhoDeg, legs, bound, path }));
  console.log(`path written to ${outFile}`);
}
