# @fitpath/demo

A demonstration storefront for [`@fitpath/engine`](../../packages/engine): a mock
furniture retailer whose "will it fit through my door?" button runs the real
planner, in the browser, while you watch.

```bash
npm install
npm --workspace @fitpath/demo run dev      # http://localhost:5173
npm --workspace @fitpath/demo run build    # typecheck, then bundle to dist/
npm --workspace @fitpath/demo run preview  # serve the built bundle
```

No backend. No API key. Nothing is precomputed.

---

## Which engine answered

Three things can answer "will it fit", and they are not worth the same, so the
page always says which one spoke.

1. **The maneuver library** — microseconds. A short list of maneuvers, each one
   instantiated for this exact sofa and validated placement by placement against
   the collider *before the page was built*, each recorded with the four numbers
   it asks of a doorway. Answering is a comparison of four numbers.
2. **The closed-form proof** — `provableNoFit`, a geometric argument with no
   search in it. The only thing in the system allowed to report a definite no.
3. **The general planner** — a full search of positions and orientations. The
   fallback, and the only one that takes real time.

**"No maneuver in the library fits" is never rendered as "does not fit."** The
library is a list of moves known to work, so its silence is a statement about
the list. When it misses, the page says so in those words and hands the question
to the planner.

### The clearance caveat, which is on every library answer

Every maneuver begins with the sofa **already square to the doorway**, and
holding a two-metre sofa square to a wall takes two metres of floor in front of
that wall. So each answer carries its `hallwayClearance` figure — 222 cm for the
three-seater — and says plainly that turning an item square from along a
corridor is not yet in the library. A shopper with a 120 cm hallway must not be
handed an answer that quietly assumed 222.

## What is real, and what is illustrated

This distinction is the whole point of the demo, so it is stated here as
plainly as it is stated on the page itself.

### Computed live by the engine

| On the page | Where it comes from |
| --- | --- |
| Every verdict — *Fits*, *No path found*, *Won't fit — proven*, *Inconclusive*, *Not searched* | `plan()` (or the triage below), in a Web Worker, from the measurements shown |
| The animated maneuver | the `Placement[]` path `plan()` returned, interpolated by the engine's own `interpolate` |
| The step instructions, English and Hebrew | `Step.en` / `Step.he` |
| The thresholds — "about 195 cm of clearance" | `diagnose()`, which re-plans the counterfactual rather than estimating it |
| Where the blocked maneuver stops | `firstContactAlongPath()`, replaying the same path in the narrower corridor |
| Product dimensions in the shop | `unionAabb(itemWorldBoxes(item, origin))` on the engine's own fixtures |
| The scene geometry drawn in 3D | `buildEnvironment()` — the same call the planner searched |
| Timings and node counts | `PlanResult.stats` |
| Every maneuver's four requirement numbers | `buildManeuver()`, measured from the motion and then validated in exactly the environment it asks for |
| "The widest part of this sofa is its legs" | `bindingStation()` — the run of the item that forces the widest opening, and whichever part is concentrated in it |
| The theoretical floor beside each maneuver | `bestRollSchedule().bound`, a minimax over every roll at every station: no schedule can do better |
| The catalogue table, sorted by narrowest doorway | `reportOn()` for each of the six sofas |

The library and the hero's planner figures are computed by `scripts/precompute.ts`
at **build time**, not in the browser — the planner's side of the hero takes
eleven seconds to fail to find a route, and the point is that it happened, not
that it happens while you wait. The output is committed so `npm run dev` works
without a build step, and `npm run build` regenerates it first.

### Illustrated, and labelled as such on the page

- **Product images are illustrations**, hand-drawn SVG. There are no
  photographs anywhere in this demo.
- **The box-model overlay** in the "What is real" section is a static overlay
  drawn by hand over one of those illustrations. No image was analysed. It
  carries a *Roadmap — not implemented* badge and a paragraph saying so.
- **Every card in the roadmap grid** is a limitation, not a feature. They are
  taken from the engine README's own *Not supported yet*.
- **The store, the brand and the prices are fictional.** The masthead says so.

---

## The three screens

**The shop** — three products, whose dimensions are measured off
`SOFA_3_SEAT`, `WARDROBE` and `REFRIGERATOR` rather than typed into the
catalogue. What `catalog.ts` adds is retail dressing: a price, a blurb, and
which local axis a shopper calls "width". That last one is metadata, never a
re-assignment: the wardrobe's local Y carries its 60 cm depth because local Y
is the axis pitch tips it over, and changing that would change the answer.

**The fit checker** — four measurements with defaults, plus the rest of the
scene under *Advanced*. One-click presets load the engine's five named scenario
fixtures, so the trivially-fitting case, the tilt case, the proven-impossible
case, the narrow-hallway case and the legs-come-off case are all one tap away.

**The compare view** — the same sofa and the same 110 × 210 cm doorway, in a
240 cm corridor and a 100 cm one. Both animations run off one clock. This is
the screen the demo exists for: a calculator that only compares the sofa's
95 × 85 cm cross-section with the doorway answers *fits* to both.

