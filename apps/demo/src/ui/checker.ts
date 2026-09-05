/**
 * Screen two: the fit checker.
 *
 * Four measurements anyone can take with a tape, everything else folded away
 * under "advanced" with its defaults already set. Submitting hands the numbers
 * to the planner worker and shows the answer in two phases, because that is how
 * it arrives: the verdict in a fraction of a second, and — when there is no
 * path — what would fix it a couple of seconds later.
 */
import { buildEnvironment } from '@fitpath/engine';
import type {
  Environment,
  EnvironmentParams,
  PassageOutlook,
  Step,
  Suggestion,
} from '@fitpath/engine';
import type { Product } from '../catalog.ts';
import { retailDimensions } from '../catalog.ts';
import { runPlan, type RunningPlan } from '../engine/client.ts';
import type { Verdict } from '../engine/protocol.ts';
import { buildTimeline, stepRanges } from '../viewer/timeline.ts';
import { clear, el, hebrew } from './dom.ts';
import { cm, degrees, seconds } from './format.ts';
import { Playback } from './playback.ts';
import { Stage, createTransport, type Transport } from './stage.ts';
import {
  highlightStep,
  measurementsStrip,
  spinner,
  stepList,
  suggestionsPanel,
  verdictCard,
} from './results.ts';

interface Field {
  key: keyof EnvironmentParams;
  label: string;
  hint: string;
  min: number;
  max: number;
}

/** The four a person can actually measure. */
const PRIMARY: Field[] = [
  {
    key: 'openingWidth',
    label: 'Opening width',
    hint: 'Clear width of the doorway, jamb to jamb',
    min: 40,
    max: 320,
  },
  {
    key: 'openingHeight',
    label: 'Opening height',
    hint: 'Floor to the underside of the lintel',
    min: 60,
    max: 320,
  },
  {
    key: 'hallwayWidth',
    label: 'Hallway clearance',
    hint: 'Free depth in front of the opening — the number that usually decides it',
    min: 60,
    max: 400,
  },
  {
    key: 'roomDepth',
    label: 'Free depth behind the opening',
    hint: 'How far into the room the item can travel',
    min: 100,
    max: 600,
  },
];

const ADVANCED: Field[] = [
  { key: 'ceilingHeight', label: 'Ceiling height', hint: 'Decides whether the item can be tilted at all', min: 150, max: 400 },
  { key: 'wallThickness', label: 'Wall thickness', hint: 'Depth of the opening itself', min: 4, max: 80 },
  { key: 'hallwayDepth', label: 'Corridor length', hint: 'Total, centred on the opening. Longer corridors cost search time', min: 150, max: 600 },
  { key: 'roomWidth', label: 'Room width', hint: 'Across the opening, inside the room', min: 150, max: 600 },
];

function numberField(field: Field, value: number): HTMLElement {
  const input = el('input', {
    class: 'field-input',
    type: 'number',
    id: `field-${field.key}`,
    name: field.key,
    value: String(value),
    min: String(field.min),
    max: String(field.max),
    step: '1',
    inputmode: 'numeric',
    required: true,
  });
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: `field-${field.key}` }, [
      field.label,
      el('span', { class: 'field-unit', text: 'cm' }),
    ]),
    input,
    el('p', { class: 'field-hint', text: field.hint }),
  ]);
}

export interface CheckerView {
  element: HTMLElement;
  dispose(): void;
}

