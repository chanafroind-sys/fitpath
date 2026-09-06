/**
 * Three.js objects built from the engine's geometry, and from nothing else.
 *
 * Two conventions make that possible without a single coordinate conversion in
 * the drawing code:
 *
 *  - Everything lives inside one group rotated -90 degrees about X, which maps
 *    the engine's frame (X/Y on the floor, Z up) onto Three's (Y up) exactly.
 *    So every position, half-extent and rotation below is an engine number
 *    written out verbatim.
 *  - Orientations come from the engine's own `rotationMatrix`, whose Mat3 is
 *    three columns — the world directions of the body's local X, Y and Z —
 *    which is precisely a Three basis matrix.
 *
 * What this file DOES decide is presentation: which solids to draw, how tall to
 * draw them, and what colour they are. The engine closes its scenes with 50 cm
 * slabs for floor, ceiling and outer walls; drawn literally they would box the
 * camera into an opaque cube. So solids are cropped to a viewing box and the
 * ones that are not the doorway are cut down to knee height. Cropping changes
 * what is visible, never what was planned.
 */
import * as THREE from 'three';
import { rotationMatrix } from '@fitpath/engine';
import type { AxisBox, Environment, Item, Placement, WorldBox } from '@fitpath/engine';

export interface Palette {
  background: number;
  floorHallway: number;
  floorRoom: number;
  grid: number;
  wall: number;
  doorWall: number;
  item: number;
  removable: number;
  blocked: number;
  /** Silhouette line around the item, so it never dissolves into the wall behind it. */
  outline: number;
  outlineOpacity: number;
  accent: number;
  /** The key light, which gives the scene its shading. */
  keyIntensity: number;
  /** Sky and ground fill, which decides how dark a face turned away from the key goes. */
  fillIntensity: number;
  fillSky: number;
  fillGround: number;
  exposure: number;
}

/**
 * Two palettes, tuned by eye against the renderer rather than picked on paper —
 * and each carries its own lighting, which is the part that actually decides
 * how a scene reads.
 *
 * A room is mostly pale surfaces, and pale surfaces under any believable amount
 * of light converge on white, at which point the item, the wall it is passing
 * through and the floor it is standing on are all the same colour and the
 * picture says nothing. The dark theme has the opposite failure: turn the
 * intensities down and every face pointing away from the key goes to black.
 *
 * So the fill is deliberately strong relative to the key in both — enough
 * shading to read the shapes, never enough to lose a face entirely — and the
 * exposure is set per theme.
 */
export const LIGHT_PALETTE: Palette = {
  background: 0xe7e7e8,
  floorHallway: 0xbcc0c5,
  floorRoom: 0xd2d5d9,
  grid: 0x8b9198,
  wall: 0x99a0a7,
  doorWall: 0x7b838c,
  item: 0xc2600f,
  removable: 0x53290a,
  blocked: 0xa81b10,
  outline: 0x2a1a08,
  outlineOpacity: 0.4,
  accent: 0x1a6b58,
  keyIntensity: 1.25,
  fillIntensity: 1.75,
  fillSky: 0xf2f5f8,
  fillGround: 0xa89c88,
  exposure: 0.95,
};

export const DARK_PALETTE: Palette = {
  background: 0x0f1215,
  floorHallway: 0x2b323a,
  floorRoom: 0x1f242a,
  grid: 0x4a535d,
  wall: 0x39424c,
  doorWall: 0x4d5764,
  item: 0xf0a24b,
  removable: 0xffd89b,
  blocked: 0xe0574a,
  outline: 0x120b02,
  outlineOpacity: 0.55,
  accent: 0x3ec9a7,
  keyIntensity: 1.85,
  fillIntensity: 2.05,
  fillGround: 0x3f4a57,
  fillSky: 0xbcccdc,
  exposure: 1.0,
};

/** Height, in centimetres, that walls other than the doorway are cut down to. */
const KNEE = 55;

