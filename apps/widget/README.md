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
npm --workspace @fitpath/widget test         # the escalation logic and the storage
```

---

## What the page pays for, and when

Measured by `scripts/report-sizes.ts` at the end of every build and written to
`dist/SIZES.md`, because the loader's size is a promise made to stores.

| loaded | when | raw | gzip |
| --- | --- | ---: | ---: |
| `fitpath.js` — the button | with the page | 3.2 KB | **1.6 KB** |
| `modal.js` — the fit check, with the engine functions it calls | on first press | 52.5 KB | 18.4 KB |
| `data/<product>.json` — one product's library | on first press | 7–13 KB | 1.9–2.4 KB |
| `chunks/scene-*.js` + `chunks/three-*.js` — the 3D view | when a maneuver is drawn | 474.8 KB | 120.3 KB |
| `data/<product>.paths.json` — the motions to animate | with the 3D view | 14–115 KB | 1.0–6.9 KB |

The button is a classic script with no imports of its own. It captures its own
URL while `document.currentScript` is still set and resolves everything else
from beside it, so a store can serve the files from any origin. Hovering or
focusing the button prefetches `modal.js`, so a press feels instant; nothing is
fetched for a shopper who never touches it.

Three.js is most of the widget's weight by far, and it is loaded only after the
shopper has given a doorway width and there is a maneuver to show. A shopper
whose door is too narrow never pays for it.

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

## One number, not five

The engine needs five corridor dimensions and no shopper will measure five
numbers to buy a sofa. The measurements give the way out: on five of six
catalogue sofas the doorway width alone is the binding number.

So the form opens with one field. The answer is then as much as that number
answers — *the doorway is wide enough for the "on its side" maneuver, which
needs 85.01 cm* — and the modal asks for the next number only while the answer
is still open, saying why:

> Your door is wide enough. Now I need to know whether there is room to line
> it up. How much clear floor is there in front of the door? The "on its side"
> maneuver needs 282 cm — that is the sofa's own length, held square to the
> doorway.

Which number is asked next is the one the maneuver being pursued needs the
most of, relative to what homes tend to have — a sofa that needs a 222 cm tall
door is asked about the door before the room. Those "ordinary home" figures
decide the *order of questions only*; they never stand in for a number the
shopper did not give.

Every question offers two answers: a measurement, or a confirmed threshold
("at least 222 cm — yes"). The two are not the same thing and the logic keeps
them apart: a measurement can rule a maneuver out; a confirmation can satisfy a
requirement but never rule one out, because a shopper who confirmed "at least
150" has said nothing about a maneuver that needs 222. When everything still
unknown is ordinary — 222 cm behind the door, a door 85 cm tall, 95 cm along the
wall — the remaining questions collapse into one card confirmed with one tap.

The logic is [`src/modal/assess.ts`](src/modal/assess.ts), pure and tested; the
wording is [`src/modal/copy.ts`](src/modal/copy.ts), in one place so the
honesty distinctions below cannot drift apart across a dozen render functions.

---

## The four verdicts, and what each one is worth

| shown as | means | established by |
| --- | --- | --- |
| **Fits** | a validated maneuver whose every requirement the shopper's numbers meet | a comparison of five numbers against a motion validated offline against the collider |
| **Not settled yet** | a number is still missing and the answer could go either way | — |
| **No known maneuver fits** | the library has nothing for these numbers. A fact about the list, never about the sofa | the same comparison, failing everywhere |
| **Won't fit — proven** | geometrically impossible, at any angle whatsoever | the engine's closed-form `provableNoFit`, asked at every step it can be |

The proof is deliberately weak — it is per box, so it fires for a 30 cm door
and not for a 76 cm one — and nothing weaker is allowed to say no. A search
that ran out of budget never reads as "it doesn't fit" here for the simplest
reason: nothing is searched at runtime, so there is no budget to run out of.
Every number compared was measured from a validated motion at build time.

A requirement met by less than 2 cm is flagged as **close** and worth measuring
again. Numbers are shown to the hundredth they were measured to, rounded up.

**The wall.** A doorway is a tunnel the depth of the wall, and every figure
was measured behind one: 30 cm by default, `FITPATH_WALL_CM` to build for a
thicker one. Thicker is strictly harder, so each maneuver records how thick a
wall its numbers hold for — most were rebuilt behind a metre of wall and
needed the same doorway; those that turn near the wall hold only to the
thickness they were measured at — and the modal says which, in a line under
the verdict. A shopper whose wall is thicker can say so; a maneuver not
measured for it then stays *not settled* rather than being called a fit, and
the modal says the library would have to be built for a thicker wall to say
either way.

The floor quoted beside a library figure is the engine's `rollSchedule`
minimax: the narrowest doorway any *roll* schedule along the travel axis could
manage. It bounds nothing that leans or turns the item while it is inside the
wall, and the copy says so.

---

## Assembled, and in modules

For a corner sofa the assembled figure is nearly useless on its own — almost no
home has 282 cm at the door. So whenever the item is known to come apart, the
modal shows both: what it needs as one piece, and what the worst module needs,
side by side with the shopper's numbers, and a sentence computed from the
comparison saying which dimensions taking it apart actually moves.

On this catalogue's corner sofa that sentence is not the one you would guess.
The doorway width barely moves (85.01 either way — it goes through on its
side, and the height sets that), the **hallway barely moves either** (282 → 278,
because the 276 cm main run still has to be carried square), and what
collapses is the door height (200 → 108) and the length along the wall
(285 → 180). The card says exactly that, because it is computed rather than
written.

Where separability is unknown, the rigid answer is labelled as treating the
sofa as one piece and the modal says, in those words, to ask the retailer.
Where a part is removable — the three-seater's legs — the body without it gets
its own validated library at build time and its own verdict.

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

`scripts/precompute.ts` runs `reportOn` and `buildLibrary` for every sofa in
the engine's catalogue, for each module it ships as, and for the body with each
removable part taken off — every placement and edge validated against the
collider, every requirement measured from the motion — and writes one small
JSON per product plus one of paths. The product's picture is drawn from the
same boxes by [`@fitpath/illustrate`](../../packages/illustrate) and inlined.
The output under `public/data` is committed so a checkout serves without a
build step.

Whether a product comes apart is declared beside the catalogue in that script.
The engine has no way of knowing it and a shop always does — it is the
`separates` field of the sourcing pipeline's input — and `'unknown'` is the
honest default for a listing that does not say.

The widget consumes the engine and never reimplements it. At runtime it calls
`provableNoFit` for the proof, `selectManeuver` to order the maneuvers that fit,
and `buildEnvironment` + `verifyPathIn` to re-check a motion in the shopper's
own room before it is drawn. The 3D view is [`@fitpath/viewer`](../../packages/viewer),
the same code the demo draws with.
