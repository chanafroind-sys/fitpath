/**
 * A canvas with a viewer behind it, plus the transport that drives one or more
 * of them.
 *
 * Stage and transport are separate because the compare view needs two stages on
 * one transport: the argument only lands if both maneuvers are at the same
 * instant of the same timeline.
 */
import type { Step } from '@fitpath/engine';
import { Viewer, type SceneSetup } from '../viewer/viewer.ts';
import { onThemeChange, palette } from './theme.ts';
import { clear, el, hebrew } from './dom.ts';
import type { Playback } from './playback.ts';
import type { StepRange } from '../viewer/timeline.ts';

export interface StageOptions {
  label?: string;
  sublabel?: string;
}

export class Stage {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly badgeSlot: HTMLElement;
  private readonly labelSlot: HTMLElement;
  private readonly viewer: Viewer;
  private readonly unsubscribeTheme: () => void;
  private topDown = false;

  constructor(options: StageOptions = {}) {
    this.canvas = el('canvas', { class: 'stage-canvas' });
    this.overlay = el('div', { class: 'stage-overlay', hidden: true });
    this.badgeSlot = el('div', { class: 'stage-badges' });
    this.labelSlot = el('div', { class: 'stage-label' }, [
      options.label !== undefined ? el('strong', { text: options.label }) : null,
      options.sublabel !== undefined ? el('span', { text: options.sublabel }) : null,
    ]);

    const topDownButton = el('button', {
      class: 'ghost-button stage-view-toggle',
      type: 'button',
      text: 'Top-down',
      'aria-pressed': 'false',
      onclick: () => {
        this.topDown = !this.topDown;
        this.viewer.setTopDown(this.topDown);
        topDownButton.setAttribute('aria-pressed', String(this.topDown));
        topDownButton.classList.toggle('is-active', this.topDown);
      },
    });

    this.element = el('div', { class: 'stage' }, [
      this.canvas,
      this.labelSlot,
      this.badgeSlot,
      el('div', { class: 'stage-tools' }, [topDownButton]),
      this.overlay,
    ]);

    this.viewer = new Viewer(this.canvas, palette());
    this.unsubscribeTheme = onThemeChange(() => this.viewer.setPalette(palette()));
  }

  setScene(setup: SceneSetup): void {
    this.viewer.setScene(setup);
  }

  setFraction(fraction: number): void {
    this.viewer.setFraction(fraction);
  }

  /** A message across the canvas: searching, failed, nothing to animate. */
  setOverlay(content: HTMLElement | null): void {
    clear(this.overlay);
    if (content === null) {
      this.overlay.hidden = true;
      return;
    }
    this.overlay.append(content);
    this.overlay.hidden = false;
  }

  setBadges(badges: HTMLElement[]): void {
    clear(this.badgeSlot);
    for (const badge of badges) this.badgeSlot.append(badge);
  }

  dispose(): void {
    this.unsubscribeTheme();
    this.viewer.dispose();
  }
}

export interface TransportOptions {
  playback: Playback;
  /** Kept in sync with the scrubber's highlighted step. */
  steps?: readonly Step[];
  ranges?: readonly StepRange[];
  onStepFocus?(index: number): void;
}

export interface Transport {
  element: HTMLElement;
  dispose(): void;
}

export function createTransport(options: TransportOptions): Transport {
  const { playback } = options;

  const playButton = el('button', {
    class: 'primary-button transport-play',
    type: 'button',
    'aria-label': 'Play',
    onclick: () => playback.toggle(),
  });

  const restartButton = el('button', {
    class: 'ghost-button',
    type: 'button',
    text: 'Restart',
    onclick: () => playback.restart(),
  });

  const scrubber = el('input', {
    class: 'transport-scrubber',
    type: 'range',
    min: '0',
    max: '1000',
    value: '0',
    step: '1',
    'aria-label': 'Scrub the maneuver',
    oninput: (event: Event) => {
      playback.pause();
      playback.seek(Number((event.target as HTMLInputElement).value) / 1000);
    },
  });

  const stepLabel = el('div', { class: 'transport-step' });

  const element = el('div', { class: 'transport' }, [
    el('div', { class: 'transport-controls' }, [playButton, restartButton, scrubber]),
    stepLabel,
  ]);

  const unsubscribe = playback.subscribe((fraction, playing) => {
    scrubber.value = String(Math.round(fraction * 1000));
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    const { steps, ranges } = options;
    if (steps === undefined || ranges === undefined || steps.length === 0) {
      clear(stepLabel);
      return;
    }
    let index = ranges.findIndex((range) => fraction >= range.from && fraction <= range.to);
    if (index < 0) index = fraction >= 1 ? steps.length - 1 : 0;
    const step = steps[index]!;
    clear(stepLabel);
    stepLabel.append(
      el('span', { class: 'transport-step-index', text: `${index + 1}/${steps.length}` }),
      el('span', { class: 'transport-step-en', text: step.en }),
      hebrew(step.he, 'transport-step-he'),
    );
    options.onStepFocus?.(index);
  });

  return {
    element,
    dispose(): void {
      unsubscribe();
    },
  };
}
