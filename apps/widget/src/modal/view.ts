/**
 * The modal's body: an answer rendered, and the one question after it.
 *
 * Everything here is a function of an `Answer` and a handful of callbacks. The
 * state — which numbers the shopper has given — lives in `index.ts`, and every
 * change re-renders the body from scratch, which is cheap at this size and
 * removes a whole class of "the chip says 90 but the verdict was for 80" bugs.
 */
import type { EnvironmentParams } from '@fitpath/engine';
import type { Carry, MeasurementKey, WidgetManeuver, WidgetProduct } from '../types.ts';
import { ASK_ORDER, MARGINAL_CM, type Answer, type CarryAssessment, type Have, type Known, type Question } from './assess.ts';
import { KEY_HINT, KEY_LABEL, KEY_SHORT, LEGEND, PILL, TONE, WALL_LABEL, bundleCopy, carryLine, carryName, headline, questionCopy, wallLine } from './copy.ts';
import { cm, clear, el, hebrew, need } from './dom.ts';

export interface ViewHandlers {
  onKnown(key: MeasurementKey, known: Known): void;
  onForget(key: MeasurementKey): void;
  /** The shopper's wall thickness, or undefined to go back to the assumption. */
  onWall(thickness: number | undefined): void;
  onReset(): void;
  /** Mount the 3D view of a maneuver into a slot. Lazy; may reject. */
  mountStage(slot: HTMLElement, carry: Carry, maneuver: WidgetManeuver, params: EnvironmentParams): void;
}

const KEY_MIN: Record<MeasurementKey, number> = {
  doorWidth: 30,
  doorHeight: 60,
  hallwayClearance: 20,
  alongWall: 40,
  roomDepth: 20,
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
      el('p', { class: 'eyebrow', text: 'Will it fit through my door?' }),
      el('h2', { id: 'fp-title' }, [product.name, hebrew(product.nameHe)]),
      el('p', { class: 'dims', text: `${cm(d.length)} × ${cm(d.depth)} × ${cm(d.height)} cm · ${product.assembled.item.boxes.length} boxes modelled` }),
    ]),
    el('button', { class: 'close', type: 'button', 'aria-label': 'Close', text: '×', onclick: onClose }),
  ]);
}

export function renderBody(body: HTMLElement, answer: Answer, handlers: ViewHandlers, storageNote: string): void {
  clear(body);
  const known = ASK_ORDER.filter((key) => answer.have[key] !== undefined);

  if (known.length > 0 || answer.have.wallThickness !== undefined) body.append(measurementChips(answer, handlers, storageNote));
  body.append(verdictCard(answer));
  body.append(wallCard(answer, handlers));

  if (answer.next !== undefined) {
    body.append(
      answer.next.bundle !== undefined
        ? bundleCard(answer, answer.next, handlers)
        : questionCard(answer, answer.next, handlers),
    );
  }

  // The 3D view waits for the first number. Before it there is nothing to
  // check, and drawing a maneuver for a doorway nobody has measured would put
  // Three.js on the wire for a shopper who may only have wanted the button.
  const stage = answer.have.doorWidth === undefined ? undefined : stageFor(answer);
  if (stage !== undefined) {
    const slot = el('div', { class: 'card' }, [
      el('h3', {}, [
        answer.assembled.verdict === 'fits' ? 'How it goes in' : 'The maneuver being checked',
        el('span', { class: 'badge', text: `“${stage.maneuver.name}”` }),
      ]),
      el('p', { class: 'muted small', text: stageNote(answer, stage) }),
    ]);
    body.append(slot);
    handlers.mountStage(slot, stage.carry, stage.maneuver, stage.params);
  }

  body.append(...routes(answer));
  body.append(maneuverTable(answer.product, answer.assembled, answer.have));
  body.append(finePrint(answer));
}

/* ------------------------------------------------------------------------ */

