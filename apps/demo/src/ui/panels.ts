/**
 * The three things a result has to show that it was not showing.
 *
 * Every maneuver rather than only the winner; the model part by part rather
 * than an envelope; and the crossing station by station rather than as one
 * step called "carry it through on its side".
 */
import type {
  Environment,
  EnvironmentParams,
  Item,
  ItemReport,
  Maneuver,
  ManeuverLine,
  Placement,
} from '@fitpath/engine';
import { prepareItem, verifyPathIn } from '@fitpath/engine';
import { buildTimeline } from '../viewer/timeline.ts';
import { el } from './dom.ts';
import { Playback } from './playback.ts';
import { Stage, createTransport, type Transport } from './stage.ts';

const cm = (value: number): string => `${value.toFixed(value % 1 === 0 ? 0 : 2)} cm`;

/** A turning maneuver this close to the winner is worth showing beside it. */
const WORTH_SHOWING_CM = 2;

export interface Animated {
  element: HTMLElement;
  dispose(): void;
}

/**
 * A validated path, animated.
 *
 * Whatever reaches here has already been through `verifyPathIn` against this
 * exact environment, so the motion on screen is one the collider cleared.
 */
export function maneuverStage(
  item: Item,
  environment: Environment,
  path: readonly Placement[],
  label: string,
): Animated {
  const stage = new Stage({ label, sublabel: 'Drag to orbit · scroll to zoom' });
  stage.setScene({ environment, item, path });

  const timeline = buildTimeline(item, path);
  const playback = new Playback();
  playback.setLooping(true);
  playback.setDuration(Math.min(16000, Math.max(5000, (timeline.sweep / 85) * 1000)));
  playback.subscribe((fraction) => stage.setFraction(fraction));
  const transport: Transport = createTransport({ playback });
  playback.play();

  return {
    element: el('div', { class: 'result-stage' }, [stage.element, transport.element]),
    dispose(): void {
      transport.dispose();
      playback.dispose();
      stage.dispose();
    },
  };
}

/** Which maneuvers actually run in this scene, fewest motions first. */
export function validHere(
  item: Item,
  params: EnvironmentParams,
  environment: Environment,
  maneuvers: readonly Maneuver[],
): Maneuver[] {
  const prepared = prepareItem(item);
  return maneuvers
    .filter(
      (m) =>
        m.requirement.doorWidth <= params.openingWidth &&
        m.requirement.doorHeight <= params.openingHeight &&
        m.requirement.hallwayClearance <= params.hallwayWidth &&
        m.requirement.roomDepth <= params.roomDepth &&
        // The third corridor dimension, which the approach maneuvers spend
        // instead of depth. Leaving it out would offer somebody a maneuver that
        // needs 261 cm along their wall when they have 200.
        m.requirement.alongWall <= params.hallwayDepth &&
        m.requirement.alongWall <= params.roomWidth &&
        verifyPathIn(prepared, m.path, environment) === undefined,
    )
    .sort((a, b) => a.stages.length - b.stages.length);
}

const turnsById = (lines: readonly ManeuverLine[], id: string): boolean =>
  lines.find((l) => l.templateId === id)?.turns === true;

/**
 * Every maneuver that works here, not only the one that won.
 *
 * The seat-first maneuver is the only one whose angle changes while the item is
 * inside the opening, which is the single thing this engine does that a doorway
 * calculator cannot. On most of this catalogue it ties the simpler maneuvers to
 * within a few hundredths of a centimetre — so a page that showed only the
 * winner was hiding the entire argument behind a rounding difference.
 */
