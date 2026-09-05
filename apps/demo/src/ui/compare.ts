/**
 * The compare view.
 *
 * One sofa, one doorway, two corridors. The doorway is identical on both sides
 * and the sofa passes through it on both sides — a calculator that only knows
 * the doorway answers "fits" twice. One of these corridors has no path.
 *
 * The failing side is not an illustration. It shows the *same* path, replayed
 * in the narrow corridor by the engine's `firstContactAlongPath`, frozen at the
 * first placement its collision test rejects. Its verdict comes from its own
 * full plan, not from the replay.
 */
import { buildEnvironment } from '@fitpath/engine';
import type { Environment, PathContact, Placement, Suggestion } from '@fitpath/engine';
import { COMPARE } from '../catalog.ts';
import { DEMO_MAX_NODES } from '../engine/protocol.ts';
import type { Verdict } from '../engine/protocol.ts';
import { runPlan, type RunningPlan } from '../engine/client.ts';
import { buildTimeline, stepRanges, type Timeline } from '../viewer/timeline.ts';
import { clear, el } from './dom.ts';
import { Playback } from './playback.ts';
import { Stage, createTransport, type Transport } from './stage.ts';
import { seconds } from './format.ts';
import { spinner, suggestionList, verdictPill } from './results.ts';

interface Side {
  root: HTMLElement;
  stage: Stage;
  head: HTMLElement;
  note: HTMLElement;
  environment: Environment;
}

function buildSide(
  environment: Environment,
  label: string,
  sublabel: string,
): Side {
  const stage = new Stage({ label, sublabel });
  const head = el('div', { class: 'compare-head' }, [
    el('div', {}, [
      el('h3', { class: 'compare-side-title', text: label }),
      el('p', { class: 'compare-side-sub', text: sublabel }),
    ]),
    el('div', { class: 'compare-side-pill' }, [spinner('Planning…')]),
  ]);
  const note = el('div', { class: 'compare-note' });
  const root = el('div', { class: 'compare-side' }, [head, stage.element, note]);
  return { root, stage, head, note, environment };
}

function setPill(side: Side, content: HTMLElement): void {
  const slot = side.head.querySelector('.compare-side-pill');
  if (slot === null) return;
  clear(slot);
  slot.append(content);
}

/** Where a contact sits on the shared timeline. */
function contactFraction(contact: PathContact, timeline: Timeline): number {
  const from = timeline.marks[contact.segment] ?? 0;
  const to = timeline.marks[contact.segment + 1] ?? from;
  return from + (to - from) * contact.t;
}

export interface CompareView {
  element: HTMLElement;
  dispose(): void;
}

