/**
 * `modal.js` — the fit check itself, loaded when the button is pressed.
 *
 * Renders inside a shadow root on a host appended to `<body>`, so the store's
 * stylesheet cannot reach it and it cannot reach the store's. Fetches the
 * product's library from beside the script, asks for one number, and answers.
 *
 * The engine is a dependency of this chunk — `provableNoFit` for the proof,
 * `selectManeuver` for the choice among maneuvers that fit, `buildEnvironment`
 * and `verifyPathIn` to re-check a motion in the shopper's own room before it
 * is drawn. None of that is geometry the widget does itself; it is geometry
 * the widget asks the engine to do. The 3D view is a further chunk, loaded
 * only when there is a maneuver to show.
 */
import { buildEnvironment, prepareItem, verifyPathIn } from '@fitpath/engine';
import type { EnvironmentParams } from '@fitpath/engine';
import { DATA_VERSION, type Carry, type MeasurementKey, type WidgetManeuver, type WidgetPaths, type WidgetProduct } from '../types.ts';
import { createStorage } from '../storage.ts';
import { assess, type Have, type Known } from './assess.ts';
import { el, clear } from './dom.ts';
import { STYLES } from './styles.ts';
import { renderBody, renderHeader } from './view.ts';
import type { SceneHandle } from './scene.ts';

export interface OpenOptions {
  productId: string;
  /** Where the widget's files live, ending in a slash. */
  base: string;
  /** The element to return focus to on close. */
  opener?: HTMLElement | undefined;
}

let current: { close(): void } | undefined;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return (await response.json()) as T;
}

export async function open(options: OpenOptions): Promise<void> {
  if (current !== undefined) return;

  const host = el('div', { 'data-fitpath-modal': '' });
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style', { text: STYLES });
  const body = el('div', { class: 'body' }, [el('div', { class: 'skeleton' })]);
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fp-title', tabindex: '-1' }, [body]);
  const backdrop = el('div', { class: 'backdrop' });
  root.append(style, backdrop, dialog);

  const previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.append(host);

  let scenes: SceneHandle[] = [];
  const disposeScenes = (): void => {
    for (const scene of scenes) scene.dispose();
    scenes = [];
  };

  const close = (): void => {
    if (current === undefined) return;
    current = undefined;
    disposeScenes();
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    document.documentElement.style.overflow = previousOverflow;
    options.opener?.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep focus inside the dialog. The active element inside a shadow root is
    // read off the root, not the document.
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = root.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  current = { close };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', close);
  dialog.focus();

  let product: WidgetProduct;
  try {
    product = await fetchJson<WidgetProduct>(`${options.base}data/${encodeURIComponent(options.productId)}.json`);
    if (product.dataVersion !== DATA_VERSION) {
      throw new Error(`data version ${product.dataVersion} is not the ${DATA_VERSION} this widget reads`);
    }
  } catch (error) {
    clear(body);
    body.append(
      el('div', { class: 'card tone-not-found' }, [
        el('h3', { text: 'The fit check could not load for this product' }),
        el('p', { class: 'muted small', text: error instanceof Error ? error.message : String(error) }),
        el('p', { class: 'muted small', text: 'Nothing was computed. This is a loading problem, not an answer.' }),
      ]),
      el('div', { class: 'row' }, [el('button', { class: 'btn btn-ghost', type: 'button', text: 'Close', onclick: close })]),
    );
    return;
  }

  dialog.prepend(renderHeader(product, close));

  const storage = createStorage();
  let have: Have = storage.load();
  let paths: Promise<WidgetPaths> | undefined;
  const loadPaths = (): Promise<WidgetPaths> => {
    if (paths === undefined) {
      paths = fetchJson<WidgetPaths>(`${options.base}data/${encodeURIComponent(options.productId)}.paths.json`);
      paths.catch(() => {
        paths = undefined;
      });
    }
    return paths;
  };

  /** Bumped on every render, so a 3D view still loading for a stale answer is dropped. */
  let generation = 0;

  const mountStage = (slot: HTMLElement, carry: Carry, maneuver: WidgetManeuver, params: EnvironmentParams): void => {
    const mine = generation;
    const placeholder = el('div', { class: 'stage' }, [el('div', { class: 'note', text: 'Loading the 3D view…' })]);
    slot.append(placeholder);

    const note = (text: string): void => {
      clear(placeholder);
      placeholder.append(el('div', { class: 'note', text }));
    };

    void (async () => {
      let environment;
      try {
        environment = buildEnvironment(params);
      } catch (error) {
        note(`This scene cannot be built: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      let path;
      try {
        const all = await loadPaths();
        path = all[carry.id]?.[maneuver.templateId];
      } catch {
        note('The motion could not be fetched, so nothing is drawn. The answer above does not depend on it.');
        return;
      }
      if (mine !== generation) return;
      if (path === undefined || path.length === 0) {
        note('No motion is recorded for this maneuver, so nothing is drawn.');
        return;
      }
      // Nothing is drawn that the collider has not cleared IN THIS SCENE. The
      // requirement says it will pass; this is the check that it does.
      const fault = verifyPathIn(prepareItem(carry.item), path, environment);
      if (fault !== undefined) {
        note(`The motion could not be re-verified in this scene (${fault.kind} ${fault.index}), so it is not drawn. Treat the answer above with that in mind.`);
        return;
      }
      try {
        const { mountScene } = await import('./scene.ts');
        if (mine !== generation) return;
        const scene = mountScene(environment, carry.item, path, maneuver.name);
        scenes.push(scene);
        placeholder.replaceWith(scene.element);
      } catch {
        note('The 3D view could not be loaded. The answer above does not depend on it.');
      }
    })();
  };

  const update = (focusQuestion: boolean): void => {
    generation++;
    disposeScenes();
    const answer = assess(product, have);
    renderBody(body, answer, handlers, storage.available ? 'Saved for this store' : 'Kept for this visit only');
    body.scrollTop = 0;
    if (focusQuestion) {
      const input = body.querySelector<HTMLInputElement>('.tone-ask input');
      if (input !== null) input.focus();
      else body.querySelector<HTMLElement>('.verdict-title')?.focus?.();
    }
  };

  const handlers = {
    onKnown(key: MeasurementKey, known: Known): void {
      have = { ...have, [key]: known };
      storage.save(have);
      update(true);
    },
    onForget(key: MeasurementKey): void {
      const next = { ...have };
      delete next[key];
      // A number given later may have been asked because of this one; they are
      // all kept, since each was measured on its own terms.
      have = next;
      storage.save(have);
      update(true);
    },
    onWall(thickness: number | undefined): void {
      const next = { ...have };
      if (thickness === undefined) delete next.wallThickness;
      else next.wallThickness = thickness;
      have = next;
      storage.save(have);
      update(false);
    },
    onReset(): void {
      have = {};
      storage.clear();
      update(true);
    },
    mountStage,
  };

  update(true);
}
