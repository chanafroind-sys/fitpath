/**
 * Lean into the doorway and straighten inside it.
 *
 * The three-seater lies ten degrees short of flat on its side, leans up to
 * about sixty degrees into the direction of travel while its leading leg
 * station crosses the wall — so that the leg is through before the backrest's
 * top arrives and the two are never inside the tunnel together — levels for
 * the middle, and leans the other way for the trailing end. Behind a 30 cm
 * wall that is 82.72 cm of doorway with the real legs on, against 85.01 for
 * lying flat; `test/leanWitness.test.ts` carries the bench path that first
 * showed it at 83.05, and this template is that measurement made repeatable
 * for any item, and a little better centred.
 *
 * ## Why it exists as a template and not a search
 *
 * The pose is a roll and a pitch at once. The planner's placement holds one
 * tilt, so the motion is not in its state space at all; it is authored here,
 * with `Placement.roll`, and judged by the same collider as everything else.
 *
 * ## How the schedule is found
 *
 * A minimax, like `rollSchedule`, but over two things the roll schedule does
 * not have to think about. A lean moves points *along* the travel axis, so
 * what is inside the slab is no longer a function of the station, and every
 * transition has to be costed along its whole straight interpolation — at the
 * same 0.25 cm step `buildManeuver` measures with — rather than at its ends.
 * And the section drifts across the opening as the lean changes, so the
 * sideways position is a state of the schedule, sliding at a bounded rate,
 * and an edge costs the half-width the opening needs while the item slides
 * from one position to the next. Two cheaper formulations were measured and
 * both overclaimed; the README records them. This one produces paths the
 * collider passes.
 *
 * The roll is scanned coarsely on both sides of flat and the best is refined.
 * Every grid, rate and candidate order is fixed, so the same item builds the
 * same schedule twice.
 *
 * ## What it does not claim
 *
 * A witness, not a floor: one roll, one travel axis, a lean up to 60 degrees
 * at 4 degrees per centimetre, a slide at 2 — a family, chosen because it is
 * what a person can do, not the space of all motions. It only applies where
 * a short stretch of the item sets the width; where every station binds
 * there is nothing to lead with, and the template says it does not apply.
 * And it holds only for the wall it was built behind: at 40 cm the leg no
 * longer clears before the backrest's top arrives, and the template's own
 * flag tells `buildLibrary` not to claim more.
 */
import type { Item, Placement } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { ManeuverTemplate, StageDraft } from './types.ts';
import { radians } from '../math/rotation.ts';
import { EDGE_PAIRS, cornersAt, orientedBounds } from './footprint.ts';
import { LINTEL, MARGIN, bestRollSchedule } from './schedule.ts';

/** Carried, not dragged: a straight interpolation between two leans is a chord against an arc. */
const CARRY = 2;

/** The lean may not exceed this, either way. */
const LEAN_MAX_DEG = 60;

/** Roll steps while tipping onto the side and standing back up. */
const ROLL_STEP_DEG = 5;

/** The item must present a short stretch that binds, or there is nothing to lead with. */
const MAX_PEAK_FRACTION = 0.5;

/** A schedule that beats lying flat by less than this is not worth a maneuver of its own. */
const WORTH_CM = 0.5;

/** Rolls scanned, as offsets from flat on either side, coarsely; the best is refined. */
const ROLL_OFFSETS_DEG = [0, -5, 5, -10, 10, -15, 15];

interface Grid {
  /** Lean step in degrees. */
  leanStep: number;
  /** Lean steps a station may change by. */
  leanReach: number;
  /** Distance between stations, in centimetres. */
  station: number;
  /** Sideways grid step, in centimetres. */
  slideStep: number;
  /** Sideways steps a station may move by. */
  slideReach: number;
  /** How far sideways the origin may wander, either way, from where the level item sits centred. */
  slideMax: number;
  /** How far a material point may move between two section samples. */
  measureStep: number;
  /** Lean resolution the corner sets are precomputed at, for the samples. */
  cornerStep: number;
}

/** For choosing the roll: a tenth of the cost, a few millimetres of precision. */
const COARSE: Grid = {
  leanStep: 6,
  leanReach: 1,
  station: 2,
  slideStep: 2,
  slideReach: 2,
  slideMax: 40,
  measureStep: 1,
  cornerStep: 1,
};

/**
 * For the schedule that ships. Sampled at the same 0.25 cm `buildManeuver`
 * measures with. The grid decides which schedule is chosen, not what is
 * claimed for it: the chosen path goes through `buildManeuver`, which
 * measures the requirement from the motion and validates in exactly that
 * environment, so a coarser grid could cost a millimetre of optimality and
 * never a millimetre of honesty.
 */