export function createChecker(product: Product, onBack: () => void): CheckerView {
  const dims = retailDimensions(product);
  const form = el('form', { class: 'checker-form', novalidate: true });
  const advancedFields = el('div', { class: 'field-grid' }, ADVANCED.map((f) => numberField(f, product.defaults[f.key])));

  form.append(
    el('div', { class: 'field-grid' }, PRIMARY.map((f) => numberField(f, product.defaults[f.key]))),
    el('details', { class: 'advanced' }, [
      el('summary', { text: 'Advanced' }),
      el('p', {
        class: 'field-hint',
        text: 'The engine builds the whole scene from eight measurements. These four are the ones with sensible defaults.',
      }),
      advancedFields,
    ]),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'primary-button', type: 'submit', text: 'Check the fit' }),
      el('button', {
        class: 'ghost-button',
        type: 'button',
        text: 'Reset',
        onclick: () => {
          writeParams(form, product.defaults);
        },
      }),
    ]),
    el('p', { class: 'form-error', hidden: true }),
  );

  const presets = el('div', { class: 'presets' }, [
    el('span', { class: 'presets-label', text: 'Named cases from the engine’s own test fixtures:' }),
    ...product.scenarios.map((scenario) =>
      el('button', {
        class: 'chip',
        type: 'button',
        text: scenario.name,
        title: scenario.expectation,
        onclick: () => {
          writeParams(form, scenario.params);
          form.requestSubmit();
        },
      }),
    ),
  ]);

  const results = el('div', { class: 'checker-results' });

  const element = el('section', { class: 'checker' }, [
    el('button', { class: 'ghost-button back-link', type: 'button', text: '← Back to the product', onclick: onBack }),
    el('div', { class: 'checker-head' }, [
      el('img', { class: 'checker-thumb', src: product.image, alt: '' }),
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Fit check' }),
        el('h1', { text: product.title }),
        el('p', {
          class: 'checker-dims',
          text:
            `${cm(dims.width)} × ${cm(dims.depth)} × ${cm(dims.height)} cm · ` +
            `${product.item.boxes.length} ${product.item.boxes.length === 1 ? 'box' : 'boxes'}`,
        }),
      ]),
    ]),
    el('div', { class: 'checker-layout' }, [
      el('div', { class: 'checker-inputs' }, [form, presets]),
      results,
    ]),
  ]);

  let job: RunningPlan | undefined;
  let playback: Playback | undefined;
  let transport: Transport | undefined;
  let stage: Stage | undefined;
  let timer = 0;

  const teardownRun = (): void => {
    job?.cancel();
    job = undefined;
    transport?.dispose();
    transport = undefined;
    playback?.dispose();
    playback = undefined;
    stage?.dispose();
    stage = undefined;
    if (timer !== 0) {
      clearInterval(timer);
      timer = 0;
    }
  };

  const submit = (event: Event): void => {
    event.preventDefault();
    const error = form.querySelector<HTMLElement>('.form-error')!;
    error.hidden = true;

    let params: EnvironmentParams;
    let environment: Environment;
    try {
      params = readParams(form);
      // Built here as well as in the worker, from the same function, because
      // the page has to draw this scene and an invalid one has to be caught
      // before anything is dispatched.
      environment = buildEnvironment(params);
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message.replace('buildEnvironment: ', '') : String(cause);
      error.hidden = false;
      return;
    }

    teardownRun();
    render(params, environment);
  };

  form.addEventListener('submit', submit);

  function render(params: EnvironmentParams, environment: Environment, force = false): void {
    clear(results);

    const progress = el('div', { class: 'run-progress' }, [spinner('Searching for a path…')]);
    const elapsed = el('span', { class: 'run-elapsed', text: '0.0 s' });
    progress.append(elapsed);
    results.append(measurementsStrip(params), progress);

    const startedAt = performance.now();
    timer = window.setInterval(() => {
      elapsed.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
    }, 100);

    job = runPlan(
      { itemId: product.id, params, ...(force ? { force: true } : {}) },
      {
        onVerdict(verdict: Verdict, millis: number): void {
          const skipped = !verdict.feasible && verdict.reason === 'not-searched';
          progress.replaceChildren(
            spinner(verdict.feasible ? 'Preparing the animation…' : 'Working out what would fix it…'),
            elapsed,
          );
          results.append(verdictCard(verdict));
          const stats = statsLine(verdict, millis);
          if (stats !== null) results.append(stats);
          if (skipped && !verdict.feasible && verdict.reason === 'not-searched') {
            results.append(notSearchedPanel(verdict.outlook, () => render(params, environment, true)));
          }
          if (verdict.feasible) showPath(verdict, environment);
        },
        onDiagnostics(suggestions: Suggestion[], truncated: boolean): void {
          results.append(suggestionsPanel(suggestions, truncated, params));
        },
        onDone(): void {
          progress.remove();
          if (timer !== 0) {
            clearInterval(timer);
            timer = 0;
          }
        },
        onFailed(message: string): void {
          progress.replaceChildren(el('p', { class: 'overlay-error', text: message }));
        },
      },
    );
  }

  function showPath(verdict: Extract<Verdict, { feasible: true }>, environment: Environment): void {
    const timeline = buildTimeline(product.item, verdict.path);
    stage = new Stage({ label: 'The maneuver', sublabel: 'Drag to orbit · scroll to zoom' });
    stage.setScene({ environment, item: product.item, path: verdict.path });

    playback = new Playback();
    playback.setDuration(Math.min(14000, Math.max(4500, (timeline.sweep / 85) * 1000)));
    const steps: readonly Step[] = verdict.steps;
    const list = stepList(steps);

    playback.subscribe((fraction) => stage?.setFraction(fraction));
    transport = createTransport({
      playback,
      steps,
      ranges: stepRanges(steps, verdict.path, timeline),
      onStepFocus: (index) => highlightStep(list, index),
    });

    results.append(
      el('div', { class: 'panel panel-stage' }, [stage.element, transport.element]),
      el('div', { class: 'panel' }, [
        el('h3', { text: 'How to move it' }),
        el('p', { class: 'panel-lede' }, [
          'Generated by the engine in English and Hebrew. Hebrew uses the infinitive — the register instructions are given in, and one that carries no grammatical gender: ',
          hebrew('להטות את הקצה הקדמי כלפי מעלה'),
        ]),
        list,
      ]),
    );
    playback.play();
  }

  // Answer something immediately, so the checker is never an empty form.
  queueMicrotask(() => form.requestSubmit());

  return {
    element,
    dispose(): void {
      teardownRun();
    },
  };
}