function measurementChips(answer: Answer, handlers: ViewHandlers, storageNote: string): HTMLElement {
  const wall = answer.have.wallThickness;
  const wallChip =
    wall === undefined
      ? null
      : el('button', {
          class: 'chip',
          type: 'button',
          title: 'Back to the assumed wall',
          onclick: () => handlers.onWall(undefined),
        }, [
          el('span', { class: 'k', text: WALL_LABEL }),
          el('span', { class: 'v', text: `${cm(wall)} cm` }),
          el('span', { class: 'edit', text: 'forget' }),
        ]);
  const chips = ASK_ORDER.filter((key) => answer.have[key] !== undefined).map((key) => {
    const k = answer.have[key]!;
    return el('button', {
      class: 'chip',
      type: 'button',
      title: `Change ${KEY_LABEL[key].toLowerCase()}`,
      onclick: () => handlers.onForget(key),
    }, [
      el('span', { class: 'k', text: KEY_LABEL[key] }),
      el('span', { class: 'v', text: `${k.exact ? '' : '≥ '}${cm(k.value)} cm` }),
      el('span', { class: 'edit', text: 'change' }),
    ]);
  });
  return el('div', { class: 'row between' }, [
    el('div', { class: 'chips' }, [...chips, wallChip]),
    el('div', { class: 'row' }, [
      el('span', { class: 'muted small', text: storageNote }),
      el('button', { class: 'linkish', type: 'button', text: 'Start over', onclick: handlers.onReset }),
    ]),
  ]);
}

function verdictCard(answer: Answer): HTMLElement {
  const a = answer.assembled;
  const tone = TONE[a.verdict];
  const head = headline(answer);
  const card = el('div', { class: `card tone-${tone}` }, [
    el('div', { class: 'row between' }, [
      el('h2', { class: `verdict-title${a.verdict === 'open' ? ' small-title' : ''}`, text: head.title }),
      el('span', { class: `pill pill-${tone}`, text: PILL[a.verdict] }),
    ]),
    el('p', { class: 'muted', text: head.note }),
  ]);

  if (a.verdict === 'fits') {
    const m = a.chosen!.maneuver;
    card.append(
      el('ol', { class: 'stages' }, m.stages.map((stage) => el('li', {}, [stage.name, hebrew(stage.nameHe)]))),
      el('p', { class: 'muted small' }, [
        'It needs ',
        el('strong', { text: `${need(m.requirement.doorWidth)} × ${need(m.requirement.doorHeight)} cm` }),
        ` of doorway, ${need(m.requirement.hallwayClearance)} cm in front, ${need(m.requirement.alongWall)} cm along the wall and ${need(m.requirement.roomDepth)} cm behind` +
          (m.headroomCm > 220 ? `, and ${m.headroomCm} cm of ceiling while it is being turned` : '') +
          '.',
      ]),
    );
    const tight = a.marginal.filter((key) => key !== 'doorWidth');
    if (a.marginal.length > 0) {
      card.append(
        el('p', { class: 'small' }, [
          el('strong', { text: 'Close: ' }),
          `${a.marginal.map((key) => `${KEY_SHORT[key]} by ${cm(a.chosen!.margins[key]!)} cm`).join(', ')}. ` +
            `Anything under ${MARGINAL_CM} cm is met on paper; a door stop or a skirting board can take it. Worth measuring again` +
            (tight.length > 0 ? ' before delivery day' : '') +
            '.',
        ]),
      );
    }
    if (a.fitting.length > 1) {
      card.append(
        el('p', { class: 'muted small', text: `${a.fitting.length - 1} other maneuver${a.fitting.length === 2 ? '' : 's'} also work${a.fitting.length === 2 ? 's' : ''} here — listed below. This one is offered because it has the fewest separate motions, not because it is the only way.` }),
      );
    }
  }
  return card;
}

