import { describe, expect, it } from 'vitest';
import { buildEnvironment } from '../src/environment/build.ts';
import { plan } from '../src/planner/plan.ts';
import { prepareItem } from '../src/geometry/collide.ts';
import { NARROW_HALLWAY, TILT_REQUIRED } from '../src/fixtures/scenarios.ts';
import { WARDROBE } from '../src/fixtures/items.ts';

/**
 * The peak height a face of `w x h` reaches while being rotated a quarter turn,
 * which is its diagonal. Bounding-box height does not change under translation,
 * so this is a floor on the ceiling any rigid motion needs — for every planner,
 * not just this one.
 */
const sweptHeight = (w: number, h: number): number => Math.hypot(w, h);

describe('pivot moves', () => {
  it('offers a bottom edge for pitch and a bottom corner for yaw', () => {
    const item = prepareItem(WARDROBE);
    // The wardrobe's local box: 60 deep on X, 180 wide on Y, 220 tall on Z.
    expect(item.localBounds.minX).toBeCloseTo(-30, 6);
    expect(item.localBounds.maxX).toBeCloseTo(30, 6);
    expect(item.localBounds.minZ).toBeCloseTo(0, 6);
    // The bottom edges parallel to local Y — the axis pitch turns about — are
    // the ones the item genuinely tips over.
    expect(item.localBounds.maxY - item.localBounds.minY).toBeCloseTo(180, 6);
  });

  it('wardrobe pivots on its bottom edge under a 250 cm ceiling', () => {
    // The scenario that used to demand a 320 cm ceiling.
    expect(TILT_REQUIRED.params.ceilingHeight).toBe(250);

    const environment = buildEnvironment(TILT_REQUIRED.params);
    const started = performance.now();
    const result = plan(TILT_REQUIRED.item, environment, { diagnostics: false });
    console.log(`[pivot/250cm] ${result.feasible ? 'feasible' : 'infeasible'} in ${(performance.now() - started).toFixed(0)} ms`);

    expect(result.feasible).toBe(true);
    if (!result.feasible) return;

    // It really does go over: upright is 220 cm and the header is 205 cm, so
    // the path has to reach a substantial tilt.
    const maxPitch = Math.max(...result.path.map((p) => Math.abs(p.pitch)));
    expect(maxPitch).toBeGreaterThan(Math.PI / 4);

    // And it never scrapes the ceiling on the way.
    expect(sweptHeight(60, 220)).toBeLessThan(TILT_REQUIRED.params.ceilingHeight);
  });

  it('gets within 2 cm of the geometric floor, which lift-then-rotate cannot', () => {
    // Tipping the wardrobe backward sweeps the diagonal of its 60 x 220 face.
    // No rigid motion clears a ceiling below that, so it is the hard limit.
    const floor = sweptHeight(60, 220);
    expect(floor).toBeCloseTo(228.04, 1);

    const ceilingHeight = 230;
    const environment = buildEnvironment({ ...TILT_REQUIRED.params, ceilingHeight });

    const withPivots = plan(TILT_REQUIRED.item, environment, {
      diagnostics: false,
      pivotMoves: true,
    });
    const withoutPivots = plan(TILT_REQUIRED.item, environment, {
      diagnostics: false,
      pivotMoves: false,
    });

    // Pivoting keeps the contact edge on the floor, so the item only ever
    // occupies poses the geometry allows.
    expect(withPivots.feasible).toBe(true);
    // Rising and rotating as separate moves needs a height that is legal at
    // both of two adjacent tilt angles, and at 230 cm there is none.
    expect(withoutPivots.feasible).toBe(false);
  });

  it('does not invent paths: the narrow hallway is still impossible with pivots', () => {
    // Pivot moves enlarge the reachable set, so the case the whole project
    // exists for has to be re-checked rather than assumed safe.
    const result = plan(NARROW_HALLWAY.item, buildEnvironment(NARROW_HALLWAY.params), {
      diagnostics: false,
    });
    expect(result.feasible).toBe(false);
  });

  it('stays deterministic with pivot moves enabled', () => {
    const environment = buildEnvironment(TILT_REQUIRED.params);
    const first = plan(TILT_REQUIRED.item, environment, { diagnostics: false });
    for (let i = 0; i < 5; i++) {
      const again = plan(TILT_REQUIRED.item, environment, { diagnostics: false });
      expect(JSON.stringify(again.feasible && again.path)).toBe(
        JSON.stringify(first.feasible && first.path),
      );
    }
  });
});
