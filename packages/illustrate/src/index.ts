/**
 * @fitpath/illustrate — a picture of an item, drawn from its box model.
 *
 * The demo's six sofas shared one hand-drawn placeholder for three rounds,
 * because a hand-drawn picture is a thing somebody has to draw six times and
 * keep in step with six models. This draws it from the model instead: the same
 * boxes the collider tests, projected onto a page. When the model changes, the
 * picture changes with it, and a picture that disagreed with the geometry
 * would be impossible rather than merely unlikely.
 *
 * Orthographic three-quarter view, flat shading by face normal, painter's
 * ordering by face depth. No DOM: the output is a string, so it runs in Node at
 * build time and is committed as an asset like any other.
 */
import { itemWorldBoxes, unionAabb } from '@fitpath/engine';
import type { Item, Placement, Vec3, WorldBox } from '@fitpath/engine';

export interface IllustrateOptions {
  /** Output size, in SVG user units. Defaults match the demo's product cards. */
  width?: number;
  height?: number;
  /** Margin around the item as a fraction of the shorter side. */
  padding?: number;
  /** Accessible name. Defaults to the item's own. */
  label?: string;
  /** Draw the floor shadow. On by default; off for a transparent thumbnail. */
  shadow?: boolean;
  /** Background fill, or `'none'`. */
  background?: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * What a part is made of, read off its label.
 *
 * Boxes carry the name a person would use, and that name is the only thing the
 * model records about material. Legs, plinths and mechanism housings read as
 * wood and steel; everything else is upholstery. A removable part is drawn as
 * hardware whatever it is called, because "the thing that unscrews" is the one
 * distinction the picture most needs to make.
 */
const HARDWARE = /leg|plinth|base|foot|feet|housing|frame|mechanism|connector|rail/i;

const UPHOLSTERY: Rgb = { r: 0xbe, g: 0xb3, b: 0xa4 };
const UPHOLSTERY_BACK: Rgb = { r: 0xcb, g: 0xc2, b: 0xb5 };
const HARDWARE_COLOUR: Rgb = { r: 0x5c, g: 0x4a, b: 0x38 };

/** Looking down from the front-right, the way a product photo is taken. */
const CAMERA_FROM: Vec3 = { x: 0.78, y: -1, z: 0.62 };
/** Key light from high front-left, so the top is brightest and the right side falls off. */
const LIGHT_FROM: Vec3 = { x: -0.35, y: -0.55, z: 1.25 };

const normalise = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

interface Frame {
  /** Unit vector from the scene toward the camera. */
  toCamera: Vec3;
  right: Vec3;
  up: Vec3;
}

function frame(): Frame {
  const toCamera = normalise(CAMERA_FROM);
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 };
  const right = normalise(cross(worldUp, toCamera));
  const up = cross(toCamera, right);
  return { toCamera, right, up };
}

interface Projected {
  x: number;
  y: number;
  /** Distance toward the camera; larger is nearer. */
  depth: number;
}

function project(p: Vec3, f: Frame): Projected {
  return { x: dot(p, f.right), y: -dot(p, f.up), depth: dot(p, f.toCamera) };
}

interface Face {
  points: Projected[];
  depth: number;
  fill: string;
  stroke: string;
}

function shade(base: Rgb, normal: Vec3, light: Vec3): { fill: string; stroke: string } {
  // Lambert against the key, with a floor so a face turned away is dim rather
  // than black: a product picture is lit from everywhere.
  const lambert = Math.max(0, dot(normal, light));
  const level = 0.54 + 0.46 * lambert;
  const channel = (v: number): number => Math.round(Math.min(255, v * level));
  const hex = (v: number): string => v.toString(16).padStart(2, '0');
  const fill = `#${hex(channel(base.r))}${hex(channel(base.g))}${hex(channel(base.b))}`;
  const stroke = `#${hex(channel(base.r * 0.72))}${hex(channel(base.g * 0.72))}${hex(channel(base.b * 0.72))}`;
  return { fill, stroke };
}

