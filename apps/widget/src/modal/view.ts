/**
 * The modal's body: the form, the verdict, the way in, and a disclosure.
 *
 * Everything here is a function of a `Verdict` and a handful of callbacks.
 * The state — which numbers the shopper has given — lives in `index.ts`, and
 * every change re-renders the body from scratch, which is cheap at this size
 * and removes a whole class of "the field says 90 but the verdict was for 80"
 * bugs. Every word comes from `copy.ts`; nothing here decides anything.
 */
import type { EnvironmentParams } from '@fitpath/engine';
import { KEYS, OPTIONAL_KEYS } from '../types.ts';
import type { Carry, Key, WallVariant, WidgetManeuver, WidgetProduct } from '../types.ts';
import type { CarryVerdict, Route, Verdict } from './verdict.ts';
import {
  CONDITIONS,
  DETAILS,
  FORM,
  KEY_HINT,
  KEY_LABEL,
  MODAL,
  PART,
  STEPS,
  WALL,
  cm,
  headline,
  need,
  tradeoffLine,
} from './copy.ts';
import { el, clear } from './dom.ts';

export interface ViewHandlers {
  onOpening(width: number, height: number): void;
  /** Optional numbers, set or cleared together. */
  onOptional(values: Partial<Record<Key, number | undefined>>): void;
  /** The shopper's wall thickness, or undefined to go back to the assumption. */
  onWall(thickness: number | undefined): void;
  onPartOff(part: string, off: boolean): void;
  onReset(): void;
  /** Mount the 3D view of a way in into a slot. Lazy; may reject. */
  mountStage(slot: HTMLElement, carry: Carry, maneuver: WidgetManeuver, variant: WallVariant, params: EnvironmentParams): void;
}

const KEY_MIN: Record<Key, number> = {
  doorWidth: 30,
  doorHeight: 60,
  hallwayClearance: 20,
  alongWall: 40,
  roomDepth: 20,
  ceilingHeight: 150,
};
const KEY_MAX = 1200;

/** How long a corridor is drawn when nobody measured it. Drawing only, never a requirement. */
const GENEROUS_ALONG_CM = 260;

export function renderHeader(product: WidgetProduct, onClose: () => void): HTMLElement {
  const thumb = el('div', { class: 'thumb', 'aria-hidden': 'true' });
  thumb.innerHTML = product.illustration;
  const d = product.assembled.dimensions;
  return el('div', { class: 'head' }, [
    thumb,
    el('div', { class: 'grow' }, [
      el('p', { class: 'eyebrow', text: MODAL.eyebrow }),
      el('h2', { id: 'fp-title', text: product.name }),
      el('p', { class: 'dims', text: MODAL.dims(d.length, d.depth, d.height) }),
    ]),
    el('button', { class: 'close', type: 'button', 'aria-label': MODAL.close, text: MODAL.closeGlyph, onclick: onClose }),
  ]);
}

export function renderBody(body: HTMLElement, product: WidgetProduct, verdict: Verdict, handlers: ViewHandlers, storageNote: string): void {
  clear(body);
  body.append(openingForm(verdict, handlers, storageNote));
  if (verdict.kind === 'needs-opening') return;

  body.append(verdictCard(product, verdict, handlers));

  const stage = stageFor(verdict);
  if (stage !== undefined) {
    const m = stage.maneuver;
    const slot = el('div', { class: 'card' }, [
      el('h3', {}, [
        STEPS.title,
        el('span', { class: 'badge', text: m.name }),
        stage.route.carries.length > 1 ? el('span', { class: 'badge badge-mod', text: stage.carry.name }) : null,
        stage.route.partOff !== undefined ? el('span', { class: 'badge badge-mod', text: DETAILS.route.withoutPart(stage.route.partOff) }) : null,
      ]),
      el('ol', { class: 'stages' }, m.stages.map((s) => el('li', { text: s.name }))),
    ]);
    body.append(slot);
    handlers.mountStage(slot, stage.carry, stage.maneuver, stage.variant, stage.params);
    const measured = KEYS.filter((key) => verdict.have[key] !== undefined);
    const fromNeed = KEYS.filter((key) => verdict.have[key] === undefined);
    slot.append(el('p', { class: 'muted small', text: STEPS.drawn(stage.params.wallThickness, measured, fromNeed) }));
  }

  body.append(details(product, verdict));
}

