import { describe, expect, it } from 'vitest';
import { CORNER_MAIN, CORNER_RETURN, CORNER_SOFA, SOFA_3_SEAT } from '@fitpath/engine';
import type { Item, ManeuverRequirement } from '@fitpath/engine';
import { assess, assessCarry, narrowestKnown, type Have } from '../src/modal/assess.ts';
import type { Carry, WidgetManeuver, WidgetProduct } from '../src/types.ts';

/**
 * Hand-written libraries, so each case reads as a table.
 *
 * The numbers are the three-seater's real ones, rounded, but nothing here
 * depends on the build having run: the point of these tests is the arithmetic
 * and the honesty rules, not the geometry, which has its own tests.
 */
const req = (
  doorWidth: number,
  doorHeight: number,
  hallwayClearance: number,
  alongWall: number,
  roomDepth: number,
): ManeuverRequirement => ({ doorWidth, doorHeight, hallwayClearance, alongWall, roomDepth });

const maneuver = (id: string, stages: number, requirement: ManeuverRequirement): WidgetManeuver => ({
  templateId: id,
  name: id,
  nameHe: id,
  stages: Array.from({ length: stages }, (_, i) => ({ name: `stage ${i}`, nameHe: `שלב ${i}` })),
  requirement,
  headroomCm: 100,
  turns: false,
  wallThickness: 30,
  holdsForWallsUpTo: 100,
});

const SOFA_LIBRARY: WidgetManeuver[] = [
  maneuver('straight-in', 1, req(95.01, 85, 222, 95, 222)),
  maneuver('on-its-side', 3, req(85.01, 95, 222, 150, 222)),
  maneuver('seat-first', 4, req(85.04, 117.81, 222, 165, 222)),
  maneuver('upright-through', 5, req(95, 222, 122.2, 260.8, 119.5)),
  maneuver('upright-left-standing', 4, req(95, 222, 122.2, 260.8, 87)),
];

function carry(id: string, item: Item, maneuvers: WidgetManeuver[]): Carry {
  const valid = maneuvers.map((m) => m.requirement.doorWidth);
  return {
    id,
    name: id,
    nameHe: id,
    dimensions: { length: 220, depth: 95, height: 85 },
    item,
    maneuvers,
    ...(valid.length > 0 ? { narrowestCm: Math.min(...valid) } : {}),
    floorCm: valid.length > 0 ? Math.min(...valid) - 0.01 : 0,
    wallStatement: 'Measured against a wall 30 cm thick.',
    wallStatementHe: 'נמדד מול קיר בעובי 30 ס״מ.',
  };
}

const LEGS_OFF: WidgetManeuver[] = [
  maneuver('straight-in', 1, req(95.01, 70, 222, 95, 222)),
  maneuver('on-its-side', 3, req(70.01, 95, 222, 150, 222)),
];

function product(overrides: Partial<WidgetProduct> = {}): WidgetProduct {
  return {
    dataVersion: 1,
    id: 'sofa',
    name: 'sofa',
    nameHe: 'ספה',
    illustration: '<svg/>',
    wallThicknessCm: 15,
    assembled: carry('sofa', SOFA_3_SEAT, SOFA_LIBRARY),
    separates: false,
    withoutPart: [{ part: 'legs', partHe: 'הרגליים', carry: carry('sofa-no-legs', SOFA_3_SEAT, LEGS_OFF) }],
    ...overrides,
  };
}

const exact = (value: number) => ({ value, exact: true });
const atLeast = (value: number) => ({ value, exact: false });

