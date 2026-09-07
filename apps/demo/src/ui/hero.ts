/**
 * The hero: one 90 cm doorway, asked of both engines.
 *
 * The left side is the maneuver library. It knows the move, because the move
 * was instantiated for this sofa and validated placement by placement against
 * the collider before the page was built, so answering is a comparison of four
 * numbers and takes microseconds.
 *
 * The right side is the general planner, given the identical question. It
 * searched 1.2 million states and did not find the route. That is not a bug and
 * it is not a verdict — there IS a path, and the engine's own tests carry a
 * validated witness for it — it is what searching a space costs when the space
 * is a needle in five dimensions.
 *
 * Both answers are precomputed. The planner's took eleven seconds; nobody is
 * sitting through that on a product page, and the point is that it happened,
 * not that it happens now.
 */
import { buildEnvironment } from '@fitpath/engine';
import { PRECOMPUTED } from '../precomputed.ts';
import { productById } from '../catalog.ts';
import { buildTimeline } from '../viewer/timeline.ts';
import { clear, el } from './dom.ts';
import { Playback } from './playback.ts';
import { Stage, createTransport, type Transport } from './stage.ts';
import { clearanceCaveat, sourceBadge } from './library.ts';

export interface HeroView {
  element: HTMLElement;
  dispose(): void;
}

const cm = (value: number): string => `${value.toFixed(value % 1 === 0 ? 0 : 2)} cm`;

export function createHero(): HeroView {
  const { params, itemId, library, planner } = PRECOMPUTED.hero;
  const product = productById(itemId);
  const environment = buildEnvironment(params);

  const playback = new Playback();
  playback.setLooping(true);
  const stage = new Stage();
  const transportSlot = el('div', { class: 'hero-transport' });
  let transport: Transport | undefined;

  // --- left: the library --------------------------------------------------
  const stageList = el('ol', { class: 'stage-list' },
    library.stages.map((s) =>
      el('li', {}, [el('span', { text: s.name }), el('span', { class: 'stage-he', dir: 'rtl', text: s.nameHe })]),
    ),
  );

  const left = el('div', { class: 'duel-side duel-library' }, [
    el('div', { class: 'duel-head' }, [
      el('div', {}, [
        el('h3', { text: library.name }),
        el('p', { class: 'duel-sub', text: `${library.stages.length} stages, validated offline` }),
      ]),
      el('span', { class: 'pill pill-fits', text: 'Fits' }),
    ]),
    stage.element,
    transportSlot,
    el('p', { class: 'duel-stat' }, [
      el('strong', { text: `answered in ${library.micros} µs` }),
      ` · needs a ${cm(library.requirement.doorWidth)} doorway · no search`,
    ]),
    stageList,
    sourceBadge('library'),
    clearanceCaveat(library.requirement),
  ]);

  // --- right: the planner -------------------------------------------------
  const right = el('div', { class: 'duel-side duel-planner' }, [
    el('div', { class: 'duel-head' }, [
      el('div', {}, [
        el('h3', { text: 'General planner' }),
        el('p', { class: 'duel-sub', text: 'A* over positions and orientations' }),
      ]),
      el('span', { class: 'pill pill-inconclusive', text: 'Inconclusive' }),
    ]),
    el('div', { class: 'duel-blank' }, [
      el('div', { class: 'duel-blank-inner' }, [
        el('p', { class: 'duel-nodes', text: planner.nodes.toLocaleString('en-US') }),
        el('p', { class: 'muted', text: 'states examined' }),
      ]),
    ]),
    el('p', { class: 'duel-stat' }, [
      el('strong', { text: `${(planner.ms / 1000).toFixed(1)} s` }),
      ` · budget of ${planner.budget.toLocaleString('en-US')} states exhausted · no route found`,
    ]),
    el('p', { class: 'muted' }, [
      'This is ',
      el('em', { text: 'not' }),
      ' a finding that the sofa does not fit. The budget ran out; nothing was proved. A path through this doorway exists — the engine’s own test suite carries one, constructed by hand and checked edge by edge — and the search did not reach it.',
    ]),
    sourceBadge('planner'),
  ]);

  const element = el('section', { class: 'duel', id: 'duel' }, [
    el('div', { class: 'section-head' }, [
      el('p', { class: 'eyebrow', text: 'The same question, twice' }),
      el('h2', { text: `A ${params.openingWidth} cm doorway, asked of both engines.` }),
      el('p', { class: 'duel-caption' }, [
        'Left: a library of maneuvers, each one worked out and proved against this exact sofa before the page was built. Right: a general search of every position and orientation, given the identical doorway. ',
        el('strong', { text: 'The difference is between searching a space and knowing the move.' }),
      ]),
    ]),
    el('div', { class: 'duel-grid' }, [left, right]),
    el('p', { class: 'duel-footnote muted' }, [
      `Both answers were computed when this page was built — the search on the right takes ${(planner.ms / 1000).toFixed(0)} seconds, and showing it live would mean showing a spinner. The animation on the left replays the validated path itself, waypoint for waypoint.`,
    ]),
  ]);

  if (product !== undefined) {
    stage.setScene({ environment, item: product.item, path: library.path });
    const timeline = buildTimeline(product.item, library.path);
    playback.setDuration(Math.min(16000, Math.max(6000, (timeline.sweep / 85) * 1000)));
    playback.subscribe((fraction) => stage.setFraction(fraction));
    transport = createTransport({ playback });
    clear(transportSlot);
    transportSlot.append(transport.element);
    playback.play();
  }

  return {
    element,
    dispose(): void {
      transport?.dispose();
      playback.dispose();
      stage.dispose();
    },
  };
}
