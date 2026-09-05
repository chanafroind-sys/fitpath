/**
 * What is real, and what is only drawn.
 *
 * The overlay below is a static, hand-placed picture. Nothing about it was
 * computed from an image, and it is labelled as such in three places, because a
 * demo that quietly implies a capability it does not have is the one thing that
 * would undo everything the rest of this page is careful about.
 *
 * The limitations listed are the engine README's own "Not supported yet",
 * copied deliberately rather than softened.
 */
import { PRODUCTS } from '../catalog.ts';
import { el } from './dom.ts';

function roadmapBadge(): HTMLElement {
  return el('span', { class: 'badge badge-roadmap', text: 'Roadmap — not implemented' });
}

/**
 * A pre-computed overlay: rectangles drawn over the sofa illustration by hand,
 * in the illustration's own coordinates. No detection, no inference, no model.
 */
function boxOverlay(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 800 520');
  svg.setAttribute('class', 'overlay-svg');
  svg.setAttribute('aria-hidden', 'true');

  const shapes: { d: string; label: string }[] = [
    { d: 'M150 268 H650 V374 H150 Z', label: 'seat' },
    { d: 'M146 176 L654 176 L666 300 L134 300 Z', label: 'backrest 12°' },
    { d: 'M104 212 H160 V380 H104 Z', label: 'arm' },
    { d: 'M640 212 H696 V380 H640 Z', label: 'arm' },
    { d: 'M128 376 H148 V420 H128 Z', label: 'leg' },
    { d: 'M652 376 H672 V420 H652 Z', label: 'leg' },
    { d: 'M194 372 H212 V412 H194 Z', label: 'leg' },
    { d: 'M588 372 H606 V412 H588 Z', label: 'leg' },
  ];

  for (const shape of shapes) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', shape.d);
    path.setAttribute('class', 'overlay-box');
    svg.append(path);
  }

  const caption = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  caption.setAttribute('x', '400');
  caption.setAttribute('y', '486');
  caption.setAttribute('text-anchor', 'middle');
  caption.setAttribute('class', 'overlay-caption');
  caption.textContent = 'Illustrative overlay — drawn by hand, not detected';
  svg.append(caption);

  return svg;
}

const LIMITS: { title: string; body: string }[] = [
  {
    title: 'Automatic modelling from product photos',
    body: 'Today every item is hand-authored as a union of oriented boxes. Deriving that from a supplier’s photograph and dimension table is the difference between three products and a catalogue of thirty thousand.',
  },
  {
    title: 'Roll',
    body: 'The planner searches yaw and pitch. Rolling an item onto its side is a real maneuver it will not find. Admitting a third angle makes the lattice six-dimensional, which is the difference between a search that terminates and one that does not.',
  },
  {
    title: 'Either tilt axis, not one chosen by the author',
    body: 'Pitch turns about the item’s local Y, so which pair of faces an item can tip over is decided by whoever authored it. For a catalogue imported from suppliers with their own axis conventions, that is a silent generator of false negatives. The fix is to search both tilt families — twice the state space, not twelve times.',
  },
  {
    title: 'Continuous collision detection',
    body: 'Edges are validated by sampling densely enough that nothing can pass clean through a wall. That is a sampling bound, not a proof: it does not rule out a swept volume clipping a corner between two samples that both sit clear.',
  },
  {
    title: 'Stairs, lifts and multi-turn corridors',
    body: 'The scene is one floor: a corridor, a wall, a room. An L-shaped approach with two corners is not modelled, and neither is a stairwell.',
  },
  {
    title: 'Doors, handles, skirting and soft furnishings',
    body: 'The opening is a clean rectangular aperture. A door leaf standing open in the corridor is not modelled, and nothing here compresses or bends.',
  },
];

export function createRoadmap(): HTMLElement {
  const sofa = PRODUCTS[0]!;

  return el('section', { class: 'roadmap', id: 'roadmap' }, [
    el('div', { class: 'section-head' }, [
      el('p', { class: 'eyebrow', text: 'Honestly' }),
      el('h2', { text: 'What is real on this page, and what is not' }),
      el('p', {
        class: 'section-lede',
        text: 'Every verdict, path, step and threshold on this page came out of the engine while you watched. Everything below did not, and is labelled.',
      }),
    ]),

    el('div', { class: 'roadmap-feature' }, [
      el('div', { class: 'roadmap-figure' }, [
        el('div', { class: 'overlay-frame' }, [
          el('img', { src: sofa.image, alt: 'Sofa illustration with a box model drawn over it' }),
          boxOverlay(),
        ]),
      ]),
      el('div', { class: 'roadmap-figure-copy' }, [
        roadmapBadge(),
        el('h3', { text: 'Automatic modelling from product photos' }),
        el('p', {
          text: 'The engine needs an item as a union of oriented boxes. Producing that automatically — from a retailer’s photograph and its dimensions table — is what turns this from a demo of three products into a service a catalogue can call.',
        }),
        el('p', { class: 'roadmap-warning' }, [
          el('strong', { text: 'This picture is not that. ' }),
          'The rectangles are a static overlay drawn by hand over an illustration. No image was analysed, and no model produced them.',
        ]),
        el('p', {
          class: 'muted',
          text: 'The eight boxes it depicts are, however, the real ones: a seat block, a backrest pitched 12°, two armrests and four legs declared as a removable part.',
        }),
      ]),
    ]),

    el('div', { class: 'roadmap-grid' }, LIMITS.map((limit) =>
      el('article', { class: 'roadmap-card' }, [
        roadmapBadge(),
        el('h4', { text: limit.title }),
        el('p', { text: limit.body }),
      ]),
    )),

    el('div', { class: 'panel panel-quiet' }, [
      el('h3', { text: 'Where the numbers come from' }),
      el('ul', { class: 'plain-list' }, [
        el('li', { text: 'Verdicts, paths, step instructions and thresholds: computed live by the engine, in a Web Worker, from the measurements shown.' }),
        el('li', { text: 'Dimensions in the shop: measured off the engine’s own fixtures, not transcribed into the catalogue.' }),
        el('li', { text: 'The blocked corridor’s stopping point: the engine replaying the same path and reporting the first placement its collision test rejects.' }),
        el('li', { text: 'Product images: illustrations. There are no photographs on this page.' }),
        el('li', { text: 'The box overlay above, and every card in this section: static, and not implemented.' }),
      ]),
    ]),
  ]);
}
