/**
 * `modal.js` — the fit check itself, loaded when the button is pressed.
 *
 * Renders inside a shadow root on a host appended to `<body>`, so the store's
 * stylesheet cannot reach it and it cannot reach the store's. Fetches the
 * product's library from beside the script, asks for the doorway, and answers.
 *
 * The engine is a dependency of this chunk — `provableNoFit` for the proof,
 * `selectManeuver` for the choice among ways in that fit, `buildEnvironment`
 * and `verifyPathIn` to re-check a motion in the shopper's own room before it
 * is drawn. None of that is geometry the widget does itself; it is geometry
 * the widget asks the engine to do. The 3D view is a further chunk, loaded
 * only when there is a way in to show.
 */
import { buildEnvironment, prepareItem, verifyPathIn } from '@fitpath/engine';
import type { EnvironmentParams } from '@fitpath/engine';
import { DATA_VERSION, OPTIONAL_KEYS, type Carry, type Key, type WallVariant, type WidgetManeuver, type WidgetPaths, type WidgetProduct } from '../types.ts';
import { createStorage } from '../storage.ts';
import { FORM, MODAL, STEPS } from './copy.ts';
import { decide, type Have } from './verdict.ts';
import { el, clear } from './dom.ts';
import { STYLES } from './styles.ts';
import { renderBody, renderHeader, type ViewHandlers } from './view.ts';
import type { SceneHandle } from './scene.ts';

export interface OpenOptions {
  productId: string;
  /** Where the widget's files live, ending in a slash. */
  base: string;
  /** The element to return focus to on close. */
  opener?: HTMLElement | undefined;
}

let current: { close(): void } | undefined;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';

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
  const body = el('div', { class: 'body' }, [el('div', { class: 'skeleton', 'aria-label': MODAL.loading })]);
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
        el('h3', { text: MODAL.couldNotLoad }),
        el('p', { class: 'muted small', text: error instanceof Error ? error.message : String(error) }),
        el('p', { class: 'muted small', text: MODAL.nothingComputed }),
      ]),
      el('div', { class: 'row' }, [el('button', { class: 'btn btn-ghost', type: 'button', text: MODAL.close, onclick: close })]),
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

  const mountStage = (slot: HTMLElement, carry: Carry, maneuver: WidgetManeuver, variant: WallVariant, params: EnvironmentParams): void => {
    const mine = generation;
    const placeholder = el('div', { class: 'stage' }, [el('div', { class: 'note', text: STEPS.loading })]);
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
        note(STEPS.cannotBuild(error instanceof Error ? error.message : String(error)));
        return;
      }
      let path;
      try {
        const all = await loadPaths();
        path = all[carry.id]?.[variant.pathKey];
      } catch {
        note(STEPS.notFetched);
        return;
      }
      if (mine !== generation) return;
      if (path === undefined || path.length === 0) {
        note(STEPS.noMotion);
        return;
      }
      // Nothing is drawn that the collider has not cleared IN THIS SCENE. The
      // requirement says it will pass; this is the check that it does.
      const fault = verifyPathIn(prepareItem(carry.item), path, environment);
      if (fault !== undefined) {
        note(STEPS.notVerified(`${fault.kind} ${fault.index}`));
        return;
      }
      try {
        const { mountScene } = await import('./scene.ts');
        if (mine !== generation) return;
        const scene = mountScene(environment, carry.item, path, maneuver.name);
        scenes.push(scene);
        placeholder.replaceWith(scene.element);
      } catch {
        note(STEPS.notLoaded);
      }
    })();
  };

  const update = (focusVerdict: boolean): void => {
    generation++;
    disposeScenes();
    const verdict = decide(product, have);
    renderBody(body, product, verdict, handlers, storage.available ? FORM.saved : FORM.kept);
    body.scrollTop = 0;
    if (focusVerdict) body.querySelector<HTMLElement>('.verdict-title')?.focus();
  };

  const set = (next: Have, focusVerdict: boolean): void => {
    have = next;
    storage.save(have);
    update(focusVerdict);
  };

  const handlers: ViewHandlers = {
    onOpening(width: number, height: number): void {
      set({ ...have, doorWidth: width, doorHeight: height }, true);
    },
    onOptional(values: Partial<Record<Key, number | undefined>>): void {
      const next = { ...have };
      for (const key of OPTIONAL_KEYS) {
        if (!(key in values)) continue;
        const value = values[key];
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      set(next, true);
    },
    onWall(thickness: number | undefined): void {
      const next = { ...have };
      if (thickness === undefined) delete next.wallThickness;
      else next.wallThickness = thickness;
      set(next, false);
    },
    onPartOff(part: string, off: boolean): void {
      const next = { ...have };
      const offList = (have.partsOff ?? []).filter((p) => p !== part);
      const onList = (have.partsOn ?? []).filter((p) => p !== part);
      (off ? offList : onList).push(part);
      if (offList.length === 0) delete next.partsOff;
      else next.partsOff = offList;
      if (onList.length === 0) delete next.partsOn;
      else next.partsOn = onList;
      set(next, true);
    },
    onReset(): void {
      have = {};
      storage.clear();
      update(false);
      body.querySelector<HTMLInputElement>('#fp-doorWidth')?.focus();
    },
    mountStage,
  };

  update(false);
  if (have.doorWidth === undefined) body.querySelector<HTMLInputElement>('#fp-doorWidth')?.focus();
}