/**
 * The wall, said out loud beside the answer.
 *
 * A doorway is a tunnel the depth of the wall, every figure was measured
 * behind one of a stated thickness, and thicker is strictly harder. So the
 * maneuver in hand says what it assumes, and the shopper who knows their wall
 * is thicker can say so — after which a maneuver not measured for it stays
 * open rather than being called a fit.
 */
function wallCard(answer: Answer, handlers: ViewHandlers): HTMLElement {
  const chosen = answer.assembled.chosen?.maneuver ?? answer.product.assembled.maneuvers[0];
  const line = chosen === undefined ? answer.product.assembled.wallStatement : wallLine(chosen, answer.have);
  const input = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: '3',
    max: '200',
    step: '1',
    id: 'fp-wall',
    'aria-label': `${WALL_LABEL} in centimetres`,
    autocomplete: 'off',
  });
  const form = el('form', { class: 'ask-form', hidden: true, novalidate: true, onsubmit: (event: Event) => {
    event.preventDefault();
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 3 || value > 200) {
      input.focus();
      return;
    }
    handlers.onWall(value);
  } }, [
    el('label', { for: 'fp-wall', text: WALL_LABEL }),
    el('span', { class: 'field' }, [input, el('span', { class: 'unit', text: 'cm' })]),
    el('button', { class: 'btn btn-primary', type: 'submit', text: 'Use this wall' }),
  ]);
  const toggle = el('button', {
    class: 'linkish',
    type: 'button',
    text: answer.have.wallThickness === undefined ? 'My wall is thicker' : 'Change',
    onclick: () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    },
  });
  return el('div', { class: 'card' }, [
    el('div', { class: 'row between' }, [
      el('p', { class: 'small' }, [el('strong', { text: 'The wall. ' }), line]),
      toggle,
    ]),
    form,
  ]);
}

function questionCard(answer: Answer, question: Question, handlers: ViewHandlers): HTMLElement {
  const copy = questionCopy(answer, question);
  const { key } = question;
  const input = el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: String(KEY_MIN[key]),
    max: String(KEY_MAX),
    step: '0.5',
    id: `fp-${key}`,
    'aria-label': `${KEY_LABEL[key]} in centimetres`,
    autocomplete: 'off',
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    },
  });
  const error = el('p', { class: 'error', hidden: true, role: 'alert' });

  const submit = (): void => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || input.value.trim() === '') {
      error.textContent = 'Enter a number, in centimetres.';
      error.hidden = false;
      input.focus();
      return;
    }
    if (value < KEY_MIN[key] || value > KEY_MAX) {
      error.textContent = `That does not look like a ${KEY_LABEL[key].toLowerCase()} in centimetres (${KEY_MIN[key]}–${KEY_MAX}).`;
      error.hidden = false;
      input.focus();
      return;
    }
    handlers.onKnown(key, { value, exact: true });
  };

  const form = el('form', { class: 'ask-form', novalidate: true, onsubmit: (event: Event) => { event.preventDefault(); submit(); } }, [
    el('label', { for: `fp-${key}`, text: KEY_LABEL[key] }),
    el('span', { class: 'field' }, [input, el('span', { class: 'unit', text: 'cm' })]),
    el('button', { class: 'btn btn-primary', type: 'submit', text: 'Check' }),
    key === 'doorWidth'
      ? null
      : el('span', { class: 'or', text: 'or' }),
    key === 'doorWidth'
      ? null
      : el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: `${copy.confirm} — yes`,
          title: 'Confirms the threshold without measuring. It can satisfy a requirement but never rule one out.',
          onclick: () => handlers.onKnown(key, { value: question.needsCm, exact: false }),
        }),
  ]);

  return el('div', { class: 'card tone-ask' }, [
    el('p', { class: 'eyebrow', text: copy.lead }),
    el('h3', { text: copy.ask }),
    el('p', { class: 'muted small', text: KEY_HINT[key] }),
    form,
    error,
  ]);
}

