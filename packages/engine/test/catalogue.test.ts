import { describe, expect, it } from 'vitest';
import type { ItemReport } from '../src/maneuvers/report.ts';
import { reportOn } from '../src/maneuvers/report.ts';
import { prepareItem } from '../src/geometry/collide.ts';
import { bestRollSchedule } from '../src/maneuvers/templates.ts';
import {
  CORNER_MAIN,
  CORNER_RETURN,
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  RECLINER_2_SEAT,
  SLIM_ARM_2_SEAT,
  SOFAS,
  SOFA_BED,
} from '../src/fixtures/sofas.ts';
import { SOFA_3_SEAT } from '../src/fixtures/items.ts';

const WALL = 15;
const report = (item: Parameters<typeof reportOn>[0]): ItemReport => reportOn(item, WALL);

describe('the catalogue', () => {
  /**
   * The table the product pages publish, pinned.
   *
   * Every figure here is measured from the boxes, and every one of them is a
   * claim to a shopper about their own doorway, so none of them may drift
   * unnoticed. The spread is the point: six sofas, six different reasons.
   */
  it.each([
    [SOFA_3_SEAT, 85.01, 85.0, 'the legs'],
    [SLIM_ARM_2_SEAT, 77.79, 77.76, 'the armrests'],
    [CORNER_SOFA, 85.01, 85.0, 'the backrest'],
    [DEEP_SEAT_LOUNGE, 75.01, 75.0, 'the backrest'],
    // Stood on end it clears 100.00 rather than the 100.01 straight-in needs —
    // a hundredth, but the approach maneuvers are why it moved at all.
    [RECLINER_2_SEAT, 100.0, 100.0, 'the recliner housing'],
    [SOFA_BED, 90.01, 90.0, 'the backrest'],
  ] as const)('measures %#: narrowest doorway, floor, and what sets it', (item, narrowest, floor, part) => {
    const measured = report(item);
    expect(measured.narrowest).toBeCloseTo(narrowest, 2);
    expect(measured.floor).toBeCloseTo(floor, 2);
    expect(measured.binding?.part?.label).toBe(part);
  });

  it('names what makes each one wide standing up, which is a different question', () => {
    // The corner sofa is the case that separates them. Turned on its side its
    // width is set by the height of its back, like any sofa; carried in level
    // it is two metres across, and that is the chaise return alone.
    expect(report(CORNER_SOFA).upright?.part?.label).toBe('the chaise return');
    expect(report(CORNER_SOFA).upright?.floor).toBeCloseTo(200, 2);
    expect(report(CORNER_SOFA).upright?.coverage).toBeLessThan(0.5);
    // And on a straight sofa the answer is the armrests, which is where its
    // depth comes from — the fixture says so in its own comment.
    expect(report(SOFA_3_SEAT).upright?.part?.label).toBe('the armrests');
  });

  /**
   * The one the catalogue was assembled to test.
   *
   * Threading pays only when the ends of an item have relief the middle does
   * not. The three-seater's ends are solid armrests with legs under them, so
   * turning as it goes buys nothing there. The slim-arm two-seater has 8 cm arm
   * panels stopping well below its back and no legs standing proud, and it is
   * the only sofa in the catalogue where the threading maneuver beats simply
   * laying the thing on its side.
   */
  it('is the slim-arm two-seater where threading finally pays, and only there', () => {
    for (const item of SOFAS) {
      const measured = report(item);
      const side = measured.maneuvers.find((m) => m.templateId === 'on-its-side');
      const seat = measured.maneuvers.find((m) => m.templateId === 'seat-first');
      if (side?.requirement === undefined || seat?.requirement === undefined) continue;
      const gain = side.requirement.doorWidth - seat.requirement.doorWidth;
      if (item.id === SLIM_ARM_2_SEAT.id) expect(gain).toBeGreaterThan(2);
      else expect(gain).toBeLessThanOrEqual(0.05);
    }
  });

  /**
   * The corner sofa, both ways, which is the only honest way to report it.
   *
   * Assembled, every maneuver that clears 85 cm needs a two-metre lintel to do
   * it, and the one that keeps the item level needs a two-metre doorway. Those
   * are not doorways houses have. In the two modules it actually ships as, the
   * wider piece is an ordinary 85 cm and the return clears 65.
   */
  it('reports the corner sofa assembled and in modules, and they differ', () => {
    const whole = report(CORNER_SOFA);
    // The approach maneuvers do not apply to it: standing a 280 cm L on its
    // end is not a thing that happens, and the template says so rather than
    // producing a motion nobody would perform.
    expect(
      whole.maneuvers.filter((m) => m.valid).map((m) => m.templateId).sort(),
    ).toEqual(['on-its-side', 'seat-first', 'straight-in']);

    const level = whole.maneuvers.find((m) => m.templateId === 'straight-in')!.requirement!;
    expect(level.doorWidth).toBeCloseTo(200, 1);
    const turned = whole.maneuvers.find((m) => m.templateId === 'on-its-side')!.requirement!;
    expect(turned.doorWidth).toBeCloseTo(85.01, 2);
    expect(turned.doorHeight).toBeCloseTo(200, 1);

    const main = report(CORNER_MAIN);
    const returned = report(CORNER_RETURN);
    expect(main.narrowest).toBeCloseTo(85.01, 2);
    expect(returned.narrowest).toBeCloseTo(64.57, 2);
    // The piece that decides a delivery is the wider of the two.
    expect(Math.max(main.narrowest!, returned.narrowest!)).toBeCloseTo(85.01, 2);
  });

  /**
   * The chaise return is longer across than along, so the library has to travel
   * it on its local Y. Getting this wrong would not be subtle: leading with the
   * wrong axis would report a 105 cm doorway where 95 is needed.
   */
  it('leads the chaise return with its own longer axis, not with local X', () => {
    expect(bestRollSchedule(prepareItem(CORNER_RETURN), WALL)?.travelAxis).toBe('y');
    expect(bestRollSchedule(prepareItem(CORNER_MAIN), WALL)?.travelAxis).toBe('x');
  });

  it('leaves nothing on the table: every maneuver reaches the roll-schedule floor', () => {
    for (const item of SOFAS) {
      const measured = report(item);
      if (measured.narrowest === undefined || measured.floor === undefined) continue;
      // Within the straight interpolation between waypoints. A larger gap would
      // mean the library was missing a maneuver its own geometry allows.
      expect(`${item.id}: ${measured.narrowest - measured.floor < 0.1}`).toBe(`${item.id}: true`);
    }
  });

  it('is deterministic across the whole catalogue', () => {
    for (const item of SOFAS) {
      expect(JSON.stringify(report(item))).toBe(JSON.stringify(report(item)));
    }
  });

  /**
   * What each family of maneuver asks of the floor, and the trade between them.
   *
   * The square-to-the-door maneuvers begin with the item already facing the
   * opening, and holding a 220 cm sofa square to a wall takes its own length in
   * front of that wall. That was the library's single biggest practical
   * limitation: it turned a 120 cm hallway into a refusal.
   *
   * The approach maneuvers include getting the item into position, and they do
   * it by standing it on its end — which trades depth in front of the wall for
   * length ALONG the wall, and a person's hallway usually has far more of the
   * second than the first. Both halves of that trade are pinned here, because
   * an approach that quietly needed the same floor would be no approach at all.
   */
  it('trades depth in front of the wall for length along it', () => {
    const almedal = report(SOFA_3_SEAT);
    const need = (id: string) =>
      almedal.maneuvers.find((m) => m.templateId === id)?.requirement;

    // Square to the door: its own length in front, and almost nothing along.
    expect(need('straight-in')!.hallwayClearance).toBeCloseTo(222, 1);
    expect(need('on-its-side')!.hallwayClearance).toBeCloseTo(222, 1);
    expect(need('straight-in')!.alongWall).toBeLessThan(100);

    // Stood on its end: a hundred centimetres less floor in front, bought with
    // length along the wall and a doorway tall enough to take it standing.
    const upright = need('upright-through')!;
    expect(upright.hallwayClearance).toBeCloseTo(122.18, 1);
    expect(upright.alongWall).toBeGreaterThan(250);
    expect(upright.doorHeight).toBeCloseTo(222, 1);
    expect(need('straight-in')!.hallwayClearance - upright.hallwayClearance).toBeGreaterThan(95);

    // And left standing on the far side, the room needs its end rather than
    // its length — which is what makes a shallow room possible at all.
    expect(need('upright-left-standing')!.roomDepth).toBeCloseTo(87.01, 1);
  });

  it('never reports a requirement smaller than the item that has to pass', () => {
    for (const item of SOFAS) {
      const measured = report(item);
      const shortest = Math.min(measured.dimensions.depth, measured.dimensions.height);
      for (const line of measured.maneuvers) {
        if (line.requirement === undefined) continue;
        const r = line.requirement;
        expect(`${item.id}/${line.templateId}`).toBe(
          r.hallwayClearance >= shortest && r.roomDepth > 0 && r.alongWall > 0
            ? `${item.id}/${line.templateId}`
            : 'a requirement smaller than the item',
        );
      }
    }
  });
});
