/**
 * One canvas: a room, an item, and a scrubbable maneuver.
 *
 * The whole scene sits inside a single group rotated -90 degrees about X, which
 * turns the engine's frame (X/Y on the floor, Z up) into Three's. Nothing
 * inside that group converts coordinates; the numbers are the engine's own.
 * The camera lives outside it, so `toThree` is the only place the mapping is
 * written down.
 *
 * All live viewers share one animation frame, and it is only scheduled when
 * something has actually changed. Three canvases each spinning their own
 * perpetual loop is three times the scheduling for a picture that is usually
 * identical to the last one — and a page that never goes idle.
 */
import * as THREE from 'three';
import { prepareItem } from '@fitpath/engine';
import type { Environment, Item, Placement, Vec3 } from '@fitpath/engine';
import {
  buildEnvironmentView,
  buildItemView,
  viewingBox,
  type EnvironmentView,
  type ItemView,
  type Palette,
} from './scene.ts';
import { buildTimeline, type Timeline } from './timeline.ts';

/** The engine's frame expressed in Three's. The inverse of the root group's rotation. */
const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.z, -v.y);

export interface SceneSetup {
  environment: Environment;
  item: Item;
  /** The maneuver. Absent when there is nothing to animate. */
  path?: readonly Placement[];
  /**
   * Where a replayed path stops, as a fraction of the timeline. Past this point
   * the item freezes and turns red: it is the first placement the engine's
   * collision test rejects in THIS scene.
   */
  haltAt?: number;
  /** Pose to show when there is no path at all. */
  pose?: Placement;
}

interface Orbit {
  radius: number;
  theta: number;
  phi: number;
}

/**
 * Looking down the corridor from behind and well above.
 *
 * High enough to see over the doorway wall into the room, because the wall is
 * drawn at its real height and the room behind it is where the maneuver ends.
 */
const DEFAULT_DIRECTION = new THREE.Vector3(0.16, 0.98, 1).normalize();
const MIN_PHI = 0.02;
const MAX_PHI = 1.42;

const live = new Set<Viewer>();
let frameHandle = 0;

function frame(): void {
  frameHandle = 0;
  let again = false;
  for (const viewer of live) {
    if (viewer.render()) again = true;
  }
  if (again) requestFrame();
}