/**
 * Several ordinary requirements, confirmed at once.
 *
 * "At least 222 cm behind the door, a door at least 85 cm tall, 95 cm along
 * the wall" is three things any home has, and asking for them one card at a
 * time is what turns a one-number check into a five-field form by the back
 * door. One tap confirms them all as thresholds; the shopper who would rather
 * measure gets a field for each, and may fill in only the ones they know.
 */
function bundleCard(answer: Answer, question: Question, handlers: ViewHandlers): HTMLElement {
  const copy = bundleCopy(answer, question);
  const items = question.bundle!;

  const list = el('ul', { class: 'stages' },
    items.map((item) =>
      el('li', {}, [
        el('strong', { text: `at least ${need(item.needsCm)} cm ${KEY_SHORT[item.key]}` }),
        el('span', { class: 'muted small', text: ` — ${KEY_HINT[item.key].replace(/\.$/, '').toLowerCase()}` }),
      ]),
    ),
  );

  const fields = el('div', { class: 'ask-form', hidden: true });
  const inputs = new Map<MeasurementKey, HTMLInputElement>();
  for (const item of items) {
    const input = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: String(KEY_MIN[item.key]),
      max: String(KEY_MAX),
      step: '0.5',
      id: `fp-${item.key}`,
      'aria-label': `${KEY_LABEL[item.key]} in centimetres`,
      autocomplete: 'off',
    });
    inputs.set(item.key, input);
    fields.append(
      el('label', { for: `fp-${item.key}`, text: KEY_LABEL[item.key] }),
      el('span', { class: 'field' }, [input, el('span', { class: 'unit', text: 'cm' })]),
    );
  }
  const error = el('p', { class: 'error', hidden: true, role: 'alert' });
  const check = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Check these',
    onclick: () => {
      let any = false;
      for (const [key, input] of inputs) {
        if (input.value.trim() === '') continue;
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < KEY_MIN[key] || value > KEY_MAX) {
          error.textContent = `${KEY_LABEL[key]}: enter a number in centimetres (${KEY_MIN[key]}–${KEY_MAX}).`;
          error.hidden = false;
          input.focus();
          return;
        }
        any = true;
      }
      if (!any) {
        error.textContent = 'Enter at least one of them, or confirm them all above.';
        error.hidden = false;
        return;
      }
      // Each number given is applied on its own terms; the ones left blank
      // stay unknown and are asked again.
      for (const [key, input] of inputs) {
        if (input.value.trim() === '') continue;
        handlers.onKnown(key, { value: Number(input.value), exact: true });
      }
    },
  });
  fields.append(check);

  const enter = el('button', {
    class: 'btn btn-ghost',
    type: 'button',
    text: 'Enter them instead',
    onclick: () => {
      fields.hidden = !fields.hidden;
      if (!fields.hidden) inputs.values().next().value?.focus();
    },
  });
  const yes = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: `Yes to all ${items.length}`,
    title: 'Confirms each threshold without measuring. A confirmation can satisfy a requirement but never rule one out.',
    onclick: () => {
      for (const item of items) handlers.onKnown(item.key, { value: item.needsCm, exact: false });
    },
  });

  return el('div', { class: 'card tone-ask' }, [
    el('p', { class: 'eyebrow', text: copy.lead }),
    el('h3', { text: copy.ask }),
    list,
    el('div', { class: 'ask-form' }, [yes, el('span', { class: 'or', text: 'or' }), enter]),
    fields,
    error,
  ]);
}

/* ------------------------------------------------------------------------ */

interface StageChoice {
  carry: Carry;
  maneuver: WidgetManeuver;
  params: EnvironmentParams;
}

/**
 * Which maneuver to draw: the one on offer, or the one being pursued.
 *
 * The scene is the shopper's own numbers where they gave them, and exactly
 * what the maneuver asks for where they did not — so the picture is of a room
 * the motion is known to clear, never a guess at the shopper's home.
 */
