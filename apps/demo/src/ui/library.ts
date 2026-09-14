/**
 * The maneuver library, as a shopper sees it.
 *
 * Three things live here: the order the engines are asked in, the caveat that
 * has to appear beside every answer they give, and the panels that publish what
 * was measured about each sofa.
 */
import type { ItemReport, ManeuverRequirement } from '@fitpath/engine';
import { PRECOMPUTED } from '../precomputed.ts';
import { productById } from '../catalog.ts';
import type { CatalogueEntry } from '../precomputed.ts';
import { el } from './dom.ts';
import { crossingSection, partsTable } from './panels.ts';

/** Which of the three engines produced an answer. Shown, always. */
export type Source = 'library' | 'proof' | 'planner';

const SOURCE_LABEL: Record<Source, { name: string; how: string }> = {
  library: {
    name: 'Maneuver library',
    how: 'a comparison of four numbers against a maneuver validated offline',
  },
  proof: {
    name: 'Closed-form proof',
    how: 'a geometric argument, with no search at all',
  },
  planner: {
    name: 'General planner',
    how: 'a full search of the space of positions and orientations',
  },
};

/**
 * The badge that says which engine spoke.
 *
 * Not a debug detail. The three differ in what their answers are worth — the
 * library knows a maneuver, the proof knows a fact, the planner has looked and
 * not found — and a page that showed the verdict without saying which one
 * produced it would be flattening exactly the distinction this project exists
 * to keep.
 */
export function sourceBadge(source: Source): HTMLElement {
  const { name, how } = SOURCE_LABEL[source];
  return el('span', { class: `source-badge source-${source}`, title: how }, [
    el('span', { class: 'source-dot', 'aria-hidden': 'true' }),
    el('span', { class: 'source-name', text: `Answered by: ${name}` }),
  ]);
}

export function sourceNote(source: Source): HTMLElement {
  return el('p', { class: 'muted source-note', text: SOURCE_LABEL[source].how });
}

/**
 * The caveat that goes beside every library answer, without exception.
 *
 * Each maneuver begins with the sofa already square to the doorway, and holding
 * a sofa square to a wall takes its own length in front of that wall. So the
 * clearance figure is large, it is real, and a shopper with a 120 cm hallway
 * must not be handed an answer that quietly assumed two metres. Turning an item
 * square from along a corridor is a maneuver nobody has written yet.
 */
export function clearanceCaveat(requirement: ManeuverRequirement): HTMLElement {
  return el('div', { class: 'caveat' }, [
    el('p', {}, [
      el('strong', {
        text:
          `Needs ${requirement.hallwayClearance.toFixed(0)} cm in front of the door, ` +
          `${requirement.alongWall.toFixed(0)} cm along the wall, and ` +
          `${requirement.roomDepth.toFixed(0)} cm behind it.`,
      }),
    ]),
    el('p', { class: 'muted' }, [
      'All three are measured from the motion itself. The maneuvers that stand an item on its end spend the length ',
      el('em', { text: 'along' }),
      ' the wall instead of the depth in front of it, which is usually the trade a real hallway wants.',
    ]),
  ]);
}

export function entryFor(itemId: string): CatalogueEntry | undefined {
  return PRECOMPUTED.catalogue.find((entry) => entry.id === itemId);
}

const cm = (value: number): string => `${value.toFixed(value % 1 === 0 ? 0 : 2)} cm`;

/**
 * Everything the library measured about one sofa, published.
 *
 * The line that matters most is the binding part, and it is derived rather than
 * written: the engine finds the run of the item that forces the widest opening
 * and names whichever part is concentrated in it and actually accounts for the
 * number.
 */