describe('one number: the doorway width', () => {
  it('leaves everything open and asks for the width when nothing is known', () => {
    const answer = assess(product(), {});
    expect(answer.assembled.verdict).toBe('open');
    expect(answer.next?.key).toBe('doorWidth');
    expect(answer.assembled.maneuvers.every((m) => m.status === 'open')).toBe(true);
  });

  it('a wide enough door is open, not fits, and the next question is what the simplest maneuver needs most', () => {
    const answer = assess(product(), { doorWidth: exact(100) });
    expect(answer.assembled.verdict).toBe('open');
    // Fewest stages first, exactly as the engine's selector would choose.
    expect(answer.assembled.chosen?.maneuver.templateId).toBe('straight-in');
    // Straight in needs 222 cm in front, 95 along, 222 behind and 85 of height.
    // Against what homes have, the 222 in front is the one most likely to fail.
    expect(answer.next).toMatchObject({ key: 'hallwayClearance', needsCm: 222 });
  });

  it('a door narrower than every maneuver is a library miss, never a verdict', () => {
    const answer = assess(product({ withoutPart: [] }), { doorWidth: exact(80) });
    expect(answer.assembled.verdict).toBe('not-in-library');
    expect(answer.assembled.proof).toBeUndefined();
    expect(answer.next).toBeUndefined();
    expect(answer.assembled.maneuvers.every((m) => m.status === 'ruled-out')).toBe(true);
    expect(answer.assembled.maneuvers.every((m) => m.unmet.includes('doorWidth'))).toBe(true);
  });

  it('a door narrower than a part of the sofa is proven impossible, by the engine, in closed form', () => {
    // The seat block is 220 x 80 x 40: its smallest face is 40 x 80, and no
    // rotation gets a 40 cm face through a 39 cm hole.
    const answer = assess(product(), { doorWidth: exact(39) });
    expect(answer.assembled.verdict).toBe('proven');
    expect(answer.assembled.proof?.proven).toBe(true);
    expect(answer.assembled.proof?.crossSection?.[0]).toBeCloseTo(40, 6);
  });

  it('a proof from the width alone does not depend on the height the shopper has not given', () => {
    const withHeight = assessCarry(product().assembled, { doorWidth: exact(39), doorHeight: exact(300) });
    const withoutHeight = assessCarry(product().assembled, { doorWidth: exact(39) });
    expect(withHeight.verdict).toBe('proven');
    expect(withoutHeight.verdict).toBe('proven');
  });

  it('a confirmed threshold cannot prove anything: the door might be wider', () => {
    const answer = assess(product(), { doorWidth: atLeast(39) });
    expect(answer.assembled.verdict).toBe('open');
  });
});

