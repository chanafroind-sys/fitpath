import { describe, expect, it } from 'vitest';
import { reportOn } from '../src/maneuvers/report.ts';
import { SLIM_ARM_2_SEAT, RECLINER_2_SEAT, SOFAS } from '../src/fixtures/sofas.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';

const WALL = 15;
const report = (item: Parameters<typeof reportOn>[0]) => reportOn(item, WALL);
const partNamed = (item: Parameters<typeof reportOn>[0], label: string) =>
  report(item).parts.find((p) => p.label === label);

describe('the model, published part by part', () => {
  /**
   * "220 x 95 x 85 cm, 8 boxes" is an envelope. These are the numbers that
   * actually explain the answer, and each of them is a claim on a product page.
   */
  it('reports the size of one of a part, never the union of several', () => {
    // Two armrests 220 cm apart are not a 220 cm armrest. That was the first
    // version of this and it made every multi-box part look enormous.
    const arms = partNamed(SOFA_3_SEAT, 'the armrests')!;
    expect(arms.boxes).toBe(2);
    expect(arms.length).toBeCloseTo(10, 2);
    expect(arms.depth).toBeCloseTo(95, 2);
    expect(arms.height).toBeCloseTo(55, 2);
    // The spread is reported separately, where it belongs.
    expect(arms.from).toBeCloseTo(-110, 2);
    expect(arms.to).toBeCloseTo(110, 2);

    const legs = partNamed(SOFA_3_SEAT, 'the legs')!;
    expect(legs.boxes).toBe(4);
    expect([legs.length, legs.depth, legs.height].map((v) => Math.round(v))).toEqual([8, 8, 15]);
  });

  it('carries the lean an author gave a part', () => {
    expect(partNamed(SOFA_3_SEAT, 'the backrest')!.leanDeg).toBeCloseTo(-12, 6);
    expect(partNamed(SLIM_ARM_2_SEAT, 'the backrest')!.leanDeg).toBeCloseTo(-10, 6);
    // A part with no rotation has no lean to report, rather than a lean of zero.
    expect(partNamed(SOFA_3_SEAT, 'the seat')!.leanDeg).toBeUndefined();
  });

  it('says how far below the top a part stops, which is why threading pays here', () => {
    // The slim-arm's whole reason for being in the catalogue: 8 cm arm panels
    // that stop well below the back, leaving relief at the ends.
    const arms = partNamed(SLIM_ARM_2_SEAT, 'the armrests')!;
    const height = report(SLIM_ARM_2_SEAT).dimensions.height;
    expect(arms.length).toBeCloseTo(8, 2);
    expect(height - arms.top).toBeCloseTo(22, 2);
  });

  it('marks the part that decides the answer, and by how much', () => {
    const housing = partNamed(RECLINER_2_SEAT, 'the recliner housing')!;
    expect(housing.binding).toBe(true);
    expect(housing.bindsBy).toBeCloseTo(10, 2);

    const legs = partNamed(SOFA_3_SEAT, 'the legs')!;
    expect(legs.binding).toBe(true);
    expect(legs.bindsBy).toBeCloseTo(15, 2);

    // Exactly one part carries the mark, per item.
    for (const item of SOFAS) {
      expect(report(item).parts.filter((p) => p.binding).length).toBeLessThanOrEqual(1);
    }
  });

  it('accounts for every box of every item', () => {
    for (const item of SOFAS) {
      const measured = report(item);
      const counted = measured.parts.reduce((sum, p) => sum + p.boxes, 0);
      expect(`${item.id}: ${counted}`).toBe(`${item.id}: ${measured.boxCount}`);
    }
  });
});

describe('the crossing, station by station', () => {
  /**
   * The contrast this exists for.
   *
   * "Carry it through on its side" as a single step cannot show that the angle
   * is the same from one end of the sofa to the other, and so cannot show that
   * a different maneuver changes it *while the item is in the opening*. That is
   * the one thing this engine does that no doorway calculator can, and it was
   * invisible on the page until the crossing was broken up.
   */
  it('holds one angle throughout for the maneuvers that do not turn', () => {
    for (const item of SOFAS) {
      for (const line of report(item).maneuvers) {
        if (!line.valid || line.templateId === 'seat-first' || line.templateId === 'lean-and-straighten') continue;
        const angles = (line.stations ?? []).map((s) => Math.round(s.rollDeg));
        expect(`${item.id}/${line.templateId}: ${new Set(angles).size}`).toBe(
          `${item.id}/${line.templateId}: 1`,
        );
        expect(line.turns).toBe(false);
      }
    }
  });

  it('changes the angle mid-crossing for the ones that thread or lean', () => {
    for (const item of SOFAS) {
      for (const id of ['seat-first', 'lean-and-straighten']) {
        const line = report(item).maneuvers.find((m) => m.templateId === id);
        if (line === undefined || !line.valid) continue;
        expect(`${item.id}/${id}: ${line.turns}`).toBe(`${item.id}/${id}: true`);
        const angles = (line.stations ?? []).map((s) => s.rollDeg);
        expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(5);
      }
    }
  });

  it('names which parts are in the doorway, and they change along the sofa', () => {
    const side = report(SOFA_3_SEAT).maneuvers.find((m) => m.templateId === 'on-its-side')!;
    const stations = side.stations!;
    expect(stations.length).toBeGreaterThan(3);

    // The ends of a sofa are where its armrests are, and the middle is not.
    expect(stations[0]!.parts).toContain('the armrests');
    const middle = stations[Math.floor(stations.length / 2)]!;
    expect(middle.parts).not.toContain('the armrests');
    expect(middle.parts).toContain('the backrest');
  });

  it('never claims a station needs more than the maneuver asks for', () => {
    for (const item of SOFAS) {
      for (const line of report(item).maneuvers) {
        if (!line.valid || line.requirement === undefined) continue;
        for (const station of line.stations ?? []) {
          expect(`${item.id}/${line.templateId}`).toBe(
            station.width <= line.requirement.doorWidth + 1e-6
              ? `${item.id}/${line.templateId}`
              : `station needs ${station.width} but the maneuver claims ${line.requirement.doorWidth}`,
          );
        }
      }
    }
  });
});
