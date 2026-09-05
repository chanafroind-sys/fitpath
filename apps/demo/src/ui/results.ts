/**
 * The pieces that show an answer: the verdict, the step list, the suggestions.
 *
 * Shared between the compare view and the fit checker so the two can never
 * disagree about how firmly something was established.
 */
import type { EnvironmentParams, Step, Suggestion } from '@fitpath/engine';
import { el, hebrew } from './dom.ts';
import { PRECISION_BADGE, cm, suggestionCopy, verdictLabel } from './format.ts';
import type { Verdict } from '../engine/protocol.ts';

export function verdictPill(verdict: Verdict): HTMLElement {
  const label = verdictLabel(verdict);
  return el('span', { class: `pill pill-${label.tone}` }, [
    el('span', { class: 'pill-dot', 'aria-hidden': 'true' }),
    el('span', { text: label.title }),
  ]);
}

export function verdictCard(verdict: Verdict): HTMLElement {
  const label = verdictLabel(verdict);
  return el('div', { class: `verdict verdict-${label.tone}` }, [
    el('div', { class: 'verdict-head' }, [
      el('h3', { class: 'verdict-title', text: label.title }),
      hebrew(label.titleHe, 'verdict-title-he'),
    ]),
    el('p', { class: 'verdict-note', text: label.note }),
    hebrew(label.noteHe, 'verdict-note he-block'),
  ]);
}

export function stepList(steps: readonly Step[]): HTMLElement {
  const list = el('ol', { class: 'steps' });
  steps.forEach((step, index) => {
    list.append(
      el('li', { class: 'step', 'data-step': String(index) }, [
        el('span', { class: 'step-kind', text: step.kind }),
        el('div', { class: 'step-body' }, [
          el('span', { class: 'step-en', text: step.en }),
          hebrew(step.he, 'step-he'),
        ]),
      ]),
    );
  });
  return list;
}

export function highlightStep(list: HTMLElement, index: number): void {
  for (const item of list.querySelectorAll('.step')) {
    item.classList.toggle('is-current', item.getAttribute('data-step') === String(index));
  }
}

export function suggestionList(
  suggestions: readonly Suggestion[],
  params: EnvironmentParams,
): HTMLElement {
  if (suggestions.length === 0) {
    return el('p', {
      class: 'muted',
      text: 'No counterfactuals were run for this scene.',
    });
  }

  const list = el('ul', { class: 'suggestions' });
  for (const suggestion of suggestions) {
    const copy = suggestionCopy(suggestion, params);
    list.append(
      el('li', { class: `suggestion suggestion-${copy.status}` }, [
        el('div', { class: 'suggestion-head' }, [
          el('span', { class: 'suggestion-headline', text: copy.headline }),
          el('span', { class: `badge badge-${copy.precision}`, text: PRECISION_BADGE[copy.precision] }),
        ]),
        hebrew(copy.headlineHe, 'suggestion-he'),
        copy.detail !== undefined ? el('p', { class: 'suggestion-detail', text: copy.detail }) : null,
        copy.caveat !== undefined ? el('p', { class: 'suggestion-caveat', text: copy.caveat }) : null,
      ]),
    );
  }
  return list;
}

/** The scene, in the four numbers that decide it. */
export function measurementsStrip(params: EnvironmentParams): HTMLElement {
  const entries: [string, string][] = [
    ['Opening', `${cm(params.openingWidth)} × ${cm(params.openingHeight)} cm`],
    ['Hallway clearance', `${cm(params.hallwayWidth)} cm`],
    ['Room depth', `${cm(params.roomDepth)} cm`],
    ['Ceiling', `${cm(params.ceilingHeight)} cm`],
  ];
  return el(
    'dl',
    { class: 'measurements' },
    entries.flatMap(([term, value]) => [
      el('dt', { text: term }),
      el('dd', { text: value }),
    ]),
  );
}

export function spinner(message: string): HTMLElement {
  return el('div', { class: 'progress' }, [
    el('span', { class: 'progress-spinner', 'aria-hidden': 'true' }),
    el('span', { class: 'progress-text', text: message }),
  ]);
}