/**
 * What to do about a scene the search was never spent on.
 *
 * Two things: name the removable part that would bring the item under the
 * opening, when there is one, and offer to run the search anyway. The triage is
 * a measurement rather than a verdict, so the search has to stay available —
 * refusing to look would be the measurement overstepping.
 */
function notSearchedPanel(outlook: PassageOutlook, onForce: () => void): HTMLElement {
  const relief = outlook.relievedBy;
  return el('div', { class: 'panel' }, [
    el('h3', { text: 'What would change the answer' }),
    relief !== undefined
      ? el('div', { class: 'suggestions' }, [
          el('div', { class: 'suggestion suggestion-fix' }, [
            el('div', { class: 'suggestion-head' }, [
              el('span', {
                class: 'suggestion-headline',
                text:
                  `Take the ${relief.part} off: that brings the item to ${cm(relief.hullMinimumWidth)} cm, ` +
                  `which clears the ${cm(outlook.openingSmallerSide)} cm opening`,
              }),
              el('span', { class: 'badge badge-approximate', text: 'measured, not searched' }),
            ]),
            hebrew(
              `להסיר את ${relief.partHe}: כך הרהיט יורד ל-${cm(relief.hullMinimumWidth)} ס״מ, ` +
                `שעובר את הפתח של ${cm(outlook.openingSmallerSide)} ס״מ`,
              'suggestion-he',
            ),
            el('p', {
              class: 'suggestion-caveat',
              text: 'This compares measurements, not paths. Whether a path exists once the part is off is a question only the search answers.',
            }),
          ]),
        ])
      : el('p', {
          class: 'panel-lede',
          text: 'No removable part brings the item under the opening, so there is nothing cheap left to try.',
        }),
    el('div', { class: 'form-actions' }, [
      el('button', {
        class: 'primary-button',
        type: 'button',
        text: 'Search anyway',
        onclick: onForce,
      }),
    ]),
    el('p', {
      class: 'muted',
      text: 'The full search takes a few seconds and can still only answer “no path found” or “inconclusive” — it cannot prove impossibility.',
    }),
  ]);
}

function statsLine(verdict: Verdict, millis: number): HTMLElement | null {
  if (verdict.feasible === false && verdict.reason === 'not-searched') return null;
  const { stats } = verdict;
  return el('p', { class: 'stats-line' }, [
    el('span', { text: `${seconds(millis)}` }),
    el('span', { text: `${stats.nodesGenerated.toLocaleString('en-US')} nodes` }),
    el('span', { text: `${stats.collisionChecks.toLocaleString('en-US')} collision tests` }),
    el('span', {
      text: `lattice ${stats.lattice.positionStep} cm / ${degrees(stats.lattice.yawStepDeg)}°`,
    }),
    stats.solvedOnCoarsePass ? el('span', { text: 'solved on a coarse rung' }) : null,
  ]);
}

function readParams(form: HTMLFormElement): EnvironmentParams {
  const read = (key: keyof EnvironmentParams): number => {
    const input = form.elements.namedItem(key);
    if (!(input instanceof HTMLInputElement)) throw new Error(`${key} is missing`);
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
    return value;
  };
  return {
    openingWidth: read('openingWidth'),
    openingHeight: read('openingHeight'),
    wallThickness: read('wallThickness'),
    hallwayWidth: read('hallwayWidth'),
    hallwayDepth: read('hallwayDepth'),
    roomDepth: read('roomDepth'),
    roomWidth: read('roomWidth'),
    ceilingHeight: read('ceilingHeight'),
  };
}

function writeParams(form: HTMLFormElement, params: EnvironmentParams): void {
  for (const [key, value] of Object.entries(params)) {
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement) input.value = String(value);
  }
}