function stageFor(answer: Answer): StageChoice | undefined {
  const pick = (assessment: CarryAssessment): StageChoice | undefined => {
    const chosen = assessment.chosen;
    if (chosen === undefined) return undefined;
    const r = chosen.maneuver.requirement;
    const have = answer.have;
    const of = (key: MeasurementKey, fallback: number): number => Math.max(have[key]?.value ?? fallback, fallback);
    const openingWidth = of('doorWidth', r.doorWidth);
    const openingHeight = of('doorHeight', r.doorHeight);
    // A corridor is at least as long as the door in it is wide, and a ceiling
    // at least as high as the door is tall: the engine refuses a scene that
    // says otherwise, and a shopper who confirmed "at least 95 cm along the
    // wall" beside a 100 cm door has not said otherwise.
    //
    // A measured length along the wall is drawn as measured. A confirmed
    // threshold is a lower bound, not a corridor, and drawing a corridor at
    // exactly the 95 cm a straight carry needs puts its end caps against the
    // sofa's arms; so an unmeasured one is drawn at a generous length, which
    // the note beside the picture says. More corridor never invalidates a
    // motion — the collider re-checks the path in the drawn scene regardless.
    const alongKnown = have.alongWall;
    const along =
      alongKnown !== undefined && alongKnown.exact
        ? Math.max(60, openingWidth, alongKnown.value)
        : Math.max(GENEROUS_ALONG_CM, openingWidth, of('alongWall', r.alongWall));
    return {
      carry: assessment.carry,
      maneuver: chosen.maneuver,
      params: {
        openingWidth,
        openingHeight,
        wallThickness: answer.product.wallThicknessCm,
        hallwayWidth: Math.max(1, of('hallwayClearance', r.hallwayClearance)),
        hallwayDepth: along,
        roomDepth: Math.max(1, of('roomDepth', r.roomDepth)),
        roomWidth: along,
        ceilingHeight: Math.max(240, openingHeight + 10, chosen.maneuver.headroomCm + 20),
      },
    };
  };
  // Only a route that is still alive gets drawn. A module with a maneuver of
  // its own is no picture of a delivery when the other module cannot get in.
  const alive = (verdict: string): boolean => verdict === 'fits' || verdict === 'open';
  if (alive(answer.assembled.verdict)) return pick(answer.assembled);
  if (answer.modules !== undefined && alive(answer.modules.verdict)) {
    for (const carry of answer.modules.carries) {
      const choice = pick(carry);
      if (choice !== undefined) return choice;
    }
  }
  for (const entry of answer.withoutPart) {
    if (!alive(entry.carry.verdict)) continue;
    const choice = pick(entry.carry);
    if (choice !== undefined) return choice;
  }
  return undefined;
}

