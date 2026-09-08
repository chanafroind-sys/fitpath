import { describe, expect, it } from 'vitest';
import type { EnvironmentParams, Placement } from '../src/types.ts';
import { buildEnvironment } from '../src/environment/build.ts';
import { collides, prepareItem } from '../src/geometry/collide.ts';
import { interpolate } from '../src/planner/edge.ts';
import { placementRotation, radians, rotationMatrix } from '../src/math/rotation.ts';
import { buildLibrary } from '../src/maneuvers/build.ts';
import { verifyPathIn } from '../src/maneuvers/verify.ts';
import { SOFAS } from '../src/fixtures/sofas.ts';

const WALL = 15;

/**
 * A maneuver is recorded against a synthetic scene built to exactly the four
 * numbers it needs. It is then SHOWN in whatever scene a person typed in. This
 * file is about the gap between those two, which is where a sofa was found
 * animating through a wall.
 */
describe('a maneuver in a scene it was not designed against', () => {
  /**
   * The invariant the whole library rests on.
   *
   * A requirement is a lower bound: satisfy all four numbers and the path
   * should run. Every environment below is at least as generous as any
   * maneuver's requirement in all four dimensions, so every maneuver that
   * applies has to be clear in it — every waypoint, and every edge between
   * them, through the same collider that recorded it.
   *
   * If this ever fails, the demo is drawing furniture through walls.
   */
  const scenes: [string, EnvironmentParams][] = [
    ['a wide scene', { openingWidth: 300, openingHeight: 240, wallThickness: WALL, hallwayWidth: 400, hallwayDepth: 700, roomDepth: 500, roomWidth: 700, ceilingHeight: 280 }],
    ['a standard door', { openingWidth: 110, openingHeight: 210, wallThickness: WALL, hallwayWidth: 300, hallwayDepth: 500, roomDepth: 450, roomWidth: 500, ceilingHeight: 250 }],
    ['a narrow door', { openingWidth: 90, openingHeight: 210, wallThickness: WALL, hallwayWidth: 300, hallwayDepth: 400, roomDepth: 400, roomWidth: 400, ceilingHeight: 250 }],
  ];

  for (const [label, params] of scenes) {
    it(`every applicable maneuver is clear in ${label}`, () => {
      const environment = buildEnvironment(params);
      for (const item of SOFAS) {
        const prepared = prepareItem(item);
        for (const maneuver of buildLibrary(prepared, WALL).maneuvers) {
          const need = maneuver.requirement;
          const applies =
            need.doorWidth <= params.openingWidth &&
            need.doorHeight <= params.openingHeight &&
            need.hallwayClearance <= params.hallwayWidth &&
            need.roomDepth <= params.roomDepth;
          if (!applies) continue;

          const fault = verifyPathIn(prepared, maneuver.path, environment);
          expect(`${item.id}/${maneuver.templateId}: ${fault === undefined ? 'clear' : `${fault.kind} ${fault.index}`}`).toBe(
            `${item.id}/${maneuver.templateId}: clear`,
          );
        }
      }
    });
  }

  /**
   * And the frames in between, which is what is actually on screen.
   *
   * The viewer interpolates between waypoints, so a path can be clear at every
   * waypoint and still show a frame that is not. `verifyPathIn` covers this
   * through the edge validator's own sampling; this checks it a second way, at
   * a finer spacing than either, because the claim is about pixels rather than
   * about edges.
   */
  it('is clear at every frame the viewer can draw, not only at the waypoints', () => {
    const params = scenes[2]![1];
    const environment = buildEnvironment(params);
    const item = SOFAS[0]!;
    const prepared = prepareItem(item);

    const maneuver = buildLibrary(prepared, WALL).maneuvers.find((m) => m.templateId === 'on-its-side')!;
    const path = maneuver.path;

    let checked = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      const move = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      const turn = Math.abs(to.yaw - from.yaw) + Math.abs(to.pitch - from.pitch);
      const steps = Math.max(1, Math.ceil((move + turn * prepared.reach) / 0.5));
      for (let k = 0; k <= steps; k++) {
        const frame = interpolate(from, to, k / steps);
        checked++;
        if (collides(prepared, frame, environment)) {
          expect(`frame ${k}/${steps} of edge ${i}`).toBe('clear');
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  /**
   * Rounding a pose is not the same as rounding a number.
   *
   * The demo ships its library as data, and that data was once rounded to four
   * decimals on the way out — every number in the payload, poses included. A
   * carry stage sets the sofa down with its lowest corner exactly on the floor;
   * rounding that pose's pitch moves the angle by 5e-5 radians, which on a
   * 220 cm sofa swings the far corner 2.4e-4 cm under the floor. Invisible, and
   * a collision: the contact tolerance is 1e-9.
   *
   * So what shipped was a path the collider rejected while the validated one
   * stayed behind in the build. The precompute no longer rounds poses; this
   * records why, and would fail again if anyone reintroduced it.
   */
  it('breaks if a validated pose is rounded, which is why the payload does not', () => {
    const params = scenes[2]![1];
    const environment = buildEnvironment(params);
    const prepared = prepareItem(SOFAS[0]!);
    const maneuver = buildLibrary(prepared, WALL).maneuvers.find((m) => m.templateId === 'on-its-side')!;

    expect(verifyPathIn(prepared, maneuver.path, environment)).toBeUndefined();

    const rounded: Placement[] = maneuver.path.map((p) => ({
      ...p,
      x: Number(p.x.toFixed(4)),
      y: Number(p.y.toFixed(4)),
      z: Number(p.z.toFixed(4)),
      yaw: Number(p.yaw.toFixed(4)),
      pitch: Number(p.pitch.toFixed(4)),
    }));
    expect(verifyPathIn(prepared, rounded, environment)).toBeDefined();
  });
});

/**
 * The other half of the same bug, and the one that was actually visible.
 *
 * A placement's pitch turns about the item's local Y or its local X depending
 * on `tiltAxis`. The demo's renderer reconstructed the rotation itself with
 * `rotationMatrix(yaw, pitch, 0)`, which is only ever the first of those. Every
 * path the planner produced was in that family, so it looked right for as long
 * as the planner was the only thing feeding it — and then the library began
 * returning paths that lay a sofa on its side, and the viewer drew them tipped
 * onto their back: through the wall, over the lintel, in a pose the collider
 * had never been shown.
 */
describe('the rotation a renderer must use', () => {
  const sideways: Placement = {
    x: 0,
    y: 0,
    z: 47.5,
    yaw: radians(90),
    pitch: radians(-90),
    tiltAxis: 'x',
  };

  it('is not the same as rebuilding it from yaw and pitch alone', () => {
    expect(placementRotation(sideways)).not.toEqual(
      rotationMatrix(sideways.yaw, sideways.pitch, 0),
    );
  });

  it('agrees with the three-argument form only when the tilt family is the default', () => {
    const onItsBack: Placement = { ...sideways, tiltAxis: 'y' };
    expect(placementRotation(onItsBack)).toEqual(
      rotationMatrix(onItsBack.yaw, onItsBack.pitch, 0),
    );
    // And an absent tiltAxis means the default, so old placements still draw
    // exactly as they always did.
    const legacy: Placement = { x: 0, y: 0, z: 47.5, yaw: radians(90), pitch: radians(-90) };
    expect(placementRotation(legacy)).toEqual(rotationMatrix(legacy.yaw, legacy.pitch, 0));
  });
});
