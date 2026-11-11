# @fitpath/widget

The fit check as a store adds it: one script tag on a product page.

```html
<script async src="https://cdn.example/fitpath/fitpath.js"></script>
```

That script finds the product on the page, puts a **Will it fit through my
door?** button beside the buy control, and does nothing else until the button
is pressed. Then it fetches the rest: the modal, the product's maneuver
library, and — only when there is a maneuver to draw — the 3D view.

Everything renders inside shadow roots. The store's stylesheet cannot reach the
button or the modal, and theirs cannot reach the store's page. The fictional
shop in [`apps/store`](../store) has a stylesheet that makes every button a
black block and every heading a serif in brand red, precisely so that the
widget's own styling proves the boundary holds.

```bash
npm --workspace @fitpath/widget run build    # precompute the data, typecheck, bundle, report sizes
npm --workspace @fitpath/widget test         # the verdict logic, the copy's shape, and the storage
```

---

## What the page pays for, and when

Measured by `scripts/report-sizes.ts` at the end of every build and written to
`dist/SIZES.md`, because the loader's size is a promise made to stores.

| loaded | when | raw | gzip |
| --- | --- | ---: | ---: |
| `fitpath.js` — the button | with the page | 3.2 KB | **1.6 KB** |
| `modal.js` — the fit check, with the engine functions it calls | on first press | 53.2 KB | 18.7 KB |
| `data/<product>.json` — one product's library, behind every wall a home has | on first press | 7–18 KB | 1.9–2.8 KB |
| `chunks/scene-*.js` + `chunks/three-*.js` — the 3D view | when a way in is drawn | 474.8 KB | 120.2 KB |
| `data/<product>.paths.json` — the motions to animate, one per way in and wall | with the 3D view | 21–278 KB | 1.1–14.6 KB |

The button is a classic script with no imports of its own. It captures its own
URL while `document.currentScript` is still set and resolves everything else
from beside it, so a store can serve the files from any origin. Hovering or
focusing the button prefetches `modal.js`, so a press feels instant; nothing is
fetched for a shopper who never touches it.

Three.js is most of the widget's weight by far, and it is loaded only after the
shopper has given a doorway and there is a way in to show. A shopper whose
door is too narrow never pays for it.

**Hosting.** The modal, its chunks and the data files are fetched cross-origin
with `fetch` and `import()`, so a CDN serving them must send
`Access-Control-Allow-Origin` on all of them. Nothing else is required.

---

## Finding the product

In order of preference:

1. Any element carrying `data-fitpath-product="<id>"`. A store that wants to be
   explicit puts that on its product container; inside it, the button goes
   after the element carrying `data-fitpath-anchor` if there is one, or after
   the buy control otherwise.
2. `data-fitpath-product` on the script tag itself.
3. `<meta name="fitpath:product" content="<id>">` in the head.

The buy control is the first of: `[data-fitpath-anchor]`, a `button[name="add"]`
or `[data-add-to-cart]`, or a button whose text says *add to cart*, *add to
bag*, *add to basket* or *buy*. `window.fitpath.open(id?)` and
`window.fitpath.refresh()` are there for stores that render product content
without a page load.

The id is the item's id in the engine's catalogue — the same string the demo
and the store use.

---

## Two numbers, and everything else reported

The form asks for the doorway — width and height, together, one **Check**
button, prefilled from storage — and for nothing else. The other four numbers
a way in needs are *reported as requirements*, never asked for:

> **There is a way in**
> Needs 85.1 × 95 cm; yours is 90 × 200. Then 222 cm of clear floor in front
> of the door, 150 cm along the wall and 222 cm of clear floor behind the door.

The shopper goes and checks those. Fields beside them take a number for
anyone who wants to turn a requirement into a verdict; entering one is never a
precondition for an answer. A requirement the doorway itself settles — a
ceiling is at least as high as the door under it, a corridor runs along the
wall at least as far as the door in it is wide — is not listed.

It used to escalate: one number, then a question, then another. That was
wrong, and it is gone.

**Every way in is evaluated against whatever was given, and the one presented
is the one that best fits it.** Among the ways in whose every requirement is
met, the engine's own choice (`selectManeuver`: fewest motions, then least
demanding). Among those still open, the one whose unmeasured requirements an
ordinary home is most likely to have room for — a way in that wants 122 cm in
front of the door and a tall ceiling is a better bet than one that wants the
sofa's whole length in front — where "ordinary" is a table of figures in
`verdict.ts` that ranks candidates and never stands in for a number. When an
entered number rules the presented way in out, the next one is presented
instead. When two ways in trade differently, one line says so:

> Or straight in: no need for 260.8 cm along the wall and a 233 cm ceiling,
> but 222 cm in front and 222 cm behind.

The logic is [`src/modal/verdict.ts`](src/modal/verdict.ts), pure, with no
words in it, under named tests in [`test/verdict.test.ts`](test/verdict.test.ts)
so that a change of wording cannot silently change what is presented. Every
word the shopper reads is in [`src/modal/copy.ts`](src/modal/copy.ts), and
[`test/copy.test.ts`](test/copy.test.ts) checks its shape rather than its
wording: two lines, the threshold beside the shopper's number, the honesty in
one small line, no wall a house does not have, no sentence in capitals.

