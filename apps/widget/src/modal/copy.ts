/**
 * Where the modal's integrity lives: every sentence that states what was
 * established, in one place, so the honesty distinctions cannot drift apart
 * across a dozen render functions.
 *
 *  - **Fits** means a validated maneuver whose every requirement the shopper's
 *    numbers meet. Nothing else is called that.
 *  - **No known maneuver fits** means the library has nothing for these
 *    numbers. It is a statement about the list, never about the sofa.
 *  - **Proven** means the closed-form proof fired. It is the only negative
 *    allowed to read as a verdict.
 *  - **Open** means the answer is not settled and one more number would move
 *    it. The copy says which number, and why it is being asked for.
 */
import type { Carry, MeasurementKey, WidgetManeuver, WidgetProduct } from '../types.ts';
import type { Answer, CarryAssessment, Have, Question, Verdict } from './assess.ts';
import { cm, need } from './dom.ts';

export const KEY_LABEL: Record<MeasurementKey, string> = {
  doorWidth: 'Doorway width',
  doorHeight: 'Doorway height',
  hallwayClearance: 'In front of the door',
  alongWall: 'Along the wall',
  roomDepth: 'Behind the door',
};

export const KEY_SHORT: Record<MeasurementKey, string> = {
  doorWidth: 'door width',
  doorHeight: 'door height',
  hallwayClearance: 'in front',
  alongWall: 'along the wall',
  roomDepth: 'behind',
};

/** How to take the measurement, in one line each. */
export const KEY_HINT: Record<MeasurementKey, string> = {
  doorWidth: 'The clear width of the doorway, jamb to jamb — or the narrowest point on the way in, if there is one.',
  doorHeight: 'Floor to the underside of the door frame.',
  hallwayClearance: 'Clear floor straight back from the door, on the side the sofa arrives from.',
  alongWall: 'How far the hallway runs along the wall past the door, left to right, in total.',
  roomDepth: 'Clear floor straight in from the door, on the far side.',
};

export type Tone = 'fits' | 'open' | 'not-found' | 'proven';

export const TONE: Record<Verdict, Tone> = {
  fits: 'fits',
  open: 'open',
  'not-in-library': 'not-found',
  proven: 'proven',
};

export const PILL: Record<Verdict, string> = {
  fits: 'Fits',
  open: 'Not settled yet',
  'not-in-library': 'No known maneuver',
  proven: "Won't fit — proven",
};

/** The name a shopper reads for a body: the product's, or the module's. */
export function carryName(product: WidgetProduct, carry: Carry): string {
  return carry.id === product.assembled.id ? product.name : carry.name;
}

/** The part named in a proof, from the box the engine pointed at. */
export function provenPart(assessment: CarryAssessment): string {
  const index = assessment.proof?.boxIndex;
  const label = index === undefined ? undefined : assessment.carry.item.boxes[index]?.label;
  return label ?? 'one of its parts';
}

export interface Headline {
  title: string;
  /** One line under it. Never overstates what was established. */
  note: string;
}