---

## How honesty is enforced in code

Two rules live in [`src/ui/format.ts`](src/ui/format.ts) rather than being left
to whoever writes the next bit of copy.

**"No path found" is never "does not fit".** A* exhausting a bounded lattice
proves there is no path *on that lattice*. Only `reason: 'proven-too-large'` —
the closed-form cross-section proof — establishes impossibility, and it is the
only verdict allowed to look like one. `search-budget-exhausted` is a fourth
state, rendered as *Inconclusive*, because a search that ran out of budget
concluded nothing.

**"Not searched" is its own state, and it is not a verdict about the
furniture.** Before planning, the worker measures the item's convex hull at its
narrowest and compares it with the opening's smaller side. A three-seat sofa is
85 cm across at its narrowest; a standard interior door is 76 cm. That scene
costs about seven seconds of search and ends in *Inconclusive*, so the search is
skipped and the page says so — in 12 ms instead of 6,700. What it must never say
is that the sofa does not fit, because the measurement is not a proof: the
engine's own tests contain a helix whose hull is 86 cm at its narrowest and which
screws through a 60 cm opening. The panel names the removable part that would
bring the item under the opening when there is one, badges it *measured, not
searched*, and offers **Search anyway**, which runs the full search and reports
whatever it actually finds.

**A coarse-lattice threshold is rendered as an approximation.** When a
suggestion's `basis` is `'coarse-lattice'`, the number is one-sided: the coarse
rungs can miss a path but never invent one, so it can be too generous and never
too small. The page says "about 195 cm", rounds **up** — the direction that
keeps the guarantee intact — and shows the caveat underneath. The engine's own
sentence, which states an exact-sounding figure, is suppressed for exactly
these cases and shown verbatim for `'full-resolution'` ones.

---

## Architecture

```
src/
  engine/     the Web Worker, its message contract, and a two-worker pool
  viewer/     Three.js scene built from engine geometry; path → scrubbable timeline
  ui/         screens, and the formatting rules above
  catalog.ts  retail dressing over the engine's fixtures
```

**The planner runs in a Web Worker.** A plan takes between 20 ms and about
three seconds. Run on the main thread, the three-second case freezes the page
solid — no spinner, no scroll. The worker posts its answer in two phases,
because the two halves have very different costs and the first is the one
people are waiting for: `plan()` with diagnostics off answers *does it fit* in a
few hundred milliseconds, while working out what would *fix* an infeasible
scene means re-planning counterfactuals and costs seconds.

**Nothing is reimplemented.** The demo has no geometry of its own. Positions,
orientations, interpolation, collision and dimensions all come from exported
engine functions. The one thing this run added to the engine —
`firstContactAlongPath` — went in with ten named tests rather than being
computed in the UI, because "the doorway was never the problem" is a claim that
has to be shown with the same collision test the planner uses.

**The 3D scene is engine coordinates, verbatim.** Everything sits inside one
group rotated −90° about X, which maps the engine's frame (X/Y on the floor,
Z up) onto Three's. No drawing code converts a coordinate.

Two presentation decisions are worth naming, since they change what you see:

- The engine closes its scenes with 50 cm slabs for floor, ceiling and outer
  walls. Drawn literally they box the camera into an opaque cube, so solids are
  cropped to a viewing box and everything that is not the doorway wall is cut
  down to knee height. Cropping changes what is visible, never what was planned.
- Playback time is proportional to swept distance, using the engine's own
  `reach` — so a 30° turn of a 220 cm sofa takes longer to play than a 30 cm
  slide, which is also what it takes to perform.

**The node budget is lower than the engine's default.** `DEMO_MAX_NODES` is
1,200,000 against the engine's 6,000,000. On a large corridor the default means
twenty-odd seconds before the search gives up — fine for a batch tool, fatal for
a page someone is looking at. 1.2 M settles all five named scenarios with room
to spare (the dearest needs 825,087) and caps the pathological case at about six
seconds, after which the page says *Inconclusive* rather than pretending to a no. The
triage above removes the commonest reason that budget was ever reached; a scene
that is genuinely borderline — where the item does clear the opening on paper and
the difficulty is the room to maneuver — still costs the full budget, which is
the honest price of a node count rather than a stopwatch.

---

## Deployment

Pushing to `main` runs the engine's typecheck and tests, builds this app, and
publishes it to GitHub Pages via
[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml). The build
uses a relative `base`, so the same bundle works on a project-scoped Pages URL
and from a local `vite preview` without a rebuild.

**One-time setup.** Pages has to be switched on for the repository before the
workflow can publish to it: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The workflow could ask the API to enable it instead,
but the default `GITHUB_TOKEN` is not permitted to create a Pages site, so that
path only produces `Resource not accessible by integration`. Until the setting
is flipped, the build and test steps still run and still gate the merge — only
the deploy step fails.