/** Ask for one frame. Repeated calls before it runs collapse into that frame. */
function requestFrame(): void {
  if (frameHandle === 0) frameHandle = requestAnimationFrame(frame);
}

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly light: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly resizeObserver: ResizeObserver;

  private palette: Palette;
  private environmentView: EnvironmentView | undefined;
  private itemView: ItemView | undefined;
  private trail: THREE.Line | undefined;
  private marker: THREE.Object3D | undefined;
  private setup: SceneSetup | undefined;
  private timeline: Timeline | undefined;

  private target = new THREE.Vector3();
  private baseRadius = 500;
  private orbit: Orbit = { radius: 500, theta: 0, phi: 0.9 };
  private desired: Orbit = { radius: 500, theta: 0, phi: 0.9 };
  private up = new THREE.Vector3(0, 1, 0);
  private desiredUp = new THREE.Vector3(0, 1, 0);
  private fraction = 0;
  private dirty = true;
  private ceilingHeight = 250;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    palette: Palette,
  ) {
    this.palette = palette;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Without tone mapping the pale floors and walls clip to flat white and the
    // scene loses its shape. Exposure and both light intensities come from the
    // palette, because the level that reads well on a room full of near-white
    // surfaces is not the level that reads well on a dark one.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = palette.exposure;
    this.scene.background = new THREE.Color(palette.background);

    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
    this.scene.add(this.camera);

    this.hemisphere = new THREE.HemisphereLight(
      palette.fillSky,
      palette.fillGround,
      palette.fillIntensity,
    );
    this.scene.add(this.hemisphere);

    this.light = new THREE.DirectionalLight(0xfff4e6, palette.keyIntensity);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.light);
    this.scene.add(this.light.target);

    this.attachPointer();
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(canvas);

    live.add(this);
    this.invalidate();
  }

  /** Mark the picture stale and make sure a frame is coming. */
  private invalidate(): void {
    this.dirty = true;
    requestFrame();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.scene.background = new THREE.Color(palette.background);
    this.hemisphere.color.setHex(palette.fillSky);
    this.hemisphere.groundColor.setHex(palette.fillGround);
    this.hemisphere.intensity = palette.fillIntensity;
    this.light.intensity = palette.keyIntensity;
    this.renderer.toneMappingExposure = palette.exposure;
    if (this.setup !== undefined) this.setScene(this.setup);
  }

  setScene(setup: SceneSetup): void {
    this.setup = setup;
    this.clearScene();

    this.ceilingHeight = setup.environment.params.ceilingHeight;
    this.environmentView = buildEnvironmentView(setup.environment, this.palette);
    this.root.add(this.environmentView.group);

    this.itemView = buildItemView(setup.item, this.palette);
    this.root.add(this.itemView.group);

    if (setup.path !== undefined && setup.path.length > 0) {
      this.timeline = buildTimeline(setup.item, setup.path);
      this.trail = this.buildTrail(setup.path);
      this.root.add(this.trail);
      if (setup.haltAt !== undefined) {
        const halted = this.timeline.placementAt(setup.haltAt);
        this.marker = this.buildMarker(halted);
        this.root.add(this.marker);
      }
    } else {
      this.timeline = undefined;
    }

    this.frameCamera(setup.environment, setup.item);
    this.setFraction(this.fraction);
    this.invalidate();
  }

  /** Move to a point on the timeline, 0 to 1. */
  setFraction(fraction: number): void {
    this.fraction = Math.min(1, Math.max(0, fraction));
    const setup = this.setup;
    const itemView = this.itemView;
    if (setup === undefined || itemView === undefined) return;

    let placement: Placement | undefined;
    let blocked = false;

    if (this.timeline !== undefined) {
      const halt = setup.haltAt;
      if (halt !== undefined && this.fraction >= halt) {
        placement = this.timeline.placementAt(halt);
        blocked = true;
      } else {
        placement = this.timeline.placementAt(this.fraction);
      }
    } else if (setup.pose !== undefined) {
      placement = setup.pose;
    }

    if (placement === undefined) return;
    itemView.setPlacement(placement);
    itemView.setColour(blocked ? this.palette.blocked : this.palette.item);

    // The ceiling only exists visually when the item is about to meet it.
    if (this.environmentView !== undefined) {
      const box = new THREE.Box3().setFromObject(itemView.group);
      const headroom = this.ceilingHeight - box.max.y;
      this.environmentView.setCeilingOpacity(
        headroom < 30 ? Math.min(1, (30 - headroom) / 30) : 0,
      );
    }
    this.invalidate();
  }

  setTopDown(on: boolean): void {
    this.desired = on
      ? { radius: this.baseRadius * 1.05, theta: 0, phi: MIN_PHI }
      : {
          radius: this.baseRadius,
          theta: Math.atan2(DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.z),
          phi: Math.acos(DEFAULT_DIRECTION.y),
        };
    this.desiredUp = on ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    this.invalidate();
  }

  /**
   * Called from the shared frame loop. Renders only when something changed, and
   * says whether it needs another frame — which is true exactly while the
   * camera is still easing toward where it was asked to go.
   */
  render(): boolean {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return false;

    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== clientWidth || size.y !== clientHeight) {
      this.renderer.setSize(clientWidth, clientHeight, false);
      this.camera.aspect = clientWidth / clientHeight;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }

    const moving = this.easeCamera();
    if (!moving && !this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return moving;
  }

  dispose(): void {
    live.delete(this);
    this.resizeObserver.disconnect();
    this.clearScene();
    this.renderer.dispose();
  }

  // --- internals ----------------------------------------------------------

  private clearScene(): void {
    if (this.environmentView !== undefined) {
      this.root.remove(this.environmentView.group);
      this.environmentView.dispose();
      this.environmentView = undefined;
    }
    if (this.itemView !== undefined) {
      this.root.remove(this.itemView.group);
      this.itemView.dispose();
      this.itemView = undefined;
    }
    if (this.trail !== undefined) {
      this.root.remove(this.trail);
      this.trail.geometry.dispose();
      (this.trail.material as THREE.Material).dispose();
      this.trail = undefined;
    }
    if (this.marker !== undefined) {
      this.root.remove(this.marker);
      this.marker.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.marker = undefined;
    }
  }

  /** The route the item's origin takes, drawn on the floor. */
  private buildTrail(path: readonly Placement[]): THREE.Line {
    const timeline = buildTimeline(this.setup!.item, path);
    const points: number[] = [];
    const samples = 160;
    for (let i = 0; i <= samples; i++) {
      const p = timeline.placementAt(i / samples);
      points.push(p.x, p.y, 1.2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: this.palette.accent, transparent: true, opacity: 0.85 }),
    );
  }

  /** A ring on the floor where the replayed path first hits something. */
  private buildMarker(placement: Placement): THREE.Object3D {
    const group = new THREE.Group();
    // Drawn through whatever is in front of it. The caption says the stopping
    // point is marked on the floor, and the item that stopped there is usually
    // standing on top of it.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(26, 36, 48),
      new THREE.MeshBasicMaterial({
        color: this.palette.blocked,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.position.set(placement.x, placement.y, 1.6);
    ring.renderOrder = 10;
    group.add(ring);

    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(10, 24),
      new THREE.MeshBasicMaterial({
        color: this.palette.blocked,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
      }),
    );
    dot.position.set(placement.x, placement.y, 1.5);
    dot.renderOrder = 11;
    group.add(dot);
    return group;
  }

  private frameCamera(environment: Environment, item: Item): void {
    const view = viewingBox(environment);
    // Frame the corridor and the first stretch of the room. The room's far half
    // is real, and empty, and would only push the camera back.
    const near = Math.min(view.maxY, environment.params.wallThickness + 260);
    const width = Math.min(view.maxX - view.minX, 700);
    const depth = near - view.minY;
    const height = view.maxZ;

    // Aim at the doorway, not at the middle of the scene. The room behind the
    // wall is deep and empty, and centring on it pushes the corridor — where
    // the whole maneuver happens — off the bottom of the frame.
    this.target = toThree({
      x: 0,
      y: environment.params.wallThickness / 2,
      z: Math.min(height * 0.32, 75),
    });
    // Framed on the scene, but never closer than the item needs. A 220 cm sofa
    // in a 100 cm corridor makes for a small scene and a large object, and
    // framing on the room alone crops the very thing being watched. `reach` is
    // the engine's own rotation-invariant bound on the item's size.
    const reach = prepareItem(item).reach;
    this.baseRadius = Math.max(1.05 * Math.hypot(width, depth, height), 3.1 * reach);
    this.orbit = {
      radius: this.baseRadius,
      theta: Math.atan2(DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.z),
      phi: Math.acos(DEFAULT_DIRECTION.y),
    };
    this.desired = { ...this.orbit };
    this.up = new THREE.Vector3(0, 1, 0);
    this.desiredUp = this.up.clone();

    this.light.position.copy(this.target).add(new THREE.Vector3(-0.5, 1.5, 0.9).multiplyScalar(this.baseRadius));
    this.light.target.position.copy(this.target);
    const shadow = this.light.shadow.camera;
    shadow.left = -this.baseRadius;
    shadow.right = this.baseRadius;
    shadow.top = this.baseRadius;
    shadow.bottom = -this.baseRadius;
    shadow.near = 1;
    shadow.far = this.baseRadius * 5;
    shadow.updateProjectionMatrix();

    this.applyCamera();
  }

  private easeCamera(): boolean {
    const d = this.desired;
    const o = this.orbit;
    const delta =
      Math.abs(d.radius - o.radius) / Math.max(1, this.baseRadius) +
      Math.abs(d.theta - o.theta) +
      Math.abs(d.phi - o.phi) +
      this.up.distanceTo(this.desiredUp);
    if (delta < 1e-4) return false;

    const k = 0.18;
    o.radius += (d.radius - o.radius) * k;
    o.theta += (d.theta - o.theta) * k;
    o.phi += (d.phi - o.phi) * k;
    this.up.lerp(this.desiredUp, k).normalize();
    this.applyCamera();
    return true;
  }

  private applyCamera(): void {
    const { radius, theta, phi } = this.orbit;
    const sinPhi = Math.sin(phi);
    this.camera.position.set(
      this.target.x + radius * sinPhi * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * sinPhi * Math.cos(theta),
    );
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.target);
    this.dirty = true;
  }

  private attachPointer(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    this.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });

    const end = (event: PointerEvent): void => {
      dragging = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    this.canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.desired = {
        radius: this.desired.radius,
        theta: this.desired.theta - dx * 0.006,
        phi: Math.min(MAX_PHI, Math.max(MIN_PHI, this.desired.phi - dy * 0.006)),
      };
      // Dragging out of a top-down view has to bring the up vector back with
      // it, or the scene arrives on its side.
      if (this.desired.phi > 0.25) this.desiredUp = new THREE.Vector3(0, 1, 0);
      this.invalidate();
    });

    this.canvas.addEventListener(
      'wheel',
      (event: WheelEvent) => {
        event.preventDefault();
        const scale = Math.exp(event.deltaY * 0.0012);
        this.desired = {
          ...this.desired,
          radius: Math.min(this.baseRadius * 2.4, Math.max(this.baseRadius * 0.35, this.desired.radius * scale)),
        };
        this.invalidate();
      },
      { passive: false },
    );
  }
}
