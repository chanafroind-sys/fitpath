/**
 * The shell: a masthead, a hash router, and three views.
 *
 * The home route mounts the compare view first and lets it start planning
 * straight away, so the first thing on screen is the thing worth seeing rather
 * than a form waiting to be filled in.
 */
import './styles.css';
import { productById } from './catalog.ts';
import { clear, el } from './ui/dom.ts';
import { createCompareView, type CompareView } from './ui/compare.ts';
import { createChecker, type CheckerView } from './ui/checker.ts';
import { createProductPage, createShop } from './ui/shop.ts';
import { createRoadmap } from './ui/roadmap.ts';
import { currentTheme, initTheme, onThemeChange, toggleTheme } from './ui/theme.ts';

const STORE = 'Loamhouse Living';

interface MountedView {
  element: HTMLElement;
  dispose?(): void;
}

const root = document.querySelector<HTMLElement>('#app')!;
let mounted: MountedView | undefined;
/** Which view is on screen, so an in-page anchor does not restart its planning. */
let mountedRoute: string | undefined;

function navigate(hash: string): void {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

function masthead(): HTMLElement {
  const themeButton = el('button', {
    class: 'ghost-button theme-toggle',
    type: 'button',
    'aria-label': 'Switch theme',
    onclick: () => toggleTheme(),
  });
  const label = (): string => (currentTheme() === 'dark' ? 'Light' : 'Dark');
  themeButton.textContent = label();
  onThemeChange(() => {
    themeButton.textContent = label();
  });

  return el('header', { class: 'masthead' }, [
    el('div', { class: 'masthead-inner' }, [
      el('button', {
        class: 'brand',
        type: 'button',
        onclick: () => navigate('#/'),
      }, [
        el('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: STORE }),
      ]),
      el('span', { class: 'badge badge-demo', text: 'Fictional store · engine demo' }),
      el('nav', { class: 'masthead-nav' }, [
        el('a', { href: '#/', text: 'Shop' }),
        el('a', { href: '#/#compare', text: 'Why it matters' }),
        el('a', { href: '#/#roadmap', text: 'What is real' }),
      ]),
      themeButton,
    ]),
  ]);
}

function colophon(): HTMLElement {
  return el('footer', { class: 'colophon' }, [
    el('div', { class: 'colophon-inner' }, [
      el('p', {}, [
        el('strong', { text: 'fitpath' }),
        ' — a deterministic geometry engine for whether furniture can be maneuvered through a doorway. Pure TypeScript, no physics engine, no randomness, zero runtime dependencies.',
      ]),
      el('p', { class: 'muted' }, [
        'This storefront is fictional and exists to exercise the engine. Product images are illustrations. ',
        el('a', { href: 'https://github.com/chanafroind-sys/fitpath', text: 'Source on GitHub' }),
        '.',
      ]),
    ]),
  ]);
}

function homeView(): MountedView {
  const compare: CompareView = createCompareView();
  const element = el('div', { class: 'view view-home' }, [
    el('section', { class: 'hero' }, [
      el('div', { class: 'hero-inner' }, [
        el('p', { class: 'eyebrow', text: 'fitpath' }),
        el('h1', { text: 'It fits through the door. That was never the question.' }),
        el('p', { class: 'hero-lede' }, [
          'A geometry engine that works out whether a piece of furniture can actually be ',
          el('em', { text: 'maneuvered' }),
          ' into a room — and when it cannot, what specifically is in the way. Everything below is computed live, in your browser.',
        ]),
      ]),
    ]),
    compare.element,
    createShop((id) => navigate(`#/product/${id}`)),
    createRoadmap(),
  ]);

  return { element, dispose: () => compare.dispose() };
}

function productView(id: string): MountedView {
  const product = productById(id);
  if (product === undefined) return notFound();
  return {
    element: el('div', { class: 'view' }, [
      createProductPage(product, {
        onCheck: (productId) => navigate(`#/check/${productId}`),
        onBack: () => navigate('#/'),
      }),
    ]),
  };
}

function checkerView(id: string): MountedView {
  const product = productById(id);
  if (product === undefined) return notFound();
  const checker: CheckerView = createChecker(product, () => navigate(`#/product/${id}`));
  return {
    element: el('div', { class: 'view' }, [checker.element]),
    dispose: () => checker.dispose(),
  };
}

function notFound(): MountedView {
  return {
    element: el('div', { class: 'view' }, [
      el('section', { class: 'panel' }, [
        el('h1', { text: 'Nothing here' }),
        el('p', {}, [
          'That page does not exist. ',
          el('a', { href: '#/', text: 'Back to the shop' }),
          '.',
        ]),
      ]),
    ]),
  };
}

function render(): void {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [route, id] = hash.split('/');
  const key =
    route === 'product' || route === 'check' ? `${route}/${id ?? ''}` : 'home';

  // `#/#compare` is the home view plus an anchor. Re-mounting it would throw
  // away two plans that are already running or already answered.
  const anchor = window.location.hash.split('#')[2];
  const scroll = (): void => {
    if (anchor !== undefined && anchor !== '') {
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else {
      window.scrollTo({ top: 0 });
    }
  };

  if (key === mountedRoute && mounted !== undefined) {
    scroll();
    return;
  }

  mounted?.dispose?.();
  clear(root);

  if (route === 'product' && id !== undefined) mounted = productView(id);
  else if (route === 'check' && id !== undefined) mounted = checkerView(id);
  else mounted = homeView();
  mountedRoute = key;

  root.append(masthead(), mounted.element, colophon());
  scroll();
}

initTheme();
window.addEventListener('hashchange', render);
render();