/* ------------------------------------------------------------------------ */

function numberField(key: Key, value: number | undefined, placeholder?: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: String(KEY_MIN[key]),
    max: String(KEY_MAX),
    step: '0.5',
    id: `fp-${key}`,
    'aria-label': `${KEY_LABEL[key]}, ${FORM.unit}`,
    autocomplete: 'off',
    ...(placeholder !== undefined ? { placeholder } : {}),
  });
  if (value !== undefined) input.value = cm(value);
  const wrap = el('label', { class: 'fieldset', for: `fp-${key}` }, [
    el('span', { class: 'k', text: KEY_LABEL[key] }),
    el('span', { class: 'field' }, [input, el('span', { class: 'unit', text: FORM.unit })]),
  ]);
  return { wrap, input };
}

/** A number typed into a field, or a message saying why not. */
function read(key: Key, input: HTMLInputElement): { value?: number; error?: string } {
  const text = input.value.trim();
  if (text === '') return {};
  const value = Number(text);
  if (!Number.isFinite(value) || value < KEY_MIN[key] || value > KEY_MAX) {
    return { error: FORM.invalid(KEY_LABEL[key], KEY_MIN[key], KEY_MAX) };
  }
  return { value };
}

function openingForm(verdict: Verdict, handlers: ViewHandlers, storageNote: string): HTMLElement {
  const have = verdict.have;
  const width = numberField('doorWidth', have.doorWidth);
  const height = numberField('doorHeight', have.doorHeight);
  const error = el('p', { class: 'error', hidden: true, role: 'alert' });
  const given =
    KEYS.some((key) => have[key] !== undefined) ||
    have.wallThickness !== undefined ||
    (have.partsOff?.length ?? 0) > 0 ||
    (have.partsOn?.length ?? 0) > 0;

  const submit = (): void => {
    const w = read('doorWidth', width.input);
    const h = read('doorHeight', height.input);
    const message = w.error ?? h.error ?? (w.value === undefined || h.value === undefined ? FORM.missing : undefined);
    if (message !== undefined) {
      error.textContent = message;
      error.hidden = false;
      (w.value === undefined ? width.input : height.input).focus();
      return;
    }
    handlers.onOpening(w.value!, h.value!);
  };

  const form = el('form', { class: 'opening', novalidate: true, onsubmit: (event: Event) => { event.preventDefault(); submit(); } }, [
    el('p', { class: 'lead' }, [FORM.lead, ' ', el('span', { class: 'muted small', text: `${KEY_HINT.doorWidth} ${KEY_HINT.doorHeight}` })]),
    el('div', { class: 'row' }, [
      width.wrap,
      height.wrap,
      el('button', { class: 'btn btn-primary', type: 'submit', text: FORM.check }),
    ]),
    error,
    given
      ? el('div', { class: 'row small muted' }, [
          storageNote,
          el('button', { class: 'linkish', type: 'button', text: FORM.startOver, onclick: handlers.onReset }),
        ])
      : null,
  ]);
  return el('div', { class: 'card card-form' }, [form]);
}

/* ------------------------------------------------------------------------ */

const TONE: Record<Verdict['kind'], string> = {
  'needs-opening': '',
  fits: 'tone-fits',
  conditions: 'tone-open',
  'no-way': 'tone-not-found',
  proven: 'tone-proven',
};