---

## The five states

One verdict line, one supporting line, everything else behind
*See all the ways in*.

| state | verdict line | supporting line | the small line |
| --- | --- | --- | --- |
| fits | Fits through this door | Needs 95.1 × 85 cm; yours is 100 × 200. Straight in, in 1 step. | — |
| a way in, with conditions | There is a way in | Needs 85.1 × 95 cm; yours is 90 × 200. Then 222 cm of clear floor in front of the door… | — |
| no known way in | Not through this door | This sofa needs 82.8 cm. Yours is 80. | *We haven’t found a way in at 80 cm — that doesn’t prove there isn’t one.* |
| proven too large | Not through this door | The folded bed frame of the sofa bed is 42 × 100 cm at its thinnest; no angle gets that through 40 × 200. | *This one is certain: it follows from the shape, with no search in it.* |
| the legs band | There is a way in — with the legs off | Needs 70.1 × 95 cm; yours is 80 × 200. Then … | With the legs on it needs 82.8 cm. |

The honesty distinctions did not go away; they moved into layers. The italic
line carries "not found is not not there". *See all the ways in* holds every
way in against the shopper's numbers, the floor, the wall, and the fine print.

The proof is deliberately weak — it argues box by box, so on this catalogue it
fires below 32–42 cm of door and never above — and nothing weaker is allowed
to say no. Nothing is searched at runtime, so no search can run out of
budget and read as a negative. A requirement met by less than 2 cm is flagged
as close and worth measuring again. A requirement is shown to a tenth,
rounded up, so it never reads smaller than it is.

**The legs.** A part that comes off is a way in only where it changes the
verdict — the body as sold has no way in, the body without the part does —
and only when the listing says it comes off (`detachable: true`, declared
beside the catalogue in `scripts/precompute.ts`: the store’s listing says the
beech legs unscrew) or the shopper has answered a question saying so. Outside
that band nothing about the legs is shown, drawn or assumed. Inside it, with
the listing’s word, the way in presented is the one without the legs and the
title says so; without it, the verdict stands and one line asks.

**The wall.** A doorway is a tunnel the depth of the wall, and every figure
was measured behind one. The default is an ordinary interior partition,
12 cm — the engine’s `DEFAULT_WALL_THICKNESS`, with the figures it was
checked against — and the library is also built behind 20, 30 and 40 cm
(`WALL_THICKNESSES_IN_HOMES`; `FITPATH_WALLS_CM` to change it), rebuilding
only the ways in whose numbers depend on the thickness. The answer is for the
thinnest; the widget then re-decides behind each thicker wall and mentions
the wall **only when one of them changes the answer**:

> For a wall up to 30 cm thick. Thicker than that, it is not through this
> door.

with a field for the shopper’s own wall. When the answer is the same behind
every wall a person could have — which on this catalogue is every door but
the band between 82.8 and 85.1 cm on the three-seater — nothing about walls
is said at all. A wall entered is answered for as given, with the next thicker
measurement; a way in not measured for it is left out and the small line says
which one would have worked behind a thinner wall.

The floor in the fine print is the engine’s `rollSchedule` minimax: the
narrowest doorway any *roll* schedule along the travel axis could manage. It
bounds nothing that leans or turns the item while it is inside the wall, and
on the three-seater the lean goes 2.3 cm under it.

---

## Assembled, and in modules

Whenever the item is known to come apart, its modules are a route of their
own, every module has to get through, and the one that needs the most decides
the numbers. The route presented is whichever of *as one piece* and *taken
apart* the shopper’s numbers fit better; the title says *in two pieces* when
it is the latter. Where separability is unknown the sofa is one piece, and a
line behind the disclosure says the listing does not say and to ask the
retailer.

---

## Measure once per store

The shopper's numbers are kept in `localStorage`, so every other product on the
same store answers immediately with the fields already filled. Storage is per
origin, which makes this per store, and that is all it is. Every read and write
is wrapped: a private window, blocked site data, a full quota or a record
another script wrote are reasons to forget, never reasons to stop working.
[`test/storage.test.ts`](test/storage.test.ts) covers each.

---

## What is built when

`scripts/precompute.ts` runs `reportOn` and `buildLibraryForWalls` for every
sofa in the engine's catalogue, for each module it ships as, and for the body
with each removable part taken off — every placement and edge validated
against the collider behind each wall a home can have, every requirement
measured from the motion — and writes one small JSON per product plus one of
paths, keyed by way in and wall. The product's picture is drawn from the
same boxes by [`@fitpath/illustrate`](../../packages/illustrate) and inlined.
The output under `public/data` is committed so a checkout serves without a
build step.

Whether a product comes apart, and whether a removable part is known to come
off, are declared beside the catalogue in that script. The engine has no way
of knowing either and a shop always does — they are the `separates` and
`legs.detachable` fields of the sourcing pipeline's input — and `'unknown'`
is the honest default for a listing that does not say.

The widget consumes the engine and never reimplements it. At runtime it calls
`provableNoFit` for the proof, `selectManeuver` to order the maneuvers that fit,
and `buildEnvironment` + `verifyPathIn` to re-check a motion in the shopper's
own room before it is drawn. The 3D view is [`@fitpath/viewer`](../../packages/viewer),
the same code the demo draws with.