export function reportPanel(report: ItemReport, modules: readonly { id: string; report: ItemReport }[] = []): HTMLElement {
  const d = report.dimensions;
  const rows = report.maneuvers.map((line) =>
    el('tr', { class: line.valid ? '' : 'row-invalid' }, [
      el('th', { scope: 'row' }, [
        el('span', { text: line.name }),
        line.valid ? el('span', { class: 'muted', text: ` · ${line.stages} stage${line.stages === 1 ? '' : 's'}` }) : el('span', {}),
      ]),
      el('td', { text: line.valid && line.requirement ? cm(line.requirement.doorWidth) : '—' }),
      el('td', { text: line.valid && line.requirement ? cm(line.requirement.doorHeight) : '—' }),
      el('td', { text: line.valid && line.requirement ? cm(line.requirement.hallwayClearance) : '—' }),
      el('td', { text: line.valid && line.requirement ? cm(line.requirement.alongWall) : '—' }),
      el('td', { text: line.valid && line.requirement ? cm(line.requirement.roomDepth) : '—' }),
      el('td', { class: 'cell-verdict' }, [
        line.valid
          ? el('span', { class: 'ok-tick', text: 'validated' })
          : el('span', { class: 'muted', text: line.reason ?? 'not valid for this sofa' }),
      ]),
    ]),
  );

  const binding = report.binding;
  const upright = report.upright;

  return el('section', { class: 'panel report-panel' }, [
    el('h2', { text: 'What the engine measured' }),
    el('p', { class: 'muted' }, [
      `${d.length.toFixed(0)} × ${d.depth.toFixed(0)} × ${d.height.toFixed(0)} cm overall. `,
      report.removableParts.length > 0
        ? `Removable: ${report.removableParts.map((p) => p.name).join(', ')}.`
        : 'Nothing on it is removable.',
    ]),
    partsTable(report),

    el('table', { class: 'report-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Maneuver' }),
          el('th', { scope: 'col', text: 'Door width' }),
          el('th', { scope: 'col', text: 'Door height' }),
          el('th', { scope: 'col', text: 'In front' }),
          el('th', { scope: 'col', text: 'Along' }),
          el('th', { scope: 'col', text: 'Behind' }),
          el('th', { scope: 'col', text: '' }),
        ]),
      ]),
      el('tbody', {}, rows),
    ]),

    el('div', { class: 'report-figures' }, [
      el('div', {}, [
        el('span', { class: 'figure-label', text: 'Narrowest doorway any maneuver clears' }),
        el('span', { class: 'figure-value', text: report.narrowest !== undefined ? cm(report.narrowest) : '—' }),
      ]),
      el('div', {}, [
        el('span', { class: 'figure-label', text: 'Floor over every roll schedule' }),
        el('span', { class: 'figure-value', text: report.floor !== undefined ? cm(report.floor) : '—' }),
      ]),
    ]),
    // The assumption, published beside the figures it qualifies.
    el('p', { class: 'muted', text: report.wallStatement }),
    el('p', { class: 'muted' }, [
      report.narrowest !== undefined && report.floor !== undefined && report.narrowest - report.floor < 0.1
        ? 'The library reaches the floor: no way of rolling this sofa as it goes gets it through anything narrower. Leaning or turning it while it is in the doorway is not bounded by this figure.'
        : 'The library leaves room against the floor, which means there is a roll maneuver nobody has written yet.',
    ]),

    binding !== undefined
      ? el('div', { class: 'binding' }, [
          el('h3', { text: 'What decides it' }),
          el('p', { class: 'binding-line' }, [
            binding.part !== undefined
              ? el('span', {}, [
                  'The widest part of this sofa is ',
                  el('strong', { text: binding.part.label }),
                  '.',
                ])
              : el('span', { text: 'No single part: the body itself sets the width, all along it.' }),
          ]),
          el('p', { class: 'muted' }, [
            `The stretch that forces the opening is ${(binding.coverage * 100).toFixed(0)}% of its length, ` +
              `presented at a roll of ${binding.rollDeg}°.`,
          ]),
          upright !== undefined
            ? el('p', { class: 'muted' }, [
                `Carried in level it is ${cm(upright.floor)} across, and that is `,
                el('strong', { text: upright.part?.label ?? 'the body throughout' }),
                '.',
              ])
            : el('span', {}),
          el('h3', { text: 'What would change the answer' }),
          report.removableParts.length > 0
            ? el('ul', { class: 'tick-list' },
                report.removableParts.map((p) =>
                  el('li', {}, [
                    `Take off the ${p.name}: `,
                    el('strong', { text: cm(p.floorWithout) }),
                    ` instead of ${report.floor !== undefined ? cm(report.floor) : '—'}.`,
                  ]),
                ),
              )
            : el('p', {}, [
                'Nothing on this sofa comes off, so the only thing that would change the answer is a wider door — ',
                el('strong', { text: report.narrowest !== undefined ? cm(report.narrowest) : '—' }),
                ' is what it needs.',
              ]),
        ])
      : el('span', {}),

    crossingSection(report),

    modules.length > 0
      ? el('div', { class: 'binding' }, [
          el('h3', { text: 'And in the modules it actually ships as' }),
          el('ul', { class: 'tick-list' },
            modules.map((m) =>
              el('li', {}, [
                `${m.report.name}: `,
                el('strong', { text: m.report.narrowest !== undefined ? cm(m.report.narrowest) : '—' }),
                ` (${m.report.dimensions.length.toFixed(0)} × ${m.report.dimensions.depth.toFixed(0)} × ${m.report.dimensions.height.toFixed(0)} cm)`,
              ]),
            ),
          ),
          el('p', { class: 'muted' }, [
            'The piece that decides a delivery is the wider of them, not the assembled figure above.',
          ]),
        ])
      : el('span', {}),
  ]);
}

