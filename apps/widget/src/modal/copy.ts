/**
 * Every word the shopper reads, in one place.
 *
 * Nothing in here decides anything. `verdict.ts` establishes what the numbers
 * say; this file puts it into words, and it can be rewritten without a
 * comparison changing. The rules the words follow:
 *
 * - One verdict line and one supporting line. The supporting line always
 *   puts the threshold and the shopper's own number side by side.
 * - The honesty stays, in one small line: a way in not found is not a way in
 *   that does not exist, and only the proof says otherwise.
 * - Everything else — the other ways in, the wall, the floor, the fine
 *   print — is behind a disclosure.
 * - A wall thickness a house does not have is never printed.
 *
 * Numbers: a requirement is shown to a tenth, rounded up, so it never reads
 * smaller than it is; the shopper's own number is shown as they gave it.
 */
import type { Key } from '../types.ts';
import type { Condition, Kind, Nearest, Proof, Verdict } from './verdict.ts';

/* ------------------------------------------------------------------------ */
/* Numbers                                                                   */

/** A shopper's number, as given, to a tenth. */
export function cm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A requirement: to a tenth, rounded up, never smaller than the measurement. */
export function need(value: number): string {
  const rounded = Math.ceil(value * 10 - 1e-6) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/* ------------------------------------------------------------------------ */
/* The button (also imported by the loader, on its own, to keep it small)    */

export const BUTTON_LABEL = 'Will it fit through my door?';

/* ------------------------------------------------------------------------ */
/* Measurements                                                              */

export const KEY_LABEL: Record<Key, string> = {
  doorWidth: 'Doorway width',
  doorHeight: 'Doorway height',
  hallwayClearance: 'In front of the door',
  alongWall: 'Along the wall',
  roomDepth: 'Behind the door',
  ceilingHeight: 'Ceiling',
};

/** How to take the measurement, in one line each. */
export const KEY_HINT: Record<Key, string> = {
  doorWidth: 'The clear width of the doorway, jamb to jamb — at the narrowest doorway on the way in.',
  doorHeight: 'Floor to the underside of the door frame.',
  hallwayClearance: 'Clear floor straight back from the door, on the side the sofa arrives from.',
  alongWall: 'How far the hallway runs along the wall past the door, left to right, in total.',
  roomDepth: 'Clear floor straight in from the door, on the far side.',
  ceilingHeight: 'Floor to ceiling, on the way in and just inside.',
};

/** A requirement in a sentence: "222 cm of clear floor in front of the door". */
export function needPhrase(key: Key, value: number): string {
  const n = need(value);
  switch (key) {
    case 'doorWidth':
      return `a doorway ${n} cm wide`;
    case 'doorHeight':
      return `a doorway ${n} cm tall`;
    case 'hallwayClearance':
      return `${n} cm of clear floor in front of the door`;
    case 'alongWall':
      return `${n} cm along the wall`;
    case 'roomDepth':
      return `${n} cm of clear floor behind the door`;
    case 'ceilingHeight':
      return `a ceiling of ${n} cm`;
  }
}

/** A condition in the supporting line, with how it grows behind a thicker wall where it does. */
export function conditionPhrase(c: Condition): string {
  const base = needPhrase(c.key, c.need);
  if (c.behindThicker === undefined) return base;
  return `${base} (${need(c.behindThicker.need)} behind a ${cm(c.behindThicker.wall)} cm wall)`;
}

/** The same, shorter, for the trade-off line and the table: "222 cm in front". */
export function needShort(key: Key, value: number): string {
  const n = need(value);
  switch (key) {
    case 'doorWidth':
      return `a ${n} cm door`;
    case 'doorHeight':
      return `a ${n} cm tall door`;
    case 'hallwayClearance':
      return `${n} cm in front`;
    case 'alongWall':
      return `${n} cm along the wall`;
    case 'roomDepth':
      return `${n} cm behind`;
    case 'ceilingHeight':
      return `a ${n} cm ceiling`;
  }
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------------ */
/* The modal                                                                 */

export const MODAL = {
  eyebrow: 'Fit check',
  close: 'Close',
  closeGlyph: '×',
  dims: (length: number, depth: number, height: number): string => `${cm(length)} × ${cm(depth)} × ${cm(height)} cm`,
  loading: 'Loading…',
  couldNotLoad: 'The fit check could not load for this product.',
  nothingComputed: 'Nothing was computed. This is a loading problem, not an answer.',
};

export const FORM = {
  lead: 'Measure the narrowest doorway on the way in.',
  width: KEY_LABEL.doorWidth,
  height: KEY_LABEL.doorHeight,
  unit: 'cm',
  check: 'Check',
  saved: 'Saved for this store',
  kept: 'Kept for this visit only',
  startOver: 'Start over',
  invalid: (label: string, min: number, max: number): string => `${label}: a number in centimetres, ${min}–${max}.`,
  missing: 'Both numbers, in centimetres.',
};

/* ------------------------------------------------------------------------ */
/* The verdict                                                               */

export interface Headline {
  title: string;
  /** The threshold and the shopper's number, side by side. */
  line: string;
  /** The one small line that keeps the honesty. Absent where there is nothing to keep. */
  honesty?: string;
}

function wayIn(verdict: Verdict): string {
  const route = verdict.route!;
  const parts: string[] = [];
  if (route.partOff !== undefined) parts.push(`with the ${route.partOff} off`);
  if (route.id === 'modules') parts.push(route.carries.length === 2 ? 'in two pieces' : `in ${route.carries.length} pieces`);
  return parts.length === 0 ? '' : ` — ${parts.join(', ')}`;
}

function opening(verdict: Verdict): string {
  const have = verdict.have;
  const route = verdict.route!;
  return `Needs ${need(route.need!.doorWidth)} × ${need(route.need!.doorHeight)} cm; yours is ${cm(have.doorWidth!)} × ${cm(have.doorHeight!)}.`;
}

function mannerOf(verdict: Verdict): string {
  const route = verdict.route!;
  if (route.carries.length === 1) {
    const m = route.carries[0]!.presented!.maneuver;
    return `${m.name}, in ${m.stages.length} ${m.stages.length === 1 ? 'step' : 'steps'}.`;
  }
  return route.carries
    .map((c) => `${c.carry.name}: ${c.presented!.maneuver.name.toLowerCase()}`)
    .join('; ') + '.';
}

const NO_WAY_TITLE: Record<Key, string> = {
  doorWidth: 'Not through this door',
  doorHeight: 'Not through this door',
  hallwayClearance: 'Not with this much room in front of the door',
  alongWall: 'Not with this much wall beside the door',
  roomDepth: 'Not with this much room behind the door',
  ceilingHeight: 'Not under this ceiling',
};

function noWayTitle(nearest: Nearest | undefined): string {
  if (nearest === undefined || nearest.short.length === 0) return 'Not through this door';
  const keys = nearest.short.map((s) => s.key);
  if (keys.every((k) => k === 'doorWidth' || k === 'doorHeight')) return 'Not through this door';
  if (keys.length === 1) return NO_WAY_TITLE[keys[0]!];
  return 'Not with these numbers';
}

/** What the no-way line calls the product. One word to change when the catalogue is not sofas. */
export const SUBJECT = 'This sofa';

function noWayLine(verdict: Verdict): string {
  const nearest = verdict.nearest;
  const name = SUBJECT;
  if (nearest === undefined) return `${name} has no known way in.`;
  const short = nearest.short;
  const modifier = nearest.route.partOff !== undefined ? ` with the ${nearest.route.partOff} off` : '';
  if (short.length === 1 && short[0]!.key === 'doorWidth') {
    return `${name} needs ${need(short[0]!.need)} cm${modifier}. Yours is ${cm(short[0]!.have)}.`;
  }
  if (short.length === 2 && short[0]!.key === 'doorWidth' && short[1]!.key === 'doorHeight') {
    return `${name} needs ${need(short[0]!.need)} × ${need(short[1]!.need)} cm${modifier}. Yours is ${cm(short[0]!.have)} × ${cm(short[1]!.have)}.`;
  }
  if (short.length === 1) return `Needs ${needPhrase(short[0]!.key, short[0]!.need)}${modifier}. Yours is ${cm(short[0]!.have)}.`;
  return `Needs ${list(short.map((s) => needShort(s.key, s.need)))}${modifier}. Yours: ${list(short.map((s) => cm(s.have)))}.`;
}

function noWayHonesty(verdict: Verdict): string {
  const short = verdict.nearest?.short[0];
  const at = short === undefined ? '' : ` at ${cm(short.have)} cm`;
  let line = `We haven’t found a way in${at} — that doesn’t prove there isn’t one.`;
  const u = verdict.wallGiven ? verdict.unmeasured.find((entry) => entry.openingPasses) : undefined;
  if (u !== undefined) {
    line += ` “${u.maneuver.name}” would, behind a wall up to ${cm(u.holdsUpTo)} cm; it is not measured behind ${cm(verdict.wall)}.`;
  }
  return line;
}

function provenLine(proof: Proof, name: string): string {
  const [p, q] = proof.crossSection;
  const [w, h] = proof.opening;
  const part = proof.boxLabel === undefined ? `Part of the ${name}` : `The ${proof.boxLabel.replace(/^the /, '')} of the ${name}`;
  return `${part} is ${need(p)} × ${need(q)} cm at its thinnest; no angle gets that through ${cm(w)} × ${cm(h)}.`;
}

export function headline(verdict: Verdict, productName: string): Headline {
  switch (verdict.kind) {
    case 'needs-opening':
      return { title: 'Two numbers', line: FORM.lead };
    case 'fits':
      return {
        title: `Fits through this door${wayIn(verdict)}`,
        line: `${opening(verdict)} ${mannerOf(verdict)}`,
      };
    case 'conditions': {
      const then = verdict.conditions.map((c) => conditionPhrase(c));
      return {
        title: `There is a way in${wayIn(verdict)}`,
        line: `${opening(verdict)} Then ${list(then)}.`,
      };
    }
    case 'no-way':
      return {
        title: noWayTitle(verdict.nearest),
        line: noWayLine(verdict),
        honesty: noWayHonesty(verdict),
      };
    case 'proven':
      return {
        title: 'Not through this door',
        line: provenLine(verdict.proof!, productName),
        honesty: 'This one is certain: it follows from the shape, with no search in it.',
      };
  }
}

/** The way in's own steps, as instructions. */
export const STEPS = {
  title: 'How it goes in',
  drawn: (wall: number, measured: Key[], fromNeed: Key[]): string =>
    (measured.length > 0 && fromNeed.length === 0
      ? 'Drawn in a room from your numbers'
      : `Drawn in a room from your numbers (${measured.map((k) => KEY_LABEL[k].toLowerCase()).join(', ')}) and, for the rest, from what this way in needs`) +
    `, with a ${cm(wall)} cm wall. Re-checked against the collision test in this scene before it was drawn.`,
  loading: 'Loading the 3D view…',
  noMotion: 'No motion is recorded for this way in, so nothing is drawn.',
  notFetched: 'The motion could not be fetched, so nothing is drawn. The answer does not depend on it.',
  notVerified: (fault: string): string => `The motion could not be re-verified in this scene (${fault}), so it is not drawn.`,
  notLoaded: 'The 3D view could not be loaded. The answer does not depend on it.',
  cannotBuild: (reason: string): string => `This scene cannot be built: ${reason}`,
  orbit: 'Drag to orbit · scroll to zoom',
  pause: 'Pause',
  play: 'Play',
  topDown: 'Top-down',
  scrub: 'Scrub the maneuver',
  animated: (name: string): string => `${name}, animated`,
};

/** Requirements the shopper may enter. */
export const CONDITIONS = {
  lead: 'Have those? Enter them and the answer settles.',
  given: 'You entered:',
  forget: 'forget',
  placeholder: (value: number): string => `≥ ${need(value)}`,
  update: 'Update',
  close: (items: { key: Key; margin: number }[]): string =>
    `Close: ${list(items.map((i) => `${cm(i.margin)} cm to spare on the ${KEY_LABEL[i.key].toLowerCase()}`))}. Worth measuring again.`,
};

export function tradeoffLine(verdict: Verdict): string | undefined {
  const t = verdict.tradeoff;
  if (t === undefined) return undefined;
  const dropped = t.less.filter((c) => c.dropped);
  const eased = t.less.filter((c) => !c.dropped);
  const parts: string[] = [];
  if (dropped.length > 0) parts.push(`no need for ${list(dropped.map((c) => needShort(c.key, c.was)))}`);
  for (const c of eased) parts.push(`${needShort(c.key, c.need)} instead of ${need(c.was)}`);
  const more = list(t.more.map((c) => needShort(c.key, c.need)));
  return `Or ${t.maneuver.name.toLowerCase()}: ${list(parts)}, but ${more}.`;
}

/* ------------------------------------------------------------------------ */
/* The part, and the wall                                                    */

export const PART = {
  /** Under a headline that already says "with the legs off". */
  withOn: (part: string, doorNeed: number): string => `With the ${part} on it needs ${need(doorNeed)} cm.`,
  question: (part: string, doorNeed: number): string => `Do the ${part} come off? Without them it needs ${need(doorNeed)} cm.`,
  yes: (part: string): string => `Yes, the ${part} come off`,
  no: 'No',
  undo: (part: string): string => `Keep the ${part} on`,
};

function summarize(verdict: Verdict): string {
  switch (verdict.kind) {
    case 'fits':
    case 'conditions': {
      const route = verdict.route!;
      const size = `${need(route.need!.doorWidth)} × ${need(route.need!.doorHeight)} cm`;
      if (route.partOff !== undefined) return `the way in is with the ${route.partOff} off, needing ${size}`;
      if (route.id === 'modules') return `the way in is in pieces, needing ${size}`;
      const way = route.carries.length === 1 ? ` — ${route.carries[0]!.presented!.maneuver.name.toLowerCase()}` : '';
      return `it needs ${size}${way}`;
    }
    case 'no-way':
    case 'proven':
      return 'it is not through this door';
    case 'needs-opening':
      return '';
  }
}

export const WALL = {
  label: 'Wall thickness',
  note: (holdsUpTo: number, then: Verdict | undefined): string =>
    then === undefined
      ? 'The same behind any wall a home has; the figure in brackets is for a thicker one.'
      : `For a wall up to ${cm(holdsUpTo)} cm thick. Thicker than that, ${summarize(then)}.`,
  given: (wall: number): string => `For your ${cm(wall)} cm wall.`,
  ask: 'My wall is thicker',
  use: 'Use this wall',
  forget: 'Back to an ordinary wall',
  invalid: 'Wall thickness: a number in centimetres, 3–200.',
};

/* ------------------------------------------------------------------------ */
/* Behind the disclosure                                                     */

export const DETAILS = {
  summary: 'See all the ways in',
  none: '—',
  columns: {
    maneuver: 'Way in',
    opening: 'Door w × h',
    front: 'In front',
    along: 'Along',
    behind: 'Behind',
    ceiling: 'Ceiling',
    yours: 'Against yours',
  },
  steps: (count: number): string => `${count} ${count === 1 ? 'step' : 'steps'}`,
  turns: 'turns in the opening',
  status: {
    fits: 'fits',
    open: (keys: Key[]): string => `open: ${keys.map((k) => KEY_LABEL[k].toLowerCase()).join(', ')} not given`,
    ruledOut: (keys: Key[]): string => `short on ${keys.map((k) => KEY_LABEL[k].toLowerCase()).join(', ')}`,
    unmeasured: (wall: number, holdsUpTo: number): string => `not measured for a ${cm(wall)} cm wall; holds to ${cm(holdsUpTo)}`,
  },
  route: {
    assembled: 'As one piece',
    modules: 'Taken apart',
    withoutPart: (part: string): string => `With the ${part} off`,
    body: (name: string, length: number, depth: number, height: number): string => `${name}, ${MODAL.dims(length, depth, height)}`,
  },
  separatesUnknown: (name: string): string =>
    `Whether the ${name} comes apart is not in the listing. If it does, it is carried in as smaller pieces; ask the retailer.`,
  floor: (narrowest: number, floor: number): string => {
    if (narrowest < floor - 0.1) {
      return `The narrowest doorway any way in here clears is ${need(narrowest)} cm, under the ${need(floor)} cm that any way of rolling it as it goes could manage — by leaning it, which is not a roll. A measured way in, not a limit.`;
    }
    if (narrowest - floor < 0.1) {
      return `The narrowest doorway any way in here clears is ${need(narrowest)} cm, which is as narrow as any way of rolling it as it goes could manage. That limit says nothing about leaning or turning it inside the doorway.`;
    }
    return `The narrowest doorway any way in here clears is ${need(narrowest)} cm; rolling it as it goes could in principle manage ${need(floor)}, by a maneuver nobody has written yet.`;
  },
  wall: (wall: number, anyWall: string[], thisWall: string[]): string => {
    if (thisWall.length === 0) return `Measured behind a ${cm(wall)} cm wall; every way in needs the same doorway behind any wall.`;
    if (anyWall.length === 0) return `Measured behind a ${cm(wall)} cm wall, and not behind a thicker one.`;
    return `Measured behind a ${cm(wall)} cm wall. ${list(anyWall.map((n) => `“${n}”`))} need${anyWall.length === 1 ? 's' : ''} the same doorway behind any wall; ${list(thisWall.map((n) => `“${n}”`))} ${thisWall.length === 1 ? 'is' : 'are'} measured for this one and thicker ones as listed.`;
  },
  meaning: [
    ['Fits', 'a way in validated against the collision test, whose every requirement your numbers meet.'],
    ['There is a way in', 'the doorway is enough; the rest of what that way in needs is listed, not assumed.'],
    ['Not through this door', 'nothing on our list of validated ways in works for these numbers — a fact about the list, unless the line under it says it is a proof.'],
  ] as [string, string][],
  disclaimer: 'Not a substitute for the delivery team’s judgement on the day: doors, handles, skirting boards and stairs are not modelled.',
};

export type { Condition, Kind };
