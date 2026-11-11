/**
 * The README's figures, drawn from the measurement rather than by hand.
 *
 * `docs/doorway.svg` is the whole project in one picture: a doorway 82.7 cm
 * wide, the three-seater's section through that wall at the tightest instant
 * of the lean maneuver — the real one, read out of the path the widget ships —
 * and, dashed behind it, the 95 cm the same sofa presents when it is carried
 * in level and does not go.
 *
 * Nothing here is geometry of its own. The placements come from the shipped
 * path, the section comes from the engine's own `slabSection`, and the
 * silhouette is the item's boxes clipped to the wall slab with the engine's
 * `itemWorldBoxes`. Run it with `node docs/make-figures.ts` after a rebuild.
 */
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFA_3_SEAT, interpolate, itemWorldBoxes, prepareItem, slabSection } from '../packages/engine/src/index.ts';
import type { Placement, Vec3 } from '../packages/engine/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** The wall the shipped library's first level is measured behind. */
const WALL = 12;
const PATH_KEY = `lean-and-straighten@${WALL}`;

const paths = JSON.parse(readFileSync(resolve(root, 'apps/widget/public/data/sofa-3-seat.paths.json'), 'utf8')) as Record<
  string,
  Record<string, Placement[]>
>;
const lean = paths['sofa-3-seat']?.[PATH_KEY];
if (lean === undefined) throw new Error(`no ${PATH_KEY} in the shipped paths; run the widget precompute first`);

const item = prepareItem(SOFA_3_SEAT);

/** Every placement along the path, finely enough that the widest instant is not missed. */
function* samples(path: readonly Placement[], per = 60): Generator<Placement> {
  for (let i = 0; i + 1 < path.length; i++) {
    for (let s = 0; s <= per; s++) yield interpolate(path[i]!, path[i + 1]!, s / per);
  }
}

/** The instant the motion presents its widest section to the wall: what the doorway has to be. */
let widest: { placement: Placement; width: number; top: number } | undefined;
for (const placement of samples(lean)) {
  const section = slabSection(item, placement, 0, WALL);
  if (section === undefined) continue;
  const width = section.maxX - section.minX;
  if (widest === undefined || width > widest.width) {
    widest = { placement, width, top: section.maxZ };
  }
}
if (widest === undefined) throw new Error('the path never crosses the wall');