/**
 * The catalogue at a glance, narrowest first.
 *
 * The range is the point. Six sofas that all look alike on a spec sheet need
 * anything from 75 to 100 cm of doorway, and for six different reasons.
 */
export function catalogueTable(onOpen: (id: string) => void): HTMLElement {
  const ordered = [...PRECOMPUTED.catalogue].sort(
    (a, b) => (a.report.narrowest ?? Infinity) - (b.report.narrowest ?? Infinity),
  );

  return el('section', { class: 'panel catalogue', id: 'catalogue' }, [
    el('div', { class: 'section-head' }, [
      el('p', { class: 'eyebrow', text: 'The whole range, measured' }),
      el('h2', { text: 'Six sofas. Six different reasons.' }),
      el('p', { class: 'muted' }, [
        'Narrowest doorway each one can be got through, and the part of it that decides. Every figure computed offline by the same engine, and validated placement by placement against its collision test.',
      ]),
    ]),
    el('table', { class: 'report-table catalogue-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Sofa' }),
          el('th', { scope: 'col', text: 'Size' }),
          el('th', { scope: 'col', text: 'Narrowest door' }),
          el('th', { scope: 'col', text: 'What decides it' }),
        ]),
      ]),
      el('tbody', {},
        ordered.map((entry) => {
          const d = entry.report.dimensions;
          return el('tr', { class: 'catalogue-row', onclick: () => onOpen(entry.id) }, [
            el('th', { scope: 'row' }, [
              el('button', {
                class: 'link-button',
                type: 'button',
                // The shop's name for it, not the engine's. They are both real
                // and the product page shows both, but a table of products
                // should read like a table of products.
                text: productById(entry.id)?.title ?? entry.report.name,
                onclick: () => onOpen(entry.id),
              }),
            ]),
            el('td', { text: `${d.length.toFixed(0)} × ${d.depth.toFixed(0)} × ${d.height.toFixed(0)}` }),
            el('td', {}, [el('strong', { text: entry.report.narrowest !== undefined ? cm(entry.report.narrowest) : '—' })]),
            el('td', { text: entry.report.binding?.part?.label ?? 'the body throughout' }),
          ]);
        }),
      ),
    ]),
  ]);
}

/**
 * The legs case, which is the cheapest illustration of the whole idea.
 *
 * Two numbers about the same sofa, differing by a minute with a spanner, and
 * both of them derived from the same measurement rather than asserted.
 */
export function legsPanel(): HTMLElement {
  const entry = entryFor('sofa-3-seat');
  const report = entry?.report;
  const withLegs = report?.floor;
  const without = report?.removableParts[0]?.floorWithout;
  if (report === undefined || withLegs === undefined || without === undefined) {
    return el('span', {});
  }

  const card = (title: string, value: number, note: string, tone: string): HTMLElement =>
    el('div', { class: `legs-card ${tone}` }, [
      el('p', { class: 'legs-title', text: title }),
      el('p', { class: 'legs-value', text: cm(value) }),
      el('p', { class: 'muted', text: note }),
    ]);

  return el('section', { class: 'panel legs', id: 'legs' }, [
    el('div', { class: 'section-head' }, [
      el('p', { class: 'eyebrow', text: 'One minute with a spanner' }),
      el('h2', { text: 'The legs are the answer, and they unscrew.' }),
      el('p', { class: 'muted' }, [
        'The middle of this sofa is an L — a seat and a leaning backrest — and rolled past the upright it tucks into 66 cm, far under the 95 it shows square on. It never gets to use that, because the legs stand 15 cm proud at each end and every part of the sofa has to cross the wall.',
      ]),
    ]),
    el('div', { class: 'legs-grid' }, [
      card('With the legs on', withLegs, 'Set by the leg stations, at each end of the sofa', 'legs-on'),
      card('With the legs off', without, 'Now the body itself is the widest thing, at 70 cm', 'legs-off'),
    ]),
    el('p', { class: 'legs-footnote muted' }, [
      'Neither number was typed in. The engine finds the run of the sofa that forces the widest opening, names whichever part is concentrated in it, takes that part away and measures again.',
    ]),
  ]);
}
