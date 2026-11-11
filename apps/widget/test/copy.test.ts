import { describe, expect, it } from 'vitest';
import { SOFA_BED } from '@fitpath/engine';
import {
  BUTTON_LABEL,
  CONDITIONS,
  DETAILS,
  FORM,
  KEY_HINT,
  KEY_LABEL,
  MODAL,
  PART,
  STEPS,
  WALL,
  headline,
  need,
  tradeoffLine,
} from '../src/modal/copy.ts';
import { decide } from '../src/modal/verdict.ts';
import { anyWall, carry, cornerSofa, need as needOf, product, withLegs } from './support/library.ts';

/**
 * The words, checked for shape rather than wording, so the wording can be
 * revised freely: two lines, the threshold beside the shopper's number, the
 * honesty in one small line where it belongs, no metre-thick walls, and no
 * sentence shouted in capitals.
 */

/** Every string reachable from the copy tables, for the rules that apply to all of them. */
function everyString(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
  };
  walk([BUTTON_LABEL, MODAL, FORM, KEY_LABEL, KEY_HINT, CONDITIONS, STEPS, PART, WALL, DETAILS]);
  // Functions of the tables, called with representative numbers.
  out.push(
    WALL.note(30, decide(product(), { doorWidth: 84, doorHeight: 200, wallThickness: 40 })),
    WALL.given(25),
    CONDITIONS.close([{ key: 'doorWidth', margin: 1.3 }]),
    CONDITIONS.placeholder(222),
    PART.withOn('legs', 82.74),
    PART.question('legs', 70.01),
    STEPS.drawn(12, ['doorWidth'], ['hallwayClearance']),
    DETAILS.floor(82.74, 85),
    DETAILS.floor(85, 85),
    DETAILS.floor(90, 85),
    DETAILS.wall(12, ['Straight in'], ['Lean']),
    DETAILS.wall(12, ['Straight in'], []),
    DETAILS.status.unmeasured(45, 30),
  );
  return out;
}

const SHOUTED = /\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/;

describe('every string', () => {
  it('never prints a wall a house does not have', () => {
    for (const s of everyString()) expect(s, s).not.toMatch(/\b100 cm\b/);
  });

  it('never shouts a sentence in capitals', () => {
    for (const s of everyString()) expect(s, s).not.toMatch(SHOUTED);
  });

  it('never narrates the library at the shopper', () => {
    for (const s of everyString()) {
      expect(s.toLowerCase(), s).not.toContain('statement about our list');
      expect(s.toLowerCase(), s).not.toContain('validated maneuvers');
    }
  });
});

describe('numbers', () => {
  it('shows a requirement rounded up to a tenth, and never smaller than it is', () => {
    expect(need(82.72)).toBe('82.8');
    expect(need(85.01)).toBe('85.1');
    expect(need(95)).toBe('95');
    expect(need(122.18)).toBe('122.2');
    expect(need(70.01)).toBe('70.1');
  });
});