function stageNote(answer: Answer, stage: StageChoice): string {
  const measured = ASK_ORDER.filter((key) => answer.have[key]?.exact === true);
  const unmeasured = ASK_ORDER.filter((key) => answer.have[key]?.exact !== true);
  const body = carryName(answer.product, stage.carry);
  const wall = answer.have.wallThickness !== undefined && answer.have.wallThickness !== stage.params.wallThickness
    ? ` The wall is drawn ${stage.params.wallThickness} cm thick, the thickness the motion was validated behind, not your ${cm(answer.have.wallThickness)}.`
    : '';
  if (unmeasured.length === 0) return `${body}, in a room built from your numbers. The motion was re-checked against the collision test in exactly this scene before it was drawn.${wall}`;
  return (
    `${body}, in a room built from the numbers you measured (${measured.map((key) => KEY_SHORT[key]).join(', ')}) ` +
    `and, for the rest (${unmeasured.map((key) => KEY_SHORT[key]).join(', ')}), from what this maneuver needs` +
    (unmeasured.includes('alongWall') ? ' — drawn a little longer along the wall so the corridor reads as one' : '') +
    `. Re-checked against the collision test in this scene before it was drawn.${wall}`
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The ways round the assembled answer: the modules, the removable parts, and
 * the question for the retailer when nobody knows whether it comes apart.
 *
 * This is the point of the round. For a corner sofa the assembled figure is
 * nearly useless on its own — almost no home has 282 cm at the door — so
 * wherever the item separates, both are shown, and the sentence says plainly
 * that taking it apart is what changes the answer.
 */
function routes(answer: Answer): HTMLElement[] {
  const out: HTMLElement[] = [];
  const product = answer.product;

  if (product.separates === true && answer.modules !== undefined) {
    out.push(modulesCard(answer));
  } else if (product.separates === 'unknown') {
    out.push(
      el('div', { class: 'card' }, [
        el('h3', { text: 'Does it come apart?' }),
        el('p', { class: 'muted' }, [
          `Everything above treats the ${product.name} as one piece. We do not know whether it separates into modules — the listing does not say. `,
          el('strong', { text: 'Ask the retailer.' }),
          ' A sofa that comes apart is carried in as smaller pieces, and for most sofas that is the difference between a delivery that needs the whole hallway and an ordinary one.',
        ]),
      ]),
    );
  }

  for (const entry of answer.withoutPart) {
    out.push(withoutPartCard(answer, entry.part, entry.carry));
  }
  return out;
}

/** A carry's least-demanding maneuver by doorway, for a comparison of routes. */
function narrowestManeuver(carry: Carry): WidgetManeuver | undefined {
  return [...carry.maneuvers].sort((a, b) => a.requirement.doorWidth - b.requirement.doorWidth)[0];
}

function modulesCard(answer: Answer): HTMLElement {
  const product = answer.product;
  const modules = answer.modules!;
  const assembled = narrowestManeuver(product.assembled)?.requirement;
  const perModule = product.modules!.map((m) => narrowestManeuver(m)?.requirement);
  const worst = (key: MeasurementKey): number | undefined => {
    const values = perModule.map((r) => r?.[key]).filter((v): v is number => v !== undefined);
    return values.length === perModule.length && values.length > 0 ? Math.max(...values) : undefined;
  };

  const rows = ASK_ORDER.map((key) => {
    const one = assembled?.[key];
    const many = worst(key);
    const have = answer.have[key];
    const mark = (value: number | undefined): HTMLElement => {
      if (value === undefined) return el('span', { class: 'unk', text: '—' });
      if (have === undefined) return el('span', { text: `${need(value)} cm` });
      const met = have.value + 1e-9 >= value;
      const cls = met ? 'ok' : have.exact ? 'short' : 'unk';
      return el('span', { class: cls, text: `${need(value)} cm ${met ? '✓' : have.exact ? '✗' : '?'}` });
    };
    return el('tr', {}, [
      el('th', { scope: 'row', text: KEY_LABEL[key] }),
      el('td', { class: 'num' }, [mark(one)]),
      el('td', { class: 'num' }, [mark(many)]),
      el('td', { class: 'num muted', text: have === undefined ? 'not given' : `${have.exact ? '' : '≥ '}${cm(have.value)} cm` }),
    ]);
  });

  const width1 = assembled?.doorWidth;
  const widthN = worst('doorWidth');
  const front1 = assembled?.hallwayClearance;
  const frontN = worst('hallwayClearance');
  const height1 = assembled?.doorHeight;
  const heightN = worst('doorHeight');

  const summary =
    width1 !== undefined && widthN !== undefined && front1 !== undefined && frontN !== undefined
      ? `As one piece it needs a doorway ${need(width1)} cm wide${height1 !== undefined && height1 > 150 ? ` and ${need(height1)} cm tall` : ''}, with ${need(front1)} cm of clear floor in front of it. ` +
        `Module by module, the piece that decides it needs ${need(widthN)} cm of doorway${heightN !== undefined ? `, ${need(heightN)} cm tall` : ''}, and ${need(frontN)} cm in front. `
      : '';

  // Which numbers taking it apart actually moves, said from the numbers. On
  // this catalogue's corner sofa the hallway barely changes — the main run is
  // 276 cm long and still has to be carried square — while the height and the
  // length along the wall collapse. A sentence that assumed otherwise would be
  // the one wrong thing on a card whose whole point is being right.
  const MOVES_CM = 5;
  const moved: string[] = [];
  const barely: string[] = [];
  for (const key of ASK_ORDER) {
    const one = assembled?.[key];
    const many = worst(key);
    if (one === undefined || many === undefined) continue;
    if (one - many >= MOVES_CM) moved.push(`${KEY_SHORT[key]} (${need(one)} → ${need(many)} cm)`);
    else barely.push(KEY_SHORT[key]);
  }
  const change =
    moved.length === 0
      ? el('span', {}, [el('strong', { text: 'Taking it apart does not change the answer here' }), ` — every module still needs what the whole did.`])
      : el('span', {}, [
          el('strong', { text: 'Taking it apart is what changes the answer' }),
          `: ${moved.join(', ')}${barely.length > 0 ? `; ${barely.join(', ')} barely move${barely.length === 1 ? 's' : ''}` : ''}.`,
        ]);

  const verdictTone = TONE[modules.verdict];
  return el('div', { class: 'card' }, [
    el('div', { class: 'row between' }, [
      el('h3', { text: `Taken apart: ${product.modules!.length} modules` }),
      el('span', { class: `pill pill-${verdictTone}`, text: PILL[modules.verdict] }),
    ]),
    el('p', {}, [summary, change]),
    el('div', { class: 'scroll-x' }, [el('table', { class: 'compare' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Needs' }),
          el('th', { scope: 'col', class: 'num', text: 'As one piece' }),
          el('th', { scope: 'col', class: 'num', text: 'Worst module' }),
          el('th', { scope: 'col', class: 'num', text: 'You have' }),
        ]),
      ]),
      el('tbody', {}, rows),
    ])]),
    el('ul', { class: 'stages' },
      modules.carries.map((c) =>
        el('li', {}, [
          el('strong', { text: c.carry.name }),
          ` (${cm(c.carry.dimensions.length)} × ${cm(c.carry.dimensions.depth)} × ${cm(c.carry.dimensions.height)} cm): `,
          carryLine(c),
        ]),
      ),
    ),
    el('p', { class: 'muted small', text: 'Every module has to get through, so the module figure is the widest of them, not the narrowest. Both columns are measured from validated motions; the comparison uses the maneuver that needs the narrowest doorway for each piece.' }),
  ]);
}