describe('escalation', () => {
  it('a number the shopper gave rules a maneuver out; a threshold they confirmed never does', () => {
    const measured = assessCarry(product().assembled, {
      doorWidth: exact(100),
      hallwayClearance: exact(130),
    });
    const straightIn = measured.maneuvers.find((m) => m.maneuver.templateId === 'straight-in')!;
    expect(straightIn.status).toBe('ruled-out');
    expect(straightIn.unmet).toEqual(['hallwayClearance']);

    const confirmed = assessCarry(product().assembled, {
      doorWidth: exact(100),
      hallwayClearance: atLeast(130),
    });
    const stillOpen = confirmed.maneuvers.find((m) => m.maneuver.templateId === 'straight-in')!;
    expect(stillOpen.status).toBe('open');
    expect(stillOpen.unknown).toContain('hallwayClearance');
  });

  it('when the square-on maneuvers fall, the question moves to what the upright ones need most', () => {
    const answer = assess(product(), { doorWidth: exact(100), hallwayClearance: exact(130) });
    expect(answer.assembled.verdict).toBe('open');
    expect(answer.assembled.chosen?.maneuver.templateId).toBe('upright-left-standing');
    // It needs a 222 cm tall door, 261 cm along the wall and 87 cm behind.
    // The door height is the unusual one, so that is asked before the others.
    expect(answer.next).toMatchObject({ key: 'doorHeight', needsCm: 222 });
  });

  it('answers "no" to that with a measured door, and the library is out of maneuvers', () => {
    const answer = assess(product(), {
      doorWidth: exact(100),
      hallwayClearance: exact(130),
      doorHeight: exact(205),
    });
    expect(answer.assembled.verdict).toBe('not-in-library');
    // The legs route is not an answer to a hallway that is too short either.
    expect(answer.withoutPart[0]?.carry.verdict).toBe('not-in-library');
    expect(answer.next).toBeUndefined();
  });

  it('bundles the remaining questions into one only when every one of them is ordinary', () => {
    // 222 in front is not ordinary, so it is asked alone.
    const alone = assess(product(), { doorWidth: exact(100) });
    expect(alone.next?.key).toBe('hallwayClearance');
    expect(alone.next?.bundle).toBeUndefined();

    // With that met, what is left — 222 behind, an 85 cm door, 95 along the
    // wall — is what any home has, and it is confirmed in one go.
    const rest = assess(product(), { doorWidth: exact(100), hallwayClearance: exact(240) });
    expect(rest.next?.bundle?.map((q) => [q.key, q.needsCm])).toEqual([
      ['alongWall', 95],
      ['roomDepth', 222],
      ['doorHeight', 85],
    ]);

    // The width is never bundled, whatever it needs.
    expect(assess(product(), {}).next?.bundle).toBeUndefined();
  });

  it('fits only when every requirement of some maneuver is met by a known number', () => {
    const have: Have = {
      doorWidth: exact(100),
      hallwayClearance: exact(240),
      alongWall: atLeast(150),
      roomDepth: atLeast(222),
      doorHeight: atLeast(95),
    };
    const answer = assess(product(), have);
    expect(answer.assembled.verdict).toBe('fits');
    expect(answer.next).toBeUndefined();
    // Straight in and on its side both fit; the engine puts the one with the
    // fewest separate motions first. Seat first needs a 117.81 cm tall door
    // and 165 cm along the wall, and "at least 95" and "at least 150" say
    // nothing about either — so it is open, not fitting, and not ruled out.
    expect(answer.assembled.fitting.map((m) => m.maneuver.templateId)).toEqual([
      'straight-in',
      'on-its-side',
    ]);
    expect(answer.assembled.chosen?.maneuver.templateId).toBe('straight-in');
    const seatFirst = answer.assembled.maneuvers.find((m) => m.maneuver.templateId === 'seat-first')!;
    expect(seatFirst.status).toBe('open');
    expect(seatFirst.unknown).toEqual(['alongWall', 'doorHeight']);
  });

  it('a requirement met by a centimetre is flagged as marginal; a confirmed threshold is not', () => {
    const measured = assessCarry(product().assembled, {
      doorWidth: exact(96),
      hallwayClearance: exact(222.5),
      alongWall: atLeast(95),
      roomDepth: atLeast(222),
      doorHeight: atLeast(85),
    });
    expect(measured.verdict).toBe('fits');
    expect(measured.marginal).toEqual(['doorWidth', 'hallwayClearance']);
  });
});

describe('the wall', () => {
  it('a wall thicker than a maneuver was measured for leaves it open, never rules it out, and asks nothing', () => {
    const seatFirstOnly = product({
      assembled: carry('sofa', SOFA_3_SEAT, [
        { ...maneuver('seat-first', 4, req(85.04, 117.81, 222, 165, 222)), holdsForWallsUpTo: 30 },
      ]),
      withoutPart: [],
    });
    const have: Have = {
      doorWidth: exact(100),
      hallwayClearance: exact(240),
      alongWall: exact(300),
      roomDepth: exact(300),
      doorHeight: exact(200),
      wallThickness: 40,
    };
    const answer = assess(seatFirstOnly, have);
    expect(answer.assembled.verdict).toBe('open');
    expect(answer.assembled.maneuvers[0]?.wallUnknown).toBe(true);
    expect(answer.assembled.maneuvers[0]?.status).toBe('open');
    // Nothing a tape measure can settle: the library would have to be rebuilt.
    expect(answer.next).toBeUndefined();

    // The same wall against a maneuver known to hold for any wall up to 100 cm.
    const fine = assess(product(), have);
    expect(fine.assembled.verdict).toBe('fits');
  });

  it('never asks for numbers a maneuver unmeasured for the wall could not use', () => {
    // A 130 cm hallway leaves only the two upright approaches, both measured
    // for a 30 cm wall only. With a 40 cm wall, asking for the door height
    // would be asking for a number that cannot make either of them a fit.
    const library = product({
      assembled: carry('sofa', SOFA_3_SEAT, [
        maneuver('straight-in', 1, req(95.01, 85, 222, 95, 222)),
        { ...maneuver('upright-left-standing', 4, req(95, 222, 122.2, 260.8, 87)), holdsForWallsUpTo: 30 },
      ]),
      withoutPart: [],
    });
    const answer = assess(library, { doorWidth: exact(100), hallwayClearance: exact(130), wallThickness: 40 });
    expect(answer.assembled.verdict).toBe('open');
    expect(answer.assembled.chosen?.maneuver.templateId).toBe('upright-left-standing');
    expect(answer.assembled.chosen?.wallUnknown).toBe(true);
    expect(answer.next).toBeUndefined();
  });

  it('a wall no thicker than the bound changes nothing', () => {
    const answer = assess(product(), { doorWidth: exact(100), wallThickness: 30 });
    expect(answer.assembled.verdict).toBe('open');
    expect(answer.next?.key).toBe('hallwayClearance');
  });
});