describe('the headline', () => {
  it('fits: two lines, with the threshold beside the number', () => {
    const v = decide(product(), { doorWidth: 100, doorHeight: 200, hallwayClearance: 250, roomDepth: 250 });
    const h = headline(v, '3-seat sofa');
    expect(h.title).toBe('Fits through this door');
    expect(h.line).toContain('95.1 × 85 cm');
    expect(h.line).toContain('100 × 200');
    expect(h.honesty).toBeUndefined();
  });

  it('a way in with conditions: the threshold beside the number, then the conditions as requirements', () => {
    const v = decide(product(), { doorWidth: 90, doorHeight: 200 });
    const h = headline(v, '3-seat sofa');
    expect(h.title).toBe('There is a way in');
    expect(h.line).toContain('Needs 85.1 × 95 cm; yours is 90 × 200.');
    expect(h.line).toContain('222 cm of clear floor in front of the door');
    expect(h.line).toContain('150 cm along the wall');
    expect(h.line).toContain('222 cm of clear floor behind the door');
    expect(h.honesty).toBeUndefined();
  });

  it('no known way in: the threshold beside the number, and the honesty in one line', () => {
    const v = decide(product(), { doorWidth: 80, doorHeight: 200 });
    const h = headline(v, '3-seat sofa');
    expect(h.title).toBe('Not through this door');
    expect(h.line).toBe('This sofa needs 82.8 cm. Yours is 80.');
    expect(h.honesty).toBe('We haven’t found a way in at 80 cm — that doesn’t prove there isn’t one.');
  });

  it('no known way in, on a corridor number: says which number, and both figures', () => {
    const v = decide(product(), { doorWidth: 100, doorHeight: 230, hallwayClearance: 110 });
    const h = headline(v, '3-seat sofa');
    expect(h.title).toBe('Not with this much room in front of the door');
    expect(h.line).toBe('Needs 122.2 cm of clear floor in front of the door. Yours is 110.');
  });

  it('proven: the same two lines, and the honesty says it is a proof', () => {
    const bed = product({ assembled: carry('bed', SOFA_BED, [anyWall('on-its-side', 3, needOf(90.01, 200, 102, 290, 102, 218))]) });
    const h = headline(decide(bed, { doorWidth: 40, doorHeight: 200 }), 'sofa bed');
    expect(h.title).toBe('Not through this door');
    expect(h.line).toContain('40 × 200');
    expect(h.line).toMatch(/at its thinnest/);
    expect(h.honesty).toContain('certain');
  });

  it('with a part off: the title says so, and the line has the number without it', () => {
    const v = decide(withLegs(true), { doorWidth: 80, doorHeight: 200 });
    const h = headline(v, '3-seat sofa');
    expect(h.title).toBe('There is a way in — with the legs off');
    expect(h.line).toContain('Needs 70.1 × 95 cm; yours is 80 × 200.');
  });

  it('in pieces: the title says so', () => {
    const h = headline(decide(cornerSofa(), { doorWidth: 90, doorHeight: 199 }), 'corner sofa');
    expect(h.title).toBe('There is a way in — in two pieces');
  });

  it('a wall given, with a way in not measured for it, is said in the honesty line', () => {
    const v = decide(product(), { doorWidth: 84, doorHeight: 200, wallThickness: 45 });
    const h = headline(v, '3-seat sofa');
    expect(h.honesty).toBe(
      'We haven’t found a way in at 84 cm — that doesn’t prove there isn’t one. “lean” would, behind a wall up to 30 cm; it is not measured behind 45.',
    );
  });
});

describe('the lines under it', () => {
  it('the trade-off, in one line, with what is dropped and what is added', () => {
    const line = tradeoffLine(decide(product(), { doorWidth: 100, doorHeight: 230 }))!;
    expect(line).toBe('Or straight-in: no need for 260.8 cm along the wall and a 233 cm ceiling, but 222 cm in front and 222 cm behind.');
  });

  it('the wall note says how thick a wall the answer holds for, and what a thicker one gives', () => {
    const v = decide(product(), { doorWidth: 84, doorHeight: 200 });
    expect(WALL.note(v.wallNote!.holdsUpTo, v.wallNote!.then)).toBe('For a wall up to 30 cm thick. Thicker than that, it is not through this door.');
    const wider = decide(product(), { doorWidth: 90, doorHeight: 130 });
    // On its side behind any wall; nothing about walls.
    expect(wider.wallNote).toBeUndefined();
    // Behind a thicker wall the way in becomes the one without the legs, and the note says so.
    const legs = decide(withLegs(true), { doorWidth: 84, doorHeight: 200 });
    expect(WALL.note(legs.wallNote!.holdsUpTo, legs.wallNote!.then)).toBe(
      'For a wall up to 30 cm thick. Thicker than that, the way in is with the legs off, needing 70.1 × 95 cm.',
    );
  });

  it('the part question carries the number without the part', () => {
    expect(PART.question('legs', 70.01)).toBe('Do the legs come off? Without them it needs 70.1 cm.');
  });
});
