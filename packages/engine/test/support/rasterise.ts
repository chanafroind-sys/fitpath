/**
 * Render a hand-authored fixture to the elevation a shop would photograph.
 *
 * This is the ground truth for the image stage. The fixtures are the only place
 * in this repository where the real geometry of a sofa is known exactly, so the
 * only honest way to ask "does the silhouette measurement recover the leg band"
 * is to draw the fixture, measure the drawing, and compare against the boxes it
 * was drawn from.
 *
 * What it produces is a *better* image than any shop will ever supply:
 * orthographic, perfectly lit, perfectly aligned, hard-edged. That is the point
 * and also the limitation — the error it measures is the quantisation floor, not
 * the error a real photograph carries. `IMAGE_MEASUREMENT_TOLERANCE_CM` says
 * which terms this harness cannot reach.
 */

import type { Box, Item, Vec3 } from '../../src/types.ts';
import type { Bitmap } from '../../src/sourcing/silhouette.ts';
import { rotationFrom } from '../../src/math/rotation.ts';
import { itemAabb } from './occupancy.ts';

/** Which way the camera faces. `front` looks along +Y, `side` looks along +X. */
export type Elevation = 'front' | 'side';

export interface RenderOptions {
  /** Pixels across the item's own width. Height follows from the aspect ratio. */
  pixelsAcross?: number;
  /** Background luminance, as a sweep would be. */
  background?: number;
  /** Item luminance. */
  foreground?: number;
  /**
   * Blur radius in pixels applied at the silhouette edge.
   *
   * Zero is a hard edge, which no photograph has. One or two pixels stands in
   * for anti-aliasing and a soft studio edge, and is how the threshold's
   * sensitivity gets measured rather than argued about.
   */
  edgeSoftnessPx?: number;
  /** Blank margin around the item, in pixels. A shop never crops to the item exactly. */
  marginPx?: number;
}

/** The 2-D convex polygon a box casts on the elevation plane. */
function projectBox(box: Box, elevation: Elevation): { u: number; v: number }[] {
  const m = rotationFrom(box.rotation);
  const h = box.halfExtents;
  const points: { u: number; v: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p: Vec3 = {
          x: box.center.x + m[0].x * sx * h.x + m[1].x * sy * h.y + m[2].x * sz * h.z,
          y: box.center.y + m[0].y * sx * h.x + m[1].y * sy * h.y + m[2].y * sz * h.z,
          z: box.center.z + m[0].z * sx * h.x + m[1].z * sy * h.y + m[2].z * sz * h.z,
        };
        // Looking along the depth axis, so it drops out: what remains is the
        // shape a light behind the sofa would throw on the wall.
        points.push({ u: elevation === 'front' ? p.x : p.y, v: p.z });
      }
    }
  }
  return convexHull(points);
}

/** Monotone chain. Eight projected corners, so the cost of doing it properly is nothing. */
function convexHull(points: readonly { u: number; v: number }[]): { u: number; v: number }[] {
  const sorted = [...points].sort((a, b) => a.u - b.u || a.v - b.v);
  const cross = (
    o: { u: number; v: number },
    a: { u: number; v: number },
    b: { u: number; v: number },
  ): number => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);

  const build = (input: readonly { u: number; v: number }[]): { u: number; v: number }[] => {
    const out: { u: number; v: number }[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

function insidePolygon(polygon: readonly { u: number; v: number }[], u: number, v: number): boolean {
  // Convex and counter-clockwise by construction, so "left of every edge" is it.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if ((b.u - a.u) * (v - a.v) - (b.v - a.v) * (u - a.u) < -1e-9) return false;
  }
  return true;
}

/**
 * Draw an item's elevation as a greyscale bitmap.
 *
 * The item is placed with its own bounds filling the frame minus the margin, in
 * centimetres, so a pixel is a known number of centimetres and every measurement
 * taken from the result is a fraction of the item rather than of the frame.
 */
export function renderElevation(item: Item, elevation: Elevation, options: RenderOptions = {}): Bitmap {
  const pixelsAcross = options.pixelsAcross ?? 600;
  const background = options.background ?? 235;
  const foreground = options.foreground ?? 40;
  const softness = options.edgeSoftnessPx ?? 0;
  const margin = options.marginPx ?? 20;

  const bounds = itemAabb(item);
  const acrossCm = elevation === 'front' ? bounds.max.x - bounds.min.x : bounds.max.y - bounds.min.y;
  const upCm = bounds.max.z - bounds.min.z;
  const cmPerPixel = acrossCm / pixelsAcross;
  const pixelsUp = Math.round(upCm / cmPerPixel);

  const width = pixelsAcross + margin * 2;
  const height = pixelsUp + margin * 2;
  const originU = elevation === 'front' ? bounds.min.x : bounds.min.y;

  const polygons = item.boxes.map((box) => projectBox(box, elevation));

  // Supersample, so a soft edge is a real gradient rather than a staircase. Four
  // samples per axis is plenty for a shape made of straight lines.
  const samples = 4;
  const coverage = new Float64Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = originU + (px - margin + (sx + 0.5) / samples) * cmPerPixel;
          // Screen y runs down; the item's z runs up.
          const v = bounds.max.z - (py - margin + (sy + 0.5) / samples) * cmPerPixel;
          if (polygons.some((polygon) => insidePolygon(polygon, u, v))) hits += 1;
        }
      }
      coverage[py * width + px] = hits / (samples * samples);
    }
  }

  if (softness > 0) blur(coverage, width, height, softness);

  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = Math.round(background + (foreground - background) * coverage[i]!);
  }
  return { width, height, luma };
}

/** A separable box blur, repeated, which is close enough to a lens for this purpose. */
function blur(field: Float64Array, width: number, height: number, radius: number): void {
  const r = Math.max(1, Math.round(radius));
  const scratch = new Float64Array(field.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= width) continue;
          sum += field[y * width + xx]!;
          n += 1;
        }
        scratch[y * width + x] = sum / n;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= height) continue;
          sum += scratch[yy * width + x]!;
          n += 1;
        }
        field[y * width + x] = sum / n;
      }
    }
  }
}

/** What the fixture's own boxes say the leg band is, for comparison with the measurement. */
export function trueLegBand(item: Item): { heightCm: number; insetXCm: number; insetYCm: number } | undefined {
  const legs = item.boxes.filter((box) => box.label === 'the legs');
  if (legs.length === 0) return undefined;
  const bounds = itemAabb(item);

  let top = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const leg of legs) {
    top = Math.max(top, leg.center.z + leg.halfExtents.z);
    minX = Math.min(minX, leg.center.x - leg.halfExtents.x);
    maxX = Math.max(maxX, leg.center.x + leg.halfExtents.x);
    minY = Math.min(minY, leg.center.y - leg.halfExtents.y);
    maxY = Math.max(maxY, leg.center.y + leg.halfExtents.y);
  }

  return {
    heightCm: top - bounds.min.z,
    insetXCm: Math.min(minX - bounds.min.x, bounds.max.x - maxX),
    insetYCm: Math.min(minY - bounds.min.y, bounds.max.y - maxY),
  };
}