function verdictCard(product: WidgetProduct, verdict: Verdict, handlers: ViewHandlers): HTMLElement {
  const head = headline(verdict, product.name);
  const card = el('div', { class: `card ${TONE[verdict.kind]}` }, [
    el('h2', { class: 'verdict-title', tabindex: '-1', text: head.title }),
    el('p', { class: 'verdict-line', text: head.line }),
    head.honesty !== undefined ? el('p', { class: 'honesty', text: head.honesty }) : null,
  ]);

  if (verdict.kind === 'conditions') card.append(conditionFields(verdict, handlers));
  const chips = givenChips(verdict, handlers);
  if (chips !== null) card.append(chips);
  if (verdict.close.length > 0) card.append(el('p', { class: 'small', text: CONDITIONS.close(verdict.close) }));
  const trade = tradeoffLine(verdict);
  if (trade !== undefined) card.append(el('p', { class: 'small muted', text: trade }));

  const part = verdict.part;
  if (part !== undefined) {
    if (part.established && verdict.route?.partOff === part.part) {
      card.append(
        el('p', { class: 'small muted' }, [
          part.withOnNeed !== undefined ? PART.withOn(part.part, part.withOnNeed) : '',
          (verdict.have.partsOff ?? []).includes(part.part)
            ? el('button', { class: 'linkish', type: 'button', text: PART.undo(part.part), onclick: () => handlers.onPartOff(part.part, false) })
            : null,
        ]),
      );
    } else if (!part.established) {
      card.append(
        el('div', { class: 'ask' }, [
          el('p', { text: PART.question(part.part, part.doorNeed) }),
          el('div', { class: 'row' }, [
            el('button', { class: 'btn btn-primary', type: 'button', text: PART.yes(part.part), onclick: () => handlers.onPartOff(part.part, true) }),
            el('button', { class: 'btn btn-ghost', type: 'button', text: PART.no, onclick: () => handlers.onPartOff(part.part, false) }),
          ]),
        ]),
      );
    }
  }

  const wall = wallRow(verdict, handlers);
  if (wall !== null) card.append(wall);
  return card;
}

/** The optional numbers the shopper has given, each a chip that forgets it. */
function givenChips(verdict: Verdict, handlers: ViewHandlers): HTMLElement | null {
  const given = OPTIONAL_KEYS.filter((key) => verdict.have[key] !== undefined);
  if (given.length === 0) return null;
  return el('div', { class: 'chips' }, [
    el('span', { class: 'small muted', text: CONDITIONS.given }),
    ...given.map((key) =>
      el('button', { class: 'chip', type: 'button', title: CONDITIONS.forget, onclick: () => handlers.onOptional({ [key]: undefined }) }, [
        el('span', { class: 'k', text: KEY_LABEL[key] }),
        el('span', { class: 'v', text: `${cm(verdict.have[key]!)} ${FORM.unit}` }),
        el('span', { class: 'edit', text: CONDITIONS.forget }),
      ]),
    ),
  ]);
}

/** Requirements the shopper may enter, one field each, on the verdict itself. */
function conditionFields(verdict: Verdict, handlers: ViewHandlers): HTMLElement {
  const fields = verdict.conditions.map((c) => ({ key: c.key, ...numberField(c.key, undefined, CONDITIONS.placeholder(c.need)) }));
  const error = el('p', { class: 'error', hidden: true, role: 'alert' });
  const submit = (): void => {
    const values: Partial<Record<Key, number | undefined>> = {};
    for (const f of fields) {
      const r = read(f.key, f.input);
      if (r.error !== undefined) {
        error.textContent = r.error;
        error.hidden = false;
        f.input.focus();
        return;
      }
      if (r.value !== undefined) values[f.key] = r.value;
    }
    if (Object.keys(values).length === 0) return;
    handlers.onOptional(values);
  };
  return el('form', { class: 'conditions', novalidate: true, onsubmit: (event: Event) => { event.preventDefault(); submit(); } }, [
    el('p', { class: 'small muted', text: CONDITIONS.lead }),
    el('div', { class: 'row' }, [...fields.map((f) => f.wrap), el('button', { class: 'btn btn-ghost', type: 'submit', text: CONDITIONS.update })]),
    error,
  ]);
}

/**
 * The wall, only where it matters: a note when a wall a home can have would
 * change the answer, and the field to say which wall this is. When the answer
 * is the same behind every wall a person could have, nothing.
 */
