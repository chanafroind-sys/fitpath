import { describe, expect, it } from 'vitest';
import { SOFA_3_SEAT, SOFA_BED } from '@fitpath/engine';
import { CLOSE_CM, decide, narrowestKnown, type Have } from '../src/modal/verdict.ts';
import { anyWall, carry, cornerSofa, need, perWall, presented, product, withLegs } from './support/library.ts';

describe('the opening', () => {
  it('is asked for before anything is said', () => {
    expect(decide(product(), {}).kind).toBe('needs-opening');
    expect(decide(product(), { doorWidth: 90 }).kind).toBe('needs-opening');
    expect(decide(product(), { doorHeight: 200 }).kind).toBe('needs-opening');
    expect(decide(product(), { hallwayClearance: 300, roomDepth: 300 }).kind).toBe('needs-opening');
  });
});

describe('fits', () => {
  it('when the opening and every entered number meet a way in, by the engine’s own choice', () => {
    const v = decide(product(), { doorWidth: 100, doorHeight: 200, hallwayClearance: 250, roomDepth: 250 });
    expect(v.kind).toBe('fits');
    // Straight in: one step, and its ceiling and wall-length needs are implied by the door.
    expect(presented(v)).toBe('straight-in');
    expect(v.conditions).toEqual([]);
  });

  it('is never claimed while a requirement is unknown', () => {
    const v = decide(product(), { doorWidth: 100, doorHeight: 200, hallwayClearance: 250 });
    expect(v.kind).toBe('conditions');
  });

  it('says what is close, so a number met on paper gets measured again', () => {
    const v = decide(product(), { doorWidth: 85.5, doorHeight: 200, hallwayClearance: 250, alongWall: 250, roomDepth: 250 });
    expect(v.kind).toBe('fits');
    expect(presented(v)).toBe('on-its-side');
    expect(v.close.map((c) => c.key)).toEqual(['doorWidth']);
    expect(v.close[0]!.margin).toBeLessThan(CLOSE_CM);
  });
});

describe('a way in with conditions', () => {
  it('when the opening is enough and the corridor is not given: the rest is reported, not asked', () => {
    const v = decide(product(), { doorWidth: 90, doorHeight: 200 });
    expect(v.kind).toBe('conditions');
    expect(presented(v)).toBe('on-its-side');
    expect(v.conditions.map((c) => c.key)).toEqual(['hallwayClearance', 'alongWall', 'roomDepth']);
    expect(v.conditions[0]!.need).toBeCloseTo(222, 2);
  });

  it('does not list a requirement the doorway itself implies', () => {
    // On its side needs 150 along the wall and a 118 ceiling: a 200 cm door
    // implies the ceiling, but not the wall. A 160 cm door implies both.
    const narrow = decide(product(), { doorWidth: 90, doorHeight: 200 });
    expect(narrow.conditions.map((c) => c.key)).not.toContain('ceilingHeight');
    expect(narrow.route!.carries[0]!.presented!.facts.ceilingHeight).toBe('implied');
    const wide = decide(product(), { doorWidth: 160, doorHeight: 200, hallwayClearance: 250, roomDepth: 250 });
    expect(wide.kind).toBe('fits');
  });

  it('presents the way in an ordinary home is most likely to have room for, not the first that clears the door', () => {
    // A door wide and tall enough for everything. Standing it on end wants
    // 122 cm in front instead of 222, at the price of a tall ceiling.
    const v = decide(product(), { doorWidth: 100, doorHeight: 230 });
    expect(v.kind).toBe('conditions');
    expect(presented(v)).toBe('upright-left-standing');
    expect(v.conditions.map((c) => c.key)).toEqual(['hallwayClearance', 'alongWall', 'roomDepth', 'ceilingHeight']);
  });
});

describe('falling back', () => {
  it('moves to the next way in when an entered number rules the first out, instead of declaring a problem', () => {
    const before = decide(product(), { doorWidth: 100, doorHeight: 230 });
    expect(presented(before)).toBe('upright-left-standing');
    // 110 cm in front rules out standing it on end (122) — and straight in (222).
    const after = decide(product(), { doorWidth: 100, doorHeight: 230, hallwayClearance: 110 });
    expect(after.kind).toBe('no-way');
    // But a ceiling too low for the upright ways falls back to the flat ones.
    const low = decide(product(), { doorWidth: 100, doorHeight: 230, ceilingHeight: 225 });
    expect(low.kind).toBe('conditions');
    expect(presented(low)).toBe('straight-in');
  });

  it('names the trade-off when two ways in ask for different things', () => {
    const v = decide(product(), { doorWidth: 100, doorHeight: 230 });
    expect(v.tradeoff).toBeDefined();
    // Straight in has no use for the wall length or the ceiling standing it
    // on end needs — a 100 x 230 door settles both — but wants the whole
    // sofa's length in front and behind.
    expect(v.tradeoff!.maneuver.templateId).toBe('straight-in');
    expect(v.tradeoff!.less.map((c) => [c.key, c.dropped])).toEqual([['alongWall', true], ['ceilingHeight', true]]);
    expect(v.tradeoff!.more.map((c) => c.key)).toEqual(['hallwayClearance', 'roomDepth']);
  });

  it('names no trade-off when every other way in only asks for more', () => {
    // At 90 cm the upright ways are out; seat first and the lean ask for
    // everything on its side asks for, and more.
    const v = decide(product(), { doorWidth: 90, doorHeight: 200 });
    expect(v.tradeoff).toBeUndefined();
  });
});

