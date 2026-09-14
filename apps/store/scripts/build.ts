/**
 * A fictional furniture shop, built as static HTML the way a real one is.
 *
 * This is the deliverable that proves the widget embeds without any retailer
 * agreeing to anything: an ordinary product page — header, gallery, price, an
 * add-to-cart form, a specifications table — with one script tag at the bottom.
 * The widget finds the product, puts its button by the buy control, and the
 * page's own stylesheet, which is deliberately opinionated about buttons and
 * headings and tables, never touches it.
 *
 * The shop's copy is its own. The dimensions on every page are read from the
 * engine's fixtures, because a shop that could disagree with the engine about
 * how big a sofa is would make the fit check pointless; the pictures are drawn
 * from the same box models.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFAS, itemWorldBoxes, unionAabb } from '@fitpath/engine';
import type { Item } from '@fitpath/engine';
import { illustrate } from '@fitpath/illustrate';

const STORE = 'Fjordhem';
const TAGLINE = 'Sofas made to be lived on';

interface Listing {
  id: string;
  title: string;
  price: number;
  blurb: string;
  fabric: string;
  delivery: string;
}

/** Retail dressing only. Nothing here is a measurement. */
const LISTINGS: Listing[] = [
  {
    id: 'sofa-3-seat',
    title: 'Almedal three-seater',
    price: 6490,
    blurb: 'A generous three-seater with a reclined back and feather-topped cushions. The solid beech legs unscrew without tools.',
    fabric: 'Wool-blend, stone',
    delivery: 'Delivered in 2–3 weeks. Two-person delivery to the room of your choice.',
  },
  {
    id: 'slim-arm-2-seat',
    title: 'Vetle two-seater',
    price: 4290,
    blurb: 'Slim eight-centimetre arms and a low back on a recessed plinth, for rooms where a sofa should not take up the view.',
    fabric: 'Bouclé, oat',
    delivery: 'Delivered in 2–3 weeks.',
  },
  {
    id: 'corner-sofa',
    title: 'Rosendal corner sofa',
    price: 11900,
    blurb: 'A right-hand chaise return on a long run. Ships as two modules that bolt together in the room.',
    fabric: 'Linen-blend, sage',
    delivery: 'Delivered in 4–6 weeks. Assembled in the room by our delivery team.',
  },
  {
    id: 'deep-seat-lounge',
    title: 'Havsta lounge sofa',
    price: 7350,
    blurb: 'Low and very deep — a sofa for lying across. Sixteen-centimetre arms, a hardwood frame, no removable parts.',
    fabric: 'Cotton velvet, moss',
    delivery: 'Delivered in 3–4 weeks.',
  },
  {
    id: 'recliner-2-seat',
    title: 'Brekke recliner two-seater',
    price: 8990,
    blurb: 'Powered recline on both seats. The mechanism is housed across the back and bolted to the frame.',
    fabric: 'Aniline leather, cognac',
    delivery: 'Delivered in 4–6 weeks. Requires a socket within 1.5 m.',
  },
  {
    id: 'sofa-bed',
    title: 'Lindholm sofa bed',
    price: 6790,
    blurb: 'A full-size folding frame with a sprung mattress. Sofa by day; the frame fills the body, so nothing comes off.',
    fabric: 'Heavy weave, charcoal',
    delivery: 'Delivered in 3–4 weeks.',
  },
];

const ORIGIN = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

function dimensions(item: Item): { width: number; depth: number; height: number } {
  const b = unionAabb(itemWorldBoxes(item, ORIGIN));
  return { width: b.maxX - b.minX, depth: b.maxY - b.minY, height: b.maxZ - b.minZ };
}

const shekels = (v: number): string => `₪${v.toLocaleString('en-US')}`;
const cm = (v: number): string => String(Math.round(v * 10) / 10);

const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The shop's stylesheet. Opinionated on purpose: every button is a black
 * block, every heading is a serif in the brand red, tables have hairlines,
 * inputs have thick borders. If any of that reaches the widget, the shadow
 * boundary has failed and the page will show it.
 */
const STYLES = `
*{box-sizing:content-box}
body{margin:0;font:16px/1.55 Georgia,"Times New Roman",serif;color:#2b2622;background:#fbf8f3}
a{color:#7a2e1e}
h1,h2,h3{font-family:Georgia,serif;color:#7a2e1e;font-weight:400;letter-spacing:.01em}
h1{font-size:2.2rem;margin:.2em 0 .1em}
h2{font-size:1.4rem}
p{margin:1em 0}
button,input[type=submit]{font:inherit;background:#111;color:#fff;border:0;border-radius:0;padding:14px 26px;text-transform:uppercase;letter-spacing:.12em;font-size:.85rem;cursor:pointer}
button:hover{background:#7a2e1e}
input,select{border:2px solid #7a2e1e;padding:8px;font:inherit;background:#fff}
table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #d9cfc2;padding:8px 4px;text-align:left}
th{font-weight:400;color:#6b5f55;width:40%}
.top{border-bottom:1px solid #d9cfc2;background:#fff}
.top-inner,.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.top-inner{display:flex;align-items:center;justify-content:space-between;height:64px}
.brand{font-size:1.35rem;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;color:#2b2622}
.nav a{margin-left:22px;text-decoration:none;color:#2b2622;font-size:.95rem}
.banner{background:#7a2e1e;color:#fff;text-align:center;font-size:.85rem;padding:6px}
.crumbs{font-size:.85rem;color:#6b5f55;margin:18px 0}
.product{display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:start}
.gallery{background:#fff;border:1px solid #e6ddd1;padding:24px}
.gallery svg{width:100%;height:auto;display:block}
.gallery figcaption{font-size:.8rem;color:#6b5f55;margin-top:8px}
.price{font-size:1.5rem;margin:.2em 0 1em}
.buy{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:1em 0}
.buy select{padding:12px}
.fine{font-size:.85rem;color:#6b5f55}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;margin:24px 0 48px}
.card{background:#fff;border:1px solid #e6ddd1;padding:16px;text-decoration:none;color:inherit;display:block}
.card svg{width:100%;height:auto}
.card h2{font-size:1.1rem;margin:.6em 0 .2em}
.card .p{color:#6b5f55;font-size:.95rem;margin:0}
footer{margin:60px 0 30px;font-size:.85rem;color:#6b5f55;border-top:1px solid #d9cfc2;padding-top:18px}
@media (max-width:760px){.product{grid-template-columns:1fr}}
`;