export function maneuverChoices(
  maneuvers: readonly Maneuver[],
  lines: readonly ManeuverLine[],
  chosenId: string,
): HTMLElement {
  const chosen = maneuvers.find((m) => m.templateId === chosenId);

  return el('div', { class: 'choices' }, [
    el('h3', { text: 'Every maneuver that works here' }),
    el('table', { class: 'report-table choices-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Maneuver' }),
          el('th', { scope: 'col', text: 'Doorway' }),
          el('th', { scope: 'col', text: 'In front' }),
          el('th', { scope: 'col', text: 'Along' }),
          el('th', { scope: 'col', text: 'Behind' }),
          el('th', { scope: 'col', text: 'Angle' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        maneuvers.map((m) =>
          el('tr', { class: m.templateId === chosenId ? 'row-chosen' : '' }, [
            el('th', { scope: 'row' }, [
              el('span', { text: m.name }),
              m.templateId === chosenId
                ? el('span', { class: 'chosen-tag', text: 'chosen' })
                : el('span', {}),
              el('span', {
                class: 'muted',
                text: ` · ${m.stages.length} stage${m.stages.length === 1 ? '' : 's'}`,
              }),
            ]),
            el('td', {
              text: `${cm(m.requirement.doorWidth)} × ${cm(m.requirement.doorHeight)}`,
            }),
            el('td', { text: cm(m.requirement.hallwayClearance) }),
            el('td', { text: cm(m.requirement.alongWall) }),
            el('td', { text: cm(m.requirement.roomDepth) }),
            el('td', {}, [
              turnsById(lines, m.templateId)
                ? el('strong', { class: 'turns-tag', text: 'turns in the opening' })
                : el('span', { class: 'muted', text: 'held constant' }),
            ]),
          ]),
        ),
      ),
    ]),
    chosen === undefined
      ? el('span', {})
      : el('p', { class: 'muted' }, [
          `“${chosen.name}” is the one offered, because it has the fewest separate motions of those that fit. `,
          el('strong', { text: 'It is not the only one that works.' }),
        ]),
  ]);
}

export interface Alternative {
  maneuver: Maneuver;
  buys: number;
  costsHeight: number;
  costsStages: number;
}

/**
 * The turning maneuver, when it is close enough to the winner to matter.
 *
 * `undefined` when it won outright — it is already the one on screen — or when
 * it is more than a couple of centimetres behind, where showing it would be
 * offering somebody a worse option for no reason.
 */
export function turningAlternative(
  maneuvers: readonly Maneuver[],
  lines: readonly ManeuverLine[],
  chosenId: string,
): Alternative | undefined {
  const chosen = maneuvers.find((m) => m.templateId === chosenId);
  if (chosen === undefined) return undefined;
  const turning = maneuvers.find(
    (m) => m.templateId !== chosenId && turnsById(lines, m.templateId),
  );
  if (turning === undefined) return undefined;

  const buys = chosen.requirement.doorWidth - turning.requirement.doorWidth;
  if (buys < -WORTH_SHOWING_CM) return undefined;
  return {
    maneuver: turning,
    buys,
    costsHeight: turning.requirement.doorHeight - chosen.requirement.doorHeight,
    costsStages: turning.stages.length - chosen.stages.length,
  };
}

/** What the turning maneuver buys and what it costs, in one sentence. */
export function tradeLine(alt: Alternative): HTMLElement {
  const gains =
    alt.buys > 0.05
      ? `a doorway ${alt.buys.toFixed(2)} cm narrower`
      : 'no narrower doorway, on this sofa';
  const costs: string[] = [];
  if (alt.costsHeight > 0.05) costs.push(`${alt.costsHeight.toFixed(0)} cm more headroom`);
  if (alt.costsStages > 0) {
    costs.push(`${alt.costsStages} more stage${alt.costsStages === 1 ? '' : 's'}`);
  }

  return el('p', { class: 'trade-line' }, [
    el('strong', { text: 'What turning buys: ' }),
    gains,
    el('strong', { text: '. What it costs: ' }),
    costs.length > 0 ? costs.join(', and ') : 'nothing measurable here',
    '.',
  ]);
}

/**
 * The model itself, part by part.
 *
 * An envelope — "180 x 100 x 105 cm, 6 boxes" — says nothing about why a sofa
 * needs the doorway it needs. This is what the thing is made of, with the part
 * that decides the answer marked and the amount it decides it by. Every figure
 * is read off the boxes; none of it is written down anywhere.
 */
