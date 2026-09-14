/**
 * `fitpath.js` — the whole of what a store adds to its page.
 *
 *     <script async src="https://cdn.example/fitpath/fitpath.js"></script>
 *
 * This file has one job and is kept small enough that a store cannot object
 * to it on page-weight grounds: find the product on the page, put a button
 * next to the buy control, and when the button is pressed, fetch the rest.
 * Nothing about geometry, maneuvers, or 3D is in here. Nothing is imported.
 * The modal, the engine and the viewer all load on demand from beside this
 * script, so the page pays for them only when a shopper asks the question.
 *
 * ## Finding the product
 *
 * In order of preference:
 *
 * 1. Any element carrying `data-fitpath-product="<id>"`. A store that wants to
 *    be explicit puts that on its product container; the button goes beside
 *    the element carrying `data-fitpath-anchor` inside it, if there is one, or
 *    beside the buy control otherwise.
 * 2. `data-fitpath-product` on the script tag itself, for a page template
 *    that already knows its own product id.
 * 3. A `<meta name="fitpath:product" content="<id>">` in the head.
 *
 * The buy control is the first of: `[data-fitpath-anchor]`, a button whose
 * `name` is `add`, one carrying `data-add-to-cart`, or one whose text says
 * "add to cart" / "add to bag" / "add to basket" / "buy". A store whose markup
 * matches none of those uses the explicit anchor.
 *
 * The button is rendered inside a shadow root, so the store's stylesheet
 * cannot restyle it and it cannot restyle the store.
 */

interface FitpathApi {
  version: string;
  /** Open the fit check for the product on the page, or for a given id. */
  open(productId?: string): Promise<void>;
  /** Re-run the page scan; for stores that swap product content in place. */
  refresh(): void;
}

declare global {
  interface Window {
    fitpath?: FitpathApi;
  }
}

type ModalModule = typeof import('./modal/index.ts');

const VERSION = '0.1.0';
const HOST_TAG = 'fitpath-fit-check';

/**
 * Where this script came from, captured NOW.
 *
 * `document.currentScript` is only set while the script is executing, and in
 * a classic script a relative dynamic `import()` would resolve against the
 * page's URL rather than this file's. So the base is taken while it is still
 * available and everything else is fetched by absolute URL from it.
 */
const script = document.currentScript as HTMLScriptElement | null;
const base = new URL('./', script?.src ?? document.baseURI).href;

let modal: Promise<ModalModule> | undefined;

/** Fetch the rest of the widget, once. Also called on hover so a click feels instant. */
function loadModal(): Promise<ModalModule> {
  if (modal === undefined) {
    modal = import(/* @vite-ignore */ `${base}modal.js`) as Promise<ModalModule>;
    modal.catch(() => {
      // A failed load is retried on the next press rather than remembered.
      modal = undefined;
    });
  }
  return modal;
}

function productOnPage(): { id: string; container: Element | null } | undefined {
  const marked = document.querySelector<HTMLElement>('[data-fitpath-product]');
  if (marked !== null && marked !== script) {
    const id = marked.dataset['fitpathProduct'];
    if (id) return { id, container: marked };
  }
  const own = script?.dataset['fitpathProduct'];
  if (own) return { id: own, container: null };
  const meta = document.querySelector<HTMLMetaElement>('meta[name="fitpath:product"]');
  if (meta?.content) return { id: meta.content, container: null };
  return undefined;
}

const BUY_TEXT = /add to (cart|bag|basket)|^buy( now)?$|הוס(ף|יפי) לסל/i;

function buyControl(scope: ParentNode): Element | undefined {
  const anchor = scope.querySelector('[data-fitpath-anchor]');
  if (anchor !== null) return anchor;
  const named = scope.querySelector('button[name="add"], [data-add-to-cart], button[type="submit"][name="add"]');
  if (named !== null) return named;
  for (const button of scope.querySelectorAll('button, a[role="button"], input[type="submit"]')) {
    const text = (button.textContent ?? (button as HTMLInputElement).value ?? '').trim();
    if (BUY_TEXT.test(text)) return button;
  }
  return undefined;
}

/** The button, in its own shadow root. */
function makeButton(onPress: () => void): HTMLElement {
  const host = document.createElement(HOST_TAG);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
:host{display:block;margin:.5rem 0;font:inherit}
button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:.5rem;cursor:pointer;
  padding:.55rem .9rem;border-radius:999px;border:1.5px solid #1f6f5c;color:#1f6f5c;background:transparent;
  font:600 .92rem/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;white-space:nowrap}
button:hover{background:#1f6f5c;color:#fff}
button:focus-visible{outline:3px solid #7fc8b5;outline-offset:2px}
button[aria-busy="true"]{opacity:.7;cursor:progress}
svg{width:1.1em;height:1.1em;flex:none}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="15" cy="12" r="1" fill="currentColor"/>' +
    '<path d="M2 12h3M19 12h3"/></svg><span>Will it fit through my door?</span>';
  button.addEventListener('click', onPress);
  button.addEventListener('pointerenter', () => void loadModal().catch(() => undefined), { once: true });
  button.addEventListener('focus', () => void loadModal().catch(() => undefined), { once: true });
  root.append(style, button);
  return host;
}

async function open(productId?: string): Promise<void> {
  const found = productId !== undefined ? { id: productId, container: null } : productOnPage();
  if (found === undefined) {
    console.warn('[fitpath] no product on this page: add data-fitpath-product="<id>" to the product container');
    return;
  }
  const host = document.querySelector<HTMLElement>(HOST_TAG);
  const button = host?.shadowRoot?.querySelector('button');
  button?.setAttribute('aria-busy', 'true');
  try {
    const mod = await loadModal();
    await mod.open({ productId: found.id, base, opener: button ?? undefined });
  } catch (error) {
    console.error('[fitpath] could not open the fit check', error);
  } finally {
    button?.removeAttribute('aria-busy');
  }
}

function inject(): void {
  if (document.querySelector(HOST_TAG) !== null) return;
  const found = productOnPage();
  if (found === undefined) return;
  const scope = found.container ?? document;
  const control = buyControl(scope) ?? (found.container !== null ? buyControl(document) : undefined);
  const button = makeButton(() => void open());
  if (control !== undefined) control.insertAdjacentElement('afterend', button);
  else (found.container ?? document.body).append(button);
}

function refresh(): void {
  document.querySelector(HOST_TAG)?.remove();
  inject();
}

window.fitpath = { version: VERSION, open, refresh };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true });
else inject();

export {};