function wallRow(verdict: Verdict, handlers: ViewHandlers): HTMLElement | null {
  if (!verdict.wallGiven && verdict.wallNote === undefined) return null;
  const input = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: '3',
    max: '200',
    step: '1',
    id: 'fp-wall',
    'aria-label': `${WALL.label}, ${FORM.unit}`,
    autocomplete: 'off',
  });
  if (verdict.wallGiven) input.value = cm(verdict.wall);
  const error = el('p', { class: 'error', hidden: true, role: 'alert' });
  const form = el('form', { class: 'row', novalidate: true, onsubmit: (event: Event) => {
    event.preventDefault();
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(value) || value < 3 || value > 200) {
      error.textContent = WALL.invalid;
      error.hidden = false;
      input.focus();
      return;
    }
    handlers.onWall(value);
  } }, [
    el('label', { class: 'fieldset', for: 'fp-wall' }, [
      el('span', { class: 'k', text: WALL.label }),
      el('span', { class: 'field' }, [input, el('span', { class: 'unit', text: FORM.unit })]),
    ]),
    el('button', { class: 'btn btn-ghost', type: 'submit', text: WALL.use }),
    verdict.wallGiven ? el('button', { class: 'linkish', type: 'button', text: WALL.forget, onclick: () => handlers.onWall(undefined) }) : null,
  ]);
  return el('div', { class: 'wall' }, [
    el('p', { class: 'small', text: verdict.wallGiven ? WALL.given(verdict.wall) : WALL.note(verdict.wallNote!.holdsUpTo, verdict.wallNote!.then) }),
    form,
    error,
  ]);
}

/* ------------------------------------------------------------------------ */

interface StageChoice {
  route: Route;
  carry: Carry;
  maneuver: WidgetManeuver;
  variant: WallVariant;
  params: EnvironmentParams;
}

/**
 * Which way in to draw: the one presented, for the body that decides it.
 *
 * The scene is the shopper's own numbers where they gave them, and exactly
 * what the way in asks for where they did not — so the picture is of a room
 * the motion is known to clear, never a guess at the shopper's home. The wall
 * is drawn at the thickness the motion was validated behind, which is the
 * shopper's own or the next thicker one measured.
 */
function stageFor(verdict: Verdict): StageChoice | undefined {
  const route = verdict.route;
  if (route === undefined) return undefined;
  // For a route of several bodies, the one that needs the widest door.
  const deciding = [...route.carries].sort(
    (a, b) => b.presented!.variant!.need.doorWidth - a.presented!.variant!.need.doorWidth,
  )[0]!;
  const presented = deciding.presented!;
  const variant = presented.variant!;
  const r = variant.need;
  const have = verdict.have;
  const of = (key: Key): number => Math.max(have[key] ?? r[key], r[key]);
  const openingWidth = have.doorWidth!;
  const openingHeight = have.doorHeight!;
  // A corridor is at least as long as the door in it is wide, and a ceiling
  // at least as high as the door is tall: the engine refuses a scene that
  // says otherwise. A measured length along the wall is drawn as measured;
  // an unmeasured one is drawn generously, so a straight carry's end caps do
  // not sit against the sofa's arms. More corridor never invalidates a
  // motion — the collider re-checks the path in the drawn scene regardless.
  const along =
    have.alongWall !== undefined
      ? Math.max(60, openingWidth, have.alongWall, r.alongWall)
      : Math.max(GENEROUS_ALONG_CM, openingWidth, r.alongWall);
  return {
    route,
    carry: deciding.carry,
    maneuver: presented.maneuver,
    variant,
    params: {
      openingWidth,
      openingHeight,
      wallThickness: variant.wallCm,
      hallwayWidth: Math.max(1, of('hallwayClearance')),
      hallwayDepth: along,
      roomDepth: Math.max(1, of('roomDepth')),
      roomWidth: along,
      ceilingHeight: Math.max(240, openingHeight + 10, r.ceilingHeight + 20, have.ceilingHeight ?? 0),
    },
  };
}

/* ------------------------------------------------------------------------ */

function details(product: WidgetProduct, verdict: Verdict): HTMLElement {
  const sections: HTMLElement[] = [];
  for (const route of verdict.routes) {
    const title =
      route.id === 'assembled' ? DETAILS.route.assembled : route.id === 'modules' ? DETAILS.route.modules : DETAILS.route.withoutPart(route.partOff!);
    for (const c of route.carries) {
      const d = c.carry.dimensions;
      sections.push(
        el('div', { class: 'ways' }, [
          el('h4', {}, [title, el('span', { class: 'muted', text: ` · ${DETAILS.route.body(c.carry.name, d.length, d.depth, d.height)}` })]),
          waysTable(c, verdict),
        ]),
      );
    }
  }
  if (product.separates === 'unknown') sections.push(el('p', { class: 'small muted', text: DETAILS.separatesUnknown(product.name) }));
  sections.push(finePrint(product, verdict));
  return el('details', { class: 'details' }, [el('summary', { text: DETAILS.summary }), ...sections]);
}