const CORNER_SIGNS: readonly [number, number, number][] = [
  [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
  [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
];
const EDGES: readonly [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if ([1, 2, 4].includes(i ^ j)) out.push([i, j]);
  return out;
})();

interface Pt {
  x: number;
  z: number;
}

/**
 * One box's silhouette in the doorway plane: its corners that lie inside the
 * wall slab, plus where its edges cross the slab's two faces. The box is
 * convex, so the convex hull of those points is exactly the shadow it casts
 * through the opening.
 */
function silhouette(placement: Placement, minY: number, maxY: number): Pt[][] {
  const out: Pt[][] = [];
  for (const box of itemWorldBoxes(item, placement)) {
    if (box.aabbMax.y < minY || box.aabbMin.y > maxY) continue;
    const [ax, ay, az] = box.axes as [Vec3, Vec3, Vec3];
    const h = box.halfExtents;
    const corners: Vec3[] = CORNER_SIGNS.map(([sx, sy, sz]) => ({
      x: box.center.x + sx * ax.x * h.x + sy * ay.x * h.y + sz * az.x * h.z,
      y: box.center.y + sx * ax.y * h.x + sy * ay.y * h.y + sz * az.y * h.z,
      z: box.center.z + sx * ax.z * h.x + sy * ay.z * h.y + sz * az.z * h.z,
    }));
    const points: Pt[] = [];
    for (const c of corners) if (c.y >= minY && c.y <= maxY) points.push({ x: c.x, z: c.z });
    for (const [i, j] of EDGES) {
      const a = corners[i]!;
      const b = corners[j]!;
      for (const plane of [minY, maxY]) {
        const da = a.y - plane;
        const db = b.y - plane;
        if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
        const t = da / (da - db);
        if (t < 0 || t > 1) continue;
        points.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
      }
    }
    const hull = convexHull(points);
    if (hull.length >= 3) out.push(hull);
  }
  return out;
}

/** Andrew's monotone chain, counter-clockwise. */
function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (input: Pt[]): Pt[] => {
    const stack: Pt[] = [];
    for (const p of input) {
      while (stack.length >= 2 && cross(stack[stack.length - 2]!, stack[stack.length - 1]!, p) <= 1e-9) stack.pop();
      stack.push(p);
    }
    stack.pop();
    return stack;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/* ------------------------------------------------------------------------ */

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * The opening is the one the widget publishes, not a re-measurement: the
 * library measures at 0.25 cm and this file samples more coarsely, so quoting
 * its own number would print a doorway a hair narrower than the product
 * claims. The silhouette below is the widest instant this sampling found,
 * which is inside that opening by construction.
 */
const product = JSON.parse(readFileSync(resolve(root, 'apps/widget/public/data/sofa-3-seat.json'), 'utf8')) as {
  assembled: { maneuvers: { templateId: string; variants: { wallCm: number; need: { doorWidth: number; doorHeight: number } }[] }[] };
};
const shipped = product.assembled.maneuvers
  .find((m) => m.templateId === 'lean-and-straighten')
  ?.variants.find((v) => v.wallCm === WALL)?.need;
if (shipped === undefined) throw new Error('the shipped data has no lean behind this wall');
const DOOR_W = Math.ceil(shipped.doorWidth * 100) / 100;
const DOOR_H = Math.ceil(shipped.doorHeight * 100) / 100;
if (widest.width > DOOR_W + 1e-6 || widest.top > DOOR_H + 1e-6) {
  throw new Error(`the drawn instant (${f(widest.width)} x ${f(widest.top)}) does not fit the published opening`);
}
/** What the same sofa presents carried in level: its depth by its height. */
const LEVEL_W = 95;
const LEVEL_H = 85;

const SCALE = 2.45;
const PAD_X = 150;
const PAD_TOP = 128;
const PAD_BOTTOM = 112;
const WALL_W = Math.max(DOOR_W, LEVEL_W) * SCALE + PAD_X * 2;
const WALL_H = DOOR_H * SCALE + PAD_TOP + PAD_BOTTOM;
const W = Math.round(WALL_W);
const H = Math.round(WALL_H);

/** Centre of the opening in SVG pixels; cm x grows right, cm z grows up. */
const cx = W / 2;
const floor = PAD_TOP + DOOR_H * SCALE;
const px = (x: number): number => cx + x * SCALE;
const py = (z: number): number => floor - z * SCALE;

const openLeft = px(-DOOR_W / 2);
const openRight = px(DOOR_W / 2);
const openTop = py(DOOR_H);

const polygons = silhouette(widest.placement, 0, WALL)
  .map((hull) => `    <polygon points="${hull.map((p) => `${f(px(p.x))},${f(py(p.z))}`).join(' ')}" />`)
  .join('\n');

const levelLeft = px(-LEVEL_W / 2);
const levelW = LEVEL_W * SCALE;
const levelH = LEVEL_H * SCALE;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
  aria-label="A doorway ${f(DOOR_W)} cm wide with the three-seat sofa's section through the wall drawn inside it, and the 95 cm it presents carried level drawn dashed and overflowing the opening.">
  <style>
    .wall { fill: #e8e4da; }
    .open { fill: #fbfaf7; }
    .jamb { fill: none; stroke: #c3bdaf; stroke-width: 2; }
    .sofa { fill: #d4692b; fill-opacity: .92; }
    .level { fill: #b4513a; fill-opacity: .07; stroke: #b4513a; stroke-width: 2.5; stroke-dasharray: 9 7; }
    .dim { stroke: #5c635f; stroke-width: 1.5; }
    .tick { stroke: #5c635f; stroke-width: 1.5; }
    text { font-family: "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif; fill: #1d211f; }
    .n { font-size: 26px; font-weight: 700; }
    .k { font-size: 16px; fill: #5c635f; }
    .tag { font-size: 16px; font-weight: 700; }
  </style>

  <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="#faf9f6" />
  <rect x="26" y="${f(PAD_TOP - 34)}" width="${W - 52}" height="${f(DOOR_H * SCALE + 34)}" rx="10" class="wall" />
  <rect x="${f(openLeft)}" y="${f(openTop)}" width="${f(DOOR_W * SCALE)}" height="${f(DOOR_H * SCALE)}" class="open" />
  <rect x="${f(openLeft)}" y="${f(openTop)}" width="${f(DOOR_W * SCALE)}" height="${f(DOOR_H * SCALE)}" class="jamb" />

  <!-- carried in level: the section it presents when nobody tilts it -->
  <rect x="${f(levelLeft)}" y="${f(floor - levelH)}" width="${f(levelW)}" height="${f(levelH)}" class="level" />
  <line class="dim" x1="${f(levelLeft)}" y1="${f(PAD_TOP - 54)}" x2="${f(levelLeft + levelW)}" y2="${f(PAD_TOP - 54)}" stroke="#b4513a" />
  <line class="tick" x1="${f(levelLeft)}" y1="${f(PAD_TOP - 62)}" x2="${f(levelLeft)}" y2="${f(PAD_TOP - 46)}" stroke="#b4513a" />
  <line class="tick" x1="${f(levelLeft + levelW)}" y1="${f(PAD_TOP - 62)}" x2="${f(levelLeft + levelW)}" y2="${f(PAD_TOP - 46)}" stroke="#b4513a" />
  <text class="k" x="${f(cx)}" y="${f(PAD_TOP - 74)}" text-anchor="middle" fill="#b4513a">carried level it is ${LEVEL_W} cm across — wider than the opening</text>

  <!-- the measured section of the lean, at the instant it is widest -->
  <g class="sofa">
${polygons}
  </g>

  <!-- the opening, measured -->
  <line class="dim" x1="${f(openLeft)}" y1="${f(floor + 34)}" x2="${f(openRight)}" y2="${f(floor + 34)}" />
  <line class="tick" x1="${f(openLeft)}" y1="${f(floor + 26)}" x2="${f(openLeft)}" y2="${f(floor + 42)}" />
  <line class="tick" x1="${f(openRight)}" y1="${f(floor + 26)}" x2="${f(openRight)}" y2="${f(floor + 42)}" />
  <text class="n" x="${f(cx)}" y="${f(floor + 70)}" text-anchor="middle">${f(DOOR_W)} cm</text>

  <line class="dim" x1="${f(openRight + 30)}" y1="${f(openTop)}" x2="${f(openRight + 30)}" y2="${f(floor)}" />
  <line class="tick" x1="${f(openRight + 22)}" y1="${f(openTop)}" x2="${f(openRight + 38)}" y2="${f(openTop)}" />
  <line class="tick" x1="${f(openRight + 22)}" y1="${f(floor)}" x2="${f(openRight + 38)}" y2="${f(floor)}" />
  <text class="k" x="${f(openRight + 46)}" y="${f((openTop + floor) / 2)}">${f(DOOR_H)} cm</text>

  <text class="tag" x="26" y="34" fill="#1f6f5c">the lean, measured · 3-seat sofa, 220 × 95 × 85 cm</text>
  <text class="k" x="26" y="${f(H - 20)}">the section the sofa presents while it crosses a ${WALL} cm wall, at the widest instant of the motion the widget ships</text>
</svg>
`;

writeFileSync(resolve(root, 'docs/doorway.svg'), svg);
console.log(`doorway.svg: opening ${f(DOOR_W)} × ${f(DOOR_H)} cm, level section ${LEVEL_W} × ${LEVEL_H} cm`);

/**
 * The product pictures the README shows, copied beside it from the demo's
 * build output. They are drawn by `@fitpath/illustrate` from the very boxes
 * the collision test uses, so a sofa that changed shape would change its own
 * picture; copying rather than redrawing keeps that true.
 */
const drawn = resolve(root, 'apps/demo/src/assets/generated');
const pictures = readdirSync(drawn).filter((name) => name.endsWith('.svg'));
for (const name of pictures) {
  copyFileSync(resolve(drawn, name), resolve(root, 'docs', name));
}
console.log(`copied ${pictures.length} product drawings into docs/`);