export function partsTable(report: ItemReport): HTMLElement {
  const height = report.dimensions.height;
  return el('div', { class: 'parts' }, [
    el('h3', { text: `Modelled as ${report.boxCount} boxes, in ${report.parts.length} parts` }),
    el('table', { class: 'report-table parts-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Part' }),
          el('th', { scope: 'col', text: 'Each one' }),
          el('th', { scope: 'col', text: 'Sits at' }),
          el('th', { scope: 'col', text: '' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        report.parts.map((part) => {
          const below = height - part.top;
          const notes: string[] = [];
          if (part.leanDeg !== undefined) {
            notes.push(`leans ${Math.abs(part.leanDeg).toFixed(0)}°`);
          }
          if (below > 0.5) notes.push(`stops ${below.toFixed(0)} cm below the top`);
          return el('tr', { class: part.binding ? 'row-binding' : '' }, [
            el('th', { scope: 'row' }, [
              el('span', { text: part.label }),
              part.boxes > 1
                ? el('span', { class: 'muted', text: ` ×${part.boxes}` })
                : el('span', {}),
            ]),
            el('td', {
              text: `${cm(part.length)} × ${cm(part.depth)} × ${cm(part.height)}`,
            }),
            el('td', { text: `${part.bottom.toFixed(0)}–${part.top.toFixed(0)} cm up` }),
            el('td', {}, [
              part.binding
                ? el('strong', {
                    class: 'binds-tag',
                    text:
                      part.bindsBy !== undefined
                        ? `decides the answer — ${part.bindsBy.toFixed(2)} cm of it`
                        : 'decides the answer',
                  })
                : el('span', { class: 'muted', text: notes.join(', ') }),
            ]),
          ]);
        }),
      ),
    ]),
  ]);
}

/**
 * The crossing, station by station.
 *
 * The angle column earns its place by what it does NOT do on a constant-angle
 * maneuver: the same figure, seven times down the page, beside a list of parts
 * that changes at every one of them. Set against the seat-first column, which
 * does change, it is the clearest available statement of what this engine
 * computes and a doorway calculator cannot.
 */
export function stationTable(line: ManeuverLine): HTMLElement {
  const stations = line.stations ?? [];
  if (stations.length === 0) return el('span', {});

  return el('div', { class: 'stations' }, [
    el('h4', { class: 'station-head' }, [
      el('span', { text: line.name }),
      line.turns === true
        ? el('span', { class: 'turns-tag', text: 'turns in the opening' })
        : el('span', { class: 'muted', text: 'one angle throughout' }),
    ]),
    el('table', { class: 'report-table station-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'At' }),
          el('th', { scope: 'col', text: 'Angle' }),
          el('th', { scope: 'col', text: 'Needs' }),
          el('th', { scope: 'col', text: 'In the doorway' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        stations.map((s) =>
          el('tr', {}, [
            el('td', { text: `${s.station.toFixed(0)} cm` }),
            el('td', { class: 'cell-angle' }, [el('strong', { text: `${s.rollDeg.toFixed(0)}°` })]),
            el('td', { text: cm(s.width) }),
            el('td', { class: 'cell-parts', text: s.parts.join(', ') }),
          ]),
        ),
      ),
    ]),
  ]);
}

/** All three crossings side by side, which is where the contrast lives. */
export function crossingSection(report: ItemReport): HTMLElement {
  const lines = report.maneuvers.filter((m) => m.valid && (m.stations?.length ?? 0) > 0);
  if (lines.length === 0) return el('span', {});

  return el('div', { class: 'binding' }, [
    el('h3', { text: 'The crossing, station by station' }),
    el('p', { class: 'muted' }, [
      'Where the wall is along the sofa, what angle it is held at there, and how wide its section is at that moment. ',
      'Two of these hold one angle from end to end. One does not, and that is the difference between a maneuver and an arithmetic check.',
    ]),
    el('div', { class: 'stations-grid' }, lines.map(stationTable)),
  ]);
}