export function headline(answer: Answer): Headline {
  const a = answer.assembled;
  const chosen = a.chosen;
  const width = answer.have.doorWidth;

  switch (a.verdict) {
    case 'fits': {
      const m = chosen!.maneuver;
      return {
        title: 'Fits',
        note:
          `By the “${m.name}” maneuver, in ${m.stages.length} stage${m.stages.length === 1 ? '' : 's'}. ` +
          'Every one of its requirements is met by what you entered — validated offline, placement by placement, against the collision test.',
      };
    }
    case 'proven': {
      const proof = a.proof!;
      const [p, q] = proof.crossSection ?? [0, 0];
      const opening = width?.exact ? `${cm(width.value)} cm` : 'this';
      return {
        title: 'Won’t fit — proven',
        note:
          `Established in closed form, with no search: ${provenPart(a)} is ${cm(p)} × ${cm(q)} cm at its smallest face, ` +
          `and no angle whatsoever gets that through a ${opening} opening.`,
      };
    }
    case 'not-in-library': {
      const narrowest = a.carry.narrowestCm;
      const floor = a.carry.floorCm;
      const atFloor = narrowest !== undefined && floor !== undefined && Math.abs(narrowest - floor) < 0.1;
      const underFloor = narrowest !== undefined && floor !== undefined && narrowest < floor - 0.1;
      const shortOn = shortfallSummary(a);
      return {
        title: 'No known maneuver fits these numbers',
        note:
          'That is a statement about our list of validated maneuvers, not a proof about the sofa. ' +
          (narrowest !== undefined ? `The narrowest doorway any of them clears is ${need(narrowest)} cm` : 'None of them clears any doorway') +
          (atFloor ? ', and no way of rolling it as it goes does better than that' : '') +
          (underFloor ? ` — already under the ${need(floor!)} cm that rolling alone could manage, by leaning` : '') +
          (shortOn !== undefined ? `. ${shortOn}` : '.'),
      };
    }
    case 'open': {
      if (width === undefined) {
        return {
          title: 'Start with one number',
          note: 'The doorway width decides the answer for most sofas on its own. Everything else is asked for only if it matters.',
        };
      }
      const m = chosen!.maneuver;
      if (chosen!.wallUnknown && answer.have.wallThickness !== undefined) {
        const left = chosen!.unknown.length;
        return {
          title: 'Not measured for a wall this thick',
          note:
            `${left === 0 ? 'Every number you gave meets' : 'Nothing you gave rules out'} what the “${m.name}” maneuver needs — but those needs were established behind a wall ` +
            `${m.holdsForWallsUpTo} cm thick, and yours is ${cm(answer.have.wallThickness)}. A thicker wall is strictly harder. ` +
            'Nothing here says it fails, and nothing here says it fits; the library would have to be built for a thicker wall to say either' +
            (left > 0 ? ', so the remaining numbers are not asked for' : '') +
            '.',
        };
      }
      const margin = chosen!.margins.doorWidth;
      const just = a.marginal.includes('doorWidth');
      return {
        title: just ? 'The doorway is wide enough — just' : 'The doorway is wide enough',
        note:
          `For the “${m.name}” maneuver, which needs ${need(m.requirement.doorWidth)} cm; ` +
          `you have ${cm(width.value)}${width.exact ? '' : ' or more'}` +
          (just && margin !== undefined ? `, a margin of ${cm(margin)} cm — worth measuring again` : '') +
          '. Not settled yet: the rest of the corridor has to be checked too.',
      };
    }
  }
}

/**
 * What the library's maneuvers fell short on, in the fewest words.
 *
 * Only the closest misses count: a maneuver two numbers short says less
 * about what would change the answer than one a single number short, and
 * quoting the former's door width beside the latter's hallway would read as
 * though both had to change.
 */
function shortfallSummary(assessment: CarryAssessment): string | undefined {
  const misses = assessment.maneuvers.filter((m) => m.status === 'ruled-out');
  if (misses.length === 0) return undefined;
  const fewest = Math.min(...misses.map((m) => m.unmet.length));
  const seen = new Set<string>();
  const lines: string[] = [];
  const closest = misses
    .filter((m) => m.unmet.length === fewest)
    .sort((a, b) => {
      const total = (m: typeof a): number => m.unmet.reduce((sum, key) => sum + m.maneuver.requirement[key], 0);
      return total(a) - total(b);
    });
  for (const m of closest) {
    const what = m.unmet.map((key) => `${need(m.maneuver.requirement[key])} cm ${KEY_SHORT[key]}`).join(' and ');
    if (seen.has(what)) continue;
    seen.add(what);
    lines.push(`“${m.maneuver.name}” needs ${what}`);
  }
  if (lines.length === 0) return undefined;
  return `Closest: ${lines.slice(0, 3).join('; ')}.`;
}

export interface QuestionCopy {
  /** Why this is being asked, given what is already known. */
  lead: string;
  /** The question itself. */
  ask: string;
  /** What the maneuver being pursued needs, for the confirm button. */
  confirm: string;
}