function withoutPartCard(answer: Answer, part: string, carry: CarryAssessment): HTMLElement {
  const product = answer.product;
  const before = product.assembled.narrowestCm;
  const after = carry.carry.narrowestCm;
  const tone = TONE[carry.verdict];
  return el('div', { class: 'card' }, [
    el('div', { class: 'row between' }, [
      el('h3', { text: `With the ${part} off` }),
      el('span', { class: `pill pill-${tone}`, text: PILL[carry.verdict] }),
    ]),
    el('p', {}, [
      before !== undefined && after !== undefined
        ? `Take the ${part} off and the ${product.name} needs a ${need(after)} cm doorway instead of ${need(before)}. `
        : `The ${part} come off. `,
      el('span', { class: 'muted', text: carryLine(carry) }),
    ]),
    product.assembled.bindingPart !== undefined && product.assembled.bindingPart.label.includes(part)
      ? el('p', { class: 'muted small', text: `The ${part} are what set the width: the engine found the stretch of the sofa that forces the widest opening, and the ${part} are concentrated in it.` })
      : null,
  ]);
}

/* ------------------------------------------------------------------------ */

function maneuverTable(product: WidgetProduct, assessment: CarryAssessment, have: Have): HTMLElement {
  const chosenId = assessment.chosen?.maneuver.templateId;
  const rows = assessment.maneuvers.map((m) => {
    const r = m.maneuver.requirement;
    const status =
      m.status === 'fits'
        ? el('span', { class: 'ok', text: 'fits' })
        : m.status === 'ruled-out'
          ? el('span', { class: 'short', text: `short on ${m.unmet.map((key) => KEY_SHORT[key]).join(', ')}` })
          : m.wallUnknown && m.unknown.length === 0
            ? el('span', { class: 'unk', text: `open — not measured for a ${cm(have.wallThickness!)} cm wall (holds to ${m.maneuver.holdsForWallsUpTo})` })
            : el('span', { class: 'unk', text: `open — ${m.unknown.map((key) => KEY_SHORT[key]).join(', ')} not given${m.wallUnknown ? `; not measured for a ${cm(have.wallThickness!)} cm wall` : ''}` });
    const cls = m.maneuver.templateId === chosenId ? 'is-chosen' : m.status === 'ruled-out' ? 'is-out' : '';
    return el('tr', { class: cls }, [
      el('th', { scope: 'row' }, [
        m.maneuver.name,
        el('span', { class: 'muted', text: ` · ${m.maneuver.stages.length} stage${m.maneuver.stages.length === 1 ? '' : 's'}` }),
        m.maneuver.turns ? el('span', { class: 'badge', text: 'turns in the opening' }) : null,
      ]),
      el('td', { class: 'num', text: `${need(r.doorWidth)} × ${need(r.doorHeight)}` }),
      el('td', { class: 'num', text: need(r.hallwayClearance) }),
      el('td', { class: 'num', text: need(r.alongWall) }),
      el('td', { class: 'num', text: need(r.roomDepth) }),
      el('td', {}, [status]),
    ]);
  });
  const given = ASK_ORDER.filter((key) => have[key] !== undefined).length;
  return el('div', { class: 'card' }, [
    el('h3', { text: `Every maneuver in the library for the ${product.name}, against your numbers` }),
    el('p', { class: 'muted small', text: `Requirements in centimetres, measured from each validated motion and rounded up to 0.01. ${given === 0 ? 'Nothing given yet.' : `${given} of 5 numbers given.`}` }),
    el('div', { class: 'scroll-x' }, [
      el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Maneuver' }),
            el('th', { scope: 'col', class: 'num', text: 'Doorway w × h' }),
            el('th', { scope: 'col', class: 'num', text: 'In front' }),
            el('th', { scope: 'col', class: 'num', text: 'Along' }),
            el('th', { scope: 'col', class: 'num', text: 'Behind' }),
            el('th', { scope: 'col', text: 'Against yours' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}

function finePrint(answer: Answer): HTMLElement {
  const product = answer.product;
  const floor = product.assembled.floorCm;
  const narrowest = product.assembled.narrowestCm;
  return el('div', { class: 'fine' }, [
    el('dl', { class: 'legend' }, LEGEND.map(([term, meaning]) => el('div', {}, [el('dt', { text: term }), ' — ', el('dd', { text: meaning })]))),
    el('p', { text: product.assembled.wallStatement }),
    el('p', {}, [
      narrowest !== undefined && floor !== undefined
        ? `The narrowest doorway any of them clears is ${need(narrowest)} cm; the narrowest any way of rolling it as it goes could manage is ${need(floor)} cm${narrowest - floor < 0.1 ? ' — the library reaches that floor. It bounds nothing that leans or turns the sofa inside the doorway.' : ' — there is a roll maneuver nobody has written yet.'}`
        : '',
    ]),
    el('p', { text: 'Not a substitute for the delivery team’s judgement on the day: doors, handles, skirting boards and stairs are not modelled.' }),
  ]);
}