export function createCompareView(): CompareView {
  const { product, start, roomy, tight } = COMPARE;
  const roomyEnvironment = buildEnvironment(roomy);
  const tightEnvironment = buildEnvironment(tight);

  const roomySide = buildSide(
    roomyEnvironment,
    `${roomy.hallwayWidth} cm corridor`,
    'Clearance in front of the door',
  );
  const tightSide = buildSide(
    tightEnvironment,
    `${tight.hallwayWidth} cm corridor`,
    'Clearance in front of the door',
  );

  const playback = new Playback();
  playback.setLooping(true);
  const transportSlot = el('div', { class: 'compare-transport' });
  let transport: Transport | undefined;

  const caption = el('p', { class: 'compare-caption' }, [
    'The doorway is ',
    el('strong', { text: `${roomy.openingWidth} × ${roomy.openingHeight} cm` }),
    ' on both sides, and the sofa’s cross-section is 95 × 85 cm — so every free “will it fit” calculator answers ',
    el('em', { text: 'fits' }),
    ' to both of these. The corridor is the thing that decides it, and only one of these two has a path.',
  ]);

  const element = el('section', { class: 'compare', id: 'compare' }, [
    el('div', { class: 'section-head' }, [
      el('p', { class: 'eyebrow', text: 'Why a doorway calculator is not enough' }),
      el('h2', { text: 'The same sofa. The same doorway. Two corridors.' }),
      caption,
    ]),
    el('div', { class: 'compare-grid' }, [roomySide.root, tightSide.root]),
    transportSlot,
    el('p', { class: 'compare-footnote' }, [
      'The narrow side replays the identical path and stops at the first placement the engine’s own collision test rejects — marked on the floor. Its verdict above comes from a full, separate search of that corridor, not from the replay.',
    ]),
  ]);

  // Both sides show the start pose until there is something to animate.
  roomySide.stage.setScene({ environment: roomyEnvironment, item: product.item, pose: start });
  tightSide.stage.setScene({ environment: tightEnvironment, item: product.item, pose: start });

  let timeline: Timeline | undefined;
  let path: readonly Placement[] | undefined;
  let contact: PathContact | null | undefined;
  const jobs: RunningPlan[] = [];

  const applyTight = (): void => {
    if (timeline === undefined || path === undefined || contact === undefined) return;
    tightSide.stage.setScene({
      environment: tightEnvironment,
      item: product.item,
      path,
      ...(contact !== null ? { haltAt: contactFraction(contact, timeline) } : {}),
    });
    tightSide.stage.setFraction(playback.position);
  };

  const unsubscribe = playback.subscribe((fraction) => {
    roomySide.stage.setFraction(fraction);
    tightSide.stage.setFraction(fraction);
  });

  // --- the corridor with room to turn in ---------------------------------
  jobs.push(
    runPlan(
      { itemId: product.id, params: roomy, start, replayIn: tight },
      {
        onVerdict(verdict: Verdict, millis: number): void {
          setPill(roomySide, verdictPill(verdict));
          roomySide.stage.setOverlay(null);
          if (!verdict.feasible) {
            clear(roomySide.note);
            roomySide.note.append(el('p', { class: 'muted', text: verdict.message }));
            return;
          }

          path = verdict.path;
          timeline = buildTimeline(product.item, verdict.path);
          // About 85 cm of swept motion per second: fast enough not to drag,
          // slow enough to watch the corner clear the jamb.
          playback.setDuration(Math.min(14000, Math.max(4500, (timeline.sweep / 85) * 1000)));

          roomySide.stage.setScene({
            environment: roomyEnvironment,
            item: product.item,
            path: verdict.path,
          });

          clear(roomySide.note);
          roomySide.note.append(
            el('p', { class: 'compare-summary' }, [
              el('strong', { text: `${verdict.steps.length} moves` }),
              ` · found in ${seconds(millis)} · ${verdict.stats.nodesGenerated.toLocaleString('en-US')} nodes`,
            ]),
          );

          transport?.dispose();
          clear(transportSlot);
          transport = createTransport({
            playback,
            steps: verdict.steps,
            ranges: stepRanges(verdict.steps, verdict.path, timeline),
          });
          transportSlot.append(transport.element);
          applyTight();
          playback.play();
        },
        onReplay(result: PathContact | null): void {
          contact = result;
          applyTight();
        },
        onFailed(message: string): void {
          roomySide.stage.setOverlay(el('p', { class: 'overlay-error', text: message }));
        },
      },
    ),
  );

  // --- the corridor that has no path -------------------------------------
  jobs.push(
    runPlan(
      { itemId: product.id, params: tight, start },
      {
        onVerdict(verdict: Verdict, millis: number): void {
          setPill(tightSide, verdictPill(verdict));
          clear(tightSide.note);
          tightSide.note.append(
            el('p', { class: 'compare-summary' }, [
              verdict.feasible
                ? el('strong', { text: `${verdict.steps.length} moves` })
                : el('strong', { text: 'Every reachable configuration ruled out' }),
              ` · ${seconds(millis)} · ${verdict.stats.nodesGenerated.toLocaleString('en-US')} nodes`,
            ]),
            el('p', { class: 'compare-pending', text: 'Working out what would fix it…' }),
          );
        },
        onDiagnostics(suggestions: Suggestion[]): void {
          const pending = tightSide.note.querySelector('.compare-pending');
          pending?.remove();
          const helpful = suggestions.filter((s) => s.helps);
          tightSide.note.append(
            suggestionList(helpful.length > 0 ? helpful : suggestions, tight),
          );
        },
        onFailed(message: string): void {
          tightSide.stage.setOverlay(el('p', { class: 'overlay-error', text: message }));
        },
      },
    ),
  );

  return {
    element,
    dispose(): void {
      for (const job of jobs) job.cancel();
      unsubscribe();
      transport?.dispose();
      playback.dispose();
      roomySide.stage.dispose();
      tightSide.stage.dispose();
    },
  };
}

export const COMPARE_NODE_CAP = DEMO_MAX_NODES;
