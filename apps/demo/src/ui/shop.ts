/**
 * Screen one: the shop.
 *
 * A product grid and a product page, dressed like a furniture retailer's, with
 * one difference — the dimensions table is not typed in. Every number on it is
 * measured off the engine's own fixture by `retailDimensions`, which is the
 * same geometry the planner searches. A catalogue that could disagree with the
 * planner about how big a sofa is would make the whole exercise pointless.
 */
import { PRODUCTS, boundsOf, retailDimensions, type Product } from '../catalog.ts';
import { cm, shekels } from './format.ts';
import { el, hebrew } from './dom.ts';

function productCard(product: Product, onOpen: (id: string) => void): HTMLElement {
  const dims = retailDimensions(product);
  return el('article', { class: 'product-card' }, [
    el('button', {
      class: 'product-card-media',
      type: 'button',
      'aria-label': `Open ${product.title}`,
      onclick: () => onOpen(product.id),
    }, [
      el('img', { src: product.image, alt: `${product.title}, illustration`, loading: 'lazy' }),
    ]),
    el('div', { class: 'product-card-body' }, [
      el('h3', { class: 'product-card-title', text: product.title }),
      el('p', { class: 'product-card-tagline', text: product.tagline }),
      el('p', { class: 'product-card-dims', text: `${cm(dims.width)} × ${cm(dims.depth)} × ${cm(dims.height)} cm` }),
      el('div', { class: 'product-card-foot' }, [
        el('span', { class: 'price', text: shekels(product.price) }),
        el('button', {
          class: 'primary-button',
          type: 'button',
          text: 'View',
          onclick: () => onOpen(product.id),
        }),
      ]),
    ]),
  ]);
}

export function createShop(onOpen: (id: string) => void): HTMLElement {
  return el('section', { class: 'shop', id: 'shop' }, [
    el('div', { class: 'section-head' }, [
      el('p', { class: 'eyebrow', text: 'The shop' }),
      el('h2', { text: 'Three things that have to get through a door' }),
      el('p', {
        class: 'section-lede',
        text: 'A demonstration storefront. Every dimension below is read from the engine’s own fixtures — the same objects its tests are written against.',
      }),
    ]),
    el('div', { class: 'product-grid' }, PRODUCTS.map((product) => productCard(product, onOpen))),
  ]);
}

function dimensionsTable(product: Product): HTMLElement {
  const dims = retailDimensions(product);
  const bounds = boundsOf(product.item);
  const rows: [string, string][] = [
    ['Width', `${cm(dims.width)} cm`],
    ['Depth', `${cm(dims.depth)} cm`],
    ['Height', `${cm(dims.height)} cm`],
    ['Smallest cross-section', `${cm(Math.min(dims.width, dims.depth))} × ${cm(dims.height)} cm`],
    ['Modelled as', `${product.item.boxes.length} box${product.item.boxes.length === 1 ? '' : 'es'}`],
    [
      'Removable parts',
      (product.item.removableParts ?? []).map((part) => part.name).join(', ') || 'none',
    ],
    ['Sits below its own origin', `${cm(-bounds.minZ)} cm`],
  ];

  return el('table', { class: 'spec-table' }, [
    el('caption', { text: 'Measured from the engine’s model, not transcribed' }),
    el(
      'tbody',
      {},
      rows.map(([term, value]) =>
        el('tr', {}, [el('th', { scope: 'row', text: term }), el('td', { text: value })]),
      ),
    ),
  ]);
}

export function createProductPage(
  product: Product,
  handlers: { onCheck: (id: string) => void; onBack: () => void },
): HTMLElement {
  return el('section', { class: 'product-page' }, [
    el('button', {
      class: 'ghost-button back-link',
      type: 'button',
      text: '← All products',
      onclick: handlers.onBack,
    }),
    el('div', { class: 'product-layout' }, [
      el('div', { class: 'product-media' }, [
        el('img', { src: product.image, alt: `${product.title}, illustration` }),
        el('p', { class: 'image-note', text: 'Product image is an illustration, not a photograph.' }),
      ]),
      el('div', { class: 'product-detail' }, [
        el('p', { class: 'eyebrow', text: product.item.name }),
        el('h1', { class: 'product-title', text: product.title }),
        hebrew(product.titleHe, 'product-title-he'),
        el('p', { class: 'product-price', text: shekels(product.price) }),
        el('p', { class: 'product-blurb', text: product.blurb }),
        el('p', { class: 'product-material', text: product.material }),
        el('button', {
          class: 'primary-button cta',
          type: 'button',
          text: 'Will it fit through my door?',
          onclick: () => handlers.onCheck(product.id),
        }),
        el('p', {
          class: 'cta-note',
          text: 'Four measurements, and an answer that says what it actually established.',
        }),
        dimensionsTable(product),
      ]),
    ]),
  ]);
}