describe('no known way in', () => {
  it('reports the nearest miss with the threshold beside the number, and is never a proof', () => {
    const v = decide(product(), { doorWidth: 80, doorHeight: 200 });
    expect(v.kind).toBe('no-way');
    expect(v.proof).toBeUndefined();
    expect(v.nearest!.maneuver.templateId).toBe('lean');
    expect(v.nearest!.short).toEqual([{ key: 'doorWidth', need: 82.74, have: 80 }]);
  });

  it('picks the miss with the fewest numbers short, then the least short', () => {
    // Door fine; 110 cm in front rules everything out. The upright ways are
    // short by 12, the flat ones by 112.
    const v = decide(product(), { doorWidth: 100, doorHeight: 230, hallwayClearance: 110 });
    expect(v.kind).toBe('no-way');
    expect(v.nearest!.short.map((s) => s.key)).toEqual(['hallwayClearance']);
    expect(v.nearest!.short[0]!.need).toBeCloseTo(122.18, 2);
  });
});

describe('proven too large', () => {
  it('comes from the closed-form proof and nothing else', () => {
    // The sofa bed's folded frame is 42 cm at its thinnest, and the proof
    // argues box by box: it fires for a 40 cm door and for nothing wider.
    const bed = product({ assembled: carry('bed', SOFA_BED, [anyWall('on-its-side', 3, need(90.01, 200, 102, 290, 102, 218))]) });
    const v = decide(bed, { doorWidth: 40, doorHeight: 200 });
    expect(v.kind).toBe('proven');
    expect(v.proof!.crossSection[0]).toBeGreaterThan(40);
    expect(v.proof!.opening).toEqual([40, 200]);
    // The same numbers against a library entry that would clear them are
    // still proven: the proof outranks the list.
    const wrong = product({ assembled: carry('bed', SOFA_BED, [anyWall('magic', 1, need(30, 30, 30, 30, 30, 30))]) });
    expect(decide(wrong, { doorWidth: 40, doorHeight: 200 }).kind).toBe('proven');
  });

  it('is not claimed for a door the shape can pass', () => {
    const v = decide(product(), { doorWidth: 60, doorHeight: 200 });
    expect(v.kind).toBe('no-way');
  });
});

describe('a part that comes off', () => {
  it('is not mentioned below the band, where the body without it still has no way in', () => {
    const v = decide(withLegs(true), { doorWidth: 65, doorHeight: 200 });
    expect(v.kind).toBe('no-way');
    expect(v.part).toBeUndefined();
    expect(v.route).toBeUndefined();
  });

  it('is not mentioned above the band, where the body as sold has a way in', () => {
    const v = decide(withLegs(true), { doorWidth: 84, doorHeight: 200 });
    expect(v.kind).toBe('conditions');
    expect(v.route!.partOff).toBeUndefined();
    expect(v.part).toBeUndefined();
  });

  it('is the way in inside the band, when the listing says it comes off, and the answer says so', () => {
    const v = decide(withLegs(true), { doorWidth: 80, doorHeight: 200 });
    expect(v.kind).toBe('conditions');
    expect(v.route!.partOff).toBe('legs');
    expect(v.part).toEqual({ part: 'legs', established: true, doorNeed: 70.01, withOnNeed: 82.74, kind: 'conditions' });
    expect(presented(v)).toBe('on-its-side');
    // Behind a wall the lean is not measured for, "with the legs on" is the next way in, not the lean.
    const thick = decide(withLegs(true), { doorWidth: 80, doorHeight: 200, wallThickness: 40 });
    expect(thick.part!.withOnNeed).toBeCloseTo(85.01, 2);
  });

  it('is a question inside the band when nobody knows, and is acted on only after a yes', () => {
    const asked = decide(withLegs('unknown'), { doorWidth: 80, doorHeight: 200 });
    expect(asked.kind).toBe('no-way');
    expect(asked.route).toBeUndefined();
    expect(asked.part).toEqual({ part: 'legs', established: false, doorNeed: 70.01, withOnNeed: 82.74, kind: 'conditions' });

    const yes = decide(withLegs('unknown'), { doorWidth: 80, doorHeight: 200, partsOff: ['legs'] });
    expect(yes.kind).toBe('conditions');
    expect(yes.route!.partOff).toBe('legs');
    expect(yes.part!.established).toBe(true);

    const no = decide(withLegs('unknown'), { doorWidth: 80, doorHeight: 200, partsOn: ['legs'] });
    expect(no.kind).toBe('no-way');
    expect(no.part).toBeUndefined();
    expect(no.routes.some((r) => r.partOff === 'legs')).toBe(false);
  });
});