/** Intersect a solid's AABB with the viewing box. Returns undefined when nothing is left. */
function crop(solid: WorldBox, view: AxisBox): AxisBox | undefined {
  const out: AxisBox = {
    minX: Math.max(solid.aabbMin.x, view.minX),
    maxX: Math.min(solid.aabbMax.x, view.maxX),
    minY: Math.max(solid.aabbMin.y, view.minY),
    maxY: Math.min(solid.aabbMax.y, view.maxY),
    minZ: Math.max(solid.aabbMin.z, view.minZ),
    maxZ: Math.min(solid.aabbMax.z, view.maxZ),
  };
  if (out.maxX - out.minX < 0.5) return undefined;
  if (out.maxY - out.minY < 0.5) return undefined;
  if (out.maxZ - out.minZ < 0.5) return undefined;
  return out;
}

const centreOf = (b: AxisBox): THREE.Vector3 =>
  new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);

const sizeOf = (b: AxisBox): THREE.Vector3 =>
  new THREE.Vector3(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);

/** Everything the camera should be able to see, in engine coordinates. */
export function viewingBox(environment: Environment): AxisBox {
  const { hallway, room } = environment;
  return {
    minX: Math.min(hallway.minX, room.minX),
    maxX: Math.max(hallway.maxX, room.maxX),
    minY: hallway.minY,
    maxY: room.maxY,
    minZ: 0,
    maxZ: environment.params.ceilingHeight,
  };
}

export interface EnvironmentView {
  group: THREE.Group;
  /** The ceiling plane, faded in only when the item comes near it. */
  setCeilingOpacity(value: number): void;
  dispose(): void;
}