export function questionCopy(answer: Answer, question: Question): QuestionCopy {
  const { key, needsCm, maneuver, carry } = question;
  const product = answer.product;
  const body = carryName(product, carry);
  const pursuing =
    carry.id === product.assembled.id
      ? ''
      : product.modules?.some((m) => m.id === carry.id)
        ? ` for the ${carry.name}, the module that decides it`
        : ` with the ${carry.name.replace(/^.*without the /, '')} off`;

  const established =
    answer.have.doorWidth === undefined
      ? ''
      : answer.assembled.verdict === 'open'
        ? `Your door is wide enough${answer.assembled.marginal.includes('doorWidth') ? ', just' : ''}. `
        : `As one piece, nothing in the library fits your door; ${body} can still go in${pursuing}. `;

  const because = `The “${maneuver.name}” maneuver needs ${need(needsCm)} cm ${KEY_SHORT[key] === 'in front' ? 'of clear floor in front of the door' : KEY_SHORT[key]}`;

  switch (key) {
    case 'doorWidth':
      return {
        lead: 'One number to start.',
        ask: 'How wide is the doorway?',
        confirm: `At least ${need(needsCm)} cm`,
      };
    case 'hallwayClearance':
      return {
        lead: `${established}Now I need to know whether there is room to line it up.`,
        ask: `How much clear floor is there in front of the door? ${because}${maneuver.requirement.hallwayClearance >= carry.dimensions.length - 1 ? ' — that is the sofa’s own length, held square to the doorway' : ''}.`,
        confirm: `At least ${need(needsCm)} cm`,
      };
    case 'alongWall':
      return {
        lead: `${established}Now I need to know whether there is room to turn it.`,
        ask: `How far does the hallway run along the wall past the door? ${because}, left to right in total.`,
        confirm: `At least ${need(needsCm)} cm`,
      };
    case 'roomDepth':
      return {
        lead: `${established}Now the far side.`,
        ask: `How deep is the room behind the door? ${because} straight in from it.`,
        confirm: `At least ${need(needsCm)} cm`,
      };
    case 'doorHeight':
      return {
        lead: `${established}One more: the height.`,
        ask: `How tall is the doorway? ${because}${needsCm > 200 ? ' — taller than a standard door, because this maneuver takes it through on end' : ''}.`,
        confirm: `At least ${need(needsCm)} cm`,
      };
  }
}

/** The one-card version, when everything left is ordinary. */
export function bundleCopy(answer: Answer, question: Question): { lead: string; ask: string } {
  const { maneuver, carry } = question;
  const product = answer.product;
  const count = question.bundle?.length ?? 0;
  const pursuing =
    carry.id === product.assembled.id
      ? ''
      : product.modules?.some((m) => m.id === carry.id)
        ? ` for the ${carry.name}`
        : ` with the ${carry.name.replace(/^.*without the /, '')} off`;
  return {
    lead: `${answer.have.doorWidth !== undefined && answer.assembled.verdict === 'open' ? 'Your door is wide enough. ' : ''}${count === 2 ? 'Two' : count === 3 ? 'Three' : count === 4 ? 'Four' : String(count)} ordinary things it also needs.`,
    ask: `Does your home have all of these? The “${maneuver.name}” maneuver${pursuing} needs nothing else.`,
  };
}

/**
 * The wall assumption for the maneuver in hand, in one line.
 *
 * Every figure was measured behind a wall of a stated thickness, and thicker
 * is strictly harder. A maneuver rebuilt behind a 100 cm wall that needed the
 * same doorway holds for any wall a house has; one that was not is stated as
 * holding only up to the thickness it was measured at.
 */
export function wallLine(maneuver: WidgetManeuver, have: Have): string {
  const measured = maneuver.wallThickness;
  const holds = maneuver.holdsForWallsUpTo;
  const yours = have.wallThickness;
  const own = yours === undefined ? '' : ` Your wall: ${cm(yours)} cm.`;
  if (holds > measured) {
    return `Holds for any wall up to ${holds} cm thick (measured behind ${measured} cm, and again behind ${holds}: the same doorway).${own}`;
  }
  return `Assumes a wall no thicker than ${measured} cm — a thicker wall is strictly harder and has not been measured for this maneuver.${own}`;
}

/** A carry's verdict in one line, for the routes section. */
export function carryLine(assessment: CarryAssessment): string {
  switch (assessment.verdict) {
    case 'fits':
      return `Fits — by “${assessment.chosen!.maneuver.name}”.`;
    case 'open': {
      const q = assessment.next!;
      return `Open — needs ${need(q.needsCm)} cm ${KEY_SHORT[q.key]} for “${q.maneuver.name}”; not checked yet.`;
    }
    case 'not-in-library':
      return 'No known maneuver fits your numbers.';
    case 'proven':
      return 'Proven impossible, in closed form.';
  }
}

export const WALL_LABEL = 'Wall thickness';

export const LEGEND: [string, string][] = [
  ['Fits', 'a maneuver validated offline against the collision test, whose every requirement your numbers meet.'],
  ['No known maneuver', 'our list has nothing for these numbers. That is a fact about the list, not a proof about the sofa.'],
  ['Proven', 'a closed-form geometric argument, with no search in it — the only negative that is a verdict.'],
  ['Not settled yet', 'a number is still missing, and the answer could go either way until it is given.'],
];