function shell(title: string, body: string, depth: number): string {
  const up = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — ${STORE}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="banner">Free delivery on orders over ₪4,000 · 30-day returns</div>
<header class="top"><div class="top-inner">
  <a class="brand" href="${up}index.html">${STORE}</a>
  <nav class="nav"><a href="${up}index.html">Sofas</a><a href="#">Armchairs</a><a href="#">Fabrics</a><a href="#">Showrooms</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="wrap">
  <p>${STORE} is a fictional shop. It exists to show <a href="https://github.com/chanafroind-sys/fitpath">fitpath</a>'s fit check embedded in an ordinary product page with a single script tag — the one at the bottom of this page's source.</p>
</footer>
</body>
</html>
`;
}

function productPage(listing: Listing, item: Item): string {
  const d = dimensions(item);
  const removable = (item.removableParts ?? []).map((p) => p.name).join(', ') || 'none';
  const body = `
<p class="crumbs"><a href="../index.html">Sofas</a> › ${escape(listing.title)}</p>
<article class="product" data-fitpath-product="${listing.id}">
  <figure class="gallery">
    ${illustrate(item, { label: `${listing.title}, illustration` })}
    <figcaption>Illustration drawn from the sofa's box model — every dimension on this page is measured from the same model.</figcaption>
  </figure>
  <section>
    <h1>${escape(listing.title)}</h1>
    <p class="price">${shekels(listing.price)}</p>
    <p>${escape(listing.blurb)}</p>
    <form class="buy" action="cart/add" method="post" onsubmit="return false">
      <select name="fabric" aria-label="Fabric"><option>${escape(listing.fabric)}</option></select>
      <button type="submit" name="add">Add to cart</button>
    </form>
    <p class="fine">${escape(listing.delivery)}</p>
    <h2>Dimensions</h2>
    <table>
      <tr><th>Width</th><td>${cm(d.width)} cm</td></tr>
      <tr><th>Depth</th><td>${cm(d.depth)} cm</td></tr>
      <tr><th>Height</th><td>${cm(d.height)} cm</td></tr>
      <tr><th>Removable parts</th><td>${escape(removable)}</td></tr>
      <tr><th>Fabric</th><td>${escape(listing.fabric)}</td></tr>
    </table>
  </section>
</article>

<!-- The fit check. This one tag is the entire integration. -->
<script async src="../widget/fitpath.js"></script>
`;
  return shell(listing.title, body, 1);
}

function indexPage(): string {
  const cards = LISTINGS.map((listing) => {
    const item = SOFAS.find((s) => s.id === listing.id)!;
    const d = dimensions(item);
    return `<a class="card" href="products/${listing.id}.html">
  ${illustrate(item, { label: `${listing.title}, illustration` })}
  <h2>${escape(listing.title)}</h2>
  <p class="p">${cm(d.width)} × ${cm(d.depth)} × ${cm(d.height)} cm · ${shekels(listing.price)}</p>
</a>`;
  }).join('\n');
  return shell('Sofas', `<h1>Sofas</h1><p>${TAGLINE}.</p><div class="grid">${cards}</div>`, 0);
}

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const widgetDist = resolve(here, '../../widget/dist');

if (!existsSync(resolve(widgetDist, 'fitpath.js'))) {
  throw new Error(`build the widget first: ${widgetDist} has no fitpath.js`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(resolve(dist, 'products'), { recursive: true });

writeFileSync(resolve(dist, 'index.html'), indexPage());
for (const listing of LISTINGS) {
  const item = SOFAS.find((s) => s.id === listing.id);
  if (item === undefined) throw new Error(`no fixture for ${listing.id}`);
  writeFileSync(resolve(dist, 'products', `${listing.id}.html`), productPage(listing, item));
}

// The "CDN": the widget's build, copied in beside the pages. A real store
// would point the script tag at a hosted copy instead; nothing else changes,
// because the widget resolves everything from its own script's URL.
cpSync(widgetDist, resolve(dist, 'widget'), { recursive: true });

console.log(`wrote ${LISTINGS.length + 1} pages and the widget to ${dist}`);
