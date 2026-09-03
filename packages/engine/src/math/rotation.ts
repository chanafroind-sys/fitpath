import type { Rotation, Vec3 } from '../types.ts';

/**
 * A rotation as its three column vectors: the world directions of the rotated
 * frame's local +X, +Y and +Z.
 *
 * Columns rather than rows because that is what both consumers want: SAT needs
 * the box's own axes as world directions, and transforming a local point is
 * just the columns scaled by the point's components. Storing rows would make
 * every use site transpose.
 */
export type Mat3 = readonly [Vec3, Vec3, Vec3];

export const IDENTITY: Mat3 = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

export function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Build R = Rz(yaw) * Ry(pitch) * Rx(roll), returned as its columns.
 *
 * The composition order is the whole reason this function exists rather than
 * three separate rotations at each call site: yaw must be outermost so that it
 * rotates the already-pitched item about the *world* vertical. Applying yaw
 * first would rotate about the item's own tilted axis, which is not what
 * "turn it round" means to someone carrying a sofa.
 */
export function rotationMatrix(yaw: number, pitch: number, roll: number): Mat3 {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cb = Math.cos(pitch);
  const sb = Math.sin(pitch);
  const cg = Math.cos(roll);
  const sg = Math.sin(roll);

  return [
    { x: ca * cb, y: sa * cb, z: -sb },
    { x: ca * sb * sg - sa * cg, y: sa * sb * sg + ca * cg, z: cb * sg },
    { x: ca * sb * cg + sa * sg, y: sa * sb * cg - ca * sg, z: cb * cg },
  ];
}

export function rotationFrom(rotation: Rotation): Mat3 {
  return rotationMatrix(rotation.yaw, rotation.pitch, rotation.roll);
}

/**
 * Compose two rotations: the result applies `b` first, then `a`.
 *
 * Used to fold a box's own orientation inside the item (a backrest pitched 12
 * degrees) into the item's placement, so the rest of the pipeline only ever
 * sees a single world-space orientation per box.
 */
export function multiply(a: Mat3, b: Mat3): Mat3 {
  return [transform(a, b[0]), transform(a, b[1]), transform(a, b[2])];
}

/** Rotate a vector by the matrix: a linear combination of the columns. */
export function transform(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0].x * v.x + m[1].x * v.y + m[2].x * v.z,
    y: m[0].y * v.x + m[1].y * v.y + m[2].y * v.z,
    z: m[0].z * v.x + m[1].z * v.y + m[2].z * v.z,
  };
}

/**
 * Wrap an angle into [0, 2*PI).
 *
 * Yaw is periodic, so the lattice must treat 350 degrees and -10 degrees as the
 * same node; otherwise the search would happily walk off to yaw = 700 degrees
 * and the "same input, same output" guarantee would depend on which way a path
 * happened to spiral.
 */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/**
 * Shortest signed difference `to - from`, in (-PI, PI].
 *
 * Step descriptions must say "rotate 20 degrees clockwise", never "rotate 340
 * degrees counter-clockwise", and smoothing must interpolate the short way
 * round for the same reason.
 */
export function angleDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let d = (to - from) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d <= -Math.PI) d += twoPi;
  return d;
}
