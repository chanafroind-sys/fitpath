/**
 * The 3D view, in its own chunk.
 *
 * This module is the only thing in the widget that imports `@fitpath/viewer`,
 * and through it Three.js, which is most of the widget's weight by far. It is
 * loaded with a dynamic `import()` from `index.ts` at the moment there is a
 * maneuver to draw and not before — a shopper whose door is too narrow never
 * pays for it.
 *
 * What it draws is a scene the collider has already cleared: the caller
 * builds the environment, re-verifies the path in it, and only then asks for a
 * picture. Nothing here decides anything.
 */
import { LIGHT_PALETTE, Playback, Viewer, buildTimeline } from '@fitpath/viewer';
import type { Environment, Item, Placement } from '@fitpath/engine';
import { el } from './dom.ts';

export interface SceneHandle {
  element: HTMLElement;
  dispose(): void;
}

export function mountScene(environment: Environment, item: Item, path: readonly Placement[], label: string): SceneHandle {
  const canvas = el('canvas', { 'aria-label': `${label}, animated` });
  const stage = el('div', { class: 'stage' }, [canvas, el('span', { class: 'label', text: 'Drag to orbit · scroll to zoom' })]);

  const viewer = new Viewer(canvas, LIGHT_PALETTE);
  viewer.setScene({ environment, item, path });

  const timeline = buildTimeline(item, path);
  const playback = new Playback();
  playback.setLooping(true);
  // Time proportional to swept distance, so a turn of a long sofa takes longer
  // to play than a short slide — which is also what it takes to perform.
  playback.setDuration(Math.min(16000, Math.max(5000, (timeline.sweep / 85) * 1000)));

  const play = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Pause', onclick: () => playback.toggle() });
  const scrubber = el('input', {
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
  const topDown = el('button', {
    class: 'btn btn-ghost',
    type: 'button',
    text: 'Top-down',
    'aria-pressed': 'false',
    onclick: () => {
      const on = topDown.getAttribute('aria-pressed') !== 'true';
      topDown.setAttribute('aria-pressed', String(on));
      viewer.setTopDown(on);
    },
  });

  const unsubscribe = playback.subscribe((fraction, playing) => {
    viewer.setFraction(fraction);
    scrubber.value = String(Math.round(fraction * 1000));
    play.textContent = playing ? 'Pause' : 'Play';
  });
  playback.play();

  const element = el('div', {}, [stage, el('div', { class: 'transport' }, [play, scrubber, topDown])]);
  return {
    element,
    dispose(): void {
      unsubscribe();
      playback.dispose();
      viewer.dispose();
    },
  };
}