/** The faces of a world box that look toward the camera, and their shading. */
function facesOf(box: WorldBox, base: Rgb, f: Frame, light: Vec3): Face[] {
  const out: Face[] = [];
  const he = [box.halfExtents.x, box.halfExtents.y, box.halfExtents.z] as const;
  for (let axis = 0; axis < 3; axis++) {
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    for (const sign of [1, -1] as const) {
      const normal = scale(box.axes[axis]!, sign);
      // Back faces are not drawn. This is what painter's ordering needs to work
      // on a convex box, and every box is convex.
      if (dot(normal, f.toCamera) <= 1e-9) continue;
      const centre = add(box.center, scale(normal, he[axis]!));
      const eb = scale(box.axes[b]!, he[b]!);
      const ec = scale(box.axes[c]!, he[c]!);
      const corners = [
        add(add(centre, eb), ec),
        add(add(centre, scale(eb, -1)), ec),
        add(add(centre, scale(eb, -1)), scale(ec, -1)),
        add(add(centre, eb), scale(ec, -1)),
      ];
      const points = corners.map((p) => project(p, f));
      const depth = points.reduce((sum, p) => sum + p.depth, 0) / points.length;
      out.push({ points, depth, ...shade(base, normal, light) });
    }
  }
  return out;
}

function baseColour(item: Item, index: number): Rgb {
  const box = item.boxes[index]!;
  for (const part of item.removableParts ?? []) {
    if (part.boxIndices.includes(index)) return HARDWARE_COLOUR;
  }
  const label = box.label ?? '';
  if (HARDWARE.test(label)) return HARDWARE_COLOUR;
  if (/back/i.test(label)) return UPHOLSTERY_BACK;
  return UPHOLSTERY;
}

const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

/**
 * Draw the item.
 *
 * Deterministic: the same boxes give the same string, byte for byte, which is
 * what lets the output be committed and diffed like source.
 */
export function illustrate(item: Item, options: IllustrateOptions = {}): string {
  const width = options.width ?? 800;
  const height = options.height ?? 520;
  const padding = options.padding ?? 0.1;
  const label = options.label ?? `${item.name}, drawn from its box model`;
  const shadow = options.shadow ?? true;
  const background = options.background ?? 'none';

  // Stood on the floor, so the shadow lands under the legs rather than under
  // the body's origin. The origin convention puts a sofa's origin at the top of
  // its legs.
  const origin: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const rest = -unionAabb(itemWorldBoxes(item, origin)).minZ;
  const placement: Placement = { ...origin, z: rest };
  const boxes = itemWorldBoxes(item, placement);

  const f = frame();
  const light = normalise(LIGHT_FROM);

  const faces: Face[] = [];
  boxes.forEach((box, index) => faces.push(...facesOf(box, baseColour(item, index), f, light)));
  // Far to near. Ties broken by insertion order, which is box order, which is
  // the author's order — stable, and the same on every machine.
  faces.sort((a, b) => a.depth - b.depth);

  // The footprint on the floor, for the shadow and for framing.
  const aabb = unionAabb(boxes);
  const floor = [
    { x: aabb.minX, y: aabb.minY, z: 0 },
    { x: aabb.maxX, y: aabb.minY, z: 0 },
    { x: aabb.maxX, y: aabb.maxY, z: 0 },
    { x: aabb.minX, y: aabb.maxY, z: 0 },
  ].map((p) => project(p, f));

  const all = [...faces.flatMap((face) => face.points), ...floor];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = Math.min(width, height) * padding;
  const k = Math.min((width - 2 * pad) / (maxX - minX), (height - 2 * pad) / (maxY - minY));
  const offsetX = (width - k * (maxX - minX)) / 2 - k * minX;
  const offsetY = (height - k * (maxY - minY)) / 2 - k * minY;
  const toPage = (p: Projected): string => `${fmt(offsetX + k * p.x)},${fmt(offsetY + k * p.y)}`;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">`,
  );
  if (background !== 'none') {
    parts.push(`<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>`);
  }
  if (shadow) {
    parts.push(
      '<defs><filter id="fp-shadow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="9"/></filter></defs>',
      `<polygon points="${floor.map(toPage).join(' ')}" fill="#000" opacity="0.13" filter="url(#fp-shadow)"/>`,
    );
  }
  for (const face of faces) {
    parts.push(
      `<polygon points="${face.points.map(toPage).join(' ')}" fill="${face.fill}" stroke="${face.stroke}" stroke-width="0.8" stroke-linejoin="round"/>`,
    );
  }
  parts.push('</svg>');
  return parts.join('\n');
}