const FINE: Grid = {
  leanStep: 2,
  leanReach: 2,
  station: 1,
  slideStep: 0.5,
  slideReach: 4,
  slideMax: 40,
  measureStep: 0.25,
  cornerStep: 0.25,
};

/** A corner set packed flat: 24 numbers per box, x y z per corner. */
type Packed = Float64Array;

function pack(sets: readonly (readonly { x: number; y: number; z: number }[])[]): Packed {
  const out = new Float64Array(sets.length * 24);
  let k = 0;
  for (const corners of sets) {
    for (const c of corners) {
      out[k++] = c.x;
      out[k++] = c.y;
      out[k++] = c.z;
    }
  }
  return out;
}

interface Extent {
  minX: number;
  maxX: number;
  maxZ: number;
}

/**
 * The slab section of packed corners with the origin at (dy, dz) along and
 * up, sideways at 0, written into `out`. The same clipping as
 * `sectionOfCorners`, with nothing allocated: this runs a few million times
 * per item. Returns false when nothing is in the slab.
 */
function packedSection(packed: Packed, dy: number, dz: number, minY: number, maxY: number, out: Extent): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  const boxes = packed.length / 24;
  for (let b = 0; b < boxes; b++) {
    const base = b * 24;
    let boxMinY = Infinity;
    let boxMaxY = -Infinity;
    for (let c = 0; c < 8; c++) {
      const y = packed[base + c * 3 + 1]! + dy;
      if (y < boxMinY) boxMinY = y;
      if (y > boxMaxY) boxMaxY = y;
    }
    if (boxMaxY < minY || boxMinY > maxY) continue;
    for (let c = 0; c < 8; c++) {
      const y = packed[base + c * 3 + 1]! + dy;
      if (y >= minY && y <= maxY) {
        any = true;
        const x = packed[base + c * 3]!;
        const z = packed[base + c * 3 + 2]! + dz;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z > maxZ) maxZ = z;
      }
    }
    for (let e = 0; e < 24; e += 2) {
      const i = base + EDGE_PAIRS[e]! * 3;
      const j = base + EDGE_PAIRS[e + 1]! * 3;
      const ay = packed[i + 1]! + dy;
      const by = packed[j + 1]! + dy;
      for (let p = 0; p < 2; p++) {
        const plane = p === 0 ? minY : maxY;
        const da = ay - plane;
        const db = by - plane;
        if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
        if (da === db) continue;
        const t = da / (da - db);
        if (t < 0 || t > 1) continue;
        any = true;
        const x = packed[i]! + t * (packed[j]! - packed[i]!);
        const z = packed[i + 2]! + t * (packed[j + 2]! - packed[i + 2]!) + dz;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  out.minX = minX;
  out.maxX = maxX;
  out.maxZ = maxZ;
  return any;
}

interface Schedule {
  /** The doorway the schedule needs, twice the half-width. */
  bound: number;
  /** Stations along the travel axis. */
  ys: number[];
  /** Lean at each station, in degrees. */
  leans: number[];
  /** Sideways position of the origin at each station. */
  xs: number[];
}

const YAW = radians(90);

/**
 * The minimax over lean and slide at one roll.
 *
 * States are (lean, slide) per station; the cost carried is the half-width
 * the opening has had to be so far, and an edge adds the half-width needed
 * along its own interpolation. Ties prefer the smaller accumulated lean, so
 * the item stays level wherever tipping it gains nothing.
 */
function leanSchedule(item: PreparedItem, rollDeg: number, wall: number, grid: Grid): Schedule | undefined {
  const roll = radians(rollDeg);
  const leans: number[] = [];
  for (let d = -LEAN_MAX_DEG; d <= LEAN_MAX_DEG; d += grid.leanStep) leans.push(d);
  // The slide window is centred where the level item sits centred in the
  // opening, so the flat pose is on the grid exactly and the schedule has
  // room to wander either side of it.
  const level = orientedBounds(item, YAW, 0, 'y', roll);
  const centre = -(level.minX + level.maxX) / 2;
  const slides: number[] = [];
  for (let x = centre - grid.slideMax; x <= centre + grid.slideMax + 1e-9; x += grid.slideStep) slides.push(x);
  const NL = leans.length;
  const NX = slides.length;

  // Corner sets at every lean the samples can land on, and the height each
  // grid lean rests at. The rotation is the expensive part; taken once.
  const cornerLeans: number[] = [];
  for (let d = -LEAN_MAX_DEG; d <= LEAN_MAX_DEG + 1e-9; d += grid.cornerStep) cornerLeans.push(d);
  const corners = cornerLeans.map((d) => pack(cornersAt(item, { yaw: YAW, pitch: radians(d), tiltAxis: 'y', roll })));
  const cornerIndex = (deg: number): number =>
    Math.min(cornerLeans.length - 1, Math.max(0, Math.round((deg + LEAN_MAX_DEG) / grid.cornerStep)));
  const rests = leans.map((d) => -orientedBounds(item, YAW, radians(d), 'y', roll).minZ + CARRY);

  // Stations from wholly in front of the wall to wholly behind it, at the
  // longest reach any lean gives.
  let farthest = 0;
  for (const d of leans) {
    const b = orientedBounds(item, YAW, radians(d), 'y', roll);
    farthest = Math.max(farthest, -b.minY, b.maxY);
  }
  const ys: number[] = [];
  for (let y = -Math.ceil(farthest) - MARGIN; y <= wall + Math.ceil(farthest) + MARGIN; y += grid.station) ys.push(y);
  if (ys.length < 2) return undefined;

  const reach = item.reach;
  let cost = new Float64Array(NL * NX).fill(0);
  let tilt = new Float64Array(NL * NX);
  for (let li = 0; li < NL; li++) for (let xi = 0; xi < NX; xi++) tilt[li * NX + xi] = Math.abs(leans[li]!);
  const back: Int32Array[] = [];

  // Per-edge profiles: the leftmost and rightmost the section reaches at each
  // sample, at slide 0. The half-width an edge needs while sliding from xa to
  // xb is then max over samples of max(L - x, R + x) with x linear in between,
  // which for a given slide *distance* depends on xa only through a shift —
  // so the maxima are taken once per distance and applied to every start.
  const maxL = new Float64Array(2 * grid.slideReach + 1);
  const maxR = new Float64Array(2 * grid.slideReach + 1);
  const section: Extent = { minX: 0, maxX: 0, maxZ: 0 };
  // Enough samples for the steepest edge; reused for every edge.
  const maxSamples = Math.ceil((grid.station + radians(grid.leanStep * grid.leanReach) * reach) / grid.measureStep) + 2;
  const L = new Float64Array(maxSamples);
  const R = new Float64Array(maxSamples);

  for (let i = 1; i < ys.length; i++) {
    const next = new Float64Array(NL * NX).fill(Infinity);
    const nextTilt = new Float64Array(NL * NX).fill(Infinity);
    const from = new Int32Array(NL * NX).fill(-1);
    const dy = ys[i]! - ys[i - 1]!;

    for (let li = 0; li < NL; li++) {
      for (let dl = -grid.leanReach; dl <= grid.leanReach; dl++) {
        const lq = li + dl;
        if (lq < 0 || lq >= NL) continue;
        const fromLean = leans[lq]!;
        const toLean = leans[li]!;
        const turn = Math.abs(radians(toLean - fromLean));
        const n = Math.max(1, Math.ceil((dy + turn * reach) / grid.measureStep));

        // The section at every sample along the edge, slide 0.
        let lintel = false;
        let any = false;
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const deg = fromLean + (toLean - fromLean) * t;
          const y = ys[i - 1]! + dy * t;
          const z = rests[lq]! + (rests[li]! - rests[lq]!) * t;
          if (!packedSection(corners[cornerIndex(deg)]!, y, z, 0, wall, section)) {
            L[k] = -Infinity;
            R[k] = -Infinity;
            continue;
          }
          if (section.maxZ > LINTEL + 1e-9) {
            lintel = true;
            break;
          }
          any = true;
          L[k] = -section.minX;
          R[k] = section.maxX;
        }
        if (lintel) continue;

        if (!any) {
          // Nothing in the wall: the edge costs nothing, whatever the slide.
          for (let xi = 0; xi < NX; xi++) {
            const s = li * NX + xi;
            for (let dx = -grid.slideReach; dx <= grid.slideReach; dx++) {
              const xq = xi - dx;
              if (xq < 0 || xq >= NX) continue;
              const prev = lq * NX + xq;
              const c = cost[prev]!;
              if (c === Infinity) continue;
              const tl = tilt[prev]! + Math.abs(toLean);
              if (c < next[s]! - 1e-9 || (Math.abs(c - next[s]!) <= 1e-9 && tl < nextTilt[s]!)) {
                next[s] = c;
                nextTilt[s] = tl;
                from[s] = prev;
              }
            }
          }
          continue;
        }

        for (let dx = -grid.slideReach; dx <= grid.slideReach; dx++) {
          const shift = dx * grid.slideStep;
          let ml = -Infinity;
          let mr = -Infinity;
          for (let k = 0; k <= n; k++) {
            if (L[k] === -Infinity) continue;
            const x = (shift * k) / n;
            const l = L[k]! - x;
            const r = R[k]! + x;
            if (l > ml) ml = l;
            if (r > mr) mr = r;
          }
          maxL[dx + grid.slideReach] = ml;
          maxR[dx + grid.slideReach] = mr;
        }

        for (let xi = 0; xi < NX; xi++) {
          const s = li * NX + xi;
          for (let dx = -grid.slideReach; dx <= grid.slideReach; dx++) {
            const xq = xi - dx;
            if (xq < 0 || xq >= NX) continue;
            const prev = lq * NX + xq;
            const c0 = cost[prev]!;
            if (c0 === Infinity) continue;
            const xa = slides[xq]!;
            const l = maxL[dx + grid.slideReach]! - xa;
            const r = maxR[dx + grid.slideReach]! + xa;
            const need = l > r ? l : r;
            const c = c0 > need ? c0 : need;
            const tl = tilt[prev]! + Math.abs(toLean);
            if (c < next[s]! - 1e-9 || (Math.abs(c - next[s]!) <= 1e-9 && tl < nextTilt[s]!)) {
              next[s] = c;
              nextTilt[s] = tl;
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

  let end = -1;
  for (let s = 0; s < NL * NX; s++) {
    if (cost[s] === Infinity) continue;
    if (end < 0 || cost[s]! < cost[end]! - 1e-9 || (Math.abs(cost[s]! - cost[end]!) <= 1e-9 && tilt[s]! < tilt[end]!)) end = s;
  }
  if (end < 0) return undefined;

  const chosen = new Array<number>(ys.length);
  chosen[ys.length - 1] = end;
  for (let i = ys.length - 1; i > 0; i--) chosen[i - 1] = back[i - 1]![chosen[i]!]!;

  return {
    bound: 2 * cost[end]!,
    ys,
    leans: chosen.map((s) => leans[Math.floor(s / NX)]!),
    xs: chosen.map((s) => slides[s % NX]!),
  };
}

/** How much of the item's length sits at the roll floor: 1 when every station binds. */
function peakFraction(item: PreparedItem, wall: number): number | undefined {
  const schedule = bestRollSchedule(item, wall, LINTEL);
  if (schedule === undefined || schedule.travelAxis !== 'x') return undefined;
  const floors = schedule.stationFloors.filter((w) => w > 0);
  if (floors.length === 0) return undefined;
  let peak = 0;
  for (const w of floors) if (w > peak) peak = w;
  let atPeak = 0;
  for (const w of floors) if (w >= peak - 0.05) atPeak++;
  return atPeak / floors.length;
}

/** Waypoints turning the roll from one angle to another at a fixed position, carried. */
function tip(item: PreparedItem, x: number, y: number, fromDeg: number, toDeg: number): Placement[] {
  const steps = Math.max(1, Math.ceil(Math.abs(toDeg - fromDeg) / ROLL_STEP_DEG));
  const out: Placement[] = [];
  for (let i = 0; i <= steps; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const roll = radians(deg);
    const rest = -orientedBounds(item, YAW, 0, 'y', roll).minZ + CARRY;
    out.push({ x, y, z: rest, yaw: YAW, pitch: 0, tiltAxis: 'y', ...(deg === 0 ? {} : { roll }) });
  }
  return out;
}

/** Built once per item and wall; `build` hands out copies, because `buildManeuver` shifts what it is given. */
const memo = new WeakMap<Item, Map<number, StageDraft[] | undefined>>();

function stagesFor(item: PreparedItem, wall: number): StageDraft[] | undefined {
  const fraction = peakFraction(item, wall);
  if (fraction === undefined || fraction >= MAX_PEAK_FRACTION) return undefined;

  // Choose the roll: both sides of flat, coarsely, then refine the best.
  let bestRoll = 90;
  let bestCoarse = Infinity;
  let flatCoarse = Infinity;
  for (const side of [-90, 90]) {
    for (const offset of ROLL_OFFSETS_DEG) {
      const rollDeg = side + offset;
      const coarse = leanSchedule(item, rollDeg, wall, COARSE);
      if (coarse === undefined) continue;
      if (offset === 0 && coarse.bound < flatCoarse) flatCoarse = coarse.bound;
      if (coarse.bound < bestCoarse - 1e-9) {
        bestCoarse = coarse.bound;
        bestRoll = rollDeg;
      }
    }
  }
  if (bestCoarse === Infinity) return undefined;
  // The coarse grid ranks the rolls; it underrates the gain (0.46 cm where the
  // fine grid finds 1.96 on the three-seater), so whether the lean is worth a
  // maneuver of its own is decided on the refined schedule. Lying flat is on
  // both grids exactly — the slide window is centred on it — so the flat
  // figure needs no refining.
  if (bestRoll === -90 || bestRoll === 90) return undefined;

  const fine = leanSchedule(item, bestRoll, wall, FINE);
  if (fine === undefined) return undefined;
  if (!fine.leans.some((d) => d !== 0)) return undefined;
  // Nothing to add: lying flat, which ON_ITS_SIDE already covers, is as good.
  if (flatCoarse - fine.bound < WORTH_CM) return undefined;

  const roll = radians(bestRoll);
  const through: Placement[] = fine.ys.map((y, i) => {
    const pitch = radians(fine.leans[i]!);
    const rest = -orientedBounds(item, YAW, pitch, 'y', roll).minZ + CARRY;
    return { x: fine.xs[i]!, y, z: rest, yaw: YAW, pitch, tiltAxis: 'y', roll };
  });

  // The through motion in its natural phases: lean in until the item is level
  // again, carry the middle level, lean out. Each phase is a stage because
  // each is a separate thing to do, and so that the requirement says which of
  // them needs the headroom.
  const leaning = (i: number): boolean => fine.leans[i] !== 0;
  let a = 0;
  while (a < through.length && !leaning(a)) a++;
  let b = a;
  while (b < through.length && leaning(b)) b++;
  let c = b;
  while (c < through.length && !leaning(c)) c++;
  const phased = a < through.length && b < through.length && c < through.length;

  const stages: StageDraft[] = [
    {
      id: 'tip',
      name: `Tip it ${Math.abs(bestRoll) < 90 ? `${90 - Math.abs(bestRoll)} degrees short of` : 'onto'} its side`,
      nameHe: Math.abs(bestRoll) < 90 ? `להטות אותה ${90 - Math.abs(bestRoll)} מעלות לפני הצד` : 'להטות אותה על הצד',
      waypoints: tip(item, fine.xs[0]!, fine.ys[0]!, 0, bestRoll),
    },
  ];
  if (phased) {
    stages.push(
      {
        id: 'lean-in',
        name: 'Lean the leading end into the doorway and straighten as it clears',
        nameHe: 'להטות את הקצה המוביל לתוך הפתח וליישר כשהוא עובר',
        waypoints: through.slice(0, b + 1),
      },
      {
        id: 'carry',
        name: 'Carry the middle through level',
        nameHe: 'להעביר את האמצע ישר',
        waypoints: through.slice(b, c + 1),
      },
      {
        id: 'lean-out',
        name: 'Lean the trailing end through and straighten in the room',
        nameHe: 'להטות את הקצה האחורי דרך הפתח וליישר בחדר',
        waypoints: through.slice(c),
      },
    );
  } else {
    stages.push({
      id: 'lean-through',
      name: 'Lean it through the doorway, straightening as it goes',
      nameHe: 'להטות אותה דרך הפתח וליישר תוך כדי',
      waypoints: through,
    });
  }
  const last = through[through.length - 1]!;
  stages.push({
    id: 'set-down',
    name: 'Stand it back up in the room',
    nameHe: 'להחזיר אותה לעמידה בחדר',
    waypoints: tip(item, last.x, last.y, bestRoll, 0),
  });
  return stages;
}

export const LEAN_AND_STRAIGHTEN: ManeuverTemplate = {
  id: 'lean-and-straighten',
  name: 'Lean into the doorway and straighten inside it',
  nameHe: 'להטות לתוך הפתח וליישר בתוכו',
  // Measured to fail behind a 40 cm wall; the requirement is claimed only for
  // the wall it was built behind, and the result says so.
  wallSensitive: true,
  build(item, wallThickness) {
    let byWall = memo.get(item.item);
    if (byWall === undefined) {
      byWall = new Map();
      memo.set(item.item, byWall);
    }
    if (!byWall.has(wallThickness)) byWall.set(wallThickness, stagesFor(item, wallThickness));
    const stages = byWall.get(wallThickness);
    return stages?.map((stage) => ({ ...stage, waypoints: stage.waypoints.map((p) => ({ ...p })) }));
  },
};