function waysTable(c: CarryVerdict, verdict: Verdict): HTMLElement {
  const chosen = c.presented?.maneuver.templateId;
  const rows = c.evaluations.map((e) => {
    const v = e.variant;
    const status =
      e.status === 'fits'
        ? el('span', { class: 'ok', text: DETAILS.status.fits })
        : e.status === 'ruled-out'
          ? el('span', { class: 'short', text: DETAILS.status.ruledOut(e.unmet) })
          : e.status === 'unmeasured'
            ? el('span', { class: 'unk', text: DETAILS.status.unmeasured(verdict.wall, e.maneuver.variants[e.maneuver.variants.length - 1]?.holdsForWallsUpTo ?? 0) })
            : el('span', { class: 'unk', text: DETAILS.status.open(e.unknown) });
    const cls = e.maneuver.templateId === chosen ? 'is-chosen' : e.status === 'ruled-out' || e.status === 'unmeasured' ? 'is-out' : '';
    return el('tr', { class: cls }, [
      el('th', { scope: 'row' }, [
        e.maneuver.name,
        el('span', { class: 'muted', text: ` · ${DETAILS.steps(e.maneuver.stages.length)}` }),
        v?.turns ? el('span', { class: 'badge', text: DETAILS.turns }) : null,
      ]),
      el('td', { class: 'num', text: v === undefined ? DETAILS.none : `${need(v.need.doorWidth)} × ${need(v.need.doorHeight)}` }),
      el('td', { class: 'num', text: v === undefined ? DETAILS.none : need(v.need.hallwayClearance) }),
      el('td', { class: 'num', text: v === undefined ? DETAILS.none : need(v.need.alongWall) }),
      el('td', { class: 'num', text: v === undefined ? DETAILS.none : need(v.need.roomDepth) }),
      el('td', { class: 'num', text: v === undefined ? DETAILS.none : need(v.need.ceilingHeight) }),
      el('td', {}, [status]),
    ]);
  });
  return el('div', { class: 'scroll-x' }, [
    el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: DETAILS.columns.maneuver }),
          el('th', { scope: 'col', class: 'num', text: DETAILS.columns.opening }),
          el('th', { scope: 'col', class: 'num', text: DETAILS.columns.front }),
          el('th', { scope: 'col', class: 'num', text: DETAILS.columns.along }),
          el('th', { scope: 'col', class: 'num', text: DETAILS.columns.behind }),
          el('th', { scope: 'col', class: 'num', text: DETAILS.columns.ceiling }),
          el('th', { scope: 'col', text: DETAILS.columns.yours }),
        ]),
      ]),
      el('tbody', {}, rows),
    ]),
  ]);
}

function finePrint(product: WidgetProduct, verdict: Verdict): HTMLElement {
  const assembled = product.assembled;
  const anyWall: string[] = [];
  const thisWall: string[] = [];
  for (const m of assembled.maneuvers) {
    const first = m.variants[0];
    if (first === undefined) continue;
    (first.holdsForWallsUpTo > product.wallCm ? anyWall : thisWall).push(m.name);
  }
  return el('div', { class: 'fine' }, [
    el('dl', { class: 'legend' }, DETAILS.meaning.map(([term, meaning]) => el('div', {}, [el('dt', { text: term }), ' — ', el('dd', { text: meaning })]))),
    assembled.narrowestCm !== undefined && assembled.floorCm !== undefined
      ? el('p', { text: DETAILS.floor(assembled.narrowestCm, assembled.floorCm) })
      : null,
    el('p', { text: DETAILS.wall(verdict.wall, anyWall, thisWall) }),
    el('p', { text: DETAILS.disclaimer }),
  ]);
}