describe('the wall', () => {
  it('is not mentioned when the answer is the same behind every wall a home has', () => {
    const v = decide(product(), { doorWidth: 90, doorHeight: 200 });
    expect(v.wallNote).toBeUndefined();
    expect(v.wallGiven).toBe(false);
    expect(v.wall).toBe(12);
  });

  it('is mentioned, with how thick a wall the answer holds for, where a thicker one changes it', () => {
    // 84 cm: the lean gets it through behind 12, 20 and 30 cm of wall, and
    // does not apply behind 40.
    const v = decide(product(), { doorWidth: 84, doorHeight: 200 });
    expect(v.kind).toBe('conditions');
    expect(presented(v)).toBe('lean');
    expect(v.wallNote).toBeDefined();
    expect(v.wallNote!.holdsUpTo).toBe(30);
    expect(v.wallNote!.then!.kind).toBe('no-way');
  });

  it('carries a requirement that grows behind a thicker wall on the requirement, not as a changed answer', () => {
    // The lean's ceiling: 244 behind 12, 20 and 30 cm in this table — but
    // its height need grows 112 → 125 → 148, all under a 200 cm door, so
    // the answer is the same and no condition grows. Give the lean a
    // ceiling that grows and the condition says so.
    const grows = product({
      assembled: carry('sofa', SOFA_3_SEAT, [
        perWall('lean', 5, [
          [12, need(82.74, 112, 236, 197.5, 236, 215)],
          [20, need(82.72, 125, 236, 197.5, 236, 229)],
          [30, need(82.72, 147.96, 236, 197.5, 236, 244)],
          [40, need(82.72, 160, 236, 197.5, 236, 250)],
        ]),
      ]),
    });
    const v = decide(grows, { doorWidth: 84, doorHeight: 200 });
    expect(v.kind).toBe('conditions');
    // The same way in behind every wall a home has: no "thicker than that".
    expect(v.wallNote).toEqual({ holdsUpTo: 40 });
    const ceiling = v.conditions.find((c) => c.key === 'ceilingHeight')!;
    expect(ceiling.need).toBe(215);
    expect(ceiling.behindThicker).toEqual({ need: 250, wall: 40 });
    // The ones that do not grow say nothing.
    expect(v.conditions.find((c) => c.key === 'hallwayClearance')!.behindThicker).toBeUndefined();
  });

  it('is mentioned where the thickness moves a height, too', () => {
    // A 120 cm door: the lean needs 112 behind 12 cm and 125 behind 20.
    const v = decide(product(), { doorWidth: 84, doorHeight: 120 });
    expect(v.kind).toBe('conditions');
    expect(v.wallNote!.holdsUpTo).toBe(12);
  });

  it('answers for the wall given, without a scan, and says what is not measured for it', () => {
    const v = decide(product(), { doorWidth: 84, doorHeight: 200, wallThickness: 45 });
    expect(v.wallGiven).toBe(true);
    expect(v.wall).toBe(45);
    expect(v.wallNote).toBeUndefined();
    expect(v.kind).toBe('no-way');
    expect(v.unmeasured.map((u) => [u.maneuver.templateId, u.openingPasses])).toEqual([
      ['lean', true],
      ['upright-through', false],
      ['upright-left-standing', false],
    ]);
    expect(v.unmeasured[0]!.holdsUpTo).toBe(30);
  });

  it('uses the next thicker measurement for a wall between two', () => {
    const v = decide(product(), { doorWidth: 84, doorHeight: 200, wallThickness: 25 });
    expect(v.kind).toBe('conditions');
    expect(v.route!.carries[0]!.presented!.variant!.wallCm).toBe(30);
  });
});

describe('a sofa that comes apart', () => {
  it('every module has to get through, and the one that needs the most decides', () => {
    const v = decide(cornerSofa(), { doorWidth: 90, doorHeight: 199 });
    expect(v.kind).toBe('conditions');
    expect(v.route!.id).toBe('modules');
    expect(v.route!.need!.doorWidth).toBeCloseTo(85.01, 2);
    expect(v.route!.need!.hallwayClearance).toBe(278);
  });

  it('is not taken apart on paper when the listing does not say it comes apart', () => {
    const v = decide(product({ ...cornerSofa(), separates: 'unknown' }), { doorWidth: 90, doorHeight: 199 });
    expect(v.kind).toBe('no-way');
    expect(v.routes.map((r) => r.id)).toEqual(['assembled']);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same numbers, every time', () => {
    const have: Have = { doorWidth: 84, doorHeight: 200 };
    const a = JSON.stringify(decide(withLegs(true), have));
    const b = JSON.stringify(decide(withLegs(true), have));
    expect(a).toBe(b);
  });

  it('knows the narrowest doorway any route clears', () => {
    expect(narrowestKnown(withLegs(true))).toBeCloseTo(70.01, 2);
    expect(narrowestKnown(withLegs('unknown'))).toBeCloseTo(82.74, 2);
  });
});