export function buildEnvironmentView(environment: Environment, palette: Palette): EnvironmentView {
  const group = new THREE.Group();
  const view = viewingBox(environment);
  const { wallThickness, ceilingHeight } = environment.params;
  const disposables: { dispose(): void }[] = [];

  const track = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  // --- floors, one per free volume, so hallway and room read as two places ---
  for (const [free, colour] of [
    [environment.hallway, palette.floorHallway],
    [environment.room, palette.floorRoom],
  ] as const) {
    const plane = new THREE.Mesh(
      track(new THREE.PlaneGeometry(free.maxX - free.minX, free.maxY - free.minY)),
      track(new THREE.MeshLambertMaterial({ color: colour })),
    );
    plane.position.set((free.minX + free.maxX) / 2, (free.minY + free.maxY) / 2, 0);
    plane.receiveShadow = true;
    group.add(plane);
  }

  // --- a metre grid, so the eye can measure ---
  const gridPoints: number[] = [];
  for (let x = Math.ceil(view.minX / 100) * 100; x <= view.maxX; x += 100) {
    gridPoints.push(x, view.minY, 0.4, x, view.maxY, 0.4);
  }
  for (let y = Math.ceil(view.minY / 100) * 100; y <= view.maxY; y += 100) {
    gridPoints.push(view.minX, y, 0.4, view.maxX, y, 0.4);
  }
  const gridGeometry = track(new THREE.BufferGeometry());
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  group.add(
    new THREE.LineSegments(
      gridGeometry,
      track(new THREE.LineBasicMaterial({ color: palette.grid, transparent: true, opacity: 0.55 })),
    ),
  );

  // --- solids ---
  const wallMaterial = track(new THREE.MeshLambertMaterial({ color: palette.wall }));
  const doorMaterial = track(new THREE.MeshLambertMaterial({ color: palette.doorWall }));

  for (const solid of environment.solids) {
    // A solid belongs to the doorway wall when it lies inside the wall slab.
    // That is read off the engine's own parameters, not guessed from an index.
    const inWallSlab = solid.aabbMin.y >= -0.001 && solid.aabbMax.y <= wallThickness + 0.001;
    const cropped = crop(
      solid,
      inWallSlab ? view : { ...view, maxZ: Math.min(KNEE, ceilingHeight) },
    );
    if (cropped === undefined) continue;
    const extent = sizeOf(cropped);
    const mesh = new THREE.Mesh(
      track(new THREE.BoxGeometry(extent.x, extent.y, extent.z)),
      inWallSlab ? doorMaterial : wallMaterial,
    );
    mesh.position.copy(centreOf(cropped));
    mesh.castShadow = inWallSlab;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- the ceiling, present but out of the way until it matters ---
  const ceilingMaterial = track(
    new THREE.MeshBasicMaterial({
      color: palette.accent,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const ceiling = new THREE.Mesh(
    track(new THREE.PlaneGeometry(view.maxX - view.minX, view.maxY - view.minY)),
    ceilingMaterial,
  );
  ceiling.position.set((view.minX + view.maxX) / 2, (view.minY + view.maxY) / 2, ceilingHeight);
  ceiling.visible = false;
  group.add(ceiling);

  return {
    group,
    setCeilingOpacity(value: number): void {
      ceilingMaterial.opacity = value * 0.4;
      ceiling.visible = value > 0.001;
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}

export interface ItemView {
  group: THREE.Group;
  setPlacement(placement: Placement): void;
  setColour(colour: number): void;
  dispose(): void;
}

/** Basis matrix from an engine rotation: its Mat3 columns are exactly a Three basis. */
function applyRotation(object: THREE.Object3D, yaw: number, pitch: number, roll: number): void {
  const [ex, ey, ez] = rotationMatrix(yaw, pitch, roll);
  object.setRotationFromMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(ex.x, ex.y, ex.z),
      new THREE.Vector3(ey.x, ey.y, ey.z),
      new THREE.Vector3(ez.x, ez.y, ez.z),
    ),
  );
}

export function buildItemView(item: Item, palette: Palette): ItemView {
  const group = new THREE.Group();
  const removable = new Set<number>();
  for (const part of item.removableParts ?? []) {
    for (const index of part.boxIndices) removable.add(index);
  }

  // Opaque, deliberately. A `transparent` material with opacity 1 still goes
  // down the blended path, and a solid sofa that renders as a faint smear is
  // not a sofa.
  const body = new THREE.MeshStandardMaterial({
    color: palette.item,
    roughness: 0.74,
    metalness: 0.02,
  });
  const parts = new THREE.MeshStandardMaterial({
    color: palette.removable,
    roughness: 0.55,
    metalness: 0.05,
  });

  const geometries: THREE.BufferGeometry[] = [];
  // The item has to read as the subject and the room as the setting. Colour
  // alone does not survive a wall of the same tone behind it at a shallow
  // angle, so the silhouette gets its own line.
  const outline = new THREE.LineBasicMaterial({
    color: palette.outline,
    transparent: true,
    opacity: palette.outlineOpacity,
  });

  for (const [index, box] of item.boxes.entries()) {
    const geometry = new THREE.BoxGeometry(
      box.halfExtents.x * 2,
      box.halfExtents.y * 2,
      box.halfExtents.z * 2,
    );
    geometries.push(geometry);

    const mesh = new THREE.Mesh(geometry, removable.has(index) ? parts : body);
    mesh.position.set(box.center.x, box.center.y, box.center.z);
    applyRotation(mesh, box.rotation.yaw, box.rotation.pitch, box.rotation.roll);
    mesh.castShadow = true;
    group.add(mesh);

    // A soft outline, so the silhouette stays legible against a wall of the
    // same tone — which is exactly what happens in the doorway.
    const edges = new THREE.EdgesGeometry(geometry);
    geometries.push(edges);
    const line = new THREE.LineSegments(edges, outline);
    line.position.copy(mesh.position);
    line.quaternion.copy(mesh.quaternion);
    group.add(line);
  }

  return {
    group,
    setPlacement(placement: Placement): void {
      group.position.set(placement.x, placement.y, placement.z);
      applyRotation(group, placement.yaw, placement.pitch, 0);
    },
    setColour(colour: number): void {
      body.color.setHex(colour);
      parts.color.setHex(colour);
    },
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      body.dispose();
      parts.dispose();
      outline.dispose();
    },
  };
}