describe('routes round the assembled answer', () => {
  const corner = (): WidgetProduct =>
    product({
      id: 'corner',
      assembled: carry('corner', CORNER_SOFA, [
        maneuver('on-its-side', 3, req(85.01, 200, 282, 285, 282)),
      ]),
      separates: true,
      modules: [
        carry('main', CORNER_MAIN, [maneuver('on-its-side', 3, req(85.01, 95, 278, 180, 278))]),
        carry('return', CORNER_RETURN, [maneuver('on-its-side', 3, req(65.01, 105, 97, 170, 97))]),
      ],
      withoutPart: [],
    });

  it('pursues the assembled body first, and asks about its most demanding need', () => {
    const answer = assess(corner(), { doorWidth: exact(90) });
    expect(answer.assembled.verdict).toBe('open');
    expect(answer.next).toMatchObject({ key: 'hallwayClearance', needsCm: 282 });
  });

  it('hands the question to the modules once the assembled body is ruled out', () => {
    const answer = assess(corner(), { doorWidth: exact(90), hallwayClearance: atLeast(200) });
    // 200 confirmed is not a refusal of 282, so the assembled body is still open.
    expect(answer.assembled.verdict).toBe('open');

    const measured = assess(corner(), { doorWidth: exact(90), hallwayClearance: exact(150) });
    expect(measured.assembled.verdict).toBe('not-in-library');
    // Module by module the main run needs 278 in front, so a 150 cm hallway
    // rules that route out too — the chaise's 97 does not carry the run.
    expect(measured.modules?.verdict).toBe('not-in-library');
    expect(measured.next).toBeUndefined();
  });

  it('a module route is only as good as its worst module, and its question is the most demanding one', () => {
    const answer = assess(corner(), { doorWidth: exact(90), hallwayClearance: exact(280) });
    expect(answer.assembled.verdict).toBe('not-in-library');
    expect(answer.modules?.verdict).toBe('open');
    expect(answer.modules?.carries.map((c) => c.verdict)).toEqual(['open', 'open']);
    // Both modules are open. The main run is carried straight in, so it needs
    // its own 278 cm behind the door — the most demanding thing either module
    // still needs, and the one asked; a "yes" to it settles the chaise's 97.
    expect(answer.next).toMatchObject({ key: 'roomDepth', needsCm: 278, carry: { id: 'main' } });
  });

  it('a product whose separability is unknown gets no module route at all', () => {
    const answer = assess(product({ separates: 'unknown' }), { doorWidth: exact(70) });
    expect(answer.modules).toBeUndefined();
  });

  it('a removable part is pursued once the assembled body is out', () => {
    const answer = assess(product(), { doorWidth: exact(75) });
    expect(answer.assembled.verdict).toBe('not-in-library');
    expect(answer.withoutPart[0]?.carry.verdict).toBe('open');
    expect(answer.withoutPart[0]?.carry.chosen?.maneuver.templateId).toBe('on-its-side');
    expect(answer.next).toMatchObject({ key: 'hallwayClearance', needsCm: 222, carry: { id: 'sofa-no-legs' } });
  });

  it('the narrowest known doorway counts modules together and removable parts separately', () => {
    expect(narrowestKnown(assess(corner(), {}))).toBeCloseTo(85.01, 6);
    expect(narrowestKnown(assess(product(), {}))).toBeCloseTo(70.01, 6);
  });
});
